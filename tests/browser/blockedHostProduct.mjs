// blockedHostProduct.mjs - blocked-host gate: a session that names a blocked host never sends it a request, whichever
// way a page tries (a subresource, a frame, a fetch, a dedicated or service worker, a beacon, a new tab, a link, a
// redirect hop, and the host written with an ideographic dot, full-width letters, a trailing dot, a percent escape, or
// a backslash before an @), in a read-only session and in one with requests "any", while the page's own site keeps
// working. A start page
// that redirects there, or a start URL on it, opens no tab and names the host. A control session without the list runs
// the same pages and proves each of those channels does reach the host, so the gate cannot pass vacantly.
import { NativeCdpSpace } from "../../scripts/automationSpace/nativeCdpSpace.js";
import { parseBrowserControlConfig } from "../../scripts/browserControl/mcpBrowserControl.js";
import { requestGuardLaunchArgs, requestGuardProfilePreferences } from "../../scripts/browserControl/requestGuard.mjs";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { launchBrowser } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The blocked host is a name the browser resolves to the loopback server, so a request that slipped through arrives
// there and is counted by the host it named.
const BLOCKED = "blocked.test";
const PERMISSION_DENIED = "BROWSER_CONTROL_PERMISSION_DENIED";

const seen = [];
let port = 0;
let mainOrigin = "";
let blockedOrigin = "";

function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>blocked host</title></head><body>${body}</body></html>`;
}

// Every spelling a browser reads as the blocked host, each opened as a new tab by a link.
const spellings = () => ({
  ideographic: `http://blocked\u3002test:${port}/sink/ideographic`,
  fullWidth: `http://\uff42\uff4c\uff4f\uff43\uff4b\uff45\uff44.test:${port}/sink/full-width`,
  trailingDot: `http://BLOCKED.test.:${port}/sink/trailing-dot`,
  percent: `http://bl%6Fcked.test:${port}/sink/percent`,
  backslash: `http://${BLOCKED}:${port}\\@127.0.0.1:${port}/sink/backslash`,
});

function pageFor(pathname) {
  if (pathname === "/start.html") {
    const links = Object.entries(spellings())
      .map(([id, href]) => `<a id="${id}" href="${href.replaceAll("&", "&amp;")}" target="_blank">${id}</a>`).join("");
    return page(`<h1>start</h1>
<img src="${blockedOrigin}/sink/image?secret=1">
<iframe src="${blockedOrigin}/sink/frame"></iframe>
<a id="newTabLink" href="${blockedOrigin}/sink/link-tab" target="_blank">tab</a>${links}
<script>
fetch("/sink/allowed-fetch").catch(() => {});
fetch(${JSON.stringify(`${blockedOrigin}/sink/fetch`)}, { mode: "no-cors" }).catch(() => {});
navigator.sendBeacon(${JSON.stringify(`${blockedOrigin}/sink/beacon`)}, "x");
navigator.serviceWorker?.register("/guard-sw.js").catch(() => {});
new Worker(URL.createObjectURL(new Blob([${JSON.stringify(
    `fetch(${JSON.stringify(`${blockedOrigin}/sink/worker`)}, { mode: "no-cors" }).catch(() => {});`)}],
  { type: "text/javascript" })));
</script>`);
  }
  return page("<p>sink</p>");
}

