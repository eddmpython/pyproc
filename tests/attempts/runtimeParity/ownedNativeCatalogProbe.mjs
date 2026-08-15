// ownedNativeCatalogProbe.mjs - package-owned native catalog의 첫 공개 경계를 실측한다.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";

function page(importMap) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>owned native catalog probe</title>
  <script type="importmap">${JSON.stringify({ imports: importMap })}</script>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #eef7ff;
      background: radial-gradient(circle at top, #173c53, #07141f 62%); font: 16px/1.45 system-ui; }
    main { width: min(840px, calc(100vw - 48px)); padding: 32px; border: 1px solid #6fa8c755;
      border-radius: 20px; background: #0a1b28f2; box-shadow: 0 24px 80px #0009; }
    h1 { margin: 0 0 8px; } p { color: #b4cada; }
    dl { display: grid; grid-template-columns: 190px 1fr; gap: 10px 18px; }
    dt { color: #92b5cd; } dd { margin: 0; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .pass { color: #72e7ae; } .red { color: #ff9c9c; font-weight: 700; }
  </style>
</head>
<body><main>
  <h1>Owned native package catalog</h1>
  <p id="status">Opening the installed public surface...</p>
  <dl>
    <dt>Public helper</dt><dd id="helper">pending</dd>
    <dt>Engine fence</dt><dd id="engine">pending</dd>
    <dt>Artifact source</dt><dd id="source">pending</dd>
    <dt>Installed wrapper</dt><dd id="wrapper">pending</dd>
    <dt>Compiled origin</dt><dd id="native">pending</dd>
  </dl>
</main>
<script type="module">
import { boot } from "pyproc";
import * as wasi from "pyproc/wasi";

let machine = null;
try {
  if (typeof wasi.createOwnedPackageResolver !== "function") {
    throw Object.assign(new Error("pyproc/wasi has no package-owned native resolver helper"),
      { code: "PYPROC_PACKAGE_RESOLUTION" });
  }
  document.getElementById("helper").textContent = "createOwnedPackageResolver";
  document.getElementById("helper").className = "pass";
  machine = await boot({ deterministic: true });
  const resolver = await wasi.createOwnedPackageResolver();
  const environment = machine.createPackageEnvironment({ resolver });
  const receipt = await environment.install({ requirements: ["pyproc-native-host==1.0.0"] });
  const host = JSON.parse((await machine.run(
    "import json,pyproc_native_host; print(json.dumps(pyproc_native_host.inspect(),sort_keys=True))"
  )).output.trim());
  const descriptor = (await machine.inspect()).kernel;
  const packageEntry = receipt.lock.packages[0] || {};
  const report = {
    ok: receipt.engineId === machine.manifest.engineId
      && receipt.nativeProfile === machine.manifest.nativeProfile
      && receipt.lock.engineId === machine.manifest.engineId
      && receipt.lock.nativeProfile === machine.manifest.nativeProfile
      && receipt.sources[0] === "package"
      && packageEntry.name === "pyproc-native-host"
      && host.abiVersion === "pyproc.hostcall/1"
      && host.origin === "built-in"
      && descriptor.nativeProfile === machine.manifest.nativeProfile,
    helper: "createOwnedPackageResolver",
    engine: { engineId: receipt.engineId, nativeProfile: receipt.nativeProfile,
      descriptorNativeProfile: descriptor.nativeProfile, lockEngineId: receipt.lock.engineId },
    source: receipt.sources[0] || null,
    package: { name: packageEntry.name || null, version: packageEntry.version || null,
      filename: packageEntry.filename || null, sha256: packageEntry.sha256 || null },
    host,
  };
  document.getElementById("engine").textContent = report.engine.engineId + " / " + report.engine.nativeProfile;
  document.getElementById("source").textContent = report.source + " / " + report.package.sha256;
  document.getElementById("wrapper").textContent = report.package.filename;
  document.getElementById("native").textContent = report.host.origin + " / " + report.host.abiVersion;
  for (const id of ["engine", "source", "wrapper", "native"]) document.getElementById(id).className = report.ok ? "pass" : "red";
  document.getElementById("status").textContent = report.ok ? "GREEN" : "RED: package or native identity drifted";
  document.getElementById("status").className = report.ok ? "pass" : "red";
  await fetch("/probeReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report) });
} catch (error) {
  document.getElementById("status").textContent = "RED: " + (error?.message || error);
  document.getElementById("status").className = "red";
  document.getElementById("helper").textContent = error?.code || "failure";
  document.getElementById("helper").className = "red";
  await fetch("/probeReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, fatal: { code: error?.code || null, message: String(error?.message || error) } }) });
} finally {
  if (machine) await machine.close();
}
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocNativeCatalog-");
const publicDir = join(installed.appDir, "public");
const evidenceDir = join(installed.tmp, "native-catalog-evidence");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(204);
    response.end();
    try { resolveReport(JSON.parse(body)); }
    catch (error) { resolveReport({ ok: false, fatal: { message: String(error) } }); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/")
    ? safeJoin(installed.appDir, url.pathname)
    : safeJoin(publicDir, url.pathname === "/" ? "/nativeCatalog.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
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
  await writeFile(join(publicDir, "nativeCatalog.html"), page({ "pyproc": target("."), "pyproc/wasi": target("./wasi") }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-native-catalog", "manifest.json");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-native-catalog", "--engine-root",
    join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "owned native catalog probe", "--acknowledge-effects",
    "--action", "snapshot", "--action", "screenshot", "--headed",
    ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 10000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  const report = await Promise.race([reportPromise, new Promise((_, reject) => setTimeout(() =>
    reject(new Error(`native catalog report timed out after ${timeoutMs} ms`)), timeoutMs))]);
  const attached = await client.attachSession(targetRef);
  sessionRef = attached.output;
  const screenshot = await client.act(sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const action = screenshot.output.actions[0].result;
  const screenshotPath = join(evidenceDir, "owned-native-catalog.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.attachments[0].bytes));
  await client.deleteArtifact(action.artifactRef);
  if (keepEvidence) await writeFile(join(evidenceDir, "owned-native-catalog.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, screenshot: screenshotPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef, { expectedRisk: "externalEffect" }).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp, { recursive: true, force: true });
}
