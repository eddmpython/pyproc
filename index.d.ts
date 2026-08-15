import type { HostCapabilityBroker } from "./src/capabilities/hostCapabilityBroker.js";
import type { KernelFactory, KernelMachineImage } from "./src/composition/kernelFactory.js";
import type { KernelMachine } from "./src/machine/composition/kernelMachine.js";
import type { MemoryKernelAssetStore, KernelEngineManifest } from "./src/runtime/kernel/engineManifest.js";
import type { KernelCheckpointCoordinator, KernelVfs } from "./src/runtime/kernel/index.js";
import type { PyProcAssetIntegrityManifest } from "./src/runtime/assets.js";

export type PyProcErrorCode =
  | "PYPROC_ENV_UNSUPPORTED"
  | "PYPROC_INPUT_INVALID"
  | "PYPROC_BOOT_FAILED"
  | "PYPROC_ASSET_INTEGRITY"
  | "PYPROC_ASSET_MISSING"
  | "PYPROC_PACKAGE_RESOLUTION"
  | "PYPROC_PACKAGE_INTEGRITY"
  | "PYPROC_PACKAGE_ABI_UNSUPPORTED"
  | "PYPROC_MACHINE_FORMAT_INVALID"
  | "PYPROC_MACHINE_INTEGRITY"
  | "PYPROC_MACHINE_UNTRUSTED"
  | "PYPROC_REPLAY_MISMATCH"
  | "PYPROC_IMAGE_PROXY_SURFACE"
  | "PYPROC_HEAP_GROW_FAILED"
  | "PYPROC_CHECKPOINT_PRUNED"
  | "PYPROC_PROCESS_UNAVAILABLE"
  | "PYPROC_FORK_UNAVAILABLE"
  | "PYPROC_WORKER_CRASHED"
  | "PYPROC_WORKER_TASK_ERROR"
  | "PYPROC_TASK_TIMEOUT"
  | "PYPROC_POOL_EXHAUSTED"
  | "PYPROC_JOURNAL_CORRUPT"
  | "PYPROC_JOURNAL_EVICTED"
  | "PYPROC_JOURNAL_IO"
  | "PYPROC_STATE_CORRUPT"
  | "PYPROC_STATE_FENCE_STALE"
  | "PYPROC_STORAGE_QUOTA_EXCEEDED"
  | "PYPROC_STORAGE_EVICTED"
  | "PYPROC_RPC_OUTCOME_UNKNOWN"
  | "PYPROC_LEADER_UNAVAILABLE"
  | "PYPROC_SPLIT_BRAIN"
  | "PYPROC_LEADER_LOCK_FAILED"
  | "PYPROC_RPC_ACTION_INVALID"
  | "PYPROC_PARTICIPANT_LEFT"
  | "PYPROC_KERNEL_EXECUTION_ERROR"
  | "PYPROC_GPU_UNAVAILABLE"
  | "PYPROC_GPU_RESULT_MISMATCH"
  | "PYPROC_INTERNAL";

export const PYPROC_ERROR_CODES: readonly PyProcErrorCode[];

export class PyProcError extends Error {
  constructor(code: PyProcErrorCode, message: string, opts?: {
    retryable?: boolean;
    context?: Record<string, unknown>;
    cause?: unknown;
  });
  readonly name: "PyProcError";
  code: PyProcErrorCode;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export interface EnvIssue {
  code: string;
  need: string;
  why: string;
  fix: string;
}

export interface EnvReport {
  ok: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  jspi: boolean;
  issues: EnvIssue[];
}

export interface CpythonWasiBootOptions {
  engineManifest?: KernelEngineManifest;
  kernelFactory?: KernelFactory;
  assetStore?: MemoryKernelAssetStore;
  checkpointStore?: unknown;
  fetchImpl?: typeof fetch;
  deterministic?: boolean;
  kernelRef?: string;
  hostBroker?: HostCapabilityBroker;
  assetIntegrity?: PyProcAssetIntegrityManifest;
  checkpointCoordinator?: KernelCheckpointCoordinator;
  kernelVfs?: KernelVfs;
}

export function boot(options?: CpythonWasiBootOptions): Promise<KernelMachine>;
export function open(): Promise<KernelMachine>;
export function open(image: KernelMachineImage, options?: CpythonWasiBootOptions): Promise<KernelMachine>;
export { createWebComputer } from "./src/machine/index.js";
export function checkEnvironment(): EnvReport;
