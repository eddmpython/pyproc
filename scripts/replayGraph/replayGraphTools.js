// replayGraphTools.js - ReplayGraph Worlds의 Control/MCP operation과 closed JSON schemas.
import { ReplayGraphCoordinator } from "./replayGraphCoordinator.js";
import { createReplayGraphRegistry } from "./replayGraphRegistry.js";

const DIGEST = Object.freeze({ type: "string", pattern: "^[0-9a-f]{64}$" });
const GRAPH_ID = Object.freeze({ type: "string", pattern: "^graph:[A-Za-z0-9._:-]{1,96}$" });
const NODE_REF = Object.freeze({ type: "string", pattern: "^node:[0-9a-f]{64}$" });
const EDGE_REF = Object.freeze({ type: "string", pattern: "^edge:[0-9a-f]{64}$" });
const WORLD_REF = Object.freeze({ type: "string", pattern: "^world:[0-9a-f]{32}$" });
const PAIR_ID = Object.freeze({ type: "string", pattern: "^pair:[A-Za-z0-9._:-]{1,96}$" });
const RESTORE_REF = Object.freeze({ type: "string", pattern: "^restore:[0-9a-f]{32}$" });
const JSON_OBJECT = Object.freeze({ type: "object" });

export const REPLAY_GRAPH_TOOLS = Object.freeze([
  Object.freeze({ name: "worldImportRecording", description: "Import one sealed Automation Recording as an immutable ReplayGraph chain without inventing state.",
    inputSchema: { type: "object", properties: { graphId: GRAPH_ID, recordingFile: { type: "string", minLength: 1 } },
      required: ["graphId", "recordingFile"], additionalProperties: false } }),
  Object.freeze({ name: "worldCreateApp", description: "Create an immutable ReplayGraph start node from one complete Transactional AppSpace pair.",
    inputSchema: { type: "object", properties: { graphId: GRAPH_ID, pairId: PAIR_ID },
      required: ["graphId", "pairId"], additionalProperties: false } }),
  Object.freeze({ name: "worldCaptureAppBranch", description: "Add one exact AppSpace child transition after consuming its one-shot source restore proof.",
    inputSchema: { type: "object", properties: { graphId: GRAPH_ID, expectedRootSha256: DIGEST,
      sourceNodeRef: NODE_REF, sourcePairId: PAIR_ID, targetPairId: PAIR_ID, restoreRef: RESTORE_REF,
      operation: { type: "string", minLength: 1, maxLength: 128 }, input: JSON_OBJECT,
      terminal: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      risk: { type: "string", enum: ["read", "localMutation"] } },
    required: ["graphId", "expectedRootSha256", "sourceNodeRef", "sourcePairId", "targetPairId",
      "restoreRef", "operation", "input", "terminal"], additionalProperties: false } }),
  Object.freeze({ name: "worldOpen", description: "Open an effect-free cursor at an exact pinned ReplayGraph revision and start node.",
    inputSchema: { type: "object", properties: { graphId: GRAPH_ID, rootSha256: DIGEST, startNodeRef: NODE_REF },
      required: ["graphId", "rootSha256"], additionalProperties: false } }),
  Object.freeze({ name: "worldInspect", description: "Inspect one open ReplayGraph cursor and its exact graph revision.",
    inputSchema: { type: "object", properties: { worldRef: WORLD_REF }, required: ["worldRef"], additionalProperties: false } }),
  Object.freeze({ name: "worldEdges", description: "List exact outgoing edges and issue cursor-bound one-shot traversal capabilities.",
    inputSchema: { type: "object", properties: { worldRef: WORLD_REF }, required: ["worldRef"], additionalProperties: false } }),
  Object.freeze({ name: "worldTraverse", description: "Consume one exact current edge capability without opening a browser or sending the recorded effect.",
    inputSchema: { type: "object", properties: { worldRef: WORLD_REF,
      capabilityRef: { type: "string", pattern: "^worldcap:[0-9a-f]{32}$" }, expectedNodeRef: NODE_REF },
    required: ["worldRef", "capabilityRef", "expectedNodeRef"], additionalProperties: false } }),
  Object.freeze({ name: "worldCheckpoint", description: "Create a digest-bound checkpoint for one open ReplayGraph cursor.",
    inputSchema: { type: "object", properties: { worldRef: WORLD_REF }, required: ["worldRef"], additionalProperties: false } }),
  Object.freeze({ name: "worldRestore", description: "Restore one open cursor from its exact graph-bound checkpoint.",
    inputSchema: { type: "object", properties: { worldRef: WORLD_REF, checkpoint: JSON_OBJECT },
      required: ["worldRef", "checkpoint"], additionalProperties: false } }),
  Object.freeze({ name: "worldEvaluate", description: "Evaluate an edge path with exact goal, forbidden-edge, and step-budget rules.",
    inputSchema: { type: "object", properties: { graphId: GRAPH_ID, rootSha256: DIGEST,
      contract: { type: "object", properties: { startNodeRef: NODE_REF,
        goalNodeRefs: { type: "array", items: NODE_REF, maxItems: 10000 },
        forbiddenEdgeRefs: { type: "array", items: EDGE_REF, maxItems: 10000 },
        stepBudget: { type: "integer", minimum: 1, maximum: 10000 } },
      required: ["startNodeRef", "goalNodeRefs", "forbiddenEdgeRefs", "stepBudget"], additionalProperties: false },
      edgeRefs: { type: "array", items: EDGE_REF, maxItems: 10000 } },
    required: ["graphId", "rootSha256", "contract", "edgeRefs"], additionalProperties: false } }),
  Object.freeze({ name: "worldCoverage", description: "Report reachable nodes, known edges, dead ends, provenance, and explicit unexplored action classes.",
    inputSchema: { type: "object", properties: { worldRef: WORLD_REF }, required: ["worldRef"], additionalProperties: false } }),
  Object.freeze({ name: "worldList", description: "List durable ReplayGraph HEAD revisions without opening a world cursor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } }),
]);

export async function createReplayGraphHandlers({ root, importRoots = [], appProduct = null } = {}) {
  const registry = await createReplayGraphRegistry({ root, importRoots,
    appRegistry: appProduct?.registry || null, appCoordinator: appProduct?.coordinator || null });
  const coordinator = new ReplayGraphCoordinator({ registry });
  return Object.freeze({ registry, coordinator, handlers: Object.freeze({
    "world.import.recording": (input) => coordinator.importRecording(input),
    "world.create.app": (input) => coordinator.createAppWorld(input),
    "world.capture.app.branch": (input) => coordinator.captureAppBranch(input),
    "world.open": (input) => coordinator.open(input),
    "world.inspect": (input) => coordinator.inspect(input),
    "world.edges": (input) => coordinator.edges(input),
    "world.traverse": (input) => coordinator.traverse(input),
    "world.checkpoint": (input) => coordinator.checkpoint(input),
    "world.restore": (input) => coordinator.restore(input),
    "world.evaluate": (input) => coordinator.evaluate(input),
    "world.coverage": (input) => coordinator.coverage(input),
    "world.list": () => coordinator.list(),
  }) });
}
