import { createHash } from "node:crypto";
import {
  automationRecordingDigest,
  automationRecordingZeroDigest,
  verifyAutomationRecording,
} from "../../../scripts/automationSpace/automationRecording.js";

const DIGEST_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVENANCE = new Set(["recordedLive", "recordedFrame", "transactional", "syntheticFixture"]);

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalGraphJson(value, depth = 0) {
  if (depth > 48) throw graphError("REPLAY_GRAPH_TOO_COMPLEX", "graph value exceeds the depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((child) => canonicalGraphJson(child, depth + 1)).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalGraphJson(value[key], depth + 1)}`).join(",")}}`;
  throw graphError("REPLAY_GRAPH_VALUE_INVALID", "graph value must be finite JSON");
}

export function graphDigest(value) {
  return createHash("sha256").update(canonicalGraphJson(value)).digest("hex");
}

function graphError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  if (details) error.details = details;
  return error;
}

function immutable(value) {
  return Object.freeze(structuredClone(value));
}

function deterministicOrder(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nodeBody(input) {
  if (!plainObject(input) || !ID_RE.test(String(input.providerKind || ""))
    || !DIGEST_RE.test(String(input.environmentSha256 || ""))
    || !DIGEST_RE.test(String(input.policySha256 || "")) || !plainObject(input.state)
    || !["complete", "partial", "implicit"].includes(input.completeness)
    || !Array.isArray(input.artifactSha256s)
    || input.artifactSha256s.some((value) => !DIGEST_RE.test(String(value)))) {
    throw graphError("REPLAY_GRAPH_NODE_INVALID", "graph node identity is invalid");
  }
  return immutable({
    format: "pyproc.replayGraphNode",
    version: 1,
    providerKind: input.providerKind,
    environmentSha256: input.environmentSha256,
    policySha256: input.policySha256,
    state: input.state,
    completeness: input.completeness,
    artifactSha256s: [...new Set(input.artifactSha256s)].sort(),
    sessionRevisionSha256: input.sessionRevisionSha256 || null,
    pendingEffectSha256: input.pendingEffectSha256 || null,
  });
}

function transitionProof(input) {
  if (input.provenance === "transactional") {
    if (input.transitionProof?.restored !== true
      || !DIGEST_RE.test(String(input.transitionProof.pairSha256 || ""))) {
      throw graphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "transactional edge requires an exact restored pair");
    }
  } else if (input.provenance === "syntheticFixture") {
    if (!DIGEST_RE.test(String(input.transitionProof?.oracleSha256 || ""))) {
      throw graphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "synthetic edge requires an exact oracle");
    }
  } else if (!DIGEST_RE.test(String(input.transitionProof?.entrySha256 || ""))) {
    throw graphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "recorded edge requires an exact entry digest");
  }
  return immutable(input.transitionProof);
}

function edgeBody(input) {
  if (!plainObject(input) || !/^node:[0-9a-f]{64}$/.test(String(input.sourceNodeRef || ""))
    || !/^node:[0-9a-f]{64}$/.test(String(input.targetNodeRef || ""))
    || typeof input.operation !== "string" || !input.operation || !plainObject(input.input)
    || !plainObject(input.terminal) || typeof input.terminal.ok !== "boolean"
    || !PROVENANCE.has(input.provenance) || !["none", "recordedExternal"].includes(input.effectClass)
    || !Array.isArray(input.artifactRefs) || input.artifactRefs.some((ref) => !ID_RE.test(String(ref)))) {
    throw graphError("REPLAY_GRAPH_EDGE_INVALID", "graph edge is invalid");
  }
  return immutable({
    format: "pyproc.replayGraphEdge",
    version: 1,
    sourceNodeRef: input.sourceNodeRef,
    targetNodeRef: input.targetNodeRef,
    operation: input.operation,
    input: input.input,
    inputSha256: graphDigest(input.input),
    terminal: input.terminal,
    provenance: input.provenance,
    effectClass: input.effectClass,
    risk: String(input.risk || "read"),
    artifactRefs: [...new Set(input.artifactRefs)].sort(),
    transitionProof: transitionProof(input),
  });
}

