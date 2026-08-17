// linuxPythonProduct.mjs - packed createWebComputer().linuxPython이 실제 guest python3를 친다.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PYTHON_RUNTIME, PROFILES } from "../../scripts/buildroot/buildrootProfiles.js";
import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 900000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";
const fixtureDir = join(ROOT, "tests", "webMachine", "fixtures", "v86", "assets");
const catalog = JSON.parse(await readFile(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
const injectedPythonImage = process.env.PYPROC_LINUX_PYTHON_IMAGE
  ? resolve(process.env.PYPROC_LINUX_PYTHON_IMAGE)
  : null;
const catalogPythonAsset = catalog.assets.find((entry) => entry.name === PROFILES.python.outputName);

async function resolvePythonAsset() {
  if (!injectedPythonImage) {
    if (!catalogPythonAsset) {
      throw new Error(
        "Linux Python guest asset is absent. Build with npm run assets:buildroot-python and set PYPROC_LINUX_PYTHON_IMAGE.",
      );
    }
    return { ...catalogPythonAsset, sourcePath: join(fixtureDir, catalogPythonAsset.name) };
  }
  const bytes = await readFile(injectedPythonImage);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifestPath = process.env.PYPROC_LINUX_PYTHON_MANIFEST
    ? resolve(process.env.PYPROC_LINUX_PYTHON_MANIFEST)
    : join(dirname(injectedPythonImage), "build-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const valid = manifest.recipe === PROFILES.python.recipe
    && manifest.profile === "python"
    && manifest.runtime?.version === PYTHON_RUNTIME.version
    && manifest.runtime?.revision === PYTHON_RUNTIME.revision
    && manifest.runtime?.sourceUrl === PYTHON_RUNTIME.sourceUrl
    && manifest.runtime?.sourceSha256 === PYTHON_RUNTIME.sourceSha256
    && manifest.runtime?.oracle?.sha256 === PYTHON_RUNTIME.oracle.sha256
    && manifest.runtimeOracle?.version === PYTHON_RUNTIME.version
    && manifest.runtimeOracle?.sha256 === PYTHON_RUNTIME.oracle.sha256
    && manifest.output?.name === PROFILES.python.outputName
    && manifest.output?.byteLength === bytes.byteLength
    && manifest.output?.sha256 === sha256
    && manifest.evidence?.legalWarnings?.length === 0;
  if (!valid) throw new Error(`Linux Python guest build manifest does not match ${manifestPath}`);
  return { name: manifest.output.name, byteLength: bytes.byteLength, sha256, sourcePath: injectedPythonImage };
}

const pythonAsset = await resolvePythonAsset();
const firmwareAssets = Object.freeze([
  ["bios", "seabios.bin"],
  ["vga_bios", "vgabios.bin"],
].map(([target, name]) => {
  const asset = catalog.assets.find((entry) => entry.name === name);
  if (!asset) throw new Error(`${name} is absent from scripts/assetCatalog.json`);
  return Object.freeze({
    target,
    url: `/assets/${name}`,
    byteLength: asset.byteLength,
    sha256: `sha256:${asset.sha256}`,
  });
}));

async function withTimeout(promise, delayMs, message) {
  let timer = null;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), delayMs);
    })]);
  } finally { if (timer !== null) clearTimeout(timer); }
}

