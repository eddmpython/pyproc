// userBrowserBlockingProduct.mjs - blocked sites in the user's own browser, end to end. The gate installs the native
// host under a gate-only name and LOCALAPPDATA, loads the extension into an isolated Chrome (and Edge) with a fresh
// profile, and builds the userBrowser space the way the Control product does, with a blocked host and a blocked domain.
// Every *.test name resolves to the loopback: blocked names point at one server, allowed names at another, and the start
// site at a third, so a TCP connection or request that reaches the blocked server while the rules hold is one that left
// the browser for a blocked site. The session's own inspection names the extension before its first tab; no channel a
// page has (subresources, frames, fetch, beacon, socket, service worker, preloading, popups, links in any spelling, a
// form, a ping, a redirect) and no other tab of the profile reaches the blocked server; a start URL on a blocked site,
// or a start page sent there (a redirect, a script, a meta refresh), opens no tab and names the place, whether or not
// the host keeps tabs that went outside its origins; refusals come with the action that caused them; and closing the
// session removes the rules and gives network prediction back. A control session without the lists runs the same pages
// and proves those channels do reach the server, so the gate cannot pass vacantly. Last, with another extension that
// keeps network prediction on, a session that blocks sites starts nothing.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserBrowserSpace } from "../../scripts/automationSpace/userBrowserSpace.js";
import { launchBrowser } from "../../scripts/browserControl/browserLauncher.mjs";
import { CdpConnection } from "../../scripts/browserControl/cdpConnection.mjs";
import { parseBrowserControlConfig } from "../../scripts/browserControl/mcpBrowserControl.js";
import { listUserBrowserHosts } from "../../scripts/browserControl/userBrowser/userBrowserChannel.mjs";
import { removeUserBrowser, setupUserBrowser } from "../../scripts/browserControl/userBrowser/userBrowserInstaller.mjs";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";

if (process.platform !== "win32") {
  console.log("user browser blocking gate skipped outside Windows");
  process.exit(0);
}

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PERMISSION_DENIED = "BROWSER_CONTROL_PERMISSION_DENIED";
const BLOCKED_HOST = "link.aff.test";
const BLOCKED_DOMAIN = "ads.test";

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};
async function waitFor(operation, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch { /* not yet */ }
    await delay(100);
  }
  return null;
}

// Three loopback servers; each counts the TCP connections it accepted (a preconnect sends no request) and the
// requests and socket upgrades it was asked, by the host they named.
function sink(handle = null) {
  const seen = { connections: 0, requests: [] };
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain the body */ }
    const url = new URL(req.url, "http://sink.invalid");
    seen.requests.push({ method: req.method, host: String(req.headers.host || "").replace(/:\d+$/, ""),
      path: url.pathname });
    if (handle && handle(url, res)) return;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><title>sink</title><p>sink</p>");
  });
  server.on("connection", () => { seen.connections += 1; });
  server.on("upgrade", (req, socket) => {
    seen.requests.push({ method: "GET", host: String(req.headers.host || "").replace(/:\d+$/, ""),
      path: new URL(req.url, "http://sink.invalid").pathname });
    socket.destroy();
  });
  const reset = () => { seen.connections = 0; seen.requests.length = 0; };
  return { server, seen, reset };
}

let S = "";
let B = "";
let A = "";
let D = "";
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>blocking</title></head><body>${body}</body></html>`;
// What each start page asks of the blocked server (B, the exact host; D, a host under the blocked domain), each with an
// allowed twin on A.
const CASES = {
  load: () => page(`<h1>load</h1>
<img src="${B}/img?secret=1"><img src="${D}/img"><img src="${A}/img">
<script src="${B}/script"></script><script src="${A}/script"></script>
<link rel="stylesheet" href="${B}/css"><link rel="stylesheet" href="${A}/css">
<iframe src="${B}/frame"></iframe><iframe src="${A}/frame"></iframe>
<video src="${B}/media"></video><object data="${B}/object"></object>
<link rel="prefetch" href="${B}/link-prefetch"><link rel="preconnect" href="${B}"><link rel="dns-prefetch" href="${B}">
<script type="speculationrules">${JSON.stringify({ prefetch: [{ source: "list", urls: [`${B}/prefetch`] }],
    prerender: [{ source: "list", urls: [`${B}/prerender`] }] })}</script>
