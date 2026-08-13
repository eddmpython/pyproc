// replayWorld.js - pinned graph revision의 capability-bound cursor, coverage, deterministic evaluation.
import { randomBytes } from "node:crypto";
import {
  canonicalReplayGraphJson,
  replayGraphDigest,
  replayGraphError,
  validateReplayGraphRevision,
} from "./replayGraphCanonical.js";

function frozenClone(value) { return Object.freeze(structuredClone(value)); }

export class ReplayWorld {
  constructor(graph, { worldRef = `world:${randomBytes(16).toString("hex")}`, startNodeRef = null } = {}) {
    this.graph = validateReplayGraphRevision(graph);
    this.worldRef = worldRef;
    this.nodes = new Map(graph.nodes.map((node) => [node.nodeRef, node]));
    this.edges = new Map(graph.edges.map((edge) => [edge.edgeRef, edge]));
    this.currentNodeRef = startNodeRef || graph.startNodeRefs[0];
    if (!this.nodes.has(this.currentNodeRef)) throw replayGraphError("REPLAY_GRAPH_START_MISSING", "world start node is unavailable");
    this.path = [];
    this.capabilities = new Map();
  }

  inspect() {
    return frozenClone({ worldRef: this.worldRef, graphId: this.graph.graphId,
      rootSha256: this.graph.rootSha256, currentNodeRef: this.currentNodeRef,
      pathSha256: replayGraphDigest(this.path), steps: this.path.length });
  }

  listEdges() {
    this.capabilities.clear();
    const output = [];
    for (const edge of this.graph.edges.filter((candidate) => candidate.sourceNodeRef === this.currentNodeRef)) {
      const capabilityRef = `worldcap:${randomBytes(16).toString("hex")}`;
      this.capabilities.set(capabilityRef, Object.freeze({ edgeRef: edge.edgeRef,
        sourceNodeRef: this.currentNodeRef, rootSha256: this.graph.rootSha256 }));
      output.push(Object.freeze({ capabilityRef, edgeRef: edge.edgeRef, operation: edge.operation,
        input: edge.input, inputSha256: edge.inputSha256, risk: edge.risk, effectClass: edge.effectClass,
        provenance: edge.provenance, terminal: edge.terminal, targetNodeRef: edge.targetNodeRef }));
    }
    return Object.freeze(output);
  }

  traverse(capabilityRef, expectedNodeRef) {
    const capability = this.capabilities.get(capabilityRef);
    this.capabilities.delete(capabilityRef);
    if (!capability) throw replayGraphError("REPLAY_GRAPH_AUTHORITY_INVALID", "traversal capability is unavailable or consumed");
    const edge = this.edges.get(capability.edgeRef);
    if (capability.rootSha256 !== this.graph.rootSha256 || capability.sourceNodeRef !== this.currentNodeRef
      || expectedNodeRef !== this.currentNodeRef || edge?.sourceNodeRef !== this.currentNodeRef) {
      throw replayGraphError("REPLAY_GRAPH_CURSOR_STALE", "world cursor changed after edge authorization");
    }
    this.currentNodeRef = edge.targetNodeRef;
    this.path.push(edge.edgeRef);
    return frozenClone({ worldRef: this.worldRef, edgeRef: edge.edgeRef, terminal: edge.terminal,
      targetNodeRef: edge.targetNodeRef, provenance: edge.provenance, originalEffectClass: edge.effectClass,
      replayedEffect: false, cursor: this.inspect() });
  }

  checkpoint() {
    const body = { worldRef: this.worldRef, rootSha256: this.graph.rootSha256,
      currentNodeRef: this.currentNodeRef, path: [...this.path] };
    return frozenClone({ ...body, checkpointSha256: replayGraphDigest(body) });
  }

  restore(checkpoint) {
    if (!checkpoint || checkpoint.worldRef !== this.worldRef || checkpoint.rootSha256 !== this.graph.rootSha256
      || !this.nodes.has(checkpoint.currentNodeRef) || !Array.isArray(checkpoint.path)) {
      throw replayGraphError("REPLAY_GRAPH_CHECKPOINT_INVALID", "world checkpoint identity is invalid");
    }
    const { checkpointSha256, ...body } = checkpoint;
    if (checkpointSha256 !== replayGraphDigest(body)
      || checkpoint.path.some((edgeRef) => !this.edges.has(edgeRef))) {
      throw replayGraphError("REPLAY_GRAPH_CHECKPOINT_INVALID", "world checkpoint digest or path is invalid");
    }
    this.currentNodeRef = checkpoint.currentNodeRef;
    this.path = [...checkpoint.path];
    this.capabilities.clear();
    return this.checkpoint();
  }

  coverage() { return inspectReplayGraphCoverage(this.graph); }
}

