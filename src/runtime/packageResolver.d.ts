export const PACKAGE_LOCK_PROTOCOL: "pyproc.package-lock";
export const PACKAGE_LOCK_VERSION: 2;
export const PACKAGE_RESOLVER_VERSION: "pyproc.simple-resolver/2";

export interface PackageIndex {
  readonly url: string;
  readonly trustRef: string;
}

export interface LockedPackage {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly url: string;
  readonly sha256: `sha256:${string}`;
  readonly size: number;
  readonly requiresPython: string | null;
  readonly dependencies: readonly string[];
  readonly metadataSha256: `sha256:${string}`;
  readonly sourceIndex: string;
  readonly yanked: boolean | string;
  readonly provenanceUrl: string;
}

export interface PackageLock {
  readonly protocol: "pyproc.package-lock";
  readonly version: 2;
  readonly resolverVersion: "pyproc.simple-resolver/2";
  readonly requirements: readonly string[];
  readonly indexes: readonly PackageIndex[];
  readonly pythonVersion: string;
  readonly markerEnvironment: Readonly<Record<string, string>>;
  readonly allowedTags: readonly string[];
  readonly engineId: string | null;
  readonly nativeProfile: string;
  readonly prereleasePolicy: "forbid" | "explicit";
  readonly yankedPolicy: "forbid" | "lockedOnly";
  readonly packages: readonly LockedPackage[];
}

export interface ParsedPackageRequirement {
  readonly raw: string;
  readonly name: string;
  readonly extras: readonly string[];
  readonly specifiers: readonly string[];
  readonly marker: string | null;
}

export interface PackageContentStore {
  put(expectedSha256: string, input: ArrayBuffer | Uint8Array): Promise<string>;
  get(expectedSha256: string): Promise<Uint8Array | null>;
  has(expectedSha256: string): Promise<boolean>;
}

export class MemoryPackageContentStore implements PackageContentStore {
  put(expectedSha256: string, input: ArrayBuffer | Uint8Array): Promise<string>;
  get(expectedSha256: string): Promise<Uint8Array | null>;
  has(expectedSha256: string): Promise<boolean>;
}

export function comparePackageVersions(left: string, right: string): number;
export function evaluatePackageMarker(marker: string | null, environment: Record<string, string>): boolean;
export function parsePackageRequirement(value: string): ParsedPackageRequirement;

export class SimpleApiPackageResolver {
  constructor(options: {
    fetch?: typeof fetch;
    indexes: PackageIndex[];
    pythonVersion?: string;
    markerEnvironment?: Record<string, string>;
    allowedTags?: string[];
    engineId?: string | null;
    nativeProfile?: string;
    bundledArtifacts?: Array<{ sha256: string; bytes: ArrayBuffer | Uint8Array }>;
    prereleasePolicy?: "forbid" | "explicit";
    yankedPolicy?: "forbid" | "lockedOnly";
  });
  readonly pythonVersion: string;
  readonly markerEnvironment: Readonly<Record<string, string>>;
  readonly allowedTags: readonly string[];
  readonly engineId: string | null;
  readonly nativeProfile: string;
  readonly prereleasePolicy: "forbid" | "explicit";
  readonly yankedPolicy: "forbid" | "lockedOnly";
  resolve(requirements: string[]): Promise<Readonly<{ lock: PackageLock; lockDigest: `sha256:${string}` }>>;
  validateLock(input: unknown): Promise<Readonly<{ lock: PackageLock; lockDigest: `sha256:${string}` }>>;
  materialize(input: PackageLock, options: { contentStore: PackageContentStore; offline?: boolean }): Promise<Readonly<{
    lock: PackageLock;
    lockDigest: `sha256:${string}`;
    offline: boolean;
    wheels: readonly Readonly<{ package: LockedPackage; bytes: Uint8Array; source: "content-store" | "package" | "network" }>[];
  }>>;
}
