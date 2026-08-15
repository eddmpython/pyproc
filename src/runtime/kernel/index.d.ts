import type { WasiManifest, WasiSession } from "../engines/wasi/wasiSession.js";
export * from "./engineManifest.js";

export const KERNEL_RUNTIME_CONTRACT_VERSION: 2;
export const KERNEL_RUNTIME_KIND: "cpython-wasi";
export const KERNEL_RUNTIME_METHODS: readonly [
  "describe", "execute", "getValue", "setValue", "checkpoint", "restore", "install", "installEnvironment", "inspect", "interrupt", "close"
];

export const VALUE_ENVELOPE_PROTOCOL: "pyproc.value-envelope";
export const VALUE_ENVELOPE_VERSION: 1;
export const APPLICATION_REFERENCE_PROTOCOL: "pyproc.application-ref";
export const APPLICATION_REFERENCE_VERSION: 1;

export interface ValueEnvelopeBase {
  readonly protocol: "pyproc.value-envelope";
  readonly version: 1;
}

export type ValueEnvelope = ValueEnvelopeBase & (
  | { readonly kind: "null" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "bigint"; readonly decimal: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bytes"; readonly base64: string; readonly byteLength: number; readonly sha256: `sha256:${string}` }
  | { readonly kind: "list"; readonly items: readonly ValueEnvelope[] }
  | { readonly kind: "map"; readonly entries: readonly (readonly [string, ValueEnvelope])[] }
  | { readonly kind: "artifact"; readonly artifactRef: string; readonly mediaType: string; readonly byteLength: number; readonly sha256: `sha256:${string}` }
  | { readonly kind: "ephemeralRef"; readonly ref: string; readonly type: string; readonly kernelRef: string; readonly generation: number; readonly expiresAt: number }
);

export interface ValueEnvelopeLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxInlineBytes?: number;
  maxStringBytes?: number;
  artifactThresholdBytes?: number;
}

export interface ValueArtifactStore {
  put(bytes: Uint8Array, metadata: { mediaType: string; sha256: string }): Promise<string | { artifactRef: string }>;
  get(artifactRef: string): Promise<ArrayBuffer | Uint8Array>;
}

export const DEFAULT_VALUE_LIMITS: Readonly<Required<ValueEnvelopeLimits>>;
export class MemoryValueArtifactStore implements ValueArtifactStore {
  put(bytes: Uint8Array, metadata?: { mediaType?: string; sha256?: string }): Promise<{ readonly artifactRef: string; readonly sha256: string; readonly byteLength: number }>;
  get(artifactRef: string): Promise<Uint8Array>;
}
export function assertValueEnvelope(envelope: unknown, options?: { limits?: ValueEnvelopeLimits }): asserts envelope is ValueEnvelope;
export function canonicalValueEnvelope(envelope: ValueEnvelope, options?: { limits?: ValueEnvelopeLimits }): ValueEnvelope;
export function encodeValueEnvelope(value: unknown, options?: { limits?: ValueEnvelopeLimits; artifactStore?: ValueArtifactStore }): Promise<ValueEnvelope>;
export function decodeValueEnvelope(envelope: ValueEnvelope, options?: { limits?: ValueEnvelopeLimits; artifactStore?: ValueArtifactStore }): Promise<unknown>;
export function digestValueEnvelope(envelope: ValueEnvelope, options?: { limits?: ValueEnvelopeLimits }): Promise<`sha256:${string}`>;

export interface ApplicationReference {
  readonly protocol: "pyproc.application-ref";
  readonly version: 1;
  readonly kernelRef: string;
  readonly generation: number;
  readonly ref: string;
  readonly type: string;
  readonly name: string;
  readonly operations: readonly string[];
}

export function createApplicationReference(input: Omit<ApplicationReference, "protocol" | "version">): ApplicationReference;
export function assertApplicationReference(reference: unknown, expected?: { kernelRef?: string; generation?: number; type?: string; operation?: string }): ApplicationReference;
export class ApplicationReferenceTable {
  constructor(options: { kernelRef: string; generation?: number });
  register(input: { type: string; name: string; operations?: string[] }): ApplicationReference;
  resolve(reference: ApplicationReference, expected?: { type?: string; operation?: string }): ApplicationReference;
  advanceGeneration(generation: number): void;
  close(): void;
}

