// userBrowserWorker.mjs - runs the User Browser extension's service worker against an in-process chrome.* and prints
// what each boundary scenario produced. The user-browser contract runs it in a child process and checks the result.
import { createHash } from "node:crypto";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function listeners() {
  const set = new Set();
  return { addListener: (listener) => set.add(listener), fire: (...args) => [...set].map((listener) => listener(...args)) };
}
const posted = [];
const store = {};
let nextTab = 100;
let nextWindow = 10;
const tabs = new Map();
const attached = new Set();
const port = { onMessage: listeners(), onDisconnect: listeners(), postMessage: (message) => posted.push(message) };
const events = { action: listeners(), created: listeners(), attachedTab: listeners(), detachedTab: listeners(),
  removed: listeners(), windowRemoved: listeners(), focus: listeners(), debuggerEvent: listeners(), debuggerDetach: listeners() };
globalThis.chrome = {
  runtime: { connectNative: () => port, id: "fixture" },
  storage: {
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    local: { get: async (key) => { await tick(5); return { [key]: store[key] }; },
      set: async (values) => Object.assign(store, values), remove: async (key) => { delete store[key]; } },
  },
  action: { onClicked: events.action, setBadgeText: async () => {}, setTitle: async () => {} },
  windows: {
    create: async ({ url }) => {
      const windowId = nextWindow++;
      const tabId = nextTab++;
      tabs.set(tabId, { id: tabId, windowId, url });
      events.created.fire({ id: tabId, windowId });
      await tick(30);
      return { id: windowId, tabs: [{ id: tabId }] };
    },
    remove: async (windowId) => { for (const [id, tab] of tabs) if (tab.windowId === windowId) tabs.delete(id); },
    get: async (id) => ({ id, focused: false, state: "normal" }), onRemoved: events.windowRemoved,
    onFocusChanged: events.focus,
  },
  tabs: {
    create: async ({ windowId, url }) => {
      const tabId = nextTab++;
      tabs.set(tabId, { id: tabId, windowId, url });
      events.created.fire({ id: tabId, windowId });
      await tick(30);
      return { id: tabId };
    },
    remove: async (id) => { tabs.delete(id); attached.delete(id); events.removed.fire(id); },
    get: async (id) => tabs.get(id), update: async () => {},
    onCreated: events.created, onAttached: events.attachedTab, onDetached: events.detachedTab, onRemoved: events.removed,
  },
  debugger: {
    getTargets: async () => [],
    attach: async ({ tabId }) => { await tick(30); attached.add(tabId); },
    detach: async ({ tabId }) => { await tick(5); attached.delete(tabId); },
    sendCommand: async (_target, method) => ({ method }),
    onEvent: events.debuggerEvent, onDetach: events.debuggerDetach,
  },
};

const KEY = "k".repeat(64);
const KEY_SHA256 = createHash("sha256").update(KEY).digest("hex");
store.pairingSha256 = KEY_SHA256;
await import(new URL("../../scripts/browserControl/userBrowser/extension/serviceWorker.js", import.meta.url).href);
await tick(20);

let requestId = 0;
let connection = 0;
const send = (method, params = {}, sessionId = undefined) => {
  const message = { id: ++requestId, method, params, ...(sessionId ? { sessionId } : {}) };
  port.onMessage.fire(message);
  return message.id;
};
const reply = async (id) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = posted.find((message) => message.id === id);
    if (found) return found;
    await tick(5);
  }
  return null;
};
const connectClient = () => port.onMessage.fire({ method: "PyprocUserBrowserHost.clientConnected",
  params: { connection: ++connection, clientPid: 1 } });
const leave = () => port.onMessage.fire({ method: "PyprocUserBrowserHost.clientGone", params: { connection } });
const hello = async () => reply(send("PyprocUserBrowser.hello", { key: KEY }));
const out = {};

// A hello that settles after its client left never authorizes the next client, and its reply is dropped.
connectClient();
const lateHello = send("PyprocUserBrowser.hello", { key: KEY });
leave();
connectClient();
await tick(40);
out.lateHelloReplied = Boolean(posted.find((message) => message.id === lateHello));
out.nextClientAuthorized = !(await reply(send("PyprocUserBrowser.listTabs"))).error;
out.readyAcknowledged = posted.filter((message) => message.method === "PyprocUserBrowserHost.ready")
  .map((message) => message.params.connection);

