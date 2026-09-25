// requestGuardProduct.mjs - read-only browsing gate: in a session opened with requests "safe", no request that could
// change a server reaches it and no socket connects, from any place a page can send one (a tab closing included), and no
// download is saved, while GET navigation, reads, new tabs, and the page's own bytes keep working. A control session
// with requests "any" runs the same pages and proves every one of those channels does reach the server, so the gate
// cannot pass vacantly (downloads have no control run: it would save into the machine's Downloads folder).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NativeCdpSpace } from "../../scripts/automationSpace/nativeCdpSpace.js";
import { parseBrowserControlConfig } from "../../scripts/browserControl/mcpBrowserControl.js";
import { requestGuardLaunchArgs } from "../../scripts/browserControl/requestGuard.mjs";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";
import { APX_REPRESENTATION } from "../../scripts/perception/apxCatalog.js";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { launchBrowser } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const POPUP_PAGES = 5;
// "안녕" in EUC-KR: a page whose bytes are not UTF-8 must reach the tab unchanged after the guard re-serves it.
const EUC_KR_HELLO = Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]);
// A download name no earlier run left behind.
const DOWNLOAD_NAME = `pyprocGuard-${process.pid}-${Date.now()}.bin`;

const seen = [];
const upgrades = [];
let frameOrigin = "";

// The first script of a page tries a socket before anything else runs; the title says whether it was constructed.
const firstScriptSocket = (tag) => `<script>
try { new WebSocket("ws://" + location.host + "/sink/ws-${tag}"); document.title = "socket-tried"; }
catch { document.title = "socket-refused"; }
</script>`;
const WORKER_SCRIPT = `fetch("/sink/url-worker-post", { method: "POST", body: "x" }).catch(() => {});
try { new WebSocket("ws://" + location.host + "/sink/ws-url-worker"); } catch {}
postMessage("ran");`;
// A service worker sends a POST of its own when asked and passes a controlled page's POST through its fetch handler.
const SERVICE_WORKER = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname === "/sink/via-sw") event.respondWith(fetch(event.request));
});
self.addEventListener("message", (event) => {
  fetch("/sink/sw-post", { method: "POST", body: "x" }).then(() => "sent", () => "refused")
    .then((outcome) => event.source.postMessage(outcome));
});`;

function page(body, head = "") {
  return `<!doctype html><html><head><meta charset="utf-8">${head}<title>guard</title></head><body>${body}</body></html>`;
}

function pageFor(pathname, search) {
  if (pathname === "/guard.html") {
    return page(`<h1>Guard</h1>
<form id="postForm" method="post" action="/sink/form-post"><input name="q" value="1"></form>
<form id="getForm" method="get" action="/sink/get-form"><input name="q" value="1"></form>
<iframe id="frame" src="${frameOrigin}/frame.html"></iframe>
<iframe name="sinkFrame"></iframe>
<a id="pingLink" href="/sink/ping-target" ping="/sink/ping" target="sinkFrame">ping</a>
<a id="crossLink" href="${frameOrigin}/guard-popup.html?via=link" target="_blank">cross-site tab</a>`);
  }
  if (pathname === "/frame.html") {
    // An out-of-process frame: its first script tries a socket, then an about:blank child's socket.
    return page(`<p>frame</p><script>
fetch("/sink/frame-post", { method: "POST", body: "x" }).catch(() => {});
fetch("/sink/frame-get").catch(() => {});
const child = document.createElement("iframe");
document.body.appendChild(child);
try { new child.contentWindow.WebSocket("ws://" + location.host + "/sink/ws-oopif-child"); } catch {}
</script>`, firstScriptSocket("oopif"));
  }
  if (pathname === "/guard-popup.html") return page("<p>popup</p>", firstScriptSocket(`popup-${search.get("via") || "n"}`));
  if (pathname === "/guard-cached.html") return page("<p>cached</p>", firstScriptSocket("cached"));
  if (pathname === "/guard-unload.html") {
    // A page that sends as it goes away, the way analytics and draft autosave do.
    return page(`<p>unload</p><script>