export class ReplayGraphPrototype {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.artifacts = new Map();
    this.starts = new Set();
    this.unexploredActionClasses = new Set();
  }

  addArtifact(artifactRef, descriptor) {
    if (!ID_RE.test(String(artifactRef || "")) || !plainObject(descriptor)
      || !DIGEST_RE.test(String(descriptor.sha256 || "")) || !Number.isInteger(descriptor.byteLength)
      || descriptor.byteLength < 1) throw graphError("REPLAY_GRAPH_ARTIFACT_INVALID", "graph artifact is invalid");
    const body = immutable({ artifactRef, kind: descriptor.kind, mimeType: descriptor.mimeType,
      byteLength: descriptor.byteLength, sha256: descriptor.sha256 });
    const prior = this.artifacts.get(artifactRef);
    if (prior && canonicalGraphJson(prior) !== canonicalGraphJson(body)) {
      throw graphError("REPLAY_GRAPH_ARTIFACT_CONFLICT", "graph artifact identity changed");
    }
    this.artifacts.set(artifactRef, body);
    return body;
  }

  addNode(input, { start = false } = {}) {
    const body = nodeBody(input);
    const nodeRef = `node:${graphDigest(body)}`;
    this.nodes.set(nodeRef, Object.freeze({ nodeRef, ...body }));
    if (start) this.starts.add(nodeRef);
    return nodeRef;
  }

  addEdge(input) {
    const body = edgeBody(input);
    if (!this.nodes.has(body.sourceNodeRef) || !this.nodes.has(body.targetNodeRef)) {
      throw graphError("REPLAY_GRAPH_ENDPOINT_MISSING", "graph edge endpoint is unavailable");
    }
    for (const artifactRef of body.artifactRefs) {
      if (!this.artifacts.has(artifactRef)) {
        throw graphError("REPLAY_GRAPH_ARTIFACT_MISSING", `graph edge artifact is unavailable: ${artifactRef}`);
      }
    }
    const key = `${body.sourceNodeRef}:${body.operation}:${body.inputSha256}`;
    if ([...this.edges.values()].some((edge) => edge.transitionKey === key)) {
      throw graphError("REPLAY_GRAPH_TRANSITION_CONFLICT", "exact source and input already have a transition");
    }
    const edgeRef = `edge:${graphDigest(body)}`;
    this.edges.set(edgeRef, Object.freeze({ edgeRef, transitionKey: key, ...body }));
    return edgeRef;
  }

  declareUnexplored(...actionClasses) {
    for (const actionClass of actionClasses) {
      if (!ID_RE.test(String(actionClass || ""))) throw new TypeError("unexplored action class is invalid");
      this.unexploredActionClasses.add(actionClass);
    }
  }

  seal() {
    if (!this.starts.size) throw graphError("REPLAY_GRAPH_START_MISSING", "graph requires a start node");
    const body = immutable({
      format: "pyproc.replayGraph",
      version: 1,
      startNodeRefs: [...this.starts].sort(),
      nodes: [...this.nodes.values()].sort((left, right) => deterministicOrder(left.nodeRef, right.nodeRef)),
      edges: [...this.edges.values()].sort((left, right) => deterministicOrder(left.edgeRef, right.edgeRef)),
      artifacts: [...this.artifacts.values()].sort((left, right) => deterministicOrder(left.artifactRef, right.artifactRef)),
      unexploredActionClasses: [...this.unexploredActionClasses].sort(),
    });
    return verifyReplayGraph(Object.freeze({ ...body, rootSha256: graphDigest(body) }));
  }
}

export function importAutomationRecording(recording) {
  const verified = verifyAutomationRecording(recording);
  const graph = new ReplayGraphPrototype();
  for (const [artifactRef, descriptor] of Object.entries(verified.artifacts)) graph.addArtifact(artifactRef, descriptor);
  const environmentSha256 = graphDigest({ providerKind: verified.provider.providerKind,
    spaceId: verified.provider.spaceId, capabilities: verified.provider.capabilities });
  const policySha256 = graphDigest(verified.provider.policy);
  const nodeRefs = [];
  for (let cursor = 0; cursor <= verified.entries.length; cursor += 1) {
    const prefixSha256 = cursor === 0 ? automationRecordingZeroDigest() : verified.entries[cursor - 1].sha256;
    nodeRefs.push(graph.addNode({ providerKind: verified.provider.providerKind, environmentSha256, policySha256,
      state: { kind: "recordingCursor", recordingId: verified.recordingId, cursor, prefixSha256 },
      completeness: "implicit", artifactSha256s: verified.entries.slice(0, cursor)
        .flatMap((entry) => entry.artifactRefs).map((ref) => verified.artifacts[ref].sha256) }, { start: cursor === 0 }));
  }
  const edgeRefs = verified.entries.map((entry, index) => graph.addEdge({ sourceNodeRef: nodeRefs[index],
    targetNodeRef: nodeRefs[index + 1], operation: entry.operation, input: entry.input, terminal: entry.terminal,
    provenance: verified.provider.providerKind === "frame" ? "recordedFrame" : "recordedLive",
    effectClass: entry.terminal.error?.outcome === "notSent" ? "none" : "recordedExternal",
    risk: verified.provider.policy.maxRisk, artifactRefs: entry.artifactRefs,
    transitionProof: { entrySha256: entry.sha256, recordingId: verified.recordingId, sequence: entry.sequence } }));
  return Object.freeze({ graph: graph.seal(), nodeRefs: Object.freeze(nodeRefs), edgeRefs: Object.freeze(edgeRefs) });
}

