export const KERNEL_ENGINE_MANIFEST_PROTOCOL: "pyproc.kernel-engine-manifest";
export const KERNEL_ENGINE_MANIFEST_VERSION: 1;

export interface KernelEngineArtifact {
  readonly url: string;
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
}

export interface KernelThreadCapability {
  readonly protocol: "pyproc.thread-capability";
  readonly version: 1;
  readonly mode: "worker-processes" | "shared-memory";
  readonly pythonImplementation: string;
  readonly pythonThreadCreation: boolean;
  readonly sharedWasmMemory: boolean;
  readonly wasiThreadSpawn: boolean;
  readonly failure: Readonly<{ pythonType: string; message: string }> | null;
}

export interface KernelEngineManifest {
  readonly protocol: "pyproc.kernel-engine-manifest";
  readonly version: 1;
  readonly digest: `sha256:${string}`;
  readonly engineId: string;
  readonly environmentId: string;
  readonly runtimeKind: "cpython-wasi";
  readonly target: "wasm32-wasip1";
  readonly pythonVersion: string;
  readonly nativeProfile: string;
  readonly stdlibDir: string;
  readonly artifacts: Readonly<{ wasm: KernelEngineArtifact; stdlib: KernelEngineArtifact }>;
  readonly buildManifestSha256: `sha256:${string}` | null;
  readonly threading: KernelThreadCapability;
}

export function createKernelEngineManifest(input: Omit<KernelEngineManifest,
  "protocol" | "version" | "digest">): Promise<KernelEngineManifest>;
export function verifyKernelEngineManifest(value: unknown): Promise<KernelEngineManifest>;

export class MemoryKernelAssetStore {
  put(expectedDigest: `sha256:${string}`, bytes: ArrayBuffer | Uint8Array): Promise<Readonly<{ sha256: string; byteLength: number }>>;
  has(digest: string): boolean;
  get(digest: string): Uint8Array;
  inspect(): ReadonlyArray<Readonly<{ sha256: string; byteLength: number }>>;
}