export const KERNEL_CHECKPOINT_PROTOCOL: "pyproc.kernel-checkpoint";
export const KERNEL_CHECKPOINT_VERSION: 2;

export interface KernelMemorySnapshot {
  snapshotKind: "full" | "delta";
  parentIdx: number | null;
  deltaDepth: number;
  stackBoundary: number;
  initialPages: number;
  currentPages: number;
  memoryBytes: number;
  regionBytes: number;
  changedPages: number;
  pages: Array<[number, Uint8Array]>;
}

export interface KernelCheckpointDescriptor {
  readonly protocol: "pyproc.kernel-checkpoint";
  readonly version: 2;
  readonly checkpointRef: string;
  readonly digest: `sha256:${string}`;
  readonly engineId: string;
  readonly environmentId: string;
  readonly kernelProtocol: 2;
  readonly hostcallAbi: 1;
  readonly memoryLayout: { readonly initialPages: number; readonly currentPages: number; readonly stackBoundary: number };
  readonly memoryImageRef: string;
  readonly memoryImageSha256: `sha256:${string}`;
  readonly snapshotKind: "full" | "delta";
  readonly deltaDepth: number;
  readonly changedPages: number;
  readonly vfsRootDigest: string | null;
  readonly openResources: readonly unknown[];
  readonly executionCursor: number;
  readonly parentCheckpointRef: string | null;
  readonly createdAt: string;
}

export interface KernelCheckpointVerificationContext {
  artifactStore: ValueArtifactStore;
  engineId: string;
  environmentId: string;
  resolveParent?: (checkpointRef: string) => Promise<KernelCheckpointDescriptor | null>;
}

export function packKernelMemoryImage(snapshot: KernelMemorySnapshot): Uint8Array;
export function unpackKernelMemoryImage(bytes: ArrayBuffer | Uint8Array): Readonly<Pick<KernelMemorySnapshot,
  "snapshotKind" | "stackBoundary" | "memoryBytes" | "regionBytes" | "pages">>;
export function sealKernelCheckpoint(snapshot: KernelMemorySnapshot, context: KernelCheckpointVerificationContext & {
  executionCursor: number;
  parentCheckpointRef?: string | null;
  vfsRootDigest?: string | null;
  openResources?: unknown[];
  createdAt?: string;
}): Promise<KernelCheckpointDescriptor>;
export function verifyKernelCheckpointDescriptor(descriptor: KernelCheckpointDescriptor,
  context: KernelCheckpointVerificationContext): Promise<Readonly<Record<string, unknown>>>;
export function materializeKernelCheckpoint(descriptor: KernelCheckpointDescriptor,
  context: KernelCheckpointVerificationContext): Promise<Uint8Array>;

export class KernelReactiveController {
  constructor(kernel: KernelRuntimeContractV2);
  checkpoint(options?: KernelRequestMetadata & { parentCheckpointRef?: string | null }): Promise<KernelCheckpointDescriptor>;
  restore(checkpointRef: string): Promise<Readonly<Record<string, unknown>>>;
  branch(checkpointRef?: string | null): Readonly<{ parentCheckpointRef: string | null }>;
  prune(checkpointRef: string): boolean;
  inspect(): Readonly<{ headCheckpointRef: string | null; checkpointRefs: readonly string[] }>;
}

export const KERNEL_VFS_ROOT_PROTOCOL: "pyproc.kernel-vfs-root";
export const KERNEL_VFS_ROOT_VERSION: 1;

