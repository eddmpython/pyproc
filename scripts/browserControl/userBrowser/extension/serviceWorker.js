// serviceWorker.js - the user-browser provider inside the user's own Chrome or Edge.
// It speaks flat CDP to one paired control host through the pyproc native host: `{id, method, params, sessionId}`
// requests, `{id, result|error}` replies, and `{method, params, sessionId}` events. Browser-level work is the
// `PyprocUserBrowser.*` methods, done with chrome.windows and chrome.tabs. It attaches chrome.debugger only to the tabs
// of the task window it opened and the tabs those tabs open, never touches profile data (cookies, storage, caches),
// and detaches everything when the task ends, the control host goes away, or the user cancels the debugging bar.
//
// A download is the browser's own: it saves where the user's settings say. A click the control host declares as a
// download arms an expectation for its tab first; the one download that tab starts while it is armed (the URL the
// tab's own Page.downloadWillBegin named) is claimed, and only when it completes or fails is the control host told
// where the browser saved it. A download item names no tab, so when two downloads of that URL appear together the
// expectation is ambiguous and neither is reported. Downloads the user starts are never reported.
//
// Every control-host connection has a number the native host gives it. A request is bound to the connection it came
// from: its reply, and any effect it completes after an await (authorization, a tab, an attachment), is dropped or
// undone when that connection is gone, so nothing one control host started ever reaches the next one.
import { HOST_NAME, PRESET_PAIRING_SHA256 } from "./config.js";

const PROTOCOL_VERSION = "1.3";
const PAIRING_WINDOW_MS = 120000;
const MAX_RECONNECT_MS = 30000;
// Tab-level domains the provider's observation and actions use; everything else is refused before chrome.debugger.
const ALLOWED_DOMAINS = new Set(["Accessibility", "Audits", "CSS", "DOM", "DOMSnapshot", "Emulation", "Input", "Log",
  "Network", "Overlay", "Page", "Performance", "Runtime"]);
// Methods of allowed domains that read or change the profile, fetch with the user's credentials outside a page,
// close or crash a tab, or move it through its history out of the task's reach.
const DENIED_METHODS = new Set(["Network.getCookies", "Network.getAllCookies", "Network.setCookie", "Network.setCookies",
  "Network.deleteCookies", "Network.clearBrowserCookies", "Network.clearBrowserCache", "Network.setCookieControls",
  "Network.loadNetworkResource", "Page.getCookies", "Page.deleteCookie", "Page.setDownloadBehavior", "Page.close",
  "Page.crash", "Page.navigateToHistoryEntry", "Page.resetNavigationHistory"]);
// Network events that carry the profile's cookies; the rest have their cookie headers removed.
const DROPPED_EVENTS = new Set(["Network.requestWillBeSentExtraInfo", "Network.responseReceivedExtraInfo",
  "Network.responseReceivedEarlyHints"]);
const COOKIE_HEADER = /^(cookie|cookie2|set-cookie|set-cookie2)$/i;
const COOKIE_LISTS = new Set(["associatedCookies", "blockedCookies", "exemptedCookies", "cookiePartitionKey"]);

let port = null;
let reconnectMs = 1000;
let connection = 0;
let authorizedConnection = 0;
let pendingPair = null;
let sessionCounter = 0;
const task = { windowId: null, tabs: new Set(), created: new Set(), sessions: new Map(), tabSessions: new Map() };
const DOWNLOAD_WAIT_MAX_MS = 600000;
// How long a download the browser created stays claimable by a Page.downloadWillBegin that arrives after it.
const DOWNLOAD_MATCH_MS = 5000;
// How long a completed claim waits for a second download of its URL before it is reported.
const DOWNLOAD_AMBIGUITY_GRACE_MS = 250;
let expectationCounter = 0;
const downloads = { expectations: new Map(), claimed: new Map(), recent: [] };

class ProviderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function authorized() {
  return connection !== 0 && authorizedConnection === connection;
}

