import { readFile } from "node:fs/promises";

import { AsgiServer } from "../../src/capabilities/asgiServer.js";
import {
  ApplicationReferenceTable,
  assertApplicationReference,
} from "../../src/runtime/kernel/applicationReference.js";
import {
  MemoryValueArtifactStore,
  canonicalValueEnvelope,
  decodeValueEnvelope,
  digestValueEnvelope,
  encodeValueEnvelope,
} from "../../src/runtime/kernel/valueEnvelope.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectionOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

export async function assertValueEnvelopeContract() {
  const bytes = new Uint8Array([0, 1, 2, 127, 255]);
  const value = {
    nil: null,
    bool: true,
    number: 1.25,
    bigint: 9007199254740993n,
    string: "값🙂",
    bytes,
    list: [false, 0, "x"],
  };
  const encoded = await encodeValueEnvelope(value);
  const decoded = await decodeValueEnvelope(encoded);
  assert(decoded.nil === null && decoded.bool === true && decoded.number === 1.25
    && decoded.bigint === 9007199254740993n && decoded.string === "값🙂"
    && decoded.bytes instanceof Uint8Array && decoded.bytes.every((entry, index) => entry === bytes[index])
    && decoded.list.join(",") === "false,0,x", "ValueEnvelope type matrix did not round-trip");

  const left = await encodeValueEnvelope({ z: 1, "é": 2, a: 3 });
  const right = await encodeValueEnvelope({ a: 3, z: 1, "é": 2 });
  assert(JSON.stringify(canonicalValueEnvelope(left)) === JSON.stringify(canonicalValueEnvelope(right))
    && await digestValueEnvelope(left) === await digestValueEnvelope(right),
  "ValueEnvelope map digest depends on insertion order");

  for (const [label, fixture, expectedKernelCode] of [
    ["NaN", Number.NaN, "KERNEL_VALUE_INVALID"],
    ["infinity", Number.POSITIVE_INFINITY, "KERNEL_VALUE_INVALID"],
    ["function", () => {}, "KERNEL_VALUE_INVALID"],
    ["depth", { a: { b: { c: 1 } } }, "KERNEL_VALUE_LIMIT"],
  ]) {
    const error = await rejectionOf(() => encodeValueEnvelope(fixture,
      label === "depth" ? { limits: { maxDepth: 1 } } : {}));
    assert(error?.context?.kernelCode === expectedKernelCode, `${label} fixture was not rejected by the stable value code`);
  }
  const cycle = {}; cycle.self = cycle;
  const shared = {}; const aliased = { a: shared, b: shared };
  assert((await rejectionOf(() => encodeValueEnvelope(cycle)))?.context?.kernelCode === "KERNEL_VALUE_INVALID",
    "ValueEnvelope accepted a cycle");
  assert((await rejectionOf(() => encodeValueEnvelope(aliased)))?.context?.kernelCode === "KERNEL_VALUE_INVALID",
    "ValueEnvelope accepted shared object identity");

  const artifactStore = new MemoryValueArtifactStore();
  const large = new Uint8Array(70 * 1024).fill(29);
  const spilled = await encodeValueEnvelope(large, { artifactStore });
  const restored = await decodeValueEnvelope(spilled, { artifactStore });
  assert(spilled.kind === "artifact" && restored.byteLength === large.byteLength && restored[0] === 29,
    "large ValueEnvelope bytes did not spill and restore through content-addressed storage");
  const unavailable = await rejectionOf(() => decodeValueEnvelope(spilled, { artifactStore: new MemoryValueArtifactStore() }));
  assert(unavailable?.context?.kernelCode === "KERNEL_VALUE_ARTIFACT_MISSING",
    "missing ValueEnvelope artifact was not rejected");

  const table = new ApplicationReferenceTable({ kernelRef: "kernel:value", generation: 4 });
  const reference = table.register({ type: "asgi", name: "app", operations: ["dispatch"] });
  const cloned = structuredClone(reference);
  assert(table.resolve(cloned, { type: "asgi", operation: "dispatch" }).name === "app",
    "structured-cloned application reference could not be resolved");
  table.advanceGeneration(5);
  const stale = await rejectionOf(async () => table.resolve(cloned, { operation: "dispatch" }));
  assert(stale?.context?.kernelCode === "KERNEL_APPLICATION_REF_STALE",
    "application reference survived a generation change");
  assertApplicationReference(reference, { kernelRef: "kernel:value", generation: 4, type: "asgi" });

  let getGlobalCalls = 0;
  const fakeReference = new ApplicationReferenceTable({ kernelRef: "kernel:asgi", generation: 0 })
    .register({ type: "asgi", name: "_pyprocAsgiCall", operations: ["dispatch"] });
  const fakeKernel = {
    runtimeContractVersion: 2,
    async execute() { return { state: "completed" }; },
    async registerApplication() { return { applicationRef: fakeReference }; },
    async invokeApplication(request) {
      assert(request.applicationRef === fakeReference && request.operation === "dispatch",
        "ASGI v2 did not invoke its registered application reference");
      return { value: await encodeValueEnvelope(JSON.stringify({ status: 201, headers: [["x-value", "ref"]], bodyB64: "b2s=" })) };
    },
    getGlobal() { getGlobalCalls += 1; throw new Error("live proxy access"); },
  };
  const asgi = new AsgiServer(fakeKernel, { app: "app" });
  const installed = await asgi.install();
  const response = await asgi.serve("GET", "/ref");
  assert(installed.transport === "kernel-application-ref" && response.status === 201
    && response.body === "ok" && getGlobalCalls === 0,
  "ASGI v2 retained or invoked a live Python proxy");

  for (const path of [
    "../../src/runtime/kernel/valueEnvelope.js",
    "../../src/runtime/kernel/applicationReference.js",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const forbidden of ["new Proxy(", ".getGlobal("]) {
      assert(!source.includes(forbidden), `M3 kernel value path contains live proxy surface: ${forbidden}`);
    }
  }
  const wasiSessionSource = await readFile(
    new URL("../../src/runtime/engines/wasi/wasiSession.js", import.meta.url), "utf8");
  assert(wasiSessionSource.includes("if state is None:\n        state = {\"seen\": set()"),
    "WASI Python ValueEnvelope helper lost the state initialization block indentation");
}
