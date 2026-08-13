// replayGraphCanonical.js - verified state node, exact transition edge, immutable graph revision의 정본 형식.
import { createHash } from "node:crypto";

export const REPLAY_GRAPH_FORMAT = "pyproc.replayGraph";
export const REPLAY_GRAPH_VERSION = 1;
export const REPLAY_GRAPH_MAX_NODES = 20000;
export const REPLAY_GRAPH_MAX_EDGES = 50000;
export const REPLAY_GRAPH_MAX_ARTIFACTS = 10000;
export const REPLAY_GRAPH_MAX_BYTES = 32 * 1024 * 1024;
export const REPLAY_GRAPH_PROVENANCE = Object.freeze([
  "recordedLive", "recordedFrame", "transactional", "syntheticFixture",
]);

const DIGEST_RE = /^[0-9a-f]{64}$/;
const GRAPH_ID_RE = /^graph:[A-Za-z0-9._:-]{1,96}$/;
const NODE_REF_RE = /^node:[0-9a-f]{64}$/;
const EDGE_REF_RE = /^edge:[0-9a-f]{64}$/;
const ARTIFACT_REF_RE = /^artifact:[A-Za-z0-9_-]+$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_DEPTH = 64;
const MAX_ITEMS = 1000000;
const PROVENANCE_SET = new Set(REPLAY_GRAPH_PROVENANCE);

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label) {
  if (!plainObject(value)) throw replayGraphError("REPLAY_GRAPH_INVALID", `${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw replayGraphError("REPLAY_GRAPH_INVALID", `${label}.${key} is unknown`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw replayGraphError("REPLAY_GRAPH_INVALID", `${label}.${key} is required`);
  }
}

function scanBounds(value) {
  const stack = [{ value, depth: 0 }];
  let items = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++items > MAX_ITEMS || current.depth > MAX_DEPTH) {
      throw replayGraphError("REPLAY_GRAPH_TOO_COMPLEX", "ReplayGraph exceeds the structural limit");
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (plainObject(current.value)) {
      for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

export function canonicalReplayGraphJson(value, depth = 0) {
  if (depth > MAX_DEPTH) throw replayGraphError("REPLAY_GRAPH_TOO_COMPLEX", "ReplayGraph value exceeds the depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((child) => canonicalReplayGraphJson(child, depth + 1)).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalReplayGraphJson(value[key], depth + 1)}`).join(",")}}`;
  throw replayGraphError("REPLAY_GRAPH_VALUE_INVALID", "ReplayGraph values must be finite JSON");
}

export function replayGraphDigest(value) {
  return createHash("sha256").update(canonicalReplayGraphJson(value)).digest("hex");
}

export function replayGraphError(code, message, details = null, outcome = "notSent") {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  if (details) error.details = details;
  return error;
}

function frozenClone(value) {
  return Object.freeze(structuredClone(value));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assertDigest(value, label) {
  if (!DIGEST_RE.test(String(value || ""))) {
    throw replayGraphError("REPLAY_GRAPH_INVALID", `${label} must be a lowercase SHA-256 digest`);
  }
}

function validateTransitionProof(provenance, proof) {
  if (!plainObject(proof)) throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "transition proof is required");
  if (provenance === "transactional") {
    if (proof.restored !== true || !DIGEST_RE.test(String(proof.sourcePairSha256 || ""))
      || !DIGEST_RE.test(String(proof.targetPairSha256 || ""))
      || !/^restore:[0-9a-f]{32}$/.test(String(proof.restoreRef || ""))) {
      throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "transactional edge requires a consumed exact restore proof");
    }
  } else if (provenance === "syntheticFixture") {
    assertDigest(proof.oracleSha256, "synthetic oracleSha256");
  } else {
    assertDigest(proof.entrySha256, "recorded entrySha256");
    if (!ID_RE.test(String(proof.recordingId || "")) || !Number.isInteger(proof.sequence) || proof.sequence < 0) {
      throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "recorded edge proof is invalid");
    }
  }
  return proof;
}

export function createReplayGraphNode(input) {
  if (!plainObject(input) || !ID_RE.test(String(input.providerKind || ""))) {
    throw replayGraphError("REPLAY_GRAPH_NODE_INVALID", "node providerKind is invalid");
  }
  assertDigest(input.environmentSha256, "node environmentSha256");
  assertDigest(input.policySha256, "node policySha256");
  if (!plainObject(input.state) || !["complete", "partial", "implicit"].includes(input.completeness)
    || !Array.isArray(input.artifactSha256s)) {
    throw replayGraphError("REPLAY_GRAPH_NODE_INVALID", "node state or completeness is invalid");
  }
  for (const digest of input.artifactSha256s) assertDigest(digest, "node artifact digest");
  for (const [value, label] of [[input.sessionRevisionSha256, "session revision"],
    [input.pendingEffectSha256, "pending effect"]]) {
    if (value !== null && value !== undefined) assertDigest(value, label);
  }
  const body = frozenClone({ format: "pyproc.replayGraphNode", version: 1,
    providerKind: input.providerKind, environmentSha256: input.environmentSha256,
    policySha256: input.policySha256, state: input.state, completeness: input.completeness,
    artifactSha256s: sortedUnique(input.artifactSha256s),
    sessionRevisionSha256: input.sessionRevisionSha256 ?? null,
    pendingEffectSha256: input.pendingEffectSha256 ?? null });
  return Object.freeze({ nodeRef: `node:${replayGraphDigest(body)}`, ...body });
}

export function createReplayGraphEdge(input) {
  if (!plainObject(input) || !NODE_REF_RE.test(String(input.sourceNodeRef || ""))
    || !NODE_REF_RE.test(String(input.targetNodeRef || "")) || typeof input.operation !== "string"
    || !input.operation || !plainObject(input.input) || !plainObject(input.terminal)
    || typeof input.terminal.ok !== "boolean" || !PROVENANCE_SET.has(input.provenance)
    || !["none", "recordedExternal"].includes(input.effectClass) || !Array.isArray(input.artifactRefs)
    || input.artifactRefs.some((ref) => !ARTIFACT_REF_RE.test(String(ref)))) {
    throw replayGraphError("REPLAY_GRAPH_EDGE_INVALID", "ReplayGraph edge is invalid");
  }
  const inputSha256 = replayGraphDigest(input.input);
  const body = frozenClone({ format: "pyproc.replayGraphEdge", version: 1,
    sourceNodeRef: input.sourceNodeRef, targetNodeRef: input.targetNodeRef,
    operation: input.operation, input: input.input, inputSha256, terminal: input.terminal,
    provenance: input.provenance, effectClass: input.effectClass, risk: String(input.risk || "read"),
    artifactRefs: sortedUnique(input.artifactRefs), transitionProof: validateTransitionProof(input.provenance, input.transitionProof),
    transitionKey: replayGraphDigest({ sourceNodeRef: input.sourceNodeRef, operation: input.operation, inputSha256 }) });
  return Object.freeze({ edgeRef: `edge:${replayGraphDigest(body)}`, ...body });
}

export function createReplayGraphArtifact(artifactRef, descriptor) {
  if (!ARTIFACT_REF_RE.test(String(artifactRef || "")) || !plainObject(descriptor)
    || typeof descriptor.kind !== "string" || !descriptor.kind || typeof descriptor.mimeType !== "string"
    || !descriptor.mimeType || !Number.isInteger(descriptor.byteLength) || descriptor.byteLength < 1) {
    throw replayGraphError("REPLAY_GRAPH_ARTIFACT_INVALID", "ReplayGraph artifact is invalid");
  }
  assertDigest(descriptor.sha256, "artifact sha256");
  return frozenClone({ artifactRef, kind: descriptor.kind, mimeType: descriptor.mimeType,
    byteLength: descriptor.byteLength, sha256: descriptor.sha256 });
}

function revisionBody(input) {
  return frozenClone({ format: REPLAY_GRAPH_FORMAT, version: REPLAY_GRAPH_VERSION, graphId: input.graphId,
    parentRootSha256: input.parentRootSha256 ?? null, startNodeRefs: sortedUnique(input.startNodeRefs),
    nodes: [...input.nodes].sort((left, right) => left.nodeRef < right.nodeRef ? -1 : left.nodeRef > right.nodeRef ? 1 : 0),
    edges: [...input.edges].sort((left, right) => left.edgeRef < right.edgeRef ? -1 : left.edgeRef > right.edgeRef ? 1 : 0),
    artifacts: [...input.artifacts].sort((left, right) => left.artifactRef < right.artifactRef ? -1
      : left.artifactRef > right.artifactRef ? 1 : 0),
    unexploredActionClasses: sortedUnique(input.unexploredActionClasses || []) });
}

export function createReplayGraphRevision(input) {
  if (!plainObject(input) || !GRAPH_ID_RE.test(String(input.graphId || ""))
    || (input.parentRootSha256 !== null && input.parentRootSha256 !== undefined
      && !DIGEST_RE.test(String(input.parentRootSha256)))
    || !Array.isArray(input.startNodeRefs) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)
    || !Array.isArray(input.artifacts) || !Array.isArray(input.unexploredActionClasses || [])) {
    throw replayGraphError("REPLAY_GRAPH_INVALID", "ReplayGraph revision input is invalid");
  }
  const body = revisionBody(input);
  return validateReplayGraphRevision(Object.freeze({ ...body, rootSha256: replayGraphDigest(body) }));
}

export function validateReplayGraphRevision(value) {
  scanBounds(value);
  exactKeys(value, new Set(["format", "version", "graphId", "parentRootSha256", "startNodeRefs", "nodes",
    "edges", "artifacts", "unexploredActionClasses", "rootSha256"]), "ReplayGraph");
  if (value.format !== REPLAY_GRAPH_FORMAT || value.version !== REPLAY_GRAPH_VERSION
    || !GRAPH_ID_RE.test(String(value.graphId || "")) || !Array.isArray(value.startNodeRefs)
    || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.artifacts)
    || !Array.isArray(value.unexploredActionClasses) || value.nodes.length > REPLAY_GRAPH_MAX_NODES
    || value.edges.length > REPLAY_GRAPH_MAX_EDGES || value.artifacts.length > REPLAY_GRAPH_MAX_ARTIFACTS) {
    throw replayGraphError("REPLAY_GRAPH_INVALID", "ReplayGraph envelope or quota is invalid");
  }
  const nodeRefs = new Set();
  for (const node of value.nodes) {
    const { nodeRef, ...body } = node;
    if (!NODE_REF_RE.test(String(nodeRef || "")) || nodeRef !== `node:${replayGraphDigest(body)}`
      || nodeRefs.has(nodeRef)) throw replayGraphError("REPLAY_GRAPH_MUTATED", "ReplayGraph node digest changed or duplicated");
    createReplayGraphNode(body);
    nodeRefs.add(nodeRef);
  }
  const artifacts = new Map();
  for (const artifact of value.artifacts) {
    const verified = createReplayGraphArtifact(artifact.artifactRef, artifact);
    if (artifacts.has(verified.artifactRef)) throw replayGraphError("REPLAY_GRAPH_ARTIFACT_CONFLICT", "artifact ref is duplicated");
    artifacts.set(verified.artifactRef, verified);
  }
  const edgeRefs = new Set();
  const transitionKeys = new Set();
  for (const edge of value.edges) {
    const { edgeRef, ...body } = edge;
    if (!EDGE_REF_RE.test(String(edgeRef || "")) || edgeRef !== `edge:${replayGraphDigest(body)}`
      || edgeRefs.has(edgeRef)) throw replayGraphError("REPLAY_GRAPH_MUTATED", "ReplayGraph edge digest changed or duplicated");
    const verified = createReplayGraphEdge(body);
    if (!nodeRefs.has(verified.sourceNodeRef) || !nodeRefs.has(verified.targetNodeRef)) {
      throw replayGraphError("REPLAY_GRAPH_ENDPOINT_MISSING", "ReplayGraph edge endpoint is unavailable");
    }
    if (transitionKeys.has(verified.transitionKey)) {
      throw replayGraphError("REPLAY_GRAPH_TRANSITION_CONFLICT", "ReplayGraph exact transition is ambiguous");
    }
    transitionKeys.add(verified.transitionKey);
    for (const artifactRef of verified.artifactRefs) {
      if (!artifacts.has(artifactRef)) throw replayGraphError("REPLAY_GRAPH_ARTIFACT_MISSING", `artifact is unavailable: ${artifactRef}`);
    }
    edgeRefs.add(edgeRef);
  }
  if (!value.startNodeRefs.length || value.startNodeRefs.some((ref) => !nodeRefs.has(ref))
    || value.unexploredActionClasses.some((entry) => !ID_RE.test(String(entry)))) {
    throw replayGraphError("REPLAY_GRAPH_INVALID", "ReplayGraph start or coverage declaration is invalid");
  }
  const { rootSha256, ...body } = value;
  assertDigest(rootSha256, "graph rootSha256");
  if (rootSha256 !== replayGraphDigest(body)) throw replayGraphError("REPLAY_GRAPH_MUTATED", "ReplayGraph root digest changed");
  if (Buffer.byteLength(canonicalReplayGraphJson(body)) > REPLAY_GRAPH_MAX_BYTES) {
    throw replayGraphError("REPLAY_GRAPH_TOO_LARGE", "ReplayGraph revision exceeds the byte limit");
  }
  return value;
}

export function replayGraphRevisionBytes(value) {
  const verified = validateReplayGraphRevision(value);
  const { rootSha256: ignored, ...body } = verified;
  void ignored;
  return Buffer.from(canonicalReplayGraphJson(body));
}

export function parseReplayGraphRevision(bytes, expectedRootSha256) {
  let body;
  try { body = JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch (error) { throw replayGraphError("REPLAY_GRAPH_INVALID", "ReplayGraph bytes are not JSON"); }
  const rootSha256 = replayGraphDigest(body);
  if (rootSha256 !== expectedRootSha256) throw replayGraphError("REPLAY_GRAPH_MUTATED", "stored ReplayGraph digest changed");
  return validateReplayGraphRevision(Object.freeze({ ...body, rootSha256 }));
}

export function replayGraphNodeForPair(pair) {
  if (!plainObject(pair) || !DIGEST_RE.test(String(pair.contentSha256 || ""))) {
    throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "paired generation is invalid");
  }
  return createReplayGraphNode({ providerKind: "transactionalApp",
    environmentSha256: replayGraphDigest({ identity: pair.app.identity, environment: pair.machine.environment }),
    policySha256: replayGraphDigest({ scope: pair.app.scope, source: pair.provenance.source }),
    state: { kind: "appPair", pairId: pair.pairId, pairSha256: pair.contentSha256,
      appStateSha256: pair.app.stateSha256, machineGeneration: pair.machine.generation,
      machineImageSha256: pair.machine.imageSha256, outboxSha256: replayGraphDigest(pair.app.outbox) },
    completeness: "complete", artifactSha256s: [], sessionRevisionSha256: pair.session.revisionSha256,
    pendingEffectSha256: pair.app.outbox.find((entry) => entry.state === "staged")?.intentSha256 || null });
}
