import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAutomationRecordingEntry,
  AutomationRecordingWriter,
  createAutomationRecording,
  putAutomationRecordingArtifact,
} from "../../scripts/automationSpace/automationRecording.js";
import { createAppStateSnapshot, createPairedGeneration }
  from "../../scripts/appSpace/appSpaceCanonical.js";
import { ReplayGraphCoordinator } from "../../scripts/replayGraph/replayGraphCoordinator.js";
import { ReplayGraphRegistry } from "../../scripts/replayGraph/replayGraphRegistry.js";
import { FileReplayGraphStore } from "../../scripts/replayGraph/fileReplayGraphStore.js";
import { validateReplayGraphRevision } from "../../scripts/replayGraph/replayGraphCanonical.js";
import { evaluateReplayGraph, retainedReplayGraphObjects } from "../../scripts/replayGraph/replayWorld.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
async function errorOf(operation) { try { await operation(); return null; } catch (error) { return error; } }

function appPair(pairId, value, parentPairSha256 = null) {
  const app = createAppStateSnapshot({ identity: { appId: "replay.contract", origin: "https://app.example.test",
    adapterVersion: "1", stateSchema: "replay/1" }, revision: `apprev:${value}`,
  state: { route: "/task", value }, outbox: [], scope: ["router", "domainStore"] });
  return createPairedGeneration({ pairId, parentPairSha256, app,
    machine: { checkpointIndex: value.length, imageSha256: digest(`image:${value}`),
      generation: `sha256:${digest(`generation:${value}`)}`, environment: digest("environment") },
    session: { executionSessionId: "session:replay", revisionSha256: digest(`session:${value}`) },
    createdAt: "2026-08-13T00:00:00.000Z", source: "contract" });
}

