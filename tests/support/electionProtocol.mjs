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
}
