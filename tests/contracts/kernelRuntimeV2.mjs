import { readFile } from "node:fs/promises";

import { PyProcError } from "../../src/runtime/errors.js";
import { CpythonWasiKernelRuntime } from "../../src/runtime/kernel/cpythonWasiKernel.js";
import { assertKernelRuntimeContract } from "../../src/runtime/kernel/kernelRuntimeContract.js";
import { decodeValueEnvelope } from "../../src/runtime/kernel/valueEnvelope.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

class FakeWasiSession {
  constructor() {
    this.values = new Map();
    this.snapshots = [];
    this.listeners = new Set();
    this.runCount = 0;
    this.activeRuns = 0;
    this.maxActiveRuns = 0;
    this.blockers = [];
  }

  async run(code) {
    this.runCount += 1;
    this.activeRuns += 1;
    this.maxActiveRuns = Math.max(this.maxActiveRuns, this.activeRuns);
    try {
      if (code === "fail") throw new PyProcError("PYPROC_WORKER_TASK_ERROR", "synthetic Python failure");
      if (code === "block") await new Promise((resolve, reject) => this.blockers.push({ resolve, reject }));
      return code.startsWith("print:") ? code.slice(6) : "";
    } finally {
      this.activeRuns -= 1;
    }
  }

  async get(name) { return this.values.get(name); }
  async set(name, value) { this.values.set(name, structuredClone(value)); }
  async checkpoint() {
    this.snapshots.push(structuredClone([...this.values]));
    const page = new Uint8Array(65536);
    page[0] = this.snapshots.length;
    return { idx: this.snapshots.length - 1, mb: 0.0625, snapshotKind: "full",
      parentIdx: null, deltaDepth: 0, stackBoundary: 0, initialPages: 1, currentPages: 1,
      memoryBytes: 65536, regionBytes: 65536, changedPages: 1, pages: [[0, page]] };
  }
  async timeTravel(index) { this.values = new Map(structuredClone(this.snapshots[index])); }
  async installWheel(bytes) { return { files: 1, names: [`wheel-${bytes.byteLength}`] }; }
  async installEnvironment(request) {
    if (this.failEnvironment) throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "synthetic environment failure");
    return { environmentId: request.environmentId, files: request.wheels.length, names: ["fixture"] };
  }
  onFailure(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  crash() {
    const error = new PyProcError("PYPROC_WORKER_CRASHED", "synthetic worker crash");
    for (const blocker of this.blockers.splice(0)) blocker.reject(error);
    for (const listener of this.listeners) listener(error);
  }
  terminate() { this.crash(); }
  release() { for (const blocker of this.blockers.splice(0)) blocker.resolve(); }
}

