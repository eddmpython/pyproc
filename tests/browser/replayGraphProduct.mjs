// replayGraphProduct.mjs - packed graph import, effect-free traversal, installed client parity gate.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};
const installed = await installPackedPyProc("pyprocReplayGraph-");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const importRoot = join(installed.appDir, "imports");
const memoryRoot = join(installed.appDir, ".replay-graph-memory");
await mkdir(importRoot, { recursive: true });
const recordingFile = join(importRoot, "world.recording.json");
const recordingModule = await import(pathToFileURL(join(packageRoot,
  "scripts", "automationSpace", "automationRecording.js")).href);
const screenshot = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 11]);
const screenshotSha256 = createHash("sha256").update(screenshot).digest("hex");
const recording = recordingModule.createAutomationRecording({ recordingId: "recording:installedWorld", provider: {
  spaceId: "space:installedFixture", providerKind: "nativeCdp",
  operations: ["automation.observe", "automation.act"], capabilities: ["screenshot"],
  restoreBoundary: "externalEffectsRemain", policy: { targetOrigins: ["https://fixture.example"],
    actions: ["snapshot", "screenshot"], rawMethods: [], maxRisk: "read" },
} });
recordingModule.putAutomationRecordingArtifact(recording, "artifact:installed", {
  kind: "screenshot", mimeType: "image/png", byteLength: screenshot.byteLength,
  sha256: screenshotSha256, dataBase64: screenshot.toString("base64"),
});
recordingModule.appendAutomationRecordingEntry(recording, { operation: "automation.observe",
  input: { expectedRisk: "read" }, terminal: { ok: true, output: { state: "ready" } },
  inlineArtifacts: [], artifactRefs: [] });
recordingModule.appendAutomationRecordingEntry(recording, { operation: "automation.act",
  input: { actions: [{ kind: "screenshot", expectedRisk: "read" }] }, terminal: { ok: true,
    output: { kind: "screenshot", artifactRef: "artifact:installed", sha256: screenshotSha256 } },
  inlineArtifacts: [], artifactRefs: ["artifact:installed"] });
const writer = await recordingModule.AutomationRecordingWriter.open(recordingFile, recording);
await writer.write(recording);
await writer.close();

const configPath = join(installed.appDir, "pyproc-replay-graph.json");
await writeFile(configPath, JSON.stringify({ schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") }, timeoutMs: TIMEOUT_MS,
  browser: { enabled: false },
  executionMemory: { enabled: true, root: memoryRoot, importRoots: [importRoot], secretEnv: [] },
  replayGraph: { enabled: true },
}, null, 2));
const controlCli = binPath(installed.appDir, "pyproc-control");
const preflight = JSON.parse(run(controlCli, ["--config", configPath, "--check"],
  { cwd: installed.appDir }).stdout);
check("preflight enables ReplayGraph on one durable root",
  preflight.ok === true && preflight.replayGraph?.enabled === true
    && preflight.executionMemory?.enabled === true && preflight.automation?.enabled === false);

