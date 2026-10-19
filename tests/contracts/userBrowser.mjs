// userBrowser.mjs - contract of the user-browser provider: the extension's authority, the native host's pipe, the
// transport mapping onto the port contract, and the manifest rules.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_BROWSER_EXTENSION_ID, USER_BROWSER_HOST_NAME }
  from "../../scripts/browserControl/userBrowser/userBrowserChannel.mjs";
import { UserBrowserTransport } from "../../scripts/browserControl/userBrowser/userBrowserTransport.js";
import { connectUserBrowserControl, userBrowserBroker, userBrowserTargets }
  from "../../scripts/browserControl/userBrowser/userBrowserControl.mjs";
import { BrowserControlPolicy } from "../../scripts/browserControl/browserControlPolicy.js";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

function extensionIdOf(key) {
  return [...createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16).toString("hex")]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
}

class FakeConnection {
  constructor() { this.sent = []; this.listeners = new Set(); }
  async send(method, params = {}, sessionId = undefined) {
    this.sent.push({ method, params, sessionId });
    if (method === "PyprocUserBrowser.listTabs") {
      return { tabs: [{ targetId: "7", url: "https://work.example/", title: "Work", openerId: "" },
        { targetId: "9", url: "https://work.example/popup", title: "", openerId: "7" }] };
    }
    if (method === "PyprocUserBrowser.attachTab") return { sessionId: `userBrowser:${params.targetId}:1` };
    if (method === "Page.getFrameTree") return { frameTree: { frame: sessionId === "frame-wire"
      ? { id: "frame-1", url: "https://work.example/frame", loaderId: "loader-1" }
      : { url: "https://work.example/" } } };
    return {};
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) listener(event); }
  close() { this.closed = true; }
}

// An authenticated extension connection whose browser refuses requests to the blocked sites the way the extension's
// rules make it: a navigation to one is sent (requestWillBeSent, again for each redirect hop) and fails as blocked by
// the client before Page.navigate answers. A start page in `pages` commits instead and sends the tab on by itself (a
// script, a meta refresh): `frame` is what the tab's frame tree then shows (the browser's error page names the address
// the rules refused as its unreachableUrl), `listed` where the extension lists the tab.
class SiteConnection {
  constructor({ blockSites = (params) => ({ enforcedBy: "extension", blockedHosts: params.hosts,
    blockedDomains: params.domains, rules: params.hosts.length + params.domains.length, preloading: "off" }) } = {}) {
    this.sent = [];
    this.listeners = new Set();
    this.blockSites = blockSites;
    this.navigations = new Map();
    this.pages = new Map();
    this.page = null;
    this.closed = false;
  }
  async send(method, params = {}, sessionId = undefined) {
    this.sent.push({ method, params, sessionId });
    if (method === "PyprocUserBrowser.blockSites") return this.blockSites(params);
    if (method === "PyprocUserBrowser.openTab") return { targetId: "7" };
    if (method === "PyprocUserBrowser.attachTab") return { sessionId: "userBrowser:7:1" };
    if (method === "PyprocUserBrowser.closeTab") { this.page = null; return {}; }
    if (method === "PyprocUserBrowser.listTabs") {
      return { tabs: this.page ? [{ targetId: "7", url: this.page.listed, title: "" }] : [] };
    }
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame", ...(this.page?.frame
      || { url: "about:blank" }) } } };
    if (method === "Runtime.evaluate") return { result: { type: "string", value: "complete" } };
    if (method === "Page.navigate" && this.pages.has(params.url)) {
      this.page = this.pages.get(params.url);
      return { frameId: "frame", loaderId: "loader" };
    }
    if (method === "Page.navigate") {
      const hops = this.navigations.get(params.url) || [params.url];
      hops.forEach((url, index) => this.emit({ method: "Network.requestWillBeSent", sessionId, params: {
        requestId: "nav-1", type: "Document", request: { method: "GET", url },
        ...(index ? { redirectResponse: { status: 302 } } : {}) } }));
      this.emit({ method: "Network.loadingFailed", sessionId, params: { requestId: "nav-1", type: "Document",
        errorText: "net::ERR_BLOCKED_BY_CLIENT", blockedReason: "other" } });
      return { frameId: "frame", errorText: "net::ERR_BLOCKED_BY_CLIENT" };
    }
    return {};
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of [...this.listeners]) listener({ sessionId: null, params: {}, ...event }); }
  close() { this.closed = true; }
}

