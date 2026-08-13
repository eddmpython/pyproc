// replayGraphRegistry.js - recording import, AppSpace branch revision, durable graph HEAD를 조립한다.
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { loadAutomationRecording } from "../automationSpace/automationRecording.js";
import {
  createReplayGraphEdge,
  createReplayGraphRevision,
  replayGraphError,
  replayGraphNodeForPair,
  validateReplayGraphRevision,
} from "./replayGraphCanonical.js";
import { FileReplayGraphStore } from "./fileReplayGraphStore.js";
import { importRecordingToReplayGraph } from "./recordingImporter.js";

function within(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function mergeUnique(values, key) {
  const map = new Map(values.map((value) => [value[key], value]));
  return [...map.values()];
}

export class ReplayGraphRegistry {
  static async open(options = {}) {
    return new ReplayGraphRegistry({ store: await FileReplayGraphStore.open(options.root),
      importRoots: options.importRoots, appRegistry: options.appRegistry, appCoordinator: options.appCoordinator });
  }

  constructor({ store, importRoots = [], appRegistry = null, appCoordinator = null } = {}) {
    if (!(store instanceof FileReplayGraphStore)) throw new TypeError("ReplayGraphRegistry requires its file store");
    this.store = store;
    this.importRoots = Object.freeze(importRoots.map((root) => resolve(root)));
    this.appRegistry = appRegistry;
    this.appCoordinator = appCoordinator;
  }

  async importRecording({ graphId, recordingFile }) {
    const file = await this._importFile(recordingFile);
    if (await this.store.head(graphId)) throw replayGraphError("REPLAY_GRAPH_EXISTS", `ReplayGraph already exists: ${graphId}`);
    const imported = await importRecordingToReplayGraph(await loadAutomationRecording(file), graphId);
    const graph = await this.store.publish(imported.graph, null, imported.artifactBytes);
    return Object.freeze({ graph, source: imported.source });
  }

  async createAppWorld({ graphId, pairId }) {
    this._requireAppSpace();
    if (await this.store.head(graphId)) throw replayGraphError("REPLAY_GRAPH_EXISTS", `ReplayGraph already exists: ${graphId}`);
    const pair = await this.appRegistry.openPair(pairId);
    const node = replayGraphNodeForPair(pair);
    const graph = createReplayGraphRevision({ graphId, parentRootSha256: null,
      startNodeRefs: [node.nodeRef], nodes: [node], edges: [], artifacts: [], unexploredActionClasses: [] });
    return this.store.publish(graph, null);
  }

  async captureAppBranch(input) {
    this._requireAppSpace();
    const current = await this.open(input.graphId, input.expectedRootSha256);
    const sourcePair = await this.appRegistry.openPair(input.sourcePairId);
    const targetPair = await this.appRegistry.openPair(input.targetPairId);
    if (targetPair.parentPairSha256 !== sourcePair.contentSha256) {
      throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "target pair is not a direct child of the source pair");
    }
    const sourceNode = replayGraphNodeForPair(sourcePair);
    const targetNode = replayGraphNodeForPair(targetPair);
    if (input.sourceNodeRef !== sourceNode.nodeRef
      || !current.nodes.some((node) => node.nodeRef === sourceNode.nodeRef)) {
      throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "graph source node does not match the restored pair");
    }
    let restoreProof;
    try { restoreProof = this.appCoordinator.consumeRestoreProof(input.restoreRef, sourcePair.contentSha256); }
    catch (error) {
      throw replayGraphError("REPLAY_GRAPH_SOURCE_UNVERIFIED", "source restore proof is missing, stale, or belongs to another pair", {
        appSpaceCode: error?.code || null,
      });
    }
    const edge = createReplayGraphEdge({ sourceNodeRef: sourceNode.nodeRef, targetNodeRef: targetNode.nodeRef,
      operation: input.operation, input: input.input, terminal: input.terminal, provenance: "transactional",
      effectClass: "none", risk: input.risk || "localMutation", artifactRefs: [],
      transitionProof: { restored: true, restoreRef: restoreProof.restoreRef,
        sourcePairSha256: sourcePair.contentSha256, targetPairSha256: targetPair.contentSha256 } });
    const graph = createReplayGraphRevision({ graphId: current.graphId, parentRootSha256: current.rootSha256,
      startNodeRefs: current.startNodeRefs,
      nodes: mergeUnique([...current.nodes, targetNode], "nodeRef"),
      edges: mergeUnique([...current.edges, edge], "edgeRef"), artifacts: current.artifacts,
      unexploredActionClasses: current.unexploredActionClasses });
    return this.store.publish(graph, input.expectedRootSha256);
  }

  async open(graphId, rootSha256 = null) {
    const graph = rootSha256 ? await this.store.readRoot(rootSha256) : await this.store.head(graphId);
    if (!graph || graph.graphId !== graphId) throw replayGraphError("REPLAY_GRAPH_NOT_FOUND", `ReplayGraph is unavailable: ${graphId}`);
    if (rootSha256 && graph.rootSha256 !== rootSha256) throw replayGraphError("REPLAY_GRAPH_ROOT_MISMATCH", "ReplayGraph root pin differs");
    return validateReplayGraphRevision(graph);
  }

  list() { return this.store.list(); }

  _requireAppSpace() {
    if (!this.appRegistry || !this.appCoordinator) {
      throw replayGraphError("REPLAY_GRAPH_APP_SPACE_UNAVAILABLE", "transactional branch capture requires AppSpace");
    }
  }

  async _importFile(fileInput) {
    if (typeof fileInput !== "string" || !isAbsolute(fileInput) || !this.importRoots.length) {
      throw replayGraphError("REPLAY_GRAPH_IMPORT_DENIED", "recording import requires an absolute permitted file");
    }
    let file;
    try {
      file = await realpath(resolve(fileInput));
      if (!(await lstat(file)).isFile()) throw new Error("not a file");
    } catch (error) { throw replayGraphError("REPLAY_GRAPH_IMPORT_DENIED", "recording import file is unavailable"); }
    const roots = await Promise.all(this.importRoots.map(async (root) => realpath(root).catch(() => null)));
    if (!roots.some((root) => root && within(root, file))) {
      throw replayGraphError("REPLAY_GRAPH_IMPORT_DENIED", "recording import file is outside permitted roots");
    }
    return file;
  }
}

export async function createReplayGraphRegistry(options) { return ReplayGraphRegistry.open(options); }