function assertCurrent(epoch) {
  if (epoch !== connection) throw new ProviderError(-32005, "the control host that asked is gone");
}

function post(message) {
  try { port?.postMessage(message); } catch {}
}

// Events go only to the control host that presented the pairing key.
function event(method, params = {}, sessionId = undefined) {
  if (!authorized()) return;
  post(sessionId ? { method, params, sessionId } : { method, params });
}

function withoutCookies(value, depth = 0) {
  if (depth > 12 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => withoutCookies(entry, depth + 1));
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (COOKIE_LISTS.has(key)) continue;
    if ((key === "headers" || key === "requestHeaders") && entry && typeof entry === "object") {
      copy[key] = Object.fromEntries(Object.entries(entry).filter(([name]) => !COOKIE_HEADER.test(name)));
    } else {
      copy[key] = withoutCookies(entry, depth + 1);
    }
  }
  return copy;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stored(key) {
  return (await chrome.storage.local.get(key))[key];
}

async function profileId() {
  let id = await stored("profileId");
  if (typeof id !== "string") {
    id = crypto.randomUUID();
    await chrome.storage.local.set({ profileId: id });
  }
  return id;
}

async function product() {
  const brands = (await navigator.userAgentData?.getHighEntropyValues(["fullVersionList"]))?.fullVersionList || [];
  const edge = brands.find((entry) => entry.brand === "Microsoft Edge");
  const chrome = brands.find((entry) => entry.brand === "Google Chrome");
  const chromium = brands.find((entry) => entry.brand === "Chromium");
  if (edge) return `Edg/${edge.version}`;
  if (chrome) return `Chrome/${chrome.version}`;
  return `Chromium/${chromium?.version || "0"}`;
}

async function pairingSha256() {
  return PRESET_PAIRING_SHA256 || await stored("pairingSha256") || null;
}

function inTask(tabId) {
  return task.tabs.has(tabId);
}

function tabIdOf(targetId) {
  const tabId = Number(targetId);
  if (!Number.isInteger(tabId) || !inTask(tabId)) {
    throw new ProviderError(-32000, "the tab is not one of this task's tabs");
  }
  return tabId;
}

function describeTab(tab) {
  const opener = Number.isInteger(tab.openerTabId) && inTask(tab.openerTabId) ? String(tab.openerTabId) : "";
  return { targetId: String(tab.id), type: "page", url: tab.url || tab.pendingUrl || "", title: tab.title || "",
    openerId: opener };
}

function webUrl(url) {
  return typeof url === "string" && /^(https?:\/\/|about:blank$)/.test(url);
}

// The task's window and own tabs, kept in session storage so a restarted service worker can close what the task
// left open and let go of every tab this extension still debugs.
function persistTask() {
  void chrome.storage.session.set({ task: { windowId: task.windowId, created: [...task.created] } });
}

async function closeLeftoverTask() {
  for (const target of await chrome.debugger.getTargets()) {
    if (target.attached && Number.isInteger(target.tabId)) {
      try { await chrome.debugger.detach({ tabId: target.tabId }); } catch { /* another client's attachment */ }
    }
  }
  const { task: leftover } = await chrome.storage.session.get("task");
  for (const tabId of leftover?.created || []) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
  await chrome.storage.session.remove("task");
}

async function openTab(url, epoch) {
  if (!webUrl(url)) throw new ProviderError(-32602, "a task tab opens only an http(s) URL or about:blank");
  if (task.windowId === null) {
    const window = await chrome.windows.create({ url, focused: false, type: "normal" });
    if (epoch !== connection) {
      try { await chrome.windows.remove(window.id); } catch {}
      assertCurrent(epoch);
    }
    task.windowId = window.id;
    const tabId = window.tabs[0].id;
    task.tabs.add(tabId);
    task.created.add(tabId);
    persistTask();
    void chrome.action.setBadgeText({ text: "ON" });
    return { targetId: String(tabId) };
  }
  const tab = await chrome.tabs.create({ windowId: task.windowId, url, active: true });
  if (epoch !== connection) {
    try { await chrome.tabs.remove(tab.id); } catch {}
    assertCurrent(epoch);
  }
  task.tabs.add(tab.id);
  task.created.add(tab.id);
  persistTask();
  return { targetId: String(tab.id) };
}

