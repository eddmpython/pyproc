// ownedPackageReachProbe.mjs - installed owned engine에서 package reach 첫 경계를 재측정한다.

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
  <title>owned package reach probe</title>
  <script type="importmap">${JSON.stringify({ imports: importMap })}</script>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #eef4ff;
      background: linear-gradient(145deg, #071525, #142c48); font: 16px/1.45 system-ui; }
    main { width: min(820px, calc(100vw - 48px)); padding: 32px; border: 1px solid #7aa7d955;
      border-radius: 20px; background: #0b1b30ee; box-shadow: 0 24px 80px #0008; }
    h1 { margin: 0 0 8px; } p { color: #adc3df; }
    dl { display: grid; grid-template-columns: 190px 1fr; gap: 10px 18px; }
    dt { color: #91acd0; } dd { margin: 0; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .pass { color: #79eab1; } .red { color: #ff9f9f; font-weight: 700; }
  </style>
</head>
<body><main>
  <h1>Owned WASI package reach</h1>
  <p id="status">Booting the installed engine...</p>
  <dl>
    <dt>Engine profile</dt><dd id="engine">pending</dd>
    <dt>Python platform</dt><dd id="platform">pending</dd>
    <dt>Pure wheel</dt><dd id="pure">pending</dd>
    <dt>Native wheel</dt><dd id="native">pending</dd>
    <dt>Dynamic surface</dt><dd id="dynamic">pending</dd>
  </dl>
</main>
<script type="module">
import { boot } from "pyproc";
import { SimpleApiPackageResolver } from "pyproc/wasi";

let machine = null;
try {
  machine = await boot({ deterministic: true });
  const resolver = new SimpleApiPackageResolver({
    indexes: [{ url: "https://pypi.org/simple/", trustRef: "trust:pypi" }],
    pythonVersion: "3.14.6",
    engineId: machine.manifest.engineId,
    nativeProfile: machine.manifest.nativeProfile,
  });
  const environment = machine.createPackageEnvironment({ resolver });
  const pureReceipt = await environment.install({ requirements: ["six==1.17.0"] });
  const pureRun = await machine.run("import six; print(six.__version__)");
  const platformRun = await machine.run(
    "import _imp,json,sys,sysconfig; print(json.dumps({"
      + "'platform':sysconfig.get_platform(),'extSuffix':sysconfig.get_config_var('EXT_SUFFIX'),"
      + "'extensionSuffixes':_imp.extension_suffixes(),'hasDlopenFlags':hasattr(sys,'getdlopenflags')},sort_keys=True))");
  const platform = JSON.parse(platformRun.output.trim());
  let nativeError = null;
  try { await environment.install({ requirements: ["numpy==2.5.1"] }); }
  catch (error) { nativeError = { code: error?.code || null, message: String(error?.message || error) }; }
  const report = {
    ok: pureRun.output.trim() === "1.17.0" && nativeError === null,
    engine: { engineId: machine.manifest.engineId, target: machine.manifest.target,
      nativeProfile: machine.manifest.nativeProfile },
    platform,
    pure: { version: pureRun.output.trim(), environmentId: pureReceipt.environmentId,
      filename: pureReceipt.lock.packages[0]?.filename || null },
    native: nativeError,
    resolver: { allowedTags: resolver.allowedTags, nativeProfile: resolver.nativeProfile },
  };
  document.getElementById("engine").textContent = report.engine.engineId + " / " + report.engine.nativeProfile;
  document.getElementById("platform").textContent = report.platform.platform + " / " + report.platform.extSuffix;
  document.getElementById("pure").textContent = report.pure.filename + " imported as " + report.pure.version;
  document.getElementById("pure").className = "pass";
  document.getElementById("native").textContent = nativeError ? nativeError.code + ": " + nativeError.message : "installed";
  document.getElementById("native").className = nativeError ? "red" : "pass";
  document.getElementById("dynamic").textContent = JSON.stringify({ suffixes: report.platform.extensionSuffixes,
    hasDlopenFlags: report.platform.hasDlopenFlags });
  document.getElementById("status").textContent = report.ok ? "GREEN" : "RED: native package reach stops before install";
  document.getElementById("status").className = report.ok ? "pass" : "red";
  await fetch("/probeReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report) });
} catch (error) {
  document.getElementById("status").textContent = "RED: " + (error?.message || error);
  document.getElementById("status").className = "red";
  await fetch("/probeReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, fatal: { code: error?.code || null, message: String(error?.message || error) } }) });
} finally {
  if (machine) await machine.close();
}
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocPackageReach-");
const publicDir = join(installed.appDir, "public");
const evidenceDir = join(installed.tmp, "package-reach-evidence");
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
    : safeJoin(publicDir, url.pathname === "/" ? "/packageReach.html" : url.pathname);
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
  await writeFile(join(publicDir, "packageReach.html"), page({ "pyproc": target("."), "pyproc/wasi": target("./wasi") }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-package-reach", "manifest.json");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-package-reach", "--engine-root",
    join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "owned package reach probe", "--acknowledge-effects",
    "--action", "snapshot", "--action", "screenshot", "--headed",
    ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 10000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  const report = await Promise.race([reportPromise, new Promise((_, reject) => setTimeout(() =>
    reject(new Error(`package reach report timed out after ${timeoutMs} ms`)), timeoutMs))]);
  const attached = await client.attachSession(targetRef);
  sessionRef = attached.output;
  const screenshot = await client.act(sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const action = screenshot.output.actions[0].result;
  const screenshotPath = join(evidenceDir, "owned-package-reach.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.attachments[0].bytes));
  await client.deleteArtifact(action.artifactRef);
  if (keepEvidence) await writeFile(join(evidenceDir, "owned-package-reach.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, screenshot: screenshotPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef, { expectedRisk: "externalEffect" }).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp, { recursive: true, force: true });
}
