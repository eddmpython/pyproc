// browserRouterWorker.js - 프로세스 OS 워커(논리 세션 소유). dedicated Worker에는 chrome이 없으므로(제약 A)
// offscreen 라우터에 postMessage로 브라우저 op를 위임한다(4-홉: 워커 -> offscreen -> SW -> chrome.debugger).
// 워커 N개가 각자 세션을 소유해 세션별 독립 상태를 갖는다(프로세스 OS = 워커 N = 세션 N).
let reqSeq = 0;
const pending = new Map();

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "opResult") {
    const r = pending.get(m.reqId);
    if (r) { pending.delete(m.reqId); r(m.result); }
    return;
  }
  if (m.type === "run") {
    run(m.label, m.target)
      .then((r) => self.postMessage({ type: "done", result: r }))
      .catch((e) => self.postMessage({ type: "done", result: { error: String(e) } }));
  }
};

// 브라우저 op를 offscreen 라우터로 보낸다(응답은 reqId로 상관).
function op(name, fields) {
  return new Promise((resolve) => {
    const reqId = ++reqSeq;
    pending.set(reqId, resolve);
    self.postMessage({ type: "op", reqId, op: name, fields });
  });
}

async function run(label, target) {
  const open = await op("openSession", { mode: "debugger" });
  const sid = open.sessionId;
  await op("navigate", { sessionId: sid, args: { url: target } });
  const title = await op("evaluate", { sessionId: sid, args: { expr: "document.title" } });
  // 세션 격리: 각 워커가 자기 label을 자기 세션 페이지에 쓰고 되읽는다(서로 안 섞임).
  await op("evaluate", { sessionId: sid, args: { expr: "window.workerLabel = " + JSON.stringify(label) } });
  const readBack = await op("evaluate", { sessionId: sid, args: { expr: "window.workerLabel" } });
  await op("closeSession", { sessionId: sid });
  return { title: title.value, label: readBack.value };
}
