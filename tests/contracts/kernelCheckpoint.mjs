import { readFile } from "node:fs/promises";

import { CpythonWasiKernelRuntime } from "../../src/runtime/kernel/cpythonWasiKernel.js";
import {
  materializeKernelCheckpoint,
  sealKernelCheckpoint,
  verifyKernelCheckpointDescriptor,
} from "../../src/runtime/kernel/kernelCheckpoint.js";
import { KernelReactiveController } from "../../src/runtime/kernel/kernelReactiveController.js";
import { PyProcError } from "../../src/runtime/errors.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectionOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

class TamperableArtifactStore {
  constructor() { this.objects = new Map(); this.counter = 0; }
  async put(bytes) {
    const artifactRef = `artifact:checkpoint:${++this.counter}`;
    this.objects.set(artifactRef, bytes.slice());
    return { artifactRef };
  }
  async get(ref) {
    const bytes = this.objects.get(ref);
    if (!bytes) throw new Error("missing artifact");
    return bytes.slice();
  }
  corrupt(ref) { this.objects.get(ref)[40] ^= 0xff; }
}

function snapshot({ kind = "full", value = 1, deltaDepth = 0, changed = [0, 1] } = {}) {
  const pages = changed.map((pageIndex) => [pageIndex, new Uint8Array(65536).fill(value + pageIndex)]);
  return { snapshotKind: kind, parentIdx: kind === "delta" ? 0 : null, deltaDepth,
    stackBoundary: 0, initialPages: 2, currentPages: 2, memoryBytes: 131072,
    regionBytes: 131072, changedPages: pages.length, pages };
}

