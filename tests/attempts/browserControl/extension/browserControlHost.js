// browserControlHost.js - 서비스워커 측 영속 세션 호스트(Phase A 실측 원형, Phase B에 src/capabilities로 승격).
// attempts의 일회성 핸들러(탭 생성->조작->즉시 close 복붙)를 깎은 형태:
//   TabSession(수명, mode-무관) + Driver(전략, mode별) + 세션 맵 + 수명 이벤트(onDetach/onRemoved).
// 파이썬은 sessionId(불투명)로 한 탭을 여러 op에 걸쳐 조작한다. tabId는 파이썬에 노출하지 않는다(Phase 2 backing 교체 여지).
import { PROTOCOL_VERSION, OP, MODE } from "./browserControlProtocol.js";

// named config(하드코딩 금지). navigation/op 대기 상한.
const LOAD_TIMEOUT_MS = 15000;

// sessionId -> { tabId, mode, driver, lost }. lost는 detach/removed 사유 문자열(이후 op가 SessionLost로 실패).
const sessions = new Map();

// load 완료를 Page.loadEventFired로 대기하되 타임아웃은 reject(resolve로 실패를 성공 위장 금지).
// 리스너는 항상 finally에서 제거(영속 세션에서 누수 방지). SPA 대비 readyState 폴백 병용.
function waitForLoad(target, tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (settled) return; settled = true; chrome.debugger.onEvent.removeListener(onEvent); clearTimeout(to); clearInterval(poll); fn(arg); };
    const onEvent = (source, method) => { if (source.tabId === tabId && method === "Page.loadEventFired") done(resolve); };
    chrome.debugger.onEvent.addListener(onEvent);
    // SPA/pushState는 loadEventFired를 안 쏘므로 readyState=complete도 완료로 인정.
    const poll = setInterval(async () => {
      try {
        const r = await chrome.debugger.sendCommand(target, "Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
        if (r && r.result && r.result.value === "complete") done(resolve);
      } catch (e) { /* attach 중/일시 실패는 다음 폴에서 */ }
    }, 250);
    const to = setTimeout(() => done(reject, new Error("NavigationTimeout")), LOAD_TIMEOUT_MS);
  });
}

// debugger 전략: chrome.debugger CDP. 신뢰 입력(Input.*, isTrusted=true) + 임의 Runtime.evaluate.
class DebuggerDriver {
  constructor(tabId) { this.tabId = tabId; this.target = { tabId }; }
  send(method, params) { return chrome.debugger.sendCommand(this.target, method, params); }
  async attach() {
    try {
      await chrome.debugger.attach(this.target, "1.3");
    } catch (e) {
      // SW 재시작 후 재구성: 확장 레벨 attach는 SW death에 살아남으므로 "already attached"면 기존 것을 재사용.
      if (!String(e).includes("Another debugger is already attached")) throw e;
    }
    await this.send("Page.enable");
    // 스텔스: 페이지의 어떤 스크립트보다 먼저 webdriver를 덮는다(재attach 시 마스크 재등록).
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: WEBDRIVER_MASK });
  }
  async navigate(url) {
    const loaded = waitForLoad(this.target, this.tabId);
    await this.send("Page.navigate", { url });
    await loaded;
    return { ok: true };
  }
  async evaluate(expr) {
    const res = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (res && res.exceptionDetails) return { ok: false, error: res.exceptionDetails.text || "evaluate 예외" };
    return { ok: true, value: res && res.result ? res.result.value : undefined };
  }
  async elementCenter(selector) {
    const r = await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2, w: b.width, h: b.height }; })()`);
    return r.ok ? r.value : null;
  }
  async click(selector) {
    const c = await this.elementCenter(selector);
    if (!c || c.w === 0 || c.h === 0) return { ok: false, error: `요소 미발견/비가시: ${selector}` };
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1 });
    return { ok: true };
  }
  async type(selector, text) {
    const focused = await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.focus(); return true; })()`);
    if (!focused.ok || focused.value !== true) return { ok: false, error: `요소 미발견: ${selector}` };
    await this.send("Input.insertText", { text });
    return { ok: true };
  }
  async detach() { try { await chrome.debugger.detach(this.target); } catch (e) { /* 이미 풀림 */ } }
}

