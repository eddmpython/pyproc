// browserControlHost.js - 서비스워커 측 영속 세션 호스트(Phase A 실측 원형, src/capabilities로 승격).
// 구조: TabSession(수명, mode-무관) + Driver(전략, mode별 = script/debugger) + 세션 맵 + 수명 이벤트
// (onDetach/onRemoved -> SessionLost) + storage.session 재attach(SW 소멸 복구). 파이썬은 sessionId(불투명)로
// 한 탭을 여러 op에 걸쳐 조작한다. tabId는 파이썬에 노출하지 않는다(iframe 셸 backing 교체 여지).
// 표면 카빙: evaluate 합성 op(추출/조회/대기)는 driver.evaluate 위 단일 구현(queryEval/waitFor*), mode별
// 메커니즘이 다른 것(신뢰 입력·항법·캡처·에뮬)만 Driver 메서드. 새 op는 dispatch 테이블 한 줄로 는다.
import { PROTOCOL_VERSION, OP, MODE } from "./browserControlProtocol.js";

// named config(하드코딩 금지). navigation/op 대기 상한과 기본 대기.
const LOAD_TIMEOUT_MS = 15000;
const DEFAULT_WAIT_MS = 10000;
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// CDP 헤더 리스트 변환 + UTF-8 안전 base64(fulfill 응답 바디용).
const toHeaderList = (obj) => Object.entries(obj || {}).map(([name, value]) => ({ name, value: String(value) }));
const b64 = (s) => btoa(unescape(encodeURIComponent(s || "")));

// sessionId -> { tabId, mode, driver, lost }. lost는 detach/removed 사유 문자열(이후 op가 SessionLost로 실패).
const sessions = new Map();

// CDP Input.dispatchKeyEvent용 제어키 정의(named 상수). 출처: Chromium USKeyboardLayout 제어키 최소 세트.
// 인쇄 문자는 KEY_DEFS에 없어도 parseKeySpec가 code/keyCode를 유도한다.
const KEY_DEFS = {
  Enter: { keyCode: 13, code: "Enter", key: "Enter", text: "\r" },
  Tab: { keyCode: 9, code: "Tab", key: "Tab" },
  Escape: { keyCode: 27, code: "Escape", key: "Escape" },
  Backspace: { keyCode: 8, code: "Backspace", key: "Backspace" },
  Delete: { keyCode: 46, code: "Delete", key: "Delete" },
  ArrowLeft: { keyCode: 37, code: "ArrowLeft", key: "ArrowLeft" },
  ArrowRight: { keyCode: 39, code: "ArrowRight", key: "ArrowRight" },
  ArrowUp: { keyCode: 38, code: "ArrowUp", key: "ArrowUp" },
  ArrowDown: { keyCode: 40, code: "ArrowDown", key: "ArrowDown" },
  Home: { keyCode: 36, code: "Home", key: "Home" },
  End: { keyCode: 35, code: "End", key: "End" },
  PageUp: { keyCode: 33, code: "PageUp", key: "PageUp" },
  PageDown: { keyCode: 34, code: "PageDown", key: "PageDown" },
  Space: { keyCode: 32, code: "Space", key: " ", text: " " },
};
// CDP modifiers 비트마스크(Alt=1, Control=2, Meta=4, Shift=8). Ctrl/Command은 별칭.
const MODIFIER_BITS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 };

// "Control+A" / "Enter" / "a" 파싱 -> { def, modifiers }. 인쇄 문자는 Key<대문자> code로 유도.
// 수식키(Ctrl/Meta/Alt)가 있으면 text를 비워 텍스트 삽입이 아닌 단축키로 보낸다.
function parseKeySpec(spec) {
  const parts = String(spec).split("+");
  const name = parts.pop();
  let modifiers = 0;
  for (const p of parts) modifiers |= MODIFIER_BITS[p] || 0;
  let def = KEY_DEFS[name];
  if (!def) {
    if (name.length !== 1) return null;
    const upper = name.toUpperCase();
    def = { keyCode: upper.charCodeAt(0), code: "Key" + upper, key: name };
    if (!(modifiers & (MODIFIER_BITS.Control | MODIFIER_BITS.Meta | MODIFIER_BITS.Alt))) def.text = name;
  }
  return { def, modifiers };
}

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