export async function assertReplayGraphContract() {
  const root = await mkdtemp(join(tmpdir(), "pyproc-replay-graph-"));
  try {
    const recordingFile = join(root, "recording.json");
    const screenshot = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9]);
    const screenshotSha256 = digest(screenshot);
    const recording = createAutomationRecording({ recordingId: "recording:replayContract", provider: {
      spaceId: "space:contract", providerKind: "nativeCdp",
      operations: ["automation.observe", "automation.act"], capabilities: ["screenshot"],
      restoreBoundary: "externalEffectsRemain", policy: { targetOrigins: ["https://app.example.test"],
        actions: ["snapshot", "screenshot"], rawMethods: [], maxRisk: "externalEffect" },
    } });
    putAutomationRecordingArtifact(recording, "artifact:screen", { kind: "screenshot", mimeType: "image/png",
      byteLength: screenshot.byteLength, sha256: screenshotSha256, dataBase64: screenshot.toString("base64") });
    const observed = appendAutomationRecordingEntry(recording, { operation: "automation.observe",
      input: { expectedRisk: "read" }, terminal: { ok: true, output: { title: "Contract" } },
      inlineArtifacts: [], artifactRefs: [] });
    const captured = appendAutomationRecordingEntry(recording, { operation: "automation.act",
      input: { actions: [{ kind: "screenshot", expectedRisk: "read" }] }, terminal: { ok: true,
        output: { kind: "screenshot", artifactRef: "artifact:screen", sha256: screenshotSha256 } },
      inlineArtifacts: [], artifactRefs: ["artifact:screen"] });
    const writer = await AutomationRecordingWriter.open(recordingFile, recording);
    await writer.write(recording);
    await writer.close();

    const store = await FileReplayGraphStore.open(root);
    const basePair = appPair("pair:base", "base");
    const leftPair = appPair("pair:left", "left", basePair.contentSha256);
    const rightPair = appPair("pair:right", "right", basePair.contentSha256);
    const pairs = new Map([[basePair.pairId, basePair], [leftPair.pairId, leftPair], [rightPair.pairId, rightPair]]);
    const restoreProofs = new Map([["restore:11111111111111111111111111111111", basePair.contentSha256],
      ["restore:22222222222222222222222222222222", basePair.contentSha256],
      ["restore:33333333333333333333333333333333", basePair.contentSha256]]);
    const registry = new ReplayGraphRegistry({ store, importRoots: [root],
      appRegistry: { async openPair(pairId) { return pairs.get(pairId); } },
      appCoordinator: { consumeRestoreProof(restoreRef, pairSha256) {
        const expected = restoreProofs.get(restoreRef);
        restoreProofs.delete(restoreRef);
        if (expected !== pairSha256) throw Object.assign(new Error("restore proof invalid"),
          { code: "APP_SPACE_RESTORE_PROOF_INVALID" });
        return { restoreRef, pairSha256 };
      } } });

    const imported = await registry.importRecording({ graphId: "graph:recording", recordingFile });
    assert.equal(imported.graph.nodes.length, 3);
    assert.equal(imported.graph.edges[0].transitionProof.entrySha256, observed.sha256);
    assert.equal(imported.graph.edges[1].transitionProof.entrySha256, captured.sha256);
    assert.equal(imported.graph.artifacts[0].sha256, screenshotSha256);
    assert.deepEqual(await store.readArtifact(screenshotSha256), screenshot);
    assert.equal((await errorOf(() => registry.importRecording({ graphId: "graph:denied",
      recordingFile: join(tmpdir(), "outside.json") })))?.code, "REPLAY_GRAPH_IMPORT_DENIED");

    let graph = await registry.createAppWorld({ graphId: "graph:app", pairId: basePair.pairId });
    const sourceNodeRef = graph.startNodeRefs[0];
    graph = await registry.captureAppBranch({ graphId: graph.graphId, expectedRootSha256: graph.rootSha256,
      sourceNodeRef, sourcePairId: basePair.pairId, targetPairId: leftPair.pairId,
      restoreRef: "restore:11111111111111111111111111111111", operation: "automation.act",
      input: { choice: "left" }, terminal: { ok: true, output: { value: "left" } }, risk: "localMutation" });
    const firstRoot = graph.rootSha256;
    assert.equal((await errorOf(() => registry.captureAppBranch({ graphId: graph.graphId,
      expectedRootSha256: graph.rootSha256, sourceNodeRef, sourcePairId: basePair.pairId,
      targetPairId: rightPair.pairId, restoreRef: "restore:ffffffffffffffffffffffffffffffff",
      operation: "automation.act", input: { choice: "right" }, terminal: { ok: true, output: {} } })))?.code,
    "REPLAY_GRAPH_SOURCE_UNVERIFIED");
    graph = await registry.captureAppBranch({ graphId: graph.graphId, expectedRootSha256: graph.rootSha256,
      sourceNodeRef, sourcePairId: basePair.pairId, targetPairId: rightPair.pairId,
      restoreRef: "restore:22222222222222222222222222222222", operation: "automation.act",
      input: { choice: "right" }, terminal: { ok: true, output: { value: "right" } }, risk: "localMutation" });
    assert.equal(graph.edges.length, 2);
    assert.notEqual(graph.edges[0].targetNodeRef, graph.edges[1].targetNodeRef);
    assert.equal(graph.edges.every((edge) => edge.provenance === "transactional"), true);
    assert.equal((await errorOf(() => registry.captureAppBranch({ graphId: graph.graphId,
      expectedRootSha256: firstRoot, sourceNodeRef, sourcePairId: basePair.pairId,
      targetPairId: rightPair.pairId, restoreRef: "restore:33333333333333333333333333333333",
      operation: "automation.act", input: { choice: "right" }, terminal: { ok: true, output: {} } })))?.code,
    "REPLAY_GRAPH_HEAD_CONFLICT");

    let providerCalls = 0;
    const coordinator = new ReplayGraphCoordinator({ registry });
    const opened = await coordinator.open({ graphId: graph.graphId, rootSha256: graph.rootSha256,
      startNodeRef: sourceNodeRef });
    const edges = coordinator.edges({ worldRef: opened.world.worldRef });
    assert.equal(edges.length, 2);
    const checkpoint = coordinator.checkpoint({ worldRef: opened.world.worldRef });
    const left = edges.find((edge) => edge.input.choice === "left");
    const right = edges.find((edge) => edge.input.choice === "right");
    const traversed = coordinator.traverse({ worldRef: opened.world.worldRef,
      capabilityRef: left.capabilityRef, expectedNodeRef: sourceNodeRef });
    providerCalls += 0;
    assert.equal(traversed.terminal.output.value, "left");
    assert.equal(traversed.replayedEffect, false);
    assert.equal(providerCalls, 0);
    assert.equal((await errorOf(async () => coordinator.traverse({ worldRef: opened.world.worldRef,
      capabilityRef: right.capabilityRef, expectedNodeRef: sourceNodeRef })))?.code, "REPLAY_GRAPH_CURSOR_STALE");
    coordinator.restore({ worldRef: opened.world.worldRef, checkpoint });
    assert.equal(coordinator.inspect({ worldRef: opened.world.worldRef }).currentNodeRef, sourceNodeRef);

    const contract = { startNodeRef: sourceNodeRef, goalNodeRefs: [left.targetNodeRef],
      forbiddenEdgeRefs: [right.edgeRef], stepBudget: 3 };
    const verdict = evaluateReplayGraph(graph, contract, [left.edgeRef]);
    const sameVerdict = evaluateReplayGraph(graph, { ...contract, callerText: "ignored" }, [left.edgeRef]);
    assert.equal(verdict.terminal, "goalReached");
    assert.equal(verdict.verdictSha256, sameVerdict.verdictSha256);
    const coverage = coordinator.coverage({ worldRef: opened.world.worldRef });
    assert.equal(coverage.reachableNodeRefs.length, 3);
    assert.equal(coverage.provenance.transactional, 2);
    const retained = retainedReplayGraphObjects(graph, [left.targetNodeRef]);
    assert.equal(retained.edgeRefs.includes(left.edgeRef), true);

    const mutated = structuredClone(graph);
    mutated.nodes[0].state.pairId = "pair:forged";
    assert.equal((await errorOf(async () => validateReplayGraphRevision(mutated)))?.code, "REPLAY_GRAPH_MUTATED");
    const listed = await registry.list();
    assert.equal(listed.some((entry) => entry.graphId === "graph:recording"
      && entry.rootSha256 === imported.graph.rootSha256), true);
    assert.equal(listed.some((entry) => entry.graphId === "graph:app" && entry.rootSha256 === graph.rootSha256), true);
  } finally { await rm(root, { recursive: true, force: true }); }
}