const server = createStaticServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.invalid");
  for await (const _chunk of req) { /* drain the body */ }
  const host = String(req.headers.host || "").replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase();
  seen.push({ host, path: url.pathname });
  if (url.pathname === "/guard-sw.js") {
    // A service worker asks the blocked host as it installs (a read-only session never runs one).
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`fetch(${JSON.stringify(`${blockedOrigin}/sink/service-worker`)}, { mode: "no-cors" }).catch(() => {});`);
    return true;
  }
  if (url.pathname === "/redirect") {
    res.writeHead(302, { Location: url.searchParams.get("to") || "/", "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(pageFor(url.pathname));
  return true;
}, { coi: false });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
port = server.address().port;
mainOrigin = `http://127.0.0.1:${port}`;
blockedOrigin = `http://${BLOCKED}:${port}`;
const redirectTo = (target) => `${mainOrigin}/redirect?to=${encodeURIComponent(target)}`;

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

// Built the way a product host builds a session: manifest, validated environment, the browser started with the
// arguments and preferences the request mode and blocked hosts ask for, then the native CDP space.
async function session(requests, blockedHosts) {
  const allowedOrigins = requests === "safe" ? ["*"] : [mainOrigin];
  const { env } = validateMcpProductConfig({
    schemaVersion: 1,
    engine: { enabled: false },
    browser: {
      enabled: true, provider: "nativeCdp", allowedOrigins, maxRisk: "externalEffect",
      actions: ["snapshot", "navigate", "click"], methods: ["Runtime.enable", "Runtime.evaluate"],
      externalEffects: "acknowledged", purpose: "blocked host gate",
      ...(requests === "any" ? {} : { requests }), ...(blockedHosts.length ? { blockedHosts } : {}),
    },
    timeoutMs: TIMEOUT_MS,
  });
  const config = parseBrowserControlConfig(env, { timeoutMs: TIMEOUT_MS });
  const preferences = requestGuardProfilePreferences(requests, { blockedHosts: config.blockedHosts });
  const browser = launchBrowser("about:blank", { prefix: `pyprocBlockedHost-${requests}-`, cdpPipe: true,
    extraArgs: [...requestGuardLaunchArgs(requests), "--disable-features=LocalNetworkAccessChecks",
      `--host-resolver-rules=MAP ${BLOCKED}* 127.0.0.1`],
    ...(preferences ? { preferences } : {}) });
  const space = new NativeCdpSpace({ profileDir: browser.profile, cdpPipe: browser.cdpPipe, config,
    auditWriter: () => {} });
  const blocked = [];
  const run = async (operation, input) => {
    const output = await space.execute(operation, input, { authority: space.authorize(operation, input) });
    if (Array.isArray(output?.blockedRequests)) blocked.push(...output.blockedRequests);
    return output;
  };
  const refusal = async (operation, input) => {
    try { await run(operation, input); return null; } catch (error) { return error; }
  };
  return { browser, space, run, refusal, blocked, preferences };
}

// Everything the start page and its links try, then a page-made navigation through a redirect. Returns the tab's
// address afterwards, as the browser lists it.
async function exercise(item) {
  const target = await item.run("automation.target.open",
    { url: `${mainOrigin}/start.html`, expectedRisk: "externalEffect", waitUntil: "load" });
  const sessionRef = await item.run("automation.session.attach", { targetRef: target.targetRef });
  const evaluate = (expression) => item.run("automation.command", { sessionRef, method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true, userGesture: true }, expectedRisk: "externalEffect" });
  await delay(1500);
  for (const id of ["newTabLink", ...Object.keys(spellings())]) {
    await evaluate(`document.getElementById(${JSON.stringify(id)}).click(); 1`);
  }
  await evaluate(`window.open(${JSON.stringify(`${blockedOrigin}/sink/window-open`)}, "_blank"); 1`);
  await delay(1500);
  await item.run("automation.observe", { sessionRef, expectedRisk: "read" });
  await evaluate(`location.href = ${JSON.stringify(redirectTo(`${blockedOrigin}/sink/redirect-target?q=1`))}; 1`);
  await delay(2000);
  const listed = await item.run("automation.target.list", {});
  const tabAt = (listed.find?.((entry) => entry.targetRef === target.targetRef) || {}).url || "";
  // The tab now shows the browser's error page for that address, and is read (or held) by that address.
  const observed = await item.refusal("automation.observe", { sessionRef, expectedRisk: "read" })
    || await item.run("automation.observe", { sessionRef, expectedRisk: "read" });
  const back = await item.refusal("automation.act", { sessionRef,
    actions: [{ kind: "navigate", url: `${mainOrigin}/sink/back`, waitUntil: "load", expectedRisk: "externalEffect" }] });
  return { tabAt, observed, back };
}

// The backslash ends the host, so the rest of the address (from the @ on) is its path.
const backslashPath = () => `/@127.0.0.1:${port}/sink/backslash`;
const channels = () => ["/sink/image", "/sink/frame", "/sink/fetch", "/sink/beacon", "/sink/worker", "/sink/link-tab",
  "/sink/window-open", "/sink/redirect-target", "/sink/ideographic", "/sink/full-width", "/sink/trailing-dot",
  "/sink/percent", backslashPath(), "/sink/service-worker"];
const reachedBlocked = () => new Set(seen.filter((request) => request.host === BLOCKED).map((request) => request.path));