// debugger 전략: chrome.debugger CDP. 신뢰 입력(Input.*, isTrusted=true) + 캡처/에뮬 전 표면 + 임의 evaluate.
class DebuggerDriver {
  constructor(tabId) {
    this.tabId = tabId; this.target = { tabId };
    this.networkOn = false; this.fetchOn = false; this.netEventsOn = false;
    this.routes = []; this.responseLog = []; this.heldRequests = new Map();
    this.dialogAccept = true; this.dialogPromptText = ""; this.lastDialogMessage = null;
    this._eventListener = null;
  }
  send(method, params) { return chrome.debugger.sendCommand(this.target, method, params); }
  async ensureNetwork() { if (!this.networkOn) { await this.send("Network.enable"); this.networkOn = true; } }
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
    // 단일 이벤트 라우터: 다이얼로그 자동 처리 + Fetch 가로채기 + Network 응답 로그를 한 리스너가 tabId로 분기.
    // driver 인스턴스당 1회 등록(재attach 시 driver 재생성이라 중복 없음). detach가 제거.
    if (!this._eventListener) {
      this._eventListener = (source, method, params) => this._onEvent(source, method, params);
      chrome.debugger.onEvent.addListener(this._eventListener);
    }
  }
  async _onEvent(source, method, params) {
    if (source.tabId !== this.tabId) return;
    if (method === "Page.javascriptDialogOpening") {
      // 다이얼로그(alert/confirm/prompt)는 렌더러를 멈추므로 즉시 자동 응답(무처리 = 영구 행). 메시지는 기록.
      this.lastDialogMessage = params && params.message;
      try { await this.send("Page.handleJavaScriptDialog", { accept: this.dialogAccept, promptText: this.dialogPromptText }); } catch (e) { /* 이미 닫힘 */ }
    } else if (method === "Network.responseReceived" && this.netEventsOn) {
      this.responseLog.push({ url: params.response.url, status: params.response.status, requestId: params.requestId });
    } else if (method === "Fetch.requestPaused" && this.fetchOn) {
      await this._handleFetch(params);
    }
  }
  async navigate(url) {
    const loaded = waitForLoad(this.target, this.tabId);
    await this.send("Page.navigate", { url });
    await loaded;
    return { ok: true };
  }
  async reload() {
    const loaded = waitForLoad(this.target, this.tabId);
    await this.send("Page.reload", {});
    await loaded;
    return { ok: true };
  }
  back() { return this._history(-1); }
  forward() { return this._history(1); }
  // 히스토리 이동: bfcache 복귀는 loadEventFired가 안 뜰 수 있어 location 변화 폴을 병용(둘 중 먼저).
  async _history(delta) {
    const before = (await this.evaluate("location.href")).value;
    const changed = new Promise((resolve) => {
      let settled = false;
      const done = () => { if (settled) return; settled = true; chrome.debugger.onEvent.removeListener(onEv); clearInterval(poll); clearTimeout(to); resolve(); };
      const onEv = (src, m) => { if (src.tabId === this.tabId && m === "Page.loadEventFired") done(); };
      chrome.debugger.onEvent.addListener(onEv);
      const poll = setInterval(async () => { const u = await this.evaluate("location.href"); if (u.ok && u.value !== before) done(); }, 150);
      const to = setTimeout(done, LOAD_TIMEOUT_MS);
    });
    await this.send("Runtime.evaluate", { expression: `history.go(${delta})` });
    await changed;
    return { ok: true };
  }
  async evaluate(expr) {
    const res = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (res && res.exceptionDetails) return { ok: false, error: res.exceptionDetails.text || "evaluate 예외" };
    return { ok: true, value: res && res.result ? res.result.value : undefined };
  }
  async elementCenter(selector) {
    const r = await this.evaluate(`(() => { const e = document.querySelector(${J(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2, w: b.width, h: b.height }; })()`);
    return r.ok ? r.value : null;
  }
  async _pointAt(selector) {
    // 좌표 입력 전 요소를 뷰포트로 스크롤(폴드 아래 요소도 신뢰 클릭이 맞도록). script 경로는 e.click()이라 불필요.
    await this.evaluate(`(() => { const e = document.querySelector(${J(selector)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: "center", inline: "center" }); })()`);
    const c = await this.elementCenter(selector);
    if (!c || c.w === 0 || c.h === 0) return null;
    return c;
  }
  async _mouseClick(c, button, clickCount) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button, clickCount });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button, clickCount });
  }
  async click(selector) {
    const c = await this._pointAt(selector);
    if (!c) return { ok: false, error: `요소 미발견/비가시: ${selector}` };
    await this._mouseClick(c, "left", 1);
    return { ok: true };
  }
  async doubleClick(selector) {
    const c = await this._pointAt(selector);
    if (!c) return { ok: false, error: `요소 미발견/비가시: ${selector}` };
    await this._mouseClick(c, "left", 1);
    await this._mouseClick(c, "left", 2);
    return { ok: true };
  }
  async rightClick(selector) {
    const c = await this._pointAt(selector);
    if (!c) return { ok: false, error: `요소 미발견/비가시: ${selector}` };
    await this._mouseClick(c, "right", 1);
    return { ok: true };
  }
  async hover(selector) {
    const c = await this._pointAt(selector);
    if (!c) return { ok: false, error: `요소 미발견/비가시: ${selector}` };
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
    return { ok: true };
  }
  async _focus(selector) {
    const r = await this.evaluate(`(() => { const e = document.querySelector(${J(selector)}); if (!e) return false; e.focus(); return true; })()`);
    return r.ok && r.value === true;
  }
  async type(selector, text) {
    if (!(await this._focus(selector))) return { ok: false, error: `요소 미발견: ${selector}` };
    await this.send("Input.insertText", { text });
    return { ok: true };
  }
  // fill: 기존 값 비우고(native setter) 새 값 삽입(신뢰 입력). React 등 제어입력 대비 input/change 발화.
  async fill(selector, text) {
    const prep = await this.evaluate(`(() => { const e = document.querySelector(${J(selector)}); if (!e) return false; e.focus(); if ('value' in e) { const p = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value'); (p && p.set) ? p.set.call(e, '') : (e.value = ''); } if (e.select) e.select(); return true; })()`);
    if (!prep.ok || prep.value !== true) return { ok: false, error: `요소 미발견: ${selector}` };
    if (text) await this.send("Input.insertText", { text });
    await this.evaluate(`(() => { const e = document.querySelector(${J(selector)}); if (e) { e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
    return { ok: true };
  }
  async press(key, selector) {
    if (selector && !(await this._focus(selector))) return { ok: false, error: `요소 미발견: ${selector}` };
    const parsed = parseKeySpec(key);
    if (!parsed) return { ok: false, error: `알 수 없는 키: ${key}` };
    const { def, modifiers } = parsed;
    const base = { modifiers, key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
    await this.send("Input.dispatchKeyEvent", { type: def.text ? "keyDown" : "rawKeyDown", ...base, text: def.text });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    return { ok: true };
  }
  async screenshot(opts = {}) {
    const params = { format: opts.format === "jpeg" ? "jpeg" : "png", captureBeyondViewport: !!opts.fullPage };
    if (params.format === "jpeg" && opts.quality != null) params.quality = opts.quality;
    if (opts.fullPage) {
      const m = await this.send("Page.getLayoutMetrics");
      const cs = (m && (m.cssContentSize || m.contentSize)) || null;
      if (cs) params.clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 };
    }
    const r = await this.send("Page.captureScreenshot", params);
    if (!r || typeof r.data !== "string") return { ok: false, error: "screenshot 실패" };
    return { ok: true, value: r.data }; // base64(PNG/JPEG)
  }
  async pdf(opts = {}) {
    try {
      const r = await this.send("Page.printToPDF", { landscape: !!opts.landscape, printBackground: opts.printBackground !== false });
      if (!r || typeof r.data !== "string") return { ok: false, error: "pdf 실패(headed 창모드에선 printToPDF 미지원 가능)" };
      return { ok: true, value: r.data }; // base64(PDF)
    } catch (e) {
      return { ok: false, error: "pdf: " + String(e) };
    }
  }
  async setViewport(opts = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", { width: opts.width || 1280, height: opts.height || 800, deviceScaleFactor: opts.deviceScaleFactor || 1, mobile: !!opts.mobile });
    return { ok: true };
  }
  async setUserAgent(userAgent) {
    await this.ensureNetwork();
    await this.send("Network.setUserAgentOverride", { userAgent });
    return { ok: true };
  }
  async setHeaders(headers) {
    await this.ensureNetwork();
    await this.send("Network.setExtraHTTPHeaders", { headers: headers || {} });
    return { ok: true };
  }
  async cookies(urls) {
    const r = await this.send("Network.getCookies", urls ? { urls } : {});
    return { ok: true, value: (r && r.cookies) || [] };
  }
  async setCookie(c) {
    await this.ensureNetwork();
    const r = await this.send("Network.setCookie", c || {});
    return { ok: !(r && r.success === false), value: r && r.success };
  }
  async clearCookies(urls) {
    await this.ensureNetwork();
    const list = (await this.cookies(urls)).value || [];
    for (const c of list) await this.send("Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path });
    return { ok: true, value: list.length };
  }
  async deleteCookie(name, url) {
    await this.ensureNetwork();
    await this.send("Network.deleteCookies", url ? { name, url } : { name });
    return { ok: true };
  }
  // 파일 업로드: <input type=file>에 호스트 경로 배열을 심는다(setFileInputFiles). 경로는 브라우저 프로세스가
  // 접근 가능한 호스트 파일시스템 경로(자기 기기 자동화 전제). objectId로 요소를 지목하고 사용 후 해제.
  async upload(selector, files) {
    const obj = await this.send("Runtime.evaluate", { expression: `document.querySelector(${J(selector)})`, returnByValue: false });
    const objectId = obj && obj.result && obj.result.objectId;
    if (!objectId) return { ok: false, error: `요소 미발견: ${selector}` };
    try {
      await this.send("DOM.setFileInputFiles", { files: files || [], objectId });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "upload: " + String(e) };
    } finally {
      try { await this.send("Runtime.releaseObject", { objectId }); } catch (e) { /* 이미 해제 */ }
    }
  }
  setDialogHandler(accept, promptText) {
    this.dialogAccept = accept !== false;
    this.dialogPromptText = promptText || "";
    return { ok: true };
  }
  lastDialog() { return { ok: true, value: this.lastDialogMessage }; }
  // 네트워크 가로채기(Fetch 도메인). route가 처음 붙을 때만 Fetch.enable(모든 요청 latency 부담 회피).
  // 규칙: pattern(부분일치) -> block(fail) | fulfill(정적 응답) | 미지정(continue). 모든 requestPaused는 반드시 처리.
  async _ensureFetch() {
    if (this.fetchOn) return;
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    this.fetchOn = true;
  }
  async _handleFetch(params) {
    const url = params.request.url;
    const rule = this.routes.find((r) => url.includes(r.pattern));
    try {
      if (rule && rule.action === "block") {
        await this.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
      } else if (rule && rule.action === "fulfill") {
        await this.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: rule.status || 200, responseHeaders: toHeaderList(rule.headers), body: b64(rule.body) });
      } else if (rule && rule.action === "modify") {
        // 요청 변조: 헤더 주입(원본과 병합)/URL·메서드 교체 후 continue. 콜백 없이 선언형으로 나가는 요청을 바꾼다.
        const p = { requestId: params.requestId };
        if (rule.url) p.url = rule.url;
        if (rule.method) p.method = rule.method;
        if (rule.headers) p.headers = toHeaderList({ ...params.request.headers, ...rule.headers });
        await this.send("Fetch.continueRequest", p);
      } else if (rule && rule.action === "hold") {
        // 콜백형: 요청을 붙잡아 두고 Python이 pendingRequests로 관측 -> continue/fulfill/abort로 동적 결정.
        // 주의: 블로킹 navigate가 기다리는 메인 문서 하위요청을 hold하면 교착(단일 스레드). XHR 등 비-항법에 쓴다.
        this.heldRequests.set(params.requestId, { url, method: params.request.method, headers: params.request.headers });
      } else {
        await this.send("Fetch.continueRequest", { requestId: params.requestId });
      }
    } catch (e) { /* 요청이 이미 취소/완료됨 */ }
  }
  async route(pattern, action, opts) {
    await this._ensureFetch();
    this.routes.push({ pattern, action, status: opts && opts.status, body: opts && opts.body, headers: opts && opts.headers, url: opts && opts.url, method: opts && opts.method });
    return { ok: true };
  }
  pendingRequests() {
    return { ok: true, value: [...this.heldRequests].map(([id, v]) => ({ id, url: v.url, method: v.method })) };
  }
  async continueRequest(id, overrides) {
    const held = this.heldRequests.get(id);
    if (!held) return { ok: false, error: "held 요청 없음: " + id };
    const o = overrides || {};
    const p = { requestId: id };
    if (o.url) p.url = o.url;
    if (o.method) p.method = o.method;
    if (o.headers) p.headers = toHeaderList({ ...held.headers, ...o.headers });
    await this.send("Fetch.continueRequest", p);
    this.heldRequests.delete(id);
    return { ok: true };
  }
  async fulfillRequest(id, opts) {
    if (!this.heldRequests.has(id)) return { ok: false, error: "held 요청 없음: " + id };
    const o = opts || {};
    await this.send("Fetch.fulfillRequest", { requestId: id, responseCode: o.status || 200, responseHeaders: toHeaderList(o.headers), body: b64(o.body) });
    this.heldRequests.delete(id);
    return { ok: true };
  }
  async abortRequest(id) {
    if (!this.heldRequests.has(id)) return { ok: false, error: "held 요청 없음: " + id };
    await this.send("Fetch.failRequest", { requestId: id, errorReason: "Aborted" });
    this.heldRequests.delete(id);
    return { ok: true };
  }
  async responseBody(pattern) {
    await this._ensureNetEvents();
    const hits = this.responseLog.filter((r) => r.url.includes(pattern));
    const hit = hits[hits.length - 1];
    if (!hit) return { ok: false, error: "응답 없음: " + pattern };
    try {
      const r = await this.send("Network.getResponseBody", { requestId: hit.requestId });
      return { ok: true, value: { body: r.body, base64Encoded: r.base64Encoded } };
    } catch (e) {
      return { ok: false, error: "responseBody: " + String(e) };
    }
  }
  async unroute(pattern) {
    this.routes = pattern ? this.routes.filter((r) => r.pattern !== pattern) : [];
    return { ok: true };
  }
  async _ensureNetEvents() { await this.ensureNetwork(); this.netEventsOn = true; }
  async waitForResponse(pattern, timeoutMs) {
    await this._ensureNetEvents();
    const deadline = Date.now() + (timeoutMs || DEFAULT_WAIT_MS);
    while (Date.now() < deadline) {
      const hit = this.responseLog.find((r) => r.url.includes(pattern));
      if (hit) return { ok: true, value: hit };
      await sleep(100);
    }
    return { ok: false, error: "waitForResponse 타임아웃: " + pattern };
  }
  async requests() { await this._ensureNetEvents(); return { ok: true, value: this.responseLog }; }
  async detach() {
    if (this._eventListener) { chrome.debugger.onEvent.removeListener(this._eventListener); this._eventListener = null; }
    try { await chrome.debugger.detach(this.target); } catch (e) { /* 이미 풀림 */ }
  }
}

// script 전략: chrome.scripting(CDP 없음 = 스텔스). isTrusted=false. 페이지 CSP unsafe-eval에 evaluate가 걸릴 수 있다(정직).
// 캡처/에뮬은 CDP가 필요하므로 정직하게 미지원 실패(조용한 성공 위장 금지). 입력은 합성 이벤트로 대행.
class ScriptDriver {
  constructor(tabId) { this.tabId = tabId; }
  async attach() { /* CDP 없음 */ }
  async exec(func, args) {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, world: "MAIN", func, args });
    return res ? res.result : { ok: false, error: "executeScript 결과 없음" };
  }
  _waitComplete() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (settled) return; settled = true; chrome.tabs.onUpdated.removeListener(h); clearTimeout(to); fn(arg); };
      const h = (tabId, info) => { if (tabId === this.tabId && info.status === "complete") done(resolve, { ok: true }); };
      chrome.tabs.onUpdated.addListener(h);
      const to = setTimeout(() => done(reject, new Error("NavigationTimeout")), LOAD_TIMEOUT_MS);
    });
  }
  navigate(url) { const w = this._waitComplete(); chrome.tabs.update(this.tabId, { url }); return w; }
  reload() { const w = this._waitComplete(); chrome.tabs.reload(this.tabId); return w; }
  back() { const w = this._waitComplete(); chrome.tabs.goBack(this.tabId).catch(() => {}); return w; }
  forward() { const w = this._waitComplete(); chrome.tabs.goForward(this.tabId).catch(() => {}); return w; }
  async evaluate(expr) {
    // MAIN world eval. 페이지 CSP가 unsafe-eval을 막으면 실패 -> ok:false(정직, 조용한 성공 위장 금지).
    return this.exec((code) => { try { return { ok: true, value: (0, eval)(code) }; } catch (e) { return { ok: false, error: String(e) }; } }, [expr]);
  }
  async click(selector) {
    return this.exec((s) => { const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" }; e.click(); return { ok: true }; }, [selector]);
  }
  async doubleClick(selector) {
    return this.exec((s) => { const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" }; for (const t of ["mousedown", "mouseup", "click", "dblclick"]) e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, detail: 2 })); return { ok: true }; }, [selector]);
  }
  async rightClick(selector) {
    return this.exec((s) => { const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" }; e.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); return { ok: true }; }, [selector]);
  }
  async hover(selector) {
    return this.exec((s) => { const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" }; for (const t of ["mouseover", "mouseenter", "mousemove"]) e.dispatchEvent(new MouseEvent(t, { bubbles: t !== "mouseenter", cancelable: true })); return { ok: true }; }, [selector]);
  }
  async type(selector, text) {
    // React 등 제어입력 대비 native value setter 경유 후 input/change 디스패치(isTrusted=false).
    return this.exec((s, t, replace) => {
      const e = document.querySelector(s); if (!e) return { ok: false, error: "요소 미발견" };
      e.focus();
      const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      const next = replace ? t : ((e.value || "") + t);
      if (setter && setter.set) setter.set.call(e, next); else e.value = next;
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }, [selector, text, false]);
  }
  fill(selector, text) {
    // 값 대체(append 아님). type과 같은 경로지만 replace=true.
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
  async press(key, selector) {
    return this.exec((spec, sel) => {
      const parts = spec.split("+");
      const name = parts.pop();
      const mod = { ctrlKey: parts.includes("Control") || parts.includes("Ctrl"), shiftKey: parts.includes("Shift"), altKey: parts.includes("Alt"), metaKey: parts.includes("Meta") || parts.includes("Command") };
      const target = sel ? document.querySelector(sel) : (document.activeElement || document.body);
      if (sel && !target) return { ok: false, error: "요소 미발견" };
      if (sel) target.focus();
      for (const type of ["keydown", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...mod }));
      return { ok: true };
    }, [key, selector || null]);
  }
  _unsupported(op) { return { ok: false, error: `script mode 미지원(debugger mode 필요): ${op}` }; }
  screenshot() { return Promise.resolve(this._unsupported("screenshot")); }
  pdf() { return Promise.resolve(this._unsupported("pdf")); }
  setViewport() { return Promise.resolve(this._unsupported("setViewport")); }
  setUserAgent() { return Promise.resolve(this._unsupported("setUserAgent")); }
  setHeaders() { return Promise.resolve(this._unsupported("setHeaders")); }
  cookies() { return Promise.resolve(this._unsupported("cookies")); }
  setCookie() { return Promise.resolve(this._unsupported("setCookie")); }
  clearCookies() { return Promise.resolve(this._unsupported("clearCookies")); }
  deleteCookie() { return Promise.resolve(this._unsupported("deleteCookie")); }
  upload() { return Promise.resolve(this._unsupported("upload")); }
  setDialogHandler() { return Promise.resolve(this._unsupported("setDialogHandler")); }
  lastDialog() { return Promise.resolve(this._unsupported("lastDialog")); }
  route() { return Promise.resolve(this._unsupported("route")); }
  unroute() { return Promise.resolve(this._unsupported("unroute")); }
  waitForResponse() { return Promise.resolve(this._unsupported("waitForResponse")); }
  requests() { return Promise.resolve(this._unsupported("requests")); }
  pendingRequests() { return Promise.resolve(this._unsupported("pendingRequests")); }
  continueRequest() { return Promise.resolve(this._unsupported("continueRequest")); }
  fulfillRequest() { return Promise.resolve(this._unsupported("fulfillRequest")); }
  abortRequest() { return Promise.resolve(this._unsupported("abortRequest")); }
  responseBody() { return Promise.resolve(this._unsupported("responseBody")); }
  async detach() { /* CDP 없음 */ }
}

// evaluate 합성 op(mode 무관). 요소 접근 결과를 {__pyprocMissing}로 감싸 "미발견"과 "falsy 값"을 구분한다.
function queryEval(driver, selector, fnBody) {
  return driver.evaluate(
    `(() => { const el = document.querySelector(${J(selector)}); if (!el) return { __pyprocMissing: true }; return { __pyprocValue: (${fnBody})(el) }; })()`
  ).then((r) => {
    if (!r.ok) return r;
    const v = r.value;
    if (v && v.__pyprocMissing) return { ok: false, error: `요소 미발견: ${selector}` };
    return { ok: true, value: v ? v.__pyprocValue : undefined };
  });
}

// 선택자 등장 대기(evaluate 폴). resolve로 실패 위장 금지 = 타임아웃은 ok:false.
async function waitForSelector(driver, selector, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || DEFAULT_WAIT_MS);
  while (Date.now() < deadline) {
    const r = await driver.evaluate(`!!document.querySelector(${J(selector)})`);
    if (r.ok && r.value === true) return { ok: true };
    await sleep(100);
  }
  return { ok: false, error: "waitFor 타임아웃: " + selector };
}

// 임의 조건식 대기(truthy까지 폴). 페이지 상태 수렴을 기다린다(SPA/비동기 렌더).
async function waitForFunction(driver, expr, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || DEFAULT_WAIT_MS);
  while (Date.now() < deadline) {
    const r = await driver.evaluate(`!!(${expr})`);
    if (r.ok && r.value === true) return { ok: true };
    await sleep(100);
  }
  return { ok: false, error: "waitForFunction 타임아웃" };
}

// op -> 처리. mode별 메커니즘은 driver 메서드로, evaluate 합성은 queryEval/waitFor*로 위임. 새 op = 한 줄.
function dispatch(driver, op, a) {
  switch (op) {
    case OP.navigate: return driver.navigate(a.url);
    case OP.reload: return driver.reload();
    case OP.back: return driver.back();
    case OP.forward: return driver.forward();
    case OP.evaluate: return driver.evaluate(a.expr);
    case OP.click: return driver.click(a.selector);
    case OP.doubleClick: return driver.doubleClick(a.selector);
    case OP.rightClick: return driver.rightClick(a.selector);
    case OP.hover: return driver.hover(a.selector);
    case OP.type: return driver.type(a.selector, a.text);
    case OP.fill: return driver.fill(a.selector, a.text);
    case OP.press: return driver.press(a.key, a.selector);
    case OP.select: return queryEval(driver, a.selector, `e => { e.value = ${J(a.value)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; }`);
    case OP.text: return queryEval(driver, a.selector, "e => e.textContent");
    case OP.html: return queryEval(driver, a.selector, "e => e.innerHTML");
    case OP.attr: return queryEval(driver, a.selector, `e => e.getAttribute(${J(a.name)})`);
    case OP.value: return queryEval(driver, a.selector, "e => e.value");
    case OP.boundingBox: return queryEval(driver, a.selector, "e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, left: b.left }; }");
    case OP.exists: return driver.evaluate(`!!document.querySelector(${J(a.selector)})`);
    case OP.count: return driver.evaluate(`document.querySelectorAll(${J(a.selector)}).length`);
    case OP.texts: return driver.evaluate(`Array.from(document.querySelectorAll(${J(a.selector)}), e => e.textContent)`);
    case OP.title: return driver.evaluate("document.title");
    case OP.url: return driver.evaluate("location.href");
    case OP.content: return driver.evaluate("document.documentElement.outerHTML");
    case OP.waitFor: return waitForSelector(driver, a.selector, a.timeout);
    case OP.waitForFunction: return waitForFunction(driver, a.expr, a.timeout);
    case OP.screenshot: return driver.screenshot(a);
    case OP.pdf: return driver.pdf(a);
    case OP.setViewport: return driver.setViewport(a);
    case OP.setUserAgent: return driver.setUserAgent(a.userAgent);
    case OP.setHeaders: return driver.setHeaders(a.headers);
    case OP.cookies: return driver.cookies(a.urls);
    case OP.setCookie: return driver.setCookie(a);
    case OP.clearCookies: return driver.clearCookies(a.urls);
    case OP.deleteCookie: return driver.deleteCookie(a.name, a.url);
    case OP.scrollIntoView: return queryEval(driver, a.selector, `e => { e.scrollIntoView({ block: "center", inline: "center" }); return true; }`);
    case OP.upload: return driver.upload(a.selector, a.files);
    case OP.setDialogHandler: return driver.setDialogHandler(a.accept, a.promptText);
    case OP.lastDialog: return driver.lastDialog();
    case OP.route: return driver.route(a.pattern, a.action, a);
    case OP.unroute: return driver.unroute(a.pattern);
    case OP.waitForResponse: return driver.waitForResponse(a.pattern, a.timeout);
    case OP.requests: return driver.requests();
    case OP.pendingRequests: return driver.pendingRequests();
    case OP.continueRequest: return driver.continueRequest(a.id, { url: a.url, method: a.method, headers: a.headers });
    case OP.fulfillRequest: return driver.fulfillRequest(a.id, { status: a.status, body: a.body, headers: a.headers });
    case OP.abortRequest: return driver.abortRequest(a.id);
    case OP.responseBody: return driver.responseBody(a.pattern);
    default: return Promise.resolve({ ok: false, error: `알 수 없는 op: ${op}` });
  }
}

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
  if (op === OP.closeSession) {
    await s.driver.detach();
    try { await chrome.tabs.remove(s.tabId); } catch (e) { /* 이미 닫힘 */ }
    sessions.delete(sessionId);
    await chrome.storage.session.remove("bc_" + sessionId);
    return { ok: true };
  }
  try {
    return await dispatch(s.driver, op, args || {});
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 스텔스 마스크(named 상수 + 출처 주석). 페이지 JS 전에 navigator.webdriver를 덮는다.
// 출처: attempts 게이트(선제 개입) 실측(off=true(포트) -> on=undefined).
const WEBDRIVER_MASK = "try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true }); } catch (e) {}";

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