for (const kind of ["pagehide", "visibilitychange", "unload"]) {
  addEventListener(kind, () => {
    navigator.sendBeacon("/sink/close-beacon-" + kind, "x");
    fetch("/sink/close-keep-" + kind, { method: "POST", body: "x", keepalive: true }).catch(() => {});
  });
}
</script>`);
  }
  return page("<p>sink</p>");
}

const handler = async (req, res) => {
  const url = new URL(req.url, "http://fixture.invalid");
  if (!url.pathname.startsWith("/guard") && !url.pathname.startsWith("/sink") && url.pathname !== "/frame.html") {
    return false;
  }
  for await (const _chunk of req) { /* drain the body */ }
  if (url.pathname.startsWith("/sink")) seen.push({ method: req.method, path: url.pathname });
  if (url.pathname === "/guard-sw.js" || url.pathname === "/guard-worker.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(url.pathname === "/guard-sw.js" ? SERVICE_WORKER : WORKER_SCRIPT);
    return true;
  }
  if (url.pathname === "/guard-download.bin") {
    res.writeHead(200, { "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${DOWNLOAD_NAME}"` });
    res.end("download");
    return true;
  }
  if (url.pathname === "/guard-euckr.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=euc-kr" });
    res.end(Buffer.concat([Buffer.from("<!doctype html><title>euc</title><p id=hello>"), EUC_KR_HELLO,
      Buffer.from("</p>")]));
    return true;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*",
    "Cache-Control": url.pathname === "/guard-cached.html" ? "max-age=3600" : "no-cache" });
  res.end(pageFor(url.pathname, url.searchParams));
  return true;
};

const mainServer = createStaticServer(handler, { coi: false });
const frameServer = createStaticServer(handler, { coi: false });
for (const server of [mainServer, frameServer]) {
  server.on("upgrade", (req, socket) => { upgrades.push(new URL(req.url, "http://x.invalid").pathname); socket.destroy(); });
}
await new Promise((resolve) => mainServer.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => frameServer.listen(0, "127.0.0.1", resolve));
const mainOrigin = `http://127.0.0.1:${mainServer.address().port}`;
// A different host is a different site, so the frame and cross-site tabs run in processes of their own.
frameOrigin = `http://localhost:${frameServer.address().port}`;

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

// The session is built the way a product host builds it: manifest, validated environment, the browser started with
// the request mode's arguments, then the native CDP space that serves automation.* operations.
async function session(requests, allowedOrigins = [mainOrigin, frameOrigin]) {
  const { env } = validateMcpProductConfig({
    schemaVersion: 1,
    engine: { enabled: false },
    browser: {
      enabled: true, provider: "nativeCdp", allowedOrigins, maxRisk: "externalEffect",
      actions: ["snapshot", "navigate"], methods: ["Runtime.enable", "Runtime.evaluate"], externalEffects: "acknowledged",
      purpose: "read-only browsing gate", ...(requests === "any" ? {} : { requests }),
    },
    timeoutMs: TIMEOUT_MS,
  });
  const browser = launchBrowser("about:blank", { prefix: `pyprocRequestGuard-${requests}-`, cdpPipe: true,
    extraArgs: requestGuardLaunchArgs(requests) });
  const space = new NativeCdpSpace({ profileDir: browser.profile, cdpPipe: browser.cdpPipe,
    config: parseBrowserControlConfig(env, { timeoutMs: TIMEOUT_MS }), auditWriter: () => {} });
  // Every refusal an observe or act result carries is kept, whichever call happened to drain it.
  const blocked = [];
  const run = async (operation, input) => {
    const output = await space.execute(operation, input, { authority: space.authorize(operation, input) });
    if (Array.isArray(output?.blockedRequests)) blocked.push(...output.blockedRequests);
    return output;
  };
  const target = await run("automation.target.open",
    { url: `${mainOrigin}/guard.html`, expectedRisk: "externalEffect", waitUntil: "load" });
  const sessionRef = await run("automation.session.attach", { targetRef: target.targetRef });
  const evaluate = async (expression) => {
    const output = await run("automation.command", { sessionRef, method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true }, expectedRisk: "externalEffect" });
    return output?.result?.result?.value;
  };
  const observe = (representation) => run("automation.observe",
    { sessionRef, expectedRisk: "read", ...(representation ? { representation } : {}) });
  const navigate = (url) => run("automation.act",
    { sessionRef, actions: [{ kind: "navigate", url, waitUntil: "load", expectedRisk: "externalEffect" }] });
  // A tab of its own whose page sends as it goes away, closed through pyproc the way a host closes a tab.
  const closeUnloadingTab = async () => {
    const tab = await run("automation.target.open",
      { url: `${mainOrigin}/guard-unload.html`, expectedRisk: "externalEffect", waitUntil: "load" });
    await delay(300);
    await run("automation.target.close", { targetRef: tab.targetRef, expectedRisk: "externalEffect" });
    // The page itself closes a popup it opened: no session of pyproc's is involved in that close.
    await evaluate(`(() => { const popup = window.open("/guard-unload.html?by=page", "_blank");
      setTimeout(() => popup.close(), 800); return 1; })()`);
    await delay(2500);
  };
  return { browser, space, run, evaluate, observe, navigate, blocked, closeUnloadingTab };
}

