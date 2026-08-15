// wasiSession.d.ts - type contract of the pyproc/wasi subpath (same placement rationale as gpuCompute.d.ts).

import type { PyProcAssetIntegrityManifest } from "../../assets.js";
export interface WasiManifest {
  /** Digest-verified engine bytes supplied by KernelFactory. */
  wasmBytes: ArrayBuffer | Uint8Array;
  /** Digest-verified stdlib bytes supplied by KernelFactory. */
  stdlibBytes: ArrayBuffer | Uint8Array;
  /** Directory name the stdlib mounts under (default "python3.14"), i.e. lib/<stdlibDir>/ inside the release zip. */
  stdlibDir?: string;
  /** When true, entropy and time are pinned so the boot is deterministic - the precondition for replay and time travel. */
  deterministic?: boolean;
  /**
   * Pure-Python wheels (as bytes) to install right after boot. The consumer supplies them.
   * Each wheel is unpacked into
   * /site by installWheel and becomes importable.
   */
  wheels?: (ArrayBuffer | Uint8Array)[];
  /** SRI-verifies the wasiWorker graph before the WASI worker is created. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  /** Capability broker used by the synchronous worker hostcall ABI. */
  hostBroker?: import("../../../capabilities/hostCapabilityBroker.js").HostCapabilityBroker;
  /** A materialized exact-engine checkpoint injected by KernelFactory at the first safe command boundary. */
  bootstrapSnapshot?: { stackBoundary: number; memoryBytes: number; deltaDepth: number; bytes: Uint8Array };
  /** Verified package layers replayed after a checkpoint is imported into a fresh worker. */
  packageEnvironment?: import("../../kernel/index.js").KernelPackageEnvironmentBootstrap;
}

/**
 * A worker-owned CPython/WASI session with a Promise-first command surface. Repeated execution,
 * a value bridge, and full time travel (checkpoint, restore, resume, branch) use PyProc-owned
 * contracts. The value bridge is JSON-serializable only,
 * because WASI has no FFI, so functions, numpy arrays, and live objects cannot cross. Native
 * extensions are impossible (static linking). The code channel and signal protocol are
 * encapsulated internally; consumers never see them.
 */
export class WasiSession {
  readonly runtimeContractVersion: 1;
  readonly runtimeKind: "wasi";
  capabilities(): readonly string[];
  /** Runs code (async) and returns captured stdout. Python exceptions are thrown. */
  run(code: string, context?: { authorityRef?: string; commandId?: string; kernelRef?: string; generation?: number }): Promise<string>;
  runAsync(code: string): Promise<string>;
  /** Reads a Python global back (JSON deserialization). */
  get(name: string): Promise<unknown>;
  getGlobal(name: string): Promise<unknown>;
  /** Injects a JS value into a Python global (JSON serialization). */
  set(name: string, value: unknown): Promise<void>;
  setGlobal(name: string, value: unknown): Promise<void>;
  toHostValue(value: unknown, options?: { proxyMode?: "copy" | "preserve"; fallback?: unknown }): unknown;
  destroyHostValue(value: unknown): void;
  getEnvelope(name: string): Promise<import("../../kernel/index.js").ValueEnvelope>;
  setEnvelope(name: string, value: import("../../kernel/index.js").ValueEnvelope): Promise<void>;
  hasCallable(name: string): Promise<boolean>;
  invokeApplication(name: string, args: Array<import("../../kernel/index.js").ValueEnvelope>): Promise<import("../../kernel/index.js").ValueEnvelope>;
  /** Checkpoints the current state (a heap snapshot at the boundary). */
  checkpoint(): Promise<import("../../kernel/index.js").KernelMemorySnapshot & { idx: number; mb: number }>;
  resetCheckpointLineage(): Promise<Readonly<{ state: "reset" | "unknown" }>>;
  readonly bootstrapSnapshotIndex: number | null;
  importBootstrapSnapshot(): Promise<Readonly<Record<string, unknown>>>;
  /** Time travel: restores checkpoint idx. Python resumes from that state afterwards, and may branch. */
  timeTravel(idx: number): Promise<void>;
  inspectCheckpointBoundary(): Readonly<{ acceptedHostcalls: number; activeTransactions: number; outputDrained: true; openResources: readonly unknown[]; vfsRootDigest: null }>;
  /**
   * Installs a pure-Python wheel (as bytes) into the live session - pip install for the browser.
   * It unpacks natively, writes files into /site, and invalidates the import cache, after which
   * the package is importable. Pure Python only: C extensions (.so) are impossible because WASI
   * has no dynamic linking (waiting on PEP 783). Returns the file count and the top-level names.
   */
  installWheel(wheel: ArrayBuffer | Uint8Array, options?: Parameters<typeof import("../../wheelInstaller.js").inspectPurePythonWheel>[1]): Promise<Readonly<Record<string, unknown>>>;
  installEnvironment(request: { environmentId: `sha256:${string}`; allowedTags: string[];
    limits?: Partial<import("../../wheelInstaller.js").WheelLimits>; wheels: Array<{ filename: string;
      name: string; version: string; sha256: string; bytes: ArrayBuffer | Uint8Array }> }): Promise<Readonly<Record<string, unknown>>>;
  terminate(): void;
}

/** Boots a worker-owned CPython/WASI session. Chromium/Edge only (SAB + crossOriginIsolated). */
export function bootWasi(manifest: WasiManifest): Promise<WasiSession>;
