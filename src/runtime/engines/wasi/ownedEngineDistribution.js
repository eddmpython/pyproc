// ownedEngineDistribution.js - Layer 0: installed owned CPython WASI artifact identity.
import { createKernelEngineManifest } from "../../kernel/engineManifest.js";

export const DEFAULT_KERNEL_ENGINE_ID = "cpython-wasi-3.14.6-pyproc-host-1";
export const DATA_KERNEL_ENGINE_ID = "cpython-wasi-3.14.6-pyproc-data-2";
// SHA-256 of the ordered base environment descriptor enforced by the kernel factory contract.
export const DEFAULT_KERNEL_ENVIRONMENT_ID = "sha256:6a0b4d46d7fe45669860e0964e9fb9114ce1eacace5e381b5d6fb2e7112a2534";
export const DATA_KERNEL_ENVIRONMENT_ID = "sha256:88b292d1060cfbd9079c390334483cdb2d2d23cca27a22e410aa2ea9e7790f10";

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
  buildManifestSha256: "sha256:ca8f61b32b89af2fcd56a0534c1bf29ad19f41e219ee73bb6ef81876bb363f14",
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
      sha256: "sha256:645a8b8c9a4eaf8a8de2132edfeac2b12af7b2df4a71de3fdd9973cba5db62c7",
      byteLength: 7736600 }),
    stdlib: Object.freeze({ path: "./owned/data/python314-stdlib.zip",
      sha256: "sha256:ce468413329cdc90d2ba26c90f915b1b11126ea4f4351a81d31a9fd668d53ded",
      byteLength: 2773525 }),
  }),
  buildManifestSha256: "sha256:81cfee69313ef1d0c77b1fcbc73b46ff3aa4a4470ef16ec54f47d998cd8a0953",
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
