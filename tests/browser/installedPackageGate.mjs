// Browser gate for the exact npm tarball installed into an empty offline consumer app.
import { createServer } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, run } from "../packageHarness.mjs";
import { awaitGateReport, judgeReport, launchBrowser } from "./harness.mjs";
import { installedPackageCoverageManifest } from "./installedPackageCoverage.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const COVERAGE = installedPackageCoverageManifest();

function createInstalledServer(appDir, publicDir, onReport) {
  const server = createServer(async (request, response) => {
    server.requests += 1;
    const url = new URL(request.url, "http://local");
    if (request.method === "POST" && url.pathname === "/gateReport") {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(204);
      response.end();
      try { onReport(JSON.parse(body)); }
      catch (error) { onReport({ checks: [{ name: "report JSON", pass: false, info: String(error) }] }); }
      return;
    }
    let file;
    if (url.pathname === "/") file = join(publicDir, "installedPackageGate.html");
    else if (url.pathname === "/pyproc-assets.json") file = join(publicDir, "pyproc-assets.json");
    else if (url.pathname.startsWith("/node_modules/")) file = safeJoin(appDir, url.pathname);
    else file = safeJoin(publicDir, url.pathname);
    if (!file) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    await sendFile(response, file);
  });
  server.requests = 0;
  return server;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>pyproc installed package gate</title>
  <script type="importmap">{"imports":{
    "pyproc":"/node_modules/pyproc/index.js",
    "pyproc/assets":"/node_modules/pyproc/src/runtime/assets.js",
    "pyproc/history":"/node_modules/pyproc/src/state/index.js",
    "pyproc/machine":"/node_modules/pyproc/src/machine/index.js",
    "pyproc/runtime":"/node_modules/pyproc/src/composition/runtimeSubpath.js",
    "pyproc/gpu":"/node_modules/pyproc/src/composition/gpuSubpath.js",
    "pyproc/wasi":"/node_modules/pyproc/src/composition/wasiSubpath.js"
  }}</script>
</head>
<body><pre id="out">running</pre>
<script type="module">
import * as root from "pyproc";
import * as assets from "pyproc/assets";
import * as history from "pyproc/history";
import * as machineApi from "pyproc/machine";
import * as runtime from "pyproc/runtime";
import * as gpu from "pyproc/gpu";
import * as wasi from "pyproc/wasi";

const checks = [];
const timings = {};
const check = (name, pass, info = "") => checks.push({ name, pass: pass === true, info: String(info || "") });
let machine = null;
let revived = null;
let computer = null;
try {
  check("root exports the owned product entrances",
    JSON.stringify(Object.keys(root).sort()) === JSON.stringify(["PYPROC_ERROR_CODES", "PyProcError", "boot", "checkEnvironment", "createWebComputer", "open"].sort()));
  check("installed plumbing subpaths resolve",
    typeof runtime.KernelFactory === "function" && typeof runtime.KernelSession === "function"
      && typeof runtime.KernelProcess === "function" && typeof wasi.getDefaultKernelEngineManifest === "function"
      && typeof history.MemoryStateStore === "function" && typeof machineApi.createWebComputer === "function"
      && typeof gpu.createWebGpuHostAdapter === "function" && typeof gpu.runHardwareVisualOracle === "function"
      && gpu.GPU_ORACLE_PROTOCOL === "pyproc.hardwareVisualOracle" && gpu.GPU_ORACLE_VERSION === 1);

  const contract = assets.getPyProcAssetManifest({ baseURL: "/node_modules/pyproc/" });
  check("asset contract names the installed worker", contract.assets.length === 1
    && contract.assets[0].role === "wasiWorker" && contract.assets[0].sameOrigin === true);
  const generated = await fetch("/pyproc-assets.json").then((response) => response.json());
  check("installed asset graph has seven files", generated.files.length === 7
    && generated.entrypoints.length === 1 && generated.packageRoot === "/node_modules/pyproc/");
  const verified = await assets.verifyPyProcAssetIntegrity(generated, { roles: ["wasiWorker"] });
  check("installed asset bytes pass SHA-256", verified.verified === 7 && verified.bytes > 0);
  const bad = structuredClone(generated);
  bad.files[0].integrity = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  let badRejected = false;
  try { await assets.verifyPyProcAssetIntegrity(bad, { paths: [bad.files[0].path] }); }
  catch (error) { badRejected = error.code === "PYPROC_ASSET_INTEGRITY"; }
  check("bad installed asset integrity fails closed", badRejected);

  let startedAt = performance.now();
  machine = await root.boot({ deterministic: true });
  timings.ownedBootMs = Math.round(performance.now() - startedAt);
  const inspection = await machine.inspect();
  check("installed owned kernel boots", inspection.kernel.runtimeKind === "cpython-wasi"
    && inspection.kernel.workerOwned === true && inspection.kernel.directHeapAccess === false,
    timings.ownedBootMs + "ms");
  const executed = await machine.run("print(sum(range(20)))");
  check("installed kernel executes Python", executed.output.trim() === "190");
  await machine.run.set("installedValue", { text: "설치본", value: 41 });
  const value = await machine.run.get("installedValue");
  check("installed kernel transfers structured values", value.text === "설치본" && value.value === 41);
  const checkpoint = await machine.history.checkpoint();
  await machine.run.set("installedValue", { value: 99 });
  await machine.history.restore(checkpoint);
  check("installed checkpoint restores state", (await machine.run.get("installedValue")).value === 41);

  const terminal = machine.terminal({ timeTravel: true });
  await terminal.install();
  const terminalResult = await terminal.push("print(6 * 7)");
  check("installed terminal uses the kernel protocol", terminalResult.out.trim() === "42");
  const cloned = await machine.proc.clone({ pid: "installed-child" });
  const childResult = await cloned.process.execute("print(installedValue['value'] + 1)");
  const childExit = await cloned.process.wait();
  check("installed process clone executes", childResult.output.trim() === "42" && childExit.exitCode === 0);
  await cloned.process.close();

  const image = await machine.history.export({ createdAt: "2026-08-14T00:00:00.000Z" });
  timings.machineMB = +(new TextEncoder().encode(JSON.stringify(image)).byteLength / 1048576).toFixed(2);
  startedAt = performance.now();
  revived = await root.open(image);
  timings.imageOpenMs = Math.round(performance.now() - startedAt);
  check("installed Machine image opens", (await revived.run.get("installedValue")).value === 41
    && image.protocol === "pyproc.kernel-machine-image", timings.imageOpenMs + "ms");

  const consoleLines = [];
  computer = root.createWebComputer({ onConsole: (line) => consoleLines.push(line) });
  await computer.bootAll();
  const computerResult = await computer.machine("pythonOs").request({ type: "run", code: "print(7 * 6)" });
  check("installed WebComputer boots the default Python guest",
    computer.runningMachineIds().includes("pythonOs") && computerResult.trim() === "42"
      && consoleLines.some((line) => line.includes("kernel:boot")));

  check("installed graph is compatibility free",
    !JSON.stringify({ inspection, generated }).toLowerCase().includes(String.fromCharCode(112,121,111,100,105,100,101)));
} catch (error) {
  check("uncaught installed package error", false, error && (error.stack || error.message || String(error)));
} finally {
  let cleanupStartedAt = performance.now();
  if (computer) await computer.shutdownAll();
  timings.webComputerShutdownMs = Math.round(performance.now() - cleanupStartedAt);
  check("installed WebComputer shuts down", !computer || computer.machine("pythonOs").state === "stopped",
    timings.webComputerShutdownMs + "ms");
  cleanupStartedAt = performance.now();
  if (revived) await revived.close();
  if (machine) await machine.close();
  timings.kernelShutdownMs = Math.round(performance.now() - cleanupStartedAt);
  check("installed kernel machines close", timings.kernelShutdownMs < 10000, timings.kernelShutdownMs + "ms");
  const report = { ok: checks.every((entry) => entry.pass), checks, timings,
    coverageManifest: ${JSON.stringify(COVERAGE)} };
  await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
}
</script></body></html>`;

const { tmp, appDir } = await installPackedPyProc("pyprocProduct-");
try {
  const publicDir = join(appDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "installedPackageGate.html"), html);
  const cli = binPath(appDir, "pyproc-assets");
  if (!existsSync(cli)) throw new Error("installed pyproc-assets bin is missing");
  run(cli, ["--baseURL", "/node_modules/pyproc/", "--out", join(publicDir, "pyproc-assets.json")], { cwd: appDir });

  let resolveReport;
  const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
  const server = createInstalledServer(appDir, publicDir, resolveReport);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launch = () => launchBrowser(url, { prefix: "pyprocProduct-" });
  const first = launch();
  console.log(`pyproc installed package browser gate\n  browser: ${first.browser}\n  url:     ${url}\n`);
  const { result, session } = await awaitGateReport({
    reportPromise, timeoutMs: TIMEOUT_MS, session: first, relaunch: launch,
    requestCount: () => server.requests,
  });
  session.close();
  server.close();
  if (result.timedOut) {
    console.log(`FAIL gate timeout (${TIMEOUT_MS / 1000}s)`);
    process.exitCode = 1;
  } else {
    const coverageOk = JSON.stringify(result.coverageManifest) === JSON.stringify(COVERAGE);
    for (const entry of result.checks || []) {
      console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}${entry.info ? ` (${entry.info})` : ""}`);
    }
    const budget = JSON.parse(await readFile(new URL("./perfBudget.json", import.meta.url), "utf8")).installedMemoryBudgets;
    const extras = [{ name: "installed coverage manifest", pass: coverageOk }];
    for (const [key, limit] of Object.entries(budget || {})) {
      extras.push({ name: `${key} budget`, pass: Number.isFinite(result.timings?.[key]) && result.timings[key] <= limit });
    }
    const verdict = judgeReport(result, { floor: 17, extra: extras });
    for (const problem of verdict.problems) console.log(`FAIL ${problem}`);
    console.log(`\nmeasurements: ${JSON.stringify(result.timings || {})}`);
    console.log(`result: ${verdict.ok ? "GREEN" : "RED"} (${verdict.passed}/${verdict.total})`);
    process.exitCode = verdict.ok ? 0 : 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
