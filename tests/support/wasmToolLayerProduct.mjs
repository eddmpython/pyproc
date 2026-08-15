// wasmToolLayerProduct.mjs - packed Machine resident tool product gate through public Control.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";
const expectToolBridge = process.env.PYPROC_EXPECT_TOOL_BRIDGE !== "0";

async function withTimeout(promise, timeout, message) {
  let timer = null;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    })]);
  } finally { if (timer !== null) clearTimeout(timer); }
}

function page(importMap, expectBridge) {
  const pythonProbe = JSON.stringify([
    "import json",
    "try:",
    "    import pyprocTools",
    "    receipts = {",
    "        \"rg\": pyprocTools.run(\"rg\", [\"--version\"]),",
    "        \"git\": pyprocTools.run(\"git\", [\"--git-dir=/home/project/.git\", \"log\", \"-1\"]),",
    "    }",
    "    print(json.dumps({\"available\": True, \"inspection\": pyprocTools.inspect(), \"receipts\": receipts}, sort_keys=True))",
    "except Exception as error:",
    "    print(json.dumps({\"available\": False, \"errorType\": type(error).__name__, \"message\": str(error)}, sort_keys=True))",
  ].join("\n"));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>owned wasm tool layer</title><script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center; color:#edfaff;
  background:radial-gradient(circle at top,#244b50,#081718 66%); font:16px/1.45 system-ui; }
main { box-sizing:border-box; width:min(900px,calc(100vw - 48px)); padding:32px; border:1px solid #82d9c455;
  border-radius:20px; background:#0b2020f2; box-shadow:0 24px 80px #0009; }
h1 { margin:0 0 8px; } p { color:#bdded7; } dl { display:grid; grid-template-columns:210px 1fr; gap:10px 18px; }
dt { color:#9ed3c8; } dd { min-width:0; margin:0; font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
.pass { color:#79efb4; } .red { color:#ff9d9d; font-weight:700; }
</style></head><body><main><h1>Owned WASM tool layer</h1><p id="status">Booting the installed Machine...</p>
<dl><dt>Resident command</dt><dd id="command">pending</dd><dt>VFS snapshot</dt><dd id="snapshot">pending</dd>
<dt>Search result</dt><dd id="search">pending</dd><dt>Bounded failures</dt><dd id="failures">pending</dd>
<dt>Git workspace</dt><dd id="git">pending</dd><dt>Python bridge</dt><dd id="python">pending</dd>
<dt>Asset integrity</dt><dd id="integrity">pending</dd><dt>Network boundary</dt><dd id="network">pending</dd></dl></main>
<script type="module">
import { boot } from "pyproc";
import { KernelVfs, MemoryKernelVfsStore } from "pyproc/runtime";
const expectBridge=${JSON.stringify(expectBridge)};
const show = (id,value,pass) => { const node=document.getElementById(id); node.textContent=typeof value==="string"?value:JSON.stringify(value); node.className=pass?"pass":"red"; };
const failure = (error) => ({name:error?.name || null,code:error?.code || null,message:String(error?.message || error),
  context:error?.context || null});
let machine=null; let badMachine=null; let childProcess=null; let stage="boot";
try {
  const assetIntegrity=await fetch("/pyproc-assets.json").then((response)=>response.json());
  const vfs=new KernelVfs(new MemoryKernelVfsStore(),{volumeId:"tool-product",ownerId:"tool-product-owner"});
  await vfs.open(); const transaction=vfs.beginTransaction();
  await transaction.write("/home/project/alpha.txt","hello\\nTODO alpha\\n");
  await transaction.write("/home/project/nested/beta.txt","TODO beta\\nfinished\\n"); await transaction.commit();
  machine=await boot({deterministic:true,kernelVfs:vfs,assetIntegrity}); stage="rg";
  const version=await machine.tools.run("rg",["--version"]);
  const first=await machine.tools.run("rg",["-n","TODO","/home"]);
  const second=await machine.tools.run("rg",["-n","TODO","/home"]);
  const noMatch=await machine.tools.run("rg",["missing-pattern","/home"]);
  let unsupported=null; let gitVersion=null;
  try { stage="git.version"; gitVersion=await machine.tools.run("git",["--version"]); }
  catch(error) { unsupported=failure(error); }
  let gitInit=null; let gitStatus=null; let gitConfigName=null; let gitConfigEmail=null; let gitConfigRead=null;
  let gitAdd=null; let gitCommit=null; let gitLog=null; let gitFinalStatus=null;
  if(expectBridge && gitVersion) {
    stage="git.init"; gitInit=await machine.tools.run("git",["init","/home/project"]);
    stage="git.status.initial"; gitStatus=await machine.tools.run("git",["--git-dir=/home/project/.git","status"]);
    stage="git.config.name";
    gitConfigName=await machine.tools.run("git",["--git-dir=/home/project/.git","config","user.name","PyProc"]);
    stage="git.config.email";
    gitConfigEmail=await machine.tools.run("git",
      ["--git-dir=/home/project/.git","config","user.email","product@example.invalid"]);
    stage="git.config.read";
    gitConfigRead=await machine.tools.run("git",["--git-dir=/home/project/.git","config","user.name"]);
    stage="git.add";
    gitAdd=await machine.tools.run("git",
      ["--git-dir=/home/project/.git","add","alpha.txt","nested/beta.txt"]);
    stage="git.commit";
    gitCommit=await machine.tools.run("git",["--git-dir=/home/project/.git","commit","-m","resident tool proof"]);
    stage="git.log";
    gitLog=await machine.tools.run("git",["--git-dir=/home/project/.git","log","-1"]);
    stage="git.status.final";
    gitFinalStatus=await machine.tools.run("git",["--git-dir=/home/project/.git","status"]);
  }
  stage="python.bridge";
  const pythonBridge=await machine.run(${pythonProbe});
  const pythonBridgeValue=JSON.parse(pythonBridge.output.trim());
  let pythonCloneBridge=null; let pythonCloneBridgeValue=null;
  if(expectBridge) {
    stage="python.clone.bridge";
    const cloned=await machine.proc.clone(); childProcess=cloned.process;
    pythonCloneBridge=await childProcess.execute(${pythonProbe});
    pythonCloneBridgeValue=JSON.parse(pythonCloneBridge.output.trim());
    await childProcess.close(); childProcess=null;
  }
  let outputLimit=null; try { await machine.tools.run("rg",["-n",".","/home"],{maxOutputBytes:8}); } catch(error) { outputLimit=failure(error); }
  const controller=new AbortController(); controller.abort(); let cancelled=null;
  try { await machine.tools.run("rg",["--version"],{signal:controller.signal}); } catch(error) { cancelled=failure(error); }
  const bad=structuredClone(assetIntegrity);
  const binary=bad.files.find((file)=>file.roles.includes("wasmToolBinary"));
  binary.integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  badMachine=await boot({deterministic:true,assetIntegrity:bad}); let integrityFailure=null;
  try { await badMachine.tools.run("rg",["--version"],{files:{}}); } catch(error) { integrityFailure=failure(error); }
  const inspection=await machine.inspect();
  const network=performance.getEntriesByType("resource").map((entry)=>entry.name)
    .filter((url)=>new URL(url,location.href).origin!==location.origin);
  const checks={
    contract:inspection.tools?.protocol==="pyproc.wasm-tool-layer" && inspection.tools.version===1
      && inspection.tools.execution==="isolated-worker"
      && inspection.tools.network===false && inspection.tools.shellParsing===false
      && inspection.tools.commands?.some((command)=>command.command==="rg" && command.version==="15.1.0")
      && inspection.tools.state==="verified",
    version:version.exitCode===0 && version.stdout.includes("ripgrep 15.1.0") && version.toolVersion==="15.1.0",
    search:first.exitCode===0 && first.stdout.includes("TODO alpha") && first.stdout.includes("TODO beta")
      && first.input.source==="kernel-vfs" && first.input.fileCount===2 && first.input.byteLength===36,
    deterministic:first.stdout===second.stdout && first.input.sha256===second.input.sha256,
    nonzeroIsResult:noMatch.exitCode===1 && noMatch.stdout==="" && noMatch.protocol==="pyproc.wasm-tool-receipt",
    failures:(expectBridge ? unsupported===null : unsupported?.code==="PYPROC_INPUT_INVALID")
      && outputLimit?.code==="PYPROC_WORKER_TASK_ERROR"
      && cancelled?.code==="PYPROC_PROCESS_UNAVAILABLE",
    git:expectBridge ? inspection.tools.commands?.some((command)=>command.command==="git"
      && command.version==="1.9.7" && command.network===false
      && command.filesystem==="transactional-kernel-vfs")
      && gitVersion?.exitCode===0 && gitVersion.stdout.includes("libgit2 1.9.7")
      && gitInit?.exitCode===0 && gitInit.output?.committed===true
      && gitStatus?.exitCode===0 && gitConfigName?.exitCode===0 && gitConfigEmail?.exitCode===0
      && gitConfigRead?.exitCode===0 && gitConfigRead.stdout.trim()==="PyProc"
      && gitAdd?.exitCode===0 && gitCommit?.exitCode===0 && gitLog?.exitCode===0
      && gitLog.stdout.includes("resident tool proof") && gitFinalStatus?.exitCode===0
      && !gitFinalStatus.stdout.includes("Untracked files")
      && vfs.list("/home/project/.git").includes("/home/project/.git/HEAD")
      && vfs.list("/home/project/.git/refs/heads").length===1 : true,
    pythonBridge:expectBridge ? pythonBridge.state==="completed" && pythonBridgeValue.available===true
      && pythonBridgeValue.inspection?.protocol==="pyproc.python-tool-bridge"
      && pythonBridgeValue.receipts?.rg?.protocol==="pyproc.wasm-tool-receipt"
      && pythonBridgeValue.receipts.rg.command==="rg" && pythonBridgeValue.receipts.rg.exitCode===0
      && pythonBridgeValue.receipts?.git?.protocol==="pyproc.wasm-tool-receipt"
      && pythonBridgeValue.receipts.git.command==="git" && pythonBridgeValue.receipts.git.exitCode===0
      && pythonBridgeValue.receipts.git.stdout.includes("resident tool proof")
      && pythonCloneBridge?.state==="completed" && pythonCloneBridgeValue?.available===true
      && pythonCloneBridgeValue.inspection?.protocol==="pyproc.python-tool-bridge"
      && pythonCloneBridgeValue.receipts?.git?.protocol==="pyproc.wasm-tool-receipt"
      && pythonCloneBridgeValue.receipts.git.command==="git"
      && pythonCloneBridgeValue.receipts.git.exitCode===0
      && pythonCloneBridgeValue.receipts.git.stdout.includes("resident tool proof")
      : pythonBridge.state==="completed" && pythonBridgeValue.available===false
        && pythonBridgeValue.errorType==="ModuleNotFoundError",
    integrity:integrityFailure?.code==="PYPROC_ASSET_INTEGRITY",
    noThirdPartyRequests:network.length===0,
  };
  const report={ok:Object.values(checks).every(Boolean),checks,inspection:inspection.tools,version,
    git:{version:gitVersion,init:gitInit,initialStatus:gitStatus,config:[gitConfigName,gitConfigEmail,gitConfigRead],
      add:gitAdd,commit:gitCommit,log:gitLog,finalStatus:gitFinalStatus,files:vfs.list("/home/project")},
    pythonBridge:pythonBridgeValue,pythonCloneBridge:pythonCloneBridgeValue,search:first,
    negative:{unsupported,outputLimit,cancelled,integrityFailure,noMatchExitCode:noMatch.exitCode},network};
  show("command",{command:"rg",version:version.toolVersion,revision:version.toolRevision},checks.contract&&checks.version);
  show("snapshot",first.input,checks.search&&checks.deterministic); show("search",first.stdout.trim(),checks.search);
  show("failures",{unsupported:unsupported?.code || null,outputLimit:outputLimit?.code || null,
    cancelled:cancelled?.code || null,noMatchExitCode:noMatch.exitCode},checks.failures&&checks.nonzeroIsResult);
  show("integrity",{code:integrityFailure?.code || null},checks.integrity);
  show("git",expectBridge ? {version:gitVersion?.toolVersion,commit:gitCommit?.output?.rootDigest,
    clean:!gitFinalStatus?.stdout.includes("Untracked files"),localRefs:vfs.list("/home/project/.git/refs/heads").length}
    : unsupported,checks.git);
  show("python",expectBridge ? {mainGit:pythonBridgeValue.receipts?.git?.exitCode,
    cloneGit:pythonCloneBridgeValue?.receipts?.git?.exitCode,
    protocol:pythonBridgeValue.inspection?.protocol} : pythonBridgeValue,checks.pythonBridge);
  show("network",{thirdPartyRequests:network.length},checks.noThirdPartyRequests);
  const status=document.getElementById("status"); status.textContent=report.ok
    ? "GREEN: source-pinned rg and Git share bounded Machine and Python receipts" : "RED: product contract drifted";
  status.className=report.ok?"pass":"red";
  await fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(report)});
} catch(error) {
  const report={ok:false,stage,fatal:failure(error)}; const status=document.getElementById("status");
  status.textContent="RED: "+report.fatal.message; status.className="red";
  await fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(report)});
} finally { if(childProcess) await childProcess.close(); if(badMachine) await badMachine.close(); if(machine) await machine.close(); }
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocWasmToolProduct-");
const publicDir = join(installed.appDir, "public");
const evidenceDir = join(installed.tmp, "wasm-tool-evidence");
const assetsCli = binPath(installed.appDir, "pyproc-assets");
const assetManifest = run(assetsCli, ["--baseURL", "/node_modules/pyproc/"], { cwd: installed.appDir }).stdout;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/pyproc-assets.json") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(assetManifest); return;
  }
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204); response.end();
    try { resolveReport(JSON.parse(body)); } catch (error) { resolveReport({ ok: false, fatal: { message: String(error) } }); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir, url.pathname)
    : safeJoin(publicDir, url.pathname === "/" ? "/wasmToolLayer.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response, file);
});

