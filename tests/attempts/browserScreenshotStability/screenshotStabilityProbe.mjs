// screenshotStabilityProbe.mjs - Chrome screenshot 무응답의 target 상태 최소화.
//
// 결과 (2026-08-12): Chrome은 허용 popup 생존 뒤 거부 popup을 닫으면 capture가 멈췄다.
// opener target 재활성화 뒤 PNG 276ms, Edge의 같은 prefix는 복원 없이 PNG 231ms였다.
import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { launchBrowser } from "../../../scripts/browserControl/browserLauncher.mjs";
import { connectNodeBrowserControl } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { BrowserAutomation } from "../../../scripts/browserControl/browserAutomation.js";
import { BROWSER_AUTOMATION_ACTIONS } from "../../../scripts/browserControl/browserAutomationCatalog.js";
import { BrowserArtifactStore } from "../../../scripts/browserControl/browserArtifactStore.js";
import { join } from "node:path";

const timeoutMs = Number(process.env.PYPROC_PROBE_TIMEOUT || 10000);
const browser = process.env.PYPROC_BROWSER || "";
const skippedPhases = new Set(String(process.env.PYPROC_PROBE_SKIP || "").split(",").filter(Boolean));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let receiverRequests = 0;
const receiverHandler = async (req, res) => {
  const url = new URL(req.url, "http://probe.invalid");
  if (url.pathname !== "/browserControlReceiver") return false;
  for await (const chunk of req) void chunk;
  receiverRequests += 1;
  res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
  res.end();
  return true;
};
const targetServer = createStaticServer(receiverHandler);
const crossServer = createStaticServer(receiverHandler, {
  headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
});
const deniedServer = createStaticServer();
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => crossServer.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => deniedServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;
const crossOrigin = `http://127.0.0.1:${crossServer.address().port}`;
const deniedOrigin = `http://127.0.0.1:${deniedServer.address().port}`;
const targetUrl = `${targetOrigin}/tests/browser/browserControlTarget.html`;
const crossUrl = `${crossOrigin}/tests/browser/browserControlFrameTarget.html`;
const launched = launchBrowser("about:blank", {
  executable: browser || undefined,
  prefix: "pyprocBrowserScreenshotStability-",
  extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
});
let broker = null;
let session = null;
let artifactStore = null;
let automation = null;
const rows = [];

async function command(method, params = {}, expectedRisk = "read") {
  return broker.command(session, { method, params, expectedRisk });
}

async function capture(label, fromSurface = true) {
  const started = Date.now();
  try {
    const result = await command("Page.captureScreenshot", {
      format: "png", fromSurface, captureBeyondViewport: false,
    });
    const data = result.result?.data || "";
    const bytes = Buffer.from(data, "base64");
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    rows.push({ label, fromSurface, state: png ? "png" : "invalid", elapsedMs: Date.now() - started,
      byteLength: bytes.byteLength });
    return png;
  } catch (error) {
    rows.push({ label, fromSurface, state: error.code || error.message, outcome: error.outcome,
      elapsedMs: Date.now() - started });
    return false;
  }
}