<script>
fetch(${JSON.stringify(`${B}/fetch`)}, { mode: "no-cors" }).catch(() => {});
fetch(${JSON.stringify(`${D}/fetch`)}, { mode: "no-cors" }).catch(() => {});
fetch(${JSON.stringify(`${A}/fetch`)}, { mode: "no-cors" }).catch(() => {});
const x = new XMLHttpRequest(); x.open("GET", ${JSON.stringify(`${B}/xhr`)}); x.send();
navigator.sendBeacon(${JSON.stringify(`${B}/beacon`)}, "b"); navigator.sendBeacon(${JSON.stringify(`${A}/beacon`)}, "b");
try { new WebSocket(${JSON.stringify(`${B.replace("http:", "ws:")}/ws`)}); } catch {}
try { new WebSocket(${JSON.stringify(`${A.replace("http:", "ws:")}/ws`)}); } catch {}
navigator.serviceWorker?.register("/sw.js?run=" + Date.now()).catch(() => {});
</script>`),
  links: () => {
    const port = new URL(B).port;
    const tabs = {
      newTab: `${B}/new-tab`,
      trailingDot: `http://${BLOCKED_HOST}.:${port}/trailing-dot`,
      upperCase: `http://LINK.AFF.test:${port}/upper-case`,
      fullWidth: `http://\uff4c\uff49\uff4e\uff4b.aff.test:${port}/full-width`,
      percent: `http://link%2Eaff.test:${port}/percent`,
      credentials: `http://user:pw@${BLOCKED_HOST}:${port}/credentials`,
      domainItself: `http://${BLOCKED_DOMAIN}:${port}/domain-itself`,
      underDomain: `${D}/under-domain`,
    };
    const allowedPort = new URL(A).port;
    const allowed = { notTheDomain: `http://not${BLOCKED_DOMAIN}:${allowedPort}/not-the-domain`,
      underExactHost: `http://x.${BLOCKED_HOST}:${allowedPort}/under-exact-host` };
    const anchor = ([id, href]) => `<a id="${id}" href="${href}" target="_blank">${id}</a>`;
    return page(`<h1>links</h1>${Object.entries(tabs).map(anchor).join("")}${Object.entries(allowed).map(anchor).join("")}
<form id="post" method="post" action="${B}/form" target="_blank"><input name="q" value="1"></form>
<a id="ping" ping="${B}/ping" href="${A}/pinged" target="_blank">ping</a>
<button id="go" onclick="fetch(${JSON.stringify(`${B}/act-fetch?x=1`).replaceAll('"', "&quot;")}, { mode: 'no-cors' }).catch(() => {}); new Image().src = ${JSON.stringify(`${D}/act-image`).replaceAll('"', "&quot;")};">go</button>`);
  },
};
// Paths each channel asks the blocked server for, which a control session without the lists must see.
const LOAD_PATHS = ["/img", "/script", "/css", "/frame", "/fetch", "/xhr", "/beacon", "/ws", "/sw"];
const LINK_PATHS = ["/new-tab", "/trailing-dot", "/upper-case", "/full-width", "/percent", "/credentials",
  "/domain-itself", "/under-domain", "/popup", "/form", "/ping", "/landed"];

