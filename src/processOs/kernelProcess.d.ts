import type { KernelEngineManifest } from "../runtime/kernel/engineManifest.js";
import type { KernelFactory, KernelOpenOptions } from "../composition/kernelFactory.js";
import type { KernelSession } from "../session/kernelSession.js";

export class KernelProcess {
  readonly pid: string;
  readonly kernel: KernelSession["kernel"];
  readonly session: KernelSession;
  readonly state: string;
  execute(code: string, options?: Record<string, unknown>): Promise<unknown>;
  wait(): Promise<Readonly<Record<string, unknown>>>;
  signal(signal: "interrupt" | "terminate"): Promise<unknown>;
  close(): Promise<unknown>;
}

export class KernelProcessManager {
  constructor(factory: KernelFactory, options: {
    openSession(factory: KernelFactory, manifest: KernelEngineManifest, options?: KernelOpenOptions): Promise<KernelSession>;
  });
  spawn(manifest: KernelEngineManifest, options?: KernelOpenOptions & { pid?: string; code?: string;
    cloneFrom?: KernelSession | KernelProcess }): Promise<Readonly<{ process: KernelProcess; checkpoint: unknown }>>;
  get(pid: string): KernelProcess | null;
  close(): Promise<void>;
  inspect(): ReadonlyArray<Readonly<{ pid: string; state: string }>>;
}
