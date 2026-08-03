// Type declarations for the pyproc public surface. The source is plain ESM .js; this file is
// what gives TypeScript callers the contract. There is no build step, so it is maintained by
// hand and updated together with the source.

import type { PyProcAssetIntegrityManifest } from "./src/runtime/assets.js";

/** Codes of the one error contract every error in src uses. The catalog matches src/runtime/errors.js. */
export type PyProcErrorCode =
  | "PYPROC_ENV_UNSUPPORTED"
  | "PYPROC_INPUT_INVALID"
  | "PYPROC_BOOT_FAILED"
  | "PYPROC_ASSET_INTEGRITY"
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
  | "PYPROC_RPC_OUTCOME_UNKNOWN"
  | "PYPROC_LEADER_UNAVAILABLE"
  | "PYPROC_SPLIT_BRAIN"
  | "PYPROC_LEADER_LOCK_FAILED"
  | "PYPROC_RPC_ACTION_INVALID"
  | "PYPROC_PARTICIPANT_LEFT"
  | "PYPROC_KERNEL_EXECUTION_ERROR"
  | "PYPROC_GPU_UNAVAILABLE"
  | "PYPROC_INTERNAL";

export const PYPROC_ERROR_CODES: readonly PyProcErrorCode[];

/**
 * pyproc's single error contract. Branch on `code`, never on `message`.
 * `retryable` says whether a retry is safe. An outcome that is unknown after the request was
 * sent (PYPROC_RPC_OUTCOME_UNKNOWN) is always retryable=false: never re-run it automatically.
 * A Python exception raised inside a worker crosses the postMessage boundary with its class name
 * (KeyboardInterrupt and so on) in context.pyExcType.
 */
