// ownedThreadCapabilityProbe.mjs - 설치 엔진의 공유 메모리와 Python thread 경계를 실측한다.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
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
<title>owned thread capability probe</title>
<script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center; color:#eff8ff;
  background:radial-gradient(circle at top,#173b54,#07131e 62%); font:16px/1.45 system-ui; }
main { box-sizing:border-box; width:min(880px,calc(100vw - 48px)); padding:32px; border:1px solid #75bde04d;
  border-radius:20px; background:#091a27f2; box-shadow:0 24px 80px #0009; }
h1 { margin:0 0 8px; } p { color:#b8d4e4; }
dl { display:grid; grid-template-columns:210px 1fr; gap:10px 18px; }
dt { color:#91bcd2; } dd { min-width:0; margin:0; font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
.pass { color:#75ebb0; } .boundary { color:#ffd081; } .red { color:#ff9c9c; font-weight:700; }
</style></head><body><main>
<h1>Owned engine thread boundary</h1><p id="status">Inspecting the installed engine...</p>
<dl><dt>Browser substrate</dt><dd id="browser">pending</dd><dt>WASM memory</dt><dd id="memory">pending</dd>
<dt>WASI imports</dt><dd id="imports">pending</dd><dt>Python thread model</dt><dd id="python">pending</dd>
<dt>Thread creation</dt><dd id="creation">pending</dd><dt>Product contract</dt><dd id="contract">not declared</dd></dl></main>
<script type="module">
import { boot } from "pyproc";
import { getDefaultKernelEngineManifest } from "pyproc/wasi";

function readUleb(bytes, cursor) {
  let value = 0; let shift = 0; let octet = 0;
  do { octet = bytes[cursor.offset++]; value |= (octet & 0x7f) << shift; shift += 7; } while (octet & 0x80);
  return value >>> 0;
}

function memoryContract(buffer) {
  const bytes = new Uint8Array(buffer); const cursor = { offset:8 };
  while (cursor.offset < bytes.length) {
    const section = bytes[cursor.offset++]; const size = readUleb(bytes,cursor); const end = cursor.offset + size;
    if (section === 5) {
      const count = readUleb(bytes,cursor); if (count !== 1) throw new Error("expected one defined memory");
      const flags = readUleb(bytes,cursor); const minimumPages = readUleb(bytes,cursor);
      const maximumPages = flags & 1 ? readUleb(bytes,cursor) : null;
      return { source:"defined", flags, minimumPages, maximumPages, shared:Boolean(flags & 2), memory64:Boolean(flags & 4) };
    }
    cursor.offset = end;
  }
  return { source:"imported-or-absent", flags:null, minimumPages:null, maximumPages:null, shared:null, memory64:null };
}

let machine = null;
try {
  const manifest = await getDefaultKernelEngineManifest();
  const wasmResponse = await fetch(manifest.artifacts.wasm.url);
  if (!wasmResponse.ok) throw new Error("installed engine WASM is unavailable");
  const wasmBytes = await wasmResponse.arrayBuffer();
  const wasmModule = new WebAssembly.Module(wasmBytes);
  const imports = WebAssembly.Module.imports(wasmModule).map((item) => item.module + "." + item.name).sort();
  const memory = memoryContract(wasmBytes);
  machine = await boot({ engineManifest:manifest, deterministic:true });
  const inspection = await machine.inspect();
  const python = JSON.parse((await machine.run(\`
import json, sys, threading, _thread
result = {"implementation": sys.thread_info.name, "lock": sys.thread_info.lock,
          "moduleOrigin": _thread.__spec__.origin, "isMainThread": threading.current_thread() is threading.main_thread()}
try:
    thread = threading.Thread(target=lambda: None)
    thread.start()
except Exception as error:
    result["failure"] = {"type": type(error).__name__, "message": str(error)}
else:
    thread.join()
    result["failure"] = None
print(json.dumps(result, sort_keys=True))
\`)).output.trim());
  const substrate = { crossOriginIsolated, sharedArrayBuffer:typeof SharedArrayBuffer === "function",
    hardwareConcurrency:navigator.hardwareConcurrency || null };
  const spawnImports = imports.filter((name) => name.includes("thread_spawn"));
  const declared = inspection.kernel.threading || null;
  const observedBoundary = substrate.crossOriginIsolated && substrate.sharedArrayBuffer
    && memory.source === "defined" && memory.shared === false && memory.maximumPages === null
    && spawnImports.length === 0 && python.implementation === "pthread-stubs"
    && python.moduleOrigin === "built-in" && python.isMainThread
    && python.failure?.type === "RuntimeError" && python.failure.message === "can't start new thread";
  const contractMatches = declared?.protocol === "pyproc.thread-capability" && declared.version === 1
    && declared.mode === "worker-processes" && declared.pythonImplementation === python.implementation
    && declared.pythonThreadCreation === false && declared.sharedWasmMemory === memory.shared
    && declared.wasiThreadSpawn === Boolean(spawnImports.length)
    && declared.failure?.pythonType === python.failure?.type && declared.failure?.message === python.failure?.message;
  const report = { ok:observedBoundary && contractMatches, observedBoundary, contractMatches,
    substrate, memory, spawnImports, python,
    manifest:{ engineId:manifest.engineId, nativeProfile:manifest.nativeProfile, digest:manifest.digest },
    descriptorThreading:declared };
  document.getElementById("browser").textContent = JSON.stringify(substrate);
  document.getElementById("memory").textContent = JSON.stringify(memory);
  document.getElementById("imports").textContent = spawnImports.length ? spawnImports.join(",") : "no thread spawn import";
  document.getElementById("python").textContent = python.implementation + " / " + python.moduleOrigin;
  document.getElementById("creation").textContent = python.failure
    ? python.failure.type + ": " + python.failure.message : "thread started";
  document.getElementById("contract").textContent = declared ? JSON.stringify(declared) : "not declared";
  for (const id of ["browser","memory","imports","python","creation"])
    document.getElementById(id).className = observedBoundary ? "boundary" : "red";
  document.getElementById("contract").className = declared ? "pass" : "red";
  document.getElementById("status").textContent = observedBoundary
    ? "BOUNDARY FOUND: browser sharing exists, installed Python threads do not" : "RED: observations drifted";
  document.getElementById("status").className = observedBoundary ? "boundary" : "red";
  await fetch("/probeReport", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(report) });
} catch (error) {
  document.getElementById("status").textContent = "RED: " + (error?.message || error);
  document.getElementById("status").className = "red";
  await fetch("/probeReport", { method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ok:false,fatal:{code:error?.code || null,message:String(error?.message || error)}}) });
} finally { if (machine) await machine.close(); }
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocThreadCapability-");
const publicDir = join(installed.appDir, "public");
const evidenceDir = join(installed.tmp, "thread-capability-evidence");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204); response.end();
    try { resolveReport(JSON.parse(body)); } catch (error) { resolveReport({ ok:false, fatal:{ message:String(error) } }); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir,url.pathname)
    : safeJoin(publicDir,url.pathname === "/" ? "/threadCapability.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response,file);
});

let client = null; let targetRef = null; let sessionRef = null;
try {
  await mkdir(publicDir,{recursive:true}); await mkdir(evidenceDir,{recursive:true});
  const packageJson = JSON.parse(await readFile(join(installed.appDir,"node_modules","pyproc","package.json"),"utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//,"")}`;
  await writeFile(join(publicDir,"threadCapability.html"),page({ "pyproc":target("."), "pyproc/wasi":target("./wasi") }));
  await new Promise((resolve) => server.listen(0,"127.0.0.1",resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir,".pyproc-thread-capability","manifest.json");
  const cli = binPath(installed.appDir,"pyproc-mcp");
  run(cli,["init","--recipe","authorizedBrowser","--project-root",installed.appDir,
    "--out",".pyproc-thread-capability","--engine-root",join(ROOT,"src","runtime","engines","wasi","owned","core"),
    "--timeout-ms",String(timeoutMs),"--origin",origin,"--max-risk","externalEffect",
    "--purpose","owned thread capability probe","--acknowledge-effects","--action","snapshot","--action","screenshot","--headed",
    ...(process.env.PYPROC_BROWSER ? ["--browser",process.env.PYPROC_BROWSER] : [])],{cwd:installed.appDir});
  const installedRequire = createRequire(join(installed.appDir,"productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath,{cwd:installed.appDir,startupTimeoutMs:timeoutMs,shutdownTimeoutMs:10000});
  const opened = await client.openTarget(`${origin}/`,{expectedRisk:"externalEffect",waitUntil:"load"});
  targetRef = opened.output.targetRef;
  const report = await withTimeout(reportPromise,timeoutMs,`thread capability report timed out after ${timeoutMs} ms`);
  const attached = await client.attachSession(targetRef); sessionRef = attached.output;
  const screenshot = await client.act(sessionRef,[{kind:"screenshot",format:"png",expectedRisk:"read"}]);
  const action = screenshot.output.actions[0].result;
  const screenshotBytes = Buffer.from(screenshot.attachments[0].bytes);
  const screenshotPath = join(evidenceDir,"owned-thread-capability.png");
  await writeFile(screenshotPath,screenshotBytes); await client.deleteArtifact(action.artifactRef);
  const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
  if (keepEvidence) await writeFile(join(evidenceDir,"owned-thread-capability.json"),`${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify({...report,screenshot:screenshotPath,screenshotSha256},null,2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef,{expectedRisk:"externalEffect"}).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp,{recursive:true,force:true});
}
