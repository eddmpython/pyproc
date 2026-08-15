// ownedScientificSimdProbe.mjs - 설치본 data engine과 SIMD package의 첫 공개 경계를 실측한다.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";

async function withTimeout(promise, timeout, message) {
  let timer = null;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    })]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function page(importMap) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>owned scientific SIMD probe</title>
<script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center; color:#f0fbff;
  background:linear-gradient(145deg,#07182b,#173c4a); font:16px/1.45 system-ui; }
main { width:min(860px,calc(100vw - 48px)); padding:32px; border:1px solid #70b6c655;
  border-radius:20px; background:#091c29f2; box-shadow:0 24px 80px #0009; }
h1 { margin:0 0 8px; } p { color:#b7d3dc; }
dl { display:grid; grid-template-columns:190px 1fr; gap:10px 18px; }
dt { color:#94bdca; } dd { margin:0; font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
.pass { color:#75ebb0; } .red { color:#ff9c9c; font-weight:700; }
</style></head><body><main>
<h1>Owned scientific SIMD profile</h1><p id="status">Opening the installed data surface...</p>
<dl><dt>Data manifest</dt><dd id="manifest">pending</dd><dt>Engine fence</dt><dd id="engine">pending</dd>
<dt>Package source</dt><dd id="source">pending</dd><dt>SIMD oracle</dt><dd id="simd">pending</dd>
<dt>Numeric result</dt><dd id="numeric">pending</dd><dt>Scientific boundary</dt><dd id="boundary">pending</dd></dl></main>
<script type="module">
import { boot } from "pyproc";
import * as wasi from "pyproc/wasi";
let machine = null;
try {
  if (typeof wasi.getDataKernelEngineManifest !== "function") {
    throw Object.assign(new Error("pyproc/wasi has no installed data engine manifest"),
      { code:"PYPROC_ASSET_MISSING" });
  }
  document.getElementById("manifest").textContent = "getDataKernelEngineManifest";
  document.getElementById("manifest").className = "pass";
  const manifest = await wasi.getDataKernelEngineManifest();
  machine = await boot({ engineManifest:manifest, deterministic:true });
  const resolver = await wasi.createOwnedPackageResolver({ profile:"data" });
  const packages = machine.createPackageEnvironment({ resolver });
  const receipt = await packages.install({ requirements:["pyproc-native-data==1.0.0","numpy==2.5.1"] });
  const oracle = JSON.parse((await machine.run(\`
import importlib, json
from array import array
import pyproc_native_data
import numpy as np
left = array("d", [1.0, 2.5, -4.0, 8.0, 3.0])
right = array("d", [3.0, 4.5, 6.0, -2.0, 7.0])
added = array("d")
added.frombytes(pyproc_native_data.vector_add_f64(left, right))
scientific = {}
for name in ("scipy", "pandas", "polars"):
    try:
        importlib.import_module(name)
    except Exception as error:
        scientific[name] = type(error).__name__
    else:
        scientific[name] = "IMPORTED"
print(json.dumps({"info": pyproc_native_data.inspect(), "added": list(added),
                  "dot": pyproc_native_data.dot_f64(left, right),
                  "numpy":{"version":np.__version__,
                  "sum":np.arange(6,dtype=np.float64).reshape(2,3).sum(axis=1).tolist(),
                  "dot":np.dot(np.array([1.,2.,3.]),np.array([4.,5.,6.])),
                  "solve":np.linalg.solve(np.array([[3.,1.],[1.,2.]]),np.array([9.,8.])).tolist(),
                  "random":np.random.default_rng(123).integers(0,100,5).tolist()},
                  "scientific": scientific}, sort_keys=True))
\`)).output.trim());
  const report = { ok: manifest.nativeProfile === "data" && receipt.engineId === manifest.engineId
    && receipt.nativeProfile === "data" && receipt.lock.engineId === manifest.engineId
    && receipt.sources.length === 2 && receipt.sources.every((source) => source === "package")
    && receipt.lock.packages.some((item) => item.name === "pyproc-native-data")
    && receipt.lock.packages.some((item) => item.name === "numpy")
    && oracle.info.simd === "wasm-simd128" && oracle.info.origin === "built-in"
    && oracle.added.join(",") === "4,7,2,6,10" && oracle.dot === -4.75
    && oracle.numpy.version === "2.5.1" && oracle.numpy.sum.join(",") === "3,12"
    && oracle.numpy.dot === 32 && oracle.numpy.solve.join(",") === "2,3"
    && oracle.numpy.random.join(",") === "1,68,59,5,90"
    && Object.values(oracle.scientific).every((value) => value === "ModuleNotFoundError"),
    engine:{ engineId:manifest.engineId, nativeProfile:manifest.nativeProfile }, source:receipt.sources,
    packages:receipt.lock.packages.map(({name,filename,sha256}) => ({name,filename,sha256})), oracle };
  document.getElementById("engine").textContent = report.engine.engineId + " / " + report.engine.nativeProfile;
  document.getElementById("source").textContent = report.source.join(",") + " / "
    + report.packages.map((item) => item.filename).join(",");
  document.getElementById("simd").textContent = report.oracle.info.simd + " / " + report.oracle.info.origin;
  document.getElementById("numeric").textContent = JSON.stringify({ added:report.oracle.added,
    dot:report.oracle.dot, numpy:report.oracle.numpy });
  document.getElementById("boundary").textContent = JSON.stringify(report.oracle.scientific);
  for (const id of ["engine","source","simd","numeric","boundary"]) document.getElementById(id).className = report.ok ? "pass" : "red";
  document.getElementById("status").textContent = report.ok ? "GREEN" : "RED: data SIMD identity or result drifted";
  document.getElementById("status").className = report.ok ? "pass" : "red";
  await fetch("/probeReport", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(report) });
} catch (error) {
  document.getElementById("status").textContent = "RED: " + (error?.message || error);
  document.getElementById("status").className = "red";
  document.getElementById("manifest").textContent = error?.code || "failure";
  document.getElementById("manifest").className = "red";
  await fetch("/probeReport", { method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ok:false,fatal:{code:error?.code || null,message:String(error?.message || error)}}) });
} finally { if (machine) await machine.close(); }
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocScientificSimd-");
const publicDir = join(installed.appDir, "public");
const evidenceDir = join(installed.tmp, "scientific-simd-evidence");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204); response.end();
    try { resolveReport(JSON.parse(body)); } catch (error) { resolveReport({ok:false,fatal:{message:String(error)}}); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir,url.pathname)
    : safeJoin(publicDir,url.pathname === "/" ? "/scientificSimd.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response,file);
});

let client = null; let targetRef = null; let sessionRef = null;
try {
  await mkdir(publicDir,{recursive:true}); await mkdir(evidenceDir,{recursive:true});
  const packageJson = JSON.parse(await readFile(join(installed.appDir,"node_modules","pyproc","package.json"),"utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//,"")}`;
  await writeFile(join(publicDir,"scientificSimd.html"),page({"pyproc":target("."),"pyproc/wasi":target("./wasi")}));
  await new Promise((resolve) => server.listen(0,"127.0.0.1",resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir,".pyproc-scientific-simd","manifest.json");
  const cli = binPath(installed.appDir,"pyproc-mcp");
  run(cli,["init","--recipe","authorizedBrowser","--project-root",installed.appDir,
    "--out",".pyproc-scientific-simd","--engine-root",join(ROOT,"src","runtime","engines","wasi","owned","core"),
    "--timeout-ms",String(timeoutMs),"--origin",origin,"--max-risk","externalEffect",
    "--purpose","owned scientific SIMD probe","--acknowledge-effects","--action","snapshot","--action","screenshot","--headed",
    ...(process.env.PYPROC_BROWSER ? ["--browser",process.env.PYPROC_BROWSER] : [])],{cwd:installed.appDir});
  const installedRequire = createRequire(join(installed.appDir,"productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath,{cwd:installed.appDir,startupTimeoutMs:timeoutMs,shutdownTimeoutMs:10000});
  const opened = await client.openTarget(`${origin}/`,{expectedRisk:"externalEffect",waitUntil:"load"});
  targetRef = opened.output.targetRef;
  const report = await withTimeout(reportPromise, timeoutMs,
    `scientific SIMD report timed out after ${timeoutMs} ms`);
  const attached = await client.attachSession(targetRef); sessionRef = attached.output;
  const screenshot = await client.act(sessionRef,[{kind:"screenshot",format:"png",expectedRisk:"read"}]);
  const action = screenshot.output.actions[0].result;
  const screenshotPath = join(evidenceDir,"owned-scientific-simd.png");
  await writeFile(screenshotPath,Buffer.from(screenshot.attachments[0].bytes)); await client.deleteArtifact(action.artifactRef);
  if (keepEvidence) await writeFile(join(evidenceDir,"owned-scientific-simd.json"),`${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify({...report,screenshot:screenshotPath},null,2)); if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef,{expectedRisk:"externalEffect"}).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp,{recursive:true,force:true});
}
