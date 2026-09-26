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
import { userBrowserTargets } from "../../scripts/browserControl/userBrowser/userBrowserControl.mjs";
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
    if (method === "Page.getFrameTree") return { frameTree: { frame: { url: "https://work.example/" } } };
    return {};
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) listener(event); }
  close() { this.closed = true; }
}

export async function assertUserBrowserContract() {
  const root = new URL("../../scripts/browserControl/userBrowser/", import.meta.url);
  const packageManifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("extension/manifest.json", root), "utf8"));
  const worker = await readFile(new URL("extension/serviceWorker.js", root), "utf8");
  const config = await readFile(new URL("extension/config.js", root), "utf8");
  const host = await readFile(new URL("nativeHost/src/main.rs", root), "utf8");

  // The extension: one stable ID from its public key, the permissions a task window needs and nothing broader
  // (`downloads` only to learn where the browser saved a download the task's own tab started).
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageManifest.version);
  assert.equal(extensionIdOf(manifest.key), USER_BROWSER_EXTENSION_ID);
  assert.deepEqual([...manifest.permissions].sort(), ["debugger", "downloads", "nativeMessaging", "storage", "tabs",
    "windows"]);
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

  // Connection boundaries, against an in-process chrome.* in its own process: nothing one control host started, was
  // replied to, or paired reaches the next one; tab-closing, history, file navigation, and cookie traffic stay out;
  // only the download an armed task tab starts is reported, and only to the client that armed it.
  const boundaries = JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL("../fixtures/userBrowserWorker.mjs", import.meta.url))],
    { timeout: 60000 }).toString());
  assert.deepEqual(boundaries, {
    lateHelloReplied: false, nextClientAuthorized: false, readyAcknowledged: [1, 2], tabsLeftAfterOpenRace: 0,
    handedOverStillAttached: false, eventReachedUnpairedClient: false, handedOverTabKept: true,
    pairingKeptAfterRequesterLeft: true, pairingRepliedToNextClient: false,
    refused: { "Page.close": true, "Page.navigateToHistoryEntry": true, "Page.navigate": true,
      "Network.getCookies": true, "Target.getTargets": true },
    navigateHttpAllowed: true, cookieHeadersForwarded: false, extraInfoForwarded: false, otherHeadersKept: true,
    unarmedDownloadReported: false, otherPageDownloadReported: false,
    taskDownload: [{ expectationMatches: true, state: "complete", path: "C:\\Downloads\\report.pdf",
      mimeType: "application/pdf" }],
    lateMatchReported: ["C:\\Downloads\\late.csv"], interruptedReported: ["interrupted:USER_CANCELED"],
    sameReferrerOtherTabReported: false, sameUrlTwice: [["ambiguous", null]], forgottenDuringGraceReported: false,
    leftClientDownloadReported: false, expectationForUnattachedSession: true, expectationWithoutTimeout: true,
    userTabAttachable: true, userTabClosable: false, userTabKeptAfterEnd: true, ownTabClosedAtEnd: true,
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
  assert.deepEqual(connection.sent.slice(-2).map((entry) => [entry.method, entry.sessionId]),
    [["PyprocUserBrowser.attachTab", undefined], ["Page.enable", "userBrowser:7:1"]]);
  assert.deepEqual(await transport.describe(session), { id: "7", type: "page", url: "https://work.example/", title: "" });
  const seen = [];
  const unsubscribe = transport.subscribe(session, (event) => seen.push(event.method));
  connection.emit({ method: "Page.frameNavigated", params: {}, sessionId: "userBrowser:7:1" });
  connection.emit({ method: "Page.frameNavigated", params: {}, sessionId: "userBrowser:9:1" });
  connection.emit({ method: "PyprocUserBrowser.detached", params: { sessionId: "userBrowser:7:1", reason: "canceled_by_user" },
    sessionId: null });
  unsubscribe();
  assert.deepEqual(seen, ["Page.frameNavigated", "Transport.detached"]);
  const targets = userBrowserTargets(connection);
  assert.equal(await targets.create("about:blank"), undefined);
  assert.equal(connection.sent.at(-1).method, "PyprocUserBrowser.openTab");

  // Manifest rules: the user's own browser is chosen, not launched, and it is never a read-only session.
  const manifestBase = { schemaVersion: 1, engine: { enabled: false }, browser: { enabled: true,
    provider: "userBrowser", userBrowser: "edge", allowedOrigins: ["https://work.example"], maxRisk: "read",
    actions: ["snapshot"] } };
  // Validation does not depend on the platform it runs on; the provider refuses to start outside Windows.
  assert.equal(validateMcpProductConfig(manifestBase).env.PYPROC_USER_BROWSER, "edge");
  for (const [change, message] of [
    [{ userBrowser: "firefox" }, /userBrowser chrome or edge/],
    [{ executable: resolve("browser.exe") }, /does not accept browser.executable/],
    [{ headed: true }, /does not accept browser.headed/],
    [{ requests: "safe" }, /nativeCdp/],
  ]) {
    const error = await errorOf(() => validateMcpProductConfig({ ...manifestBase,
      browser: { ...manifestBase.browser, ...change } }));
    assert.match(String(error?.message), message, JSON.stringify(change));
  }
  const misplaced = await errorOf(() => validateMcpProductConfig({ ...manifestBase,
    browser: { ...manifestBase.browser, provider: "nativeCdp" } }));
  assert.match(String(misplaced?.message), /browser.userBrowser needs browser.provider userBrowser/);
  return true;
}