export async function assertKernelRuntimeV2() {
  const session = new FakeWasiSession();
  const kernel = assertKernelRuntimeContract(new CpythonWasiKernelRuntime(session, {
    kernelRef: "kernel:test",
    engineId: "engine:test",
  }));
  const descriptorPromise = kernel.describe();
  assert(descriptorPromise instanceof Promise, "KernelRuntimeContract describe is not Promise-first");
  const descriptor = await descriptorPromise;
  assert(descriptor.runtimeContractVersion === 2 && descriptor.workerOwned
    && descriptor.directHeapAccess === false && descriptor.liveObjectProxy === false,
  "KernelRuntimeContract descriptor boundary is incomplete");

  const events = [];
  kernel.onEvent((event) => events.push(event));
  const first = await kernel.execute({ commandId: "same", code: "print:one" });
  const replay = await kernel.execute({ commandId: "same", code: "print:one" });
  assert(first === replay && session.runCount === 1 && first.stdout[0].text === "one",
    "same command replay did not reuse the sealed receipt");
  let conflict = false;
  try { await kernel.execute({ commandId: "same", code: "print:two" }); }
  catch (error) { conflict = error?.context?.kernelCode === "KERNEL_COMMAND_CONFLICT"; }
  assert(conflict, "different canonical input reused the same command ID");
  assert(events.filter((event) => event.commandId === "same").every((event, index) => event.sequence === index + 1),
    "kernel event sequence is not ordered");

  const blocking = kernel.execute({ commandId: "blocking", code: "block" });
  const queued = kernel.execute({ commandId: "queued", code: "print:queued" });
  const queuedFailure = queued.catch((error) => error);
  await waitUntil(() => session.activeRuns === 1, "blocking command was not admitted before cancellation");
  const interrupt = await kernel.interrupt({ targetCommandId: "queued" });
  assert(interrupt.state === "cancelled" && (await queuedFailure)?.context?.kernelCode === "KERNEL_CANCELLED",
    "queued kernel cancellation is not terminally truthful");
  session.release();
  await blocking;
  assert(session.maxActiveRuns === 1, "kernel command queue executed Python concurrently");

  const failed = await kernel.execute({ code: "fail" });
  assert(failed.state === "failed" && failed.error.phase === "execute" && failed.error.retry === "never",
    "kernel execution failure did not use the structured error contract");
  const wheelBytes = new Uint8Array([1, 2, 3]);
  const environmentId = "sha256:" + "b".repeat(64);
  const environment = await kernel.installEnvironment({ environmentId, allowedTags: ["py3-none-any"],
    wheels: [{ filename: "fixture-1.0-py3-none-any.whl", name: "fixture", version: "1.0",
      sha256: "sha256:" + "c".repeat(64), bytes: wheelBytes }] });
  assert(environment.environmentId === environmentId && (await kernel.describe()).environmentId === environmentId,
    "successful package transaction did not advance the kernel environment identity");
  session.failEnvironment = true;
  const environmentFailure = await kernel.installEnvironment({ environmentId: "sha256:" + "d".repeat(64),
    allowedTags: ["py3-none-any"], wheels: [{ filename: "fixture-2.0-py3-none-any.whl",
      name: "fixture", version: "2.0", sha256: "sha256:" + "e".repeat(64), bytes: wheelBytes }] })
    .catch((error) => error);
  assert(environmentFailure.code === "PYPROC_PACKAGE_INTEGRITY"
    && (await kernel.describe()).environmentId === environmentId,
  "failed package transaction changed the active kernel environment identity");
  session.failEnvironment = false;
  await kernel.setValue({ name: "value", value: { count: 1 } });
  const checkpoint = await kernel.checkpoint();
  await kernel.setValue({ name: "value", value: { count: 2 } });
  const restored = await kernel.restore({ checkpointRef: checkpoint.checkpointRef });
  const restoredValue = await decodeValueEnvelope((await kernel.getValue({ name: "value" })).value);
  assert(restored.generation === 1 && restoredValue.count === 1,
    "kernel restore did not advance generation and restore state");
  let stale = false;
  try { await kernel.inspect({ generation: 0 }); }
  catch (error) { stale = error?.code === "PYPROC_STATE_FENCE_STALE"; }
  assert(stale, "stale kernel generation was accepted after restore");

  const crashSession = new FakeWasiSession();
  const crashKernel = new CpythonWasiKernelRuntime(crashSession, { kernelRef: "kernel:crash" });
  const crashedExecution = crashKernel.execute({ code: "block" }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  await waitUntil(() => crashSession.activeRuns === 1, "crash command was not executing before worker failure");
  crashSession.crash();
  const terminal = await crashedExecution;
  assert(terminal.ok && terminal.value.state === "terminated" && terminal.value.error.retry === "newGeneration",
    "active worker crash was reported as a successful or retryable completion");
  const closed = await kernel.close();
  assert(closed.state === "closed" && (await kernel.close()).state === "closed", "kernel close is not idempotent");

  const source = await readFile(new URL("../../src/runtime/kernel/cpythonWasiKernel.js", import.meta.url), "utf8");
  for (const forbidden of ["runSync", "heapU8", "stackSave", "stackRestore", ".raw"]) {
    assert(!source.includes(forbidden), `KernelRuntimeContract v2 consumer contains forbidden direct engine surface: ${forbidden}`);
  }
}
