import type { HostCapabilityBroker } from "../capabilities/hostCapabilityBroker.js";
import type { KernelCheckpointCoordinator, KernelCheckpointDescriptor, KernelRuntimeContractV2,
  KernelPackageEnvironmentBootstrap, KernelVfs, MemoryValueArtifactStore } from "../runtime/kernel/index.js";
import type { KernelEngineManifest, MemoryKernelAssetStore } from "../runtime/kernel/engineManifest.js";

export const KERNEL_MACHINE_IMAGE_PROTOCOL: "pyproc.kernel-machine-image";
export const KERNEL_MACHINE_IMAGE_VERSION: 1;

export interface KernelPackageEnvironmentImage {
  readonly protocol: "pyproc.package-environment-bootstrap";
  readonly version: 1;
  readonly environmentId: `sha256:${string}`;
  readonly lockDigest: `sha256:${string}` | null;
  readonly policyDigest: `sha256:${string}` | null;
  readonly allowedTags: readonly string[];
  readonly limits: Readonly<Record<string, number>> | null;
  readonly wheels: readonly Readonly<{ filename: string; name: string; version: string;
    sha256: `sha256:${string}`; byteLength: number; base64: string }>[];
}

export interface KernelMachineImage {
  readonly protocol: "pyproc.kernel-machine-image";
  readonly version: 1;
  readonly digest: `sha256:${string}`;
  readonly engineManifest: KernelEngineManifest;
  readonly packageEnvironment?: KernelPackageEnvironmentImage | null;
  readonly checkpointRef: string;
  readonly checkpoints: readonly KernelCheckpointDescriptor[];
  readonly checkpointObjects: ReadonlyArray<Readonly<{ artifactRef: string; sha256: `sha256:${string}`;
    byteLength: number; base64: string }>>;
  readonly createdAt: string;
}

export function verifyKernelMachineImage(image: unknown): Promise<Readonly<{
  image: KernelMachineImage;
  manifest: KernelEngineManifest;
  packageEnvironment: Readonly<{ descriptor: KernelPackageEnvironmentImage;
    bootstrap: KernelPackageEnvironmentBootstrap }> | null;
  objects: ReadonlyMap<string, Readonly<{ descriptor: KernelMachineImage["checkpointObjects"][number]; bytes: Uint8Array }>>;
  checkpoints: ReadonlyMap<string, KernelCheckpointDescriptor>;
}>>;

export interface KernelOpenOptions {
  offline?: boolean;
  deterministic?: boolean;
  kernelRef?: string;
  restore?: KernelCheckpointDescriptor | { checkpoint: KernelCheckpointDescriptor };
  hostBroker?: HostCapabilityBroker;
  checkpointCoordinator?: KernelCheckpointCoordinator;
  kernelVfs?: KernelVfs;
  packageEnvironment?: KernelPackageEnvironmentBootstrap | null;
}

export class KernelFactory {
  constructor(options?: { assetStore?: MemoryKernelAssetStore; checkpointStore?: MemoryValueArtifactStore;
    fetchImpl?: typeof fetch });
  readonly assetStore: MemoryKernelAssetStore;
  readonly checkpointStore: MemoryValueArtifactStore;
  open(manifest: KernelEngineManifest, options?: KernelOpenOptions): Promise<KernelRuntimeContractV2>;
  manifestFor(kernel: KernelRuntimeContractV2): KernelEngineManifest;
  checkpoint(kernel: KernelRuntimeContractV2, request?: Record<string, unknown>): Promise<KernelCheckpointDescriptor>;
  clone(kernel: KernelRuntimeContractV2, options?: KernelOpenOptions & { checkpoint?: Record<string, unknown> }):
    Promise<Readonly<{ kernel: KernelRuntimeContractV2; checkpoint: KernelCheckpointDescriptor }>>;
  exportImage(kernel: KernelRuntimeContractV2, options?: { checkpoint?: KernelCheckpointDescriptor; createdAt?: string }):
    Promise<KernelMachineImage>;
  openImage(image: KernelMachineImage, options?: KernelOpenOptions): Promise<KernelRuntimeContractV2>;
  inspect(): Readonly<Record<string, unknown>>;
}
