// ownedEngineDistribution.js - Layer 0: installed owned CPython WASI artifact identity.
import { createKernelEngineManifest } from "../../kernel/engineManifest.js";

export const DEFAULT_KERNEL_ENGINE_ID = "cpython-wasi-3.14.6-pyproc-host-1";
// SHA-256 of the ordered base environment descriptor enforced by the kernel factory contract.
export const DEFAULT_KERNEL_ENVIRONMENT_ID = "sha256:6a0b4d46d7fe45669860e0964e9fb9114ce1eacace5e381b5d6fb2e7112a2534";

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
