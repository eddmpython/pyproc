// Value and type contract of the pyproc/runtime subpath.
import type {
  BootOptions,
  EngineContract,
  EnvReport,
  FileSystem as FileSystemShape,
  MemoryCapability as MemoryCapabilityShape,
  Runtime as RuntimeShape,
  RuntimeContract,
} from "../../index.js";

export type { BootOptions, EngineContract, EnvReport, RuntimeContract };
export type Runtime = RuntimeShape;
export type MemoryCapability = MemoryCapabilityShape;
export type FileSystem = FileSystemShape;

/** Verified same-origin engine distribution path: /vendor/pyodide/. */
export const DEFAULT_INDEX: string;
export const PAGE_SIZE: 65536;
export const ENGINE_CONTRACT_VERSION: 1;
export const RUNTIME_CONTRACT_VERSION: 1;
export const ENGINE_CAPABILITIES: Readonly<Record<string, string>>;
export const RUNTIME_CAPABILITIES: Readonly<Record<string, string>>;

export const Runtime: {
  new(engineOrPyodide: EngineContract | unknown, indexURL?: string, opts?: Record<string, unknown>): RuntimeShape;
  readonly prototype: RuntimeShape;
};
export const MemoryCapability: {
  new(engine: EngineContract): MemoryCapabilityShape;
  readonly prototype: MemoryCapabilityShape;
};
export const FileSystem: {
  new(runtime: RuntimeShape): FileSystemShape;
  readonly prototype: FileSystemShape;
};

export function bootRuntime(options?: BootOptions): Promise<RuntimeShape>;
export function checkEnvironment(): EnvReport;
export function ensureEngineScript(indexURL: string, opts?: { integrity?: string; crossOrigin?: string }): Promise<void>;
export function assertEngineContract(engine: unknown): EngineContract;
export function engineCapabilities(engine: EngineContract): Set<string>;
export function hasEngineCapability(engine: EngineContract, capability: string): boolean;
export function requireEngineCapability(engine: EngineContract, capability: string, operation: string): void;
export function assertRuntimeContract(runtime: unknown): RuntimeContract;