// A tab being opened when its client leaves is closed again.
await hello();
send("PyprocUserBrowser.openTab", { url: "https://a.example/" });
await tick(1);
leave();
await tick(80);
out.tabsLeftAfterOpenRace = tabs.size;

// An attachment finishing after its client left is undone, and nothing reaches the next, unpaired client.
connectClient();
await hello();
const opened = await reply(send("PyprocUserBrowser.openTab", { url: "https://a.example/" }));
const taskWindow = tabs.get(Number(opened.result.targetId)).windowId;
const handedOver = 500;
tabs.set(handedOver, { id: handedOver, windowId: taskWindow });
events.attachedTab.fire(handedOver, { newWindowId: taskWindow });
send("PyprocUserBrowser.attachTab", { targetId: String(handedOver) });
await tick(1);
leave();
await tick(80);
connectClient();
const before = posted.length;
events.debuggerEvent.fire({ tabId: handedOver }, "Network.requestWillBeSent", { request: { url: "https://a.example/x" } });
out.handedOverStillAttached = attached.has(handedOver);
out.eventReachedUnpairedClient = posted.slice(before).some((message) => message.method === "Network.requestWillBeSent");
out.handedOverTabKept = tabs.has(handedOver);

// A pairing whose requester left is withdrawn; a later click changes nothing.
const pairing = send("PyprocUserBrowser.pair", { keySha256: "a".repeat(64) });
await tick(5);
leave();
connectClient();
events.action.fire();
await tick(20);
out.pairingKeptAfterRequesterLeft = store.pairingSha256 === KEY_SHA256;
out.pairingRepliedToNextClient = Boolean(posted.find((message) => message.id === pairing));

// Tab-closing and history methods are refused; navigation stays on http(s); cookie headers never leave.
await hello();
const own = await reply(send("PyprocUserBrowser.openTab", { url: "https://b.example/" }));
const session = (await reply(send("PyprocUserBrowser.attachTab", { targetId: own.result.targetId }))).result.sessionId;
out.refused = {};
for (const [method, params] of [["Page.close", {}], ["Page.navigateToHistoryEntry", { entryId: 1 }],
  ["Page.navigate", { url: "file:///C:/Windows/win.ini" }], ["Network.getCookies", {}], ["Target.getTargets", {}]]) {
  out.refused[method] = Boolean((await reply(send(method, params, session))).error);
}
out.navigateHttpAllowed = !(await reply(send("Page.navigate", { url: "https://b.example/next" }, session))).error;
const ownTabId = Number(own.result.targetId);
const cookieStart = posted.length;
events.debuggerEvent.fire({ tabId: ownTabId }, "Network.requestWillBeSent",
  { request: { url: "https://b.example/", headers: { Cookie: "sid=1", Accept: "text/html" } } });
events.debuggerEvent.fire({ tabId: ownTabId }, "Network.responseReceived",
  { response: { headers: { "Set-Cookie": "sid=2", "Content-Type": "text/html" }, requestHeaders: { cookie: "sid=1" } } });
events.debuggerEvent.fire({ tabId: ownTabId }, "Network.requestWillBeSentExtraInfo", { headers: { Cookie: "sid=1" } });
const forwarded = posted.slice(cookieStart);
out.cookieHeadersForwarded = JSON.stringify(forwarded).toLowerCase().includes("sid=");
out.extraInfoForwarded = forwarded.some((message) => message.method === "Network.requestWillBeSentExtraInfo");
out.otherHeadersKept = forwarded.some((message) => message.params?.request?.headers?.Accept === "text/html");

// A tab the user opens in the task window is attachable but never closed with the task.
const userTab = 600;
tabs.set(userTab, { id: userTab, windowId: tabs.get(ownTabId).windowId });
events.created.fire({ id: userTab, windowId: tabs.get(ownTabId).windowId });
out.userTabAttachable = !(await reply(send("PyprocUserBrowser.attachTab", { targetId: String(userTab) }))).error;
out.userTabClosable = !(await reply(send("PyprocUserBrowser.closeTab", { targetId: String(userTab) }))).error;
await reply(send("PyprocUserBrowser.endTask"));
out.userTabKeptAfterEnd = tabs.has(userTab);
out.ownTabClosedAtEnd = !tabs.has(ownTabId);

console.log(JSON.stringify(out));
process.exit(0);
