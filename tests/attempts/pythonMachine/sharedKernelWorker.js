// sharedKernelWorker.js - probe: SharedWorker가 커널을 소유하면 탭은 화면일 뿐이다.
// 연결(포트)이 몇 개든 파이썬 상태는 하나 = 머신이 특정 탭 밖에서 산다.
// 탭 하나가 닫혀도 다른 연결이 남아 있는 한 커널은 계속 돈다(OS의 데몬 등가).
const INDEX = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";
let bootP = null;
const ensure = () => bootP || (bootP = (async () => {
  const t0 = performance.now();
  const mod = await import(INDEX + "pyodide.mjs");
  const py = await mod.loadPyodide({ indexURL: INDEX });
  return { py, bootMs: Math.round(performance.now() - t0) };
})());

self.onconnect = (e) => {
  const port = e.ports[0];
  port.onmessage = async (m) => {
    const { id, type, code } = m.data;
    try {
      const k = await ensure();
      if (type === "run") {
        const r = k.py.runPython(code);
        port.postMessage({ id, ok: true, result: r === undefined ? null : r, bootMs: k.bootMs });
      } else if (type === "info") {
        port.postMessage({ id, ok: true, result: { coi: self.crossOriginIsolated === true, jspi: typeof WebAssembly.Suspending === "function" } });
      }
    } catch (err) {
      port.postMessage({ id, ok: false, error: String(err).slice(-300) });
    }
  };
};
