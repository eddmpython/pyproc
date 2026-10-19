// userBrowserSiteRules.mjs - runs the User Browser extension's service worker against an in-process chrome.* and prints
// when a task's site rules were installed and removed, as a list of named checks. The user-browser contract runs it in
// a child process and requires every check.
import { createHash } from "node:crypto";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function listeners() {
  const set = new Set();
  return { addListener: (listener) => set.add(listener), fire: (...args) => [...set].map((listener) => listener(...args)) };
}
const posted = [];
const store = {};
const sessionStore = {};
let nextTab = 100;
let nextWindow = 10;
const tabs = new Map();
let port = null;
const events = { action: listeners(), created: listeners(), attachedTab: listeners(), detachedTab: listeners(),
  removed: listeners(), windowRemoved: listeners(), focus: listeners(), debuggerEvent: listeners(),
  debuggerDetach: listeners(), downloadCreated: listeners(), downloadChanged: listeners() };
const dnr = { rules: new Map(), delayMs: 0, closeMs: 0, rulesAtClose: [] };
// `other`: another extension (or a policy) holds the setting on, so this extension's own setting has no effect.
const prediction = { value: true, controlled: false, other: false };
const newPort = () => ({ onMessage: listeners(), onDisconnect: listeners(), postMessage: (message) => posted.push(message) });
globalThis.chrome = {
  runtime: { connectNative: () => (port = newPort()), id: "fixture" },
  storage: {
    session: { get: async () => ({ ...sessionStore }), set: async (values) => Object.assign(sessionStore, values),
      remove: async (key) => { delete sessionStore[key]; } },
    local: { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, values),
      remove: async (key) => { delete store[key]; } },
  },
  action: { onClicked: events.action, setBadgeText: async () => {}, setTitle: async () => {} },
  windows: {
    create: async ({ url }) => {
      const windowId = nextWindow++;
      const tabId = nextTab++;
      tabs.set(tabId, { id: tabId, windowId, url });
      return { id: windowId, tabs: [{ id: tabId }] };
    },
    remove: async () => {}, get: async (id) => ({ id, focused: false, state: "normal" }),
    onRemoved: events.windowRemoved, onFocusChanged: events.focus,
  },
  tabs: {
    create: async ({ windowId, url }) => { const id = nextTab++; tabs.set(id, { id, windowId, url }); return { id }; },
    remove: async (id) => { await tick(dnr.closeMs); dnr.rulesAtClose.push(dnr.rules.size); tabs.delete(id);
      events.removed.fire(id); },
    get: async (id) => tabs.get(id), update: async () => {},
    onCreated: events.created, onAttached: events.attachedTab, onDetached: events.detachedTab, onRemoved: events.removed,
  },
  downloads: { search: async () => [], onCreated: events.downloadCreated, onChanged: events.downloadChanged },
  debugger: {
    attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}),
    onEvent: events.debuggerEvent, onDetach: events.debuggerDetach,
  },
  declarativeNetRequest: {
    isRegexSupported: async () => ({ isSupported: true }),
    getSessionRules: async () => [...dnr.rules.values()].map((rule) => structuredClone(rule)),
    updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
      await tick(dnr.delayMs);
      for (const id of removeRuleIds) dnr.rules.delete(id);
      for (const rule of addRules) dnr.rules.set(rule.id, structuredClone(rule));
    },
  },
  privacy: { network: { networkPredictionEnabled: {
    set: async ({ value }) => { prediction.value = value; prediction.controlled = true; },
    get: async () => (prediction.other ? { value: true, levelOfControl: "controlled_by_other_extensions" }
      : { value: prediction.value,
        levelOfControl: prediction.controlled ? "controlled_by_this_extension" : "controllable_by_this_extension" }),
    clear: async () => { prediction.value = true; prediction.controlled = false; },
  } } },
};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgentData: {
  getHighEntropyValues: async () => ({ fullVersionList: [{ brand: "Google Chrome", version: "155.0.0.0" }] }) } } });

const KEY = "k".repeat(64);
store.pairingSha256 = createHash("sha256").update(KEY).digest("hex");
// A worker that starts again finds the rules and the prediction setting a task it ran before left.
dnr.rules.set(1000, { id: 1000, action: { type: "block" }, condition: { regexFilter: "^x" } });
prediction.value = false;
prediction.controlled = true;
await import(new URL("../../scripts/browserControl/userBrowser/extension/serviceWorker.js", import.meta.url).href);
await tick(20);

