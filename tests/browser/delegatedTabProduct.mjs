// delegatedTabProduct.mjs - real extension load and synthetic-gesture denial gate.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { launchBrowser } from "../../scripts/browserControl/browserLauncher.mjs";
import { readDevToolsEndpoint } from "../../scripts/browserControl/browserControlBroker.mjs";
import { CdpConnection } from "../../scripts/browserControl/cdpConnection.mjs";

if (process.platform !== "win32") {
  console.log("DelegatedTab extension gate skipped outside Windows");
  process.exit(0);
}

const extensionRoot = resolve("scripts/actuation/delegatedTab/extension");
const bootstrapCapability = "C".repeat(48);
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end("<!doctype html><title>Delegated Host</title><p>host</p>");
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = launchBrowser(`${origin}/host`, { enableExtensions: true,
  extraArgs: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`,
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
let connection = null;
let passed = 0;

function check(name, operation) {
  return Promise.resolve().then(operation).then(() => { passed += 1; console.log(`  PASS ${name}`); });
}

async function waitFor(operation, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw last || new Error("delegated tab condition timed out");
}

async function evaluate(sessionId, expression) {
  const output = await connection.send("Runtime.evaluate", { expression, awaitPromise: true,
    returnByValue: true }, sessionId);
  if (output.exceptionDetails) throw new Error(JSON.stringify(output.exceptionDetails));
  return output.result?.value;
}

try {
  connection = await CdpConnection.connect(await readDevToolsEndpoint(browser.profile, { timeoutMs: 30000 }),
    { timeoutMs: 30000 });
  const targets = () => connection.send("Target.getTargets").then((output) => output.targetInfos);
  const extensionTarget = await waitFor(async () => (await targets()).find((entry) =>
    entry.url.startsWith("chrome-extension://") && entry.url.endsWith("/serviceWorker.js")));
  const extensionId = new URL(extensionTarget.url).host;
  const hostTarget = await waitFor(async () => (await targets()).find((entry) => entry.url === `${origin}/host`));
  const attached = await connection.send("Target.attachToTarget", { targetId: hostTarget.targetId, flatten: true });
  const hostSession = attached.sessionId;
  await connection.send("Runtime.enable", {}, hostSession);
  await connection.send("Page.reload", { ignoreCache: true }, hostSession);
  await waitFor(() => evaluate(hostSession, "document.readyState === 'complete'"));
  const call = (message) => evaluate(hostSession, `new Promise((resolve) => chrome.runtime.sendMessage(
    ${JSON.stringify(extensionId)}, ${JSON.stringify(message)}, (response) => resolve(response || {
      ok: false, error: { code: chrome.runtime.lastError?.message || "NO_EXTENSION_RESPONSE" }
    })))`);
  await check("installed extension accepts only a bounded loopback host request", async () => {
    assert.equal(await evaluate(hostSession, "typeof chrome?.runtime?.sendMessage"), "function");
    const requested = await call({ protocol: "pyproc.delegatedTab", version: 1,
      operation: "host.request", bootstrapCapability });
    assert.equal(requested.ok, true);
    assert.equal(requested.output.state, "awaitingHostGesture");
    assert.equal(requested.output.hostOrigin, origin);
  });
  for (const type of ["rawKeyDown", "keyUp"]) {
    await connection.send("Input.dispatchKeyEvent", { type, key: "P", code: "KeyP",
      windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 }, hostSession);
  }
  await delay(300);
  await check("CDP synthetic input cannot forge the required extension action gesture", async () => {
    const inspected = await call({ protocol: "pyproc.delegatedTab", version: 1,
      operation: "inspect", bootstrapCapability });
    assert.equal(inspected.ok, false);
    assert.equal(inspected.error.code, "DELEGATED_HOST_UNBOUND");
  });
  await check("observe remains unavailable before both explicit action gestures", async () => {
    const denied = await call({ protocol: "pyproc.delegatedTab", version: 1,
      operation: "observe", bootstrapCapability, leaseRef: "delegatedTabLease:none", tabEpoch: 1,
      maxEntities: 20 });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "DELEGATED_AUTHORITY_REVOKED");
  });
} finally {
  connection?.close();
  browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(`DelegatedTab extension gate: ${passed}/${passed} passed`);