export function verifyReplayGraph(graph) {
  if (!plainObject(graph) || graph.format !== "pyproc.replayGraph" || graph.version !== 1
    || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.artifacts)
    || !Array.isArray(graph.startNodeRefs) || !Array.isArray(graph.unexploredActionClasses)) {
    throw graphError("REPLAY_GRAPH_INVALID", "graph envelope is invalid");
  }
  const artifactRefs = new Set(graph.artifacts.map((artifact) => artifact.artifactRef));
  const nodeRefs = new Set();
  for (const node of graph.nodes) {
    const { nodeRef, ...body } = node;
    if (nodeRef !== `node:${graphDigest(body)}`) throw graphError("REPLAY_GRAPH_MUTATED", "graph node digest changed");
    nodeRefs.add(nodeRef);
  }
  const transitions = new Set();
  for (const edge of graph.edges) {
    const { edgeRef, transitionKey, ...body } = edge;
    if (edgeRef !== `edge:${graphDigest(body)}`) throw graphError("REPLAY_GRAPH_MUTATED", "graph edge digest changed");
    if (!nodeRefs.has(edge.sourceNodeRef) || !nodeRefs.has(edge.targetNodeRef)) {
      throw graphError("REPLAY_GRAPH_ENDPOINT_MISSING", "graph edge endpoint is unavailable");
    }
    if (transitions.has(transitionKey)) throw graphError("REPLAY_GRAPH_TRANSITION_CONFLICT", "graph transition is ambiguous");
    transitions.add(transitionKey);
    for (const artifactRef of edge.artifactRefs) {
      if (!artifactRefs.has(artifactRef)) throw graphError("REPLAY_GRAPH_ARTIFACT_MISSING", "graph artifact is unavailable");
    }
  }
  if (graph.startNodeRefs.some((nodeRef) => !nodeRefs.has(nodeRef))) {
    throw graphError("REPLAY_GRAPH_START_MISSING", "graph start node is unavailable");
  }
  const { rootSha256, ...body } = graph;
  if (rootSha256 !== graphDigest(body)) throw graphError("REPLAY_GRAPH_MUTATED", "graph root digest changed");
  return immutable(graph);
}

export class ReplayWorldPrototype {
  constructor(graph, startNodeRef = null) {
    this.graph = verifyReplayGraph(graph);
    this.nodeMap = new Map(this.graph.nodes.map((node) => [node.nodeRef, node]));
    this.edgeMap = new Map(this.graph.edges.map((edge) => [edge.edgeRef, edge]));
    this.currentNodeRef = startNodeRef || this.graph.startNodeRefs[0];
    if (!this.nodeMap.has(this.currentNodeRef)) throw graphError("REPLAY_GRAPH_START_MISSING", "world start is unavailable");
    this.authorities = new WeakSet();
    this.path = [];
  }

  listEdges() {
    return Object.freeze(this.graph.edges.filter((edge) => edge.sourceNodeRef === this.currentNodeRef));
  }

  authorize(operation, input) {
    const inputSha256 = graphDigest(input);
    const matches = this.listEdges().filter((edge) => edge.operation === operation && edge.inputSha256 === inputSha256);
    if (matches.length !== 1) throw graphError("REPLAY_GRAPH_EDGE_MISSING", "exact graph transition is unavailable", {
      currentNodeRef: this.currentNodeRef, operation, inputSha256,
    });
    const authority = Object.freeze({ rootSha256: this.graph.rootSha256, sourceNodeRef: this.currentNodeRef,
      edgeRef: matches[0].edgeRef });
    this.authorities.add(authority);
    return authority;
  }

