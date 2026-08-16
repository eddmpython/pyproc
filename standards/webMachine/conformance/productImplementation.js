// 공개 제품 표면만 연결하는 Web Machine Core v1 conformance binding이다.
import {
  WebMachineHost,
  createWebMachineManifest,
  createWebMachineManifestContent,
} from "../../../src/machine/index.js";

function fixtureGuest({ options, metrics, deferred }) {
  let value = Number(options.initialValue || 0);
  return {
    capabilities: {
      adapterVersion: "1",
      snapshotScope: options.snapshotScope || "portable",
      pauseMode: "strong",
      shutdownMode: "terminate",
      requiredDevices: options.requiredDevices || [],
    },
    async boot() { metrics.boots += 1; },
    async pause() {},
    async resume() {},
    async snapshot() { return new TextEncoder().encode(JSON.stringify({ value })); },
    async restore(payload) { value = JSON.parse(new TextDecoder().decode(payload)).value; },
    async shutdown() {},
    async request(message) {
      if (message.type === "get") return value;
      if (message.type === "increment") {
        metrics.executions += 1;
        value += Number(message.by || 1);
        return value;
      }
      if (message.type === "deferredIncrement") {
        metrics.executions += 1;
        value += Number(message.by || 1);
        deferred.started();
        await deferred.wait;
        return value;
      }
      throw new TypeError("unsupported fixture request");
    },
    inspect() { return { value }; },
  };
}

function createProductFixture(options = {}) {
  const metrics = { boots: 0, executions: 0 };
  let startedResolve;
  let releaseResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const wait = new Promise((resolve) => { releaseResolve = resolve; });
  const adapterFactory = () => {
    const adapter = fixtureGuest({ options, metrics, deferred: { started: startedResolve, wait } });
    if (options.missingMethod) delete adapter[options.missingMethod];
    return adapter;
  };
  let instanceSequence = 0;
  const makeHost = () => new WebMachineHost({
    devices: options.devices || { console: { kind: "console" } },
    idFactory: () => `product-${++instanceSequence}`,
  }).registerAdapter("fixture", adapterFactory);
  const createMachine = (host = makeHost()) => host.createMachine({
    machineId: "machine",
    adapterId: "fixture",
    manifest: { initialValue: options.initialValue || 0 },
    permissions: { devices: options.permissions || [] },
  });
  return {
    machine: createMachine(),
    metrics,
    waitForDeferredStart: () => started,
    releaseDeferred: () => releaseResolve(),
    createColdMachine: () => createMachine(),
    normalizeImageContent: createWebMachineManifestContent,
    createSignedImage: createWebMachineManifest,
  };
}

export function createProductConformanceFactory() {
  return Object.freeze({ createFixture: createProductFixture });
}
