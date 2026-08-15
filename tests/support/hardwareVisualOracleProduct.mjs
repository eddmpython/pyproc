// hardwareVisualOracleProduct.mjs - installed public GPU subpath on a hardware WebGPU adapter.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const requestedEvidenceDir = process.env.PYPROC_HARDWARE_EVIDENCE_DIR
  ? resolve(process.env.PYPROC_HARDWARE_EVIDENCE_DIR) : null;
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1" || requestedEvidenceDir !== null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function page(importMap) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>pyproc hardware visual oracle</title>
  <script type="importmap">${JSON.stringify({ imports: importMap })}</script>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #e9f1ff;
      background: radial-gradient(circle at top, #214271, #091426 62%); font: 16px/1.45 system-ui; }
    main { width: min(720px, calc(100vw - 48px)); padding: 32px; border: 1px solid #75a7ff55;
      border-radius: 22px; background: #0d1d35e8; box-shadow: 0 24px 80px #0008; }
    h1 { margin: 0 0 8px; font-size: 28px; } p { color: #adc4e8; }
    dl { display: grid; grid-template-columns: 180px 1fr; gap: 10px 18px; margin: 24px 0; }
    dt { color: #8aa9d8; } dd { margin: 0; font-family: ui-monospace, monospace; }
    .verified { color: #78efb4; font-weight: 750; }
    .swatch { width: 100%; height: 70px; border-radius: 12px; background: rgb(64 128 191);
      box-shadow: inset 0 0 0 1px #fff4; }
  </style>
</head>
<body><main>
  <h1>Hardware visual oracle</h1>
  <p id="status">Requesting the registered WebGPU provider...</p>
  <dl>
    <dt>Adapter</dt><dd id="adapter">pending</dd>
    <dt>Compute</dt><dd id="compute">pending</dd>
    <dt>Pixel</dt><dd id="pixel">pending</dd>
    <dt>Hostcall</dt><dd id="hostcall">pending</dd>
  </dl>
  <div class="swatch" aria-label="Expected oracle color"></div>
</main>
<script type="module">
import { createWebGpuHostAdapter, runHardwareVisualOracle } from "pyproc/gpu";
import { HostCapabilityBroker, HOSTCALL_OPCODE, HOSTCALL_STATE, ProductHostCapabilityPort } from "pyproc/wasi";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
let requestIndex = 0;
let adapter = null;
let broker = null;
let port = null;

function bytesFromBase64(value) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

try {
  const startedAt = performance.now();
  adapter = await createWebGpuHostAdapter({ requireHardware: true, powerPreference: "high-performance" });
  const adapterMs = Math.round(performance.now() - startedAt);
  broker = new HostCapabilityBroker({ authorize: ({ capability }) => capability === "accelerator.gpu",
    maxResponseBytes: 1 << 20 });
  port = new ProductHostCapabilityPort({ gpu: adapter }).install(broker);
  const hostcallProvider = {
    inspect: () => adapter.inspect(),
    async dispatch(input) {
      requestIndex += 1;
      const result = await broker.dispatch({ requestKey: "gpu-oracle:" + requestIndex,
        opcode: HOSTCALL_OPCODE.gpuDispatch, flags: 0, payload: encoder.encode(JSON.stringify(input)),
        responseCapacity: 65536, deadlineMs: 30000, authorityRef: "authority:hardware-oracle",
        commandId: "command:gpu-oracle", kernelRef: "kernel:gpu-oracle" });
      if (result.state !== HOSTCALL_STATE.response) {
        throw new Error("GPU hostcall failed with state " + result.state + " and code " + result.errorCode);
      }
      const body = JSON.parse(decoder.decode(result.bytes));
      if (body.byteLength < 1 || typeof body.dataBase64 !== "string") {
        throw new Error("GPU hostcall returned an invalid byte envelope");
      }
      return bytesFromBase64(body.dataBase64);
    },
  };
  const oracleStartedAt = performance.now();
  const receipt = await runHardwareVisualOracle(hostcallProvider);
  const oracleMs = Math.round(performance.now() - oracleStartedAt);
  document.getElementById("status").textContent = "VERIFIED on installed pyproc/gpu";
  document.getElementById("status").className = "verified";
  document.getElementById("adapter").textContent = receipt.adapter.vendor + " " + receipt.adapter.architecture;
  document.getElementById("compute").textContent = "max error " + receipt.compute.maxAbsError;
  document.getElementById("pixel").textContent = "max channel error " + receipt.pixel.maxChannelError;
  document.getElementById("hostcall").textContent = requestIndex + " completed requests";
  const boundary = port.inspectCheckpointBoundary();
  await port.close();
  broker.close("hardware oracle complete");
  adapter.close();
  await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, receipt, requestCount: requestIndex, adapterMs, oracleMs,
      boundary, cleanup: { adapterState: adapter.inspect().state } }) });
} catch (error) {
  if (port) await port.close().catch(() => {});
  if (broker) broker.close("hardware oracle failed");
  if (adapter) adapter.close();
  document.getElementById("status").textContent = "RED: " + (error?.message || error);
  await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: { code: error?.code || null,
      message: String(error?.message || error), context: error?.context || null }, requestCount: requestIndex }) });
}
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocHardwareOracle-");
const publicDir = join(installed.appDir, "public");
const evidenceDir = requestedEvidenceDir || join(installed.tmp, "hardware-visual-oracle-evidence");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/gateReport") {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(204);
    response.end();
    try { resolveReport(JSON.parse(body)); }
    catch (error) { resolveReport({ ok: false, error: { message: String(error) } }); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/")
    ? safeJoin(installed.appDir, url.pathname)
    : safeJoin(publicDir, url.pathname === "/" ? "/hardwareVisualOracle.html" : url.pathname);
  if (!file) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  await sendFile(response, file);
});