export function inspectReplayGraphCoverage(graphInput) {
  const graph = validateReplayGraphRevision(graphInput);
  const reachable = new Set(graph.startNodeRefs);
  const queue = [...graph.startNodeRefs];
  const knownEdges = new Set();
  while (queue.length) {
    const source = queue.shift();
    for (const edge of graph.edges.filter((candidate) => candidate.sourceNodeRef === source)) {
      knownEdges.add(edge.edgeRef);
      if (!reachable.has(edge.targetNodeRef)) { reachable.add(edge.targetNodeRef); queue.push(edge.targetNodeRef); }
    }
  }
  const deadEnds = [...reachable].filter((nodeRef) => !graph.edges.some((edge) => edge.sourceNodeRef === nodeRef));
  const provenance = Object.fromEntries([...new Set(graph.edges.map((edge) => edge.provenance))].sort()
    .map((kind) => [kind, graph.edges.filter((edge) => edge.provenance === kind).length]));
  return frozenClone({ graphId: graph.graphId, rootSha256: graph.rootSha256,
    reachableNodeRefs: [...reachable].sort(), knownEdgeRefs: [...knownEdges].sort(), deadEndNodeRefs: deadEnds.sort(),
    unreachableNodeRefs: graph.nodes.map((node) => node.nodeRef).filter((ref) => !reachable.has(ref)).sort(),
    unexploredActionClasses: graph.unexploredActionClasses, complete: graph.unexploredActionClasses.length === 0,
    provenance });
}

export function evaluateReplayGraph(graphInput, contract, edgeRefs) {
  const graph = validateReplayGraphRevision(graphInput);
  if (!contract || typeof contract !== "object" || Array.isArray(contract)
    || !graph.startNodeRefs.includes(contract.startNodeRef) || !Array.isArray(contract.goalNodeRefs)
    || contract.goalNodeRefs.some((ref) => !graph.nodes.some((node) => node.nodeRef === ref))
    || !Array.isArray(contract.forbiddenEdgeRefs) || !Number.isInteger(contract.stepBudget)
    || contract.stepBudget < 1 || contract.stepBudget > 10000 || !Array.isArray(edgeRefs)) {
    throw replayGraphError("REPLAY_GRAPH_EVALUATION_INVALID", "world evaluation contract is invalid");
  }
  const edges = new Map(graph.edges.map((edge) => [edge.edgeRef, edge]));
  const forbidden = new Set(contract.forbiddenEdgeRefs);
  let currentNodeRef = contract.startNodeRef;
  const path = [];
  let terminal = contract.goalNodeRefs.includes(currentNodeRef) ? "goalReached" : "budgetExhausted";
  let forbiddenSelected = false;
  for (const edgeRef of edgeRefs.slice(0, contract.stepBudget)) {
    const edge = edges.get(edgeRef);
    if (!edge || edge.sourceNodeRef !== currentNodeRef) { terminal = "edgeMissing"; break; }
    forbiddenSelected ||= forbidden.has(edgeRef);
    path.push(edgeRef);
    currentNodeRef = edge.targetNodeRef;
    terminal = contract.goalNodeRefs.includes(currentNodeRef) ? "goalReached" : "budgetExhausted";
    if (terminal === "goalReached" || forbiddenSelected) break;
  }
  const body = { graphId: graph.graphId, rootSha256: graph.rootSha256, terminal,
    forbiddenSelected, currentNodeRef, path };
  return frozenClone({ ...body, verdictSha256: replayGraphDigest(body) });
}

export function retainedReplayGraphObjects(graphInput, pinnedNodeRefs = []) {
  const graph = validateReplayGraphRevision(graphInput);
  const nodes = new Set([...graph.startNodeRefs, ...pinnedNodeRefs]);
  if ([...nodes].some((ref) => !graph.nodes.some((node) => node.nodeRef === ref))) {
    throw replayGraphError("REPLAY_GRAPH_RETENTION_INVALID", "pinned node is unavailable");
  }
  const edges = new Set();
  const artifacts = new Set();
  const queue = [...nodes];
  while (queue.length) {
    const source = queue.shift();
    for (const edge of graph.edges.filter((candidate) => candidate.sourceNodeRef === source)) {
      edges.add(edge.edgeRef);
      for (const artifactRef of edge.artifactRefs) artifacts.add(artifactRef);
      if (!nodes.has(edge.targetNodeRef)) { nodes.add(edge.targetNodeRef); queue.push(edge.targetNodeRef); }
    }
  }
  return frozenClone({ nodeRefs: [...nodes].sort(), edgeRefs: [...edges].sort(), artifactRefs: [...artifacts].sort(),
    digest: replayGraphDigest({ nodeRefs: [...nodes].sort(), edgeRefs: [...edges].sort(), artifactRefs: [...artifacts].sort() }) });
}

export function replayWorldCanonical(value) { return canonicalReplayGraphJson(value); }