export const HOSTCALL_ABI_VERSION: 1;
export const HOSTCALL_MAGIC: number;
export const HOSTCALL_CONTROL_WORDS: 16;
export const HOSTCALL_DATA_BYTES: number;
export const HOSTCALL_STREAM_MAX_CREDIT: number;
export const HOSTCALL_PATH: "/hostcall";
export const HOSTCALL_REQUEST_HEADER_BYTES: 36;
export const HOSTCALL_RESPONSE_HEADER_BYTES: 20;
export const HOSTCALL_WORD: Readonly<Record<"magic" | "abiVersion" | "state" | "opcode" | "flags" | "requestIdLow" | "requestIdHigh" | "requestOffset" | "requestLength" | "responseOffset" | "responseCapacity" | "responseLength" | "errorCode" | "deadlineMs", number>>;
export const HOSTCALL_STATE: Readonly<Record<"idle" | "request" | "processing" | "response" | "error" | "cancelled" | "timeout" | "brokerLost" | "outcomeUnknown", number>>;
export const HOSTCALL_ERROR: Readonly<Record<"none" | "invalid" | "denied" | "overflow" | "timeout" | "cancelled" | "brokerLost" | "conflict" | "provider" | "outcomeUnknown", number>>;
export const HOSTCALL_FLAG: Readonly<Record<"externalEffect" | "stream" | "redacted", number>>;
export const HOSTCALL_OPCODE: Readonly<Record<"noop" | "clock" | "entropy" | "terminalWrite"
  | "httpRequest" | "httpBodyRead" | "httpCancel" | "socketConnect" | "socketSend"
  | "socketReceive" | "socketClose" | "processSpawn" | "processWait" | "processSignal"
  | "processPipe" | "gpuDispatch" | "clipboardRead" | "clipboardWrite"
  | "framebufferPublish" | "asgiExchange", number>>;
export function createHostcallSharedState(control: SharedArrayBuffer, data: SharedArrayBuffer):
  Readonly<{ control: SharedArrayBuffer; data: SharedArrayBuffer }>;
export function assertHostcallControl(control: Int32Array, data: Uint8Array): true;
export function hostcallRequestId(control: Int32Array): bigint;
export function hostcallTerminalState(state: number): boolean;

export interface KernelVfsStore {
  put(kind: string, key: string, bytes: Uint8Array): Promise<void>;
  get(kind: string, key: string): Promise<Uint8Array | null>;
  list(kind: string): Promise<string[]>;
  remove(kind: string, key: string): Promise<boolean>;
  getHead(): Promise<Readonly<Record<string, unknown>> | null>;
  compareAndSwapHead(expectedRootDigest: string | null, nextHead: Readonly<Record<string, unknown>>): Promise<boolean>;
  replaceHead(nextHead: Readonly<Record<string, unknown>>): Promise<void>;
}

export class MemoryKernelVfsStore implements KernelVfsStore {
  put(kind: string, key: string, bytes: Uint8Array): Promise<void>;
  get(kind: string, key: string): Promise<Uint8Array | null>;
  list(kind: string): Promise<string[]>;
  remove(kind: string, key: string): Promise<boolean>;
  getHead(): Promise<Readonly<Record<string, unknown>> | null>;
  compareAndSwapHead(expectedRootDigest: string | null, nextHead: Readonly<Record<string, unknown>>): Promise<boolean>;
  replaceHead(nextHead: Readonly<Record<string, unknown>>): Promise<void>;
}

