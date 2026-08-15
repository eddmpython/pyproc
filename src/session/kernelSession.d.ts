import type { KernelEngineManifest } from "../runtime/kernel/engineManifest.js";
import type { KernelCheckpointDescriptor, KernelRuntimeContractV2 } from "../runtime/kernel/index.js";
import type { KernelFactory, KernelMachineImage, KernelOpenOptions } from "../composition/kernelFactory.js";

export class KernelSession {
  constructor(factory: KernelFactory, kernel: KernelRuntimeContractV2);
  static open(factory: KernelFactory, manifest: KernelEngineManifest, options?: KernelOpenOptions): Promise<KernelSession>;
  readonly kernel: KernelRuntimeContractV2;
  readonly factory: KernelFactory;
  run(code: string, options?: Record<string, unknown>): Promise<Readonly<Record<string, unknown> & { output: string }>>;
  get(name: string): Promise<unknown>;
  set(name: string, value: unknown): Promise<unknown>;
  checkpoint(request?: Record<string, unknown>): Promise<KernelCheckpointDescriptor>;
  restore(checkpoint: string | KernelCheckpointDescriptor): Promise<unknown>;
  fork(options?: KernelOpenOptions): Promise<Readonly<{ session: KernelSession; checkpoint: KernelCheckpointDescriptor }>>;
  exportImage(options?: { checkpoint?: KernelCheckpointDescriptor; createdAt?: string }): Promise<KernelMachineImage>;
  describe(): Promise<unknown>;
  close(): Promise<unknown>;
}