// script 전략: chrome.scripting(CDP 없음 = 스텔스). isTrusted=false. 페이지 CSP unsafe-eval에 evaluate가 걸릴 수 있다(정직).
class ScriptDriver {
  constructor(tabId) { this.tabId = tabId; }
  async attach() { /* CDP 없음 */ }
  async exec(func, args) {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, world: "MAIN", func, args });
    return res ? res.result : { ok: false, error: "executeScript 결과 없음" };
  }
  navigate(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (settled) return; settled = true; chrome.tabs.onUpdated.removeListener(h); clearTimeout(to); fn(arg); };
      const h = (tabId, info) => { if (tabId === this.tabId && info.status === "complete") done(resolve, { ok: true }); };
      chrome.tabs.onUpdated.addListener(h);
      const to = setTimeout(() => done(reject, new Error("NavigationTimeout")), LOAD_TIMEOUT_MS);
      chrome.tabs.update(this.tabId, { url });
    });
  }
  async evaluate(expr) {
    // MAIN world eval. 페이지 CSP가 unsafe-eval을 막으면 실패 -> ok:false(정직, 조용한 성공 위장 금지).
    return this.exec((code) => { try { return { ok: true, value: (0, eval)(code) }; } catch (e) { return { ok: false, error: String(e) }; } }, [expr]);
  }
  async click(selector) {
    return this.exec((s) => { const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" }; e.click(); return { ok: true }; }, [selector]);
  }
  async type(selector, text) {
    // React 등 제어입력 대비 native value setter 경유 후 input/change 디스패치(isTrusted=false).
    return this.exec((s, t) => {
      const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" };
      e.focus();
      const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(e, t); else e.value = t;
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }, [selector, text]);
  }
  async detach() { /* CDP 없음 */ }
}

// 스텔스 마스크(named 상수 + 출처 주석). 페이지 JS 전에 navigator.webdriver를 덮는다.
// 출처: attempts 게이트(선제 개입) 실측(off=true(포트) -> on=undefined).
const WEBDRIVER_MASK = "try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true }); } catch (e) {}";

// SW 재시작 생존: 세션 메타를 storage.session에 write-through. SW가 죽으면 in-memory 맵은 소실되나 메타는
// 생존하고, 탭 자체는 렌더러 소유라 살아있다. 다음 op에서 lazy 재attach로 복구한다(WEBDRIVER_MASK는
// driver.attach가 재등록). MV3 SW 30초 소멸/크래시에 대한 복구망.
function persistSession(sid, meta) { return chrome.storage.session.set({ ["bc_" + sid]: meta }); }
async function loadSessionMeta(sid) { const r = await chrome.storage.session.get("bc_" + sid); return r["bc_" + sid]; }

let lastEnsureFail = "";
async function ensureSession(sid) {
  const existing = sessions.get(sid);
  if (existing) return existing;
  const meta = await loadSessionMeta(sid);
  if (!meta) { lastEnsureFail = "no-meta-in-storage"; return null; }
  // SW 재시작 후 재구성: driver 재생성 + 재attach(debugger는 마스크 재등록 포함). 탭이 없으면 재구성 실패.
  const driver = meta.mode === MODE.debugger ? new DebuggerDriver(meta.tabId) : new ScriptDriver(meta.tabId);
  try { await driver.attach(); } catch (e) { lastEnsureFail = "reattach:" + String(e); return null; }
  const s = { tabId: meta.tabId, mode: meta.mode, driver, lost: null };
  sessions.set(sid, s);
  return s;
}

async function handleOp(msg) {
  const { op, sessionId, mode, args } = msg;
  if (op === OP.handshake) return { ok: true, version: PROTOCOL_VERSION };
  if (op === OP.openSession) {
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    const driver = mode === MODE.debugger ? new DebuggerDriver(tab.id) : new ScriptDriver(tab.id);
    await driver.attach();
    const sid = "s" + tab.id; // 불투명 핸들(파이썬엔 sid만, tabId 미노출)
    sessions.set(sid, { tabId: tab.id, mode, driver, lost: null });
    await persistSession(sid, { tabId: tab.id, mode });
    return { ok: true, sessionId: sid };
  }
  const s = await ensureSession(sessionId);
  if (!s) return { ok: false, error: "세션 없음: " + lastEnsureFail };
  if (s.lost) return { ok: false, error: `SessionLost: ${s.lost}` };
  try {
    if (op === OP.navigate) return await s.driver.navigate(args.url);
    if (op === OP.evaluate) return await s.driver.evaluate(args.expr);
    if (op === OP.click) return await s.driver.click(args.selector);
    if (op === OP.type) return await s.driver.type(args.selector, args.text);
    if (op === OP.closeSession) {
      await s.driver.detach();
      try { await chrome.tabs.remove(s.tabId); } catch (e) { /* 이미 닫힘 */ }
      sessions.delete(sessionId);
      await chrome.storage.session.remove("bc_" + sessionId);
      return { ok: true };
    }
    return { ok: false, error: `알 수 없는 op: ${op}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 탭/디버거 무효화 -> 세션을 lost로 표시(이후 op가 SessionLost로 깨끗이 실패, 행 금지).
function invalidateByTab(tabId, reason) {
  for (const s of sessions.values()) if (s.tabId === tabId) s.lost = reason;
}

// 소비자 서비스워커가 여는 진입점. 우리 프로토콜 메시지만 처리하고 나머지는 falsy 반환(무조건 return true 버그 금지).
export function openBrowserControlHost() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.proto !== PROTOCOL_VERSION || typeof msg.op !== "string") return false;
    handleOp(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 이 메시지는 비동기로 응답한다
  });
  chrome.debugger.onDetach.addListener((source) => { if (source.tabId != null) invalidateByTab(source.tabId, "debugger detached"); });
  chrome.tabs.onRemoved.addListener((tabId) => invalidateByTab(tabId, "tab removed"));
}
