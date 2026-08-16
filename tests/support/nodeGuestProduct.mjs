// nodeGuestProduct.mjs - exact packed Machine의 Python, Linux, Node guest 제품 gate.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 900000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";
const fixtureDir = join(ROOT, "tests", "webMachine", "fixtures", "v86", "assets");
const catalog = JSON.parse(await readFile(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
const NODE_RUNTIME = Object.freeze({
  version: "22.22.0",
  revision: "6add85e4c46b8be383c8b637102d6b6fd206adce",
  sourceUrl: "https://nodejs.org/dist/v22.22.0/node-v22.22.0.tar.xz",
  sourceSha256: "4c138012bb5352f49822a8f3e6d1db71e00639d0c36d5b6756f91e4c6f30b683",
  oracleSha256: "b3aed4be1f24f10fa77253e267fe69403144d97072cfe305c828a7ce0c8589c0",
});
const injectedNodeImage = process.env.PYPROC_NODE_GUEST_IMAGE
  ? resolve(process.env.PYPROC_NODE_GUEST_IMAGE)
  : null;
const catalogNodeAsset = catalog.assets.find((entry) => entry.name === "buildroot-pyproc-node-i686.bin");
const catalogLinuxAsset = catalog.assets.find((entry) => entry.name === "buildroot-pyproc-i686.bin");
if (!catalogLinuxAsset) throw new Error("Linux guest asset is absent from scripts/assetCatalog.json");

async function resolveNodeAsset() {
  if (!injectedNodeImage) {
    if (!catalogNodeAsset) throw new Error("Node guest asset is absent from scripts/assetCatalog.json");
    return { ...catalogNodeAsset, sourcePath: join(fixtureDir, catalogNodeAsset.name) };
  }
  const bytes = await readFile(injectedNodeImage);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifestPath = process.env.PYPROC_NODE_GUEST_MANIFEST
    ? resolve(process.env.PYPROC_NODE_GUEST_MANIFEST)
    : join(dirname(injectedNodeImage), "build-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const valid = manifest.recipe === "pyproc-buildroot-node-i686-v1"
    && manifest.profile === "node"
    && manifest.runtime?.version === NODE_RUNTIME.version
    && manifest.runtime?.revision === NODE_RUNTIME.revision
    && manifest.runtime?.sourceUrl === NODE_RUNTIME.sourceUrl
    && manifest.runtime?.sourceSha256 === NODE_RUNTIME.sourceSha256
    && manifest.runtime?.oracle?.sha256 === NODE_RUNTIME.oracleSha256
    && manifest.runtimeOracle?.version === `v${NODE_RUNTIME.version}`
    && manifest.runtimeOracle?.sha256 === NODE_RUNTIME.oracleSha256
    && manifest.output?.name === "buildroot-pyproc-node-i686.bin"
    && manifest.output?.byteLength === bytes.byteLength
    && manifest.output?.sha256 === sha256
    && manifest.evidence?.legalWarnings?.length === 0;
  if (!valid) throw new Error(`Node guest build manifest does not match ${manifestPath}`);
  return { name: manifest.output.name, byteLength: bytes.byteLength, sha256, sourcePath: injectedNodeImage };
}

const nodeAsset = await resolveNodeAsset();
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

function page(asset, linuxAsset, firmware, importMap) {
  const nodeProgram = [
    "const crypto = require('node:crypto')",
    "const fs = require('node:fs')",
    "const source = 'pyproc-node-guest'",
    "const sha256 = crypto.createHash('sha256').update(source).digest('hex')",
    "fs.writeFileSync('/mnt/web/node-state.json', JSON.stringify({ value: 42 }))",
    "console.log(JSON.stringify({ version: process.version, arch: process.arch, platform: process.platform, sha256 }))",
  ].join(";");
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Three guest Web Computer</title><script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center; color:#eff8ff;
  background:radial-gradient(circle at top,#273f67,#090f1c 68%); font:16px/1.45 system-ui; }
main { box-sizing:border-box; width:min(900px,calc(100vw - 48px)); padding:30px; border:1px solid #8fb7ff55;
  border-radius:20px; background:#101a2cf2; box-shadow:0 24px 80px #0009; }
h1 { margin:0 0 8px; } p { color:#c4d7f5; } dl { display:grid; grid-template-columns:210px 1fr; gap:10px 18px; }
dt { color:#a9c6f4; } dd { min-width:0; margin:0; font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
.pass { color:#78efb2; } .red { color:#ff9f9f; font-weight:700; }
</style></head><body><main><h1>Python, Linux, and Node</h1><p id="status">Booting the installed Web Computer...</p>
<dl><dt>Guest set</dt><dd id="guests">pending</dd><dt>Node runtime</dt><dd id="runtime">pending</dd>
<dt>JavaScript CLI</dt><dd id="workload">pending</dd><dt>Resource inspection</dt><dd id="resources">pending</dd>
<dt>Mutated image</dt><dd id="integrity">pending</dd><dt>Signed Machine image</dt><dd id="image">pending</dd>
<dt>Network boundary</dt><dd id="network">pending</dd></dl></main>
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
import { MemoryMachineStore, createMachineCryptoProvider, createWebMachineKeyPair } from "pyproc/machine";
import { V86 } from "/assets/libv86.mjs";
const nodeAsset=${JSON.stringify({ target: "bzimage",
    url: "/assets/buildroot-pyproc-node-i686.bin", byteLength: asset.byteLength,
    sha256: `sha256:${asset.sha256}` })};
const nodeVerifiedAssets=${JSON.stringify([...firmware])}.concat(nodeAsset);
const linuxVerifiedAssets=${JSON.stringify([...firmware])}.concat(${JSON.stringify({
    target: "bzimage", url: "/assets/buildroot-pyproc-i686.bin",
    byteLength: linuxAsset.byteLength, sha256: `sha256:${linuxAsset.sha256}`,
  })});
const checks=[]; const timings={}; let stage="create"; let computer=null;
const viewport={width:innerWidth,height:innerHeight,devicePixelRatio};
const progress=async(value)=>{stage=value;const response=await fetch("/probeStage",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({stage:value,at:Math.round(performance.now())})});if(!response.ok)throw new Error("probe stage "+response.status);};
const check=(name,pass,info="")=>checks.push({name,pass:pass===true,info:String(info)});
const show=(id,value,pass)=>{const target=document.getElementById(id);target.textContent=typeof value==="string"?value:JSON.stringify(value);target.className=pass?"pass":"red";};
const codeOf=async(operation)=>{try{await operation();return "";}catch(error){return error?.code||String(error);}};
const serial=(machine,data,timeout=120000)=>machine.request({type:"serial",data:data.endsWith("\n")?data:data+"\n",waitFor:"# ",timeoutMs:timeout});
const linuxManifest=()=>({v86:{readyPattern:"buildroot login: ",shellPrompt:"# ",engineTimeoutMs:120000,
  serialBootstrap:[{data:"root\n",waitFor:"# ",timeoutMs:60000}],bootTimeoutMs:180000,assets:linuxVerifiedAssets,options:{
    wasm_path:"/assets/v86.wasm",filesystem:{},
    cmdline:"tsc=reliable mitigations=off random.trust_cpu=on nomodeset console=tty0 console=ttyS0",
    memory_size:64*1024*1024,disable_keyboard:true,disable_mouse:true,disable_speaker:true}}});
const nodeManifest=()=>({node:{runtime:"node",version:${JSON.stringify(NODE_RUNTIME.version)},sourceRevision:${JSON.stringify(NODE_RUNTIME.revision)},
  sourceUrl:${JSON.stringify(NODE_RUNTIME.sourceUrl)},sourceSha256:${JSON.stringify(NODE_RUNTIME.sourceSha256)}},
  v86:{readyPattern:"buildroot login: ",shellPrompt:"# ",engineTimeoutMs:180000,
    serialBootstrap:[{data:"root\n",waitFor:"# ",timeoutMs:60000}],bootTimeoutMs:240000,assets:nodeVerifiedAssets,options:{
      wasm_path:"/assets/v86.wasm",filesystem:{},
      cmdline:"tsc=reliable mitigations=off random.trust_cpu=on nomodeset console=tty0 console=ttyS0",
      memory_size:256*1024*1024,disable_keyboard:true,disable_mouse:true,disable_speaker:true}}});
try {
  await progress("module-loaded");
  const store=new MemoryMachineStore(); const signingKeyPair=await createWebMachineKeyPair(createMachineCryptoProvider(crypto));
  const consoleLines=[]; const lockManager={request:(_name,_options,callback)=>Promise.resolve().then(callback)};
  computer=createWebComputer({cryptoProvider:crypto,onConsole:(line)=>consoleLines.push(String(line)),
    linux:{V86,adapterVersion:"v86-0.5.424-buildroot612-state-v2",manifest:linuxManifest()},
    node:{V86,adapterVersion:"v86-0.5.424-node22-state-v1",manifest:nodeManifest()},
    durability:{groupId:"nodeGuestProduct",store,lockManager,ownerId:"nodeGuestOwner",getSigningKeyPair:()=>signingKeyPair,
      environmentFingerprint:"node-22.22.0-buildroot-2025.02.16"}});
  await progress("computer-created");let started=performance.now();await computer.initialize();timings.bootMs=Math.round(performance.now()-started);
  await progress("computer-initialized");
  const running=computer.runningMachineIds().sort();
  const guestSet=running.join(",")==="linuxOs,nodeOs,pythonOs";
  check("three guests boot through one lifecycle",guestSet,running.join(","));show("guests",running.join(" + "),guestSet);
  stage="execute";
  const encoded=btoa(${JSON.stringify(nodeProgram)});
  const [pythonResult,linuxResult,nodeResult]=await Promise.all([
    computer.machine("pythonOs").request({type:"run",code:"print(6 * 7)"}),
    serial(computer.machine("linuxOs"),"echo PYPROC_LINUX:42"),
    serial(computer.machine("nodeOs"),"printf '%s' '"+encoded+"' | base64 -d > /mnt/web/node-proof.js; node --max-old-space-size=24 /mnt/web/node-proof.js"),
  ]);
  const nodeLine=nodeResult.split("\n").find((line)=>line.trim().startsWith("{"));
  const nodeProof=nodeLine?JSON.parse(nodeLine):null;
  const runtimeOk=nodeProof?.version===${JSON.stringify(`v${NODE_RUNTIME.version}`)}&&nodeProof.arch==="ia32"&&nodeProof.platform==="linux";
  const workloadOk=nodeProof?.sha256===${JSON.stringify(NODE_RUNTIME.oracleSha256)}
    &&pythonResult.trim()==="42"&&linuxResult.includes("PYPROC_LINUX:42");
  check("real source-pinned Node runtime executes",runtimeOk,JSON.stringify(nodeProof));
  check("three guest CLI workloads complete",workloadOk,nodeProof?.sha256||nodeResult.slice(-240));
  show("runtime",nodeProof?nodeProof.version+" "+nodeProof.arch+" "+nodeProof.platform:"missing",runtimeOk);
  show("workload",nodeProof?.sha256||"missing",workloadOk);
  const inspection=await computer.machine("nodeOs").inspect();
  const linuxInspection=await computer.machine("linuxOs").inspect();
  const resourcesOk=inspection.adapterId==="x86-node"&&inspection.guest?.engine==="v86"
    &&inspection.guest?.assets?.length===3&&inspection.guest.assets.every((entry)=>entry.state==="verified")
    &&inspection.guest.assets.map((entry)=>entry.target).join(",")==="bios,bzimage,vga_bios"
    &&inspection.guest.block?.mode==="filesystem"&&linuxInspection.guest?.assets?.length===3
    &&linuxInspection.guest.assets.every((entry)=>entry.state==="verified")
    &&linuxInspection.guest.display?.errors===0;
  check("x86 guests report common resources and verified images",resourcesOk,
    JSON.stringify({node:inspection.guest,linux:linuxInspection.guest}));
  show("resources",resourcesOk?"2 x86 guests, 6 verified boot assets, 9P block":"contract drift",resourcesOk);
  await progress("workloads-complete");started=performance.now();const exported=await computer.exportImage();timings.exportMs=Math.round(performance.now()-started);
  await progress("image-exported");
  await serial(computer.machine("nodeOs"),"echo '{\"value\":99}' > /mnt/web/node-state.json");
  stage="mutated-import";await fetch("/nodeAssetMode",{method:"POST",body:"mutated"});
  const approved={pythonOs:{devices:["console","pythonDisk","network"]},
    linuxOs:{devices:["console","linuxDisk","display","input","network"]},
    nodeOs:{devices:["console","nodeDisk","network"]}};
  let mutationCode;
  try {
    mutationCode=await codeOf(()=>computer.importImage(exported.file,{trustedPublicKeys:[signingKeyPair.publicKey],approvedPermissions:approved}));
  } finally {await fetch("/nodeAssetMode",{method:"POST",body:"stable"});}
  const activeAfterReject=await serial(computer.machine("nodeOs"),"cat /mnt/web/node-state.json");
  const integrityOk=mutationCode==="WEB_MACHINE_ASSET_INTEGRITY"&&activeAfterReject.includes("99")
    &&computer.machine("nodeOs").state==="running";
  check("mutated Node image is rejected before active swap",integrityOk,mutationCode);
  show("integrity",integrityOk?mutationCode:"unsafe replacement",integrityOk);
  await progress("mutation-rejected");started=performance.now();const imported=await computer.importImage(exported.file,
    {trustedPublicKeys:[signingKeyPair.publicKey],approvedPermissions:approved});timings.importMs=Math.round(performance.now()-started);
  await progress("trusted-image-imported");
  const restoredState=await serial(computer.machine("nodeOs"),"cat /mnt/web/node-state.json");
  const imageOk=restoredState.includes("42")&&computer.runningMachineIds().length===3
    &&imported.archive.manifest.machines.map((entry)=>entry.machineId).sort().join(",")==="linuxOs,nodeOs,pythonOs";
  check("signed Machine image restores all three guests",imageOk,restoredState.trim().slice(-120));
  show("image",imageOk?"3 guests restored, Node state 42":"restore drift",imageOk);
  const network=performance.getEntriesByType("resource").map((entry)=>entry.name)
    .filter((url)=>new URL(url,location.href).origin!==location.origin);
  const networkOk=network.length===0;
  check("installed boot makes no third-party request",networkOk,network.join(","));show("network",networkOk?"zero third-party requests":network,networkOk);
  check("common console carries all guest identities",consoleLines.some((line)=>line.includes("kernel:boot"))
    &&consoleLines.some((line)=>line.includes("x86:boot:linuxOs"))&&consoleLines.some((line)=>line.includes("x86:boot:nodeOs")));
  const ok=checks.every((entry)=>entry.pass);const status=document.getElementById("status");
  status.textContent=ok?"GREEN: three source-fenced guests share one signed computer":"RED: Node guest contract drifted";
  status.className=ok?"pass":"red";
  await computer.dispose();computer=null;
  await progress("computer-disposed");
  await fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok,checks,timings,
    viewport,nodeProof,inspection:{adapterId:inspection.adapterId,guest:inspection.guest},imageBytes:exported.file.size,network})});
} catch(error) {
  const status=document.getElementById("status");const summary=String(error?.message||error).split("\n")[0].slice(0,240);
  status.textContent="RED: "+(error?.code?error.code+": ":"")+summary;status.className="red";
  await fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:false,checks,timings,viewport,stage,
    fatal:{name:error?.name||null,code:error?.code||null,message:String(error?.message||error),stack:String(error?.stack||"").slice(-1600)}})});
} finally {if(computer)await computer.dispose().catch(()=>undefined);}
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
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const stageEvents = [];
const installed = await installPackedPyProc("pyprocNodeGuestProduct-");
const publicDir = join(installed.appDir, "public");
const assetDir = join(publicDir, "assets");
const evidenceDir = join(installed.tmp, "node-guest-evidence");
const assetNames = ["libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin", "buildroot-pyproc-i686.bin"];
let nodeAssetMode = "stable";
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
  if (request.method === "POST" && url.pathname === "/nodeAssetMode") {
    let body = ""; for await (const chunk of request) body += chunk;
    if (body !== "stable" && body !== "mutated") { response.writeHead(400); response.end("invalid mode"); return; }
    nodeAssetMode = body;
    response.writeHead(204); response.end(); return;
  }
  if (request.method === "GET" && url.pathname === "/assets/buildroot-pyproc-node-i686.bin"
    && nodeAssetMode === "mutated") {
    stageEvents.push({ stage: "asset-node-mutated", at: 0, receivedAt: Date.now() });
    const bytes = Buffer.from(await readFile(join(assetDir, "buildroot-pyproc-node-i686.bin")));
    bytes[Math.floor(bytes.byteLength / 2)] ^= 1;
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store" });
    response.end(bytes); return;
  }
  if (request.method === "GET" && url.pathname === "/assets/buildroot-pyproc-node-i686.bin") {
    stageEvents.push({ stage: "asset-node-stable", at: 0, receivedAt: Date.now() });
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir, url.pathname)
    : safeJoin(publicDir, url.pathname === "/" ? "/nodeGuestProduct.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response, file);
});

