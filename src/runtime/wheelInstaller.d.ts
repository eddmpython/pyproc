export interface WheelLimits {
  maxArchiveBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxUnpackedBytes: number;
  maxCompressionRatio: number;
}

export interface WheelFilename {
  readonly distribution: string;
  readonly version: string;
  readonly python: string;
  readonly abi: string;
  readonly platform: string;
  readonly tags: readonly string[];
}

export interface PurePythonWheelTree {
  readonly protocol: "pyproc.pure-wheel-tree";
  readonly version: 1;
  readonly name: string;
  readonly displayName: string;
  readonly packageVersion: string;
  readonly filename: string;
  readonly wheelDigest: `sha256:${string}`;
  readonly treeDigest: `sha256:${string}`;
  readonly requiresPython: string | null;
  readonly dependencies: readonly string[];
  readonly files: readonly (readonly [string, Uint8Array])[];
  readonly fileReceipts: readonly Readonly<{ path: string; byteLength: number; sha256: `sha256:${string}` }>[];
  readonly unpackedBytes: number;
}

export const DEFAULT_WHEEL_LIMITS: Readonly<WheelLimits>;
export function parseWheelFilename(filename: string): WheelFilename;
export function inspectPurePythonWheel(input: ArrayBuffer | Uint8Array, options?: {
  filename?: string;
  expectedName?: string;
  expectedVersion?: string;
  expectedSha256?: string;
  allowedTags?: string[];
  limits?: Partial<WheelLimits>;
}): Promise<PurePythonWheelTree>;