const start = sink((url, res) => {
  if (url.pathname === "/redirect") {
    res.writeHead(302, { Location: url.searchParams.get("to") || "/", "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  if (url.pathname === "/sw.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    res.end(`self.addEventListener("install", (event) => event.waitUntil(Promise.allSettled([
      fetch(${JSON.stringify(`${B}/sw`)}, { mode: "no-cors" }), fetch(${JSON.stringify(`${A}/sw`)}, { mode: "no-cors" })])));`);
    return true;
  }
  // Start pages that send the tab on by themselves once they committed: a script, and a meta refresh.
  const away = {
    "/away/script": () => page(`<script>location.replace(${JSON.stringify(`${D}/script-away?q=1`)})</script>`),
    "/away/meta": () => page(`<meta http-equiv="refresh" content="0;url=${B}/meta-away?q=1">`),
  }[url.pathname];
  if (away) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(away());
    return true;
  }
  const name = url.pathname.startsWith("/case/") ? url.pathname.slice(6) : "";
  if (!CASES[name]) return false;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(CASES[name]());
  return true;
});
const blocked = sink();
const allowed = sink();
for (const { server } of [start, blocked, allowed]) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
S = `http://start.test:${start.server.address().port}`;
B = `http://${BLOCKED_HOST}:${blocked.server.address().port}`;
D = `http://deep.sub.${BLOCKED_DOMAIN}:${blocked.server.address().port}`;
A = `http://www.aff.test:${allowed.server.address().port}`;
const reached = () => blocked.seen.requests.map((request) => request.path);
const resetAll = () => { for (const item of [start, blocked, allowed]) item.reset(); };

const key = randomBytes(32).toString("hex");
const hostName = `com.pyproc.user_browser_gate_${randomBytes(4).toString("hex")}`;
const localAppData = await mkdtemp(join(tmpdir(), "pyprocUserBrowserBlocking-"));
// The browser (and so the native host it starts) and the control side all inherit this LOCALAPPDATA.
process.env.LOCALAPPDATA = localAppData;
const installRoot = join(localAppData, "install");
const BROWSERS = [
  { kind: "chrome", prefix: "Chrome/", executable: ["C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((path) => existsSync(path)) },
  { kind: "edge", prefix: "Edg/", executable: ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((path) => existsSync(path)) },
].filter((entry) => entry.executable);

// The extension's own state, read in its service worker: its session rules and who holds network prediction.
async function extensionState(direct, extensionId) {
  const worker = await waitFor(async () => (await direct.send("Target.getTargets")).targetInfos
    .find((info) => info.type === "service_worker" && info.url.startsWith(`chrome-extension://${extensionId}/`)));
  const { sessionId } = await direct.send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
  try {
    const { result } = await direct.send("Runtime.evaluate", { expression: `(async () => ({
      rules: (await chrome.declarativeNetRequest.getSessionRules()).length,
      prediction: await chrome.privacy.network.networkPredictionEnabled.get({}) }))()`,
    awaitPromise: true, returnByValue: true }, sessionId);
    return result.value;
  } finally {
    await direct.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}

// A userBrowser space built the way the Control product builds one: manifest, validated environment, the space.
async function session(kind, profileId, sites) {
  const { env } = validateMcpProductConfig({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
    browser: { enabled: true, provider: "userBrowser", userBrowser: kind, userBrowserProfile: profileId,
      allowedOrigins: [S, A], maxRisk: "externalEffect", actions: ["snapshot", "click"],
      methods: ["Runtime.evaluate"], externalEffects: "acknowledged", purpose: "user browser blocking gate",
      ...sites } });
  const config = parseBrowserControlConfig(env, { timeoutMs: TIMEOUT_MS });
  const profileDir = await mkdtemp(join(localAppData, "space-"));
  const space = new UserBrowserSpace({ profileDir, config, browser: kind, profileId, auditWriter: () => {} });
  const refused = [];
  const run = async (operation, input) => {
    const output = await space.execute(operation, input, { authority: space.authorize(operation, input) });
    if (Array.isArray(output?.blockedRequests)) refused.push(...output.blockedRequests);
    return output;
  };
  const refusal = async (operation, input) => {
    try { await run(operation, input); return null; } catch (error) { return error; }
  };
  return { space, run, refusal, refused };
}

const open = (item, url) => item.run("automation.target.open", { url, expectedRisk: "externalEffect",
  waitUntil: "load" });

// Start pages that leave for a blocked site by themselves: each open is refused and names where it was sent.
async function leaveByThemselves(item, label) {
  for (const [way, path, origin, landing, blockedHost] of [
    ["a script", "/away/script", D, "/script-away", "deep.sub.ads.test"],
    ["a meta refresh", "/away/meta", B, "/meta-away", BLOCKED_HOST]]) {
    const refused = await item.refusal("automation.target.open", { url: `${S}${path}`, expectedRisk: "externalEffect",
      waitUntil: "load" });
    check(`${label}a start page sent on by ${way} opens no tab and names the place`,
      refused?.code === PERMISSION_DENIED && refused.details?.blockedHost === blockedHost
        && refused.details?.origin === origin && refused.details?.path === landing,
      JSON.stringify({ code: refused?.code, message: refused?.message, details: refused?.details }));
  }
}

// A minimal extension that holds the profile's network prediction on; loaded after the User Browser extension, its
// setting wins.
async function predictionHolder() {
  const folder = join(localAppData, "predictionHolder");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "prediction holder",
    version: "1.0", permissions: ["privacy"], background: { service_worker: "worker.js" } }));
  await writeFile(join(folder, "worker.js"), "chrome.privacy.network.networkPredictionEnabled.set({ value: true });");
  return folder;
}

// Every page channel, then every gesture channel; the task tab ends sent through a redirect to the blocked host.
async function exercise(item) {
  await open(item, `${S}/case/load`);
  await delay(2500);
  const target = await open(item, `${S}/case/links`);
  const sessionRef = await item.run("automation.session.attach", { targetRef: target.targetRef });
  const evaluate = (expression) => item.run("automation.command", { sessionRef, method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true, userGesture: true }, expectedRisk: "externalEffect" });
  const ids = ["newTab", "trailingDot", "upperCase", "fullWidth", "percent", "credentials", "domainItself",
    "underDomain", "notTheDomain", "underExactHost", "ping"];
  for (const id of ids) await evaluate(`document.getElementById(${JSON.stringify(id)}).click(); 1`);
  // One popup per gesture: the browser's popup blocker lets only the first through.
  for (const origin of [B, A]) await evaluate(`window.open(${JSON.stringify(`${origin}/popup`)}, "_blank"); 1`);
  await evaluate(`document.getElementById("post").submit(); 1`);
  await delay(1500);
  const acted = await item.run("automation.act", { sessionRef, actions: [{ kind: "click", selector: "#go",
    expectedRisk: "externalEffect" }] });
  await delay(500);
  await item.refusal("automation.observe", { sessionRef, expectedRisk: "read" });
  await evaluate(`location.href = ${JSON.stringify(`${S}/redirect?to=${encodeURIComponent(`${B}/landed?q=1`)}`)}; 1`);
  await delay(1500);
  const landed = await item.refusal("automation.observe", { sessionRef, expectedRisk: "read" });
  return { acted, landed };
}