async function attachTab(targetId, epoch) {
  const tabId = tabIdOf(targetId);
  if (task.tabSessions.has(tabId)) throw new ProviderError(-32000, "the tab is already attached");
  await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  if (epoch !== connection || !inTask(tabId)) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    assertCurrent(epoch);
    throw new ProviderError(-32000, "the tab left the task while it was being attached");
  }
  const sessionId = `userBrowser:${tabId}:${++sessionCounter}`;
  task.sessions.set(sessionId, tabId);
  task.tabSessions.set(tabId, sessionId);
  return { sessionId };
}

async function detachSession(sessionId) {
  const tabId = task.sessions.get(sessionId);
  if (tabId === undefined) return { detached: false };
  task.sessions.delete(sessionId);
  task.tabSessions.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch {}
  return { detached: true };
}

function forgetDownload(expectationId) {
  const expectation = downloads.expectations.get(expectationId);
  if (!expectation) return { forgotten: false };
  clearTimeout(expectation.timer);
  downloads.expectations.delete(expectationId);
  if (expectation.downloadId !== null) downloads.claimed.delete(expectation.downloadId);
  return { forgotten: true };
}

function expectDownload(sessionId, timeoutMs, epoch) {
  const tabId = task.sessions.get(sessionId);
  if (tabId === undefined) throw new ProviderError(-32001, "session is not attached");
  const wait = Number(timeoutMs);
  if (!Number.isInteger(wait) || wait < 1 || wait > DOWNLOAD_WAIT_MAX_MS) {
    throw new ProviderError(-32602, `timeoutMs must be an integer from 1 to ${DOWNLOAD_WAIT_MAX_MS}`);
  }
  const id = `download:${++expectationCounter}`;
  const expectation = { id, tabId, epoch, urls: new Set(), downloadId: null, ambiguous: false, timer: null };
  // Dropped a little after the control host stops waiting, so an expectation it never ended does not linger.
  expectation.timer = setTimeout(() => forgetDownload(id), wait + 10000);
  downloads.expectations.set(id, expectation);
  return { expectation: id };
}

function namesUrl(expectation, item) {
  return expectation.urls.has(item.url) || (Boolean(item.finalUrl) && expectation.urls.has(item.finalUrl));
}

// Claims the item for the armed expectation whose tab named its URL. A second item of a URL an expectation already
// claimed makes that expectation ambiguous: a download item names no tab, so neither can be told to be the task's.
function claimDownload(item) {
  for (const expectation of downloads.expectations.values()) {
    if (expectation.epoch !== connection || !namesUrl(expectation, item)) continue;
    if (expectation.downloadId !== null) {
      if (expectation.downloadId !== item.id) expectation.ambiguous = true;
      return true;
    }
    expectation.downloadId = item.id;
    downloads.claimed.set(item.id, expectation);
    downloads.recent = downloads.recent.filter((entry) => entry.id !== item.id);
    if (item.state === "complete" || item.state === "interrupted") void reportDownload(item.id);
    return true;
  }
  return false;
}