const SENDS = `(async () => {
  const outcome = {};
  const within = (promise, label) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(label), 5000))]);
  outcome.fetchPost = await fetch("/sink/fetch-post", { method: "POST", body: "x" }).then(() => "sent", () => "refused");
  outcome.fetchPut = await fetch("/sink/fetch-put", { method: "PUT", body: "x" }).then(() => "sent", () => "refused");
  outcome.fetchGet = await fetch("/sink/fetch-get").then((response) => response.status, () => "refused");
  outcome.beacon = navigator.sendBeacon("/sink/beacon", "x");
  outcome.keepalive = await fetch("/sink/keepalive", { method: "POST", body: "x", keepalive: true })
    .then(() => "sent", () => "refused");
  document.getElementById("pingLink").click();
  const registration = await navigator.serviceWorker.register("/guard-sw.js")
    .catch((error) => (error.name === "SecurityError" ? null : Promise.reject(error)));
  outcome.serviceWorker = registration ? await within(navigator.serviceWorker.ready.then(() => "ready"), "never ready")
    : "refused";
  if (outcome.serviceWorker === "ready" && !navigator.serviceWorker.controller) {
    outcome.serviceWorker = await within(new Promise((resolve) => navigator.serviceWorker.addEventListener(
      "controllerchange", () => resolve("ready"), { once: true })), "never controlling");
  }
  if (outcome.serviceWorker === "ready") {
    outcome.swPost = await within(new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("message", (event) => resolve(event.data), { once: true });
      registration.active.postMessage("send");
    }), "timeout");
    outcome.viaSw = await within(fetch("/sink/via-sw", { method: "POST", body: "x" }).then(() => "sent", () => "refused"),
      "timeout");
  }
  try { new SharedWorker(URL.createObjectURL(new Blob(["1"], { type: "text/javascript" }))); outcome.sharedWorker = "created"; }
  catch { outcome.sharedWorker = "refused"; }
  const ws = (path) => "try { new WebSocket(" + JSON.stringify("ws://" + location.host + path) + "); } catch {}";
  const blob = (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(blob(
    "fetch(" + JSON.stringify(location.origin + "/sink/worker-post") + ", { method: 'POST', body: 'x' }).catch(() => {});"
    + ws("/sink/ws-worker")
    + "const nested = new Worker(" + JSON.stringify(blob(ws("/sink/ws-nested-worker") + "postMessage('nested');")) + ");"
    + "const fromUrl = new Worker(" + JSON.stringify(location.origin + "/guard-worker.js") + ");"
    + "let heard = 0; const done = () => { heard += 1; if (heard === 2) postMessage('ran'); };"
    + "nested.onmessage = done; fromUrl.onmessage = done;"
  ));
  outcome.workerRan = await within(new Promise((resolve) => { worker.onmessage = () => resolve(true); }), false);
  outcome.hasStream = typeof WebSocketStream === "function";
  if (outcome.hasStream) {
    try { new WebSocketStream("ws://" + location.host + "/sink/ws-stream"); } catch {}
  }
  outcome.socket = await new Promise((resolve) => {
    let socket;
    try { socket = new WebSocket("ws://" + location.host + "/sink/ws-page"); }
    catch { resolve("refused"); return; }
    socket.onopen = () => resolve("open");
    socket.onerror = () => resolve("refused");
    setTimeout(() => resolve("timeout"), 3000);
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  worker.terminate();
  return outcome;
})()`;