const SITES_CONNECTED = Object.freeze({ product: "Chrome/155.0.0.0", protocolVersion: "1.3",
  capabilities: Object.freeze(["blockSites"]) });

// Blocked sites in the user's own browser, on the control host's side: the extension is asked for its rules before any
// tab opens, a session whose extension does not hold them starts nothing, and the guard reports what they refused.
async function assertSiteBlocking() {
  const options = () => ({ policy: new BrowserControlPolicy({ targetOrigins: ["https://work.example"],
    maxRisk: "externalEffect" }), timeoutMs: 5000, blockedHosts: ["link.coupang.com"], blockedDomains: ["coupa.ng"] });

  const connection = new SiteConnection();
  const broker = await userBrowserBroker({ connection, ...SITES_CONNECTED }, options());
  assert.deepEqual(connection.sent.map((entry) => [entry.method, entry.params]),
    [["PyprocUserBrowser.blockSites", { hosts: ["link.coupang.com"], domains: ["coupa.ng"] }]]);
  assert.deepEqual(broker.inspect().requests, { mode: "any", enforcedBy: "extension",
    blockedHosts: ["link.coupang.com"], blockedDomains: ["coupa.ng"], preloading: "off", blockedTotal: 0 });

  // A start URL on a blocked host, or under a blocked domain, opens no tab and names the host.
  for (const [url, blockedHost] of [["https://link.coupang.com/a?q=1", "link.coupang.com"],
    ["https://www.coupa.ng/b", "www.coupa.ng"]]) {
    const refused = await errorOf(() => broker.openTarget(url));
    assert.deepEqual([refused?.code, refused?.outcome, refused?.details?.blockedHost],
      ["BROWSER_CONTROL_PERMISSION_DENIED", "notSent", blockedHost], url);
  }
  assert.equal(connection.sent.some((entry) => entry.method === "PyprocUserBrowser.openTab"), false);

  // A start page the site sends through redirects under a blocked domain: the extension refused the last hop, so the
  // broker names where it was sent (never the query) and closes the tab.
  connection.navigations.set("https://work.example/start", ["https://work.example/start",
    "https://work.example/hop", "https://deep.coupa.ng/landing?id=1"]);
  const redirected = await errorOf(() => broker.openTarget("https://work.example/start"));
  assert.deepEqual([redirected?.code, redirected?.outcome, redirected?.details],
    ["BROWSER_CONTROL_PERMISSION_DENIED", "applied",
      { origin: "https://deep.coupa.ng", path: "/landing", blockedHost: "deep.coupa.ng" }]);
  assert.equal(connection.sent.some((entry) => entry.method === "PyprocUserBrowser.closeTab"), true);
  const navigation = broker.blockedRequests().requests;
  assert.deepEqual(navigation.map(({ at, ...item }) => item), [{ method: "GET",
    url: "https://deep.coupa.ng/landing", resourceType: "Document", blockedHost: "deep.coupa.ng" }]);

  // Refusals a debugged tab reported are listed with their host; another extension's refusal of a site this session
  // does not block, and a request to a blocked host that failed for another reason, are not this session's.
  const tab = "userBrowser:7:1";
  const request = (requestId, url, type) => connection.emit({ method: "Network.requestWillBeSent", sessionId: tab,
    params: { requestId, type, request: { method: "GET", url } } });
  const failed = (requestId, errorText = "net::ERR_BLOCKED_BY_CLIENT") => connection.emit({
    method: "Network.loadingFailed", sessionId: tab, params: { requestId, errorText } });
  request("r1", "https://link.coupang.com/pixel.gif?u=1", "Image");
  failed("r1");
  request("r2", "https://ads.example/banner.js", "Script");
  failed("r2");
  request("r3", "https://link.coupang.com/slow", "Fetch");
  failed("r3", "net::ERR_TIMED_OUT");
  const drained = broker.blockedRequests();
  assert.deepEqual([drained.requests.map(({ at, ...item }) => item), drained.dropped], [[{ method: "GET",
    url: "https://link.coupang.com/pixel.gif", resourceType: "Image", blockedHost: "link.coupang.com" }], 0]);
  assert.equal(broker.blockedRequests().requests.length, 0);
  assert.equal(broker.inspect().requests.blockedTotal, 2);
  await broker.settle();

  // A start page that commits and then sends the tab on by itself to a blocked site opens no tab either, whether the
  // open sees the browser's error page there, or the page moved once it had loaded and the tab is found listed there,
  // and whether or not the host keeps a tab that went outside its origins: a blocked site is never widened to.
  connection.pages.set("https://work.example/script", { frame: { url: "chrome-error://chromewebdata/",
    unreachableUrl: "https://deep.coupa.ng/script-landing?id=1" }, listed: "https://deep.coupa.ng/script-landing?id=1" });
  connection.pages.set("https://work.example/meta", { frame: { url: "https://work.example/meta" },
    listed: "https://link.coupang.com/meta-landing?id=1" });
  const holding = await userBrowserBroker({ connection, ...SITES_CONNECTED }, { ...options(), holdOutside: true });
  for (const [label, opener] of [["closes outside tabs", broker], ["holds outside tabs", holding]]) {
    for (const [url, details] of [
      ["https://work.example/script", { origin: "https://deep.coupa.ng", path: "/script-landing",
        blockedHost: "deep.coupa.ng" }],
      ["https://work.example/meta", { origin: "https://link.coupang.com", path: "/meta-landing",
        blockedHost: "link.coupang.com" }],
    ]) {
      const closes = connection.sent.filter((entry) => entry.method === "PyprocUserBrowser.closeTab").length;
      const moved = await errorOf(() => opener.openTarget(url, { waitUntil: "load" }));
      assert.deepEqual([moved?.code, moved?.outcome, moved?.details], ["BROWSER_CONTROL_PERMISSION_DENIED", "applied",
        details], `${label}: ${url}: ${moved?.message}`);
      assert.equal(connection.sent.filter((entry) => entry.method === "PyprocUserBrowser.closeTab").length > closes,
        true, `${label}: ${url} closes the tab`);
    }
  }
  holding.close();

  // Each tab the session attaches reports its requests, so a refusal there comes with the next result.
  const watched = new FakeConnection();
  await new UserBrowserTransport(watched, { watchRequests: true }).attach("7");
  assert.deepEqual(watched.sent.map((entry) => entry.method), ["PyprocUserBrowser.attachTab", "Page.enable",
    "Target.setAutoAttach", "Network.enable"]);

  // An extension that cannot hold the rules starts nothing: one older than this control host (no capability, or no
  // method), one whose rules did not install, and one whose answer leaves a site out or names another enforcer.
  const older = () => { throw Object.assign(new Error("CDP PyprocUserBrowser.blockSites failed (-32601): "
    + "'PyprocUserBrowser.blockSites' wasn't found"), { protocolRejected: true, protocolCode: -32601 }); };
  for (const [label, capabilities, blockSites] of [
    ["no capability", [], undefined],
    ["unknown method", ["blockSites"], older],
    ["rules not kept", ["blockSites"], () => { throw new Error("the browser did not keep the site rules"); }],
    ["another enforcer", ["blockSites"], (params) => ({ enforcedBy: "puloto", blockedHosts: params.hosts,
      blockedDomains: params.domains })],
    ["a domain left out", ["blockSites"], (params) => ({ enforcedBy: "extension", blockedHosts: params.hosts,
      blockedDomains: [] })],
    // A refused navigation would still open a connection to the blocked site while network prediction is on.
    ["prediction kept on", ["blockSites"], (params) => ({ enforcedBy: "extension", blockedHosts: params.hosts,
      blockedDomains: params.domains, preloading: "notControlled" })],
  ]) {
    const refusing = new SiteConnection(blockSites ? { blockSites } : {});
    const error = await errorOf(() => userBrowserBroker({ connection: refusing, ...SITES_CONNECTED, capabilities },
      options()));
    assert.equal(error?.code, "USER_BROWSER_SITE_BLOCKING_UNAVAILABLE", `${label}: ${error?.message}`);
    assert.deepEqual([refusing.closed, refusing.sent.map((entry) => entry.method)],
      [true, label === "no capability" ? [] : ["PyprocUserBrowser.blockSites"]], label);
  }

  // A session that blocks nothing asks the extension for nothing and reports no refusals.
  const plain = new SiteConnection();
  const plainBroker = await userBrowserBroker({ connection: plain, ...SITES_CONNECTED },
    { ...options(), blockedHosts: [], blockedDomains: [] });
  assert.deepEqual([plain.sent, plainBroker.inspect().requests, plainBroker.blockedRequests()],
    [[], { mode: "any" }, null]);

  // A name the extension's rules would refuse is refused before the browser is reached.
  const misnamed = await errorOf(() => connectUserBrowserControl({ browser: "chrome",
    targetOrigins: ["https://work.example"], methods: [], blockedHosts: ["under_score.example"] }));
  assert.equal(misnamed instanceof TypeError && /one host name/.test(misnamed.message), true, String(misnamed));
}