async function journey({ kind, prefix, executable }, installed) {
  const label = `${kind}: `;
  const browser = launchBrowser("about:blank", { executable, enableExtensions: true, cdpPipe: true,
    prefix: "pyprocUserBrowserBlocking-",
    // The trailing star also maps a name written with a trailing dot.
    extraArgs: ["--enable-unsafe-extension-debugging", "--host-resolver-rules=MAP *.test* 127.0.0.1",
      "--no-proxy-server", "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,LocalNetworkAccessChecks",
      `--unsafely-treat-insecure-origin-as-secure=${S}`] });
  const direct = CdpConnection.overPipe(browser.cdpPipe, { timeoutMs: 30000 });
  const opened = [];
  try {
    const loaded = await direct.send("Extensions.loadUnpacked", { path: installed.extensionPath });
    const host = await waitFor(async () => (await listUserBrowserHosts()).find((entry) => entry.product.startsWith(prefix)),
      30000);
    check(`${label}the running extension announces that it blocks sites`,
      JSON.stringify(host?.capabilities) === JSON.stringify(["blockSites"]), JSON.stringify(host?.capabilities));
    await mkdir(join(localAppData, "pyproc", "userBrowser", "pairing"), { recursive: true });
    await writeFile(join(localAppData, "pyproc", "userBrowser", "pairing", `${host.profileId}.key`),
      JSON.stringify({ key, browser: kind, profileId: host.profileId, product: host.product }));

    resetAll();
    const guarded = await session(kind, host.profileId, { blockedHosts: [BLOCKED_HOST],
      blockedDomains: [BLOCKED_DOMAIN.toUpperCase()] });
    opened.push(guarded);
    // Puloto's order: the session's own inspection, before any tab, names who refuses which sites.
    const requests = (await guarded.run("automation.space.inspect", {})).requests;
    check(`${label}before its first tab the session names the extension as enforcing both lists`,
      requests?.enforcedBy === "extension" && requests.blockedHosts?.join() === BLOCKED_HOST
        && requests.blockedDomains?.join() === BLOCKED_DOMAIN && requests.preloading === "off",
      JSON.stringify(requests));
    const held = await extensionState(direct, loaded.id);
    check(`${label}the extension holds one rule per site and network prediction off`,
      held?.rules === 2 && held.prediction?.value === false
        && held.prediction?.levelOfControl === "controlled_by_this_extension", JSON.stringify(held));

    const { acted, landed } = await exercise(guarded);
    // The profile's other tabs are held to the rules too: a tab the task never opened.
    const other = await direct.send("Target.createTarget", { url: `${B}/other-tab` });
    await delay(1500);
    await direct.send("Target.closeTarget", { targetId: other.targetId }).catch(() => {});
    check(`${label}no request and no connection of any channel, spelling, or tab reaches the blocked server`,
      blocked.seen.connections === 0 && blocked.seen.requests.length === 0,
      JSON.stringify({ connections: blocked.seen.connections, paths: reached() }));
    const allowedPaths = new Set(allowed.seen.requests.map((request) => request.path));
    check(`${label}the page's allowed twins, another domain's host, and a host under the exact one are reached`,
      ["/img", "/script", "/css", "/frame", "/fetch", "/beacon", "/sw", "/not-the-domain", "/under-exact-host",
        "/popup", "/pinged"].every((path) => allowedPaths.has(path)), [...allowedPaths].join(","));
    const listed = guarded.refused.filter((item) => item.blockedHost);
    const actPaths = (acted.blockedRequests || []).map((item) => `${item.blockedHost} ${new URL(item.url).pathname}`);
    check(`${label}an action's refusals come with its result, naming the host and never the query`,
      actPaths.includes(`${BLOCKED_HOST} /act-fetch`) && guarded.refused.every((item) => !item.url.includes("?"))
        && listed.some((item) => item.blockedHost === "deep.sub.ads.test" && item.url.endsWith("/act-image")),
      JSON.stringify(listed.map((item) => `${item.resourceType} ${item.blockedHost} ${item.url}`)));
    check(`${label}a task tab sent through a redirect to the blocked host is held at that address`,
      landed?.code === "BROWSER_CONTROL_SURFACE_HELD" && landed.details?.origin === B
        && landed.details?.path === "/landed",
      JSON.stringify({ code: landed?.code, details: landed?.details }));

    const directOpen = await guarded.refusal("automation.target.open", { url: `${B}/open-direct`,
      expectedRisk: "externalEffect", waitUntil: "load" });
    check(`${label}a start URL on the blocked host opens nothing and names the host`,
      directOpen?.code === PERMISSION_DENIED && directOpen.outcome === "notSent"
        && directOpen.details?.blockedHost === BLOCKED_HOST, JSON.stringify({ code: directOpen?.code,
        outcome: directOpen?.outcome, details: directOpen?.details }));
    const redirected = await guarded.refusal("automation.target.open", {
      url: `${S}/redirect?to=${encodeURIComponent(`${S}/redirect?to=${encodeURIComponent(`${D}/open-redirect?q=1`)}`)}`,
      expectedRisk: "externalEffect", waitUntil: "load" });
    check(`${label}a start page sent through two redirects under the blocked domain opens no tab and names the place`,
      redirected?.code === PERMISSION_DENIED && redirected.details?.blockedHost === "deep.sub.ads.test"
        && redirected.details?.origin === D && redirected.details?.path === "/open-redirect",
      JSON.stringify({ code: redirected?.code, message: redirected?.message, details: redirected?.details }));
    await leaveByThemselves(guarded, label);
    check(`${label}still nothing reached the blocked server`, blocked.seen.connections === 0
      && blocked.seen.requests.length === 0, JSON.stringify(reached()));

    await guarded.space.close();
    opened.splice(opened.indexOf(guarded), 1);
    const released = await waitFor(async () => {
      const state = await extensionState(direct, loaded.id);
      return state?.rules === 0 ? state : null;
    }, 10000);
    check(`${label}closing the session removes the rules and gives network prediction back`,
      released?.rules === 0 && released.prediction?.value === true
        && released.prediction?.levelOfControl === "controllable_by_this_extension", JSON.stringify(released));
    const after = await direct.send("Target.createTarget", { url: `${B}/after` });
    const reachedAfter = await waitFor(() => reached().includes("/after"), 10000);
    await direct.send("Target.closeTarget", { targetId: after.targetId }).catch(() => {});
    check(`${label}once the rules are gone the blocked server is reachable again`, reachedAfter === true);

    // The same pages without the lists: every channel reaches the blocked server.
    resetAll();
    const control = await session(kind, host.profileId, {});
    opened.push(control);
    const controlRequests = (await control.run("automation.space.inspect", {})).requests;
    const plainState = await extensionState(direct, loaded.id);
    await exercise(control);
    await delay(1000);
    const controlPaths = new Set(reached());
    check(`${label}control: without the lists every channel and spelling reaches the blocked server`,
      [...LOAD_PATHS, ...LINK_PATHS].every((path) => controlPaths.has(path)),
      [...LOAD_PATHS, ...LINK_PATHS].filter((path) => !controlPaths.has(path)).join(",") || "all");
    check(`${label}control: a session without lists holds no rule and reports no refusal`,
      plainState?.rules === 0 && controlRequests?.mode === "any" && controlRequests.enforcedBy === undefined
        && control.refused.length === 0, JSON.stringify({ plainState, controlRequests }));
    await control.space.close();
    opened.splice(opened.indexOf(control), 1);

    // Puloto's way: a host that keeps a tab sent outside its origins for a widening still closes one sent to a blocked
    // site.
    resetAll();
    const widening = await session(kind, host.profileId, { blockedHosts: [BLOCKED_HOST],
      blockedDomains: [BLOCKED_DOMAIN], permissionRevision: "controller" });
    opened.push(widening);
    await leaveByThemselves(widening, `${label}a host that keeps outside tabs: `);
    await widening.space.close();
    opened.splice(opened.indexOf(widening), 1);
    check(`${label}a host that keeps outside tabs: nothing reached the blocked server`, blocked.seen.connections === 0
      && blocked.seen.requests.length === 0, JSON.stringify({ connections: blocked.seen.connections, paths: reached() }));

    // Another extension keeps network prediction on: a refused navigation would still open a connection to the blocked
    // server, so the session starts nothing and leaves no rule behind. Last, since that extension stays loaded.
    resetAll();
    await direct.send("Extensions.loadUnpacked", { path: await predictionHolder() });
    const overridden = await waitFor(async () => {
      const state = await extensionState(direct, loaded.id);
      return state?.prediction?.levelOfControl === "controlled_by_other_extensions" ? state : null;
    }, 10000);
    const refusing = await session(kind, host.profileId, { blockedHosts: [BLOCKED_HOST] });
    opened.push(refusing);
    const unguarded = await refusing.refusal("automation.target.open", { url: `${S}/case/load`,
      expectedRisk: "externalEffect", waitUntil: "load" });
    await delay(1000);
    const leftover = await extensionState(direct, loaded.id);
    check(`${label}with prediction kept on by another extension the session starts nothing`,
      Boolean(overridden) && unguarded?.code === "USER_BROWSER_SITE_BLOCKING_UNAVAILABLE"
        && /network prediction/.test(unguarded.message) && leftover?.rules === 0
        && !start.seen.requests.some((request) => request.path === "/case/load")
        && blocked.seen.connections === 0 && blocked.seen.requests.length === 0,
      JSON.stringify({ overridden: overridden?.prediction, code: unguarded?.code, message: unguarded?.message,
        rules: leftover?.rules, started: start.seen.requests.map((request) => request.path),
        connections: blocked.seen.connections }));
  } finally {
    for (const item of opened) await item.space.close().catch(() => {});
    direct.close();
    browser.close();
  }
}

console.log("pyproc user browser blocking gate");
try {
  check("Chrome or Edge is installed for the gate", BROWSERS.length > 0, BROWSERS.map((entry) => entry.kind).join(","));
  // PYPROC_GATE_USER_BROWSER_HOST runs the gate on a prebuilt host instead of building one.
  const installed = await setupUserBrowser({ installRoot, hostName,
    presetPairingSha256: createHash("sha256").update(key).digest("hex"), browsers: BROWSERS.map((entry) => entry.kind),
    hostBinary: process.env.PYPROC_GATE_USER_BROWSER_HOST || null });
  for (const entry of BROWSERS) {
    try { await journey(entry, installed); }
    catch (error) { check(`${entry.kind}: the journey ran without an exception`, false, String(error?.stack || error).slice(0, 1600)); }
  }
} catch (error) {
  check("gate ran without an exception", false, String(error?.stack || error).slice(0, 1600));
} finally {
  await removeUserBrowser({ installRoot }).catch(() => {});
  await rm(localAppData, { recursive: true, force: true }).catch(() => {});
  for (const { server } of [start, blocked, allowed]) await new Promise((resolve) => server.close(resolve));
}

console.log(`\nresult: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