async function actionCapture(label) {
  const started = Date.now();
  try {
    const run = await automation.run(session, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
    rows.push({ label, fromSurface: true, state: "png", elapsedMs: Date.now() - started,
      byteLength: run.actions[0].result.byteLength });
    return true;
  } catch (error) {
    rows.push({ label, fromSurface: true, state: error.code || error.message, outcome: error.outcome,
      elapsedMs: Date.now() - started });
    return false;
  }
}

async function phase(label, actions) {
  if (skippedPhases.has(label)) {
    rows.push({ label, state: "skipped" });
    return true;
  }
  await automation.run(session, actions);
  rows.push({ label, state: "applied" });
  return true;
}

try {
  broker = await connectNodeBrowserControl({
    profileDir: launched.profile,
    targetOrigins: [targetOrigin, crossOrigin],
    methods: [...new Set(Object.values(BROWSER_AUTOMATION_ACTIONS).flatMap((spec) => spec.methods))],
    events: [...new Set(Object.values(BROWSER_AUTOMATION_ACTIONS).flatMap((spec) => spec.events))],
    fileRoots: [process.cwd()],
    downloadRoot: join(launched.profile, "probeDownloads"),
    maxRisk: "externalEffect",
    timeoutMs,
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true },
  });
  const opened = await broker.openTarget(targetUrl);
  session = await broker.attach(opened.targetRef);
  artifactStore = new BrowserArtifactStore({ root: join(launched.profile, "probeArtifacts") });
  automation = new BrowserAutomation({
    port: broker.port,
    actions: Object.keys(BROWSER_AUTOMATION_ACTIONS),
    downloadDir: join(launched.profile, "probeDownloads"),
    artifactStore,
  });
  await command("Runtime.evaluate", {
    expression: `window.browserControlFixture.resetActionability("moving");
      document.getElementById("enabled-action").disabled = true;
      setTimeout(() => { document.getElementById("enabled-action").disabled = false; }, 2000)`,
    returnByValue: true,
  }, "externalEffect");
  let live = await phase("readiness", [
    { kind: "waitFor", selector: "#readiness-hidden", state: "attached", expectedRisk: "read" },
    { kind: "waitFor", locator: { by: "testId", value: "readiness-hidden" }, state: "hidden", expectedRisk: "read" },
    { kind: "waitFor", locator: { by: "role", value: "heading", name: "Browser control target" }, state: "visible", expectedRisk: "read" },
    { kind: "waitFor", locator: { by: "role", value: "button", name: "Apply" }, state: "enabled", expectedRisk: "read" },
    { kind: "waitFor", locator: { by: "role", value: "button", name: "Enable later" }, state: "disabled", expectedRisk: "read" },
    { kind: "waitFor", locator: { by: "label", value: "Work email" }, state: "editable", expectedRisk: "read" },
    { kind: "waitFor", selector: "#moving-action", state: "stable", expectedRisk: "read" },
    { kind: "waitFor", selector: "#never-created", state: "detached", expectedRisk: "read" },
  ]);
  try {
    if (skippedPhases.has("readiness-timeout")) throw Object.assign(new Error("skipped"), { code: "skipped" });
    await automation.run(session, [
      { kind: "waitFor", selector: "#never-visible", state: "visible", timeoutMs: 1, expectedRisk: "read" },
    ]);
  } catch (error) {
    rows.push({ label: "readiness-timeout", state: error.code });
  }
  live = await phase("hydrated-full-page", [
    { kind: "hydrateLazy", maxScrolls: 20, settleMs: 50, timeoutMs: 5000, expectedRisk: "externalEffect" },
    { kind: "screenshot", format: "png", fullPage: true, expectedRisk: "read" },
  ]);
  const observed = await automation.observe(session, { maxNodes: 100 });
  const titleLocator = observed.result.nodes.find((node) => node.role === "textbox")?.locatorRef;
  rows.push({ label: "semantic-observation", state: titleLocator ? "observed" : "missing" });
  if (live) live = await phase("form", [
    { kind: "waitFor", locatorRef: titleLocator, state: "editable", expectedRisk: "read" },
    { kind: "fill", locatorRef: titleLocator, value: "probe", expectedRisk: "externalEffect" },
    { kind: "select", selector: "#lane", values: ["fast"], expectedRisk: "externalEffect" },
    { kind: "press", locatorRef: titleLocator, key: "Enter", expectedRisk: "externalEffect" },
    { kind: "scroll", selector: "#apply", expectedRisk: "externalEffect" },
    { kind: "click", selector: "#apply", expectedRisk: "externalEffect" },
    { kind: "waitFor", selector: "#applied", state: "attached", expectedRisk: "read" },
  ]);
  for (const kind of ["moving", "covered", "enabled"]) {
    await command("Runtime.evaluate", {
      expression: `window.browserControlFixture.resetActionability(${JSON.stringify(kind)})`, returnByValue: true,
    }, "externalEffect");
    const name = kind === "moving" ? "Moving action" : kind === "covered" ? "Covered action" : "Enable later";
    live = await phase(`actionability-${kind}`, [
      { kind: "click", locator: kind === "covered" ? { by: "text", value: name }
        : { by: "role", value: "button", name }, timeoutMs: 3000, expectedRisk: "externalEffect" },
    ]);
  }
  if (live) live = await phase("semantic-targets", [
    { kind: "fill", locator: { by: "label", value: "Work email" }, value: "probe@example.test",
      expectedRisk: "externalEffect" },
    { kind: "click", locator: { by: "testId", value: "shadow-action" }, expectedRisk: "externalEffect" },
    { kind: "click", locator: { by: "role", value: "button", name: "Frame action" }, expectedRisk: "externalEffect" },
    { kind: "click", locator: { by: "role", value: "button", name: "Frame action",
      frame: [{ by: "name", value: "semantic-frame" }] }, expectedRisk: "externalEffect" },
  ]);
  await command("Runtime.evaluate", {
    expression: `new Promise((resolve) => {
      const frame = document.getElementById("cross-origin-frame");
      frame.addEventListener("load", resolve, { once: true });
      frame.src = ${JSON.stringify(crossUrl)};
    })`, awaitPromise: true, returnByValue: true,
  }, "externalEffect");
  await delay(100);
  if (live) live = await phase("cross-origin-frame", [
    { kind: "click", locator: { by: "role", value: "button", name: "Cross frame action",
      frame: [{ by: "url", value: crossUrl }] }, expectedRisk: "externalEffect" },
  ]);
  await delay(100);
  if (live) live = await phase("upload", [
    { kind: "hover", locator: { by: "testId", value: "hover-action" }, expectedRisk: "externalEffect" },
    { kind: "focus", locator: { by: "label", value: "Work email" }, expectedRisk: "externalEffect" },
    { kind: "check", selector: "#check-action", expectedRisk: "externalEffect" },
    { kind: "uncheck", selector: "#check-action", expectedRisk: "externalEffect" },
    { kind: "upload", selector: "#upload-action", files: [join(process.cwd(), "package.json")],
      expectedRisk: "externalEffect" },
  ]);
  if (live) live = await phase("dialog", [
    { kind: "click", selector: "#dialog-action", dialog: { decision: "dismiss" },
      expectedRisk: "externalEffect" },
  ]);
  if (live) live = await phase("download", [
    { kind: "click", selector: "#download-action", download: true, expectedRisk: "externalEffect" },
  ]);
  if (live) live = await phase("drag", [
    { kind: "drag", selector: "#drag-source", to: { by: "testId", value: "drop-target" },
      expectedRisk: "externalEffect" },
  ]);
  await command("Runtime.evaluate", {
    expression: `document.getElementById("popup-action").dataset.url = ${JSON.stringify(`${crossUrl}?popup=1`)};
      document.getElementById("denied-popup-action").dataset.url = ${JSON.stringify(`${deniedOrigin}/tests/browser/browserControlFrameTarget.html`)}`,
    returnByValue: true,
  }, "externalEffect");
  if (live) live = await phase("popup", [
    { kind: "click", selector: "#popup-action", popup: true, expectedRisk: "externalEffect" },
  ]);
  try {
    if (skippedPhases.has("denied-popup")) throw Object.assign(new Error("skipped"), { code: "skipped" });
    await automation.run(session, [
      { kind: "click", selector: "#denied-popup-action", popup: true, expectedRisk: "externalEffect" },
    ]);
  } catch (error) {
    rows.push({ label: "denied-popup", state: error.code });
    if (process.env.PYPROC_PROBE_REACTIVATE === "1" && error.code !== "skipped") {
      const targetId = broker.port._targets.get(session.targetRef)?.id;
      await broker._connection.send("Target.activateTarget", { targetId });
      rows.push({ label: "opener-reactivation", state: "applied" });
    }
  }
  if (live) live = await phase("storage", [
    { kind: "cookieSet", name: "probe", value: "value", expectedRisk: "externalEffect" },
    { kind: "cookiesGet", expectedRisk: "read" },
    { kind: "cookieDelete", name: "probe", expectedRisk: "externalEffect" },
    { kind: "storageSet", area: "local", key: "probe", value: "value", expectedRisk: "externalEffect" },
    { kind: "storageGet", area: "local", expectedRisk: "read" },
    { kind: "storageRemove", area: "local", key: "probe", expectedRisk: "externalEffect" },
  ]);
  try {
    if (skippedPhases.has("strict-duplicate")) throw Object.assign(new Error("skipped"), { code: "skipped" });
    await automation.run(session, [
      { kind: "waitFor", locator: { by: "text", value: "Strict duplicate" }, state: "visible", expectedRisk: "read" },
    ]);
  } catch (error) {
    rows.push({ label: "strict-duplicate", state: error.code });
  }
  if (process.env.PYPROC_PROBE_FROM_SURFACE === "0") await capture("final-prefix-screenshot", false);
  else await actionCapture("final-prefix-screenshot");
  console.log(JSON.stringify({ browser: launched.browser, timeoutMs, skippedPhases: [...skippedPhases],
    receiverRequests, rows }, null, 2));
  if (rows.at(-1)?.state !== "png") process.exitCode = 1;
} finally {
  automation?.close();
  await Promise.allSettled([artifactStore?.close()]);
  if (session) await Promise.allSettled([broker.detach(session)]);
  await Promise.allSettled([broker?.close()]);
  launched.close();
  await Promise.allSettled([
    new Promise((resolve) => targetServer.close(resolve)),
    new Promise((resolve) => crossServer.close(resolve)),
    new Promise((resolve) => deniedServer.close(resolve)),
  ]);
}
