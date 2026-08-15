// ownedEngineDistribution.js - Layer 0: installed owned CPython WASI artifact identity.
import { createKernelEngineManifest } from "../../kernel/engineManifest.js";

export const DEFAULT_KERNEL_ENGINE_ID = "cpython-wasi-3.14.6-pyproc-host-1";
export const DEFAULT_KERNEL_ENVIRONMENT_ID = "sha256:841ea023851dcadcdd564de7b57a38af755c7f48c1e7f9315e68625399f6a78f";

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
      sha256: "sha256:ce49c8fa05580b98c11755be2bd2aeac43054cb158757bcce2b20cfe1265411d",
      byteLength: 7731201 }),
    stdlib: Object.freeze({ path: "./owned/core/python314-stdlib.zip",
      sha256: "sha256:be3c2d5802108d0714921153e1e86737fff1e086823630a523663198284eee57",
      byteLength: 2753291 }),
  }),
  buildManifestSha256: "sha256:61d7bbb8bd132a4cc0dfdfe3b4c793f01beb1065b2b0303cca49584d6f9fcab1",
});

let manifestPromise = null;

export function inspectDefaultKernelEngineDistribution() {
  return CORE;
}

export function getDefaultKernelEngineManifest() {
  if (!manifestPromise) {
    manifestPromise = createKernelEngineManifest({
      ...CORE,
      artifacts: {
        wasm: { url: new URL(CORE.artifacts.wasm.path, import.meta.url).href,
          sha256: CORE.artifacts.wasm.sha256, byteLength: CORE.artifacts.wasm.byteLength },
        stdlib: { url: new URL(CORE.artifacts.stdlib.path, import.meta.url).href,
          sha256: CORE.artifacts.stdlib.sha256, byteLength: CORE.artifacts.stdlib.byteLength },
      },
    });
  }
  return manifestPromise;
}
