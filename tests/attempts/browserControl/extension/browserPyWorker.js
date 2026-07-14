// browserPyWorker.js - Pyodide 파이썬 워커(프로세스 OS x 브라우저 컨트롤). 각 워커가 자기 인터프리터(독립 GIL)로
// 파이썬을 돌리고, 브라우저 op는 offscreen 라우터로 postMessage 왕복한다. 제약 A(워커는 chrome.* 미접근) 우회:
// _pyprocBrowserSend가 chrome.runtime 대신 offscreen에 postMessage하고, run_sync(JSPI)가 opResult까지 블로킹한다.
// = "워커 N = 독립 인터프리터 N = 세션 N". 파이썬 연산은 N GIL로 물리 병렬, 브라우저-op은 SW 단일 큐(정직한 천장).
const pending = new Map();
let nextReqId = 1;

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === "opResult") {
    const resolve = pending.get(m.reqId);
    if (resolve) { pending.delete(m.reqId); resolve(m.result); }
    return;
  }
  if (m.type !== "run") return;
  try {
    // 워커도 offscreen(COI)에서 스폰돼 crossOriginIsolated 상속 = SAB/JSPI 생존 -> 자기 Pyodide 부팅.
    const mod = await import(m.indexURL + "pyodide.mjs");
    const py = await mod.loadPyodide({ indexURL: m.indexURL });
    // 워커 전용 send: chrome.runtime이 없으니 offscreen으로 postMessage하고 opResult로 resolve(라우터 4-홉).
    py.globals.set("_pyprocBrowserSend", (op, fieldsJson) => new Promise((resolve) => {
      const reqId = nextReqId++;
      pending.set(reqId, (result) => resolve(JSON.stringify(result)));
      self.postMessage({ type: "op", reqId, op, fields: JSON.parse(fieldsJson) });
    }));
    await py.runPythonAsync(m.moduleSource);
    py.globals.set("workerTarget", m.target);
    py.globals.set("workerLabel", m.label);
    // 자기 세션을 열어 조작(run_sync 블로킹) + 이 워커 GIL에서 CPU 연산(병렬성 증명) + 자기 label 격리 확인.
    const resultJson = await py.runPythonAsync(`
import pyprocBrowser as browser
import json
tab = browser.tab(workerTarget, mode="script")
title = tab.evaluate("document.title")
total = 0
for i in range(200000):
    total += i
tab.type("#field", workerLabel)
readback = tab.evaluate("document.getElementById('field').value")
tab.close()
json.dumps({"label": workerLabel, "title": title, "readback": readback, "total": total})
`);
    self.postMessage({ type: "done", result: JSON.parse(resultJson) });
  } catch (e) {
    self.postMessage({ type: "error", error: String(e) });
  }
};