let client = null; let targetRef = null; let sessionRef = null;
try {
  await mkdir(assetDir, { recursive: true }); await mkdir(evidenceDir, { recursive: true });
  for (const name of assetNames) await copyFile(join(fixtureDir, name), join(assetDir, name));
  await copyFile(nodeAsset.sourcePath, join(assetDir, "buildroot-pyproc-node-i686.bin"));
  const packageJson = JSON.parse(await readFile(join(installed.appDir, "node_modules", "pyproc", "package.json"), "utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//, "")}`;
  const pageHtml = page(nodeAsset, catalogLinuxAsset, firmwareAssets, {
    pyproc: target("."),
    "pyproc/machine": target("./machine"),
  });
  assertGeneratedPageSyntax(pageHtml);
  await writeFile(join(publicDir, "nodeGuestProduct.html"), pageHtml);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-node-guest-product", "manifest.json");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-node-guest-product", "--engine-root",
    join(installed.appDir, "node_modules", "pyproc", "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "three guest Web Computer product gate", "--acknowledge-effects", "--action", "snapshot", "--action", "screenshot",
    ...(process.env.PYPROC_NODE_GUEST_HEADED === "0" ? [] : ["--headed"]),
    ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 20000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  let report;
  try { report = await withTimeout(reportPromise, timeoutMs, `Node guest product report timed out after ${timeoutMs} ms`); }
  catch (error) { throw new Error(`${error.message}; stages=${JSON.stringify(stageEvents)}`, { cause: error }); }
  const attached = await client.attachSession(targetRef); sessionRef = attached.output;
  const screenshot = await client.act(sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const action = screenshot.output.actions[0].result;
  const screenshotBytes = Buffer.from(screenshot.attachments[0].bytes);
  const screenshotPath = join(evidenceDir, "three-guest-web-computer.png");
  await writeFile(screenshotPath, screenshotBytes); await client.deleteArtifact(action.artifactRef);
  const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
  if (keepEvidence) await writeFile(join(evidenceDir, "three-guest-web-computer.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, screenshot: screenshotPath, screenshotSha256,
    screenshotBytes: screenshotBytes.byteLength }, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef, { expectedRisk: "externalEffect" }).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp, { recursive: true, force: true });
}
