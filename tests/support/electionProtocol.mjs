// electionProtocol.mjs - [election 프로토콜] 절의 본문.
//
// run.mjs에서 나온 이유는 크기가 아니라 책임이다: 이 절은 property/fuzz 판정이고, run.mjs는
// 절을 엮어 돌리는 러너다. 판정 이름과 개수는 그대로다(게이트 층 하한이 그것을 센다).
// check는 러너가 주입한다: 통과/실패의 보고 방식은 러너가 소유한다.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mulberry32 } from "./seededRandom.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

export async function assertElectionProtocol(check, checkAsync) {
  const { KernelElection } = await import(pathToFileURL(join(ROOT, "src", "session", "kernelElection.js")).href);
  const makeCtrl = () => new KernelElection({ name: "gateElect", manifest: {} });

  // S1: 리더 교체/사망/떠남/timeout 시 in-flight 요청은 PYPROC_RPC_OUTCOME_UNKNOWN,
  // retryable=false로 끝난다(조용한 유실도 자동 재실행도 아니다). 상태기계 property:
  // 모든 pending이 정확히 한 번 settle되고, reject 후 도착한 응답은 무시된다(_pending 비었음).
  await checkAsync("election: reject 상태기계(outcome-unknown, 한 번만 settle, 늦은 응답 무시)", async () => {
    const ctrl = makeCtrl();
    const settled = new Map(); // reqId -> settle 횟수
    const results = new Map();
    for (let i = 0; i < 5; i++) {
      const reqId = `r${i}`;
      settled.set(reqId, 0);
      const promise = new Promise((resolve, reject) => {
        ctrl._pending.set(reqId, {
          resolve: (v) => { settled.set(reqId, settled.get(reqId) + 1); results.set(reqId, { ok: true, v }); resolve(v); },
          reject: (e) => { settled.set(reqId, settled.get(reqId) + 1); results.set(reqId, { ok: false, e }); reject(e); },
          timer: setTimeout(() => {}, 1_000_000), leaderId: "leaderA", epoch: 3,
        });
      });
      promise.catch(() => {}); // unhandled rejection 방지
    }
    ctrl._rejectPendingOutcomeUnknown("리더가 요청 처리 중 바뀌었다");
    if (ctrl._pending.size !== 0) throw new Error(`reject 후 _pending 비지 않음(${ctrl._pending.size})`);
    for (const [reqId, count] of settled) {
      if (count !== 1) throw new Error(`${reqId}: settle ${count}회(정확히 1회여야)`);
      const r = results.get(reqId);
      if (r.ok || r.e.code !== "PYPROC_RPC_OUTCOME_UNKNOWN" || r.e.retryable !== false) {
        throw new Error(`${reqId}: outcome-unknown/retryable=false 아님 (${r.ok ? "resolved" : r.e.code + "/" + r.e.retryable})`);
      }
    }
    // 늦은 응답: 이미 reject된 reqId로 응답이 도착해도 무시(재settle 없음).
    ctrl._acceptResponse({ requestId: "r0", leaderId: "leaderA", epoch: 3, ok: true, result: 99 });
    if (settled.get("r0") !== 1) throw new Error("reject 후 도착한 응답이 재settle됨");
  });

  // S3: 낡은 리더(epoch 불일치)/다른 리더가 보낸 rpcRes는 pending에 적용되지 않는다(펜싱).
  await checkAsync("election: epoch/leaderId 불일치 응답 펜싱(낡은 리더 응답 무시)", async () => {
    const ctrl = makeCtrl();
    let resolved = null, count = 0;
    const p = new Promise((resolve) => {
      ctrl._pending.set("q1", { resolve: (v) => { count++; resolved = v; resolve(v); }, reject: () => { count++; }, timer: setTimeout(() => {}, 1_000_000), leaderId: "L1", epoch: 7 });
    });
    p.catch(() => {});
    ctrl._acceptResponse({ requestId: "q1", leaderId: "L2", epoch: 7, ok: true, result: 1 }); // 다른 리더
    ctrl._acceptResponse({ requestId: "q1", leaderId: "L1", epoch: 6, ok: true, result: 2 }); // 낡은 epoch
    if (count !== 0 || ctrl._pending.size !== 1) throw new Error("불일치 응답이 pending을 건드렸다");
    ctrl._acceptResponse({ requestId: "q1", leaderId: "L1", epoch: 7, ok: true, result: 42 }); // 정합
    if (resolved !== 42 || count !== 1) throw new Error(`정합 응답 적용 실패(resolved ${resolved})`);
  });

  // S2: 같은 epoch에 리더가 둘로 광고되면 PYPROC_SPLIT_BRAIN(감지 분기). 한계: 자연 발생은
  // Web Locks가 막으므로 여기서는 crafted leaderState 주입으로 감지 분기만 문다(가장 강한 대조).
  await checkAsync("election: split-brain 감지(같은 epoch 다른 리더 = SPLIT_BRAIN)", async () => {
    const ctrl = makeCtrl();
    ctrl._epoch = 4; ctrl._leaderId = "A"; ctrl._role = "follower"; ctrl._phase = "ready";
    ctrl._acceptLeader({ epoch: 4, leaderId: "B", ready: true, recovered: false });
    if (ctrl._phase !== "failed" || ctrl._error?.code !== "PYPROC_SPLIT_BRAIN") {
      throw new Error(`split-brain 미감지(phase ${ctrl._phase}, code ${ctrl._error?.code})`);
    }
    // 대조: 더 높은 epoch의 다른 리더는 정상 승계다(SPLIT_BRAIN 아님).
    const ctrl2 = makeCtrl();
    ctrl2._epoch = 4; ctrl2._leaderId = "A"; ctrl2._role = "follower"; ctrl2._phase = "ready";
    ctrl2._acceptLeader({ epoch: 5, leaderId: "B", ready: true, recovered: false });
    if (ctrl2._phase === "failed") throw new Error("정상 승계(높은 epoch)를 split-brain으로 오판");
    if (ctrl2._leaderId !== "B" || ctrl2._epoch !== 5) throw new Error("승계 후 리더/epoch 갱신 실패");
  });

  // S4: 서버측 멱등성. 재전달된 requestId는 캐시된 응답을 돌려주고 파이썬을 다시 돌리지 않는다
  // (leader 재전송·중복 배달에도 실행 1회). LRU 상한을 넘으면 오래된 항목을 밀어낸다.
  await checkAsync("election: served-cache 멱등성 + LRU 상한", async () => {
    const ctrl = makeCtrl();
    ctrl._epoch = 2; ctrl._servingLeader = true; ctrl._role = "leader";
    let runCount = 0;
    ctrl._session = { rt: { run: () => { runCount++; return 7; }, runAsync: async () => { runCount++; return 7; } } };
    ctrl._chan = { postMessage: () => {} };
    const msg = { type: "rpcReq", action: "run", code: "1", requestId: "dup1", participantId: "caller", targetLeaderId: ctrl.participantId, epoch: 2 };
    await ctrl._serve(msg);
    await ctrl._serve({ ...msg }); // 같은 requestId 재전달
    if (runCount !== 1) throw new Error(`재전달이 파이썬을 다시 돌림(runCount ${runCount})`);
    // LRU: 상한(256)을 넘겨 서빙하면 _served가 무한 성장하지 않는다.
    for (let i = 0; i < 300; i++) {
      await ctrl._serve({ type: "rpcReq", action: "run", code: "1", requestId: `u${i}`, participantId: "caller", targetLeaderId: ctrl.participantId, epoch: 2 });
      if (ctrl._served.size > 256) throw new Error(`served-cache 상한 초과(${ctrl._served.size})`);
    }
    if (ctrl._served.size !== 256) throw new Error(`LRU 축출이 안 됨(size ${ctrl._served.size})`);
  });

  // S5: 세대가 나른 결과로 답한다. 승계자는 새 커널이라 _served가 비어 있지만, 세대가 결과를
  // 실어 왔으면 그 명령은 이미 실행됐고 효과가 이 힙 안에 있다. 다시 돌리면 두 번 실행이다.
  await checkAsync("election: 세대가 나른 결과로 답하고 다시 실행하지 않는다", async () => {
    const ctrl = makeCtrl();
    ctrl._epoch = 7; ctrl._servingLeader = true; ctrl._role = "leader";
    let runCount = 0;
    ctrl._session = { rt: { run: () => { runCount++; return 1; }, runAsync: async () => { runCount++; return 1; } } };
    const posted = [];
    ctrl._chan = { postMessage: (message) => posted.push(message) };
    // 승계자가 부활한 상태를 흉내낸다: 결과 기록만 있고 served 캐시는 비었다.
    ctrl._outcomes = [{ requestId: "r/1/1", epoch: 3, action: "run", ok: true, result: 42 }];
    await ctrl._serve({ type: "rpcReq", action: "run", code: "1", requestId: "r/1/1", participantId: "caller", targetLeaderId: ctrl.participantId, epoch: 7 });
    if (runCount !== 0) throw new Error(`기록이 있는데 다시 실행했다(runCount ${runCount})`);
    const answer = posted.find((message) => message.requestId === "r/1/1");
    if (!answer || answer.ok !== true || answer.result !== 42) throw new Error(JSON.stringify(answer));
    // 리더 신원과 epoch는 지금 것이어야 한다: 호출자의 fence가 그것으로 응답을 받아들인다.
    if (answer.leaderId !== ctrl.participantId || answer.epoch !== 7) throw new Error(`fence 불일치: ${answer.leaderId}/${answer.epoch}`);
    if (answer.replayed !== true) throw new Error("기록으로 답한 사실이 응답에 없다");
  });

  // S6: 기록이 없으면 실행하고 남긴다. 기록이 없다는 것은 효과가 이 세대에 없다는 뜻이므로
  // 재실행이 곧 정확히 한 번이다(그 두 갈래가 exactly-once의 전부다).
  await checkAsync("election: 기록이 없으면 실행하고 그 결과를 남긴다", async () => {
    const ctrl = makeCtrl();
    ctrl._epoch = 2; ctrl._servingLeader = true; ctrl._role = "leader";
    let runCount = 0;
    ctrl._session = { rt: { run: () => { runCount++; return 5; }, runAsync: async () => { runCount++; return 5; } } };
    ctrl._chan = { postMessage: () => {} };
    await ctrl._serve({ type: "rpcReq", action: "run", code: "1", requestId: "n/1/1", participantId: "caller", targetLeaderId: ctrl.participantId, epoch: 2 });
    if (runCount !== 1) throw new Error(`실행 횟수 ${runCount}`);
    const recorded = ctrl._outcomes.find((entry) => entry.requestId === "n/1/1");
    if (!recorded || recorded.ok !== true || recorded.result !== 5) throw new Error(JSON.stringify(ctrl._outcomes));
  });

  // S7: 실패도 기록된다. 실패를 안 남기면 승계자가 그 명령을 다시 돌려 "두 번 실행"이 된다.
  await checkAsync("election: 실패한 명령의 결과도 기록에 남는다", async () => {
    const ctrl = makeCtrl();
    ctrl._epoch = 2; ctrl._servingLeader = true; ctrl._role = "leader";
    ctrl._session = { rt: { run: () => { throw new Error("boom"); }, runAsync: async () => { throw new Error("boom"); } } };
    ctrl._chan = { postMessage: () => {} };
    await ctrl._serve({ type: "rpcReq", action: "run", code: "1", requestId: "f/1/1", participantId: "caller", targetLeaderId: ctrl.participantId, epoch: 2 });
    const recorded = ctrl._outcomes.find((entry) => entry.requestId === "f/1/1");
    if (!recorded || recorded.ok !== false) throw new Error(JSON.stringify(ctrl._outcomes));
  });

  // S8: 호출자 절반. 리더가 바뀌면 내구 머신의 대기 요청은 거부되지 않고 park되며, 준비된
  // 승계자가 announce하면 정확히 한 번 다시 나간다. 서버측이 기록으로 답하므로 재전송이
  // 두 번 실행을 만들지 않는다(S5가 그 절반을 문다).
  await checkAsync("election: 리더 교체 시 대기 요청은 park되고 승계자에게 한 번 재전송된다", async () => {
    const ctrl = makeCtrl();
    ctrl._journalDir = {}; // 내구 머신(승계자에게 물어볼 세대가 있다)
    // park의 전제: 이 참가자가 자기 커널을 알고 그 힙에 JS 핸들이 없다(모르면 정직하게 거부한다).
    ctrl._session = { rt: { hostProxySurfaces: () => [] } };
    ctrl._phase = "ready"; ctrl._leaderId = "old"; ctrl._epoch = 3;
    const posted = [];
    ctrl._chan = { postMessage: (message) => posted.push(message) };
    let settled = 0;
    ctrl._pending.set("c/1/1", {
      resolve: () => { settled++; }, reject: () => { settled++; },
      timer: null, leaderId: "old", epoch: 3, action: "run", payload: { code: "1" }, timeoutMs: 5000,
    });
    ctrl._acceptLeader({ epoch: 4, leaderId: "new", ready: false, recovered: false });
    if (settled !== 0) throw new Error("리더 교체가 요청을 settle했다(park이어야 한다)");
    if (!ctrl._pending.get("c/1/1")?.awaitingLeader) throw new Error("park 표시가 없다");
    ctrl._acceptLeader({ epoch: 4, leaderId: "new", ready: true, recovered: true });
    const resent = posted.filter((message) => message.type === "rpcReq" && message.requestId === "c/1/1");
    if (resent.length !== 1) throw new Error(`재전송 횟수 ${resent.length}`);
    if (resent[0].targetLeaderId !== "new" || resent[0].epoch !== 4) throw new Error(`옛 리더로 보냈다: ${resent[0].targetLeaderId}/${resent[0].epoch}`);
    if (resent[0].code !== "1") throw new Error("payload가 재전송에 실리지 않았다");
    const timer = ctrl._pending.get("c/1/1")?.timer;
    if (timer) clearTimeout(timer);
  });

  // S9: 내구하지 않은 머신은 예전대로 거부한다. 승계자에게 물어볼 세대가 없으므로 그 경우의
  // "모른다"는 여전히 참이고, park하면 영원히 답이 오지 않는 요청이 된다.
  await checkAsync("election: 내구하지 않은 머신은 리더 교체에서 여전히 거부한다", async () => {
    const ctrl = makeCtrl();
    ctrl._journalDir = null;
    ctrl._phase = "ready"; ctrl._leaderId = "old"; ctrl._epoch = 3;
    ctrl._chan = { postMessage: () => {} };
    let code = "";
    ctrl._pending.set("d/1/1", {
      resolve: () => {}, reject: (error) => { code = error.code; },
      timer: null, leaderId: "old", epoch: 3, action: "run", payload: { code: "1" }, timeoutMs: 5000,
    });
    ctrl._acceptLeader({ epoch: 4, leaderId: "new", ready: false, recovered: false });
    if (code !== "PYPROC_RPC_OUTCOME_UNKNOWN") throw new Error(`거부 코드 ${code || "없음"}`);
  });

  // S10: 승계를 건너는 순서 보존. 대기 줄은 삽입 순서를 지키므로 재전송도 호출자가 보낸
  // 순서 그대로 나간다. 정직한 한계: "승계 중 들어온 새 명령이 줄 뒤에 선다"는 절반은 여기서
  // 못 문다(가입하지 않은 컨트롤러는 _request의 환경 가드에서 먼저 거부된다). 그 절반의 증거는
  // 브라우저 레인의 불멸 게이트가 실제 참가자로 들고 있다.
  await checkAsync("election: 대기 줄은 호출자가 보낸 순서대로 재전송된다", async () => {
    const ctrl = makeCtrl();
    ctrl._journalDir = {};
    // park의 전제: 이 참가자가 자기 커널을 알고 그 힙에 JS 핸들이 없다(모르면 정직하게 거부한다).
    ctrl._session = { rt: { hostProxySurfaces: () => [] } };
    ctrl._phase = "ready"; ctrl._leaderId = "old"; ctrl._epoch = 3;
    const posted = [];
    ctrl._chan = { postMessage: (message) => posted.push(message) };
    for (const [id, code] of [["q/1/1", "first"], ["q/1/2", "second"], ["q/1/3", "third"]]) {
      ctrl._pending.set(id, {
        resolve: () => {}, reject: () => {}, timer: null, leaderId: "old", epoch: 3,
        action: "run", payload: { code }, timeoutMs: 5000,
      });
    }
    ctrl._acceptLeader({ epoch: 4, leaderId: "new", ready: false, recovered: false });
    ctrl._acceptLeader({ epoch: 4, leaderId: "new", ready: true, recovered: true });
    const order = posted.filter((message) => message.type === "rpcReq").map((message) => message.code);
    if (order.join(",") !== "first,second,third") throw new Error(`순서 ${order.join(",")}`);
    for (const entry of ctrl._pending.values()) if (entry.timer) clearTimeout(entry.timer);
  });
}
