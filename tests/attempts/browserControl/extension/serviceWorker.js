// serviceWorker.js - browserControl 실측 확장의 배경 컨텍스트.
// 역할: (1) offscreen document(Pyodide 호스트)를 만든다. (2) offscreen이 chrome.runtime로
// 보낸 게이트 결과를 받아, 자신의 chrome.debugger 가시성(게이트 3 예비)을 덧붙여 로컬 러너로
// 백채널(fetch) 릴레이한다. offscreen은 chrome.debugger에 못 닿으므로(제한 API), 이 릴레이가 계약이다.
// 백채널 포트는 config.js에서 온다: 러너가 서버 포트를 확보한 뒤 조립 시점에 구워 넣는다
// (실측 산출값의 로컬 주입. CDP evaluate 주입은 SW 실행 컨텍스트가 불안정해 폐기 - 결론 표 참조).
import { BACKCHANNEL_PORT } from "./config.js";

async function report(payload) {
  const body = JSON.stringify({
    ...payload,
    swChecks: [
      { name: "sw: chrome.debugger 존재", pass: typeof chrome.debugger === "object" && typeof chrome.debugger.attach === "function" },
      { name: "sw: chrome.tabs 존재", pass: typeof chrome.tabs === "object" },
    ],
  });
  try {
    await fetch(`http://127.0.0.1:${BACKCHANNEL_PORT}/gateReport`, { method: "POST", body });
  } catch (e) {
    // 백채널 실패는 러너 타임아웃으로 드러난다(여기선 삼킬 수밖에 없다: 보고 경로가 죽은 상황).
  }
}

async function ensureOffscreen() {
  const url = `offscreen.html?port=${BACKCHANNEL_PORT}`;
  const existing = await chrome.offscreen.hasDocument?.();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url,
      reasons: ["WORKERS"],
      justification: "Pyodide 런타임 호스트(SAB/워커 프로세스 OS 실측)",
    });
  }
}

// 게이트 3: offscreen의 파이썬이 요청한 CDP 왕복을 chrome.debugger로 실행한다.
// 새 탭 생성 -> attach -> Page.navigate -> load 대기 -> Runtime.evaluate -> 정리.
// 이것이 "파이썬이 브라우저 자체를 조작한다"의 실체다(offscreen은 chrome.debugger에 못 닿으므로
// 파이썬 -> offscreen JS -> runtime 메시지 -> SW -> chrome.debugger 경로).
async function handleCdp({ url, expr, override }) {
  let tab = null, target = null;
  try {
    tab = await chrome.tabs.create({ url: "about:blank", active: false });
    target = { tabId: tab.id };
    await chrome.debugger.attach(target, "1.3");
    await chrome.debugger.sendCommand(target, "Page.enable");
    // 선제 개입: 페이지의 어떤 스크립트보다 먼저 실행되는 스크립트를 등록한다(문서 생성 최우선).
    // navigator.webdriver getter를 undefined로 덮어, 탐지 JS가 읽기 전에 표시등을 끈다.
    // = 확장 링(페이지 상위)이라 가능한 스텔스. chrome.debugger 경로의 webdriver 약점을 덮는지 실측.
    if (override) {
      await chrome.debugger.sendCommand(target, "Page.addScriptToEvaluateOnNewDocument", {
        source: "try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true }); } catch (e) {}",
      });
    }
    const loaded = new Promise((resolve) => {
      const onEvent = (source, method) => {
        if (source.tabId === tab.id && method === "Page.loadEventFired") {
          chrome.debugger.onEvent.removeListener(onEvent);
          resolve();
        }
      };
      chrome.debugger.onEvent.addListener(onEvent);
      setTimeout(resolve, 10000); // load 이벤트를 못 받아도 진행(폴백)
    });
    await chrome.debugger.sendCommand(target, "Page.navigate", { url });
    await loaded;
    const res = await chrome.debugger.sendCommand(target, "Runtime.evaluate", { expression: expr, returnByValue: true });
    return { ok: true, value: res?.result?.value, subtype: res?.result?.subtype };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    try { if (target) await chrome.debugger.detach(target); } catch (e) {}
    try { if (tab) await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

// 대안 경로: content script(chrome.scripting)로 조작한다. CDP attach를 하지 않으므로
// navigator.webdriver가 켜지는지가 chrome.debugger 경로와의 스텔스 차이를 가른다(측정 대상).
async function handleContentScript({ url, expr }) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 10000);
    });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN", // 페이지가 실제로 보는 컨텍스트에서 측정
      func: (expression) => {
        try { return { ok: true, value: String(eval(expression)) }; }
        catch (e) { return { ok: false, error: String(e) }; }
      },
      args: [expr],
    });
    return res?.result || { ok: false, error: "no result" };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    try { if (tab) await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

// offscreen -> SW 메시지 분기: gateResult(릴레이) / cdp(chrome.debugger) / contentScript(chrome.scripting).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "gateResult") {
    report(msg);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "cdp") {
    handleCdp(msg).then(sendResponse);
    return true; // 비동기 sendResponse
  }
  if (msg && msg.type === "contentScript") {
    handleContentScript(msg).then(sendResponse);
    return true;
  }
  return true;
});

async function boot() {
  try {
    await ensureOffscreen();
  } catch (e) {
    await report({ type: "gateResult", fatal: `offscreen 생성 실패: ${String(e)}`, checks: [] });
  }
}

chrome.runtime.onInstalled.addListener(boot);
boot(); // 콜드 스타트(설치 이벤트를 놓친 재기동) 대비
