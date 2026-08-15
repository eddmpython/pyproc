import type { PackageEnvironment } from "./packageEnvironment.js";
import type { KernelCheckpointDescriptor, KernelRuntimeContractV2 } from "../runtime/kernel/index.js";

export class KernelTerminal {
  constructor(kernel: KernelRuntimeContractV2, options?: {
    packageEnvironment?: PackageEnvironment;
    timeTravel?: boolean;
    checkpoint?: (request?: Record<string, unknown>) => Promise<KernelCheckpointDescriptor>;
  });
  install(): Promise<Readonly<{ repl: "code.InteractiveConsole"; timeTravel: boolean; packages: "pyproc.package-environment" | null }>>;
  push(line: string): Promise<Readonly<{ more: boolean; out: string }>>;
}