// Each popup needs its own user gesture, so each is a separate evaluation. The opener reaches a same-site popup's
// globals before any script of the popup runs, which is why that popup's socket is tried from the opener.
const POPUP_SOCKET = `(() => {
  const popup = window.open("", "_blank");
  if (!popup) return "no popup";
  let outcome = "created";
  try { new popup.WebSocket("ws://" + location.host + "/sink/ws-opener-popup"); } catch { outcome = "refused"; }
  setTimeout(() => popup.close(), 1000);
  return outcome;
})()`;
const POPUP_FORM = `(() => {
  const form = document.createElement("form");
  Object.assign(form, { method: "post", action: "/sink/popup-post", target: "_blank" });
  document.body.appendChild(form);
  form.submit();
  return "submitted";
})()`;
const NEW_TABS = [
  ...Array.from({ length: POPUP_PAGES }, (_, index) => `window.open("/guard-popup.html?via=same${index}", "_blank")`),
  `window.open("/guard-popup.html?via=noopener", "_blank", "noopener")`,
  `window.open(FRAME + "/guard-popup.html?via=cross", "_blank")`,
  `document.getElementById("crossLink").click()`,
];

async function sendAll(item) {
  const outcome = await item.evaluate(SENDS);
  outcome.popupSocket = await item.evaluate(POPUP_SOCKET);
  await item.evaluate(POPUP_FORM);
  for (const opener of NEW_TABS) {
    await item.evaluate(`(() => { const FRAME = ${JSON.stringify(frameOrigin)}; ${opener}; return 1; })()`);
  }
  await delay(2000);
  const targets = await item.run("automation.target.list", {});
  outcome.newTabs = targets.filter((target) => target.url.includes("/guard-popup.html")).map((target) => target.title);
  // A page served from the cache on a second visit is guarded like the first.
  await item.navigate(`${mainOrigin}/guard-cached.html`);
  await item.navigate(`${mainOrigin}/guard.html`);
  await item.navigate(`${mainOrigin}/guard-cached.html`);
  await delay(500);
  await item.navigate(`${mainOrigin}/guard-euckr.html`);
  outcome.eucKr = await item.evaluate(`document.getElementById("hello").textContent`);
  await item.navigate(`${mainOrigin}/guard.html`);
  await delay(500);
  return outcome;
}

const SOCKET_PATHS = ["/sink/ws-page", "/sink/ws-worker", "/sink/ws-nested-worker", "/sink/ws-url-worker",
  "/sink/ws-oopif", "/sink/ws-oopif-child", "/sink/ws-opener-popup", "/sink/ws-popup-same0", "/sink/ws-popup-noopener",
  "/sink/ws-popup-cross", "/sink/ws-popup-link", "/sink/ws-cached"];

