// replaySpaceProduct.mjs - installed record, tamper rejection, effect-free replay, cursor resume gate.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const installed = await installPackedPyProc("pyprocReplaySpace-");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const bridgeSource = await readFile(join(packageRoot, "scripts", "automationSpace", "frameSpaceTarget.js"));
let targetRequests = 0;
const targetServer = createServer((req, res) => {
  targetRequests += 1;
  if (req.url === "/frameSpaceTarget.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(bridgeSource);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end("<!doctype html><html><head><title>recording-target</title></head><body><h1>Replay target</h1><script src=/frameSpaceTarget.js></script></body></html>");
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;
const targetUrl = `${targetOrigin}/recorded`;
const recordingFile = join(installed.appDir, "automation-recording.json");
const recordConfig = join(installed.appDir, "record.json");
const replayConfig = join(installed.appDir, "replay.json");
const resumeConfig = join(installed.appDir, "resume.json");
const tamperedFile = join(installed.appDir, "tampered.json");
const tamperedConfig = join(installed.appDir, "tampered-config.json");
const invalidRecordConfig = join(installed.appDir, "invalid-record.json");
const wrongPrefixConfig = join(installed.appDir, "wrong-prefix.json");
const browser = process.env.PYPROC_BROWSER || undefined;

function manifest(provider, recording) {
  return {
    schemaVersion: 1,
    engine: { root: join(ROOT, "vendor", "pyodide") },
    timeoutMs: TIMEOUT_MS,
    browser: {
      enabled: true,
      provider,
      ...(browser ? { executable: browser } : {}),
      allowedOrigins: [targetOrigin],
      maxRisk: "externalEffect",
      actions: ["snapshot", "screenshot"],
      methods: [],
      externalEffects: "acknowledged",
      purpose: "automation recording product gate",
      artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
        maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
      recording,
    },
  };
}

await writeFile(recordConfig, JSON.stringify(manifest("frame", { mode: "record", file: recordingFile }), null, 2));
const clientFile = join(packageRoot, "scripts", "controlProtocol", "controlClient.js");
const { ControlRemoteError, ControlStdioClient } = await import(pathToFileURL(clientFile).href);
const productScript = join(packageRoot, "scripts", "pyprocControl.mjs");

async function startProduct(configPath, name) {
  const child = spawn(process.execPath, [productScript, "--config", configPath], {
    cwd: installed.appDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-8000); });
  const client = new ControlStdioClient({ readable: child.stdout, writable: child.stdin,
    peer: { name, version: "1" } });
  await Promise.race([client.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} hello timeout\n${stderr}`)), TIMEOUT_MS))]);
  return { child, client, stderr: () => stderr };
}

async function stopProduct(product) {
  product.client.close();
  if (product.child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => product.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  if (product.child.exitCode === null) product.child.kill("SIGTERM");
  if (product.child.exitCode === null) await new Promise((resolve) => product.child.once("exit", resolve));
}

console.log("installed ReplaySpace product gate");
let recordProduct;
let replayProduct;
let resumeProduct;
try {
  const cli = binPath(installed.appDir, "pyproc-control");
  const mcpCli = binPath(installed.appDir, "pyproc-mcp");
  const recordCheck = JSON.parse(run(cli, ["--config", recordConfig, "--check"], { cwd: installed.appDir }).stdout);
  check("record preflight selects FrameSpace and absolute recording file",
    recordCheck.automation.provider === "frame" && recordCheck.automation.recording.mode === "record");

  recordProduct = await startProduct(recordConfig, "record-product");
  const recordInspect = await recordProduct.client.request("automation.space.inspect", {});
  check("record wrapper keeps source provider identity and declares deterministic recording",
    recordInspect.output.space.providerKind === "frame" && recordInspect.output.recording.mode === "record");
  const opened = await recordProduct.client.request("automation.target.open", {
    url: targetUrl, expectedRisk: "externalEffect", waitUntil: "load",
  });
  const attached = await recordProduct.client.request("automation.session.attach", { targetRef: opened.output.targetRef });
  const observed = await recordProduct.client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", mode: "interactive",
  });
  const apxObserved = await recordProduct.client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", representation: "apx.graph",
    budget: { maxEntities: 40, maxRelations: 80, maxBytes: 65536 },
  });
  const captured = await recordProduct.client.request("automation.act", {
    sessionRef: attached.output, actions: [{ kind: "screenshot", expectedRisk: "read" }],
  });
  const deferred = await recordProduct.client.request("automation.act", {
    sessionRef: attached.output, actions: [{ kind: "screenshot", expectedRisk: "read", inline: false }],
  });
  const deferredDescriptor = deferred.output.results[0];
  const deferredChunk = await recordProduct.client.request("artifact.read", {
    artifactRef: deferredDescriptor.artifactRef,
  });
  await recordProduct.client.request("automation.session.detach", { sessionRef: attached.output });
  const recordedPng = Buffer.from(captured.attachments[0].bytes);
  const recordedDeferredPng = Buffer.from(deferredChunk.output.dataBase64, "base64");
  await stopProduct(recordProduct);
  recordProduct = null;

  const recording = JSON.parse(await readFile(recordingFile, "utf8"));
  check("recording persists a converged hash chain and screenshot artifact",
    recording.complete === true && recording.entries.length === 8
      && Object.keys(recording.artifacts).length === 2 && /^[0-9a-f]{64}$/.test(recording.finalSha256)
      && Object.values(recording.artifacts).every((artifact) => artifact.file && !artifact.dataBase64));

  const recordingPins = { recordingId: recording.recordingId, finalSha256: recording.finalSha256 };
  await writeFile(replayConfig, JSON.stringify(manifest("replay", {
    mode: "replay", file: recordingFile, ...recordingPins,
  }), null, 2));
  const replayCheck = JSON.parse(run(cli, ["--config", replayConfig, "--check"], { cwd: installed.appDir }).stdout);
  check("replay preflight verifies recording digest before browser launch",
    replayCheck.automation.provider === "replay" && replayCheck.automation.replay.entries === 8
      && replayCheck.automation.replay.finalSha256 === recording.finalSha256);
  const mcpReplayCheck = JSON.parse(run(mcpCli, ["--config", replayConfig, "--check"], { cwd: installed.appDir }).stdout);
  check("MCP preflight shares replay identity, policy, chain, and sidecar verification",
    mcpReplayCheck.browser.provider === "replay"
      && mcpReplayCheck.browser.replay.recordingId === recording.recordingId
      && mcpReplayCheck.browser.replay.finalSha256 === recording.finalSha256);

  const requestsBeforeReplay = targetRequests;
  replayProduct = await startProduct(replayConfig, "replay-product");
  const replayInspect = await replayProduct.client.request("automation.space.inspect", {});
  check("ReplaySpace declares source, cursor, prefix, and remaining entries",
    replayInspect.output.space.providerKind === "replay" && replayInspect.output.transport === "recording"
      && replayInspect.output.sourceProviderKind === "frame" && replayInspect.output.recording.cursor === 0);
  let divergence = null;
  try {
    await replayProduct.client.request("automation.target.open", {
      url: `${targetOrigin}/different`, expectedRisk: "externalEffect", waitUntil: "load",
    });
  } catch (error) { divergence = error; }
  check("divergence is notSent and does not advance replay cursor",
    divergence instanceof ControlRemoteError && divergence.code === "AUTOMATION_REPLAY_DIVERGED"
      && divergence.outcome === "notSent"
      && (await replayProduct.client.request("automation.space.inspect", {})).output.recording.cursor === 0);
  const replayOpened = await replayProduct.client.request("automation.target.open", {
    url: targetUrl, expectedRisk: "externalEffect", waitUntil: "load",
  });
  const replayAttached = await replayProduct.client.request("automation.session.attach", { targetRef: replayOpened.output.targetRef });
  const replayObserved = await replayProduct.client.request("automation.observe", {
    sessionRef: replayAttached.output, expectedRisk: "read", mode: "interactive",
  });
  const replayApxObserved = await replayProduct.client.request("automation.observe", {
    sessionRef: replayAttached.output, expectedRisk: "read", representation: "apx.graph",
    budget: { maxEntities: 40, maxRelations: 80, maxBytes: 65536 },
  });
  const replayCaptured = await replayProduct.client.request("automation.act", {
    sessionRef: replayAttached.output, actions: [{ kind: "screenshot", expectedRisk: "read" }],
  });
  const replayDeferred = await replayProduct.client.request("automation.act", {
    sessionRef: replayAttached.output, actions: [{ kind: "screenshot", expectedRisk: "read", inline: false }],
  });
  const replayDeferredChunk = await replayProduct.client.request("artifact.read", {
    artifactRef: replayDeferred.output.results[0].artifactRef,
  });
  await replayProduct.client.request("automation.session.detach", { sessionRef: replayAttached.output });
  const replayPng = Buffer.from(replayCaptured.attachments[0].bytes);
  check("full replay returns byte-identical observation and PNG with external requests zero",
    JSON.stringify(replayObserved.output) === JSON.stringify(observed.output)
      && JSON.stringify(replayApxObserved.output) === JSON.stringify(apxObserved.output)
      && replayApxObserved.output.protocol === "apx"
      && replayPng.equals(recordedPng)
      && Buffer.from(replayDeferredChunk.output.dataBase64, "base64").equals(recordedDeferredPng)
      && createHash("sha256").update(replayPng).digest("hex") === replayCaptured.attachments[0].sha256
      && targetRequests === requestsBeforeReplay);
  await stopProduct(replayProduct);
  replayProduct = null;

  const checkpointCursor = 2;
  const prefixSha256 = recording.entries[checkpointCursor - 1].sha256;
  await writeFile(resumeConfig, JSON.stringify(manifest("replay", {
    mode: "replay", file: recordingFile, ...recordingPins, startCursor: checkpointCursor, prefixSha256,
  }), null, 2));
  resumeProduct = await startProduct(resumeConfig, "resume-product");
  const resumeInspect = await resumeProduct.client.request("automation.space.inspect", {});
  check("manifest cursor and prefix resume the recorded suffix",
    resumeInspect.output.recording.cursor === checkpointCursor
      && resumeInspect.output.recording.prefixSha256 === prefixSha256);
  await resumeProduct.client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", mode: "interactive",
  });
  await resumeProduct.client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", representation: "apx.graph",
    budget: { maxEntities: 40, maxRelations: 80, maxBytes: 65536 },
  });
  const resumedCapture = await resumeProduct.client.request("automation.act", {
    sessionRef: attached.output, actions: [{ kind: "screenshot", expectedRisk: "read" }],
  });
  const resumedDeferred = await resumeProduct.client.request("automation.act", {
    sessionRef: attached.output, actions: [{ kind: "screenshot", expectedRisk: "read", inline: false }],
  });
  const resumedDeferredChunk = await resumeProduct.client.request("artifact.read", {
    artifactRef: resumedDeferred.output.results[0].artifactRef,
  });
  await resumeProduct.client.request("automation.session.detach", { sessionRef: attached.output });
  check("resumed suffix preserves PNG and sends no external effect",
    Buffer.from(resumedCapture.attachments[0].bytes).equals(recordedPng)
      && Buffer.from(resumedDeferredChunk.output.dataBase64, "base64").equals(recordedDeferredPng)
      && targetRequests === requestsBeforeReplay);
  await stopProduct(resumeProduct);
  resumeProduct = null;

  const tampered = structuredClone(recording);
  tampered.entries[0].input.url = `${targetOrigin}/tampered`;
  await writeFile(tamperedFile, JSON.stringify(tampered, null, 2));
  await writeFile(tamperedConfig, JSON.stringify(manifest("replay", {
    mode: "replay", file: tamperedFile, ...recordingPins,
  }), null, 2));
  let tamperRejected = false;
  try { run(cli, ["--config", tamperedConfig, "--check"], { cwd: installed.appDir }); }
  catch (error) { tamperRejected = /digest mismatch|mutated/i.test(String(error?.message || error)); }
  check("unrecomputed recording mutation is rejected during installed preflight", tamperRejected);

  const invalidTarget = join(installed.appDir, "recording-target-directory");
  await mkdir(invalidTarget);
  await writeFile(invalidRecordConfig, JSON.stringify(manifest("frame", {
    mode: "record", file: invalidTarget,
  }), null, 2));
  let invalidTargetRejected = false;
  try { run(cli, ["--config", invalidRecordConfig, "--check"], { cwd: installed.appDir }); }
  catch (error) { invalidTargetRejected = /recording.file|regular file|parent is unavailable/i.test(String(error?.message || error)); }
  check("non-file recording target is rejected before an external request", invalidTargetRejected
    && targetRequests === requestsBeforeReplay);

  await writeFile(wrongPrefixConfig, JSON.stringify(manifest("replay", {
    mode: "replay", file: recordingFile, ...recordingPins, startCursor: 0, prefixSha256: "f".repeat(64),
  }), null, 2));
  let wrongPrefixRejected = false;
  try { run(cli, ["--config", wrongPrefixConfig, "--check"], { cwd: installed.appDir }); }
  catch (error) { wrongPrefixRejected = /cursor pin does not match/i.test(String(error?.message || error)); }
  check("wrong zero-cursor prefix is rejected during installed preflight", wrongPrefixRejected);

  const artifactFile = Object.values(recording.artifacts)[0].file;
  await rm(`${recordingFile}.artifacts/${recording.artifactGeneration}/${artifactFile}`);
  let missingArtifactRejected = false;
  try { run(cli, ["--config", replayConfig, "--check"], { cwd: installed.appDir }); }
  catch (error) { missingArtifactRejected = /artifact.*unavailable|artifact.*missing/i.test(String(error?.message || error)); }
  check("missing sidecar artifact is rejected during installed preflight", missingArtifactRejected);
} catch (error) {
  check("ReplaySpace installed journey has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  for (const product of [recordProduct, replayProduct, resumeProduct]) if (product) await stopProduct(product);
  targetServer.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