async function reportDownload(downloadId) {
  const expectation = downloads.claimed.get(downloadId);
  if (!expectation) return;
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || (item.state !== "complete" && item.state !== "interrupted")) return;
  // A moment for a second download of the same URL to show itself (and make the expectation ambiguous) before a file
  // is handed over.
  await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_AMBIGUITY_GRACE_MS));
  // Forgotten meanwhile (the control host stopped waiting): nothing is reported.
  if (downloads.expectations.get(expectation.id) !== expectation) {
    downloads.claimed.delete(downloadId);
    return;
  }
  forgetDownload(expectation.id);
  if (expectation.epoch !== connection) return;
  if (expectation.ambiguous) {
    event("PyprocUserBrowser.download", { expectation: expectation.id, state: "ambiguous" });
    return;
  }
  event("PyprocUserBrowser.download", item.state === "complete"
    ? { expectation: expectation.id, state: "complete", path: item.filename, mimeType: item.mime || "",
      url: item.finalUrl || item.url || "", byteLength: item.fileSize }
    : { expectation: expectation.id, state: "interrupted", error: item.error || "" });
}

async function endTask(reason) {
  for (const id of [...downloads.expectations.keys()]) forgetDownload(id);
  downloads.recent = [];
  const created = [...task.created];
  const sessions = [...task.sessions.keys()];
  task.windowId = null;
  task.tabs.clear();
  task.created.clear();
  for (const sessionId of sessions) await detachSession(sessionId);
  // Tabs the user handed over (dragged into the window, or opened there themselves) are never closed.
  for (const tabId of created) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
  await chrome.storage.session.remove("task");
  void chrome.action.setBadgeText({ text: "" });
  return { ended: true, reason };
}

async function command(sessionId, method, params) {
  const tabId = task.sessions.get(sessionId);
  if (tabId === undefined) throw new ProviderError(-32001, "session is not attached");
  const domain = String(method).split(".")[0];
  if (!ALLOWED_DOMAINS.has(domain) || DENIED_METHODS.has(method)) {
    throw new ProviderError(-32000, `${method} is refused in a user browser`);
  }
  // A task tab stays on the web: no file, extension, or browser pages.
  if (method === "Page.navigate" && !webUrl(params?.url)) {
    throw new ProviderError(-32000, "a task tab navigates only to an http(s) URL");
  }
  return await chrome.debugger.sendCommand({ tabId }, method, params || {});
}

function cancelPendingPair(message) {
  const pending = pendingPair;
  pendingPair = null;
  if (!pending) return;
  pending.reject(new ProviderError(-32004, message));
  void chrome.action.setBadgeText({ text: "" });
}

function pair(keySha256, epoch) {
  if (!/^[0-9a-f]{64}$/.test(String(keySha256 || ""))) throw new ProviderError(-32602, "keySha256 is required");
  cancelPendingPair("another pairing request replaced this one");
  const answer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => cancelPendingPair("nobody confirmed the pairing in the browser"), PAIRING_WINDOW_MS);
    pendingPair = { keySha256, epoch, resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); } };
  });
  void chrome.action.setBadgeText({ text: "PAIR" });
  void chrome.action.setTitle({ title: "Click to let pyproc work in a window of this browser" });
  return answer;
}

const UNAUTHENTICATED = new Set(["PyprocUserBrowser.status", "PyprocUserBrowser.pair", "PyprocUserBrowser.hello"]);

