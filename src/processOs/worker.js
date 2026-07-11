// worker.js - PyProc의 "프로세스" (Web Worker 안 Pyodide 인터프리터).
// 스냅샷으로 부팅(fast fork) 또는 콜드 부팅. 태스크를 받아 실행하고 결과 반환.
// pyProc.js가 같은 폴더의 이 파일을 new URL 상대경로로 spawn한다(위치 = 계약).
let py = null;

onmessage = async (e) => {
  const msg = e.data;
  const indexURL = msg.indexURL || "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";
  try {
    if (msg.type === "boot") {
      const t0 = performance.now();
      const mod = await import(indexURL + "pyodide.mjs");
      const opts = { indexURL };
      if (msg.snapshot) opts._loadSnapshot = new Uint8Array(msg.snapshot);  // fast fork
      py = await mod.loadPyodide(opts);
      postMessage({ type: "ready", id: msg.id, bootMs: Math.round(performance.now() - t0), forked: !!msg.snapshot });
    } else if (msg.type === "task") {
      // fnSrc = 파이썬 함수 정의 소스(def _fn(arg): ...), arg = 인자(JSON 직렬화 가능)
      py.globals.set("_arg", msg.arg);
      const r = py.runPython(msg.fnSrc + "\n_result = _fn(_arg)\n_result");
      const result = r === undefined ? null : (typeof r === "object" && r && r.toJs ? r.toJs() : r);
      postMessage({ type: "result", id: msg.id, taskId: msg.taskId, result });
    }
  } catch (err) {
    postMessage({ type: "error", id: msg.id, taskId: msg.taskId, error: String(err).slice(0, 300) });
  }
};
