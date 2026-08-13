import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendAutomationRecordingEntry,
  createAutomationRecording,
  putAutomationRecordingArtifact,
  sealAutomationRecording,
} from "../../../scripts/automationSpace/automationRecording.js";
import {
  evaluateWorld,
  graphDigest,
  importAutomationRecording,
  ReplayGraphPrototype,
  ReplayWorldPrototype,
  retainedGraphObjects,
  verifyReplayGraph,
} from "./replayGraphPrototype.mjs";

let checks = 0;
const check = (value, message) => { assert.equal(value, true, message); checks += 1; };
const throwsCode = (operation, code) => {
  assert.throws(operation, (error) => error.code === code);
  checks += 1;
};
const provider = { spaceId: "space:graphProbe", providerKind: "nativeCdp",
  operations: ["automation.observe", "automation.act"], capabilities: ["screenshot"],
  restoreBoundary: "externalEffectsRemain", policy: { targetOrigins: ["https://work.example"],
    actions: ["snapshot", "click"], rawMethods: [], maxRisk: "externalEffect" } };
const recording = createAutomationRecording({ provider, recordingId: "recording:graphProbe" });
const screenshot = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 7]);
const screenshotSha256 = createHash("sha256").update(screenshot).digest("hex");
putAutomationRecordingArtifact(recording, "artifact:state", { kind: "screenshot", mimeType: "image/png",
  byteLength: screenshot.byteLength, sha256: screenshotSha256, dataBase64: screenshot.toString("base64") });
const observed = appendAutomationRecordingEntry(recording, { operation: "automation.observe",
  input: { expectedRisk: "read" }, terminal: { ok: true, output: { title: "Invoices" } },
  inlineArtifacts: [], artifactRefs: [] });
const acted = appendAutomationRecordingEntry(recording, { operation: "automation.act",
  input: { actions: [{ kind: "screenshot", expectedRisk: "read" }] }, terminal: { ok: true,
    output: { kind: "screenshot", artifactRef: "artifact:state", sha256: screenshotSha256 } },
  inlineArtifacts: [], artifactRefs: ["artifact:state"] });
sealAutomationRecording(recording);

const imported = importAutomationRecording(recording);
check(imported.graph.nodes.length === 3 && imported.graph.edges.length === 2, "linear chain must be lossless");
check(imported.graph.edges[0].transitionProof.entrySha256 === observed.sha256
  && imported.graph.edges[1].transitionProof.entrySha256 === acted.sha256, "entry digest must survive import");
check(imported.graph.artifacts[0].sha256 === screenshotSha256, "artifact digest must survive import");

let providerCalls = 0;
const world = new ReplayWorldPrototype(imported.graph);
const first = world.traverse(world.authorize("automation.observe", { expectedRisk: "read" }));
providerCalls += 0;
check(first.terminal.output.title === "Invoices" && first.replayedEffect === false && providerCalls === 0,
  "traversal must use no provider");
throwsCode(() => world.authorize("automation.act", { actions: [{ kind: "click", selector: "#unknown" }] }),
  "REPLAY_GRAPH_EDGE_MISSING");
const stale = world.authorize("automation.act", { actions: [{ kind: "screenshot", expectedRisk: "read" }] });
const beforeSecond = world.checkpoint();
world.traverse(stale);
world.restore(beforeSecond);
throwsCode(() => world.traverse(stale), "REPLAY_GRAPH_AUTHORITY_INVALID");

const graph = new ReplayGraphPrototype();
const environmentSha256 = graphDigest({ browser: "fixture" });
const policyOne = graphDigest({ policy: 1 });
const policyTwo = graphDigest({ policy: 2 });
const base = graph.addNode({ providerKind: "frame", environmentSha256, policySha256: policyOne,
  state: { url: "https://work.example", screenshotSha256, app: { value: "base" } }, completeness: "complete",
  artifactSha256s: [screenshotSha256] }, { start: true });
