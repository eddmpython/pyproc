import type { KernelRuntimeContractV2 } from "../runtime/kernel/index.js";
import type { PackageContentStore, PackageLock, SimpleApiPackageResolver } from "../runtime/packageResolver.js";
import type { WheelLimits } from "../runtime/wheelInstaller.js";

export const PACKAGE_ENVIRONMENT_PROTOCOL: "pyproc.package-environment";
export const PACKAGE_ENVIRONMENT_VERSION: 2;

export interface PackageEnvironmentReceipt {
  readonly protocol: "pyproc.package-environment";
  readonly version: 2;
  readonly environmentId: `sha256:${string}`;
  readonly engineId: string;
  readonly nativeProfile: string;
  readonly lock: PackageLock;
  readonly lockDigest: `sha256:${string}`;
  readonly policyDigest: `sha256:${string}`;
  readonly treeDigests: readonly `sha256:${string}`[];
  readonly offline: boolean;
  readonly sources: readonly ("content-store" | "package" | "network")[];
  readonly installed: Readonly<Record<string, unknown>>;
}

export function packageEnvironmentIdentity(input: { engineId: string; lock: PackageLock;
  treeDigests: string[]; policyDigest: string }): Promise<`sha256:${string}`>;

export class PackageEnvironment {
  constructor(options: { kernel: KernelRuntimeContractV2; resolver: SimpleApiPackageResolver;
    contentStore?: PackageContentStore; policy?: { wheelLimits?: Partial<WheelLimits>; compileBytecode?: boolean } });
  install(request: { requirements?: string[]; lock?: PackageLock; offline?: boolean; extend?: boolean }): Promise<PackageEnvironmentReceipt>;
  inspect(): PackageEnvironmentReceipt | null;
}