export async function assertUserBrowserContract() {
  const root = new URL("../../scripts/browserControl/userBrowser/", import.meta.url);
  const packageManifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("extension/manifest.json", root), "utf8"));
  const worker = await readFile(new URL("extension/serviceWorker.js", root), "utf8");
  const config = await readFile(new URL("extension/config.js", root), "utf8");
  const host = await readFile(new URL("nativeHost/src/main.rs", root), "utf8");

  // The extension: one stable ID from its public key, the permissions a task window needs and nothing broader
  // (`downloads` only to learn where the browser saved a download the task's own tab started;
  // `declarativeNetRequest` only for the session rules that keep a task off the sites it blocks, before any request of
  // the profile is sent; `privacy` only to turn network prediction off while those rules hold, and give it back).
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageManifest.version);
  assert.equal(extensionIdOf(manifest.key), USER_BROWSER_EXTENSION_ID);
  assert.deepEqual([...manifest.permissions].sort(), ["debugger", "declarativeNetRequest", "downloads",
    "nativeMessaging", "privacy", "storage", "tabs", "windows"]);
  for (const key of ["host_permissions", "optional_permissions", "content_scripts", "externally_connectable"]) {
    assert.equal(Object.hasOwn(manifest, key), false, `${key} is not part of the user-browser extension`);
  }
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.match(config, new RegExp(`HOST_NAME = "${USER_BROWSER_HOST_NAME.replaceAll(".", "\\.")}"`));
  assert.match(config, /PRESET_PAIRING_SHA256 = null;/);
  // Profile data and browser-wide control stay out of reach; the debugging bar's cancel withdraws the task.
  const allowed = /const ALLOWED_DOMAINS = new Set\(\[([^\]]+)\]\)/.exec(worker)?.[1] || "";
  for (const domain of ["Target", "Fetch", "Storage", "Browser", "IndexedDB", "DOMStorage", "CacheStorage"]) {
    assert.equal(allowed.includes(`"${domain}"`), false, `${domain} must not be an allowed domain`);
  }
  for (const method of ["Network.getCookies", "Network.getAllCookies", "Network.setCookie", "Network.deleteCookies",
    "Network.clearBrowserCookies", "Network.loadNetworkResource"]) {
    assert.equal(worker.includes(`"${method}"`), true, `${method} must be refused`);
  }
  assert.equal(worker.includes("canceled_by_user"), true);
  assert.equal(/chrome\.cookies|chrome\.scripting|WebSocket|fetch\s*\(|silent-debugger/.test(worker), false);

  // Site rules, against an in-process chrome.* in its own process: installed only before a task's first tab, holding
  // every request type of the profile, removed with prediction given back once the task's tabs closed whatever ended it,
  // never removing the next task's rules, and a control host whose rules ended opens no tab without them.
  const siteRules = JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL("../fixtures/userBrowserSiteRules.mjs", import.meta.url))],
    { timeout: 60000 }).toString());
  assert.equal(siteRules.length >= 20, true);
  for (const { name, ok, value } of siteRules) assert.equal(ok, true, `${name}: ${JSON.stringify(value)}`);

  // Connection boundaries, against an in-process chrome.* in its own process: nothing one control host started, was
  // replied to, or paired reaches the next one; tab-closing, history, file navigation, and cookie traffic stay out;
  // only the download an armed task tab starts is reported, and only to the client that armed it.
  const boundaries = JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL("../fixtures/userBrowserWorker.mjs", import.meta.url))],
    { timeout: 60000 }).toString());
  assert.deepEqual(boundaries, {
    leftoverTaskTabDetached: true, unrelatedAttachedTabKept: true,
    lateHelloReplied: false, nextClientAuthorized: false, readyAcknowledged: [1, 2], tabsLeftAfterOpenRace: 0,
    handedOverStillAttached: false, eventReachedUnpairedClient: false, handedOverTabKept: true,
    pairingKeptAfterRequesterLeft: true, pairingRepliedToNextClient: false,
    refused: { "Page.close": true, "Page.navigateToHistoryEntry": true, "Page.navigate": true,
      "Network.getCookies": true, "Target.getTargets": true },
    navigateHttpAllowed: true, cookieHeadersForwarded: false, extraInfoForwarded: false, otherHeadersKept: true,
    frameAutoAttachAllowed: true, broadAutoAttachRefused: true, frameCommandRouted: true,
    frameEventScoped: true, workerNotRegistered: true, childDetachKeepsRoot: true,
    detachedFrameRejected: true,
    unarmedDownloadReported: false, otherPageDownloadReported: false,
    taskDownload: [{ expectationMatches: true, state: "complete", path: "C:\\Downloads\\report.pdf",
      mimeType: "application/pdf" }],
    lateMatchReported: ["C:\\Downloads\\late.csv"], interruptedReported: ["interrupted:USER_CANCELED"],
    sameReferrerOtherTabReported: false, sameUrlTwice: [["ambiguous", null]], forgottenDuringGraceReported: false,
    leftClientDownloadReported: false, expectationForUnattachedSession: true, expectationWithoutTimeout: true,
    userTabAttachable: true, userTabClosable: false, userTabKeptAfterEnd: true, ownTabClosedAtEnd: true,
    siteRulesHeld: false, predictionGivenBack: true,
  });

  // The native host: one instance under a fresh random name, current user only, local clients only.
  for (const needle of ["D:P(A;;GA;;;", "PIPE_REJECT_REMOTE_CLIENTS", "FILE_FLAG_FIRST_PIPE_INSTANCE",
    "BCryptGenRandom", "MAX_TO_BROWSER: usize = 1024 * 1024", "PyprocUserBrowserHost.ready", "WRITE_TIMEOUT_MS"]) {
    assert.equal(host.includes(needle), true, `native host lost ${needle}`);
  }
  // Windows checkouts may carry CRLF line endings.
  assert.match(host, /CreateNamedPipeW\([\s\S]*?\r?\n\s+1,\r?\n/);

  // The transport maps the task's tabs onto the port contract and turns the extension's detach into Transport.detached.
  const connection = new FakeConnection();
  const transport = new UserBrowserTransport(connection);
  assert.deepEqual(await transport.listTargets(), [
    { id: "7", type: "page", url: "https://work.example/", title: "Work", openerId: "" },
    { id: "9", type: "page", url: "https://work.example/popup", title: "", openerId: "7" }]);
  const session = await transport.attach("7");
  assert.equal(session.id, "userBrowser:7:1");
  assert.deepEqual(connection.sent.slice(-3).map((entry) => [entry.method, entry.sessionId]),
    [["PyprocUserBrowser.attachTab", undefined], ["Page.enable", "userBrowser:7:1"],
      ["Target.setAutoAttach", "userBrowser:7:1"]]);
  assert.deepEqual(await transport.describe(session), { id: "7", type: "page", url: "https://work.example/", title: "" });
  const seen = [];
  const unsubscribe = transport.subscribe(session, (event) => seen.push(event.method));
  connection.emit({ method: "Target.attachedToTarget", sessionId: session.id,
    params: { sessionId: "frame-wire", targetInfo: { type: "iframe", targetId: "frame-1" } } });
  assert.deepEqual(await transport.frames(session), [{ id: "frame-1", parentId: "7",
    url: "https://work.example/frame", loaderId: "loader-1" }]);
  await transport.sendFrame(session, "frame-1", { method: "Accessibility.getFullAXTree" });
  assert.equal(connection.sent.at(-1).sessionId, "frame-wire");
  connection.emit({ method: "Target.detachedFromTarget", sessionId: session.id,
    params: { sessionId: "frame-wire" } });
  assert.deepEqual(await transport.frames(session), []);
  connection.emit({ method: "Page.frameNavigated", params: {}, sessionId: "userBrowser:7:1" });
  connection.emit({ method: "Page.frameNavigated", params: {}, sessionId: "userBrowser:9:1" });
  connection.emit({ method: "PyprocUserBrowser.detached", params: { sessionId: "userBrowser:7:1", reason: "canceled_by_user" },
    sessionId: null });
  unsubscribe();
  assert.deepEqual(seen, ["Transport.frameAttached", "Transport.frameDetached",
    "Page.frameNavigated", "Transport.detached"]);
  assert.equal(connection.listeners.size, 0, "external detach leaves no connection subscription");
  await transport.detach(await transport.attach("7"));
  assert.equal(connection.listeners.size, 0, "explicit detach leaves no connection subscription after reattach");
  const targets = userBrowserTargets(connection);
  assert.equal(await targets.create("about:blank"), undefined);
  assert.equal(connection.sent.at(-1).method, "PyprocUserBrowser.openTab");

  // Manifest rules: the user's own browser is chosen, not launched, and it is never a read-only session.
  const manifestBase = { schemaVersion: 1, engine: { enabled: false }, browser: { enabled: true,
    provider: "userBrowser", userBrowser: "edge", allowedOrigins: ["https://work.example"], maxRisk: "read",
    actions: ["snapshot"] } };
  // Validation does not depend on the platform it runs on; the provider refuses to start outside Windows.
  assert.equal(validateMcpProductConfig(manifestBase).env.PYPROC_USER_BROWSER, "edge");
  assert.equal(validateMcpProductConfig({ ...manifestBase, browser: { ...manifestBase.browser,
    userBrowserProfile: "work-profile" } }).env.PYPROC_USER_BROWSER_PROFILE, "work-profile");
  for (const [change, message] of [
    [{ userBrowser: "firefox" }, /userBrowser chrome or edge/],
    [{ userBrowserProfile: "../other" }, /profileId/],
    [{ userBrowserProfile: "" }, /profileId/],
    [{ executable: resolve("browser.exe") }, /does not accept browser.executable/],
    [{ headed: true }, /does not accept browser.headed/],
    [{ requests: "safe" }, /nativeCdp/],
    [{ blockedDomains: ["https://coupang.com"] }, /blockedDomains entry must be one host name/],
    // A name the URL parser takes but the extension's rules cannot match is refused here, not when the session starts.
    [{ blockedHosts: ["under_score.example"] }, /blockedHosts entry must be one host name/],
    [{ blockedDomains: ["under_score.example"] }, /blockedDomains entry must be one host name/],
    [{ blockedDomains: Array.from({ length: 65 }, (_, index) => `d${index}.test`) }, /at most 64 blocked domains/],
  ]) {
    const error = await errorOf(() => validateMcpProductConfig({ ...manifestBase,
      browser: { ...manifestBase.browser, ...change } }));
    assert.match(String(error?.message), message, JSON.stringify(change));
  }
  const misplaced = await errorOf(() => validateMcpProductConfig({ ...manifestBase,
    browser: { ...manifestBase.browser, provider: "nativeCdp" } }));
  assert.match(String(misplaced?.message), /need browser.provider userBrowser/);
  // The extension's rules refuse every request to blocked hosts and domains before it is sent, so the user's own
  // browser takes both lists, and only it takes domains.
  const blocking = validateMcpProductConfig({ ...manifestBase, browser: { ...manifestBase.browser,
    blockedHosts: [" Link.Coupang.com. ", "coupa.ng"], blockedDomains: ["Coupang.com", "한국.kr"] } });
  assert.deepEqual([blocking.config.browser.blockedHosts, blocking.config.browser.blockedDomains,
    blocking.env.PYPROC_BROWSER_BLOCKED_HOSTS, blocking.env.PYPROC_BROWSER_BLOCKED_DOMAINS],
  [["link.coupang.com", "coupa.ng"], ["coupang.com", "xn--3e0b707e.kr"], "link.coupang.com,coupa.ng",
    "coupang.com,xn--3e0b707e.kr"]);
  const plainManifest = validateMcpProductConfig(manifestBase);
  assert.deepEqual([plainManifest.config.browser.blockedDomains, plainManifest.env.PYPROC_BROWSER_BLOCKED_DOMAINS],
    [undefined, undefined]);
  const isolatedDomains = await errorOf(() => validateMcpProductConfig({ ...manifestBase, browser: {
    ...manifestBase.browser, provider: "nativeCdp", userBrowser: undefined, blockedDomains: ["coupang.com"] } }));
  assert.match(String(isolatedDomains?.message), /blockedDomains needs the userBrowser provider/);

  await assertSiteBlocking();
  return true;
}
