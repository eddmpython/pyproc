// wasiSession.d.ts - type contract of the pyproc/wasi subpath (same placement rationale as gpuCompute.d.ts).

  import type { PyProcAssetIntegrityManifest } from "../../assets.js";
export interface WasiManifest {
  /**
   * URL of python.wasm, self-hosted by the consumer. When omitted, the default brettcannon
   * CPython 3.14.6 release zip is fetched and both python.wasm and the stdlib are unpacked from
   * it. Under COOP/COEP, self-hosting is recommended because of CORP.
   */
  wasmURL?: string;
  /**
   * stdlib zip URL for builds that ship the stdlib separately (brettcannon = python.wasm plus a
   * separate lib). Pass it together with wasmURL. When omitted, wasmURL is treated as a
   * self-contained build (WLR, stdlib baked in).
   */
  stdlibURL?: string;
  /** Directory name the stdlib mounts under (default "python3.14"), i.e. lib/<stdlibDir>/ inside the release zip. */
  stdlibDir?: string;
  /** When true, entropy and time are pinned so the boot is deterministic - the precondition for replay and time travel. */
  deterministic?: boolean;
  /**
   * Pure-Python wheels (as bytes) to install right after boot. The consumer supplies them:
   * pyproc does not fetch from PyPI, the same contract as wasmURL. Each wheel is unpacked into
   * /site by installWheel and becomes importable.
   */
  wheels?: (ArrayBuffer | Uint8Array)[];
  /** SRI-verifies the wasiWorker graph before the WASI worker is created. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

/**
 * A session running on CPython (WASI) rather than Pyodide. Pyodide is synchronous on the main
 * thread while WASI is asynchronous inside a worker, so this is a separate async surface from
 * the synchronous Runtime - consumers of either are unaffected. It is the engine-independence
 * proof: repeated execution, a value bridge, and full time travel (checkpoint, restore, resume,
 * branch) all hold without any Pyodide internals. The value bridge is JSON-serializable only,
 * because WASI has no FFI, so functions, numpy arrays, and live objects cannot cross. Native
 * extensions are impossible (static linking). The code channel and signal protocol are
 * encapsulated internally; consumers never see them.
 */
export class WasiSession {
  readonly runtimeContractVersion: 1;
  readonly runtimeKind: "wasi";
  capabilities(): readonly string[];
  /** Runs code (async) and returns captured stdout. Python exceptions are thrown. */
  run(code: string): Promise<string>;
  runAsync(code: string): Promise<string>;
  /** Reads a Python global back (JSON deserialization). */
  get(name: string): Promise<unknown>;
  getGlobal(name: string): Promise<unknown>;
  /** Injects a JS value into a Python global (JSON serialization). */
  set(name: string, value: unknown): Promise<void>;
  setGlobal(name: string, value: unknown): Promise<void>;
  toHostValue(value: unknown, options?: { proxyMode?: "copy" | "preserve"; fallback?: unknown }): unknown;
  destroyHostValue(value: unknown): void;
  /** Checkpoints the current state (a heap snapshot at the boundary). */
  checkpoint(): Promise<{ idx: number; mb: number }>;
  /** Time travel: restores checkpoint idx. Python resumes from that state afterwards, and may branch. */
  timeTravel(idx: number): Promise<void>;
  /**
   * Installs a pure-Python wheel (as bytes) into the live session - pip install for the browser.
   * It unpacks natively, writes files into /site, and invalidates the import cache, after which
   * the package is importable. Pure Python only: C extensions (.so) are impossible because WASI
   * has no dynamic linking (waiting on PEP 783). Returns the file count and the top-level names.
   */
  installWheel(wheel: ArrayBuffer | Uint8Array): Promise<{ files: number; names: string[] }>;
  terminate(): void;
}

/** Boots a non-Pyodide CPython (WASI) session. Chromium/Edge only (SAB + crossOriginIsolated). */
export function bootWasi(manifest?: WasiManifest): Promise<WasiSession>;
