import type { PackageEnvironment, PackageEnvironmentReceipt } from "../capabilities/packageEnvironment.js";
import type { KernelRuntimeContractV2, ExecutionResult } from "../runtime/kernel/index.js";
import type { PackageLock } from "../runtime/packageResolver.js";

export class KernelEnvironmentManager {
  constructor(kernel: KernelRuntimeContractV2, packageEnvironment: PackageEnvironment);
  install(request: Parameters<PackageEnvironment["install"]>[0]): ReturnType<PackageEnvironment["install"]>;
  runScript(source: string, options?: { requirements?: string[]; lock?: PackageLock; offline?: boolean }): Promise<Readonly<{
    result: ExecutionResult;
    environment: PackageEnvironmentReceipt | null;
    dependencies: readonly string[];
    requiresPython: string | null;
  }>>;
}