let client = null;
let targetRef = null;
let sessionRef = null;
try {
  await mkdir(publicDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const packageJson = JSON.parse(await readFile(join(installed.appDir, "node_modules", "pyproc", "package.json"), "utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//, "")}`;
  await writeFile(join(publicDir, "hardwareVisualOracle.html"), page({
    "pyproc/gpu": target("./gpu"),
    "pyproc/wasi": target("./wasi"),
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-hardware-oracle", "manifest.json");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-hardware-oracle", "--engine-root",
    join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "hardware visual oracle product gate", "--acknowledge-effects",
    "--action", "snapshot", "--action", "screenshot", "--headed", "--gpu",
    ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 10000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  const report = await Promise.race([reportPromise, new Promise((_, reject) => setTimeout(() =>
    reject(new Error(`hardware visual oracle report timed out after ${timeoutMs} ms`)), timeoutMs))]);
  const attached = await client.attachSession(targetRef);
  sessionRef = attached.output;
  const screenshot = await client.act(sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const screenshotAction = screenshot.output.actions[0].result;
  const screenshotPath = join(evidenceDir, "hardware-visual-oracle.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.attachments[0].bytes));
  await client.deleteArtifact(screenshotAction.artifactRef);
  assert(report.ok === true, `hardware visual oracle RED: ${JSON.stringify(report.error || report)}`);
  assert(report.receipt?.protocol === "pyproc.hardwareVisualOracle" && report.receipt?.version === 1
    && report.receipt?.state === "verified", "hardware oracle receipt protocol changed");
  assert(report.receipt.adapter.class === "hardware" && report.receipt.adapter.isFallbackAdapter === false,
    `hardware adapter proof changed: ${JSON.stringify(report.receipt.adapter)}`);
  assert(report.receipt.compute.maxAbsError === 0
    && report.receipt.compute.expectedSha256 === report.receipt.compute.actualSha256,
  "compute oracle changed");
  assert(report.receipt.pixel.maxChannelError <= 1
    && report.receipt.pixel.expectedSha256 === report.receipt.pixel.actualSha256, "pixel oracle changed");
  assert(report.requestCount === 2 && report.boundary?.openResources?.length === 0
    && report.cleanup?.adapterState === "closed", "hostcall or resource cleanup changed");
  const summary = { state: "GREEN", adapter: report.receipt.adapter,
    compute: report.receipt.compute, pixel: report.receipt.pixel, requestCount: report.requestCount,
    adapterMs: report.adapterMs, oracleMs: report.oracleMs,
    ...(keepEvidence ? { screenshot: screenshotPath } : {}) };
  if (keepEvidence) await writeFile(join(evidenceDir, "hardware-visual-oracle.json"),
    `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef, { expectedRisk: "externalEffect" }).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence || requestedEvidenceDir) await rm(installed.tmp, { recursive: true, force: true });
}