class FakeCheckpointSession {
  constructor() { this.listeners = new Set(); this.values = new Map(); this.snapshots = []; }
  async run() { return ""; }
  async get(name) { return this.values.get(name); }
  async set(name, value) { this.values.set(name, structuredClone(value)); }
  async checkpoint() {
    this.snapshots.push(structuredClone([...this.values]));
    return { ...snapshot({ value: this.snapshots.length }), idx: this.snapshots.length - 1, mb: 0.125 };
  }
  async timeTravel(index) { this.values = new Map(structuredClone(this.snapshots[index])); }
  async installWheel() { return { files: 0, names: [] }; }
  onFailure(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  terminate() {}
}

export async function assertKernelCheckpointContract() {
  const store = new TamperableArtifactStore();
  const descriptors = new Map();
  const context = {
    artifactStore: store,
    engineId: "sha256:" + "a".repeat(64),
    environmentId: "sha256:" + "b".repeat(64),
    executionCursor: 1,
    resolveParent: async (ref) => descriptors.get(ref) || null,
  };
  const full = await sealKernelCheckpoint(snapshot(), context);
  descriptors.set(full.checkpointRef, full);
  const delta = await sealKernelCheckpoint(snapshot({ kind: "delta", value: 9, deltaDepth: 1, changed: [1] }),
    { ...context, executionCursor: 2, parentCheckpointRef: full.checkpointRef });
  descriptors.set(delta.checkpointRef, delta);
  const materialized = await materializeKernelCheckpoint(delta, context);
  assert(materialized.byteLength === 131072 && materialized[0] === 1 && materialized[65536] === 10,
    "kernel checkpoint delta did not materialize over its exact parent");
  assert((await verifyKernelCheckpointDescriptor(delta, context)).image.pages.length === 1,
    "kernel checkpoint verification lost delta page metadata");

  const wrongEngine = await rejectionOf(() => verifyKernelCheckpointDescriptor(delta, { ...context, engineId: "sha256:" + "c".repeat(64) }));
  assert(wrongEngine?.context?.kernelCode === "KERNEL_CHECKPOINT_INCOMPATIBLE",
    "wrong-engine checkpoint was not rejected before restore");
  const missingParent = await sealKernelCheckpoint(snapshot({ kind: "delta", value: 4, deltaDepth: 1, changed: [0] }),
    { ...context, parentCheckpointRef: "checkpoint:missing" });
  assert((await rejectionOf(() => verifyKernelCheckpointDescriptor(missingParent, context)))?.context?.kernelCode === "KERNEL_CHECKPOINT_CORRUPT",
    "delta with a missing parent was accepted");
  store.corrupt(delta.memoryImageRef);
  assert((await rejectionOf(() => verifyKernelCheckpointDescriptor(delta, context)))?.context?.kernelCode === "KERNEL_CHECKPOINT_CORRUPT",
    "corrupted checkpoint delta was accepted");

  const liveStore = new TamperableArtifactStore();
  const session = new FakeCheckpointSession();
  const kernel = new CpythonWasiKernelRuntime(session, {
    kernelRef: "kernel:checkpoint-contract",
    engineId: context.engineId,
    environmentId: context.environmentId,
    artifactStore: liveStore,
  });
  await kernel.setValue({ name: "state", value: { count: 1 } });
  const checkpoint = await kernel.checkpoint();
  await kernel.setValue({ name: "state", value: { count: 2 } });
  const incompatibleDescriptor = { ...checkpoint, engineId: "sha256:" + "d".repeat(64) };
  const rejected = await rejectionOf(() => kernel.restore({ checkpointRef: checkpoint.checkpointRef,
    checkpoint: incompatibleDescriptor }));
  assert(rejected?.context?.kernelCode === "KERNEL_CHECKPOINT_INCOMPATIBLE"
    && (await kernel.describe()).generation === 0,
  "failed candidate restore changed the active kernel generation");
  liveStore.corrupt(checkpoint.memoryImageRef);
  const corruptRestore = await rejectionOf(() => kernel.restore({ checkpointRef: checkpoint.checkpointRef }));
  assert(corruptRestore?.context?.kernelCode === "KERNEL_CHECKPOINT_CORRUPT"
    && (await kernel.describe()).generation === 0,
  "corrupt restore changed the active kernel generation");
  await kernel.close();

  const busyKernel = new CpythonWasiKernelRuntime(new FakeCheckpointSession(), {
    kernelRef: "kernel:busy",
    engineId: context.engineId,
    environmentId: context.environmentId,
    checkpointCoordinator: { async inspectCheckpointBoundary() {
      return { acceptedHostcalls: 1, activeTransactions: 0, outputDrained: true, openResources: [] };
    } },
  });
  const busy = await rejectionOf(() => busyKernel.checkpoint());
  assert(busy?.context?.kernelCode === "KERNEL_CHECKPOINT_BUSY", "checkpoint accepted an in-flight hostcall boundary");
  await busyKernel.close();

  let serial = 0;
  const reactiveKernel = {
    runtimeContractVersion: 2,
    async checkpoint(request) {
      const checkpointRef = `checkpoint:reactive:${++serial}`;
      return { checkpointRef, parentCheckpointRef: request.parentCheckpointRef };
    },
    async restore(request) { return { state: "completed", checkpointRef: request.checkpointRef }; },
  };
  const reactive = new KernelReactiveController(reactiveKernel);
  const root = await reactive.checkpoint();
  const child = await reactive.checkpoint();
  reactive.branch(root.checkpointRef);
  const sibling = await reactive.checkpoint();
  await reactive.restore(child.checkpointRef);
  assert(child.parentCheckpointRef === root.checkpointRef && sibling.parentCheckpointRef === root.checkpointRef
    && reactive.inspect().headCheckpointRef === child.checkpointRef,
  "worker-owned reactive checkpoint graph lost branch or restore identity");

  const reactiveSource = await readFile(new URL("../../src/runtime/kernel/kernelReactiveController.js", import.meta.url), "utf8");
  for (const forbidden of ["heapU8", "stackSave", "stackRestore", "WebAssembly.Memory", "_module"]) {
    assert(!reactiveSource.includes(forbidden), `v2 reactive consumer reads engine memory directly: ${forbidden}`);
  }
}