export class PyProcError extends Error {
  constructor(code: PyProcErrorCode, message: string, opts?: { retryable?: boolean; context?: Record<string, unknown>; cause?: unknown });
  readonly name: "PyProcError";
  code: PyProcErrorCode;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export interface EnvIssue {
  /** Machine-readable code: "no-cross-origin-isolation" | "no-jspi". */
  code: string;
  /** The platform capability that is missing. */
  need: string;
  /** Why it matters: which features are blocked without it. */
  why: string;
  /** How to fix it, as a step you can copy and paste. */
  fix: string;
}

export interface EnvReport {
  /** True when every capability including the process OS is available. Even when false the base surface (boot/run/enableReactive) still works. */
  ok: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  jspi: boolean;
  /** Capabilities that are not ready, with the fix for each. Ignorable if you only use the base surface. */
  issues: EnvIssue[];
}

export type CoreIntegrityMap = Record<string, string>;

export interface CoreIntegrityPolicy {
  /** Keyed by an indexURL-relative path, a URL pathname, an absolute URL, or a file name; the value is a standard SRI string (sha256-...). */
  files: CoreIntegrityMap;
  /** When true (the default), a fetched indexURL asset that is absent from the manifest fails the boot. */
  required?: boolean;
}

export interface CoreAssetStats {
  hits: number;
  misses: number;
  /** Assets that passed SHA-256 verification against coreIntegrity. */
  verified: number;
  /** Assets rejected because the required manifest did not list them. */
  integrityMissing: number;
}

/**
 * Environment diagnostics: the honest answer to "can I just import this?". The base surface
 * (boot/run/enableReactive) runs in Chromium with no setup, but PyProc (the process OS), IPC,
 * and blocking sockets require crossOriginIsolated (COOP/COEP headers) plus JSPI. This function
 * reports what is ready and, for whatever is not, what to change and how.
 */
export function checkEnvironment(): EnvReport;

export interface BootOptions {
  /** Pyodide distribution URL. Defaults to the verified same-origin path /vendor/pyodide/. */
  indexURL?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Packages to preload during boot. */
  packages?: string[];
  /** Environment variables applied before CPython initializes, e.g. { PYTHONHASHSEED: "0" } for a deterministic boot. */
  env?: Record<string, string>;
  /** Caches the core assets (wasm/stdlib/lock) in this directory so a later boot touches the network zero times. */
  coreCacheDir?: FileSystemDirectoryHandle;
  /** Browser SRI value for pyodide.js. The pinned default is enforced before the first boot; false explicitly disables it. */
  engineScriptIntegrity?: string | false;
  /** SRI-verifies fetched engine assets. The pinned core policy is the default; false explicitly disables it. */
  coreIntegrity?: CoreIntegrityMap | CoreIntegrityPolicy | false;
  /** Output of the pyproc-assets CLI. Worker capabilities created from a Runtime SRI-verify the graph before spawning. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  /** Replacement lock file, e.g. the output of Runtime.freeze(): the same versions reproduce with zero resolution. */
  lockFileURL?: string;
  /** loadPyodide imported by a worker caller, where there is no document. Passing it skips the script load and leaves globalThis untouched. */
  loadPyodide?: (cfg: unknown) => Promise<unknown>;
}

export interface EngineHostValueOptions {
  /** copy (the default) copies into a host value; preserve keeps the engine proxy. The adapter translates this into engine-specific options. */
  proxyMode?: "copy" | "preserve";
  /** Fallback returned when the value is undefined or the host conversion fails. Without it, the failure propagates as a throw. */
  fallback?: unknown;
}

export interface RuntimeContract {
  readonly runtimeContractVersion: 1;
  readonly runtimeKind: string;
  capabilities(): readonly string[] | Set<string>;
  runAsync(code: string): Promise<unknown>;
  getGlobal(name: string): unknown | Promise<unknown>;
  setGlobal(name: string, value: unknown): void | Promise<void>;
  toHostValue(value: unknown, options?: EngineHostValueOptions): unknown;
  destroyHostValue(value: unknown): void;
}

export interface EnvManifest {
  indexURL?: string;
  env?: Record<string, string>;
  /** Lock file URL, the output of freeze(). This is the axis of environment reproducibility. */
  lockFileURL?: string;
  /** Packages to load at boot: the environment declaration. */
  packages?: string[];
  /** Python to run right after boot, e.g. "import numpy" to warm it up. */
  setup?: string;
}

export interface EnvBootStats {
  /** snapshot (warm) | coldFill (cold, then fill the cache) | cold (cache unused). */
  lane: "snapshot" | "coldFill" | "cold";
  bootMs: number;
  installMs: number;
  setupMs: number;
  totalMs: number;
  /** Why filling the snapshot cache failed. The boot continues regardless. */
  cacheError?: string;
}

export interface CheckpointInfo {
  index: number;
  changedPages: number;
  deltaBytes: number;
  kind: "base" | "delta";
  /** Parent of this node, i.e. whichever node was live when it was made. Checkpointing after restoring to the past creates a branch. */
  parent?: number;
  /** Stack pointer at checkpoint time, stored on the node. restore() consumes it automatically. */
  sp: number | null;
  /** Restores to this checkpoint (equivalent to restoreLive(index)). This is the canonical restore: no need to carry sp around. */
  restore(opts?: { rehash?: boolean }): RestoreInfo;
}

export interface CheckpointNode {
  index: number;
  parent: number;
  children: number[];
}

export interface RestoreInfo {
  pagesWritten: number;
  mbWritten: number;
  /** Whether this restore took the rehash path. True when a boundary violation was detected automatically. */
  rehashed: boolean;
}

export interface SyscallBridgeConfig {
  /** Synchronous input handler: input() receives this value from either run() or runAsync(). */
  input?: (prompt: string) => string | null;
  /** Asynchronous input handler, for terminals. On the runAsync (JSPI) path, input() blocks on it. */
  inputAsync?: (prompt: string) => Promise<string | null>;
  /** Proxy URL that HTTP requests are routed through. Without it, requests go direct and are limited to CORS/same-origin targets. */
  proxyUrl?: string;
  /** When true, wires up the requests family (pyodide-http patch_all; absolute URLs only). */
  requests?: boolean;
  /** Verifies the processWorker graph before creating a subprocess child worker. Omit to inherit Runtime.assetIntegrity. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

export interface SyscallInstallInfo {
  installed: string[];
  /** Whether JSPI (WebAssembly.Suspending) is available: the precondition for subprocess and async input. */
  jspi: boolean;
  proxyUrl: string | null;
}

export interface PyProcOptions {
  indexURL?: string;
  /** Browser SRI value for the process engine script. The pinned default is used unless false. */
  engineScriptIntegrity?: string | false;
  /** Packages each process loads at boot, e.g. ["numpy"]. */
  packages?: string[];
  /** Python warm-up code run at boot, e.g. "import numpy". */
  setup?: string;
  /**
   * Replay manifest. Supply it and the workers boot by deterministic replay, landing on
   * byte-identical heaps. That is the precondition for fork (cloning live state): a delta is only
   * valid when the processes are symmetric.
   */
  replay?: { env?: Record<string, string>; packages?: string[]; setup?: string };
  /** SRI-verifies the processWorker graph before spawning the worker pool. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

/** POSIX signal numbers, delivered to the worker's CPython eval loop over a SAB channel. */
declare const SIGNAL: { INT: 2; USR1: 10; USR2: 12; TERM: 15 };

export interface ForkInfo {
  pages: number;
  mb: number;
  /** Pages of drift outside the delta that were reverted to the replay boundary on the child (dst). fork produces exactly "boundary plus parent delta". */
  reverted: number;
  harvestMs: number;
  applyMs: number;
}

export interface PyProcBootInfo {
  workers: number;
  avgBootMs: number;
  forked: boolean;
}

export interface PyProcEntry {
  pid: number;
  state: string;
  parentPid: number;
}

/** Capability contract that encapsulates WASM heap access. Callers never touch HEAPU8 directly. */
declare class MemoryCapability {
  heap(): Uint8Array;
  byteLength(): number;
  stackSave(): number | null;
  stackRestore(sp: number | null): void;
  pageHashes(): Uint32Array;
  slicePage(p: number): Uint8Array;
  sliceAll(): Uint8Array;
  writePage(p: number, bytes: Uint8Array): void;
  writeBase(base: Uint8Array): void;
}

/**
 * Restore-based reactivity: a full-hash checkpoint **tree**, live-diff restore, and time travel
 * with branching. Restore to a past node and then checkpoint() and you get a branch whose parent
 * is that node - git for a machine. Delta resolution follows the parent chain, so pages from a
 * sibling branch never leak in.
 */
declare class ReactiveController {
  /** The checkpoint tree: parent and children of every node. */
  tree(): CheckpointNode[];
  /**
   * Saves the current heap as a checkpoint and returns a restore handle. A single cp.restore()
   * call is the canonical restore: the stack pointer is stored on the node, so nothing has to be
   * carried around.
   */
  checkpoint(): CheckpointInfo;
  /** Omit savedSP (null) to use the sp stored on the node. A pruned node yields PYPROC_CHECKPOINT_PRUNED. */
  restore(j: number, savedSP?: number | null): void;
  /**
   * A boundary violation - execution or mutation since the last checkpoint/restore - is detected
   * automatically and the restore takes the rehash path. opts.rehash forces a rehash. Omit savedSP
   * to use the sp stored on the node.
   * Caveat: mutations made by calling into Python through a live PyProxy from getGlobal are not
   * detected. After such a mutation, do not trust the fast path without markDirty() or opts.rehash.
   */
  restoreLive(j: number, savedSP?: number | null, opts?: { rehash?: boolean }): RestoreInfo;
  /**
   * Collects the user state between two checkpoints as { pages, bin }: the shared primitive
   * behind session save, journal commit, and image export. toIdx must be a live node, so call this
   * right after closing the boundary with checkpoint(). With opts.pack false, bin is null, which
   * avoids a reallocation for callers that only need the page list.
   */
  collectDelta(fromIdx?: number, toIdx?: number, opts?: { pack?: boolean }): { pages: number[]; bin: Uint8Array | null; sp: number | null; heapLen: number };
  /** Declares an external mutation: call it after an uninstrumented heap change (such as a live PyProxy call) and the next restoreLive is promoted to the rehash path. */
  markDirty(): void;
  /**
   * The full page-hash array of node j. Only the boundary keeps a full array; every node above it
   * stores just the pages it changed, so this folds the root-to-j chain to answer. A pruned node on
   * that chain is refused with PYPROC_CHECKPOINT_PRUNED.
   */
  hashesAt(j: number): Uint32Array;
  /**
   * Releases the deltas and hashes of nodes outside the root-to-j parent chain: the RAM relief
   * valve of the checkpoint tree. Restoring a released node is refused with
   * PYPROC_CHECKPOINT_PRUNED, and liveIdx must lie on the retained path.
   */
  pruneTo(j: number): { freedNodes: number; freedMB: number; keptNodes: number };
  /**
   * Fold the root-to-live path into the base so the live node becomes the new replay boundary.
   * Pruning only frees nodes off that path, so a linear history (the shape a per-statement
   * checkpoint produces) gets nothing back from it; this is the valve that works there.
   *
   * The boundary moves, which is breaking for anything written against the old one: a journal or
   * image committed earlier is refused with `PYPROC_REPLAY_MISMATCH`, and time travel to a
   * checkpoint before the new boundary is refused with `PYPROC_CHECKPOINT_PRUNED`. Only the live
   * node may become the boundary.
   */
  rebaseTo(j: number): { foldedNodes: number; foldedMB: number; prunedNodes: number; baseMB: number };
  /** Counts boundary moves. A consumer caching the boundary fingerprint drops its cache when this changes. */
  readonly boundaryEpoch: number;
  stats(): ReactiveStats;
  setRetentionPolicy(policy: ReactiveRetentionPolicy | null): Readonly<ReactiveRetentionPolicy> | null;
  /** Releases the whole tree. Restoring an existing node is refused, and the next checkpoint() starts a new tree. */
  dispose(): void;
  stackSave(): number | null;
  storageMB(): number;
  /**
   * Backs the base heap up to a file handle. This does not reduce RAM, because the restore path
   * assumes the base stays resident; pruneTo and dispose are the canonical memory relief valves.
   * The caller supplies the handle.
   */
  saveBase(dir: FileSystemDirectoryHandle, name: string): Promise<{ bytes: number }>;
  loadBase(dir: FileSystemDirectoryHandle, name: string): Promise<{ bytes: number }>;
}

export interface ReactiveStats {
  baseBytes: number;
  deltaBytes: number;
  hashBytes: number;
  totalBytes: number;
  totalMB: number;
  nodeSlots: number;
  activeNodes: number;
  prunedNodes: number;
  branches: number;
  liveIdx: number;
  liveDepth: number;
  pressure: ReactivePressureEvent | null;
}

export interface ReactiveRetentionPolicy {
  maxNodes?: number;
  maxDeltaBytes?: number;
  maxTotalBytes?: number;
  /** When true, exceeding the budget auto-prunes only branches off the live path; the live path is preserved. */
  pruneBranches?: boolean;
  /**
   * Defaults to false. When the limit is still exceeded after pruning, fold the live path into the
   * base (see `rebaseTo`). Off by default because it moves the replay boundary: the session keeps
   * running and keeps its state, but its past and any journal or image written against the old
   * boundary are gone. Turn it on when a long-lived session matters more than its history.
   */
  rebaseLinear?: boolean;
  onPressure?: (event: ReactivePressureEvent) => void;
}

export interface ReactivePressureEvent {
  trigger: "checkpoint" | "policy";
  exceeded: readonly ("maxNodes" | "maxDeltaBytes" | "maxTotalBytes")[];
  before: ReactiveStats;
  after: ReactiveStats;
  pruned: { freedNodes: number; freedMB: number; keptNodes: number } | null;
}

/** Borrowed syscalls v1: input() (sync or JSPI), urllib (sync XHR, with a proxyUrl option), and subprocess (a child worker). */
declare class SyscallBridge {
  install(): Promise<SyscallInstallInfo>;
}

export interface AsgiServerConfig {
  /** Name of the Python global holding the ASGI app (default "app"). */
  app?: string;
}

export interface AsgiResponse {
  status: number;
  headers: [string, string][];
  /** utf-8 text view of the response body, for JSON or HTML. */
  body: string;
  /** Raw bytes of the response body, canonical for binary responses. Equivalent to .text/.content in requests. */
  bodyBytes: Uint8Array;
}

/**
 * ASGI server inside the kernel: dispatches FastAPI/Starlette with zero sockets. Endpoints must
 * be async def. body is text or a byte buffer, headers is an array of [k, v] pairs, and
 * content-type defaults to json when unset. The helper re-reads the app global on every request,
 * so reassigning that global is a hot swap for a dev loop. lifespan events do not fire.
 */
declare class AsgiServer {
  install(): Promise<{ app: string; transport: string }>;
  serve(method: string, path: string, body?: string | Uint8Array | null, query?: string, headers?: [string, string][] | null): Promise<AsgiResponse>;
}

/**
 * Gives the Python server a real URL. Register pyprocSw.js (an asset in the same folder) on the
 * caller origin with navigator.serviceWorker.register(".../pyprocSw.js?asgi=/pyproc/") and every
 * fetch under that prefix is answered by AsgiServer through this binding. The SW only routes; the
 * kernel produces the response body. bind() registers the kernel with the SW (a hello), so fetches
 * from documents served on the virtual origin (an iframe or another tab) also route to the kernel.
 * If the kernel does not answer, the SW cuts the request with a 504 (tune with ?asgiTimeout=).
 * Walls: Set-Cookie on a synthetic SW response is stripped, so cookie sessions are impossible -
 * use tokens - and WebSocket upgrades are not intercepted.
 */
declare class VirtualOrigin {
  constructor(asgi: AsgiServer);
  bind(): VirtualOrigin;
  unbind(): void;
}

export interface MachineContainerOptions {
  /** Engine distribution the container kernel boots from (defaults to the parent's rt.indexURL). */
  indexURL?: string;
  /** SRI-verifies the machineWorker graph before spawning the container worker. Omit to inherit Runtime.assetIntegrity. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

export interface ContainerManifest {
  env?: Record<string, string>;
  /** Packages this container loads at boot: its own package set, the equivalent of a Docker image layer. */
  packages?: string[];
  /** Python run right after boot, establishing the container's initial state. */
  setup?: string;
}

export interface ContainerHandle {
  readonly cid: string;
  readonly bootMs: number;
  /** Runs code inside the container over RPC and returns the result value (JSON-serializable). */
  run(code: string): Promise<unknown>;
  /** Byte length of the container heap. */
  heapLen(): Promise<number>;
  /** Kills this container by terminating its worker. Address spaces are independent, so nothing outside is affected. */
  kill(): boolean;
}

/**
 * A machine inside the machine: starts a container kernel in a worker and exposes it to the
 * parent's Python as a value. This completes Docker's three parts in the browser - the image
 * (.pymachine plus SHA-256 plus trust), the registry (OPFS), and execution (this capability).
 * Each container is an independent kernel booted from its own manifest (its own package set), and
 * nesting to depth 2 or more works: containers inside containers. Killing one from inside
 * terminates only that worker and leaves everything outside untouched. After install(), Python
 * creates containers as values with pyprocMachine.spawn() (blocking, so JSPI and the runAsync path).
 */
declare class MachineContainer {
  constructor(rt: Runtime, opts?: MachineContainerOptions);
  /** Boots a container (JS API). manifest is its own package set. */
  spawn(manifest?: ContainerManifest): Promise<ContainerHandle>;
  /** Terminates a container. */
  kill(cid: string): boolean;
  /** Wires the Python surface, after which pyprocMachine.spawn() returns a Python value. */
  install(): { installed: string };
  /** Terminates every container. */
  terminate(): void;
}

export interface JobControlOptions {
  indexURL?: string;
  /** Pool size: one interactive lane plus N-1 job slots. Defaults to 3. */
  workers?: number;
  /** Replay manifest, the precondition for fork symmetry. Defaults to {}. */
  replay?: { env?: Record<string, string>; packages?: string[]; setup?: string };
  /** SRI-verifies the processWorker graph before spawning the internal PyProc worker pool. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

export interface JobInfo {
  jobId: number;
  pid: number;
  /** running | done | killed | error. */
  state: string;
  code: string;
}

export interface ReplOutcome {
  /** Captured stdout and stderr. */
  out: string;
  /** The repr string for an expression, or null for a statement. */
  value: string | null;
}

/**
 * Shell job control: `expr &` forks the live interactive namespace and runs it on another core,
 * returning the prompt immediately. fork is only symmetric between workers, so the interactive
 * REPL also runs in a worker lane - on a PyProc replay pool, where lane 0 is interactive and the
 * rest are job slots. Drive it with %jobs, %fg, and %kill.
 */
declare class JobControl {
  constructor(opts?: JobControlOptions);
  boot(): Promise<{ workers: number; interactivePid: number; jobSlots: number }>;
  /** One input line. Ending in `&` starts a job and returns { job, pid }; otherwise it runs interactively and returns a ReplOutcome. */
  push(line: string): Promise<ReplOutcome | { job: number; pid: number }>;
  /** The job table. */
  jobs(): JobInfo[];
  /** Brings a job to the foreground: waits for completion and returns its result. */
  fg(jobId: number): Promise<ReplOutcome | { error: string }>;
  /** Signals a job (default SIGINT, a hard interrupt). The worker survives and is reused. */
  kill(jobId: number, signum?: number): boolean;
  /**
   * Last resort for a job that cooperative signals cannot reach - a worker without interrupt
   * support, or a loop that swallows KeyboardInterrupt. It force-terminates the worker and
   * reclaims the lane by rebooting it from the same replay manifest. The job ends in state
   * "killed". Returns false for a job that is not running.
   */
  killHard(jobId: number): Promise<boolean>;
  terminate(): void;
}

export interface KernelElectionOptions {
  /** Kernel identifier: the same name means the same election and the same kernel. */
  name?: string;
  /** Session manifest the leader boots from. Deterministic replay is the precondition for resuming the journal after failover. */
  manifest?: SessionManifest;
  /** Journal directory in OPFS. With it, failover revives state from the last commit; without it, state is lost. */
  journalDir?: FileSystemDirectoryHandle;
  /** ID for tests, log correlation, and showing participants in a product. Defaults to a crypto-unique ID. */
  participantId?: string;
  /** Internal OPFS storage key, surfaced in status. */
  storageKey?: string;
  heartbeatMs?: number;
  presenceTimeoutMs?: number;
  rpcTimeoutMs?: number;
  /** Commits each completed run, including its durable outcome record, before resolving or rejecting. Defaults to true. */
  autoCommit?: boolean;
  /** Called when this participant becomes the leader. */
  onLeader?: (info: KernelLeaderInfo) => void;
  /** Called whenever the role, leader, epoch, or recovery state changes. */
  onStatus?: (status: KernelStatus) => void;
}

export interface KernelLeaderInfo {
  recovered: boolean;
  leaderId: string;
  epoch: number;
  bootMs: number;
  recoveryMs: number;
  totalMs: number;
}

export interface KernelStatus {
  name: string;
  storageKey: string | null;
  participantId: string;
  leaderId: string | null;
  role: "idle" | "pending" | "leader" | "follower";
  phase: "idle" | "joining" | "recovering" | "ready" | "failed" | "left";
  epoch: number;
  recovered: boolean;
  lastCommitAt: string | null;
  participantCount: number;
  participants: readonly string[];
  pendingRequests: number;
  bootMs: number | null;
  recoveryMs: number | null;
  crossOriginIsolated: boolean;
  jspi: boolean;
  durable: boolean;
  autoCommit: boolean;
  rpcSemantics: string;
  error: string | null;
}

/**
 * Kernel election: several tabs pick one leader through Web Locks, and only the leader boots the
 * kernel (bootSession plus the journal). The other tabs are views that RPC to the leader over a
 * BroadcastChannel, so many tabs share one Python state. If the leader tab dies, the lock is
 * released automatically and a follower is promoted and resumes from the journal - the state
 * survives a tab death. Unlike a SharedWorker (where COI is false), the leader kernel lives in its
 * own document and keeps the full SAB capability set.
 */
declare class KernelElection {
  readonly name: string;
  readonly participantId: string;
  constructor(opts?: KernelElectionOptions);
  /** Joins the election. Winning the lock makes this the leader and boots the kernel; losing makes it a follower, an RPC view. */
  join(): KernelElection;
  /** Runs code. By default the Python effect and any forwarded RPC outcome commit in one generation before this settles. If durability cannot be proved, it raises outcome-unknown rather than inviting duplicate execution. */
  run(code: string, opts?: { async?: boolean; timeoutMs?: number }): Promise<unknown>;
  /** Commits the heap and /home/web as one journal generation. A follower's call is forwarded to the leader. */
  commit(opts?: { timeoutMs?: number }): Promise<JournalCommitResult | null>;
  /** Waits until the leader has finished recovery and is ready to serve. */
  ready(opts?: { timeoutMs?: number }): Promise<KernelStatus>;
  /** Current machine, participant, leader, epoch, and recovery state. */
  status(): KernelStatus;
  /** Subscribes to state changes. Call the returned function to unsubscribe. */
  subscribe(listener: (status: KernelStatus) => void): () => boolean;
  /** Current role: idle | pending | leader | follower. */
  role(): string;
  /** Leaves the election, as on tab close. If this is the leader it drops the lock and triggers failover. */
  leave(): void;
}

export interface PersistentMachineOptions extends Omit<KernelElectionOptions, "journalDir" | "manifest" | "storageKey"> {
  name?: string;
  manifest?: SessionManifest;
  /** Omit to open pyprocMachines/<name hash> in OPFS. */
  journalDir?: FileSystemDirectoryHandle;
  storageRoot?: FileSystemDirectoryHandle;
  machineRoot?: string;
  storageKey?: string;
  /** Shorthand for manifest.assetIntegrity. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  /** Deadline for the first leader to become ready. */
  timeoutMs?: number;
}

export interface TerminalConfig {
  /** Closes an automatic checkpoint after each complete statement, so "%undo" time-travels to the previous state. */
  timeTravel?: boolean;
}

export interface DeviceProvider {
  /** Called at open time to produce the file contents (synchronous). */
  read?: () => string;
  /** Receives the bytes of a Python write (synchronous). */
  write?: (bytes: Uint8Array) => void;
  /** Receives all accumulated bytes when a write device closes, e.g. to blit a /dev/fb0 frame. */
  flush?: (bytes: Uint8Array) => void;
}

export interface DeviceFsConfig {
  /** Extra devices, as { "/dev/name": { read, write, flush } }. */
  devices?: Record<string, DeviceProvider>;
  /** Provider for the contents of /proc/ps, e.g. () => pyProc.ps(). */
  ps?: () => unknown;
  /** fsWorld v2: the /dev/fb0 framebuffer. Python writes raw RGBA and on close onFrame(rgba, w, h) blits it to the screen. */
  framebuffer?: { width: number; height: number; onFrame: (rgba: Uint8Array, width: number, height: number) => void };
  /** fsWorld v2: wiring that turns a write to /proc/<pid>/ctl into a signal, usually (pid, signum) => pyProc.signal(pid, signum). Required by track(). */
  signal?: (pid: number, signum: number) => boolean;
}

/**
 * Everything is a file (Plan 9): browser capabilities exposed through Python's open().
 * Built in: /proc/meminfo; /dev/clipboard (a write attempts to apply immediately, a read serves a
 * cache refreshed by refreshClipboard()); /dev/random (fresh entropy on every open). fsWorld v2
 * adds /dev/fb0 (framebuffer) and /proc/<pid>/ctl (track). Device reads are a synchronous
 * contract, so for an asynchronous source a cache is the honest contract.
 */
declare class DeviceFs {
  install(): { installed: string[] };
  /** fsWorld v2: registers /proc/<pid>/ctl and /proc/<pid>/status (Plan 9). Writing a signal name ("term", "int", or a number) to ctl fires that signal. Requires cfg.signal. */
  track(pid: number): string;
  /** Pulls the system clipboard into the read cache. May require permission. */
  refreshClipboard(): Promise<string>;
}

export interface InitConfig {
  /** File run once at boot (default /home/web/boot.py). A no-op when it does not exist. */
  bootPath?: string;
  /** File that reopens process resources after revival (default /home/web/resume.py). A no-op when absent. */
  resumePath?: string;
  /** File run periodically (default /home/web/cron.py). A no-op when absent. */
  cronPath?: string;
  /** Cron interval in milliseconds (default 60000). */
  cronMs?: number;
}

/** The OS init role (rc.local plus cron plus resume): files on the mounted disk make the machine drive itself. */
declare class Init {
  install(): { boot: boolean; resume: false; cron: boolean };
  /** Runs resume.py after Session.load, MachineJournal.recover, or openMachine to reopen file descriptors, sockets, and DB connections. */
  resume(reason?: string): { resume: boolean; reason: string };
  stop(): void;
}

export interface JournalConfig {
  /** Directory the journal lives in (OPFS or similar). The caller supplies it. */
  dir: FileSystemDirectoryHandle;
  /** Controller whose cp0 is the replay boundary (the reactive from bootSession). Required for revival. */
  reactive: ReactiveController;
  /** Idle threshold in milliseconds (default 2000). A commit happens after this long with no state mutation. */
  idleMs?: number;
  /** Defaults to true: puts the /home/web file tree into the same HEAD/PREV generation as the heap. */
  includeHome?: boolean;
  /** Root of the file tree to persist. Defaults to /home/web. */
  homePath?: string;
  /**
   * When true, packs right after a commit once loose blobs cross a threshold. Defaults to false.
   * The default policy for true is 128 loose blobs or 8MB.
   */
  autoPack?: boolean | JournalAutoPackPolicy;
  /**
   * Observation channel for idle-commit success and failure. A failed durability claim is never
   * swallowed: failures arrive as { kind: "commitError", error } where error.code is in the
   * PYPROC_JOURNAL_IO family. Without a callback, a failure is left on console.warn.
   */
  onStatus?: (event: { kind: "commit"; result: JournalCommitResult } | { kind: "commitError"; error: PyProcError }) => void;
  /**
   * Defaults to false. When true, a commit is followed by reactive.pruneTo(liveIdx), leaving only
   * the live path of the checkpoint tree: the RAM relief valve for a long-lived machine. If the
   * same controller is shared with another caller (Terminal's %undo marks, for instance) their
   * nodes are cut too, so the decision belongs to the caller.
   */
  pruneAfterCommit?: boolean;
}

export interface JournalAutoPackPolicy {
  /** Packs right after a commit once this many loose blobs exist. Default 128. */
  looseBlobs?: number;
  /** Packs right after a commit once loose blobs reach this size. Default 8MB. */
  looseMB?: number;
}

export interface JournalCommitResult {
  pages: number;
  wrote: number;
  mb: number;
  committedAt: string;
  /** `wrote` counts the home blobs this commit actually stored: 0 when nothing under /home changed. */
  home?: { files: number; mb: number; wrote: number };
  /** Present when the autoPack policy ran a pack after this same commit. */
  autoPack?: JournalPackResult;
  /** Present when pruneAfterCommit is on: the result of pruning the tree right after the commit. */
  pruned?: { freedNodes: number; freedMB: number; keptNodes: number };
}

export interface JournalPackResult {
  liveKeys: number;
  packed: number;
  bytes: number;
  mb: number;
  looseRemoved: number;
  packsRemoved: number;
  /** Which threshold triggered an autoPack run. Absent for a manual pack. */
  trigger?: { looseBlobs: number; looseMB: number };
}

export interface JournalPruneResult {
  liveKeys: number;
  looseRemoved: number;
  packsRemoved: number;
}

export interface JournalDeleteResult {
  deleted: true;
}

export interface JournalRecoverResult {
  pages: number;
  mb: number;
  committedAt: string | null;
  home?: { files: number; dirs: number; mb: number };
  fallback?: boolean;
}

/**
 * Write-ahead log: tolerance for a forced kill. At each requested boundary it stores changed pages
 * content-addressed, and the next boot revives from the last commit through `recover()` - it
 * survives even when a hibernate hook fails.
 * The contract: a crash loses everything "since the last commit". That is boundary consistency,
 * not per-statement durability.
 */
declare class MachineJournal {
  readonly commits: number;
  readonly pagesWritten: number;
  /**
   * Whether the browser granted persistent storage. `null` before the request settles, `false` when
   * it was denied or cannot be asked. A denial does not stop the journal - it means the browser may
   * evict this machine under pressure. A surviving committed marker makes missing generations fail
   * with PYPROC_JOURNAL_EVICTED, but origin-wide eviction can remove the marker too and is then
   * indistinguishable from a first boot. Callers that need durability across eviction export an
   * image outside the origin rather than relying on the journal alone.
   */
  readonly persistentStorage: boolean | null;
  readonly packs: number;
  readonly packBytes: number;
  /** Starts the idle watcher. It never interrupts running code. */
  start(): MachineJournal;
  stop(): void;
  /** Commits the current state at a manual boundary. Returns the changed page count and the bytes actually written after dedupe. */
  commit(): Promise<JournalCommitResult | null>;
  /** Removes journal generations and leaves a deleted tombstone so intentional deletion is not reported as eviction. */
  delete(): Promise<JournalDeleteResult>;
  /** Bundles only the HEAD/PREV live blobs into one pack file and reduces loose and stale files. */
  pack(): Promise<JournalPackResult | null>;
  /** Deletes loose blobs and stale pack files that HEAD/PREV no longer reference. */
  prune(): Promise<JournalPruneResult>;
  /** Revives from the last commit. Returns null only for a first boot or an explicit delete; missing generations behind a committed marker throw PYPROC_JOURNAL_EVICTED. */
  recover(): Promise<JournalRecoverResult | null>;
}

export interface JailPermissions {
  /** Network: false blocks everything, true allows everything, ["host", ...] is an allowlist. */
  net?: boolean | string[];
  clipboard?: boolean;
  home?: boolean;
  workers?: boolean;
}

/**
 * Permission jail: the binary trust:true gate becomes a scoped approval. Two tiers of enforcement.
 * (1) Cooperative chokepoints (pyprocJail.net(host) and friends). Honest limit: `import js`
 *     bypasses them.
 * (2) The browser wall, the CSP connect-src of the jailed context. Boot the jail in a CSP iframe
 *     and the browser blocks a fetch to a disallowed host even when Python tries to route around
 *     the chokepoints. connect-src 'self' assumes a self-hosted engine.
 * Honest boundary: a same-origin jail blocks its own egress but leaves a window.parent side
 * channel open. Full isolation means an opaque origin (sandbox), and the price is losing
 * SharedArrayBuffer, hence fork and interrupt.
 */
declare class MachineJail {
  constructor(permissions?: JailPermissions);
  /** Cooperative-tier decision, bypassable by design. perm is net|clipboard|home|workers. */
  allows(perm: string, arg?: string): boolean;
  /** CSP connect-src value for the jailed context: 'self' plus the allowed hosts. */
  connectSrc(): string;
  /** Full CSP string to put on the jail iframe: allows loading the engine from self, restricts connect-src. */
  csp(): string;
  /** Installs the cooperative chokepoints into Python as the pyprocJail module. */
  install(rt: Runtime): { permissions: JailPermissions; connectSrc: string };
}

/** Serverless Python terminal: a REPL on code.InteractiveConsole. Combine with syscallBridge for blocking input(). */
declare class Terminal {
  install(): Promise<{ repl: string; timeTravel: boolean }>;
  /** One input line. `more` means it is waiting for a continuation line (the ... prompt); `out` is stdout plus stderr. With timeTravel, "%undo" is supported. */
  push(line: string): Promise<{ more: boolean; out: string }>;
}

export interface WheelCacheConfig {
  /** Directory the wheel bytes are stored in (OPFS or similar). The caller supplies it. */
  dir: FileSystemDirectoryHandle;
}

/** Wheel cache in OPFS: stores and serves .whl files during install/loadPackages so nothing is downloaded twice. */
declare class WheelCache {
  hits: number;
  misses: number;
  install(pkg: string): Promise<void>;
  loadPackages(pkgs: string | string[]): Promise<void>;
}

/**
 * Engine-independent general file IO (Runtime.fs), so callers read and write files without
 * touching rt.raw.FS. Persistence comes from mountHome mounting OPFS; this is the file-operation
 * layer on top of it, not a new VFS. Mutations bump execSeq, which is what guards reactivity.
 */
declare class FileSystem {
  /** A string writes as utf8 and a Uint8Array as binary; opts.encoding can state it explicitly. */
  writeFile(path: string, data: string | Uint8Array, opts?: { encoding?: "utf8" | "binary" }): void;
  /** Binary (Uint8Array) by default; { encoding: "utf8" } returns a string. */
  readFile(path: string, opts?: { encoding?: "utf8" | "binary" }): Uint8Array | string;
  mkdir(path: string): void;
  /** Creates a nested path; harmless if it already exists. */
  mkdirTree(path: string): void;
  /** Array of names, excluding . and .. */
  readdir(path: string): string[];
  stat(path: string): { size: number; isDir: boolean; isFile: boolean; mtimeMs: number | null };
  exists(path: string): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
}

/**
 * Contract at the engine seam. `Runtime`, `MemoryCapability`, and the capabilities see only this
 * surface and never touch engine internals such as `_module.HEAPU8`, `globals`, or
 * `_emscripten_stack_*`. `PyodideEngine` is the default implementation; fill this surface with
 * another engine (WASI CPython, for instance) and everything above keeps working.
 *
 * Discrimination: the presence of `runSync` is what separates an EngineContract from a loaded
 * Pyodide instance. Optional seams (`setInterruptBuffer`, `makeSnapshot`, `mountDir`) return their
 * own contract value on an engine that lacks them - false for interrupts, null for the stack
 * pointer. Promotion evidence: tests/attempts/engineContract/contractProbe, where reactive time
 * travel holds through this surface alone.
 */
export interface EngineContract {
  readonly engineContractVersion: 1;
  readonly engineKind: string;
  capabilities(): readonly string[] | Set<string>;
  /** Synchronous execution; returns the value of the last expression. */
  runSync(code: string): unknown;
  /** Asynchronous execution that can await; the JSPI path. */
  runAsync(code: string): Promise<unknown>;
  /** Value bridge. The contract default is a serializable value; an FFI proxy is a convenience of the Pyodide adapter. */
  setGlobal(name: string, value: unknown): void;
  getGlobal(name: string): unknown;
  /** Linear memory. Checkpoints, deltas, and fork all rest on it, and the wasm ABI forces it to be exposed. */
  heapU8(): Uint8Array;
  /** Stack pointer. An engine that does not expose one returns null; restore still works from page deltas. */
  stackSave(): number | null;
  stackRestore(sp: number | null): void;
  /** Interrupt channel. Returns false when unsupported: WASI prebuilts have no signals. */
  setInterruptBuffer(sab: SharedArrayBuffer): boolean;
  loadPackages(pkgs: string[]): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<unknown>;
  install(pkg: string): Promise<unknown>;
  /** Lock file for the current environment, as a pyodide-lock format string. */
  freeze(): Promise<string>;
  /** Passing null restores the default output. */
  setStdout(handler: ((text: string) => void) | null): void;
  setStderr(handler: ((text: string) => void) | null): void;
  /** Engine-independent file IO. */
  readonly fs: FileSystem;
  toHostValue(value: unknown, options?: EngineHostValueOptions): unknown;
  destroyHostValue(value: unknown): void;
  /** Mounts a host directory (optional). */
  mountDir(path: string, handle: unknown): Promise<{ path: string; sync: () => unknown }>;
  /** Bare heap snapshot (optional). A heap with packages loaded is impossible because of the hiwire wall. */
  makeSnapshot(): Uint8Array;
  /** Escape hatch for seams not yet migrated. Not recommended. */
  raw(): unknown;
}

/** The Pyodide implementation of EngineContract: the default adapter. */
declare class PyodideEngine implements EngineContract {
  constructor(py: unknown);
  readonly engineContractVersion: 1;
  readonly engineKind: "pyodide";
  capabilities(): readonly string[];
  runSync(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): void;
  getGlobal(name: string): unknown;
  toHostValue(value: unknown, options?: EngineHostValueOptions): unknown;
  destroyHostValue(value: unknown): void;
  heapU8(): Uint8Array;
  stackSave(): number | null;
  stackRestore(sp: number | null): void;
  setInterruptBuffer(sab: SharedArrayBuffer): boolean;
  loadPackages(pkgs: string[]): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<unknown>;
  install(pkg: string): Promise<unknown>;
  freeze(): Promise<string>;
  setStdout(handler: ((text: string) => void) | null): void;
  setStderr(handler: ((text: string) => void) | null): void;
  readonly fs: FileSystem;
  mountDir(path: string, handle: unknown): Promise<{ path: string; sync: () => unknown }>;
  makeSnapshot(): Uint8Array;
  raw(): unknown;
}

declare class Runtime {
  /**
   * Takes either an EngineContract or a **loaded Pyodide instance**. The latter is wrapped, so a
   * worker that booted its own Pyodide can adopt pyproc with `new Runtime(py)` - the pattern
   * loaded Pyodide instance. The two are told apart by the presence of `runSync`, which a
   * loaded Pyodide does not have.
   */
  constructor(engineOrPyodide: EngineContract | unknown, indexURL?: string, opts?: { assetIntegrity?: PyProcAssetIntegrityManifest });
  readonly runtimeContractVersion: 1;
  readonly runtimeKind: string;
  capabilities(): readonly string[];
  readonly memory: MemoryCapability;
  /** Engine-independent general file IO: an always-on capability, peer to memory. Calling it on an engine that lacks support throws. */
  readonly fs: FileSystem;
  /** State mutation counter: how reactivity detects an execution-boundary violation in O(1). Treat it as read-only. */
  readonly execSeq: number;
  /** Records a state mutation made outside the execution API into the boundary counter; restore and markDirty consume it. */
  noteStateMutation(): void;
  /** Engine distribution this kernel booted from. Child workers (subprocess) use the same one. */
  readonly indexURL: string;
  /** Output of the pyproc-assets CLI, used by worker capabilities created from this Runtime to verify the graph before spawning. */
  readonly assetIntegrity: PyProcAssetIntegrityManifest | null;
  run(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): void;
  /** Returns the engine proxy as is (a PyProxy on Pyodide). Use `toHostValue`/`destroyHostValue` to actually take or release a host value. */
  getGlobal(name: string): unknown;
  toHostValue(value: unknown, options?: EngineHostValueOptions): unknown;
  destroyHostValue(value: unknown): void;
  /** Interrupt SAB: write a signal number into [0] (2 is SIGINT) and running Python reacts. False on an engine without support. */
  setInterruptBuffer(sab: SharedArrayBuffer): boolean;
  install(pkg: string): Promise<void>;
  loadPackages(pkgs: string | string[]): Promise<void>;
  /** Scans the cell's import statements and loads the packages they need. A no-op on engines without support (WASI), where explicit loadPackages is the fallback. */
  loadPackagesFromImports(code: string): Promise<void>;
  /** Captures execution output into a per-cell sink. The handler receives string chunks; null restores the default. */
  setStdout(handler: ((chunk: string) => void) | null): void;
  setStderr(handler: ((chunk: string) => void) | null): void;
  /** Pins the current environment as a pyodide-lock format lock (a JSON string), the equivalent of uv lock. Feed it back through boot({ lockFileURL }). */
  freeze(): Promise<string>;
  /** Boot statistics when booted through the declared-environment lane, `boot({ deterministic: true, packages, setup, wheelDir })`. */
  envBoot?: EnvBootStats;
  /** Core asset cache and verification statistics when booted with boot({ coreCacheDir/coreIntegrity }). */
  coreCache?: CoreAssetStats;
  /** One controller per runtime, memoized: however many times you call this, you get the same
   *  instance. Two controllers would mean one side's restore is invisible to the other's boundary
   *  guard, which is silent corruption, so the structure prevents it. */
  enableReactive(): ReactiveController;
  enableSyscallBridge(cfg?: SyscallBridgeConfig): SyscallBridge;
  enableAsgiServer(cfg?: AsgiServerConfig): AsgiServer;
  /** Gives the Python server a real URL by answering SW delegation. Omit asgi and one is created with enableAsgiServer(cfg). */
  enableVirtualOrigin(asgi?: AsgiServer, cfg?: AsgiServerConfig): VirtualOrigin;
  enableTerminal(cfg?: TerminalConfig): Terminal;
  /**
   * Installs the permission jail. It plants the cooperative chokepoints (the Python `pyprocJail`
   * module) and returns the CSP `connect-src` value for the jailed context alongside them. Hard
   * blocking is enforced by the browser's CSP; this tier is mistake prevention and an explicit
   * contract. Honest limit: an `import js` bypass is caught by the CSP, not by this tier.
   */
  enableJail(permissions?: JailPermissions): { jail: MachineJail; permissions: JailPermissions; connectSrc: string };
  enableWheelCache(cfg: WheelCacheConfig): WheelCache;
  enableDeviceFs(cfg?: DeviceFsConfig): DeviceFs;
  enableInit(cfg?: InitConfig): Init;
  enableJournal(cfg: JournalConfig): MachineJournal;
  /** Mounts a directory handle (OPFS or similar) at a Python path (default /home/web). Persist with the returned sync(). */
  mountHome(dirHandle: FileSystemDirectoryHandle, path?: string): Promise<{ path: string; sync: () => Promise<void> }>;
  /** Escape hatch (not recommended): the internal Pyodide instance. */
  readonly raw: unknown;
}

export interface ImagePortabilityOptions {
  /**
   * Acknowledges that this heap holds JS handles installed by a blocking host surface (the syscall
   * bridge, sockets, GPU). A JS handle cannot cross an image, so the revived kernel keeps its plain
   * Python state but cannot use those surfaces again. Without this flag both save and export refuse
   * with PYPROC_IMAGE_PROXY_SURFACE rather than writing an image that fails later.
   */
  allowHostProxies?: boolean;
}

export interface SessionManifest {
  indexURL?: string;
  env?: Record<string, string>;
  /** Packages loaded during replay: part of the environment declaration. */
  packages?: string[];
  /** Python run just before the replay boundary, e.g. "import numpy". */
  setup?: string;
  /** Asset SRI manifest handed to the booting Runtime. It is not part of the replay state itself. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  engineScriptIntegrity?: string | false;
  coreIntegrity?: CoreIntegrityMap | CoreIntegrityPolicy | false;
  coreCacheDir?: FileSystemDirectoryHandle;
  /**
   * loadPyodide supplied by a worker caller, which has no document to inject the engine script
   * into. It is a host capability, not part of the environment declaration, so it does not enter
   * the replay identity: a worker-hosted kernel and a main-thread kernel reach the same cp0 bytes.
   */
  loadPyodide?: (cfg: unknown) => Promise<unknown>;
}

export interface SessionIo {
  pages: number;
  mb: number;
}

export interface SessionImageOptions extends ImagePortabilityOptions {
  /**
   * True, or the default, includes the existing /home/web file tree in the .pymachine. False
   * exports only the heap delta. True with no such path raises an explicit error.
   */
  includeHome?: boolean;
  /** Disk root to include. Defaults to /home/web. */
  homePath?: string;
  /** A WebCrypto ECDSA P-256 private key or CryptoKeyPair. Supply it and the .pymachine carries a signature. */
  signingKey?: CryptoKey | CryptoKeyPair;
  /** Public key to embed when signingKey is a bare private key. Omit it when passing a CryptoKeyPair. */
  publicKey?: CryptoKey | JsonWebKey;
}

declare class Session {
  readonly rt: Runtime;
  readonly reactive: ReactiveController;
  /** Exports this whole computer as one .pymachine file, integrity hashes included, along with /home/web when it exists. */
  exportImage(opts?: SessionImageOptions): Promise<Blob>;
  /** Saves only user state - the pages that differ from the replay boundary. Replay supplies the base. */
  save(dir: FileSystemDirectoryHandle, name: string, opts?: ImagePortabilityOptions): Promise<SessionIo>;
  /** Assumes the same manifest and the same heap size; a mismatch raises an explicit error. */
  load(dir: FileSystemDirectoryHandle, name: string): Promise<SessionIo>;
}

export interface PyProcMapOptions {
  /** Per-task timeout in milliseconds. On overrun that task converges to {error} and the hung worker is killed and respawned from a snapshot. */
  taskTimeoutMs?: number;
}

export interface PyProcShardOptions extends PyProcMapOptions {
  /** Upper bound on workers to shard across. Omit to use every ready worker; a given value is clamped by the pool size and the row count. */
  parts?: number;
}

export interface PyProcMatmulOptions extends PyProcShardOptions {}

/** A matrix in row-major f64: the input and output of matmul. data.length === rows*cols. */
export interface Matrix {
  data: Float64Array;
  rows: number;
  cols: number;
}

/**
 * Pipe over a SAB ring buffer: streaming IPC between processes. The kernel creates one and wires
 * it into processes with bindReader/bindWriter, after which Python inside a process reads and
 * writes through pyprocIpc.open(name, mode) with real blocking reads and backpressure. The kernel
 * itself can be one end too, using read/write over Atomics.waitAsync.
 */
export interface Pipe {
  readonly kind: "pipe";
  readonly sab: SharedArrayBuffer;
  bindReader(pid: number, name: string): Promise<boolean>;
  bindWriter(pid: number, name: string): Promise<boolean>;
  /** Kernel endpoint: pushes into the ring, waiting for a reader when it is full. Returns the bytes written. */
  write(bytes: Uint8Array): Promise<number>;
  /** Kernel endpoint: pulls from the ring. Returns bytes, or null at EOF (closed and drained). */
  read(max?: number): Promise<Uint8Array | null>;
  close(): void;
}

/** Lock and semaphore over a SAB counter plus Atomics. Python inside a process acquires and releases through pyprocIpc.lock(name) or semaphore(name), and both support `with`. */
export interface Lock {
  readonly kind: "lock" | "semaphore";
  readonly sab: SharedArrayBuffer;
  bind(pid: number, name: string): Promise<boolean>;
}

/** Named shared memory over a SAB. Python inside a process calls pyprocIpc.shm(name) for read(off, n) and write(off, data), with a one-memcpy contract. */
export interface Shm {
  readonly kind: "shm";
  readonly sab: SharedArrayBuffer;
  /** Direct kernel-side view, sharing the reference with the processes. */
  readonly u8: Uint8Array;
  bind(pid: number, name: string): Promise<boolean>;
}

/** Process-OS kernel for browser Python: snapshot-fork spawn, parallel map, and lifecycle (kill/respawn). */
declare class PyProc {
  /** POSIX signal number table, consumed as pool.SIGNAL.INT and friends. */
  static SIGNAL: typeof SIGNAL;
  constructor(opts?: PyProcOptions);
  /** Result of the last boot(): the observation point for paths that do not receive the boot return directly, such as machine.proc(). Null before boot. */
  readonly bootInfo: PyProcBootInfo | null;
  boot(n: number, useSnapshot?: boolean): Promise<PyProcBootInfo>;
  /**
   * Scatters an argument list across the workers and runs them in parallel. `fnSrc` **must define a
   * function named `_fn`**, because the worker calls `_fn(arg)`:
   * `"def _fn(n):\n    return n * n"`. Results keep the argument order. A failed task turns only
   * that element into `{ error }`; if every lane dies, every element does.
   */
  map(fnSrc: string, args: unknown[], opts?: PyProcMapOptions): Promise<unknown[]>;
  /**
   * Shards a TypedArray across the workers and applies the function to each piece as a numpy array.
   * `fnSrc` must define `_fn`: `"def _fn(a):\n    return float(a.sum())"`. Piece results come back
   * in argument order.
   * Caveat: the worker substitutes `fnSrc` as text, so write `def _fn(` exactly, with no space
   * before the parenthesis.
   */
  mapArray(fnSrc: string, typed: ArrayBufferView, opts?: PyProcShardOptions): Promise<unknown[]>;
  /**
   * Sharded matmul: C = A@B is split into row blocks of A, one per worker, and computed in parallel
   * (N independent interpreters means N independent GILs). Needs numpy (packages:["numpy"]) and uses
   * f64, numpy's default. Returns the result matrix.
   * Honest boundary: this gain belongs to compute-bound kernels. Memory-bound ops (reductions,
   * cheap elementwise work) belong in mapArray, and for small arrays transfer cost exceeds compute
   * cost. Evidence: shardOpsProbe.
   */
  matmul(a: Matrix, b: Matrix, opts?: PyProcMatmulOptions): Promise<Matrix>;
  ps(): PyProcEntry[];
  /** Force-kills a process, equivalent to SIGKILL. Returns true on success; the table keeps it as dead. */
  kill(pid: number): boolean;
  /**
   * Force-kills one process and refills the lane with a new process booted the same way (snapshot
   * or replay), so fork symmetry is preserved. This is the public primitive that job control's
   * forced reclaim (killHard) consumes. An unknown pid yields PYPROC_PROCESS_UNAVAILABLE.
   */
  respawn(pid: number): Promise<{ oldPid: number; pid: number }>;
  /**
   * fork(2) fan-out: clones the state of a live src into N dsts at once - the primitive for
   * speculative exploration. The parent delta is harvested once and broadcast over a
   * SharedArrayBuffer, so the cost is O(heap + N x delta) rather than O(N x heap). The precondition
   * is the same as fork: a symmetric pool from the same replay manifest. harvestMs is a one-time
   * cost independent of lane count. Evidence: forkManyProbe.
   */
  forkMany(srcPid: number, dstPids: number[]): Promise<{
    pages: number;
    mb: number;
    harvestMs: number;
    lanes: { pid: number; reverted: number; applyMs: number }[];
  }>;
  /**
   * Delivers a signal from the Unix signal table, firing the running Python's signal handler.
   * SIGINT (2) raises KeyboardInterrupt by default; SIGTERM (15), SIGUSR1 (10), and the rest are
   * received by whatever handler Python installed with signal.signal.
   * Termination is cooperative, so the worker survives and is reused; kill and respawn are the
   * forced path. Returns false on a worker without support.
   */
  signal(pid: number, signum?: number): boolean;
  /**
   * The fork(2) equivalent: clones the current state of live process src - variables, arrays,
   * computed results - into dst. Only possible on a pool booted from a replay manifest, because a
   * byte-identical boundary is the precondition for a delta. The child has an independent address
   * space, so its mutations never leak back into the parent.
   */
  fork(srcPid: number, dstPid: number): Promise<ForkInfo>;
  /** Runs once on the given process. `fnSrc` follows the same `_fn` definition contract as `map`. */
  exec(pid: number, fnSrc: string, arg?: unknown): Promise<unknown>;
  /** Interactive lane: runs free-form statements, captures stdout, and returns the last expression value. Global state accumulates. */
  repl(pid: number, code: string): Promise<{ out: string; value: string | null }>;
  /** Creates a pipe over a SAB ring buffer (1MB by default). Wire it into processes with bindReader/bindWriter. */
  pipe(capacity?: number): Pipe;
  /** Creates a mutual-exclusion lock. Wire it into a process with bind(pid, name). */
  lock(): Lock;
  /** Creates a semaphore with an initial count. Wire it with bind(pid, name). */
  semaphore(count?: number): Lock;
  /** Creates named shared memory of byteLength. Wire it with bind(pid, name). */
  shm(byteLength: number): Shm;
  terminate(): void;
}

// ---- Demoted subpath surfaces ----
// The root surface stays the core that the CI runtime gate covers. Surfaces the gate physically
// cannot reach - GPU, where headless has no adapter, and Socket, which requires an external relay -
// plus the research preview (WASI) are consumed through dedicated subpaths instead. See
// docs/reference/api.md for signature detail and boundaries.




export { createWebComputer, type WebComputer } from "./src/machine/index.js";

// ---- Product entrance: durable Machine, transient Machine, multi-guest Computer, and preflight in one root ----

export interface BootMachineOptions extends BootOptions {
  /**
   * Opts into a deterministic replay boot. PYTHONHASHSEED=0 plus entropy stubs change semantics
   * the guest can observe, so this is not the default. The choice is recorded in the environment
   * fingerprint of every durable commit (as `deterministic`), and history.export (a portable
   * bundle) and history.save (a session save) only hold in this mode.
   */
  deterministic?: boolean;
  /** Deterministic manifest: Python run right after boot, part of the environment declaration. */
  setup?: string;
  /** Deterministic manifest: the .whl OPFS cache, so the second boot onward downloads nothing. */
  wheelDir?: FileSystemDirectoryHandle;
}

export interface OpenTrustOptions {
  /** Explicit approval to open an unsigned or untrusted bundle. A machine file carries the same risk as arbitrary code execution. */
  trust?: boolean;
  trustedPublicKey?: CryptoKey | JsonWebKey;
  trustedPublicKeys?: (CryptoKey | JsonWebKey)[];
  requireSignature?: boolean;
  /**
   * loadPyodide for a worker-hosted revival. A bundle carries its own manifest, and that manifest
   * is JSON, so the engine loader cannot travel inside the file: it comes from the caller.
   */
  loadPyodide?: (cfg: unknown) => Promise<unknown>;
}

/** Verbs of the two-region history. checkpoint and restore are volatile (RAM, time travel); commit and export are durable (promoted to sha256). */
declare class PyprocHistory {
  checkpoint(): CheckpointInfo;
  restore(target: number | CheckpointInfo, opts?: { rehash?: boolean }): RestoreInfo;
  tree(): CheckpointNode[];
  prune(target?: number | CheckpointInfo): { freedNodes: number; freedMB: number; keptNodes: number };
  stats(): ReactiveStats;
  setRetentionPolicy(policy: ReactiveRetentionPolicy | null): Readonly<ReactiveRetentionPolicy> | null;
  /** Kernel commit through the WAL journal. The same dir shares one journal instance. */
  commit(opts: { dir: FileSystemDirectoryHandle } & Omit<JournalConfig, "reactive" | "dir">): Promise<JournalCommitResult | null>;
  /** Explicitly deletes the journal and leaves a tombstone so intentional absence is not reported as eviction. */
  delete(opts: { dir: FileSystemDirectoryHandle } & Omit<JournalConfig, "reactive" | "dir">): Promise<JournalDeleteResult>;
  recover(opts: { dir: FileSystemDirectoryHandle } & Omit<JournalConfig, "reactive" | "dir">): Promise<JournalRecoverResult | null>;
  /** Starts the idle watcher (WAL). Durable failures surface through onStatus. */
  watch(opts: { dir: FileSystemDirectoryHandle } & Omit<JournalConfig, "reactive" | "dir">): MachineJournal;
  pack(opts: { dir: FileSystemDirectoryHandle } & Omit<JournalConfig, "reactive" | "dir">): Promise<JournalPackResult | null>;
  /** A portable signed bundle. Deterministic boots only: a non-deterministic state has no replay guarantee. */
  export(opts?: SessionImageOptions): Promise<Blob>;
  /** Saves the session (deterministic boots only). Revival replays the same manifest and applies the delta. */
  save(dir: FileSystemDirectoryHandle, name: string, opts?: ImagePortabilityOptions): Promise<{ pages: number; mb: number }>;
}

/** Handle to a Python machine that has a history. Capability detail is reached through the runtime escape hatch. */
declare class PyprocMachine {
  readonly runtime: Runtime;
  readonly deterministic: boolean;
  readonly history: PyprocHistory;
  readonly fs: FileSystem;
  run(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  term(cfg?: TerminalConfig): Terminal;
  /** Loads packages into this machine, so installing numpy does not require the escape hatch. */
  loadPackages(packages: string[]): Promise<unknown>;
  /**
   * Declares a heap mutation the run APIs did not see (a call through a live PyProxy, for
   * instance). The next restore is promoted to the rehash path rather than trusting the fast one.
   */
  markDirty(): unknown;
  /**
   * Process pool, where a worker is a process with its own GIL. fork/forkMany/map/mapArray/matmul
   * are verbs of the pool. Memoized per option set: the same options return the same pool, so a
   * remount does not pile up workers, while different options (a plain pool versus a replay pool
   * for fork) each get their own. lanes defaults to 2.
   */
  proc(opts?: PyProcOptions & { lanes?: number; useSnapshot?: boolean }): Promise<PyProc>;
  /**
   * Shell job control: `expr &` forks the live interactive namespace and runs it on another core.
   * It stands up its own worker pool (one interactive lane plus N-1 job slots), so it is separate
   * from the pool proc() returns. Memoized one per machine and reclaimed by dispose().
   */
  jobs(opts?: { workers?: number; replay?: Record<string, unknown> }): Promise<JobControl>;
  /** A machine inside the machine: Python starts a child kernel with `pyprocMachine.spawn()` (nested containers). */
  containers(cfg?: MachineContainerOptions): Promise<MachineContainer>;
  /** Reclaim: terminates the pool workers (proc, jobs, and containers alike) and releases the reactive retention. */
  dispose(): Promise<void>;
}

/** Explicit transient path: boots a Python machine without the default durable Machine lifecycle. */
export function boot(options?: BootMachineOptions): Promise<PyprocMachine>;

/**
 * One verb for revival, with a trust contract that differs by source - the semantics are not
 * flattened. An external bundle is integrity- and signature-verified before any heap is touched;
 * your own OPFS session save is replayed and checked against h0. With no source, or with a durable
 * Machine name, it opens the OPFS-backed multi-tab Machine and auto-commits every completed run.
 */
export function open(): Promise<KernelElection>;
export function open(options: PersistentMachineOptions): Promise<KernelElection>;
export function open(source: Blob | Uint8Array | ArrayBuffer, opts?: OpenTrustOptions): Promise<PyprocMachine>;
export function open(source: { dir: FileSystemDirectoryHandle; name: string }, opts?: { manifest?: SessionManifest; loadPyodide?: (cfg: unknown) => Promise<unknown> }): Promise<PyprocMachine>;


 // Type-only surface: the contract of what handles and escape hatches return, with no value export.
export type {
  PyprocMachine, PyprocHistory,
  Runtime, MemoryCapability, FileSystem, ReactiveController, Terminal, MachineJournal, MachineJail,
  SyscallBridge, AsgiServer, VirtualOrigin, DeviceFs, Init, WheelCache,
  Session, KernelElection, PyProc, MachineContainer, JobControl, PyodideEngine,
};