async function handle(message, epoch) {
  const { method, params = {}, sessionId } = message;
  if (!String(method).startsWith("PyprocUserBrowser.")) {
    if (!authorized()) throw new ProviderError(-32003, "the control host is not paired");
    return await command(sessionId, method, params);
  }
  if (!authorized() && !UNAUTHENTICATED.has(method)) throw new ProviderError(-32003, "the control host is not paired");
  switch (method) {
    case "PyprocUserBrowser.status":
      return { protocolVersion: PROTOCOL_VERSION, product: await product(), profileId: await profileId(),
        paired: Boolean(await pairingSha256()), authorized: authorized() };
    case "PyprocUserBrowser.pair":
      return await pair(params.keySha256, epoch);
    case "PyprocUserBrowser.hello": {
      const expected = await pairingSha256();
      const presented = await sha256Hex(params.key || "");
      assertCurrent(epoch);
      if (!expected || presented !== expected) {
        throw new ProviderError(-32003, "the pairing key is not the one this browser paired with");
      }
      authorizedConnection = epoch;
      return { authorized: true, protocolVersion: PROTOCOL_VERSION, product: await product() };
    }
    case "PyprocUserBrowser.unpair":
      await endTask("unpaired");
      await chrome.storage.local.remove("pairingSha256");
      authorizedConnection = 0;
      return { unpaired: true };
    case "PyprocUserBrowser.openTab":
      return await openTab(params.url, epoch);
    case "PyprocUserBrowser.listTabs": {
      const tabs = [];
      for (const tabId of task.tabs) {
        try { tabs.push(describeTab(await chrome.tabs.get(tabId))); } catch {}
      }
      return { tabs };
    }
    case "PyprocUserBrowser.closeTab": {
      const tabId = tabIdOf(params.targetId);
      if (!task.created.has(tabId)) throw new ProviderError(-32000, "a tab the user handed over is never closed");
      const attachedSession = task.tabSessions.get(tabId);
      if (attachedSession) await detachSession(attachedSession);
      await chrome.tabs.remove(tabId);
      return { closed: true };
    }
    case "PyprocUserBrowser.activateTab":
      await chrome.tabs.update(tabIdOf(params.targetId), { active: true });
      return { activated: true };
    case "PyprocUserBrowser.attachTab":
      return await attachTab(params.targetId, epoch);
    case "PyprocUserBrowser.detachSession":
      return await detachSession(String(params.sessionId || ""));
    case "PyprocUserBrowser.windowState": {
      if (task.windowId === null) return { open: false };
      const window = await chrome.windows.get(task.windowId);
      return { open: true, focused: window.focused, state: window.state };
    }
    case "PyprocUserBrowser.expectDownload":
      return expectDownload(String(sessionId || ""), params.timeoutMs, epoch);
    case "PyprocUserBrowser.forgetDownload":
      return forgetDownload(String(params.expectation || ""));
    case "PyprocUserBrowser.endTask":
      return await endTask("ended");
    default:
      throw new ProviderError(-32601, `'${method}' wasn't found`);
  }
}

function onHostMessage(message) {
  reconnectMs = 1000;
  if (message?.method === "PyprocUserBrowserHost.clientConnected") {
    connection = Number(message.params?.connection) || 0;
    authorizedConnection = 0;
    // Only now does the native host pass this extension's frames to the new client: nothing older reaches it.
    post({ method: "PyprocUserBrowserHost.ready", params: { connection } });
    return;
  }
  if (message?.method === "PyprocUserBrowserHost.clientGone") {
    connection = 0;
    authorizedConnection = 0;
    cancelPendingPair("the control host that asked to pair is gone");
    void endTask("controlHostGone");
    return;
  }
  if (!Number.isInteger(message?.id)) return;
  const epoch = connection;
  handle(message, epoch).then(
    (result) => { if (epoch === connection) post({ id: message.id, result: result || {} }); },
    (error) => {
      if (epoch !== connection) return;
      post({ id: message.id, error: { code: Number.isInteger(error?.code) ? error.code : -32000,
        message: String(error?.message || error) } });
    },
  );
}

async function connect() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch {
    port = null;
    setTimeout(connect, reconnectMs);
    reconnectMs = Math.min(MAX_RECONNECT_MS, reconnectMs * 2);
    return;
  }
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    connection = 0;
    authorizedConnection = 0;
    cancelPendingPair("the native host is gone");
    void endTask("hostGone");
    // Backs off while the host cannot start (not installed, or removed); a host that answers resets it.
    setTimeout(connect, reconnectMs);
    reconnectMs = Math.min(MAX_RECONNECT_MS, reconnectMs * 2);
  });
  post({ method: "PyprocUserBrowserHost.hello", params: { profileId: await profileId(), product: await product(),
    protocolVersion: PROTOCOL_VERSION } });
}

