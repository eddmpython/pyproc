// storageDurabilityProduct.mjs - 설치 제품의 persistence, quota와 축출 계약을 공개 Control로 검증한다.

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
<title>owned storage durability probe</title>
<script type="importmap">${JSON.stringify({ imports:importMap })}</script>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center; color:#eef8ff;
  background:radial-gradient(circle at top,#303c69,#0a1022 64%); font:16px/1.45 system-ui; }
main { box-sizing:border-box; width:min(900px,calc(100vw - 48px)); padding:32px; border:1px solid #8aa5ff55;
  border-radius:20px; background:#10172af2; box-shadow:0 24px 80px #0009; }
h1 { margin:0 0 8px; } p { color:#c5d1f2; }
dl { display:grid; grid-template-columns:210px 1fr; gap:10px 18px; }
dt { color:#9fb5ee; } dd { min-width:0; margin:0; font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
.pass { color:#7cebb5; } .boundary { color:#ffd17c; } .red { color:#ff9d9d; font-weight:700; }
</style></head><body><main>
<h1>Owned storage durability boundary</h1><p id="status">Inspecting browser storage...</p>
<dl><dt>Persistence</dt><dd id="persistence">pending</dd><dt>Storage estimate</dt><dd id="estimate">pending</dd>
<dt>Product contract</dt><dd id="contract">pending</dd><dt>Quota failure</dt><dd id="quota">pending</dd>
<dt>Failed-write safety</dt><dd id="safety">pending</dd><dt>Eviction detection</dt><dd id="eviction">pending</dd></dl></main>
<script type="module">
import * as history from "pyproc/history";
import * as machine from "pyproc/machine";
const state = { baseline:null, quota:null, witness:null, durability:null };
const show = (id,value,kind="boundary") => {
  document.getElementById(id).textContent = typeof value === "string" ? value : JSON.stringify(value);
  document.getElementById(id).className = kind;
};
const publish = async (phase,value) => fetch("/probeReport",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({phase,...value})});
const fail = async (phase,error) => {
  const fatal = {ok:false,fatal:{name:error?.name || null,code:error?.code || null,message:String(error?.message || error)}};
  document.getElementById("status").textContent = "RED: " + fatal.fatal.message;
  document.getElementById("status").className = "red";
  await publish(phase,fatal); return fatal;
};

async function baseline() {
  try {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry("pyproc-storage-durability-probe",{recursive:true}); } catch (error) {}
    const directory = await root.getDirectoryHandle("pyproc-storage-durability-probe",{create:true});
    const handle = await directory.getFileHandle("sentinel.txt",{create:true});
    const writable = await handle.createWritable();
    await writable.write("pyproc-storage-sentinel"); await writable.close();
    const sentinel = await (await handle.getFile()).text();
    const durability = await history.BrowserStorageDurability.open({storageManager:navigator.storage,
      directory:root,namespace:"quota-probe"});
    const inspection = await durability.inspect();
    const witness = await durability.createWitness({witnessId:"outside-origin-copy"});
    const verification = await durability.verifyWitness(witness);
    state.durability = durability; state.witness = witness;
    state.baseline = {ok:true,sentinel,inspection,witness,verification};
    show("persistence",inspection.mode); show("estimate",inspection.estimate);
    show("contract",inspection,"pass");
    document.getElementById("status").textContent = "READY: applying a bounded origin quota";
    document.getElementById("status").className = "boundary";
    await publish("baseline",state.baseline); return state.baseline;
  } catch (error) { return fail("baseline",error); }
}

async function quotaWrite(byteLength) {
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("pyproc-storage-durability-probe",{create:true});
    const payload = new Uint8Array(byteLength);
    let randomState = 0x6d2b79f5;
    for (let index = 0; index < payload.length; index += 1) {
      randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
      payload[index] = randomState & 0xff;
    }
    const address = await history.sha256Address(payload);
    const store = new history.OpfsStateStore(directory);
    let failure = null;
    try { await store.writeObject(address,payload); }
    catch (error) {
      failure = {name:error?.name || null,code:error?.code || null,retryable:error?.retryable === true,
        context:error?.context || null,message:String(error?.message || error)};
    }
    const placeholder = await store.hasObject(address);
    const databaseName = "pyproc-storage-durability-quota";
    const machineStore = new machine.IndexedDbMachineStore({indexedDb:indexedDB,databaseName});
    const owner = await machineStore.claimOwner({groupId:"quota-machine",ownerId:"quota-owner"});
    let machineFailure = null;
    try {
      await machineStore.commitGeneration({groupId:"quota-machine",generationId:"quota-generation",
        expectedHead:null,ownerToken:owner,blobs:[{digest:"quota-blob",bytes:payload}],
        record:{manifest:{},manifestHash:"sha256:quota"}});
    } catch (error) {
      machineFailure = {name:error?.name || null,code:error?.code || null,message:String(error?.message || error)};
    }
    const machineHead = await machineStore.readHead("quota-machine");
    machineStore.close();
    await new Promise((resolve,reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("quota probe database deletion was blocked"));
    });
    const verification = await state.durability.verifyWitness(state.witness);
    const sentinel = await (await (await directory.getFileHandle("sentinel.txt")).getFile()).text();
    state.quota = {ok:failure?.code === "PYPROC_STORAGE_QUOTA_EXCEEDED"
      && machineFailure?.code === "WEB_MACHINE_STORAGE_QUOTA_EXCEEDED" && machineHead === null
      && !placeholder && verification.state === "available" && sentinel === "pyproc-storage-sentinel",
    failure,machineFailure,machineHead,placeholder,verification,sentinel};
    show("quota",failure || "write unexpectedly succeeded",state.quota.ok ? "pass" : "red");
    show("safety",{placeholder,machineFailure:machineFailure?.code,machineHead,
      witness:verification.state,sentinel},state.quota.ok ? "pass" : "red");
    document.getElementById("status").textContent = state.quota.ok
      ? "QUOTA SEALED: prior state survived and no placeholder remained" : "RED: quota boundary drifted";
    document.getElementById("status").className = state.quota.ok ? "pass" : "red";
    await publish("quota",state.quota); return state.quota;
  } catch (error) { return fail("quota",error); }
}

async function verifyEviction() {
  try {
    const fresh = await history.BrowserStorageDurability.open({storageManager:navigator.storage,
      directory:await navigator.storage.getDirectory(),namespace:"quota-probe"});
    let failure = null;
    try { await fresh.verifyWitness(state.witness); }
    catch (error) { failure = {name:error?.name || null,code:error?.code || null,message:String(error?.message || error)}; }
    const report = {ok:state.baseline?.ok === true && state.quota?.ok === true
      && failure?.code === "PYPROC_STORAGE_EVICTED",failure,
    boundary:{coldStartDetection:"external-witness-required",localSelfRecovery:false}};
    show("eviction",failure || "eviction was not detected",report.ok ? "pass" : "red");
    document.getElementById("status").textContent = report.ok
      ? "GREEN: failed writes leave no false object and witnessed eviction is explicit" : "RED: eviction boundary drifted";
    document.getElementById("status").className = report.ok ? "pass" : "red";
    await publish("eviction",report); return report;
  } catch (error) { return fail("eviction",error); }
}

globalThis.__pyprocStorageProbe = Object.freeze({quotaWrite,verifyEviction});
await baseline();
</script></body></html>`;
}

const phaseReports = new Map();
const phaseWaiters = new Map();
function receivePhase(report) {
  phaseReports.set(report.phase,report);
  phaseWaiters.get(report.phase)?.(report);
}
function waitPhase(phase) {
  if (phaseReports.has(phase)) return Promise.resolve(phaseReports.get(phase));
  return new Promise((resolve) => { phaseWaiters.set(phase,resolve); });
}
const installed = await installPackedPyProc("pyprocStorageDurability-");
const publicDir = join(installed.appDir,"public");
const evidenceDir = join(installed.tmp,"storage-durability-evidence");
const server = createServer(async (request,response) => {
  const url = new URL(request.url,"http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204); response.end();
    try { receivePhase(JSON.parse(body)); }
    catch (error) { receivePhase({phase:"invalid",ok:false,fatal:{message:String(error)}}); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir,url.pathname)
    : safeJoin(publicDir,url.pathname === "/" ? "/storageDurability.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response,file);
});

let client = null; let targetRef = null; let sessionRef = null;
try {
  await mkdir(publicDir,{recursive:true}); await mkdir(evidenceDir,{recursive:true});
  const packageJson = JSON.parse(await readFile(join(installed.appDir,"node_modules","pyproc","package.json"),"utf8"));
  const target = (specifier) => `/node_modules/pyproc/${packageJson.exports[specifier].default.replace(/^\.\//,"")}`;
  await writeFile(join(publicDir,"storageDurability.html"),page({
    "pyproc/history":target("./history"),"pyproc/machine":target("./machine"),
  }));
  await new Promise((resolve) => server.listen(0,"127.0.0.1",resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir,".pyproc-storage-durability","manifest.json");
  const cli = binPath(installed.appDir,"pyproc-mcp");
  run(cli,["init","--recipe","authorizedBrowser","--project-root",installed.appDir,
    "--out",".pyproc-storage-durability","--engine-root",join(ROOT,"src","runtime","engines","wasi","owned","core"),
    "--timeout-ms",String(timeoutMs),"--origin",origin,"--max-risk","externalEffect",
    "--purpose","owned storage durability probe","--acknowledge-effects","--action","snapshot","--action","screenshot",
    "--method","Runtime.evaluate","--method","Storage.getUsageAndQuota",
    "--method","Storage.overrideQuotaForOrigin","--method","Storage.clearDataForOrigin","--headed",
    ...(process.env.PYPROC_BROWSER ? ["--browser",process.env.PYPROC_BROWSER] : [])],{cwd:installed.appDir});
  const installedRequire = createRequire(join(installed.appDir,"productEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath,{cwd:installed.appDir,startupTimeoutMs:timeoutMs,shutdownTimeoutMs:10000});
  const opened = await client.openTarget(`${origin}/`,{expectedRisk:"externalEffect",waitUntil:"load"});
  targetRef = opened.output.targetRef;
  const baselineReport = await withTimeout(waitPhase("baseline"),timeoutMs,
    `storage durability baseline timed out after ${timeoutMs} ms`);
  const attached = await client.attachSession(targetRef); sessionRef = attached.output;
  const before = await client.command(sessionRef,"Storage.getUsageAndQuota",{origin},{expectedRisk:"read"});
  await client.command(sessionRef,"Storage.overrideQuotaForOrigin",{origin,quotaSize:262144},
    {expectedRisk:"externalEffect"});
  await client.command(sessionRef,"Runtime.evaluate",{
    expression:"globalThis.__pyprocStorageProbe.quotaWrite(4194304)",awaitPromise:true,returnByValue:true,
  },{expectedRisk:"externalEffect"});
  const quotaReport = await withTimeout(waitPhase("quota"),timeoutMs,
    `storage durability quota phase timed out after ${timeoutMs} ms`);
  await client.command(sessionRef,"Storage.clearDataForOrigin",{origin,storageTypes:"file_systems"},
    {expectedRisk:"externalEffect"});
  await client.command(sessionRef,"Runtime.evaluate",{
    expression:"globalThis.__pyprocStorageProbe.verifyEviction()",awaitPromise:true,returnByValue:true,
  },{expectedRisk:"externalEffect"});
  const evictionReport = await withTimeout(waitPhase("eviction"),timeoutMs,
    `storage durability eviction phase timed out after ${timeoutMs} ms`);
  const after = await client.command(sessionRef,"Storage.getUsageAndQuota",{origin},{expectedRisk:"read"});
  await client.command(sessionRef,"Storage.overrideQuotaForOrigin",{origin},{expectedRisk:"externalEffect"});
  const report = {ok:baselineReport.ok && quotaReport.ok && evictionReport.ok,
    baseline:baselineReport,quota:quotaReport,eviction:evictionReport,
    cdp:{before:before.output,after:after.output}};
  const screenshot = await client.act(sessionRef,[{kind:"screenshot",format:"png",expectedRisk:"read"}]);
  const action = screenshot.output.actions[0].result;
  const screenshotBytes = Buffer.from(screenshot.attachments[0].bytes);
  const screenshotPath = join(evidenceDir,"owned-storage-durability.png");
  await writeFile(screenshotPath,screenshotBytes); await client.deleteArtifact(action.artifactRef);
  const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
  if (keepEvidence) await writeFile(join(evidenceDir,"owned-storage-durability.json"),`${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify({...report,screenshot:screenshotPath,screenshotSha256},null,2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (sessionRef && client && server.listening) {
    const address = server.address();
    const origin = address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : null;
    if (origin) await client.command(sessionRef,"Storage.overrideQuotaForOrigin",{origin},
      {expectedRisk:"externalEffect"}).catch(() => {});
  }
  if (sessionRef && client) await client.detachSession(sessionRef).catch(() => {});
  if (targetRef && client) await client.closeTarget(targetRef,{expectedRisk:"externalEffect"}).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp,{recursive:true,force:true});
}
