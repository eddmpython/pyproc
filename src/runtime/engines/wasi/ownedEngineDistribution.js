// ownedEngineDistribution.js - Layer 0: installed owned CPython WASI artifact identity.
import { createKernelEngineManifest } from "../../kernel/engineManifest.js";

export const DEFAULT_KERNEL_ENGINE_ID = "cpython-wasi-3.14.6-pyproc-host-1";
export const DATA_KERNEL_ENGINE_ID = "cpython-wasi-3.14.6-pyproc-data-3";
// SHA-256 of the ordered base environment descriptor enforced by the kernel factory contract.
export const DEFAULT_KERNEL_ENVIRONMENT_ID = "sha256:6a0b4d46d7fe45669860e0964e9fb9114ce1eacace5e381b5d6fb2e7112a2534";
export const DATA_KERNEL_ENVIRONMENT_ID = "sha256:3b8d0a01cb77cd565a0c296daaa7ce43c97427292b7668008ef001813b2399c7";

const THREADING = Object.freeze({
  protocol:"pyproc.thread-capability",
  version:1,
  mode:"worker-processes",
  pythonImplementation:"pthread-stubs",
  pythonThreadCreation:false,
  sharedWasmMemory:false,
  wasiThreadSpawn:false,
  failure:Object.freeze({ pythonType:"RuntimeError", message:"can't start new thread" }),
});

const CORE = Object.freeze({
  engineId: DEFAULT_KERNEL_ENGINE_ID,
  environmentId: DEFAULT_KERNEL_ENVIRONMENT_ID,
  runtimeKind: "cpython-wasi",
  target: "wasm32-wasip1",
  pythonVersion: "3.14.6",
  nativeProfile: "core",
  stdlibDir: "python3.14",
  artifacts: Object.freeze({
    wasm: Object.freeze({ path: "./owned/core/python.wasm",
      sha256: "sha256:9cf100f0ee12eb0cbce3396f1649f3cd26e17d482dc2ac982fce3d7927d2081d",
      byteLength: 7731137 }),
    stdlib: Object.freeze({ path: "./owned/core/python314-stdlib.zip",
      sha256: "sha256:297e22960319563421b9dcbed67dc7c43e42e456fcc01447ceb4de335ce5a236",
      byteLength: 2773481 }),
  }),
  buildManifestSha256: "sha256:9df4d7cdacdfb47a29abaf2f5cbaecb55aed6f6f25573147830835be594d054c",
  threading: THREADING,
});

const DATA = Object.freeze({
  engineId: DATA_KERNEL_ENGINE_ID,
  environmentId: DATA_KERNEL_ENVIRONMENT_ID,
  runtimeKind: "cpython-wasi",
  target: "wasm32-wasip1",
  pythonVersion: "3.14.6",
  nativeProfile: "data",
  stdlibDir: "python3.14",
  artifacts: Object.freeze({
    wasm: Object.freeze({ path: "./owned/data/python.wasm",
      sha256: "sha256:42869426bd18a19004fe7244f2260144c4a217680f7dbcbc2c6302277826644e",
      byteLength: 17606733 }),
    stdlib: Object.freeze({ path: "./owned/data/python314-stdlib.zip",
      sha256: "sha256:ce468413329cdc90d2ba26c90f915b1b11126ea4f4351a81d31a9fd668d53ded",
      byteLength: 2773525 }),
  }),
  buildManifestSha256: "sha256:e8d930b00025d985cca9ee05a6c43aa0762a1f1a0cbcdbd435f9bdb4cff795e5",
  threading: THREADING,
});

let coreManifestPromise = null;
let dataManifestPromise = null;

function manifestFor(distribution) {
  return createKernelEngineManifest({
    ...distribution,
    artifacts: {
      wasm: { url: new URL(distribution.artifacts.wasm.path, import.meta.url).href,
        sha256: distribution.artifacts.wasm.sha256, byteLength: distribution.artifacts.wasm.byteLength },
      stdlib: { url: new URL(distribution.artifacts.stdlib.path, import.meta.url).href,
        sha256: distribution.artifacts.stdlib.sha256, byteLength: distribution.artifacts.stdlib.byteLength },
    },
  });
}

export function inspectDefaultKernelEngineDistribution() {
  return CORE;
}

export function inspectDataKernelEngineDistribution() {
  return DATA;
}

export function getDefaultKernelEngineManifest() {
  if (!coreManifestPromise) coreManifestPromise = manifestFor(CORE);
  return coreManifestPromise;
}

export function getDataKernelEngineManifest() {
  if (!dataManifestPromise) dataManifestPromise = manifestFor(DATA);
  return dataManifestPromise;
}