let client = null; let targetRef = null; let sessionRef = null;
try {
  await mkdir(publicDir, { recursive: true }); await mkdir(evidenceDir, { recursive: true });
  const packageJson = JSON.parse(await readFile(join(installed.appDir, "node_modules", "pyproc", "package.json"), "utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//, "")}`;
  await writeFile(join(publicDir, "wasmToolLayer.html"), page({ "pyproc": target("."), "pyproc/runtime": target("./runtime") }, expectToolBridge));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-wasm-tool-product", "manifest.json");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-wasm-tool-product", "--engine-root", join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "owned wasm tool product gate", "--acknowledge-effects", "--action", "snapshot", "--action", "screenshot",
    "--headed", ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir, startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 10000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  const report = await withTimeout(reportPromise, timeoutMs, `wasm tool product report timed out after ${timeoutMs} ms`);
  const attached = await client.attachSession(targetRef); sessionRef = attached.output;
  const screenshot = await client.act(sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const action = screenshot.output.actions[0].result;
  const screenshotBytes = Buffer.from(screenshot.attachments[0].bytes);
  const screenshotPath = join(evidenceDir, "owned-wasm-tool-layer.png");
  await writeFile(screenshotPath, screenshotBytes); await client.deleteArtifact(action.artifactRef);
  const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
  if (keepEvidence) await writeFile(join(evidenceDir, "owned-wasm-tool-layer.json"), `${JSON.stringify(report, null, 2)}\n`);
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