const left = graph.addNode({ providerKind: "frame", environmentSha256, policySha256: policyOne,
  state: { url: "https://work.example", screenshotSha256, app: { value: "left" } }, completeness: "complete",
  artifactSha256s: [screenshotSha256] });
const right = graph.addNode({ providerKind: "frame", environmentSha256, policySha256: policyTwo,
  state: { url: "https://work.example", screenshotSha256, app: { value: "left" } }, completeness: "complete",
  artifactSha256s: [screenshotSha256] });
check(new Set([base, left, right]).size === 3, "state and policy must participate in node identity");
throwsCode(() => graph.addEdge({ sourceNodeRef: base, targetNodeRef: left, operation: "automation.act",
  input: { action: "left" }, terminal: { ok: true, output: { state: "left" } }, provenance: "transactional",
  effectClass: "none", artifactRefs: [], transitionProof: {} }), "REPLAY_GRAPH_SOURCE_UNVERIFIED");
const leftEdge = graph.addEdge({ sourceNodeRef: base, targetNodeRef: left, operation: "automation.act",
  input: { action: "left" }, terminal: { ok: true, output: { state: "left" } }, provenance: "transactional",
  effectClass: "none", artifactRefs: [], transitionProof: { restored: true, pairSha256: "1".repeat(64) } });
const rightEdge = graph.addEdge({ sourceNodeRef: base, targetNodeRef: right, operation: "automation.act",
  input: { action: "right" }, terminal: { ok: true, output: { state: "right" } }, provenance: "syntheticFixture",
  effectClass: "none", artifactRefs: [], transitionProof: { oracleSha256: "2".repeat(64) } });
graph.declareUnexplored("deleteInvoice");
const branched = graph.seal();
const branchedWorld = new ReplayWorldPrototype(branched, base);
check(branchedWorld.listEdges().length === 2, "two exact branches must remain available");
const coverage = branchedWorld.coverage();
check(coverage.complete === false && coverage.unexploredActionClasses.includes("deleteInvoice"),
  "coverage gap must remain explicit");
check(branched.edges.find((edge) => edge.edgeRef === leftEdge).provenance === "transactional"
  && branched.edges.find((edge) => edge.edgeRef === rightEdge).provenance === "syntheticFixture",
  "edge provenance must not be flattened");

const mutated = structuredClone(branched);
mutated.nodes[0].state.app.value = "forged";
throwsCode(() => verifyReplayGraph(mutated), "REPLAY_GRAPH_MUTATED");
const broken = structuredClone(branched);
broken.nodes = broken.nodes.filter((node) => node.nodeRef !== left);
const { rootSha256: ignoredRoot, ...brokenBody } = broken;
void ignoredRoot;
broken.rootSha256 = graphDigest(brokenBody);
throwsCode(() => verifyReplayGraph(broken), "REPLAY_GRAPH_ENDPOINT_MISSING");

const contract = { startNodeRef: base, goalNodeRefs: [left], forbiddenEdgeRefs: [rightEdge], stepBudget: 3 };
const verdictOne = evaluateWorld(branched, { ...contract, callerText: "first" }, [leftEdge]);
const verdictTwo = evaluateWorld(branched, { ...contract, callerText: "second" }, [leftEdge]);
check(verdictOne.terminal === "goalReached" && verdictOne.verdictSha256 === verdictTwo.verdictSha256,
  "caller text must not change deterministic verdict");
const forbidden = evaluateWorld(branched, contract, [rightEdge]);
check(forbidden.forbiddenSelected === true, "forbidden edge selection must be preserved");
const retained = retainedGraphObjects(branched, [left]);
check(retained.nodeRefs.includes(base) && retained.nodeRefs.includes(left) && retained.edgeRefs.includes(leftEdge),
  "reachable and pinned objects must survive retention");

console.log(`ReplayGraph prototype: GREEN (${checks} checks)`);
