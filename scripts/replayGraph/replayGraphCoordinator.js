// replayGraphCoordinator.js - durable graph revision과 effect-free world cursor를 Control 수명주기로 묶는다.
import { ReplayWorld, evaluateReplayGraph } from "./replayWorld.js";
import { replayGraphError } from "./replayGraphCanonical.js";

export class ReplayGraphCoordinator {
  constructor({ registry } = {}) {
    if (!registry) throw new TypeError("ReplayGraphCoordinator requires a registry");
    this.registry = registry;
    this.worlds = new Map();
  }

  importRecording(input) { return this.registry.importRecording(input); }
  createAppWorld(input) { return this.registry.createAppWorld(input); }
  captureAppBranch(input) { return this.registry.captureAppBranch(input); }
  list() { return this.registry.list(); }

  async open(input) {
    const graph = await this.registry.open(input.graphId, input.rootSha256);
    const world = new ReplayWorld(graph, { startNodeRef: input.startNodeRef || null });
    this.worlds.set(world.worldRef, world);
    return Object.freeze({ world: world.inspect(), node: graph.nodes.find((node) => node.nodeRef === world.currentNodeRef) });
  }

  inspect(input) { return this._world(input.worldRef).inspect(); }
  edges(input) { return this._world(input.worldRef).listEdges(); }
  traverse(input) { return this._world(input.worldRef).traverse(input.capabilityRef, input.expectedNodeRef); }
  checkpoint(input) { return this._world(input.worldRef).checkpoint(); }
  restore(input) { return this._world(input.worldRef).restore(input.checkpoint); }
  coverage(input) { return this._world(input.worldRef).coverage(); }

  async evaluate(input) {
    const graph = await this.registry.open(input.graphId, input.rootSha256);
    return evaluateReplayGraph(graph, input.contract, input.edgeRefs);
  }

  _world(worldRef) {
    const world = this.worlds.get(worldRef);
    if (!world) throw replayGraphError("REPLAY_GRAPH_WORLD_NOT_FOUND", `ReplayGraph world is unavailable: ${worldRef}`);
    return world;
  }
}