chrome.action.onClicked.addListener(async () => {
  const pending = pendingPair;
  if (!pending || pending.epoch !== connection) return;
  pendingPair = null;
  await chrome.storage.local.set({ pairingSha256: pending.keySha256, pairedAt: new Date().toISOString() });
  await chrome.action.setBadgeText({ text: "" });
  pending.resolve({ paired: true });
});
chrome.tabs.onCreated.addListener((tab) => {
  // A tab a task tab opens (window.open, target=_blank) is the task's own, wherever the browser put it. A tab that
  // appears in the task window any other way (the user opened it there) is handed over: attachable, never closed.
  const openedByTask = Number.isInteger(tab.openerTabId) && inTask(tab.openerTabId);
  if (openedByTask) {
    task.tabs.add(tab.id);
    task.created.add(tab.id);
    persistTask();
    event("PyprocUserBrowser.tabCreated", describeTab(tab));
  } else if (task.windowId !== null && tab.windowId === task.windowId) {
    task.tabs.add(tab.id);
  }
});
chrome.tabs.onAttached.addListener((tabId, info) => {
  // A tab the user drags into the task window is handed over: it may be attached, but is never closed.
  if (task.windowId !== null && info.newWindowId === task.windowId && !inTask(tabId)) task.tabs.add(tabId);
});
chrome.tabs.onDetached.addListener((tabId, info) => {
  if (task.windowId === null || info.oldWindowId !== task.windowId || task.created.has(tabId)) return;
  const sessionId = task.tabSessions.get(tabId);
  task.tabs.delete(tabId);
  if (sessionId) {
    void detachSession(sessionId);
    event("PyprocUserBrowser.detached", { sessionId, reason: "tab_left_task" });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const sessionId = task.tabSessions.get(tabId);
  if (sessionId) {
    task.sessions.delete(sessionId);
    task.tabSessions.delete(tabId);
    event("PyprocUserBrowser.detached", { sessionId, reason: "target_closed" });
  }
  task.tabs.delete(tabId);
  task.created.delete(tabId);
});
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === task.windowId) task.windowId = null;
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (task.windowId !== null) event("PyprocUserBrowser.windowFocus", { focused: windowId === task.windowId });
});
chrome.downloads.onCreated.addListener((item) => {
  if (downloads.expectations.size === 0) return;
  if (claimDownload(item)) return;
  // Page.downloadWillBegin can arrive after the browser made the download; it may still claim it for a while.
  const now = Date.now();
  downloads.recent = [...downloads.recent.filter((entry) => now - entry.at < DOWNLOAD_MATCH_MS), { id: item.id,
    at: now }].slice(-16);
});
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete" || delta.state?.current === "interrupted") void reportDownload(delta.id);
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === "Page.downloadWillBegin") {
    for (const expectation of downloads.expectations.values()) {
      if (expectation.tabId !== source.tabId || expectation.downloadId !== null) continue;
      expectation.urls.add(String(params?.url || ""));
      const now = Date.now();
      for (const entry of downloads.recent.filter((recent) => now - recent.at < DOWNLOAD_MATCH_MS)) {
        void chrome.downloads.search({ id: entry.id }).then(([item]) => item && claimDownload(item));
      }
    }
  }
  const sessionId = task.tabSessions.get(source.tabId);
  if (!sessionId || DROPPED_EVENTS.has(method)) return;
  event(method, String(method).startsWith("Network.") ? withoutCookies(params || {}) : params || {}, sessionId);
});
chrome.debugger.onDetach.addListener((source, reason) => {
  const sessionId = task.tabSessions.get(source.tabId);
  if (!sessionId) return;
  task.sessions.delete(sessionId);
  task.tabSessions.delete(source.tabId);
  event("PyprocUserBrowser.detached", { sessionId, reason });
  // Cancelling the debugging bar withdraws the whole task, not only this tab.
  if (reason === "canceled_by_user") {
    event("PyprocUserBrowser.revoked", { reason });
    void endTask("canceledByUser");
  }
});
void closeLeftoverTask().finally(connect);