export class OpfsKernelVfsStore implements KernelVfsStore {
  static open(options: { volumeName: string; root?: FileSystemDirectoryHandle }): Promise<OpfsKernelVfsStore>;
  put(kind: string, key: string, bytes: Uint8Array): Promise<void>;
  get(kind: string, key: string): Promise<Uint8Array | null>;
  list(kind: string): Promise<string[]>;
  remove(kind: string, key: string): Promise<boolean>;
  getHead(): Promise<Readonly<Record<string, unknown>> | null>;
  compareAndSwapHead(expectedRootDigest: string | null, nextHead: Readonly<Record<string, unknown>>): Promise<boolean>;
  replaceHead(nextHead: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface KernelDeviceProvider {
  operations: string[];
  invoke(operation: string, input: unknown, context: unknown): Promise<unknown>;
  checkpointDisposition(): "closed" | "reopenable" | "reconcile" | "forbidden";
}
export interface KernelDeviceReference {
  readonly protocol: "pyproc.device-ref";
  readonly version: 1;
  readonly path: string;
  readonly name: string;
  readonly operations: readonly string[];
}
export class KernelDeviceRegistry {
  constructor(options?: { authorize?: (request: Readonly<Record<string, unknown>>) => boolean | Promise<boolean> });
  register(name: string, provider: KernelDeviceProvider): KernelDeviceReference;
  invoke(reference: KernelDeviceReference, operation: string, input: unknown, context?: unknown): Promise<unknown>;
  checkpointResources(): ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface KernelVfsTransaction {
  readonly transactionId: string;
  readonly baseRootDigest: string;
  write(path: string, value: string | ArrayBuffer | Uint8Array, options?: { mode?: number }): Promise<void>;
  remove(path: string): void;
  rename(from: string, to: string): void;
  commit(options?: { faultInjector?: (step: string, context: Readonly<Record<string, unknown>>) => void | Promise<void> }): Promise<Readonly<{ protocol: "pyproc.kernel-vfs-commit"; version: 1; transactionId: string; baseRootDigest: string; rootDigest: string; sequence: number; objectCount: number }>>;
  abort(): void;
}

export interface KernelCheckpointBoundary {
  readonly acceptedHostcalls: number;
  readonly activeTransactions: number;
  readonly outputDrained: boolean;
  readonly openResources: readonly unknown[];
  readonly vfsRootDigest?: string | null;
}
export interface KernelCheckpointCoordinator {
  inspectCheckpointBoundary(): KernelCheckpointBoundary | Promise<KernelCheckpointBoundary>;
}

export class KernelVfs {
  constructor(store: KernelVfsStore, options?: { volumeId?: string; ownerId?: string; leaseMs?: number; now?: () => number; devices?: KernelDeviceRegistry });
  readonly rootDigest: string | null;
  readonly ownerEpoch: number | null;
  readonly devices: KernelDeviceRegistry;
  open(): Promise<Readonly<Record<string, unknown>>>;
  renew(): Promise<void>;
  recover(): Promise<Readonly<Record<string, unknown>>>;
  beginTransaction(): KernelVfsTransaction;
  read(path: string): Promise<Uint8Array>;
  writeTmp(path: string, value: string | ArrayBuffer | Uint8Array): void;
  list(prefix?: string): readonly string[];
  mounts(): ReadonlyArray<Readonly<{ path: string; provider: string; durability: string }>>;
  inspectCheckpointBoundary(): Promise<KernelCheckpointBoundary & { vfsRootDigest: string | null }>;
}

export interface KernelRequestMetadata {
  commandId?: string;
  generation?: number;
  deadlineAt?: number;
  cancellationRef?: string;
  authorityRef?: string;
  expectedStateDigest?: string;
}

export interface KernelDescriptor {
  readonly protocol: "pyproc.kernel-descriptor";
  readonly version: 1;
  readonly runtimeContractVersion: 2;
  readonly runtimeKind: "cpython-wasi";
  readonly kernelRef: string;
  readonly generation: number;
  readonly lifecycleState: string;
  readonly engineId: string | null;
  readonly nativeProfile: string;
  readonly threading: import("./engineManifest.js").KernelThreadCapability | null;
  readonly environmentId: string;
  readonly workerOwned: true;
  readonly directHeapAccess: false;
  readonly liveObjectProxy: false;
  readonly valueEnvelopeVersion: 1;
  readonly applicationReferences: "generation-bound";
  readonly vfsRootDigest: string | null;
}

export interface KernelPackageEnvironmentBootstrap {
  readonly protocol: "pyproc.package-environment-bootstrap";
  readonly version: 1;
  readonly environmentId: `sha256:${string}`;
  readonly lockDigest: string | null;
  readonly policyDigest: string | null;
  readonly allowedTags: readonly string[];
  readonly limits: Readonly<Record<string, number>> | null;
  readonly wheels: readonly Readonly<{ filename: string; name: string; version: string;
    sha256: `sha256:${string}`; bytes: Uint8Array }>[];
}

export interface KernelError {
  readonly code: string;
  readonly phase: "validate" | "queue" | "execute" | "hostcall" | "serialize" | "checkpoint" | "restore" | "install" | "close";
  readonly message: string;
  readonly retry: "never" | "sameCommand" | "newGeneration" | "operatorDecision";
  readonly pythonType?: string;
}

export interface OutputChunk {
  readonly sequence: number;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface ExecutionRequest extends KernelRequestMetadata {
  code: string;
}

export interface ExecutionResult {
  readonly protocol: "pyproc.execution-result";
  readonly version: 1;
  readonly executionRef: string;
  readonly state: "completed" | "failed" | "cancelled" | "terminated" | "outcomeUnknown";
  readonly stdout: readonly OutputChunk[];
  readonly stderr: readonly OutputChunk[];
  readonly displayArtifacts: readonly unknown[];
  readonly mutated: boolean;
  readonly beforeStateDigest: string;
  readonly afterStateDigest?: string;
  readonly error?: KernelError;
  readonly timing: { readonly durationMs: number };
}

export interface KernelEvent {
  readonly protocol: "pyproc.kernel-event";
  readonly version: 1;
  readonly kernelRef: string;
  readonly generation: number;
  readonly commandId: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: unknown;
}

export interface KernelRuntimeContractV2 {
  readonly runtimeContractVersion: 2;
  readonly runtimeKind: "cpython-wasi";
  describe(): Promise<KernelDescriptor>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  getValue(request: KernelRequestMetadata & { name: string }): Promise<{ readonly protocol: "pyproc.value-result"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly value: ValueEnvelope; readonly valueDigest: `sha256:${string}` }>;
  setValue(request: KernelRequestMetadata & { name: string; value: ValueEnvelope }): Promise<{ readonly protocol: "pyproc.mutation-receipt"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly valueDigest: `sha256:${string}`; readonly beforeStateDigest: string; readonly afterStateDigest: string }>;
  checkpoint(request?: KernelRequestMetadata & { parentCheckpointRef?: string | null }): Promise<KernelCheckpointDescriptor & { readonly commandId: string; readonly state: "completed"; readonly generation: number; readonly stateDigest: string }>;
  restore(request: KernelRequestMetadata & { checkpointRef: string; checkpoint?: KernelCheckpointDescriptor }): Promise<{ readonly protocol: "pyproc.restore-receipt"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly checkpointRef: string; readonly checkpoint: KernelCheckpointDescriptor; readonly generation: number; readonly stateDigest: string }>;
  install(request: KernelRequestMetadata & { wheel: ArrayBuffer | Uint8Array }): Promise<{ readonly protocol: "pyproc.environment-receipt"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly wheelDigest: string; readonly installed: { files: number; names: string[] }; readonly beforeStateDigest: string; readonly afterStateDigest: string }>;
  installEnvironment(request: KernelRequestMetadata & { environmentId: `sha256:${string}`; lockDigest?: string;
    policyDigest?: string; allowedTags: string[]; limits?: import("../wheelInstaller.js").WheelLimits;
    wheels: Array<{ filename: string; name: string; version: string; sha256: string; bytes: ArrayBuffer | Uint8Array }> }): Promise<{
      readonly protocol: "pyproc.environment-receipt"; readonly version: 2; readonly commandId: string;
      readonly state: "completed"; readonly environmentId: `sha256:${string}`; readonly lockDigest: string | null;
      readonly policyDigest: string | null; readonly installed: Readonly<Record<string, unknown>>;
      readonly beforeStateDigest: string; readonly afterStateDigest: string;
    }>;
  inspect(request?: KernelRequestMetadata): Promise<{ readonly protocol: "pyproc.inspection-result"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly descriptor: KernelDescriptor; readonly stateDigest: string; readonly queuedCommands: number; readonly activeCommandId: string | null }>;
  interrupt(request?: { targetCommandId?: string }): Promise<{ readonly protocol: "pyproc.interrupt-receipt"; readonly version: 1; readonly state: "notRunning" | "cancelled" | "terminated"; readonly targetCommandId?: string }>;
  close(): Promise<{ readonly protocol: "pyproc.close-receipt"; readonly version: 1; readonly state: "closed" }>;
  registerApplication(request: KernelRequestMetadata & { name: string; type: string; operations: string[] }): Promise<{ readonly protocol: "pyproc.application-registration"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly applicationRef: ApplicationReference }>;
  invokeApplication(request: KernelRequestMetadata & { applicationRef: ApplicationReference; operation?: string; args: ValueEnvelope[] }): Promise<{ readonly protocol: "pyproc.application-result"; readonly version: 1; readonly commandId: string; readonly state: "completed"; readonly applicationRef: ApplicationReference; readonly value: ValueEnvelope; readonly valueDigest: `sha256:${string}` }>;
  verifyCheckpoint(request: KernelRequestMetadata & { checkpoint: KernelCheckpointDescriptor }): Promise<{ readonly protocol: "pyproc.checkpoint-verification"; readonly version: 1; readonly commandId: string; readonly state: "verified"; readonly checkpointRef: string }>;
}

export class CpythonWasiKernelRuntime implements KernelRuntimeContractV2 {
  constructor(session: WasiSession, options?: { kernelRef?: string; engineId?: string | null; nativeProfile?: string;
    threading?: import("./engineManifest.js").KernelThreadCapability | null;
    environmentId?: string | null;
    artifactStore?: ValueArtifactStore; valueLimits?: ValueEnvelopeLimits;
    checkpointCoordinator?: KernelCheckpointCoordinator;
    kernelVfs?: KernelVfs; restoredCheckpoint?: KernelCheckpointDescriptor | null;
    restoredCheckpoints?: KernelCheckpointDescriptor[];
    onEnvironmentChanged?: ((environment: KernelPackageEnvironmentBootstrap | null) => void) | null });
  readonly runtimeContractVersion: 2;
  readonly runtimeKind: "cpython-wasi";
  readonly engineId: string | null;
  readonly nativeProfile: string;
  onEvent(listener: (event: KernelEvent) => void): () => void;
  describe(): Promise<KernelDescriptor>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  getValue(request: Parameters<KernelRuntimeContractV2["getValue"]>[0]): ReturnType<KernelRuntimeContractV2["getValue"]>;
  setValue(request: Parameters<KernelRuntimeContractV2["setValue"]>[0]): ReturnType<KernelRuntimeContractV2["setValue"]>;
  checkpoint(request?: KernelRequestMetadata): ReturnType<KernelRuntimeContractV2["checkpoint"]>;
  restore(request: Parameters<KernelRuntimeContractV2["restore"]>[0]): ReturnType<KernelRuntimeContractV2["restore"]>;
  install(request: Parameters<KernelRuntimeContractV2["install"]>[0]): ReturnType<KernelRuntimeContractV2["install"]>;
  installEnvironment(request: Parameters<KernelRuntimeContractV2["installEnvironment"]>[0]): ReturnType<KernelRuntimeContractV2["installEnvironment"]>;
  inspect(request?: KernelRequestMetadata): ReturnType<KernelRuntimeContractV2["inspect"]>;
  interrupt(request?: Parameters<KernelRuntimeContractV2["interrupt"]>[0]): ReturnType<KernelRuntimeContractV2["interrupt"]>;
  close(): ReturnType<KernelRuntimeContractV2["close"]>;
  registerApplication(request: Parameters<KernelRuntimeContractV2["registerApplication"]>[0]): ReturnType<KernelRuntimeContractV2["registerApplication"]>;
  invokeApplication(request: Parameters<KernelRuntimeContractV2["invokeApplication"]>[0]): ReturnType<KernelRuntimeContractV2["invokeApplication"]>;
  verifyCheckpoint(request: Parameters<KernelRuntimeContractV2["verifyCheckpoint"]>[0]): ReturnType<KernelRuntimeContractV2["verifyCheckpoint"]>;
}

export interface CpythonWasiKernelManifest extends WasiManifest {
  kernelRef?: string;
  engineId?: string;
  nativeProfile?: string;
  threading?: import("./engineManifest.js").KernelThreadCapability | null;
  environmentId?: string;
  artifactStore?: ValueArtifactStore;
  valueLimits?: ValueEnvelopeLimits;
  checkpointCoordinator?: KernelCheckpointCoordinator;
  kernelVfs?: KernelVfs;
  restoredCheckpoint?: KernelCheckpointDescriptor;
  restoredCheckpoints?: KernelCheckpointDescriptor[];
  packageEnvironment?: KernelPackageEnvironmentBootstrap;
  onEnvironmentChanged?: ((environment: KernelPackageEnvironmentBootstrap | null) => void) | null;
}

export function assertKernelRuntimeContract<T extends KernelRuntimeContractV2>(runtime: T): T;
export function bootCpythonWasiKernel(manifest: CpythonWasiKernelManifest): Promise<CpythonWasiKernelRuntime>;
