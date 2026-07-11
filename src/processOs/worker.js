// worker.js - PyProc의 "프로세스" (Web Worker 안 Pyodide 인터프리터).
// 스냅샷으로 부팅(fast fork) 또는 콜드 부팅. 태스크를 받아 실행하고 결과 반환.
// pyProc.js가 같은 폴더의 이 파일을 new URL 상대경로로 spawn한다(위치 = 계약).
let py = null;
let interruptView = null;

onmessage = async (e) => {
  const msg = e.data;
  const indexURL = msg.indexURL || "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";
  try {
    if (msg.type === "boot") {
      const t0 = performance.now();
      const mod = await import(indexURL + "pyodide.mjs");
      const opts = { indexURL };
      if (msg.snapshot) {
        // fast fork. SAB 뷰를 그대로 주면 Pyodide 내부 TextDecoder가 거부한다
        // (shared buffer 불가) -> 워커 로컬 일반 버퍼로 1회 복사해 넘긴다.
        const shared = new Uint8Array(msg.snapshot);
        const copy = new Uint8Array(shared.byteLength);
        copy.set(shared);
        opts._loadSnapshot = copy;
      }
      py = await mod.loadPyodide(opts);
      if (msg.interruptSab && py.setInterruptBuffer) {
        interruptView = new Uint8Array(msg.interruptSab); // 커널의 SIGINT 채널(SAB)
        py.setInterruptBuffer(interruptView);
      }
      postMessage({ type: "ready", id: msg.id, bootMs: Math.round(performance.now() - t0), forked: !!msg.snapshot, interrupts: !!interruptView });
    } else if (msg.type === "task") {
      // fnSrc = 파이썬 함수 정의 소스(def _fn(arg): ...), arg = 인자(JSON 직렬화 가능)
      py.globals.set("_arg", msg.arg);
      const r = py.runPython(msg.fnSrc + "\n_result = _fn(_arg)\n_result");
      const result = r === undefined ? null : (typeof r === "object" && r && r.toJs ? r.toJs() : r);
      postMessage({ type: "result", id: msg.id, taskId: msg.taskId, result });
    }
  } catch (err) {
    if (interruptView) interruptView[0] = 0; // SIGINT 소진 후 채널 리셋(다음 태스크 오염 방지)
    // traceback은 예외 타입이 끝에 온다. 자를 거면 꼬리를 남겨야 원인이 살아남는다.
    postMessage({ type: "error", id: msg.id, taskId: msg.taskId, error: String(err).slice(-300) });
  }
};
