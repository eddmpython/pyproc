// pyWorker.js - 실 src installBrowserWorker를 쓰는 Pyodide 워커(프로세스 OS x 브라우저 컨트롤 SSOT 검증).
// 워커가 자기 Pyodide 인터프리터를 부팅하고 실 src로 배선한 뒤, run_sync + offscreen 라우터로 자기 세션을 몬다.
import { installBrowserWorker } from "./src/capabilities/browserControl.js";

self.onmessage = async (ev) => {
  const m = ev.data;
  if (!m || m.type !== "run") return;
  try {
    const mod = await import(m.indexURL + "pyodide.mjs");
    const py = await mod.loadPyodide({ indexURL: m.indexURL });
    await installBrowserWorker(py);
    py.globals.set("workerTarget", m.target);
    py.globals.set("workerLabel", m.label);
    const resultJson = await py.runPythonAsync(`
import pyprocBrowser as browser
import json
tab = browser.tab(workerTarget, mode="script")
title = tab.evaluate("document.title")
tab.type("#field", workerLabel)
readback = tab.evaluate("document.getElementById('field').value")
tab.close()
json.dumps({"label": workerLabel, "title": title, "readback": readback})
`);
    self.postMessage({ type: "done", result: JSON.parse(resultJson) });
  } catch (e) {
    self.postMessage({ type: "error", error: String(e) });
  }
};