const controlApiFile = join(packageRoot, "scripts", "controlProtocol", "controlApi.js");
const { ControlRemoteError, PyProcControlClient } = await import(pathToFileURL(controlApiFile).href);
const client = await PyProcControlClient.start(configPath, {
  command: [process.execPath, join(packageRoot, "scripts", "pyprocControl.mjs")],
  cwd: installed.appDir, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000,
});
let clientClosed = false;
let mcpChild = null;
console.log("installed ReplayGraph Worlds product gate");
try {
  const worldOperations = ["world.import.recording", "world.create.app", "world.capture.app.branch", "world.open",
    "world.inspect", "world.edges", "world.traverse", "world.checkpoint", "world.restore", "world.evaluate",
    "world.coverage", "world.list"];
  check("one public wire exposes all ReplayGraph operations without live automation",
    worldOperations.every((operation) => client.operations.includes(operation))
      && !client.operations.some((operation) => operation.startsWith("automation.")));
  const imported = await client.importReplayGraphRecording("graph:installed", recordingFile);
  const graph = imported.output.graph;
  check("linear recording imports operation, terminal, artifact, and exact digests",
    graph.nodes.length === 3 && graph.edges.length === 2 && graph.artifacts.length === 1
      && graph.artifacts[0].sha256 === screenshotSha256
      && imported.output.source.finalSha256 === recording.finalSha256);
  const opened = await client.openReplayWorld(graph.graphId, graph.rootSha256);
  const worldRef = opened.output.world.worldRef;
  let edges = await client.listReplayWorldEdges(worldRef);
  const first = await client.traverseReplayWorld(worldRef, edges.output[0].capabilityRef,
    graph.startNodeRefs[0]);
  const checkpoint = await client.checkpointReplayWorld(worldRef);
  edges = await client.listReplayWorldEdges(worldRef);
  const second = await client.traverseReplayWorld(worldRef, edges.output[0].capabilityRef,
    first.output.targetNodeRef);
  await client.restoreReplayWorld(worldRef, checkpoint.output);
  check("exact edge traversal advances and restores cursor with no replayed effect",
    first.output.terminal.output.state === "ready" && first.output.replayedEffect === false
      && second.output.replayedEffect === false
      && (await client.inspectReplayWorld(worldRef)).output.currentNodeRef === first.output.targetNodeRef);
  let missing = null;
  try { await client.traverseReplayWorld(worldRef, "worldcap:00000000000000000000000000000000",
    first.output.targetNodeRef); } catch (error) { missing = error; }
  check("graph outside capability cannot generate a terminal",
    missing instanceof ControlRemoteError && missing.code === "REPLAY_GRAPH_AUTHORITY_INVALID");
  const firstGraphEdge = graph.edges.find((edge) => edge.sourceNodeRef === graph.startNodeRefs[0]);
  const secondGraphEdge = graph.edges.find((edge) => edge.sourceNodeRef === firstGraphEdge.targetNodeRef);
  const verdict = await client.evaluateReplayWorld(graph.graphId, graph.rootSha256, {
    startNodeRef: graph.startNodeRefs[0], goalNodeRefs: [secondGraphEdge.targetNodeRef],
    forbiddenEdgeRefs: [], stepBudget: 3,
  }, [firstGraphEdge.edgeRef, secondGraphEdge.edgeRef]);
  const coverage = await client.inspectReplayWorldCoverage(worldRef);
  check("deterministic evaluator and coverage use the same pinned root",
    verdict.output.terminal === "goalReached" && coverage.output.rootSha256 === graph.rootSha256
      && coverage.output.reachableNodeRefs.length === 3);
  const expectedRoot = graph.rootSha256;
  await client.close();
  clientClosed = true;

  const pythonEnv = { ...process.env, PYTHONPATH: join(ROOT, "pythonSdk", "src") };
  const pythonResult = run(process.env.PYTHON || "python", [join(ROOT, "tests", "pythonSdk", "replayGraphList.py"),
    configPath, process.execPath, join(packageRoot, "scripts", "pyprocControl.mjs")],
  { cwd: installed.appDir, env: pythonEnv });
  const pythonGraphs = JSON.parse(pythonResult.stdout.trim());
  check("Python client reopens the same durable graph root",
    pythonGraphs.some((entry) => entry.graphId === "graph:installed" && entry.rootSha256 === expectedRoot));

  mcpChild = spawn(process.execPath, [join(packageRoot, "scripts", "pyprocMcp.mjs"), "--config", configPath], {
    cwd: installed.appDir, stdio: ["pipe", "pipe", "pipe"], env: process.env,
  });
  let mcpStderr = "";
  mcpChild.stderr.on("data", (chunk) => { mcpStderr = (mcpStderr + String(chunk)).slice(-8000); });
  const waiters = new Map();
  let sequence = 0;
  createInterface({ input: mcpChild.stdout, crlfDelay: Infinity }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch (error) { return; }
    const waiter = waiters.get(message.id);
    if (waiter) { waiters.delete(message.id); waiter(message); }
  });
  const request = (method, params = {}) => {
    const id = ++sequence;
    mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`${method} timeout\n${mcpStderr}`)); }, TIMEOUT_MS);
      waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
    });
  };
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "replay-graph-product-gate", version: "1" } });
  mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = (await request("tools/list")).result.tools.map((tool) => tool.name);
  const listed = await request("tools/call", { name: "worldList", arguments: {} });
  const mcpGraphs = JSON.parse(listed.result.content[0].text);
  check("MCP exposes all ReplayGraph tools and the same durable graph root",
    ["worldImportRecording", "worldCreateApp", "worldCaptureAppBranch", "worldOpen", "worldInspect",
      "worldEdges", "worldTraverse", "worldCheckpoint", "worldRestore", "worldEvaluate", "worldCoverage",
      "worldList"].every((name) => tools.includes(name))
      && mcpGraphs.some((entry) => entry.graphId === "graph:installed" && entry.rootSha256 === expectedRoot));
} catch (error) {
  check("ReplayGraph installed journey has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  if (!clientClosed) await client.close();
  if (mcpChild?.exitCode === null) mcpChild.kill("SIGTERM");
  if (mcpChild) await new Promise((resolve) => mcpChild.exitCode === null ? mcpChild.once("exit", resolve) : resolve());
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
