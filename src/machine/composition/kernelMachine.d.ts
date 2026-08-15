import type { KernelEngineManifest } from "../../runtime/kernel/engineManifest.js";
import type { KernelFactory, KernelMachineImage, KernelOpenOptions } from "../../composition/kernelFactory.js";
import type { KernelTerminal } from "../../capabilities/kernelTerminal.js";
import type { PackageEnvironment } from "../../capabilities/packageEnvironment.js";
import type { MemoryValueArtifactStore } from "../../runtime/kernel/index.js";
import type { MemoryKernelAssetStore } from "../../runtime/kernel/engineManifest.js";

export interface KernelMachineRun {
  (code: string, options?: Record<string, unknown>): Promise<unknown>;
  python(code: string, options?: Record<string, unknown>): Promise<unknown>;
  get(name: string): Promise<unknown>;
  set(name: string, value: unknown): Promise<unknown>;
}

export interface OwnedWasmToolReceipt {
  readonly protocol: "pyproc.wasm-tool-receipt";
  readonly version: 1;
  readonly command: "rg" | "git";
  readonly toolVersion: string;
  readonly toolRevision: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly input: Readonly<{ source: "kernel-vfs" | "explicit" | "empty"; fileCount: number;
    byteLength: number; sha256: `sha256:${string}` }>;
  readonly output: Readonly<{ fileCount: number; byteLength: number; sha256: `sha256:${string}`;
    rootDigest: `sha256:${string}`; written: number; removed: number; committed: boolean }> | null;
  readonly durationMs: number;
  readonly workerDurationMs: number;
}

export interface OwnedWasmToolRunOptions {
  files?: Record<string, string | Uint8Array | ArrayBuffer>;
  stdin?: string | Uint8Array | ArrayBuffer;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export class KernelMachine {
  readonly kernel: unknown;
  readonly manifest: KernelEngineManifest;
  readonly run: KernelMachineRun;
  readonly history: Readonly<{ checkpoint(request?: Record<string, unknown>): Promise<unknown>;
    restore(checkpoint: unknown): Promise<unknown>; export(options?: Record<string, unknown>): Promise<KernelMachineImage> }>;
  readonly proc: Readonly<{ spawn(manifest: KernelEngineManifest, options?: Record<string, unknown>): Promise<unknown>;
    clone(options?: Record<string, unknown>): Promise<unknown>; inspect(): readonly unknown[] }>;
  readonly tools: Readonly<{ run(command: "rg" | "git", args?: string[], options?: OwnedWasmToolRunOptions): Promise<OwnedWasmToolReceipt>;
    inspect(): Readonly<Record<string, unknown>> }>;
  createPackageEnvironment(options: Omit<ConstructorParameters<typeof PackageEnvironment>[0], "kernel">): PackageEnvironment;
  terminal(options?: { packageEnvironment?: PackageEnvironment; timeTravel?: boolean }): KernelTerminal;
  inspect(): Promise<Readonly<Record<string, unknown>>>;
  close(): Promise<unknown>;
}

export function bootKernelMachine(factory: KernelFactory, manifest: KernelEngineManifest,
  options?: KernelOpenOptions): Promise<KernelMachine>;
export function openKernelMachineImage(factory: KernelFactory, image: KernelMachineImage,
  options?: KernelOpenOptions): Promise<KernelMachine>;
export function bootDefaultKernelMachine(options?: KernelOpenOptions & {
  engineManifest?: KernelEngineManifest;
  kernelFactory?: KernelFactory;
  assetStore?: MemoryKernelAssetStore;
  checkpointStore?: MemoryValueArtifactStore;
  fetchImpl?: typeof fetch;
}): Promise<KernelMachine>;
export function openDefaultKernelMachineImage(image: KernelMachineImage, options?: KernelOpenOptions & {
  kernelFactory?: KernelFactory;
}): Promise<KernelMachine>;
