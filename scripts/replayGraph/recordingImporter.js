// recordingImporter.js - sealed linear Automation Recording을 state invention 없이 ReplayGraph chain으로 옮긴다.
import {
  automationRecordingZeroDigest,
  readAutomationRecordingArtifact,
  verifyAutomationRecording,
} from "../automationSpace/automationRecording.js";
import {
  createReplayGraphArtifact,
  createReplayGraphEdge,
  createReplayGraphNode,
  createReplayGraphRevision,
  replayGraphDigest,
} from "./replayGraphCanonical.js";

const RISK_RANK = Object.freeze({ read: 0, localMutation: 1, externalEffect: 2 });

function entryRisk(entry, fallback) {
  const values = [entry.input?.expectedRisk,
    ...(Array.isArray(entry.input?.actions) ? entry.input.actions.map((action) => action?.expectedRisk) : [])]
    .filter((value) => Object.hasOwn(RISK_RANK, value));
  if (!values.length) return Object.hasOwn(RISK_RANK, fallback) ? fallback : "read";
  return values.reduce((selected, value) => RISK_RANK[value] > RISK_RANK[selected] ? value : selected, "read");
}

function entryEffectClass(entry, risk) {
  if (risk !== "externalEffect") return "none";
  if (entry.terminal.ok === false && entry.terminal.error?.outcome === "notSent") return "none";
  return "recordedExternal";
}

export async function importRecordingToReplayGraph(recording, graphId) {
  const verified = verifyAutomationRecording(recording);
  const artifacts = [];
  const artifactBytes = new Map();
  for (const [artifactRef, descriptor] of Object.entries(verified.artifacts)) {
    const bytes = await readAutomationRecordingArtifact(verified, artifactRef);
    artifacts.push(createReplayGraphArtifact(artifactRef, descriptor));
    artifactBytes.set(descriptor.sha256, Buffer.from(bytes));
  }
  const environmentSha256 = replayGraphDigest({ spaceId: verified.provider.spaceId,
    providerKind: verified.provider.providerKind, operations: verified.provider.operations,
    capabilities: verified.provider.capabilities });
  const policySha256 = replayGraphDigest(verified.provider.policy);
  const nodes = [];
  const seenArtifacts = new Set();
  for (let cursor = 0; cursor <= verified.entries.length; cursor += 1) {
    if (cursor > 0) {
      for (const ref of verified.entries[cursor - 1].artifactRefs) seenArtifacts.add(verified.artifacts[ref].sha256);
    }
    const prefixSha256 = cursor === 0 ? automationRecordingZeroDigest() : verified.entries[cursor - 1].sha256;
    nodes.push(createReplayGraphNode({ providerKind: verified.provider.providerKind,
      environmentSha256, policySha256,
      state: { kind: "recordingCursor", recordingId: verified.recordingId, cursor, prefixSha256 },
      completeness: "implicit", artifactSha256s: [...seenArtifacts],
      sessionRevisionSha256: null, pendingEffectSha256: null }));
  }
  const edges = verified.entries.map((entry, sequence) => {
    const risk = entryRisk(entry, verified.provider.policy.maxRisk);
    return createReplayGraphEdge({ sourceNodeRef: nodes[sequence].nodeRef,
      targetNodeRef: nodes[sequence + 1].nodeRef, operation: entry.operation, input: entry.input,
      terminal: entry.terminal, provenance: verified.provider.providerKind === "frame" ? "recordedFrame" : "recordedLive",
      effectClass: entryEffectClass(entry, risk), risk, artifactRefs: entry.artifactRefs,
      transitionProof: { entrySha256: entry.sha256, recordingId: verified.recordingId, sequence } });
  });
  const graph = createReplayGraphRevision({ graphId, parentRootSha256: null,
    startNodeRefs: [nodes[0].nodeRef], nodes, edges, artifacts, unexploredActionClasses: [] });
  return Object.freeze({ graph, artifactBytes, source: Object.freeze({
    recordingId: verified.recordingId, finalSha256: verified.finalSha256,
    entries: verified.entries.length, artifacts: artifacts.length,
  }) });
}
