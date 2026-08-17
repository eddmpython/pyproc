// firstSuccessAssets.js - 첫 성공 경로가 요청하면 안 되는 data 엔진 자산과 기본 core 목록.
import { inspectDefaultKernelEngineDistribution } from "../../src/runtime/engines/wasi/ownedEngineDistribution.js";

export const DATA_ENGINE_ASSET_MARKERS = Object.freeze([
  "owned/data/",
  "numpy-2.5.1",
  "scientific-package",
  "pyproc_native_data",
]);

export function findDataEngineAssets(paths) {
  return [...paths].filter((path) => {
    const text = String(path).replaceAll("\\", "/");
    return DATA_ENGINE_ASSET_MARKERS.some((marker) => text.includes(marker));
  });
}

export function defaultBootEngineAssetPaths() {
  const core = inspectDefaultKernelEngineDistribution();
  if (core.nativeProfile !== "core") {
    throw new Error(`default boot engine profile is ${core.nativeProfile}, not core`);
  }
  return Object.freeze([
    String(core.artifacts.wasm.path).replaceAll("\\", "/"),
    String(core.artifacts.stdlib.path).replaceAll("\\", "/"),
  ]);
}
