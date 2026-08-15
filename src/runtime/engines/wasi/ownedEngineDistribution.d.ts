import type { KernelEngineManifest } from "../../kernel/engineManifest.js";

export const DEFAULT_KERNEL_ENGINE_ID: "cpython-wasi-3.14.6-pyproc-host-1";
export const DEFAULT_KERNEL_ENVIRONMENT_ID: `sha256:${string}`;
export function inspectDefaultKernelEngineDistribution(): Readonly<{
  engineId: typeof DEFAULT_KERNEL_ENGINE_ID;
  environmentId: typeof DEFAULT_KERNEL_ENVIRONMENT_ID;
  runtimeKind: "cpython-wasi";
  target: "wasm32-wasip1";
  pythonVersion: "3.14.6";
  nativeProfile: "core";
  stdlibDir: "python3.14";
  artifacts: Readonly<Record<"wasm" | "stdlib", Readonly<{
    path: string;
    sha256: `sha256:${string}`;
    byteLength: number;
  }>>>;
  buildManifestSha256: `sha256:${string}`;
}>;
export function getDefaultKernelEngineManifest(): Promise<KernelEngineManifest>;
