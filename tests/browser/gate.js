// 루트 표면은 porcelain 6개(boot/open/createWebComputer/checkEnvironment/PyProcError/
// PYPROC_ERROR_CODES)로 개편됐다. 이 게이트는 런타임 계약의 실동작을 검증하므로,
// 루트에서 내린 내부 표면은 src 경로로 직접 가져온다(테스트 파일의 심층 import 허용).
import { boot, checkEnvironment } from "../../index.js";
import { bootEnv, runScript } from "../../src/composition/envManager.js";
import { Runtime } from "../../src/composition/runtimeApi.js";
import { PyProc, SIGNAL } from "../../src/processOs/pyProc.js";
import { JobControl } from "../../src/processOs/jobControl.js";
import { MachineContainer } from "../../src/processOs/machineContainer.js";
import { bootSession, openMachine } from "../../src/session/session.js";
import { verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "../../src/runtime/assets.js";
import { DEFAULT_ENGINE_SCRIPT_INTEGRITY, DEFAULT_INDEX } from "../../src/runtime/pyodideDistribution.js";

const out = document.getElementById("out");
const checks = [];
const timings = {};
const log = (m) => { out.textContent += "\n" + m; };
// 배포 지점 오버라이드(?indexURL=/vendor/pyodide/): 같은 게이트를 CDN이 아니라
// 자가 호스팅 경로로 전 검사한다(engine-independence P0의 게이트). 절대 URL로 정규화:
// 워커/캐시 계층의 URL 대조(startsWith)가 상대 경로에서 어긋나지 않게.
const indexParam = new URLSearchParams(location.search).get("indexURL");
const INDEX = indexParam ? new URL(indexParam, location.href).href : undefined;
const check = (name, pass, info = "") => {
  checks.push({ name, pass: !!pass, info: String(info) });
  log(`${pass ? "PASS" : "FAIL"} ${name}${info ? " (" + info + ")" : ""}`);
};

async function report() {
  const ok = checks.length > 0 && checks.every((c) => c.pass);
  const body = JSON.stringify({ ok, checks, timings, ua: navigator.userAgent });
  out.textContent = (ok ? "게이트 GREEN\n" : "게이트 RED\n") + out.textContent;
  try { await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" }, body }); } catch (e) {}
}

try {
  // 0) 전제: crossOriginIsolated (COOP/COEP 서버 검증 겸용)
  check("crossOriginIsolated", crossOriginIsolated === true);
  // 환경 진단: COI 하에서 전부 준비(ok) + 세 능력 true. 소비자 온보딩의 첫 계약.
  const env = checkEnvironment();
  check("checkEnvironment: COI 하에서 ok", env.ok === true && env.crossOriginIsolated && env.sharedArrayBuffer && env.jspi && env.issues.length === 0,
    `sab=${env.sharedArrayBuffer} jspi=${env.jspi}`);

  // 실행 자산 SRI preflight: 테스트 서버가 pyproc-assets CLI 산출물을 같은 오리진에서 제공하고,
  // 브라우저가 그 JSON을 그대로 assetIntegrity로 소비한다. 브라우저는 module Worker import에
  // SRI 속성을 직접 못 걸기 때문에 이 preflight가 런타임 집행 지점이다.
  const assetIntegrity = await fetch("/pyproc-assets.json", { cache: "no-store" }).then((r) => r.json());
  const assetOk = await verifyPyProcAssetIntegrity(assetIntegrity, { roles: ["processWorker"] });
  check("assetIntegrity: CLI graph preflight", assetOk.verified > 1 && assetOk.files.includes("src/processOs/worker.js") && assetOk.files.includes("src/processOs/ipc.js"), `${assetOk.verified} files, ${assetOk.bytes} bytes`);
  const sealedSw = await registerPyProcServiceWorker(assetIntegrity, {
    cache: true,
    cdn: `${location.origin}/src/capabilities/`,
    coreIntegrity: "/pyproc-assets.json",
    scope: "/",
  });
  check("assetIntegrity: Service Worker register 경로 봉인",
    sealedSw.integrity.files.includes("src/capabilities/pyprocSw.js") && sealedSw.url.includes("/src/capabilities/pyprocSw.js"),
    sealedSw.url);
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("service worker ready timeout")), 10000)),
  ]);
  if (!navigator.serviceWorker.controller) {
    await Promise.race([
      new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("service worker controller timeout")), 10000)),
    ]);
  }
  const swGood = await fetch(`/src/capabilities/pyprocSw.js?swSeal=${Date.now()}`, { cache: "reload" });
  // 봉인 밖 경로는 거부돼야 한다. fixture는 봉인 그래프에 없는 파일이어야 하므로 그 사실을
  // 먼저 단정한다: 그래프가 자라 이 파일을 삼키면(자산 role이 늘면 실제로 일어난다) 검사가
  // 조용히 무의미해지는 대신 "다른 fixture를 골라라"라고 말하며 RED가 된다.
  const outsidePath = "src/capabilities/gpuCompute.js";
  const outsideSealed = sealedSw.integrity.files.includes(outsidePath);
  const swDenied = await fetch(`/${outsidePath}?swSeal=${Date.now()}`, { cache: "reload" });
  check("assetIntegrity: SW coreIntegrity가 import 경로를 검증",
    swGood.ok && !outsideSealed && swDenied.status === 500,
    `good ${swGood.status}, 봉인 밖 ${outsidePath} ${swDenied.status}${outsideSealed ? " (fixture가 봉인 안으로 들어왔다)" : ""}`);
  await sealedSw.registration.unregister();
  const badAssetIntegrity = {
    ...assetIntegrity,
    files: assetIntegrity.files.map((f) => f.path === "src/processOs/worker.js" ? { ...f, integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } : f),
  };
  let badAssetDenied = false;
  try { await new PyProc({ indexURL: INDEX, assetIntegrity: badAssetIntegrity }).boot(1, false); }
  catch (e) { badAssetDenied = String(e).includes("assetIntegrity"); }
  check("assetIntegrity: 잘못된 worker SRI가 spawn 전 거부", badAssetDenied);

  // 1) Layer 0: 부팅 + 실행. 루트 boot는 이제 PyprocMachine 핸들을 돌려주고,
  //    능력 상세는 runtime 탈출구로 연다(이하 게이트는 그 탈출구 Runtime으로 동작 불변 검증).
  let t = performance.now();
  const pm = await boot({ indexURL: INDEX, assetIntegrity });
  const rt = pm.runtime;
  timings.bootMs = Math.round(performance.now() - t);
  // 메모리 예산의 앵커. 시간만 재면 델타 수집이 두 배가 되거나 이미지가 부는 회귀가 시간 여유
  // 안에 전부 숨는다(bootMs 상한은 실측의 12배다). 힙 자체가 이 제품의 정체성이므로 그 크기를 잰다.
  timings.bootHeapBytes = pm.runtime.memory.byteLength();
  check("boot()", true, timings.bootMs + "ms" + (INDEX ? " @" + INDEX : ""));
  // 동시 부팅 실측. 기본 부팅은 coreIntegrity 기본값 때문에 항상 코어 캐시 창을 열고, 그 창은
  // 탭 전역 체인이라 두 부팅이 서로를 기다린다. 그 사실을 숫자로 남긴다: 비율이 2에 가까우면
  // 직렬, 1에 가까우면 겹친 것이다. 판정이 아니라 관측이고, 계약 실태 표가 그것을 인용한다.
  const concurrentStart = performance.now();
  const [cbA, cbB] = await Promise.all([boot({ indexURL: INDEX, assetIntegrity }), boot({ indexURL: INDEX, assetIntegrity })]);
  timings.concurrentBootMs = Math.round(performance.now() - concurrentStart);
  check("boot: 두 머신 동시 부팅이 완료된다",
    cbA.run("1 + 1") === 2 && cbB.run("2 + 2") === 4,
    `동시 ${timings.concurrentBootMs}ms / 단일 ${timings.bootMs}ms = ${(timings.concurrentBootMs / Math.max(1, timings.bootMs)).toFixed(2)}배`);
  await cbA.dispose();
  await cbB.dispose();
  if (!INDEX) {
    const engineURL = new URL(rt.indexURL, location.href);
    const engineScript = [...document.scripts].find((script) => script.src === new URL("pyodide.js", engineURL).href);
    const thirdParty = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => { try { return new URL(url).origin !== location.origin; } catch { return false; } });
    check("기본 엔진: verified same-origin 배포",
      engineURL.origin === location.origin && engineURL.pathname === DEFAULT_INDEX,
      rt.indexURL);
    check("기본 엔진: pyodide.js pinned SRI",
      engineScript?.integrity === DEFAULT_ENGINE_SCRIPT_INTEGRITY,
      engineScript?.integrity || "script missing");
    check("기본 엔진: core byte 검증 + third-party 요청 0",
      rt.coreCache?.verified >= 3 && rt.coreCache.integrityMissing === 0 && thirdParty.length === 0,
      `verified=${rt.coreCache?.verified ?? 0}, external=${thirdParty.join(",") || "none"}`);
  }
  check("run: sum(range(100)) === 4950", rt.run("sum(range(100))") === 4950);
  check("Runtime.assetIntegrity 보관", rt.assetIntegrity === assetIntegrity);

  // porcelain 스모크: 핸들이 모델의 어휘(run/history/deterministic)를 실제로 말하는가.
  check("porcelain: pm.run 실행", pm.run("1 + 1") === 2);
  pm.run("porcelainX = 1");
  const porcelainCp = pm.history.checkpoint();
  pm.run("porcelainX = 999");
  pm.history.checkpoint(); // 경계 닫기(리액티브 계약)
  pm.history.restore(porcelainCp);
  check("porcelain: history.checkpoint/restore 왕복", pm.run("porcelainX") === 1);
  check("porcelain: 일반 부팅은 deterministic === false", pm.deterministic === false);

  // 시도 경쟁(휘발 구역): 같은 기반에서 후보 N개를 직렬로 돌려 형제 가지로 남기고, 채택은
  // 그 가지로의 복원이다. 실패한 시도는 오류가 값으로 잡히고 다음 시도는 오염 없이 기반에서
  // 시작해야 한다(그것이 이 동사의 존재 이유다: 잘못된 시도가 다음 시도를 오염시키지 않는다).
  pm.run("att = 10");
  const race = pm.history.attempts([
    "att = att * 2",                       // 후보 0: 20
    "att = att.upper()",                   // 후보 1: AttributeError(int에 upper 없음)
    "att = att + 5",                       // 후보 2: 15
  ]);
  const attemptsBaseIntact = pm.run("att") === 10; // 경쟁이 끝나면 기반 상태다
  race.adopt(2);
  const attemptsSiblings = pm.history.tree().filter((node) => node.parent === race.base.index).length;
  check("porcelain: history.attempts가 실패를 격리하고 채택이 그 상태를 복원한다",
    attemptsBaseIntact && race.attempts[0].ok && !race.attempts[1].ok && race.attempts[2].ok
    && race.attempts[1].error && String(race.attempts[1].error.message || race.attempts[1].error).includes("upper")
    && pm.run("att") === 15 && attemptsSiblings >= 3,
    `기반 유지=${attemptsBaseIntact}, 실패 격리=${!race.attempts[1].ok}, 채택 후 att=${pm.run("att")}, 형제 가지 ${attemptsSiblings}`);

  // 오타를 침묵으로 만들지 않는다: 미지의 옵션 키는 입구에서 거부된다(전에는 조용히 버려져
  // `determinstic` 오타가 무증상 비결정 부팅이 됐고 실패는 history.export에서 나타났다).
  let optionErr = null;
  try { await boot({ determinstic: true }); } catch (e) { optionErr = e; }
  check("boot: 미지의 옵션 키 거부 + 후보 제시",
    !!optionErr && optionErr.code === "PYPROC_INPUT_INVALID" && optionErr.message.includes("determinstic")
    && optionErr.message.includes("deterministic"),
    optionErr ? optionErr.message.slice(0, 80) : "no error");
  // 아는 키인데 그 모드가 읽지 않는 옵션도 거부한다. setup/wheelDir은 결정적 리플레이
  // 매니페스트의 항목이라 그 경로만 읽고, 기본 경로는 이름조차 참조하지 않는다. 허용 목록만
  // 있을 때 `boot({ packages, setup })`은 성공하고 setup을 조용히 버렸다: 침묵하는 무시는
  // 오타보다 나쁘다(오타는 결국 드러나지만 이쪽은 아무 흔적이 없다). 코드 수리에 게이트가
  // 없어 한 번의 되돌림으로 사라질 수 있던 자리다(5차 재심사 지적).
  const modeErrors = [];
  for (const key of ["setup", "wheelDir"]) {
    let modeErr = null;
    try { await boot({ [key]: key === "setup" ? "x = 1" : "wheels" }); } catch (e) { modeErr = e; }
    modeErrors.push({ key, code: modeErr?.code, mentions: !!modeErr?.message?.includes(key) });
  }
  check("boot: 모드가 읽지 않는 옵션은 거부한다(침묵 무시 없음)",
    modeErrors.every((entry) => entry.code === "PYPROC_INPUT_INVALID" && entry.mentions),
    JSON.stringify(modeErrors));

  // 비결정 머신의 export 거부(api.md 계약). 증거가 0이던 자리다: 이 거부가 사라지면
  // 리플레이 보증 없는 상태가 이동 가능한 이미지로 조용히 나간다.
  let exportErr = null;
  try { await pm.history.export(); } catch (e) { exportErr = e; }
  check("history.export: 비결정 머신 거부", !!exportErr && exportErr.code === "PYPROC_INPUT_INVALID",
    exportErr ? exportErr.code : "no error");

  // 결정적 부팅의 경계 바이트 동일성: 세션 부활(h0 대조)과 저널 recover와 fork가 전부 이
  // 전제 위에 선다. 직접 증거가 없어 fork 게이트가 함수적으로 전제할 뿐이었다(감사 지적).
  //
  // 측정 대상은 **cp0 경계**다. 부팅 직후의 live 힙은 두 부팅에서 다르다: 복제 고유성을 위해
  // 재시드(실제 엔트로피)가 cp0 확정 뒤에 돌기 때문이다(설계). 계약도 그렇게 적혀 있다
  // (api.md: "byte-identical memory at the replay boundary (cp0)"). 실측 확인: 같은 매니페스트
  // 두 부팅의 live 힙 digest는 다르고 길이는 같았다(31457280B) -> cp0 해시 배열로 대조한다.
  {
    const [d1, d2] = [await boot({ deterministic: true, indexURL: INDEX }), await boot({ deterministic: true, indexURL: INDEX })];
    const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const boundaryDigest = async (machine) => {
      const hashes = machine.runtime.enableReactive().hashes[0];
      return hex(await crypto.subtle.digest("SHA-256", new Uint8Array(hashes.buffer, hashes.byteOffset, hashes.byteLength)));
    };
    const [h1, h2] = [await boundaryDigest(d1), await boundaryDigest(d2)];
    check("결정적 부팅: 같은 매니페스트 두 부팅의 cp0 경계 동일(h0)",
      h1 === h2 && d1.runtime.memory.byteLength() === d2.runtime.memory.byteLength(),
      `${h1.slice(0, 12)}.. == ${h2.slice(0, 12)}.. (${d1.runtime.memory.byteLength()}B)`);
    // 경계 이후는 갈라져야 한다: 재시드가 프로세스를 갈라놓는 것이 복제 고유성 계약이다.
    const liveDigest = async (machine) => hex(await crypto.subtle.digest("SHA-256", machine.runtime.memory.sliceAll()));
    const [l1, l2] = [await liveDigest(d1), await liveDigest(d2)];
    check("결정적 부팅: 경계 이후 live 힙은 갈라진다(재시드 = 복제 고유성)", l1 !== l2,
      `${l1.slice(0, 8)}.. != ${l2.slice(0, 8)}..`);
    check("결정적 부팅: deterministic === true", d1.deterministic === true && d2.deterministic === true);
    await d1.dispose();
    await d2.dispose();
  }

  // 2) Layer 1: 복원 리액티브의 실행 경계 계약
  const reactive = rt.enableReactive();
  const sp0 = reactive.stackSave();
  rt.run("x = 1");
  const cp = reactive.checkpoint();
  rt.run("x = 999");
  reactive.checkpoint(); // 실행 경계를 checkpoint로 닫는다 (계약)
  t = performance.now();
  reactive.restoreLive(cp.index, sp0);
  timings.restoreLiveMs = +(performance.now() - t).toFixed(2);
  check("restoreLive: 경계를 닫으면 x === 1", rt.run("x") === 1, timings.restoreLiveMs + "ms");

  rt.run("x = 777"); // 경계를 닫지 않은 dirty 상태
  reactive.restore(cp.index, sp0); // 전체 복원은 경계 없이도 안전 기준선
  check("restore: 전체 복원으로 x === 1", rt.run("x") === 1);

  try { rt.run("x = 555\nraise ValueError('boom')"); } catch (e) {} // 예외 = 경계 없는 오염
  const rr1 = reactive.restoreLive(cp.index, sp0); // 옵션 없이: 가드가 자동 재해시 승격
  check("restoreLive 가드: 경계 위반 자동 감지 복원", rt.run("x") === 1 && rr1.rehashed === true);

  // 체크포인트 나무(머신의 git): 과거로 복원 후 새 체크포인트 = 분기. 형제 델타가 새면
  // 힙이 깨진다(선형 체인의 실결함, branchProbe로 재현). 정본 실측: pythonMachine/branchProbe.
  rt.run("br = bytearray(100000)\nbr[:4] = b'ROOT'");
  const b0 = reactive.checkpoint().index;
  rt.run("br[:4] = b'MAIN'");
  const bMain = reactive.checkpoint().index;
  reactive.restoreLive(b0, sp0);
  rt.run("brTag = 'exp'");            // 분기: 부모 = b0, br은 안 건드림
  const bExp = reactive.checkpoint().index;
  reactive.restore(b0, sp0);          // 라이브를 분기점으로(판별을 가리는 우연 제거)
  reactive.restoreLive(bExp, sp0);
  check("체크포인트 나무: 분기가 형제 델타에 오염되지 않음",
    rt.run("bytes(br[:4]).decode()") === "ROOT" && rt.run("brTag") === "exp" && reactive.tree()[bExp].parent === b0);
  reactive.restoreLive(bMain, sp0);
  check("나무: 본선 복귀 정확", rt.run("bytes(br[:4]).decode()") === "MAIN");

  // 전 힙 바이트 동일성(RG1, 실측 발견): Node fuzz는 합성 버퍼로 pageHashes 파이프라인을
  // 두드리지만, 실 WASM 힙에서 임의 변이 후 복원이 "전 바이트" 동일한지는 어떤 게이트도
  // 검사하지 않았다(전부 Python 스칼라/4바이트 마커). 스칼라는 살아남아도 비live 바이트
  // (해제 arena·정렬 패딩·interned 꼬리)가 조용히 갈라질 수 있다 - 나중에 크래시로만 드러나는
  // 손상 부류다. 힙을 미리 키워(이후 길이 불변) 제자리 변이만 하므로 sliceAll 전량 대조가 성립한다.
  rt.run("import random as _rng\n_pool = bytearray(24 * 1024 * 1024)"); // 미리 성장(이후 길이 고정)
  let fullHeapOk = true, fullHeapInfo = "";
  const baseLenFH = rt.memory.byteLength();
  for (let it = 0; it < 4 && fullHeapOk; it++) {
    rt.run(`_rng.seed(${9001 + it})\nfor _ in range(3000):\n    _pool[_rng.randrange(len(_pool))] = _rng.randrange(256)`);
    const cpFH = reactive.checkpoint();          // 경계 닫기
    const snap = rt.memory.sliceAll();            // 독립 오라클: 이 순간의 전 힙
    rt.run("for _ in range(3000):\n    _pool[_rng.randrange(len(_pool))] = _rng.randrange(256)");
    reactive.checkpoint();                         // 경계 닫기
    reactive.restore(cpFH.index, sp0);             // 전체 복원(base + 경로 델타)
    const back = rt.memory.sliceAll();
    if (back.length !== snap.length) { fullHeapOk = false; fullHeapInfo = `it${it} 길이 ${back.length}!=${snap.length}(성장 발생)`; break; }
    for (let i = 0; i < snap.length; i++) {
      if (back[i] !== snap[i]) { fullHeapOk = false; fullHeapInfo = `it${it} byte ${i} 불일치`; break; }
    }
  }
  check("full-heap 왕복: 실 힙 전 바이트 동일(임의 변이 24MB x4, RG1)", fullHeapOk,
    fullHeapInfo || `${Math.round(baseLenFH / 1048576)}MB 고정, 4회 왕복 전 바이트 동일`);
  rt.run("del _pool"); // 다음 게이트에 힙 잔재 안 남김

  // base의 OPFS 영속: 내보내고 되읽은 base로도 복원이 성립해야 한다
  const opfsRoot = await navigator.storage.getDirectory();
  const opfsDir = await opfsRoot.getDirectoryHandle("pyprocGate", { create: true });
  await reactive.saveBase(opfsDir, "base.bin");
  await reactive.loadBase(opfsDir, "base.bin");
  rt.run("x = 321");
  reactive.checkpoint();
  reactive.restoreLive(cp.index, sp0);
  check("saveBase/loadBase: OPFS 로드본으로 복원", rt.run("x") === 1);
  await opfsRoot.removeEntry("pyprocGate", { recursive: true });

  // 리액티브 soundness 신계약 (core-surface-hardening 0a/0b/0c)
  check("enableReactive: 런타임당 컨트롤러 1개(memoize)", rt.enableReactive() === reactive);
  const cpH = reactive.checkpoint();
  rt.run("es1 = 11");
  reactive.checkpoint(); // 경계 닫기
  const backInfo = cpH.restore();
  check("cp.restore(): 인덱스/sp 운반 없는 한 호출 복원",
    rt.run("'es1' in globals()") === false && typeof backInfo.pagesWritten === "number" && typeof cpH.sp === "number");
  const seqBefore = rt.execSeq;
  reactive.restoreLive(cpH.index);
  check("복원 = 경계 이벤트(execSeq 기록, 외부 관찰자 가시성)", rt.execSeq > seqBefore);
  rt.run("es2 = 5");
  reactive.checkpoint();
  reactive.markDirty();
  const md = reactive.restoreLive(reactive.liveIdx);
  check("markDirty: 다음 복원 자동 재해시 승격", md.rehashed === true);
  const cpKeep = reactive.checkpoint();
  rt.run("es3 = 1");
  const cpDrop = reactive.checkpoint();
  reactive.restoreLive(cpKeep.index);
  rt.run("es4 = 2");
  const cpLive = reactive.checkpoint();
  // 회수 단정: 가지치기는 노드 수만 줄이는 것이 아니라 바이트를 돌려줘야 한다. stats()는 이미
  // 정확한 계측기인데 어떤 게이트도 그것을 읽지 않았다. 여기서 예산의 앵커를 세운다.
  const statsBeforePrune = reactive.stats();
  const prunedInfo = reactive.pruneTo(cpLive.index);
  const statsAfterPrune = reactive.stats();
  check("reactive 회수: pruneTo가 델타 바이트를 실제로 돌려준다",
    prunedInfo.freedNodes >= 1
    && statsAfterPrune.activeNodes < statsBeforePrune.activeNodes
    && statsAfterPrune.totalBytes < statsBeforePrune.totalBytes,
    `노드 ${statsBeforePrune.activeNodes} -> ${statsAfterPrune.activeNodes}, 총 ${statsBeforePrune.totalMB} -> ${statsAfterPrune.totalMB}MB`);
  timings.reactiveTotalMb = statsAfterPrune.totalMB;

  // 선형 역사의 회수. 가지치기는 경로 **밖** 노드만 놓으므로, 문장마다 체크포인트를 찍는
  // 지배적 모양에서는 0바이트를 돌려준다. 그 상태에서 setRetentionPolicy는 한계 초과를
  // 관측만 하고 메모리는 그대로였다(공개 표면이 약속한 능력이 실제로는 없었다).
  // rebaseLinear는 경로 자체를 base로 접는다. 그 대가는 경계 이동이고, 그것까지 함께 단정한다.
  {
    const epochBefore = reactive.boundaryEpoch;
    rt.run("rebaseSeed = [0] * 200000");
    for (let i = 0; i < 6; i++) { rt.run(`rebaseStep${i} = ${i}`); reactive.checkpoint(); }
    const linearBefore = reactive.stats();
    reactive.setRetentionPolicy({ maxNodes: 2, pruneBranches: true, rebaseLinear: true });
    rt.run("rebaseStepLast = 1");
    reactive.checkpoint(); // 정책은 체크포인트 경계에서 적용된다
    const linearAfter = reactive.stats();
    const survived = rt.run("rebaseStep5 + rebaseStepLast"); // 접힌 상태가 힙에 그대로 있는가
    check("reactive 회수: 선형 역사도 rebase로 바이트를 돌려준다",
      linearBefore.activeNodes > linearAfter.activeNodes
      && linearAfter.deltaBytes < linearBefore.deltaBytes
      && reactive.boundaryEpoch > epochBefore
      && survived === 6,
      `노드 ${linearBefore.activeNodes} -> ${linearAfter.activeNodes}, 델타 ${linearBefore.deltaBytes} -> ${linearAfter.deltaBytes}B, 경계 세대 +${reactive.boundaryEpoch - epochBefore}`);
    reactive.setRetentionPolicy(null);
    reactive.checkpoint();
  }
  let prunedCode = "";
  try { reactive.restoreLive(cpDrop.index); } catch (e) { prunedCode = e.code; }
  check("pruneTo: 경로 밖 노드 해제 + PYPROC_CHECKPOINT_PRUNED 거부",
    prunedInfo.freedNodes >= 1 && prunedCode === "PYPROC_CHECKPOINT_PRUNED", `freed ${prunedInfo.freedNodes}`);
  const delta = reactive.collectDelta(0);
  check("collectDelta: 경계 델타 수집 프리미티브", Array.isArray(delta.pages) && delta.bin instanceof Uint8Array && delta.heapLen === rt.memory.byteLength());

  // 저널: 복원도 경계 이벤트다 = 복원 직후 유휴 커밋이 복원 상태를 디스크에 남긴다
  const jRootDir = await navigator.storage.getDirectory();
  try { await jRootDir.removeEntry("pyprocGateJournal", { recursive: true }); } catch (e) {}
  const jDir = await jRootDir.getDirectoryHandle("pyprocGateJournal", { create: true });
  const gj = rt.enableJournal({ dir: jDir, reactive, idleMs: 150, includeHome: false });
  // 커밋 1회는 델타 전량을 OPFS에 쓰는 실작업이라 부하에 따라 초 단위로 흔들린다.
  // 이 체크의 의도는 "복원이 유휴 커밋을 유발한다"이지 "N초 안에 끝난다"가 아니므로
  // 대기 예산을 넉넉히 준다(시간을 재는 것은 성능 예산 게이트의 몫).
  const waitFor = async (done, budgetMs = 30000) => {
    for (let waited = 0; waited < budgetMs && !done(); waited += 250) await new Promise((res) => setTimeout(res, 250));
    return done();
  };
  gj.start();
  rt.run("jrx = 1");
  await waitFor(() => gj.commits >= 1);
  const commitsAfterRun = gj.commits;
  reactive.restoreLive(reactive.liveIdx); // 복원(무변경이라도 경계 이벤트)
  await waitFor(() => gj.commits > commitsAfterRun);
  const commitsAfterRestore = gj.commits;
  gj.stop();
  check("journal: 복원 후 유휴 커밋 발생(복원 상태의 durable 반영)",
    commitsAfterRun >= 1 && commitsAfterRestore > commitsAfterRun, `run 후 ${commitsAfterRun}, 복원 후 ${commitsAfterRestore}`);

  // 주소 캐시: 해시가 그대로인 페이지는 SHA-256을 다시 하지 않고 기존 주소를 hint로 쓴다.
  // 저장소 존재 대조 뒤 재사용이 실제로 일어나는지(효과)와 그 주소로 부활이 성립하는지(정확성)를
  // 함께 본다. 후자가 없으면 이 cache는 tree가 없는 오브젝트를 가리키는 조용한 오염 장치다.
  rt.run("jaddr = 1");
  const cacheFirst = await gj.commit();
  rt.run("jaddr = 2");
  const cacheSecond = await gj.commit();
  rt.run("jaddr = 999");
  const cacheRecovered = await rt.enableJournal({ dir: jDir, reactive, includeHome: false }).recover();
  check("journal 주소 캐시: 불변 페이지는 재사용하고 그 주소로 부활한다",
    !!cacheFirst && cacheSecond && cacheSecond.reused > 0 && !!cacheRecovered && rt.run("jaddr") === 2,
    `1차 reused ${cacheFirst && cacheFirst.reused}, 2차 reused ${cacheSecond && cacheSecond.reused}/${cacheSecond && cacheSecond.pages}p, 부활 ${cacheRecovered && cacheRecovered.pages}p`);

  // 같은 Runtime+directory의 여러 facade는 coordination domain 하나다. writer가 X 주소를
  // 기억한 뒤 collector가 X를 HEAD/PREV 밖으로 밀고 pack하면 X 전용 blob이 사라진다. 현재
  // 저장소를 확인하지 않고 writer cache를 단언하던 코드는 성공한 HEAD가 없는 blob을 가리켰고,
  // recover가 PREV로 후퇴했다. 이 수명주기는 확률 없이 그 결함을 재현한 음성 시험의 정식 승격이다.
  const coordName = "pyprocGateJournalCoordination";
  try { await jRootDir.removeEntry(coordName, { recursive: true }); } catch (e) {}
  const coordDir = await jRootDir.getDirectoryHandle(coordName, { create: true });
  const coordWriter = rt.enableJournal({ dir: coordDir, reactive, includeHome: false });
  const coordCollector = rt.enableJournal({ dir: coordDir, reactive, includeHome: false });
  const coordBase = reactive.checkpoint();
  rt.run("journalCoordPayload = 'coord-state-' * 100000");
  const coordState = reactive.checkpoint();
  const coordFirst = await coordWriter.commit();
  reactive.restoreLive(coordBase.index);
  rt.run("journalCoordReplacement = 'a'"); await coordCollector.commit();
  rt.run("journalCoordReplacement = 'b'"); await coordCollector.commit();
  const coordPack = await coordCollector.pack();
  reactive.restoreLive(coordState.index);
  const coordStaleCommit = await coordWriter.commit();
  rt.run("journalCoordPayload = 'clobbered'");
  const coordRecovered = await coordCollector.recover();
  const coordValue = rt.run("globals().get('journalCoordPayload', None)");
  check("journal coordination: 다른 facade의 pack 뒤 stale 주소를 HEAD에 싣지 않는다",
    !!coordFirst && !!coordPack && !!coordStaleCommit && !!coordRecovered
    && coordRecovered.fallback !== true && coordValue === "coord-state-".repeat(100000),
    `pack ${coordPack && coordPack.packed}, fallback=${coordRecovered && coordRecovered.fallback}, value=${typeof coordValue === "string" ? coordValue.length : "none"}`);

  // delete도 coordination domain 전체의 storage handle 수명을 올린다. 삭제하지 않은 facade가
  // 예전 blob/state handle로 유령 쓰기를 하지 않고 새 저장소를 만들어야 한다.
  await coordCollector.delete();
  rt.run("journalCoordReborn = 17");
  const coordReborn = await coordWriter.commit();
  rt.run("journalCoordReborn = 999");
  const coordRebornRecovered = await coordCollector.recover();
  check("journal coordination: 다른 facade의 delete 뒤 새 저장소로 재커밋한다",
    !!coordReborn && !!coordRebornRecovered && rt.run("journalCoordReborn") === 17,
    `wrote ${coordReborn && coordReborn.wrote}, recovered ${coordRebornRecovered && coordRebornRecovered.pages}p`);
  await jRootDir.removeEntry(coordName, { recursive: true });

  // pack/prune: loose CAS를 pack 파일 1개로 묶고도 recover가 성립하는가. 이 경로는 그동안
  // 자동 게이트가 없었고 수동 probe(journalPackProbe)로만 검증됐다. pack은 blob을 옮기는
  // 작업이라 조용히 틀리면 "복구는 되는데 내용이 다르다"가 된다.
  const packed = await gj.pack();
  const prunedAfterPack = await gj.prune();
  const packDir = await jDir.getDirectoryHandle("pack");
  let packFiles = 0;
  for await (const name of packDir.keys()) packFiles++;
  const packIndex = JSON.parse(await (await (await jDir.getFileHandle("PACKS.json")).getFile()).text());
  check("journal pack: live blob을 pack 1개로 묶고 loose를 비운다",
    packed && packed.packed > 0 && packed.looseRemoved > 0 && packFiles === 1
    && packIndex.packs.length === 1 && Object.keys(packIndex.packs[0].blobs).length === packed.packed,
    `live ${packed && packed.liveKeys}p, ${packed && packed.mb}MB, loose 정리 ${packed && packed.looseRemoved}, pack 파일 ${packFiles}, prune 후 loose ${prunedAfterPack.looseRemoved}`);
  timings.journalPackMb = packed && packed.mb; // pack이 커지는 회귀는 시간으로 안 보인다

  // pack만 남은 저널에서 복구되는가. loose는 위에서 전부 지워졌으므로 성공하면 pack
  // 경로로만 읽은 것이다. 상태를 먼저 어긋내야 "복구가 실제로 되돌렸다"가 증명된다.
  // 경계 지문(h0)이 맞아야 하므로 같은 커널에서 복구한다(다른 경계는 저널이 거부하는 것이 정답).
  rt.run("jrx = 999");
  const packRecovered = await rt.enableJournal({ dir: jDir, reactive, includeHome: false }).recover();
  check("journal pack: pack만 남은 저널에서 복구(loose 0)", !!packRecovered && rt.run("jrx") === 1,
    `recovered=${!!packRecovered}, 999로 어긋낸 뒤 jrx=${rt.run("jrx")}`);

  // ---- 가지: 이름 있는 내구 분기(만들고 비교하고 채택한다 - merge는 힙 상태에 성립하지 않는다) ----
  // 실 OPFS + 실 힙에서 전 수명주기를 문다. 특히 pack/prune 뒤에도 가지가 살아 있는가가
  // soundness의 핵심이다: live 판정이 가지를 모르면 청소가 살아 있는 실험을 지운다.
  rt.run("jbr = 'base'");
  // 반환값을 판정에 싣는다: commit()은 busy 충돌이면 null을 돌려주고, 그 null을 버리면
  // "HEAD에 jbr이 없다"가 한참 뒤 NameError로 터져 원인 좌표가 사라진다(간헐 실측 2회).
  const brBaseCommit = await gj.commit();
  rt.run("jbr = 'A'");
  const brA = await gj.commitBranch("expA", { note: { attempt: "vectorized" } });
  const headRefAtRecover = await gj._kernel.readRef("HEAD");
  const headAfterBranch = await gj.recover(); // HEAD는 base 그대로여야 한다(가지 커밋은 HEAD 불변)
  const jbrDefined = rt.run("'jbr' in globals()");
  const brResumedAtBase = jbrDefined ? rt.run("jbr") : "(jbr 실종)";
  rt.run("jbr = 'B'");
  const brB = await gj.commitBranch("expB", { note: { attempt: "loop" } });
  const brList = await gj.listBranches();
  check("journal 가지: 두 가지가 HEAD를 움직이지 않고 note와 갈림점을 나른다",
    !!brBaseCommit && !!brA && !!brB && !!headAfterBranch && brResumedAtBase === "base"
    && headRefAtRecover.ref && headRefAtRecover.ref.commit === brBaseCommit.commit
    && brList.length === 2 && brList.map((b) => b.name).join(",") === "expA,expB"
    && brList[0].note.attempt === "vectorized" && brList[0].parents.length === 1,
    `base커밋=${brBaseCommit ? brBaseCommit.commit.slice(7, 19) : "null(busy 충돌)"}, `
    + `HEAD@recover=${headRefAtRecover.ref ? headRefAtRecover.ref.commit.slice(7, 19) : "없음"}, `
    + `jbr=${brResumedAtBase}, 가지=${brList.map((b) => b.name).join("/")}`);
  // 마커: 가지가 있으면 v2(구 pyproc recover는 fail-closed), 전부 지우면 v1로 복원.
  const markerWithBranches = JSON.parse(await (await (await jDir.getFileHandle("journalMarker.json")).getFile()).text());
  // pack + prune 뒤에도 가지 세대가 물질화되는가(live 판정에 가지가 들어 있는가).
  await gj.pack();
  await gj.prune();
  const brRecovered = await gj.recoverBranch("expA");
  const brValueAfterRecover = rt.run("jbr");
  // 채택: 가지 상태가 HEAD가 되고, 채택 커밋의 note와 parents가 "무엇을 택했는가"를 남긴다.
  const brAdopted = await gj.adoptBranch("expB", { note: { reason: "faster on the gate" } });
  const brAdoptedValue = rt.run("jbr");
  const brAdoptedHead = await gj.recover();
  check("journal 가지: pack/prune 생존 + 채택이 HEAD와 provenance를 남긴다",
    markerWithBranches.version === 2 && !!brRecovered && brValueAfterRecover === "A"
    && !!brAdopted && brAdopted.adopted === "expB" && brAdoptedValue === "B"
    && !!brAdoptedHead && rt.run("jbr") === "B",
    `marker v${markerWithBranches.version}, expA 부활 후 ${brValueAfterRecover}, 채택 후 ${brAdoptedValue}`);
  await gj.deleteBranch("expA");
  await gj.deleteBranch("expB");
  const markerAfterDelete = JSON.parse(await (await (await jDir.getFileHandle("journalMarker.json")).getFile()).text());
  const brGone = await gj.listBranches();
  check("journal 가지: 삭제 후 마커가 v1로 돌아와 구 버전 호환이 복원된다",
    markerAfterDelete.version === 1 && brGone.length === 0, `marker v${markerAfterDelete.version}, 가지 ${brGone.length}`);

  // 이정표(어제로 돌아가): HEAD 커밋마다 그날의 auto-<날짜> 가지가 그 커밋을 가리키게 갱신되고
  // (그날의 끝 상태로 수렴), 날짜 수가 keep을 넘으면 가장 오래된 것이 지워진다. 이정표는 ref
  // 파일 하나라 blob 비용이 0이다(내용주소 커밋은 이미 저장소에 있다). 과거 날짜는 벽시계를
  // 못 미니 ref 직접 주입으로 재현한다(트림 법은 이름 사전순 = 시간순만 본다).
  const mj = rt.enableJournal({ dir: jDir, reactive, includeHome: false, milestones: { keep: 2 } });
  rt.run("jms = 1");
  const ms1 = await mj.commit();
  const today = new Date().toISOString().slice(0, 10);
  const msAfterFirst = await mj.listBranches();
  const todayRef = msAfterFirst.find((b) => b.name === `auto-${today}`);
  rt.run("jms = 2");
  const ms2 = await mj.commit();
  const msAfterSecond = await mj.listBranches();
  const todayRef2 = msAfterSecond.find((b) => b.name === `auto-${today}`);
  check("journal 이정표: 그날의 auto 가지가 마지막 커밋으로 수렴한다",
    !!ms1 && !!todayRef && todayRef.commit === ms1.commit
    && !!ms2 && !!todayRef2 && todayRef2.commit === ms2.commit && todayRef2.commit !== todayRef.commit,
    `auto-${today}: ${todayRef && todayRef.commit.slice(0, 18)}.. -> ${todayRef2 && todayRef2.commit.slice(0, 18)}..`);
  // 과거 이정표 둘을 주입하고 커밋하면 keep=2 초과분(가장 오래된 날짜)이 지워진다.
  const mjKernel = mj._kernel;
  await mjKernel.writeRef("branch-auto-2000-01-01", { commit: todayRef2.commit });
  await mjKernel.writeRef("branch-auto-2000-01-02", { commit: todayRef2.commit });
  rt.run("jms = 3");
  await mj.commit();
  const msNames = (await mj.listBranches()).map((b) => b.name);
  const msRestored = await mj.recoverBranch(`auto-${today}`);
  check("journal 이정표: keep 초과분 트림 + 이정표로 부활",
    msNames.join(",") === `auto-2000-01-02,auto-${today}` && !!msRestored && rt.run("jms") === 3,
    `가지=${msNames.join("/")}, 부활 후 jms=${rt.run("jms")}`);
  for (const name of msNames) await mj.deleteBranch(name);
  // 내구성의 전제가 보이는가. 커밋이 성공해도 브라우저가 저장소를 축출하면 다음 부팅이 첫
  // 부팅이 된다. 그 위험을 소비자가 볼 수 없으면 "내구"는 확인 불가능한 주장이다: 승인 여부를
  // 값으로 드러내고, 요청 자체가 불가능한 환경도 승인되지 않은 것과 같게 다룬다.
  check("저널이 지속 스토리지 승인 여부를 값으로 드러낸다",
    typeof gj.persistentStorage === "boolean" || gj.persistentStorage === null,
    `persistentStorage=${gj.persistentStorage}`);
  await jRootDir.removeEntry("pyprocGateJournal", { recursive: true });

  // 세대 사이드카: 소비자 payload가 힙과 **같은 세대**에 실려 함께 부활한다. 정확히 한 번의
  // 수렴이 이 사실 위에 선다(kernelElection의 결과 기록이 이 자리를 쓴다): 결과를 세대 밖에
  // 두면 승계자가 힙에 없는 효과의 결과를 답할 수 있다. 그래서 "같은 세대"가 계약이다.
  {
    const sRootDir = await navigator.storage.getDirectory();
    const sDirJ = await sRootDir.getDirectoryHandle("pyprocGateSidecar", { create: true });
    const encoder = new TextEncoder();
    let carried = null;
    const sidecar = (payload) => ({
      id: "outcomes",
      collect: () => (payload ? encoder.encode(payload) : null),
      apply: (bytes) => { carried = bytes ? new TextDecoder().decode(bytes) : null; },
    });
    rt.run("sidecarMark = 11");
    const writer = rt.enableJournal({ dir: sDirJ, reactive, includeHome: false, sidecar: sidecar("outcome-A") });
    await writer.commit();
    rt.run("sidecarMark = 22"); // 힙을 어긋내야 "복구가 되돌렸다"가 증명된다
    const recovered = await rt.enableJournal({ dir: sDirJ, reactive, includeHome: false, sidecar: sidecar(null) }).recover();
    check("세대 사이드카: 소비자 payload가 힙과 같은 세대로 함께 부활한다",
      !!recovered && rt.run("sidecarMark") === 11 && carried === "outcome-A",
      `heap=${rt.run("sidecarMark")}, sidecar=${carried}`);
    await sRootDir.removeEntry("pyprocGateSidecar", { recursive: true });
  }

  // state-kernel 3단계(저널 재기초) 게이트 3종.
  {
    const { PAGE_SIZE } = await import("../../src/state/index.js"); // pyproc/history subpath 실물
    const hexOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    // (1) 동일 상태 재커밋은 wrote 0: 커밋 빈도-쓰기량 법칙(churnProbe)이 커널 경로에서 보존된다.
    try { await jRootDir.removeEntry("pyprocGateJournal3", { recursive: true }); } catch (e) {}
    const j3Dir = await jRootDir.getDirectoryHandle("pyprocGateJournal3", { create: true });
    const j3 = rt.enableJournal({ dir: j3Dir, reactive, includeHome: false });
    rt.run("j3x = 41");
    const c1 = await j3.commit();
    const c2 = await j3.commit(); // 사이에 실행 0 = 페이지 전량 dedupe
    check("journal 재기초: 동일 상태 재커밋 wrote 0(내용주소 dedupe, 비용 법칙 보존)",
      c1.wrote > 0 && c2.wrote === 0 && c2.pages === c1.pages, `c1 ${c1.pages}p/${c1.wrote}w -> c2 ${c2.pages}p/${c2.wrote}w`);
    await jRootDir.removeEntry("pyprocGateJournal3", { recursive: true });

    // (2) 구 포맷(루트 HEAD.json v2 + blob CAS) recover 호환 + 첫 커밋의 커널 포맷 이관.
    // 재기초 후 구 writer는 없으므로 fixture를 직접 쓴다(포맷 문면은 이관 전 커밋 e5783a3 시점의 실물).
    try { await jRootDir.removeEntry("pyprocGateJournalLegacy", { recursive: true }); } catch (e) {}
    const legacyDir = await jRootDir.getDirectoryHandle("pyprocGateJournalLegacy", { create: true });
    rt.run("jlx = 7");
    reactive.checkpoint();
    const ld = reactive.collectDelta(0, reactive.liveIdx, { pack: false });
    const legacyBlobDir = await legacyDir.getDirectoryHandle("blob", { create: true });
    const legacyPages = {};
    for (const p of ld.pages) {
      const bytes = rt.memory.slicePage(p);
      const key = await hexOf(bytes);
      if (!(p in legacyPages)) {
        const bf = await legacyBlobDir.getFileHandle(key, { create: true });
        const bw = await bf.createWritable(); await bw.write(bytes); await bw.close();
      }
      legacyPages[p] = key;
    }
    const h0Arr = reactive.hashes[0];
    const legacyHead = {
      version: 2,
      h0: await hexOf(new Uint8Array(h0Arr.buffer, h0Arr.byteOffset, h0Arr.byteLength)),
      pages: legacyPages, sp: ld.sp, heapLen: ld.heapLen, committedAt: "legacy-fixture",
    };
    const lhf = await legacyDir.getFileHandle("HEAD.json", { create: true });
    const lhw = await lhf.createWritable(); await lhw.write(JSON.stringify(legacyHead)); await lhw.close();
    rt.run("jlx = 999"); // 어긋내야 "복구가 실제로 되돌렸다"가 증명된다
    const lj = rt.enableJournal({ dir: legacyDir, reactive, includeHome: false });
    const lr = await lj.recover();
    check("journal 재기초: 구 포맷(루트 HEAD.json v2) recover 호환", !!lr && rt.run("jlx") === 7, `${lr && lr.pages}p, committedAt=${lr && lr.committedAt}`);
    // pack/prune의 live 판정은 커널 세대와 구 세대의 **합집합**이어야 한다. legacy 갈래가 빠지면
    // 아직 이관 안 된 저널에서 살아 있는 blob을 청소가 지운다(데이터 유실이고 조용하다).
    // 이관 커밋 전에 prune을 돌려 그 합집합을 증명한다.
    const legacyPruned = await lj.prune();
    rt.run("jlx = 111"); // 어긋내야 재복구가 실제로 되돌렸다는 것이 증명된다
    const afterPrune = await rt.enableJournal({ dir: legacyDir, reactive, includeHome: false }).recover();
    check("journal prune: 이관 전 구 세대 blob을 live로 지킨다",
      !!afterPrune && rt.run("jlx") === 7,
      `live ${legacyPruned.liveKeys}, loose 삭제 ${legacyPruned.looseRemoved}, 재복구 ${afterPrune && afterPrune.pages}p`);
    const mig = await lj.commit();
    let kernelRefExists = false;
    try { await (await legacyDir.getDirectoryHandle("state")).getFileHandle("HEAD.json"); kernelRefExists = true; } catch (e) {}
    let legacyRefGone = true;
    try { await legacyDir.getFileHandle("HEAD.json"); legacyRefGone = false; } catch (e) {}
    rt.run("jlx = 555");
    const rr = await rt.enableJournal({ dir: legacyDir, reactive, includeHome: false }).recover();
    check("journal 재기초: 첫 커밋의 커널 이관(구 ref 소멸, 공유 CAS dedupe) + 재복구",
      kernelRefExists && legacyRefGone && !!rr && rt.run("jlx") === 7, `이관 커밋 wrote ${mig.wrote}(공유 CAS), 재복구 ${rr && rr.pages}p`);
    await jRootDir.removeEntry("pyprocGateJournalLegacy", { recursive: true });

    // (3) 커널 포맷의 h0 불일치 = PREV 후퇴 없이 즉시 PYPROC_REPLAY_MISMATCH.
    try { await jRootDir.removeEntry("pyprocGateJournalH0", { recursive: true }); } catch (e) {}
    const h0Dir = await jRootDir.getDirectoryHandle("pyprocGateJournalH0", { create: true });
    const { JournalKernelStore } = await import("../../src/capabilities/journal/journalKernelStore.js");
    const { JournalBlobStore } = await import("../../src/capabilities/journal/journalBlobStore.js");
    const { commitState } = await import("../../src/state/refProtocol.js");
    const wrongStore = new JournalKernelStore(h0Dir, new JournalBlobStore(h0Dir));
    await commitState(crypto, wrongStore, {
      pages: [[0, rt.memory.slicePage(0)]], pageSize: PAGE_SIZE,
      heapLen: rt.memory.byteLength(), sp: 0, env: { h0: "deadbeef" },
    });
    let h0Code = "";
    try { await rt.enableJournal({ dir: h0Dir, reactive, includeHome: false }).recover(); } catch (e) { h0Code = e.code; }
    check("journal 재기초: 커널 포맷 h0 불일치 즉시 예외", h0Code === "PYPROC_REPLAY_MISMATCH", h0Code);
    await jRootDir.removeEntry("pyprocGateJournalH0", { recursive: true });
  }

  // OPFS eviction sentinel: marker 없는 빈 디렉터리만 첫 부팅이다. accepted commit 뒤 marker가
  // 남았는데 backing refs가 사라졌다면 새 머신으로 조용히 시작하지 않는다.
  {
    const clean = async (name) => { try { await jRootDir.removeEntry(name, { recursive: true }); } catch (e) {} };
    const dirOf = async (name) => {
      await clean(name);
      return jRootDir.getDirectoryHandle(name, { create: true });
    };

    const freshName = "pyprocGateJournalFresh";
    const freshDir = await dirOf(freshName);
    const fresh = await rt.enableJournal({ dir: freshDir, reactive, includeHome: false }).recover();
    check("journal eviction: marker와 refs가 없는 디렉터리만 fresh boot", fresh === null);
    await clean(freshName);

    const evictedName = "pyprocGateJournalEvicted";
    const evictedDir = await dirOf(evictedName);
    rt.run("journalEvictionMark = 1");
    await rt.enableJournal({ dir: evictedDir, reactive, includeHome: false }).commit();
    await evictedDir.removeEntry("state", { recursive: true });
    for (const name of ["blob", "pack"]) { try { await evictedDir.removeEntry(name, { recursive: true }); } catch (e) {} }
    try { await evictedDir.removeEntry("PACKS.json"); } catch (e) {}
    let evictedCode = null;
    try { await rt.enableJournal({ dir: evictedDir, reactive, includeHome: false }).recover(); }
    catch (e) { evictedCode = e.code; }
    check("journal eviction: committed marker만 남고 HEAD/PREV 없음은 fail-closed", evictedCode === "PYPROC_JOURNAL_EVICTED", evictedCode);
    await clean(evictedName);

    const fallbackName = "pyprocGateJournalMarkerFallback";
    const fallbackDir = await dirOf(fallbackName);
    const fallbackJournal = rt.enableJournal({ dir: fallbackDir, reactive, includeHome: false });
    rt.run("journalFallbackMark = 1");
    await fallbackJournal.commit();
    rt.run("journalFallbackMark = 2");
    await fallbackJournal.commit();
    const fallbackState = await fallbackDir.getDirectoryHandle("state");
    const corruptHead = await fallbackState.getFileHandle("HEAD.json");
    const corruptWriter = await corruptHead.createWritable();
    await corruptWriter.write("{"); await corruptWriter.close();
    rt.run("journalFallbackMark = 9");
    const fallbackRecovered = await rt.enableJournal({ dir: fallbackDir, reactive, includeHome: false }).recover();
    check("journal eviction: marker 아래 corrupt HEAD는 PREV fallback", fallbackRecovered?.fallback === true && rt.run("journalFallbackMark") === 1);
    await fallbackState.removeEntry("PREV.json");
    let corruptCode = null;
    try { await rt.enableJournal({ dir: fallbackDir, reactive, includeHome: false }).recover(); }
    catch (e) { corruptCode = e.code; }
    check("journal eviction: corrupt HEAD와 PREV 없음은 corruption", corruptCode === "PYPROC_JOURNAL_CORRUPT", corruptCode);
    await clean(fallbackName);

    const deletedName = "pyprocGateJournalDeleted";
    const deletedDir = await dirOf(deletedName);
    rt.run("journalDeletedMark = 1");
    await pm.history.commit({ dir: deletedDir, includeHome: false });
    const deleted = await pm.history.delete({ dir: deletedDir, includeHome: false });
    const tombstone = JSON.parse(await (await (await deletedDir.getFileHandle("journalMarker.json")).getFile()).text());
    const deletedRecovered = await rt.enableJournal({ dir: deletedDir, reactive, includeHome: false }).recover();
    check("journal eviction: explicit delete는 tombstone 뒤 intentional absence", deleted.deleted === true && tombstone.state === "deleted" && deletedRecovered === null);
    // delete는 backing store를 통째로 지운다. 캐시된 디렉터리 핸들을 그대로 재사용하면 다음
    // 커밋이 삭제된 디렉터리에 쓴다(유령 쓰기: 성공으로 보이는데 바이트가 어디에도 없다).
    // 그래서 delete 뒤 재커밋과 재복구가 성립해야 캐시 무효화가 배선된 것이다.
    rt.run("journalDeletedMark = 2");
    const reborn = await pm.history.commit({ dir: deletedDir, includeHome: false });
    rt.run("journalDeletedMark = 999");
    const rebornRecovered = await rt.enableJournal({ dir: deletedDir, reactive, includeHome: false }).recover();
    check("journal eviction: delete 뒤 재커밋이 새 저장소에 실제로 쓴다",
      !!reborn && !!rebornRecovered && rt.run("journalDeletedMark") === 2,
      `재커밋 wrote ${reborn && reborn.wrote}, 재복구 ${rebornRecovered && rebornRecovered.pages}p`);
    await clean(deletedName);

    // dispose는 저널 유휴 감시까지 회수한다. 회수하지 않으면 인터벌이 런타임과 리액티브
    // 컨트롤러를 붙잡은 채 탭 수명 내내 살아 있고, dispose 뒤의 실행이 해제된 컨트롤러를 읽는
    // 커밋을 부른다. 판정은 dispose 뒤에 상태를 변이시켜 보는 것이다: 감시가 살아 있으면
    // 유휴 판정에 걸려 onStatus가 다시 불린다(그 커밋은 실패한다).
    const disposeName = "pyprocGateJournalDispose";
    const disposeDir = await dirOf(disposeName);
    const dm = await boot({ indexURL: INDEX, assetIntegrity });
    let watchEvents = 0;
    dm.history.watch({ dir: disposeDir, includeHome: false, idleMs: 150, onStatus: () => { watchEvents++; } });
    dm.run("disposeWatchMark = 1");
    const watched = await waitFor(() => watchEvents >= 1, 10000);
    await dm.dispose();
    const afterDispose = watchEvents;
    dm.run("disposeWatchMark = 2"); // 회수 안 된 감시라면 이 변이가 유휴 커밋을 다시 부른다
    await new Promise((res) => setTimeout(res, 150 * 6));
    check("dispose: 저널 유휴 감시 회수(dispose 뒤 변이가 커밋을 되살리지 않는다)",
      watched && watchEvents === afterDispose, `dispose 전 ${afterDispose}, 뒤 ${watchEvents - afterDispose}`);
    await clean(disposeName);
  }

  // Layer 1: 빌린 시스템콜 v1 (input 동기 + urllib 실 HTTP)
  const badInheritedRt = new Runtime(rt.raw, rt.indexURL, { assetIntegrity: badAssetIntegrity });
  await badInheritedRt.enableSyscallBridge({ input: () => "bad" }).install();
  let badInheritedDenied = false;
  try { await badInheritedRt.runAsync('import subprocess\nsubprocess.run(["python","-c","print(6*7)"], capture_output=True).stdout'); }
  catch (e) { badInheritedDenied = String(e).includes("assetIntegrity"); }
  check("assetIntegrity: Runtime -> SyscallBridge 상속 거부", badInheritedDenied);
  await rt.enableSyscallBridge({ input: () => "ok" }).install();
  check("syscall input(): 동기 핸들러", rt.run("input()") === "ok");
  const subOut = await rt.runAsync('import subprocess\nsubprocess.run(["python","-c","print(6*7)"], capture_output=True).stdout');
  check("syscall subprocess: assetIntegrity 상속 childWorker", subOut === "42\n");
  // 대상은 첫 바이트가 안정적인 파일이어야 한다(README는 상단이 바뀔 수 있음: 로고 삽입으로 실제 파손된 전례).
  rt.run(`_u = "${location.origin}/index.js"`);
  check("syscall urllib: 실제 HTTP GET", rt.run('import urllib.request\nurllib.request.urlopen(_u).read(8).decode()') === "// pypro");

  // 로드된 엔진 채택 경로: 자체 부팅한 Pyodide를 new Runtime(py)로 감싼다.
  // EngineContract seam 회귀의 상시 가드다. setInterruptBuffer 공개 +
  // getGlobal PyProxy 계약의 실동작은 격리된 전용 probe가 검증한다(runtimeParity/loadedEngineProbe):
  // 공유 rt에 인터럽트 버퍼를 걸거나 PyProxy를 호출하면 이 게이트의 무거운 후속 실행이 방해된다.
  const adopted = new Runtime(rt.raw);
  check("Runtime(py) 로드 엔진 채택 경로", adopted.run("40 + 2") === 42 && adopted.memory.byteLength() > 0
    && typeof rt.setInterruptBuffer === "function");

  // Layer 1: 커널 안 ASGI 서버 (FastAPI, 소켓 0, async def 강제)
  await rt.install("fastapi");
  rt.run("from fastapi import FastAPI\napp = FastAPI()\n@app.get('/ping')\nasync def ping():\n    return {'n': 42}");
  const asgi = rt.enableAsgiServer();
  await asgi.install();
  const resp = await asgi.serve("GET", "/ping");
  check("asgi: GET /ping -> 200 + JSON", resp.status === 200 && JSON.parse(resp.body).n === 42);
  // 동시 요청 계약(2026-07-12 승격): 요청 데이터를 파이썬 전역이 아니라 인자로 넘기므로
  // 겹친 요청이 서로의 값을 덮지 않는다. 커널 페이지 + 서빙된 iframe이 동시에 때리는 실동선.
  rt.run("@app.get('/echo/{v}')\nasync def echo(v: str):\n    import asyncio\n    await asyncio.sleep(0.02)\n    return {'v': v}");
  const conc = await Promise.all(["a", "b", "c", "d"].map((v) => asgi.serve("GET", `/echo/${v}`)));
  check("asgi: 동시 요청이 서로를 덮지 않는다",
    conc.every((r, i) => JSON.parse(r.body).v === ["a", "b", "c", "d"][i]),
    conc.map((r) => JSON.parse(r.body).v).join(""));

  // Layer 1: 서버리스 터미널 (REPL 상태 유지)
  const term = rt.enableTerminal();
  await term.install();
  await term.push("z = 6 * 7");
  const tp = await term.push("print(z)");
  check("terminal: REPL push + 상태 유지", tp.out.trim() === "42" && tp.more === false);

  // 시간여행 REPL: %undo가 직전 완결 문장 이전으로 복원
  const tt = rt.enableTerminal({ timeTravel: true });
  await tt.install();
  await tt.push("q = 1");
  await tt.push("q = 999");
  await tt.push("%undo");
  check("terminal %undo: 시간여행", (await tt.push("print(q)")).out.trim() === "1");
  const mg = await tt.push("%pwd");
  check("terminal 매직: %pwd", mg.out.includes("/") && mg.more === false);

  // porcelain이 두 번째로 하는 일을 자기 어휘로 말하는가. 이것이 핸들에 없어서 두 헤드라인
  // 예제가 모두 2번째 줄에서 탈출구로 나갔다(5차 감사: "요약이 numpy 설치를 말할 수 없으면
  // 미완성 요약이다"). 위임이 실제로 도는지 본다: 설치 후 그 패키지를 import할 수 있어야 한다.
  await pm.loadPackages(["numpy"]);
  check("machine.loadPackages: 핸들 어휘로 패키지가 설치된다",
    pm.run("import numpy\nint(numpy.arange(5).sum())") === 10);
  const dirtyBefore = pm.runtime.execSeq;
  pm.markDirty();
  check("machine.markDirty: 계측 밖 변이 신고가 경계 카운터를 올린다",
    pm.runtime.execSeq > dirtyBefore, `execSeq ${dirtyBefore} -> ${pm.runtime.execSeq}`);

  // 도달 경로가 없던 두 능력: 구현과 문서가 있는데 소비자가 만들 방법이 없었다. 배선을 받은
  // 지금 실제로 도는지 본다(타입 선언만으로는 TypeError를 타입 통과로 위장시킨다).
  const shell = await pm.jobs({ workers: 2 });
  // 실제 실행으로 증명한다: 대화형 레인에 상태가 누적되고 그 값이 돌아오는가.
  await shell.push("jobLane = 6 * 7");
  const shellOut = await shell.push("print(jobLane)");
  check("machine.jobs: 잡 컨트롤이 도달 가능하고 대화형 레인에 상태가 누적된다",
    shellOut.out.trim() === "42", JSON.stringify(shellOut.out));
  check("machine.jobs: 머신당 하나로 memoize(재마운트가 워커를 쌓지 않는다)",
    (await pm.jobs()) === shell);
  const containers = await pm.containers();
  check("machine.containers: 컨테이너 커널이 도달 가능",
    !!containers && typeof containers.spawn === "function" && (await pm.containers()) === containers);

  // 권한 감옥의 협조 티어: 배선(enableJail)이 실제로 초크포인트를 심고 CSP 값을 준다.
  // 배선이 없던 동안 소비 문서는 도달 불가한 클래스를 지시했고 게이트는 그것을 못 봤다.
  const jailed = rt.enableJail({ net: ["api.allowed.test"], clipboard: true });
  check("enableJail: connectSrc는 self + 허용 host",
    jailed.connectSrc === "'self' api.allowed.test" && jailed.permissions.clipboard === true,
    jailed.connectSrc);
  check("enableJail: 파이썬 초크포인트가 허용/차단을 가른다",
    rt.run("import pyprocJail\npyprocJail.net('api.allowed.test')") === true
    && (() => {
      try { rt.run("import pyprocJail\npyprocJail.net('evil.test')"); return false; }
      catch (error) { return /no net permission/.test(String(error)); }
    })()
    && (() => {
      try { rt.run("import pyprocJail\npyprocJail.workers()"); return false; }
      catch (error) { return /no workers permission/.test(String(error)); }
    })());

  // 모든 것은 파일(deviceFs): 장치 쌍방 브리지 + /proc 커널 상태 (정본 실측: deviceFsProbe)
  let devSink = null;
  const dfs = rt.enableDeviceFs({ devices: { "/dev/gateEcho": { read: () => "pong", write: (b) => { devSink = new TextDecoder().decode(b); } } } });
  dfs.install();
  rt.run("open('/dev/gateEcho', 'w').write('gate')");
  check("deviceFs: 파이썬 write -> JS 장치", devSink === "gate");
  check("deviceFs: /proc/meminfo = 실제 힙", rt.run("import json\njson.loads(open('/proc/meminfo').read())['heapBytes']") === rt.memory.byteLength());

  // 3) Layer 2: 프로세스 OS (스냅샷-fork + 진짜 병렬 map)
  const os = new PyProc({ indexURL: INDEX, assetIntegrity });
  t = performance.now();
  const b = await os.boot(2);
  timings.forkBootMs = Math.round(performance.now() - t);
  timings.avgWorkerBootMs = b.avgBootMs;
  check("PyProc.boot(2) forked", b.forked === true && b.workers === 2, `워커 평균 ${b.avgBootMs}ms`);
  check("ps(): 2 프로세스 ready", os.ps().length === 2 && os.ps().every((p) => p.state === "ready"));

  const N = 80000;
  const expected = (N * (N - 1) * (2 * N - 1)) / 6; // sum(i*i for i in range(N))
  const fn = "def _fn(n):\n    return sum(i*i for i in range(n))";
  t = performance.now();
  const par = await os.map(fn, [N, N, N, N]);
  timings.mapParallelMs = Math.round(performance.now() - t);
  check("map: 결과 4개 전부 정확", par.length === 4 && par.every((v) => v === expected), timings.mapParallelMs + "ms");

  t = performance.now();
  // 직렬 기준선: 공개 표면(exec)으로 같은 태스크를 워커 1개에서 순차 실행(벤치 계약 S2의 산출 경로).
  const serialPid = os.ps().find((p) => p.state === "ready").pid;
  const ser = [];
  for (const n of [N, N, N, N]) ser.push(await os.exec(serialPid, fn, n));
  timings.mapSerialMs = Math.round(performance.now() - t);
  timings.speedup = +(timings.mapSerialMs / timings.mapParallelMs).toFixed(2);
  check("직렬 exec 기준선: 병렬과 결과 일치", JSON.stringify(par) === JSON.stringify(ser),
    `직렬 ${timings.mapSerialMs}ms, speedup ${timings.speedup}x (참고치)`);

  // 수명주기: 행 태스크가 유한 시간에 {error}로 수렴 + 행 워커 자동 respawn
  const hang = "def _fn(n):\n    import time\n    time.sleep(999)";
  t = performance.now();
  const tr = await os.map(hang, [0], { taskTimeoutMs: 1500 });
  timings.timeoutConvergeMs = Math.round(performance.now() - t);
  check("map 타임아웃: 행에서 유한 수렴", tr[0] && tr[0].error && tr[0].error.includes("timeout"), timings.timeoutConvergeMs + "ms");
  const after = await os.map(fn, [N]);
  check("타임아웃 후 풀 자동 복구(respawn)", after[0] === expected);
  // 협조적 취소: SIGINT로 busy 루프 회수 + 같은 워커 재사용(respawn 0)
  const lane0 = os.ps().find((p) => p.state === "ready").pid; // 태스크 0은 풀 첫 레인이 집는다
  const busyP = os.map("def _fn(n):\n    while True:\n        pass", [0]);
  setTimeout(() => os.signal(lane0, SIGNAL.INT), 400);
  const ir = await busyP;
  // 시그널 표(정본 실측: runtimeParity/signalTableProbe). SIGINT 외 번호가 파이썬 핸들러를 부른다.
  check("SIGNAL 표 노출", SIGNAL.TERM === 15 && SIGNAL.USR1 === 10);
  check("signal(pid, SIGINT): 수렴 + 워커 생존", ir[0] && ir[0].error && ir[0].error.includes("KeyboardInterrupt")
    && (await os.map(fn, [1000]))[0] === (1000 * 999 * 1999) / 6);

  const victim = os.ps().find((p) => p.state === "ready").pid;
  check("kill(pid): dead 전이", os.kill(victim) === true && os.ps().find((p) => p.pid === victim).state === "dead");

  // 오류 계약: 워커 파이썬 예외의 code/pyExcType이 postMessage 경계를 건너온다
  const alive = os.ps().find((p) => p.state === "ready").pid;
  let taskErr = null;
  try { await os.exec(alive, "def _fn(arg):\n    raise ValueError('boom')"); } catch (e) { taskErr = e; }
  check("PyProcError: 워커 예외 코드 + pyExcType 경계 통과",
    !!taskErr && taskErr.code === "PYPROC_WORKER_TASK_ERROR" && taskErr.context && taskErr.context.pyExcType === "ValueError",
    taskErr ? `${taskErr.code}/${taskErr.context && taskErr.context.pyExcType}` : "no error");
  let deadErr = null;
  try { await os.exec(victim, "def _fn(arg):\n    return 1"); } catch (e) { deadErr = e; }
  check("PyProcError: dead pid 거부 코드", !!deadErr && deadErr.code === "PYPROC_PROCESS_UNAVAILABLE", deadErr && deadErr.code);

  // proc 풀 memoize 계약: 원시값은 값으로, 객체는 참조 동일성으로 구분한다. 후자가 계약인
  // 이유는 객체 옵션에 함수가 들어갈 수 있어 구조 비교가 일반적으로 성립하지 않기 때문이다.
  // 그 사실이 게이트로 굳어야 소비자가 "같은 모양이면 같은 풀"이라고 잘못 기대하지 않는다.
  {
    const memoMachine = await boot({ indexURL: INDEX, assetIntegrity });
    const poolA = await memoMachine.proc({ lanes: 1 });
    const poolB = await memoMachine.proc({ lanes: 1 });
    const sharedReplay = { seed: 1 };
    const jobsA = await memoMachine.jobs({ workers: 2, replay: sharedReplay });
    const jobsB = await memoMachine.jobs({ workers: 2, replay: sharedReplay });
    check("proc 풀 memoize: 원시값 옵션은 값으로, 객체 옵션은 참조로 구분한다",
      poolA === poolB && jobsA === jobsB,
      `원시값 재사용 ${poolA === poolB}, 같은 참조 재사용 ${jobsA === jobsB}`);
    await memoMachine.dispose();
  }

  const snapshotBeforeTerminate = os._snapshot; // 내부 필드가 이 회수의 유일한 관측점이다
  os.terminate();
  check("terminate: 프로세스 테이블 비움", os.ps().length === 0);
  // 회수 단정: 워커만 죽이고 스냅샷 SAB를 남기면 부팅 스냅샷 전체가 풀 핸들 수명 내내 산다.
  // 이 풀은 스냅샷 부팅이 아닐 수 있으므로 "있었다면 놓였는가"로 판정한다.
  check("terminate: 스냅샷 SAB 회수", os._snapshot === null,
    snapshotBeforeTerminate ? `${Math.round(snapshotBeforeTerminate.byteLength / 1048576)}MB 반환` : "스냅샷 없는 풀");

  // 풀 소진 계약(api.md: 전 레인 사망 시 {error}로 resolve, silent undefined 없음). 구현은
  // 있었지만 증거가 0이었다: 이 계약이 깨지면 소비자에게 undefined가 새고 원인이 안 보인다.
  {
    const dos = new PyProc({ indexURL: INDEX });
    await dos.boot(2, false);
    for (const p of dos.ps()) dos.kill(p.pid);
    const drained = await dos.map(fn, [1000, 2000]);
    check("풀 소진: 전 레인 사망 후 map은 {error}로 수렴(undefined 0)",
      drained.length === 2 && drained.every((r) => r && typeof r === "object" && typeof r.error === "string")
      && drained.every((r) => r.error.includes("pool exhausted")),
      JSON.stringify(drained).slice(0, 110));
    dos.terminate();
  }

  // mid-flight 워커 사망: 발사된 태스크가 유한 시간에 {error}로 수렴하고 hang하지 않는다.
  // 컨테이너에는 이 계약이 있었지만 풀에는 없었다(감사 지적: 실패 모드 공백).
  {
    const mos = new PyProc({ indexURL: INDEX });
    await mos.boot(2, false);
    const victimPid = mos.ps()[0].pid;
    const inflight = mos.map("def _fn(n):\n    while True:\n        pass", [0]);
    setTimeout(() => mos.kill(victimPid), 300);
    const settled = await Promise.race([
      inflight,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 15000)),
    ]);
    check("mid-flight 워커 사망: hang 없이 {error} 수렴",
      settled !== "timeout" && Array.isArray(settled) && settled[0] && typeof settled[0].error === "string",
      settled === "timeout" ? "15s 내 미수렴" : JSON.stringify(settled).slice(0, 90));
    mos.terminate();
  }

  // fork(2): 살아있는 프로세스의 상태 복제. 리플레이 풀(대칭 커널)에서만 성립 = 계약.
  // 두 워커에 서로 다른 상태를 만든 뒤(더러운 dst) fork하므로, 자식이 정확히
  // "경계 + 부모 델타"가 되는지(dst 잔재 정화)까지 상시 검증한다. 마커 배타 검사는
  // 스케줄 배정을 몰라도 성립한다: 혼합 상태면 only0/only1이 둘 다 남는다.
  const fos = new PyProc({ replay: {}, indexURL: INDEX });
  await fos.boot(2, false); // 리플레이 부팅(스냅샷 아님 = 바이트 동일한 경계)
  const [p1, p2] = fos.ps().map((p) => p.pid);
  // 태스크 2개 = 워커 2개가 각각 하나씩(레인당 1개) -> 양쪽에 서로 다른 사용자 상태.
  await fos.map("def _fn(a):\n    global tag, payload\n    tag = 'proc'\n    payload = bytearray(b'X' * (300000 + a * 50000))\n    globals()['only%d' % a] = 1\n    return 1", [0, 1]);
  const fk = await fos.fork(p1, p2).catch((e) => ({ error: String(e) }));
  check("fork(2): 살아있는 상태 복제(델타 수확 + 적용)", !fk.error && fk.pages > 0 && fk.reverted > 0,
    fk.error ? String(fk.error).slice(0, 90) : `${fk.pages}p/${fk.mb}MB, 수확 ${fk.harvestMs}ms + 적용 ${fk.applyMs}ms, 정화 ${fk.reverted}p`);
  timings.forkDeltaMb = fk.mb; // 델타가 조용히 부는 회귀는 시간 예산에 안 걸린다
  check("fork(2): 계보 기록(parentPid)", fos.ps().find((p) => p.pid === p2).parentPid === p1);
  fos.kill(p1); // 남은 ready = p2(자식)만 -> 다음 map은 반드시 자식에서 돈다
  const [forkState] = await fos.map("def _fn(a):\n    src = 1 if 'only1' in globals() else 0\n    clean = ('only0' in globals()) != ('only1' in globals())\n    return [clean, tag, len(payload) - 50000 * src]", [0]);
  check("fork(2): 더러운 dst 정화(부모+자식 혼합 상태 없음)", !!forkState && forkState[0] === true && forkState[1] === "proc" && forkState[2] === 300000,
    JSON.stringify(forkState));
  fos.terminate();

  // fork 성장 비대칭: 부모가 경계 이후 힙을 키운 채로 fork하면 자식은 **먼저 부모 길이까지
  // 자란 뒤** 델타를 받아야 한다. 자식이 안 자라면 델타가 힙 밖을 가리키고, 그 경로는
  // PYPROC_INPUT_INVALID로 죽거나 조용히 잘린 상태를 낳는다(둘 다 조용한 오염 후보다).
  // 이 경로는 worker.js applyDelta의 growHeapTo 한 줄이 전부이고 지금까지 수동 probe로만
  // 확인돼 왔다: 성장은 힙 레이아웃을 바꾸므로 회귀가 나면 델타 계약 전체가 흔들린다.
  {
    const gos = new PyProc({ replay: {}, indexURL: INDEX });
    await gos.boot(2, false);
    const [gp, gc] = gos.ps().map((p) => p.pid);
    // 부모만 크게 키운다(자식은 경계 그대로) = 비대칭. 32MB는 기본 힙을 확실히 넘긴다.
    await gos.repl(gp, "grownPool = bytearray(32 * 1024 * 1024)\ngrownPool[16 * 1024 * 1024] = 42\ngrownMark = 'parent'");
    const gfk = await gos.fork(gp, gc).catch((e) => ({ error: e.code || String(e) }));
    check("fork: 성장 비대칭(자식이 부모 길이까지 자란 뒤 델타를 받는다)",
      !gfk.error && gfk.pages > 0,
      gfk.error ? String(gfk.error).slice(0, 90) : `${gfk.pages}p/${gfk.mb}MB, 정화 ${gfk.reverted}p`);
    // 성장 범위 **안쪽**의 바이트까지 옮겨왔는지 본다. 길이만 맞고 내용이 0이면 델타가
    // 성장분을 안 실은 것이고, 그것이 정확히 이 게이트가 잡으려는 조용한 손실이다.
    // repl은 repr 문자열을 돌려준다(map의 값 계약과 다르다). 성장 범위 안쪽 바이트가 42로
    // 살아 있어야 한다: 길이만 맞고 내용이 0이면 델타가 성장분을 안 실은 것이다.
    const grownState = (await gos.repl(gc, "[grownMark, len(grownPool), grownPool[16 * 1024 * 1024]]")).value;
    check("fork: 성장분의 바이트가 자식에 그대로 도착",
      grownState === `['parent', ${32 * 1024 * 1024}, 42]`,
      String(grownState));
    gos.terminate();
  }

  // forkMany(투기적 탐색 프리미티브, 2026-07-17 승격): 부모 델타를 한 번만 수확해 N 레인에
  // 방송한다. 이득의 근원(수확 1회)과 격리(레인별 상태 + 본선 불변)를 상시 검증한다.
  // 승격 근거 실측: 방송 4.05배, 4-후보 병렬 탐색 5.2배(측정 과정은 git 이력).
  const fanOs = new PyProc({ replay: {}, indexURL: INDEX });
  await fanOs.boot(3, false); // 본선 1 + 후보 2
  const [fanMain, fanA, fanB] = fanOs.ps().map((p) => p.pid);
  await fanOs.repl(fanMain, "prepared = [i * i for i in range(50000)]");
  await fanOs.repl(fanMain, "base = sum(prepared)");
  await fanOs.repl(fanMain, "mine = None");
  const fanned = await fanOs.forkMany(fanMain, [fanA, fanB]);
  check("forkMany: 수확 1회로 N 레인 팬아웃",
    fanned.lanes.length === 2 && fanned.pages > 0 && typeof fanned.harvestMs === "number"
      && fanned.lanes.every((lane) => lane.reverted >= 0 && typeof lane.applyMs === "number"),
    `${fanned.pages}p/${fanned.mb}MB, 수확 ${fanned.harvestMs}ms 1회, 적용 ${fanned.lanes.map((l) => l.applyMs).join("/")}ms`);
  const fanMainBase = (await fanOs.repl(fanMain, "base")).value;
  const fanBase = await Promise.all([fanA, fanB].map((pid) => fanOs.repl(pid, "base")));
  const fanPrepared = fanBase.every((r) => r.value === fanMainBase);
  await Promise.all([fanOs.repl(fanA, "mine = 'A'"), fanOs.repl(fanB, "mine = 'B'")]);
  const fanMarks = (await Promise.all([fanA, fanB].map((pid) => fanOs.repl(pid, "mine")))).map((r) => r.value).join(",");
  const fanMainMine = (await fanOs.repl(fanMain, "mine")).value; // 파이썬 None -> undefined(toJs 계약)
  check("forkMany: 레인 격리 + 본선 불변",
    fanPrepared && fanMarks === "'A','B'" && fanMainMine == null, `레인 ${fanMarks}, 본선 mine=${fanMainMine}`);
  let fanDenied = "";
  try { await fanOs.forkMany(fanMain, [fanA, fanA]); } catch (e) { fanDenied = e.code; }
  check("forkMany: 중복 dst 거부", fanDenied === "PYPROC_INPUT_INVALID", fanDenied);
  await fanOs.fork(fanB, fanMain); // 승계 = 역방향 fork 1회(반환 계약 불변 = 위임 증거)
  check("forkMany 위에서 승계: 본선이 승자 상태와 일치", (await fanOs.repl(fanMain, "mine")).value === "'B'");
  fanOs.terminate();

  // RPC 계약(2026-07-12 승격): 같은 인스턴스에서 map 3개가 동시에 돌아도 응답이 섞이지
  // 않는다. reqId 상관 이전에는 taskId가 호출마다 0부터라 교차 수신이 가능했다.
  const cos = new PyProc({ indexURL: INDEX });
  await cos.boot(2);
  const idFn = "def _fn(a):\n    import time\n    time.sleep(0.05 * (a % 3))\n    return a * 10";
  const [r1, r2, r3] = await Promise.all([
    cos.map(idFn, [1, 2, 3]),
    cos.map(idFn, [4, 5]),
    cos.map(idFn, [6, 7, 8, 9]),
  ]);
  check("RPC: 동시 map 3건이 서로의 응답을 먹지 않는다",
    JSON.stringify(r1) === "[10,20,30]" && JSON.stringify(r2) === "[40,50]" && JSON.stringify(r3) === "[60,70,80,90]",
    `${JSON.stringify(r1)} ${JSON.stringify(r2)} ${JSON.stringify(r3)}`);
  // 복제 고유성: 같은 스냅샷에서 태어난 프로세스들의 random 스트림이 갈라져 있어야 한다.
  const rnd = await cos.map("def _fn(a):\n    import random\n    return random.random()", [0, 1]);
  check("복제 고유성: 프로세스마다 random 재시드", rnd[0] !== rnd[1], JSON.stringify(rnd));
  cos.terminate();

  // 잡 컨트롤 강제 회수: 협조 시그널이 통하지 않는 잡(KeyboardInterrupt를 삼키는 루프)을
  // killHard가 워커 교체로 회수하고 레인이 재사용 가능해야 한다.
  const jc = new JobControl({ workers: 2, indexURL: INDEX });
  await jc.boot();
  const spawned = await jc.push("__import__('time').sleep(999) &");
  const hardKilled = await jc.killHard(spawned.job);
  const jcState = jc.jobs().find((j) => j.jobId === spawned.job).state;
  const afterKill = await jc.push("21 * 2 &"); // 교체된 레인이 잡 슬롯으로 재사용되는가
  const afterResult = await jc.fg(afterKill.job);
  check("jobControl.killHard: 행 잡 회수 + 레인 재부팅 재사용",
    hardKilled === true && jcState === "killed" && afterResult && afterResult.value === "42",
    `state ${jcState}, 재사용 결과 ${afterResult && afterResult.value}`);
  jc.terminate();

  // 컨테이너: 사망 즉시 거부(영원 pending 금지) + 중첩 깊이 2 경로 라우팅(run/heapLen/kill)
  const mc = new MachineContainer(rt, { indexURL: INDEX });
  const c1 = await mc.spawn({});
  check("container: 부팅 + run", (await c1.run("11 * 3")) === 33, `boot ${c1.bootMs}ms`);
  const spawnedChild = await mc._callPath(c1.cid, { type: "spawnChild", indexURL: mc._indexURL, manifest: {} });
  const nestedCid = c1.cid + "/" + spawnedChild.childCid;
  const nestedRun = await mc._callPath(nestedCid, { type: "run", code: "7 * 6" });
  const nestedHeap = await mc._callPath(nestedCid, { type: "heap" });
  check("container 중첩(깊이 2): run + heapLen 경로 라우팅",
    nestedRun.result === 42 && nestedHeap.heapLen > 0, `${nestedCid}, heap ${nestedHeap.heapLen}`);
  const nestedKilled = await mc.kill(nestedCid);
  let nestedDeadCode = "";
  try { await mc._callPath(nestedCid, { type: "run", code: "1" }); } catch (e) { nestedDeadCode = e.code; }
  check("container 중첩 kill: 부모 층 라우팅 + 이후 호출 명시 거부",
    nestedKilled === true && (nestedDeadCode === "PYPROC_PROCESS_UNAVAILABLE" || nestedDeadCode === "PYPROC_WORKER_TASK_ERROR"), nestedDeadCode);
  const runPending = c1.run("1 + 1").catch((e) => e); // 사망 직전 발사 -> 크래시 수렴 검사
  mc.kill(c1.cid);
  const crashed = await runPending;
  let topDeadCode = "";
  try { await c1.run("2"); } catch (e) { topDeadCode = e.code; }
  check("container 사망: 대기 요청 즉시 reject + 이후 호출 즉시 거부",
    (crashed === 2 || (crashed && crashed.code === "PYPROC_PROCESS_UNAVAILABLE")) && topDeadCode === "PYPROC_PROCESS_UNAVAILABLE",
    `pending ${crashed && (crashed.code || crashed)}, 이후 ${topDeadCode}`);
  mc.terminate();

  // mapArray(numpy 샤딩)의 런타임 검증은 무게 때문에 전용 probe가 담당한다:
  // tests/attempts/runtimeParity/shardMapProbe.html (4워커 5.28배 실측)

  // wheel OPFS 캐시: 두 번째 커널이 네트워크 0으로 설치(재다운로드 0)
  const wDir = await (await navigator.storage.getDirectory()).getDirectoryHandle("pyprocGateWheels", { create: true });
  await rt.enableWheelCache({ dir: wDir }).install("six");
  const pmW = await boot({ indexURL: INDEX });
  const rtW = pmW.runtime;
  const wc2 = rtW.enableWheelCache({ dir: wDir });
  await wc2.install("six");
  // rt에는 micropip이 이미 있어 six만 캐시됨. 새 커널은 micropip.whl을 miss로 받고
  // six는 캐시에서 서빙되어야 한다(완전한 재다운로드 0은 wheelCacheProbe가 검증).
  check("wheelCache: 캐시 히트 서빙", wc2.hits >= 1 && rtW.run("import six; 1") === 1, `hit ${wc2.hits}, miss ${wc2.misses}`);

  // 셸 %pip (wheelCache 채움 뒤에 실행: 캐시 채움 전제를 건드리지 않는 위치가 계약)
  const pipOut = await tt.push("%pip install six");
  check("terminal %pip: 머신 안 설치", pipOut.more === false && pipOut.out.startsWith("installed:"), pipOut.out.trim());

  // uv 레인 표면 상주 조건(capabilityMatrix Beta): bootEnv 콜드 레인의 최소 실동작을
  // CI 게이트에 둔다. 스냅샷 웜 부팅 실측은 여전히 bootEnvApiProbe 담당(무게).
  const envRt = await bootEnv({ indexURL: INDEX });
  check("bootEnv: 콜드 레인 부팅 + 실행", envRt.run("7 * 3") === 21 && envRt.envBoot.lane === "cold", `lane ${envRt.envBoot.lane}, ${envRt.envBoot.totalMs}ms`);

  // uv 레인: PEP 723 스크립트 자급(runScript) + freeze 락 (실측 정본: envManager 캠페인.
  // bootEnv의 스냅샷 웜 부팅은 무게 때문에 bootEnvApiProbe가 담당한다)
  const scriptOut = await runScript(rtW, [
    "# /// script",
    '# dependencies = ["six"]',
    "# ///",
    "import six",
    "six.__version__",
  ].join("\n"), { wheelDir: wDir });
  check("runScript: PEP 723 의존성 자급 실행", scriptOut.dependencies[0] === "six" && typeof scriptOut.result === "string" && scriptOut.result.length > 0, `six ${scriptOut.result}`);
  const lock = JSON.parse(await rtW.freeze());
  check("freeze: pyodide-lock 형식 + six 포함", !!(lock.packages && lock.packages.six), `packages ${Object.keys(lock.packages || {}).length}개`);
  await (await navigator.storage.getDirectory()).removeEntry("pyprocGateWheels", { recursive: true });

  // 세션 부활(불멸 커널): 결정적 리플레이 + 델타로 다른 커널에서 상태가 산다
  const sDir = await (await navigator.storage.getDirectory()).getDirectoryHandle("pyprocGateSess", { create: true });
  const s1 = await bootSession({ indexURL: INDEX });
  s1.rt.run("k = 4100");
  const sv = await s1.save(sDir, "gate");
  const s2 = await bootSession({ indexURL: INDEX });
  await s2.load(sDir, "gate");
  check("session: 델타로 크로스 커널 부활", s2.rt.run("k + 42") === 4142, `${sv.pages}p, ${sv.mb}MB`);
  timings.sessionDeltaMb = sv.mb; // 사용자가 실제로 내려받는 크기의 대리 지표

  // 알려진 한계(2026-07-31 실측, workerGuest 캠페인 10케이스 이분): **JS 프록시 핸들은 인터프리터
  // 국소 상태라 힙 이미지가 나르지 못한다.** 씨앗이 cp0 이후 프록시를 하나라도 만들면, 그 이미지로
  // 부활한 커널에서는 프록시 호출이 전부 트랩한다(table index is out of bounds). 제거·재컴파일·
  // 재설치 어느 것도 고치지 못하고, 씨앗이 프록시를 안 만들었으면 부활 커널의 프록시는 정상이다.
  // 순수 파이썬은 영향 없다. 이 게이트는 그 한계를 고정한다: **통과하면(트랩이 없으면) 한계가
  // 풀린 것이므로** 계약 실태 표와 snapshotScope 주장을 같은 커밋에서 고쳐야 한다.
  {
    const proxySeed = await bootSession({ indexURL: INDEX });
    proxySeed.rt.setGlobal("probeBridge", () => 7); // cp0 이후 프록시 1개 = 오염 조건 전부
    // 일부러 오염된 이미지를 만드는 자리이므로 명시 승인으로 뜬다(그 승인 경로 자체도 계약이다).
    const proxyImage = await proxySeed.exportImage({ allowHostProxies: true });
    const proxyRevived = await openMachine(proxyImage, { trust: true });
    const plain = proxyRevived.rt.run("sum(range(10))"); // 순수 파이썬은 산다
    // 트랩은 호출이 아니라 **이미지가 나른 프록시를 덮어쓰는 순간**에 난다: 옛 핸들의 파기가
    // 이 인터프리터에 없는 함수 테이블 항목을 가리킨다. 그래서 두 줄을 함께 감싼다.
    let trapped = "";
    try {
      proxyRevived.rt.setGlobal("probeBridge", () => 9);
      proxyRevived.rt.run("probeBridge()");
    } catch (e) { trapped = String(e?.message || e).slice(0, 80); }
    // 아무 예외나 통과시키면 이 검사는 "그날의 사고"를 재는 물건이 된다(감사 지적). 엔진 층
    // 한계의 서명은 함수 테이블 밖 접근이거나 죽은 hiwire 핸들이다: 그 둘만 증거로 인정한다.
    check("알려진 한계: 이미지가 나른 프록시 부기 위에서 프록시 호출은 트랩한다",
      plain === 45 && /table index is out of bounds|hiwire/i.test(trapped),
      trapped ? `plain ${plain}, trap "${trapped}"` : `plain ${plain}, 트랩 없음 = 한계가 풀렸다(문서와 주장 갱신 필요)`);
  }

  // 그 한계를 조용한 트랩이 아니라 **이미지를 뜨는 순간의 거부**로 만든다. 위 probe가 보여주듯
  // 오염은 부활 뒤 한참 있다가 엔진 깊은 곳의 문장으로 나타났고, 그때는 무엇을 고쳐야 하는지가
  // 남지 않는다. 이제 exportImage/save가 힙의 JS 핸들 수를 보고 거부하며, 같은 문맥 전용
  // 이미지라는 판단은 소비자가 명시 승인으로 표현한다.
  {
    const clean = await bootSession({ indexURL: INDEX });
    clean.rt.run("cleanMarker = 1");
    const cleanImage = await clean.exportImage();
    let cleanOk = cleanImage instanceof Blob && cleanImage.size > 0;

    const dirty = await bootSession({ indexURL: INDEX });
    dirty.rt.setGlobal("hostBridge", () => 1); // 값이 아니라 핸들 = 이미지 이식성의 전제 위반
    let refusedCode = "";
    try { await dirty.exportImage(); } catch (e) { refusedCode = e.code || String(e?.message || e); }
    let savedCode = "";
    const refuseDir = await (await navigator.storage.getDirectory()).getDirectoryHandle("pyprocGateRefuse", { create: true });
    try { await dirty.save(refuseDir, "dirty"); } catch (e) { savedCode = e.code || String(e?.message || e); }
    // 승인 탈출구는 실제로 열려야 한다: 닫힌 문은 계약이 아니라 벽이다.
    const acknowledged = await dirty.exportImage({ allowHostProxies: true });
    check("이미지 이식성 전제: 힙에 JS 핸들이 있으면 뜨는 순간 거부(승인 시 통과)",
      cleanOk && refusedCode === "PYPROC_IMAGE_PROXY_SURFACE" && savedCode === "PYPROC_IMAGE_PROXY_SURFACE"
      && acknowledged instanceof Blob && acknowledged.size > 0,
      `clean ${cleanOk}, export ${refusedCode}, save ${savedCode}, 승인 ${acknowledged?.size || 0}B`);
    await (await navigator.storage.getDirectory()).removeEntry("pyprocGateRefuse", { recursive: true });
  }

  // 힙 성장 부활: 저장 커널이 자란 뒤의 상태는, 부활 커널이 먼저 같은 길이까지 힙을
  // 늘려야(heapGrow) 델타가 들어갈 자리가 생긴다. 이 경로는 그동안 자동 게이트가 없었고
  // 수동 probe(largeHeapEnvelope)로만 검증됐다.
  const grow = await bootSession({ indexURL: INDEX });
  const baseLen = grow.rt.memory.byteLength();
  grow.rt.run("big = bytearray(48 * 1024 * 1024)\nbig[0] = 7\ngrown = 909");
  const grownLen = grow.rt.memory.byteLength();
  const gv = await grow.save(sDir, "grown");
  const revive = await bootSession({ indexURL: INDEX });
  const reviveBefore = revive.rt.memory.byteLength();
  await revive.load(sDir, "grown");
  check("session: 자란 힙의 부활(성장 -> 델타 적용)",
    grownLen > baseLen && revive.rt.memory.byteLength() >= grownLen
    && revive.rt.run("grown + len(big) // (1024 * 1024)") === 909 + 48 && revive.rt.run("big[0]") === 7,
    `저장 ${Math.round(baseLen / 1048576)}->${Math.round(grownLen / 1048576)}MB, 부활 ${Math.round(reviveBefore / 1048576)}->${Math.round(revive.rt.memory.byteLength() / 1048576)}MB, 델타 ${gv.mb}MB`);

  const untrustedImg = await s2.exportImage();
  let trustCode = "";
  try { await openMachine(untrustedImg); } catch (e) { trustCode = e.code; }
  check("openMachine: trust 미승인이 코드로 거부", trustCode === "PYPROC_MACHINE_UNTRUSTED", trustCode);

  // state-kernel 4단계(봉투·신뢰 통합) 게이트: bundle 단일 writer + 서명 신뢰 경로 +
  // 변조 거부 + 문서화된 레이아웃 독립 재파싱 + 구 봉투 reader 호환.
  {
    const { createMachineKeyPair, exportMachinePublicKey } = await import("../../src/session/session.js");
    const keyPair = await createMachineKeyPair();
    const signedImg = await s2.exportImage({ signingKey: keyPair });
    const trusted = await openMachine(signedImg, { trustedPublicKeys: [await exportMachinePublicKey(keyPair)] });
    check("bundle: 서명 + 신뢰 공개키로 부활", trusted.rt.run("k + 1") === 4101);
    const otherPair = await createMachineKeyPair();
    let wrongKeyCode = "";
    try { await openMachine(signedImg, { trustedPublicKeys: [await exportMachinePublicKey(otherPair)] }); } catch (e) { wrongKeyCode = e.code; }
    check("bundle: 잘못된 신뢰 키 거부(valid 서명이어도 출처 미승인)", wrongKeyCode === "PYPROC_MACHINE_UNTRUSTED", wrongKeyCode);
    const raw = new Uint8Array(await signedImg.arrayBuffer());
    const tamperedBundle = raw.slice(); tamperedBundle[tamperedBundle.length - 1] ^= 0xff;
    let tamperCode = "";
    try { await openMachine(new Blob([tamperedBundle]), { trust: true }); } catch (e) { tamperCode = e.code; }
    check("bundle: 바이트 변조 즉시 무결성 거부", tamperCode === "PYPROC_MACHINE_INTEGRITY", tamperCode);
    // 문서(docs/reference/bundleFormat.md) 레이아웃대로 디코더 없이 독립 재파싱해 실물과 대조.
    const td = new TextDecoder();
    const BUNDLE_MAGIC = "PYBUNDLE1\n";
    const magicOk = td.decode(raw.subarray(0, BUNDLE_MAGIC.length)) === BUNDLE_MAGIC;
    const envHex = td.decode(raw.subarray(BUNDLE_MAGIC.length, BUNDLE_MAGIC.length + 64));
    const bundleBody = raw.subarray(BUNDLE_MAGIC.length + 64);
    const bodyHex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bundleBody))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const bhl = new DataView(bundleBody.buffer, bundleBody.byteOffset, 4).getUint32(0);
    const bundleHeader = JSON.parse(td.decode(bundleBody.subarray(4, 4 + bhl)));
    const objTotal = bundleHeader.objects.reduce((sum, [, len]) => sum + len, 0);
    check("bundle: 문서화 레이아웃 독립 재파싱 일치",
      magicOk && bodyHex === envHex && bundleHeader.version === 1 && typeof bundleHeader.commit === "string"
      && 4 + bhl + objTotal === bundleBody.length && bundleHeader.tag && bundleHeader.tag.alg === "ECDSA-P256-SHA256",
      `objects ${bundleHeader.objects.length}, body ${bundleBody.length}B`);
    // 구 봉투(PYMACHINE2 v2) reader 호환: writer가 폐지됐으므로 fixture를 손으로 만든다.
    const { MACHINE_MAGIC, toBytesWithHead } = await import("../../src/session/machineImage.js");
    s2.reactive.checkpoint();
    const legacyDelta = s2.reactive.collectDelta(0);
    const legacyMeta = { version: 2, manifest: s2._manifest, pages: legacyDelta.pages, sp: legacyDelta.sp, heapLen: legacyDelta.heapLen, h0: await s2._cp0Digest() };
    const legacyBody = toBytesWithHead(legacyMeta, legacyDelta.bin, new Uint8Array(0));
    const legacyEnvelope = [...new Uint8Array(await crypto.subtle.digest("SHA-256", legacyBody))].map((b) => b.toString(16).padStart(2, "0")).join("");
    // 일몰(2026-08-01): 구 봉투는 더 이상 읽지 않는다. 읽기만 남은 포맷은 계약이 아니라
    // 부채였다(writer가 없으므로 아무도 새로 만들지 않는데 모든 부활 경로가 두 갈래를 감당했다).
    // 거부는 조용하지 않아야 한다: 무엇이었고 무엇을 해야 하는지를 메시지가 말하는지까지 본다.
    let legacyCode = "";
    let legacySaysWhat = false;
    try { await openMachine(new Blob([MACHINE_MAGIC, legacyEnvelope, legacyBody]), { trust: true }); }
    catch (error) { legacyCode = error.code; legacySaysWhat = /re-export|PYMACHINE2/.test(String(error.message || "")); }
    check("bundle: 일몰한 구 봉투는 무엇을 해야 하는지와 함께 거부된다",
      legacyCode === "PYPROC_MACHINE_FORMAT_INVALID" && legacySaysWhat,
      `${legacyCode}, 안내 ${legacySaysWhat}`);
  }
  await (await navigator.storage.getDirectory()).removeEntry("pyprocGateSess", { recursive: true });

  // 워커 호스팅: 결정적 리플레이 세션을 메인 스레드 밖에서 돌린다. workerGuest 캠페인이
  // 실측한 것(2026-07-27): 한 스레드에 게스트를 얹으면 한쪽의 파이썬 루프가 다른 쪽 요청을
  // 통째로 막는다(917ms -> 1ms). 그 해법의 전제가 이 경로였는데, bootSession이 loadPyodide를
  // 전달하지 않아 결정적 부팅 = history/save/export 전부가 워커에 올라가지 못했다.
  //
  // 리플레이 경계(cp0)의 사정 범위는 실측으로 정했다(engineEntryCp0Probe, 2026-07-27):
  //   main+pyodide.mjs == main+script tag != worker+pyodide.mjs
  // 엔진 진입 파일은 cp0을 가르지 않고, **호스트 문맥(window vs worker)이 가른다.** 그래서
  // 결정성은 "같은 매니페스트 + 같은 호스트 문맥" 안에서 성립하는 계약이고, 문맥을 건너는
  // 이미지 이식은 성립하지 않는다. 이 절은 그 두 사실을 다 문다: 문맥 안에서는 이식되고,
  // 문맥을 건너면 조용히 오염되는 대신 h0 불일치로 큰 소리로 거부된다.
  {
    const newSessionWorker = () => {
      const worker = new Worker(new URL("./deterministicSessionWorker.js", import.meta.url), { type: "module" });
      let seq = 0;
      const call = (message, transfer = []) => new Promise((resolve, reject) => {
        const reqId = ++seq;
        const onMessage = (event) => {
          if (event.data?.reqId !== reqId) return;
          worker.removeEventListener("message", onMessage);
          if (event.data.ok) resolve(event.data);
          else reject(new Error(`${event.data.code} ${event.data.message}`));
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ ...message, reqId }, transfer);
      });
      return { worker, call };
    };
    const source = newSessionWorker();
    const target = newSessionWorker();
    try {
      const workerBootStart = performance.now();
      const booted = await source.call({ type: "boot", indexURL: INDEX });
      timings.workerSessionBootMs = Math.round(performance.now() - workerBootStart);
      check("워커 세션: document 없는 워커에서 결정적 부팅(전역 엔진 미오염)",
        booted.hasDocument === false && booted.globalEngine === "undefined" && /^[0-9a-f]{64}$/.test(booted.h0),
        `${timings.workerSessionBootMs}ms, h0 ${booted.h0.slice(0, 12)}..`);
      await source.call({ type: "run", code: "workerState = 7331" });
      const exported = await source.call({ type: "exportImage" });
      // 같은 호스트 문맥 안의 이식: 부활이 성공한다는 것 자체가 두 워커 커널의 cp0이 바이트
      // 단위로 같다는 증거다(openState가 expectH0로 대조하고, 어긋나면 던진다).
      const revived = await target.call({ type: "openImage", indexURL: INDEX, bytes: exported.bytes }, [exported.bytes.buffer]);
      const targetValue = await target.call({ type: "run", code: "workerState + 1" });
      check("워커 세션: 워커가 내보낸 이미지가 다른 워커에서 부활(문맥 안 cp0 동일)",
        targetValue.value === 7332 && revived.h0 === booted.h0,
        `h0 ${revived.h0.slice(0, 12)}.. == ${booted.h0.slice(0, 12)}..`);
      // 문맥을 건너는 이식은 성립하지 않는다: 워커 힙을 window 커널에 덮으면 조용한 오염이
      // 되므로, 부활 경로가 h0 대조로 거부해야 한다. 메인 커널의 cp0은 실제로 다르다(위 실측).
      const mainH0 = await s1._cp0Digest();
      // 앞의 이미지 바이트는 target 워커로 transfer돼 버퍼가 분리됐다. 그래서 다시 내보낸다.
      const crossImage = await source.call({ type: "exportImage" });
      let crossCode = "";
      try { await openMachine(new Blob([crossImage.bytes]), { trust: true }); } catch (e) { crossCode = e.code; }
      check("워커 세션: 문맥을 건너는 이식은 h0 불일치로 거부(조용한 오염 금지)",
        crossCode === "PYPROC_REPLAY_MISMATCH" && booted.h0 !== mainH0,
        `${crossCode}, worker ${booted.h0.slice(0, 8)}.. != main ${mainH0.slice(0, 8)}..`);
    } finally {
      source.worker.terminate();
      target.worker.terminate();
    }
  }

  // state 커널 OPFS 드라이버: 커밋 왕복 + verify-on-read 적발 + PREV 후퇴가 실제 OPFS에서
  // 성립하는지(프로토콜 자체의 음성 시험 전체는 tests/run.mjs [state 커널]이 매 커밋 문다).
  {
    const stateRoot = await navigator.storage.getDirectory();
    try { await stateRoot.removeEntry("pyprocGateState", { recursive: true }); } catch (e) {}
    const stateDir = await stateRoot.getDirectoryHandle("pyprocGateState", { create: true });
    const { OpfsStateStore } = await import("../../src/state/opfsStateStore.js");
    const { commitState, openState } = await import("../../src/state/refProtocol.js");
    const stateStore = new OpfsStateStore(stateDir);
    const kb = (fill) => new Uint8Array(1024).fill(fill);
    await commitState(crypto, stateStore, { pages: [[0, kb(11)], [1, kb(12)]], pageSize: 1024, heapLen: 2048, sp: 0, env: { h0: "gate-h0" } });
    const second = await commitState(crypto, stateStore, { pages: [[0, kb(21)], [1, kb(22)]], pageSize: 1024, heapLen: 2048, sp: 0, env: { h0: "gate-h0" } });
    const openedHead = await openState(crypto, stateStore, { expectH0: "gate-h0" });
    check("state 커널: OPFS 드라이버 커밋 왕복", openedHead.generation === "head" && openedHead.pages.get(0)[0] === 21);
    // HEAD tree의 페이지 blob 파일을 변조 -> verify-on-read 적발 -> PREV 세대로 후퇴.
    const objectsDir = await stateDir.getDirectoryHandle("objects");
    const tamperName = (await openState(crypto, stateStore, {})).tree.pages[0][1].slice(7);
    const tf = await objectsDir.getFileHandle(tamperName);
    const tw = await tf.createWritable(); await tw.write(kb(99)); await tw.close();
    const fell = await openState(crypto, stateStore, { expectH0: "gate-h0" });
    check("state 커널: OPFS 변조 blob 적발 + PREV 후퇴", fell.fallback === true && fell.pages.get(0)[0] === 11, String(fell.headFailure || "").slice(0, 60));
    await stateRoot.removeEntry("pyprocGateState", { recursive: true });

    // 자란 세대의 커밋: 힙이 자라면 다음 세대는 heapLen이 커지고 색인 범위 밖에 새 페이지가
    // 생긴다. 델타만 보는 코드가 성장분을 흘리면 부활한 세대가 "옛 길이 + 새 내용"이 되어
    // 조용히 잘린다. 이 경로는 그동안 게이트가 없었다(성장은 수동 probe로만 봐 왔다).
    // 전용 디렉터리를 쓰는 이유: 같은 store에 세대를 더하면 위 PREV 후퇴 검사의 PREV가 바뀐다.
    try { await stateRoot.removeEntry("pyprocGateGrow", { recursive: true }); } catch (e) {}
    const growDir = await stateRoot.getDirectoryHandle("pyprocGateGrow", { create: true });
    const growStore = new OpfsStateStore(growDir);
    // 세대는 델타가 아니라 완전한 page table이다(commitState 계약). 그래서 성장 세대는 구
    // 페이지를 함께 실어야 하고, 그 구 페이지는 내용 주소가 같으므로 한 바이트도 다시 쓰지
    // 않아야 한다. 두 사실을 한 검사로 문다: 성장분이 살아 있고, 무변경분은 dedup된다.
    await commitState(crypto, growStore, { pages: [[0, kb(11)], [1, kb(12)]], pageSize: 1024, heapLen: 2048, sp: 0, env: { h0: "grow-h0" } });
    const grownCommit = await commitState(crypto, growStore, {
      pages: [[0, kb(11)], [1, kb(12)], [2, kb(31)], [3, kb(32)]],
      pageSize: 1024, heapLen: 4096, sp: 16, env: { h0: "grow-h0" },
    });
    const grown = await openState(crypto, growStore, { expectH0: "grow-h0" });
    check("state 커널: 자란 세대 커밋(heapLen 증가 + 성장분 보존 + 무변경 페이지 dedup)",
      grown.tree.heapLen === 4096 && grown.tree.sp === 16
      && grown.pages.get(2)[0] === 31 && grown.pages.get(3)[0] === 32 && grown.pages.get(0)[0] === 11
      && grownCommit.pagesWrote === 2 && grownCommit.deduped >= 2,
      `heapLen ${grown.tree.heapLen}, pages ${grown.pages.size}, 쓴 페이지 ${grownCommit.pagesWrote}, dedup ${grownCommit.deduped}`);
    await stateRoot.removeEntry("pyprocGateGrow", { recursive: true });

    // 쓰기 순서 법이 실 OPFS backend에서도 성립하는가(리뷰의 "OPFS write 중 탭 crash").
    // Node는 MemoryStore(부분 쓰기 물리적으로 불가)로 이 법을 문다 - 실 backend의 부분
    // 파일/HEAD-swap 크래시는 검증되지 않았다. 여기서 각 쓰기 지점(blob->tree->commit->
    // PREV->HEAD)에서 크래시시켜 구 HEAD가 무결·복구됨을 실 OPFS에서 확인한다. writeRef까지
    // 감싸 HEAD 교체 순간의 크래시(가장 중요한 지점)를 문다.
    try { await stateRoot.removeEntry("pyprocGateCrash", { recursive: true }); } catch (e) {}
    const crashDir = await stateRoot.getDirectoryHandle("pyprocGateCrash", { create: true });
    const kbc = (f) => new Uint8Array(1024).fill(f);
    const crashBase = new OpfsStateStore(crashDir);
    await commitState(crypto, crashBase, { pages: [[0, kbc(10)], [1, kbc(11)]], pageSize: 1024, heapLen: 2048, sp: 0, env: { h0: "crash-h0" } });
    await commitState(crypto, crashBase, { pages: [[0, kbc(20)], [1, kbc(21)]], pageSize: 1024, heapLen: 2048, sp: 0, env: { h0: "crash-h0" } });
    let crashOk = true, crashInfo = "";
    for (let crashAfter = 0; crashAfter < 6 && crashOk; crashAfter++) {
      const store = new OpfsStateStore(crashDir);
      let left = crashAfter;
      const oWO = store.writeObject.bind(store), oWR = store.writeRef.bind(store);
      store.writeObject = async (a, b) => { if (--left < 0) throw new Error("CRASH"); return oWO(a, b); };
      store.writeRef = async (n, r) => { if (--left < 0) throw new Error("CRASH"); return oWR(n, r); };
      try { await commitState(crypto, store, { pages: [[0, kbc(30 + crashAfter)], [1, kbc(40 + crashAfter)]], pageSize: 1024, heapLen: 2048, sp: 0, env: { h0: "crash-h0" } }); } catch (e) {}
      const opened = await openState(crypto, new OpfsStateStore(crashDir), { expectH0: "crash-h0" });
      if (opened.pages.get(0)[0] !== 20 || opened.pages.get(1)[0] !== 21) { crashOk = false; crashInfo = `crashAfter ${crashAfter}: HEAD ${opened.pages.get(0)[0]}/${opened.pages.get(1)[0]}(구 HEAD 20/21 아님)`; }
    }
    check("state 커널: OPFS 쓰기 순서 법(지점별 크래시에 구 HEAD 무결)", crashOk, crashInfo || "6지점 크래시 후 구 HEAD(20/21) 복구");

    await stateRoot.removeEntry("pyprocGateCrash", { recursive: true });

    // ref 파일 파손: HEAD.json에 쓰레기를 써도 판독기가 손상을 첫 부팅으로 위장하지 않는다
    // (저널 있는데 빈 머신 부팅 = 데이터 유실). PREV != HEAD인 깨끗한 상태에서: HEAD(60) 파손
    // -> PREV(50) 후퇴로 구분된다(파손을 gen50으로 정확히 후퇴, 첫 부팅 위장 아님).
    try { await stateRoot.removeEntry("pyprocGateRef", { recursive: true }); } catch (e) {}
    const refDir = await stateRoot.getDirectoryHandle("pyprocGateRef", { create: true });
    const refStore = new OpfsStateStore(refDir);
    await commitState(crypto, refStore, { pages: [[0, kbc(50)]], pageSize: 1024, heapLen: 1024, sp: 0, env: { h0: "ref-h0" } });
    await commitState(crypto, refStore, { pages: [[0, kbc(60)]], pageSize: 1024, heapLen: 1024, sp: 0, env: { h0: "ref-h0" } }); // HEAD=60, PREV=50
    const headFh = await refDir.getFileHandle("HEAD.json");
    const hw = await headFh.createWritable(); await hw.write("{not valid json"); await hw.close();
    let refState = "none";
    try { const r = await openState(crypto, new OpfsStateStore(refDir), { expectH0: "ref-h0" }); refState = r.fallback && r.pages.get(0)[0] === 50 ? "prev-fallback" : `head-${r.pages.get(0)[0]}`; }
    catch (e) { refState = e.code; }
    check("state 커널: OPFS HEAD.json 파손은 첫 부팅 위장 없이 PREV 후퇴", refState === "prev-fallback", refState);
    await stateRoot.removeEntry("pyprocGateRef", { recursive: true });
  }
} catch (e) {
  // 머리와 꼬리를 함께 싣는다. 파이썬 traceback은 예외 타입이 마지막 줄이라 머리만 자르면
  // 병명이 사라진다(실측: PythonError가 어느 예외인지 안 보여 원인 특정이 한 라운드 늦었다).
  const described = String(e && (e.stack || e.message) || e);
  check("예외 없음", false, described.length > 600 ? described.slice(0, 300) + " ... " + described.slice(-300) : described);
}
await report();