  traverse(authority) {
    if (!authority || !this.authorities.has(authority)) {
      throw graphError("REPLAY_GRAPH_AUTHORITY_INVALID", "world traversal requires current authority");
    }
    this.authorities.delete(authority);
    const edge = this.edgeMap.get(authority.edgeRef);
    if (!edge || authority.rootSha256 !== this.graph.rootSha256
      || authority.sourceNodeRef !== this.currentNodeRef || edge.sourceNodeRef !== this.currentNodeRef) {
      throw graphError("REPLAY_GRAPH_CURSOR_STALE", "world cursor changed after authorization");
    }
    this.currentNodeRef = edge.targetNodeRef;
    this.path.push(edge.edgeRef);
    return immutable({ edgeRef: edge.edgeRef, terminal: edge.terminal, targetNodeRef: edge.targetNodeRef,
      provenance: edge.provenance, replayedEffect: false });
  }

  checkpoint() {
    return immutable({ rootSha256: this.graph.rootSha256, currentNodeRef: this.currentNodeRef,
      pathSha256: graphDigest(this.path), path: this.path });
  }

  restore(checkpoint) {
    if (!plainObject(checkpoint) || checkpoint.rootSha256 !== this.graph.rootSha256
      || !this.nodeMap.has(checkpoint.currentNodeRef) || checkpoint.pathSha256 !== graphDigest(checkpoint.path)) {
      throw graphError("REPLAY_GRAPH_CHECKPOINT_INVALID", "world checkpoint is invalid");
    }
    this.currentNodeRef = checkpoint.currentNodeRef;
    this.path = [...checkpoint.path];
    return this.checkpoint();
  }

  coverage() {
    const reachable = new Set([this.currentNodeRef]);
    const queue = [this.currentNodeRef];
    while (queue.length) {
      const source = queue.shift();
      for (const edge of this.graph.edges.filter((candidate) => candidate.sourceNodeRef === source)) {
        if (!reachable.has(edge.targetNodeRef)) { reachable.add(edge.targetNodeRef); queue.push(edge.targetNodeRef); }
      }
    }
    return immutable({ reachableNodeRefs: [...reachable].sort(), knownEdgeRefs: this.graph.edges
      .filter((edge) => reachable.has(edge.sourceNodeRef)).map((edge) => edge.edgeRef).sort(),
    unexploredActionClasses: this.graph.unexploredActionClasses, complete: this.graph.unexploredActionClasses.length === 0 });
  }
}

export function evaluateWorld(graph, contract, edgeRefs) {
  if (!plainObject(contract) || !Array.isArray(contract.goalNodeRefs)
    || !Array.isArray(contract.forbiddenEdgeRefs) || !Number.isInteger(contract.stepBudget)) {
    throw new TypeError("world evaluation contract is invalid");
  }
  const world = new ReplayWorldPrototype(graph, contract.startNodeRef);
  const forbidden = new Set(contract.forbiddenEdgeRefs);
  let forbiddenSelected = false;
  let terminal = "budgetExhausted";
  for (const edgeRef of edgeRefs.slice(0, contract.stepBudget)) {
    const edge = world.edgeMap.get(edgeRef);
    if (!edge || edge.sourceNodeRef !== world.currentNodeRef) { terminal = "edgeMissing"; break; }
    if (forbidden.has(edgeRef)) forbiddenSelected = true;
    world.traverse(world.authorize(edge.operation, edge.input));
    terminal = contract.goalNodeRefs.includes(world.currentNodeRef) ? "goalReached" : "running";
    if (terminal === "goalReached") break;
  }
  const body = immutable({ rootSha256: world.graph.rootSha256, terminal, forbiddenSelected,
    currentNodeRef: world.currentNodeRef, path: world.path });
  return Object.freeze({ ...body, verdictSha256: graphDigest(body) });
}

export function retainedGraphObjects(graph, pinnedNodeRefs = []) {
  const verified = verifyReplayGraph(graph);
  const nodes = new Set([...verified.startNodeRefs, ...pinnedNodeRefs]);
  const edges = new Set();
  const artifacts = new Set();
  const queue = [...nodes];
  while (queue.length) {
    const source = queue.shift();
    for (const edge of verified.edges.filter((candidate) => candidate.sourceNodeRef === source)) {
      edges.add(edge.edgeRef);
      for (const ref of edge.artifactRefs) artifacts.add(ref);
      if (!nodes.has(edge.targetNodeRef)) { nodes.add(edge.targetNodeRef); queue.push(edge.targetNodeRef); }
    }
  }
  return immutable({ nodeRefs: [...nodes].sort(), edgeRefs: [...edges].sort(), artifactRefs: [...artifacts].sort() });
}

export { automationRecordingDigest };