console.log("pyproc blocked host gate");
const opened = [];
try {
  for (const requests of ["safe", "any"]) {
    seen.length = 0;
    const guarded = await session(requests, [" Blocked.Test. "]);
    opened.push(guarded);
    const { tabAt, observed, back } = await exercise(guarded);
    const reached = reachedBlocked();
    check(`${requests}: no request of any channel or spelling reaches the blocked host`, reached.size === 0,
      [...reached].join(",") || "none");
    check(`${requests}: the page's own site keeps working`,
      seen.some((request) => request.host === "127.0.0.1" && request.path === "/sink/allowed-fetch"));
    const named = guarded.blocked.filter((item) => item.blockedHost === BLOCKED);
    const paths = new Set(named.map((item) => new URL(item.url).pathname));
    // The redirect hop is refused after the last result was drained, so it comes with a later one; a read-only session
    // never runs a service worker, so it has nothing of one to refuse.
    check(`${requests}: each refusal names the blocked host and never the query`,
      channels().filter((path) => path !== "/sink/redirect-target"
        && (requests === "any" || path !== "/sink/service-worker")).every((path) => paths.has(path))
        && named.every((item) => !item.url.includes("?")) && named.some((item) => item.resourceType === "Document"),
      JSON.stringify(named.map((item) => `${item.resourceType} ${item.url}`)));
    check(`${requests}: a page sent through a redirect to the blocked host shows it at that address, not its page`,
      tabAt === "" || tabAt.startsWith(`${blockedOrigin}/sink/redirect-target`), tabAt || "not listed");
    // Any site: the error page is read by the address it could not load, and the tab goes on from another address.
    // Named origins: the tab is held, and the hold names that address, never the browser's own error URL.
    const observedUrl = String(observed?.result?.url || observed?.url || "");
    check(`${requests}: the tab on the error page is judged and named by the blocked address`,
      requests === "safe"
        ? observedUrl.startsWith(`${blockedOrigin}/sink/redirect-target`) && back === null
          && reachedBlocked().size === 0 && seen.some((request) => request.path === "/sink/back")
        : observed?.code === "BROWSER_CONTROL_SURFACE_HELD" && observed.details?.origin === blockedOrigin
          && observed.details?.path === "/sink/redirect-target",
      JSON.stringify({ observedUrl, code: observed?.code, details: observed?.details, back: back?.code }));
    const redirected = await guarded.refusal("automation.target.open",
      { url: redirectTo(`${blockedOrigin}/sink/open-redirect`), expectedRisk: "externalEffect", waitUntil: "load" });
    check(`${requests}: a start page that redirects to the blocked host opens no tab and names the host and place`,
      redirected?.code === PERMISSION_DENIED && redirected.details?.blockedHost === BLOCKED
        && redirected.details?.path === "/sink/open-redirect" && !reachedBlocked().has("/sink/open-redirect"),
      JSON.stringify({ code: redirected?.code, message: redirected?.message, details: redirected?.details }));
    const direct = await guarded.refusal("automation.target.open",
      { url: `${blockedOrigin}/sink/open-direct`, expectedRisk: "externalEffect", waitUntil: "load" });
    check(`${requests}: a start URL on the blocked host is refused before anything is sent`,
      direct?.code === PERMISSION_DENIED && direct.outcome === "notSent" && direct.details?.blockedHost === BLOCKED
        && !reachedBlocked().has("/sink/open-direct"),
      JSON.stringify({ code: direct?.code, outcome: direct?.outcome, details: direct?.details }));
    const state = (await guarded.run("automation.space.inspect", {})).requests;
    check(`${requests}: inspect names the mode and the blocked host, and no request waits undecided`,
      state?.mode === requests && state.blockedHosts?.join() === BLOCKED && state.pausedRequests === 0,
      JSON.stringify({ mode: state?.mode, blockedHosts: state?.blockedHosts, paused: state?.pausedSample,
        failed: state?.failedDecisions }));
    check(`${requests}: the profile starts with page preloading off`,
      guarded.preferences?.net?.network_prediction_options === 2);
  }

  seen.length = 0;
  const open = await session("any", []);
  opened.push(open);
  await exercise(open);
  await delay(1000);
  const reached = reachedBlocked();
  check("control: without the list every channel and spelling reaches the host",
    channels().every((path) => reached.has(path)), channels().filter((path) => !reached.has(path)).join(",") || "all");
  check("control: a session without blocked hosts or read-only mode reports no refusals and keeps preloading",
    open.blocked.length === 0 && open.preferences === null);
} catch (error) {
  check("gate ran without an exception", false, String(error?.stack || error).slice(0, 800));
} finally {
  for (const item of opened) {
    try { await item.space.close(); } catch { /* already closed */ }
    try { item.browser.close(); } catch { /* already closed */ }
  }
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\nresult: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
