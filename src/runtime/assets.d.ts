export const PYPROC_ASSET_MANIFEST_VERSION: 1;

export interface PyProcAssetEntry {
  role: "wasiWorker";
  path: string;
  kind: "module-worker";
  sameOrigin: true;
  usedBy: string[];
  reason: string;
  url: string;
}

export interface PyProcAssetManifest {
  version: 1;
  packageRoot: string;
  policy: {
    sameOriginRequired: true;
    preserveRelativeImports: true;
    runtimePreflight: true;
    note: string;
  };
  assets: PyProcAssetEntry[];
}

export function getPyProcAssetManifest(opts?: { baseURL?: string | URL }): PyProcAssetManifest;

export interface PyProcAssetIntegrityFile {
  path: string;
  url: string;
  bytes: number;
  integrity: string;
  roles: string[];
}

export interface PyProcAssetIntegrityManifest {
  files: PyProcAssetIntegrityFile[];
}

export interface PyProcAssetIntegrityResult {
  verified: number;
  bytes: number;
  files: string[];
}

export function verifyPyProcAssetIntegrity(manifest: PyProcAssetIntegrityManifest | null,
  opts?: { roles?: string[]; paths?: string[]; required?: boolean; fetch?: typeof fetch;
    cache?: RequestCache; credentials?: RequestCredentials }): Promise<PyProcAssetIntegrityResult | null>;