console.log("pyproc read-only browsing gate");
const opened = [];
try {
  const guarded = await session("safe");
  opened.push(guarded);
  const outcome = await sendAll(guarded);
  await guarded.evaluate(`document.getElementById("postForm").submit(); "submitted"`);
  await delay(1500);
  const stayed = await guarded.evaluate("location.pathname");
  await guarded.evaluate(`document.getElementById("getForm").submit(); "submitted"`);
  await delay(1500);
  const moved = await guarded.evaluate("location.pathname + location.search");
  await guarded.closeUnloadingTab();
  await guarded.navigate(`${mainOrigin}/guard-download.bin`).catch(() => {});
  await delay(1500);
  await guarded.observe();
  const blocked = [...guarded.blocked];
  const unsafe = seen.filter((request) => request.method !== "GET");
  const blockedPaths = new Set(blocked.map((item) => `${item.method} ${new URL(item.url).pathname}`));

  check("no request other than GET reaches any server", unsafe.length === 0, JSON.stringify(unsafe));
  check("no socket connects, from a page, a frame, a new tab, a worker, a nested worker, a stream, or a cached page",
    upgrades.length === 0, upgrades.join(","));
  check("page fetch POST and PUT are refused in the page", outcome.fetchPost === "refused" && outcome.fetchPut === "refused",
    JSON.stringify(outcome));
  check("service workers and shared workers are refused, since nothing can be refused inside them before they run",
    outcome.serviceWorker === "refused" && outcome.sharedWorker === "refused", `${outcome.serviceWorker}/${outcome.sharedWorker}`);
  check("a POST form into a popup never reaches the server and is reported",
    !seen.some((request) => request.path === "/sink/popup-post"));
  check("same-site, noopener, and cross-site new tabs load", outcome.newTabs.length === POPUP_PAGES + 3,
    outcome.newTabs.join(","));
  check("a keepalive POST is refused and a link's ping never reaches the server while the link opens",
    outcome.keepalive === "refused" && !seen.some((request) => request.path === "/sink/ping")
      && seen.some((request) => request.path === "/sink/ping-target"));
  check("a GET fetch still works", outcome.fetchGet === 200, String(outcome.fetchGet));
  check("workers, nested workers, and a worker loaded by URL run", outcome.workerRan === true);
  check("a page whose bytes are not UTF-8 reaches the tab unchanged", outcome.eucKr === "안녕", outcome.eucKr);
  check("a POST form submission leaves the page where it was", stayed === "/guard.html", stayed);
  check("a GET form navigates", moved === "/sink/get-form?q=1", moved);
  const frameState = (await guarded.run("automation.space.inspect", {})).requests;
  check("the out-of-process frame's reads work and its POST is refused",
    seen.some((request) => request.path === "/sink/frame-get") && !seen.some((request) => request.path === "/sink/frame-post"),
    JSON.stringify({ frameHits: seen.filter((request) => request.path.includes("frame")).map((r) => r.path),
      pending: frameState?.pendingTargets, paused: frameState?.pausedSample, refusals: frameState?.refusals }));
  check("refused requests are reported by method, path, and resource type",
    ["POST /sink/fetch-post", "PUT /sink/fetch-put", "POST /sink/beacon", "POST /sink/keepalive", "POST /sink/ping",
      "POST /sink/frame-post", "POST /sink/worker-post", "POST /sink/url-worker-post", "POST /sink/form-post"]
      .every((key) => blockedPaths.has(key))
      && blocked.find((item) => item.url.endsWith("/sink/form-post"))?.resourceType === "Document",
    [...blockedPaths].join(", "));
  check("the report never carries a query or body", blocked.every((item) => !item.url.includes("?")));
  check("a tab that closes (pyproc closing it, or its opener) sends nothing as it goes away, and its refusals are reported",
    !seen.some((request) => request.path.startsWith("/sink/close-"))
      && blocked.some((item) => new URL(item.url).pathname.startsWith("/sink/close-")),
    blocked.filter((item) => item.url.includes("/sink/close-")).map((item) => new URL(item.url).pathname).join(","));
  check("a download is refused, reported, and never saved",
    blocked.some((item) => item.resourceType === "Download" && item.url.endsWith("/guard-download.bin"))
      && !existsSync(join(homedir(), "Downloads", DOWNLOAD_NAME)),
    JSON.stringify(blocked.filter((item) => item.resourceType === "Download")));
  check("a socket a page tried to open is reported",
    blocked.some((item) => item.resourceType === "WebSocket" && new URL(item.url).pathname === "/sink/ws-page"),
    blocked.filter((item) => item.resourceType === "WebSocket").map((item) => new URL(item.url).pathname).join(","));
  await guarded.evaluate(`fetch("/sink/after", { method: "POST", body: "x" }).then(() => "sent", () => "refused")`);
  const later = (await guarded.observe(APX_REPRESENTATION)).blockedRequests || [];
  check("the next observe reports only what was refused since, in the perception representation too",
    later.length === 1 && later[0].method === "POST" && new URL(later[0].url).pathname === "/sink/after",
    JSON.stringify(later));
  const guardState = (await guarded.run("automation.space.inspect", {})).requests;
  check("inspect says the session is read-only", guardState?.mode === "safe" && guardState.blockedTotal >= 10,
    JSON.stringify(guardState));
  check("every target the pages made was guarded and resumed, and no request waits undecided",
    guardState.refusedTargets === 0 && guardState.pendingTargets.length === 0 && guardState.pausedRequests === 0,
    JSON.stringify({ refusals: guardState.refusals, pending: guardState.pendingTargets, paused: guardState.pausedSample }));

  // A read-only session may be given any site: it follows a cross-site navigation and still refuses writes there.
  const anySite = await session("safe", ["*"]);
  opened.push(anySite);
  await anySite.navigate(`${frameOrigin}/sink/elsewhere`);
  const elsewhere = await anySite.evaluate("location.origin");
  await anySite.evaluate(`fetch("/sink/any-post", { method: "POST", body: "x" }).then(() => "sent", () => "refused")`);
  check("a read-only session given any site goes across sites and still refuses writes there",
    elsewhere === frameOrigin && !seen.some((request) => request.path === "/sink/any-post"), elsewhere);

  seen.length = 0;
  upgrades.length = 0;
  const open = await session("any");
  opened.push(open);
  const control = await sendAll(open);
  await open.closeUnloadingTab();
  await delay(500);
  const reached = new Set(upgrades);
  const expectedSockets = [...SOCKET_PATHS, ...(control.hasStream ? ["/sink/ws-stream"] : [])];
  check("control: the same pages reach the server when requests are not guarded",
    control.fetchPost === "sent" && control.swPost === "sent" && control.viaSw === "sent" && control.keepalive === "sent"
      && control.sharedWorker === "created" && control.popupSocket === "created"
      && ["/sink/ping", "/sink/sw-post", "/sink/via-sw", "/sink/popup-post", "/sink/url-worker-post"]
        .every((path) => seen.some((request) => request.path === path)),
    JSON.stringify(control));
  check("control: a closing tab's requests reach the server when requests are not guarded",
    seen.some((request) => request.path.startsWith("/sink/close-")),
    seen.filter((request) => request.path.startsWith("/sink/close-")).map((request) => request.path).join(","));
  check("control: every socket channel the guarded session refused does connect",
    expectedSockets.every((path) => reached.has(path)),
    expectedSockets.filter((path) => !reached.has(path)).join(",") || "all");
  check("control: an unguarded session reports no refusals", !("blockedRequests" in await open.observe()));
} catch (error) {
  check("gate ran without an exception", false, String(error?.stack || error).slice(0, 800));
} finally {
  for (const item of opened) {
    try { await item.space.close(); } catch { /* already closed */ }
    try { item.browser.close(); } catch { /* already closed */ }
  }
  await new Promise((resolve) => mainServer.close(resolve));
  await new Promise((resolve) => frameServer.close(resolve));
}

console.log(`\nresult: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