let requestId = 0;
let connection = 0;
const send = (method, params = {}) => {
  const message = { id: ++requestId, method, params };
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
const hello = async () => (await reply(send("PyprocUserBrowser.hello", { key: KEY }))).result;
const block = (hosts = ["link.aff.test"], domains = ["ads.test"]) => send("PyprocUserBrowser.blockSites",
  { hosts, domains });
const held = () => ({ rules: dnr.rules.size, predicting: prediction.value });
const checks = [];
const check = (name, value, expected) => checks.push({ name, ok: JSON.stringify(value) === JSON.stringify(expected),
  value });

check("a restarted worker removes what an ended task left", held(), { rules: 0, predicting: true });
check("the native host is told what the extension can do", posted.find((message) =>
  message.method === "PyprocUserBrowserHost.hello")?.params?.capabilities, ["blockSites"]);
connectClient();
check("an unpaired control host cannot block sites", (await reply(block())).error?.code, -32003);
check("hello names the capability", (await hello()).capabilities, ["blockSites"]);
const installed = (await reply(block(["LINK.aff.test."], ["ads.test"]))).result;
check("the answer says the extension enforces them", [installed.enforcedBy, installed.blockedHosts,
  installed.blockedDomains, installed.preloading], ["extension", ["link.aff.test"], ["ads.test"], "off"]);
check("rules and prediction are held", held(), { rules: 2, predicting: false });
check("every rule blocks every request type", [...dnr.rules.values()].every((rule) => rule.action.type === "block"
  && rule.condition.resourceTypes.includes("main_frame") && rule.condition.resourceTypes.length === 15), true);
check("a malformed host is refused", (await reply(block(["https://link.aff.test"], []))).error?.code, -32602);
check("the refused call kept the rules it replaced", held(), { rules: 2, predicting: false });
await reply(send("PyprocUserBrowser.openTab", { url: "https://shop.example/" }));
check("no rules change once the task has a tab", (await reply(block())).error?.message,
  "sites are blocked before the task opens its first tab");
dnr.closeMs = 30;
dnr.rulesAtClose = [];
await reply(send("PyprocUserBrowser.endTask"));
dnr.closeMs = 0;
check("the task's tabs close while the rules still hold", dnr.rulesAtClose, [2]);
check("ending the task removes them and gives prediction back", held(), { rules: 0, predicting: true });

await reply(block());
leave();
await tick(60);
check("a control host that goes takes its rules with it", held(), { rules: 0, predicting: true });

// The next control host blocks sites while the last one's task is still being ended: its rules stay.
connectClient();
await hello();
await reply(block(["a.example"], []));
await reply(send("PyprocUserBrowser.openTab", { url: "https://shop.example/" }));
dnr.closeMs = 50;
leave();
connectClient();
await hello();
const next = (await reply(block(["b.example"], []))).result;
await tick(120);
dnr.closeMs = 0;
check("the next task's rules survive the last task's release", [next.blockedHosts, [...dnr.rules.values()]
  .map((rule) => rule.condition.regexFilter.includes("b\\.example"))], [["b.example"], [true]]);

// An answer that settles after its control host left is undone.
dnr.delayMs = 40;
await reply(send("PyprocUserBrowser.endTask"));
const late = block();
await tick(5);
leave();
await tick(200);
check("rules installed for a control host that left are removed", [Boolean(posted.find((m) => m.id === late)),
  held()], [false, { rules: 0, predicting: true }]);
dnr.delayMs = 0;

// The native host going away ends the task, and the rules with it.
connectClient();
await hello();
await reply(block());
port.onDisconnect.fire();
await tick(60);
check("a native host that goes ends the task and its rules", held(), { rules: 0, predicting: true });

// Cancelling the debugging bar ends the task and its rules; the same control host then opens no tab without them.
const gonePort = port;
for (let attempt = 0; attempt < 400 && port === gonePort; attempt += 1) await tick(10); // the worker reconnects
connectClient();
await hello();
await reply(block());
const opened = (await reply(send("PyprocUserBrowser.openTab", { url: "https://shop.example/" }))).result;
await reply(send("PyprocUserBrowser.attachTab", { targetId: opened.targetId }));
events.debuggerDetach.fire({ tabId: Number(opened.targetId) }, "canceled_by_user");
await tick(60);
check("cancelling the debugging bar removes the rules", held(), { rules: 0, predicting: true });
const windowsBefore = nextWindow;
const reopened = await reply(send("PyprocUserBrowser.openTab", { url: "https://shop.example/" }));
check("the same control host opens no tab without its rules", [reopened.error?.message, nextWindow - windowsBefore],
  ["this task's site rules ended with it; the control host starts a new task", 0]);
check("blocking sites again before a new first tab is allowed", (await reply(block())).result?.enforcedBy, "extension");
await reply(send("PyprocUserBrowser.endTask"));
// A control host that never asked for site rules is not held to them.
leave();
connectClient();
await hello();
const plain = (await reply(send("PyprocUserBrowser.openTab", { url: "https://shop.example/" }))).result;
await reply(send("PyprocUserBrowser.attachTab", { targetId: plain.targetId }));
events.debuggerDetach.fire({ tabId: Number(plain.targetId) }, "canceled_by_user");
await tick(60);
check("a task without site rules opens a tab again after a cancel",
  Boolean((await reply(send("PyprocUserBrowser.openTab", { url: "https://shop.example/" }))).result?.targetId), true);

// Another extension or a policy keeps network prediction on: a refused navigation would still open a connection to the
// blocked site, so the task gets no rules, prediction is given back, and the control host starts nothing.
await reply(send("PyprocUserBrowser.endTask"));
leave();
connectClient();
await hello();
prediction.other = true;
const predicting = await reply(block());
check("a profile whose prediction another extension keeps on gets no rules", [predicting.error?.code,
  /network prediction/.test(predicting.error?.message || ""), dnr.rules.size, prediction.controlled],
[-32000, true, 0, false]);
prediction.other = false;
check("once nothing else keeps it on the same control host blocks sites",
  (await reply(block())).result?.preloading, "off");
await reply(send("PyprocUserBrowser.endTask"));

console.log(JSON.stringify(checks));
process.exit(0);
