import type { SimpleApiPackageResolver } from "../../packageResolver.js";

export const OWNED_PACKAGE_CATALOG_PROTOCOL: "pyproc.owned-package-catalog";
export const OWNED_PACKAGE_CATALOG_VERSION: 1;

export interface OwnedPackageCatalog {
  readonly protocol: "pyproc.owned-package-catalog";
  readonly version: 1;
  readonly catalogDigest: `sha256:${string}`;
  readonly engine: Readonly<{
    engineId: string;
    nativeProfile: string;
    pythonVersion: string;
    target: "wasm32-wasip1";
    buildManifestSha256: `sha256:${string}`;
  }>;
  readonly packages: readonly Readonly<{
    name: string;
    version: string;
    filename: string;
    artifactPath: string;
    sha256: `sha256:${string}`;
    size: number;
    requiresPython: string;
    dependencies: readonly string[];
    metadata: string;
    metadataSha256: `sha256:${string}`;
    tag: "py3-none-any";
    wrapper: Readonly<{ module: string; sourceSha256: `sha256:${string}` }>;
    nativeModules: readonly Readonly<{
      name: string;
      abiVersion: string;
      origin: "built-in";
      sourceSha256: `sha256:${string}`;
    }>[];
  }>[];
}

export function createOwnedPackageResolver(options?: { fetch?: typeof fetch }): Promise<SimpleApiPackageResolver & {
  readonly ownedCatalog: OwnedPackageCatalog;
}>;
