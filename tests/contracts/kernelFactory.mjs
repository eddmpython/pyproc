import { readFile } from "node:fs/promises";

import { KernelFactory, KERNEL_MACHINE_IMAGE_PROTOCOL,
  KERNEL_MACHINE_IMAGE_VERSION, verifyKernelMachineImage } from "../../src/composition/kernelFactory.js";
import { KernelSession } from "../../src/session/kernelSession.js";
import { KernelProcess, KernelProcessManager } from "../../src/processOs/kernelProcess.js";
import { createKernelEngineManifest, MemoryKernelAssetStore,
  verifyKernelEngineManifest } from "../../src/runtime/kernel/engineManifest.js";
import { DEFAULT_KERNEL_ENGINE_ID, getDefaultKernelEngineManifest,
  inspectDefaultKernelEngineDistribution } from "../../src/runtime/engines/wasi/ownedEngineDistribution.js";
import { encodeValueEnvelope } from "../../src/runtime/kernel/valueEnvelope.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectsCode(fn, code) {
  let actual = null;
  try { await fn(); }
  catch (error) { actual = error?.code || String(error); }
  assert(actual === code, `expected ${code}, got ${actual}`);
}

function fakeKernel() {
  const values = new Map();
  let closed = false;
  return {
    runtimeContractVersion: 2,
    runtimeKind: "cpython-wasi",
    async describe() { return { runtimeContractVersion: 2, runtimeKind: "cpython-wasi",
      engineId: "fake", environmentId: "fake-env", workerOwned: true, directHeapAccess: false }; },
    async execute({ code }) { return { state: "completed", stdout: [{ stream: "stdout", text: code }],
      stderr: [], timing: { durationMs: 0 } }; },
    async getValue({ name }) { return { value: await encodeValueEnvelope(values.get(name)) }; },
    async setValue({ name, value }) { values.set(name, value); return { state: "completed" }; },
    async close() { closed = true; return { state: "closed" }; },
    get closed() { return closed; },
  };
}

export async function assertKernelFactory() {
  const bytes = new TextEncoder().encode("owned-engine");
  const digest = `sha256:${"8f52ed73ae9d82d93392fd4df998bcc00c0f8032e589008b328932554725a2f8"}`;
  const store = new MemoryKernelAssetStore();
  await rejectsCode(() => store.put(digest, bytes), "PYPROC_ASSET_INTEGRITY");

  const actualDigest = `sha256:${await globalThis.crypto.subtle.digest("SHA-256", bytes)
    .then((value) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join(""))}`;
  await store.put(actualDigest, bytes);
  assert(store.has(actualDigest) && store.get(actualDigest).byteLength === bytes.byteLength,
    "kernel asset store did not verify and copy exact bytes");

  const manifest = await createKernelEngineManifest({ engineId: "engine:test", environmentId: actualDigest,
    runtimeKind: "cpython-wasi", target: "wasm32-wasip1", pythonVersion: "3.14.6",
    nativeProfile: "core", stdlibDir: "python3.14", artifacts: {
      wasm: { url: "/python.wasm", sha256: actualDigest, byteLength: bytes.byteLength },
      stdlib: { url: "/stdlib.zip", sha256: actualDigest, byteLength: bytes.byteLength },
    }, buildManifestSha256: actualDigest });
  assert((await verifyKernelEngineManifest(manifest)).digest === manifest.digest,
    "kernel engine manifest did not round-trip");
  await rejectsCode(() => verifyKernelEngineManifest({ ...manifest, engineId: "engine:tampered" }),
    "PYPROC_ASSET_INTEGRITY");

  const installedManifest = await getDefaultKernelEngineManifest();
  const installedDistribution = inspectDefaultKernelEngineDistribution();
  assert(installedManifest.engineId === DEFAULT_KERNEL_ENGINE_ID
    && installedManifest.nativeProfile === "core"
    && installedManifest.artifacts.wasm.byteLength === installedDistribution.artifacts.wasm.byteLength
    && installedManifest.artifacts.stdlib.byteLength === installedDistribution.artifacts.stdlib.byteLength
    && installedManifest.artifacts.wasm.url.endsWith("/owned/core/python.wasm")
    && installedManifest.artifacts.stdlib.url.endsWith("/owned/core/python314-stdlib.zip"),
  "installed owned kernel distribution identity drifted");

  const opened = [];
  const fakeFactory = { async open() { const kernel = fakeKernel(); opened.push(kernel); return kernel; } };
  const manager = new KernelProcessManager(fakeFactory, { openSession: KernelSession.open });
  const { process } = await manager.spawn(manifest, { pid: "contract-process" });
  const execution = await process.execute("contract-output");
  const waited = await process.wait();
  assert(execution.output === "contract-output" && waited.state === "exited" && waited.exitCode === 0,
    "kernel process execution and wait terminal truth drifted");
  await manager.close();
  assert(opened[0].closed, "kernel process manager did not close an exited worker");

  const sourcePaths = [
    "../../src/composition/kernelFactory.js",
    "../../src/session/kernelSession.js",
    "../../src/processOs/kernelProcess.js",
    "../../src/machine/composition/kernelMachine.js",
  ];
  const sources = await Promise.all(sourcePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert(sources.every((source) => !/ensureEngineScript/u.test(source)),
    "migrated session, process, or Machine path contains a direct engine loader");
  assert(sources[0].includes("verifyKernelEngineManifest") && sources[0].includes("materializeKernelCheckpoint")
    && sources[0].includes("offline") && sources[3].includes("KernelProcessManager"),
  "KernelFactory migration source contract is incomplete");

  assert(typeof KernelFactory === "function", "KernelFactory export is missing");
  assert(typeof verifyKernelMachineImage === "function", "kernel Machine image verifier export is missing");
  assert(typeof KernelProcess === "function", "KernelProcess implementation is missing");
  assert(KERNEL_MACHINE_IMAGE_PROTOCOL === "pyproc.kernel-machine-image"
    && KERNEL_MACHINE_IMAGE_VERSION === 1, "kernel Machine image protocol export drifted");

  const rootSource = await readFile(new URL("../../index.js", import.meta.url), "utf8");
  assert(rootSource.includes("bootDefaultKernelMachine") && rootSource.includes("openDefaultKernelMachineImage")
    && !rootSource.includes("engine ==="),
  "root installed owned default contract drifted");
}