function page(asset, firmware, importMap) {
  const linuxVerifiedAssets = [...firmware, {
    target: "bzimage",
    url: `/assets/${PROFILES.python.outputName}`,
    byteLength: asset.byteLength,
    sha256: `sha256:${asset.sha256}`,
  }];
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Native Linux CPython</title><script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center; color:#eff8ff;
  background:radial-gradient(circle at top,#273f67,#090f1c 68%); font:16px/1.45 system-ui; }
main { box-sizing:border-box; width:min(900px,calc(100vw - 48px)); padding:30px; border:1px solid #8fb7ff55;
  border-radius:20px; background:#101a2cf2; }
h1 { margin:0 0 8px; } p { color:#c4d7f5; } dl { display:grid; grid-template-columns:210px 1fr; gap:10px 18px; }
dt { color:#a9c6f4; } dd { min-width:0; margin:0; font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
.pass { color:#78efb2; } .red { color:#ff9f9f; font-weight:700; }
</style></head><body><main><h1>WASI default and native Linux CPython</h1>
<p id="status">Booting the installed Web Computer...</p>
<dl><dt>Default kernel</dt><dd id="wasi">pending</dd><dt>Native run</dt><dd id="native">pending</dd>
<dt>Native pip</dt><dd id="pip">pending</dd><dt>Door</dt><dd id="door">pending</dd>
<dt>Network</dt><dd id="network">pending</dd></dl></main>
<script>
const reportEarlyFailure=(kind,event)=>fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({ok:false,stage:"module",checks:[],timings:{},viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},
    fatal:{name:kind,code:null,message:String(event?.reason?.message||event?.message||event?.reason||kind),
      stack:String(event?.reason?.stack||event?.error?.stack||"").slice(-1600)}})}).catch(()=>undefined);
addEventListener("error",(event)=>reportEarlyFailure("window.error",event));
addEventListener("unhandledrejection",(event)=>reportEarlyFailure("unhandledrejection",event));
</script>
<script type="module">
import { createWebComputer } from "pyproc";
import { V86 } from "/assets/libv86.mjs";
const checks=[]; const timings={}; let stage="create"; let computer=null;
const viewport={width:innerWidth,height:innerHeight,devicePixelRatio};
const progress=async(value)=>{stage=value;const response=await fetch("/probeStage",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({stage:value,at:Math.round(performance.now())})});if(!response.ok)throw new Error("probe stage "+response.status);};
const check=(name,pass,info="")=>checks.push({name,pass:pass===true,info:String(info)});
const show=(id,value,pass)=>{const target=document.getElementById(id);target.textContent=typeof value==="string"?value:JSON.stringify(value);target.className=pass?"pass":"red";};
const linuxManifest=()=>({v86:{readyPattern:"buildroot login: ",shellPrompt:"# ",engineTimeoutMs:180000,
  serialBootstrap:[{data:"root\n",waitFor:"# ",timeoutMs:60000}],bootTimeoutMs:240000,
  assets:${JSON.stringify(linuxVerifiedAssets)},options:{
    wasm_path:"/assets/v86.wasm",filesystem:{},
    cmdline:"tsc=reliable mitigations=off random.trust_cpu=on nomodeset console=tty0 console=ttyS0",
    memory_size:256*1024*1024,disable_keyboard:true,disable_mouse:true,disable_speaker:true}}});
try {
  await progress("module-loaded");
  const consoleLines=[];
  computer=createWebComputer({cryptoProvider:crypto,onConsole:(line)=>consoleLines.push(String(line)),
    linux:{V86,adapterVersion:"v86-0.5.424-python312-state-v1",manifest:linuxManifest()}});
  await progress("computer-created");
  let started=performance.now();
  await computer.bootAll();
  timings.bootMs=Math.round(performance.now()-started);
  await progress("computer-booted");
  const door=computer.linuxPython.inspect();
  const doorOk=door.available===true&&door.replacesDefaultBoot===false&&door.nativeAbi==="linux-elf"
    &&door.python==="python3"&&computer.machines.has("pythonOs")&&computer.machines.has("linuxOs");
  check("native door sits beside default WASI pythonOs",doorOk,JSON.stringify(door));
  show("door",doorOk?"linuxPython available, replacesDefaultBoot false":"door drift",doorOk);
  stage="execute";
  const wasi=await computer.machine("pythonOs").request({type:"run",code:"print(6 * 7)"});
  const wasiOk=String(wasi).trim()==="42";
  check("default WASI kernel still executes",wasiOk,String(wasi));
  show("wasi",String(wasi).trim(),wasiOk);
  started=performance.now();
  const native=await computer.linuxPython.run("print(40 + 2)");
  timings.nativeMs=Math.round(performance.now()-started);
  const nativeOk=native.native===true&&native.kind==="run"&&native.python==="python3"
    &&native.argv.join(" ")==="python3 -c print(40 + 2)"&&String(native.stdout).includes("42");
  check("shipped linuxPython.run executes guest python3",nativeOk,String(native.stdout).slice(-240));
  show("native",nativeOk?native.stdout.slice(-120):"missing 42",nativeOk);
  const pip=await computer.linuxPython.pip(["--version"]);
  const pipOk=pip.native===true&&pip.kind==="pip"&&pip.argv.join(" ")==="python3 -m pip --version"
    &&/pip/i.test(String(pip.stdout));
  check("shipped linuxPython.pip executes guest python3 -m pip",pipOk,String(pip.stdout).slice(-240));
  show("pip",pipOk?pip.stdout.slice(-120):"pip missing",pipOk);
  const network=performance.getEntriesByType("resource").map((entry)=>entry.name)
    .filter((url)=>new URL(url,location.href).origin!==location.origin);
  const networkOk=network.length===0;
  check("installed boot makes no third-party request",networkOk,network.join(","));
  show("network",networkOk?"zero third-party requests":network,networkOk);
  const ok=checks.every((entry)=>entry.pass);
  const status=document.getElementById("status");
  status.textContent=ok?"GREEN: WASI default and native Linux CPython both ran":"RED: native Linux CPython contract drifted";
  status.className=ok?"pass":"red";
  await computer.shutdownAll();computer=null;
  await progress("computer-stopped");
  await fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok,checks,timings,
    viewport,native,pip,wasi:String(wasi),network})});
} catch(error) {
  const status=document.getElementById("status");const summary=String(error?.message||error).split("\\n")[0].slice(0,240);
  status.textContent="RED: "+(error?.code?error.code+": ":"")+summary;status.className="red";
  await fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:false,checks,timings,viewport,stage,
    fatal:{name:error?.name||null,code:error?.code||null,message:String(error?.message||error),stack:String(error?.stack||"").slice(-1600)}})});
} finally {if(computer)await computer.shutdownAll().catch(()=>undefined);}
</script></body></html>`;
}

function assertGeneratedPageSyntax(html) {
  const scripts = html.matchAll(/<script( type="module")?>([\s\S]*?)<\/script>/g);
  for (const script of scripts) {
    run(process.execPath, ["--check", ...(script[1] ? ["--input-type=module"] : [])], {
      input: script[2],
      capture: true,
    });
  }
}

let resolveReport;
const reportPromise = new Promise((resolveReportValue) => { resolveReport = resolveReportValue; });
const stageEvents = [];
const installed = await installPackedPyProc("pyprocLinuxPythonProduct-");
const publicDir = join(installed.appDir, "public");
const assetDir = join(publicDir, "assets");
const evidenceDir = join(installed.tmp, "linux-python-evidence");
const assetNames = ["libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin"];
const server = createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204); response.end();
    try { resolveReport(JSON.parse(body)); } catch (error) { resolveReport({ ok: false, fatal: { message: String(error) } }); }
    return;
  }
  if (request.method === "POST" && url.pathname === "/probeStage") {
    let body = ""; for await (const chunk of request) body += chunk;
    try {
      const event = JSON.parse(body);
      stageEvents.push({ stage: String(event.stage || "unknown"), at: Number(event.at || 0), receivedAt: Date.now() });
      response.writeHead(204); response.end();
    } catch (error) { response.writeHead(400); response.end("invalid stage"); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir, url.pathname)
    : safeJoin(publicDir, url.pathname === "/" ? "/linuxPythonProduct.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response, file);
});

let client = null; let targetRef = null; let sessionRef = null;
try {
  await mkdir(assetDir, { recursive: true }); await mkdir(evidenceDir, { recursive: true });
  for (const name of assetNames) await copyFile(join(fixtureDir, name), join(assetDir, name));
  await copyFile(pythonAsset.sourcePath, join(assetDir, PROFILES.python.outputName));
  const packageJson = JSON.parse(await readFile(join(installed.appDir, "node_modules", "pyproc", "package.json"), "utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//, "")}`;
  const pageHtml = page(pythonAsset, firmwareAssets, {
    pyproc: target("."),
    "pyproc/machine": target("./machine"),
  });
  assertGeneratedPageSyntax(pageHtml);
  await writeFile(join(publicDir, "linuxPythonProduct.html"), pageHtml);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-linux-python-product", "manifest.json");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-linux-python-product", "--engine-root",
    join(installed.appDir, "node_modules", "pyproc", "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "native Linux CPython product gate", "--acknowledge-effects", "--action", "snapshot", "--action", "screenshot",
    ...(process.env.PYPROC_LINUX_PYTHON_HEADED === "0" ? [] : ["--headed"]),
    ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 20000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  let report;
  try { report = await withTimeout(reportPromise, timeoutMs, `Linux Python product report timed out after ${timeoutMs} ms`); }
  catch (error) { throw new Error(`${error.message}; stages=${JSON.stringify(stageEvents)}`, { cause: error }); }
  const attached = await client.attachSession(targetRef); sessionRef = attached.output;
  const screenshot = await client.act(sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const action = screenshot.output.actions[0].result;
  const screenshotBytes = Buffer.from(screenshot.attachments[0].bytes);
  const screenshotPath = join(evidenceDir, "linux-python-web-computer.png");
  await writeFile(screenshotPath, screenshotBytes); await client.deleteArtifact(action.artifactRef);
  const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
  if (keepEvidence) await writeFile(join(evidenceDir, "linux-python-web-computer.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, screenshot: screenshotPath, screenshotSha256,
    screenshotBytes: screenshotBytes.byteLength }, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef, { expectedRisk: "externalEffect" }).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!keepEvidence) await rm(installed.tmp, { recursive: true, force: true });
}
