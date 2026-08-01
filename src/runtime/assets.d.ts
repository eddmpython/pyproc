// assets.d.ts - type contract of the pyproc/assets subpath (placed next to its own .js).
// The manifest, SRI, and Service Worker contract for runtime assets that a deployment
// deploys on its own origin.

export const PYPROC_ASSET_MANIFEST_VERSION: 1;

export interface PyProcAssetEntry {
  role: "processWorker" | "machineWorker" | "wasiWorker" | "pyprocServiceWorker";
  /** Path relative to the package root. */
  path: string;
  kind: "module-worker" | "shared-worker" | "service-worker";
  sameOrigin: true;
  usedBy: string[];
  reason: string;
  /** Absolute URL resolved against baseURL. */
  url: string;
}

export interface PyProcAssetManifest {
  version: 1;
  /** The package root this manifest resolved URLs against. */
  packageRoot: string;
  policy: {
    sameOriginRequired: true;
    preserveRelativeImports: true;
    runtimePreflight?: true;
    note: string;
  };
  assets: PyProcAssetEntry[];
}

export function getPyProcAssetManifest(opts?: { baseURL?: string | URL }): PyProcAssetManifest;

export interface PyProcAssetIntegrityFile {
  /** Path relative to the package root. */
  path: string;
  /** The URL it is actually deployed at; a root-relative URL is allowed. */
  url: string;
  bytes: number;
  /** Standard SRI string (sha256-...). */
  integrity: string;
  /** Entrypoint roles that use this file. */
  roles: PyProcAssetEntry["role"][];
}

export interface PyProcAssetEntrypoint extends PyProcAssetEntry {
  /** Graph of local files reachable from an entrypoint by relative import/importScripts. */
  graph: string[];
  bytes: number;
  integrity: string;
}

export interface PyProcAssetIntegrityManifest extends Omit<PyProcAssetManifest, "assets"> {
  entrypoints: PyProcAssetEntrypoint[];
  files: PyProcAssetIntegrityFile[];
}

export interface PyProcAssetIntegrityVerifyOptions {
  /** Asset roles to verify. Omit to verify every file. */
  roles?: PyProcAssetEntry["role"][];
  /** Verify only these relative paths instead of whole roles. */
  paths?: string[];
  /** fetch replacement for tests or unusual deployments. */
  fetch?: typeof fetch;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  /** When false, selecting nothing yields verified 0 instead of throwing. */
  required?: boolean;
}

export interface PyProcAssetIntegrityResult {
  verified: number;
  bytes: number;
  files: string[];
}

export function verifyPyProcAssetIntegrity(manifest: PyProcAssetIntegrityManifest, opts?: PyProcAssetIntegrityVerifyOptions): Promise<PyProcAssetIntegrityResult | null>;

export interface PyProcServiceWorkerRegisterOptions {
  /** navigator replacement for tests or unusual hosts. Defaults to globalThis.navigator. */
  navigator?: Navigator;
  /** fetch replacement for the SRI preflight. */
  fetch?: typeof fetch;
  /** cache option for the SRI preflight fetch. */
  verifyCache?: RequestCache;
  credentials?: RequestCredentials;
  /** pyprocSw.js ?cache=1. Turns on the script/module/wasm/zip cache and the coreIntegrity verification path. */
  cache?: boolean;
  /** pyprocSw.js ?asgi=/prefix/. Prefix whose fetches are delegated to VirtualOrigin. */
  asgi?: string;
  /** pyprocSw.js ?coi=1. Injects COOP/COEP on hosting that cannot set headers. */
  coi?: boolean;
  /** pyprocSw.js ?cdn=<prefix>. URL prefix treated as cache/coreIntegrity scope. */
  cdn?: string;
  /** pyprocSw.js ?coreIntegrity=<url>. Manifest URL the SW uses to SRI-verify cached bytes. */
  coreIntegrity?: string;
  /** When false, a missing SW coreIntegrity manifest is tolerated. Strict by default. */
  coreRequired?: boolean;
  asgiTimeout?: number;
  /** Extra pyprocSw.js query parameters; true serializes as "1". */
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  /** ServiceWorkerRegistrationOptions.scope. */
  scope?: string;
  updateViaCache?: ServiceWorkerUpdateViaCache;
}

export interface PyProcServiceWorkerRegisterResult {
  registration: ServiceWorkerRegistration;
  integrity: PyProcAssetIntegrityResult | null;
  /** The URL actually passed to register. */
  url: string;
  /** Path of the manifest file that was verified. */
  file: string;
}

export function registerPyProcServiceWorker(
  manifest: PyProcAssetIntegrityManifest,
  opts?: PyProcServiceWorkerRegisterOptions,
): Promise<PyProcServiceWorkerRegisterResult>;
