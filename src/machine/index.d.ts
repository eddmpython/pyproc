// machine/index.d.ts - type contract of the pyproc/machine subpath.
// The four index.d.ts files of the former @web-machine/{core,browser,guest-pyproc,guest-v86}
// are merged into one module. The contract meanings are unchanged: the gate checks that
// GenerationHead and MachineStore still mean the same thing.
import type { KernelMachine } from "./composition/kernelMachine.js";
import type { KernelMachineImage } from "../composition/kernelFactory.js";
export * from "./composition/kernelMachine.js";

// ─── formerly @web-machine/core ───
export type SnapshotScope = "portable" | "session" | "none";
export type MachineState = "created" | "running" | "paused" | "stopped" | "failed";

export interface OperationControl {
  signal?: AbortSignal;
  deadlineAt?: number;
}

// ─── Frame law (pure): Ethernet/ARP/IPv4/ICMP parsing and assembly ───
// Exported so a consumer writing their own guest port consumes the same contract the built-in
// ports do. Two copies of this law would let two guests speak differently on one wire.
export function toAddressBytes(value: number[] | Uint8Array, length: number, label: string): Uint8Array;
export function internetChecksum(bytes: Uint8Array, offset: number, length: number): number;
export function buildArpReply(frame: Uint8Array, macAddress: Uint8Array, ipv4Address: Uint8Array): Uint8Array | null;
export function buildIcmpEchoReply(frame: Uint8Array, macAddress: Uint8Array, ipv4Address: Uint8Array): Uint8Array | null;
export function describeFrame(frame: Uint8Array): { kind: string; byteLength: number; [key: string]: unknown };

export interface DeviceRequirement {
  name: string;
  kind?: string;
  mode?: string;
  [key: string]: unknown;
}

export interface VirtualDevice {
  kind: string;
  mode?: string;
  [key: string]: unknown;
}

export interface MachinePermissions {
  devices: string[];
}

export interface AdapterCapabilities {
  adapterVersion: string;
  snapshotScope: SnapshotScope;
  pauseMode: string;
  shutdownMode: string;
  requiredDevices: DeviceRequirement[];
}

export interface GuestContext {
  machineId: string;
  devices: Readonly<Record<string, VirtualDevice>>;
  permissions: Readonly<{ devices: readonly string[] }>;
}

export interface GuestAdapter {
  capabilities: AdapterCapabilities;
  boot(context: GuestContext, manifest: Record<string, unknown>, control?: OperationControl): void | Promise<void>;
  pause(control?: OperationControl): void | Promise<void>;
  resume(control?: OperationControl): void | Promise<void>;
  snapshot(control?: OperationControl): ArrayBuffer | ArrayBufferView | Promise<ArrayBuffer | ArrayBufferView>;
  restore(payload: Uint8Array, context: GuestContext, manifest: Record<string, unknown>, control?: OperationControl): void | Promise<void>;
  shutdown(control?: OperationControl): void | Promise<void>;
  request<T = unknown>(message: unknown, control?: OperationControl): T | Promise<T>;
  inspect(): unknown;
}

export type GuestAdapterFactory = () => GuestAdapter;

export interface SnapshotEnvelope {
  readonly schemaVersion: 1;
  readonly machineId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly snapshotScope: SnapshotScope;
  readonly originInstanceId: string;
  readonly payload: Uint8Array;
}

export interface MachineHistoryEntry {
  event: string;
  state: MachineState;
  epoch: number;
  [key: string]: unknown;
}

export interface MachineInspection {
  machineId: string;
  adapterId: string;
  instanceId: string;
  ownerId: string | null;
  state: MachineState;
  epoch: number;
  capabilities: AdapterCapabilities | null;
  guest: unknown;
  history: MachineHistoryEntry[];
}

export interface CreateMachineOptions {
  machineId: string;
  adapterId: string;
  manifest?: Record<string, unknown>;
  permissions?: MachinePermissions;
}

export class MachineHandle {
  readonly machineId: string;
  readonly adapterId: string;
  readonly instanceId: string;
  readonly manifest: Record<string, unknown>;
  readonly permissions: MachinePermissions;
  state: MachineState;
  ownerId: string | null;
  epoch: number;
  readonly history: MachineHistoryEntry[];
  readonly capabilities: AdapterCapabilities | null;
  adoptOwnership(value: { ownerId: string; epoch: number }): Readonly<{ ownerId: string; epoch: number }>;
  invalidateOwnership(reason?: string): number;
  boot(control?: OperationControl): Promise<MachineInspection>;
  pause(control?: OperationControl): Promise<MachineInspection>;
  resume(control?: OperationControl): Promise<MachineInspection>;
  request<T = unknown>(message: unknown, control?: OperationControl): Promise<T>;
  snapshot(control?: OperationControl): Promise<SnapshotEnvelope>;
  restore(envelope: SnapshotEnvelope, control?: OperationControl): Promise<MachineInspection>;
  shutdown(control?: OperationControl): Promise<MachineInspection>;
  inspect(): Promise<MachineInspection>;
  inspectNow(): MachineInspection;
  /** Whether this machine requires that device by permission. host.detachDevice asks this to decide whether it is in use. */
  usesDevice(name: string): boolean;
}

export class WebMachineHost {
  constructor(options: { devices?: Record<string, VirtualDevice>; idFactory: () => string });
  registerAdapter(adapterId: string, factory: GuestAdapterFactory): this;
  registerDevice(name: string, device: VirtualDevice): this;
  createMachine(options: CreateMachineOptions): MachineHandle;
  getMachine(machineId: string): MachineHandle | null;
  /** Summary of attached devices (name/kind/mode). The device objects themselves are not handed out, so the permission gate cannot be bypassed. */
  listDevices(): ReadonlyArray<Readonly<{ name: string; kind: string; mode: string | null }>>;
  /** Detaches a device. Refuses with `WEB_MACHINE_DEVICE_IN_USE` while any machine still holds that name as a permission. */
  detachDevice(name: string): this;
  /** Removes a machine. Allowed only from `created`/`stopped`; otherwise `WEB_MACHINE_MACHINE_IN_USE`. */
  destroyMachine(machineId: string): this;
  preflightMachine(options: {
    machineId: string;
    adapterId: string;
    adapterVersion: string;
    snapshotScope: SnapshotScope;
    permissions?: MachinePermissions;
  }): Readonly<AdapterCapabilities>;
}

// Every error code this layer throws. The axis of the contract is `code`, not `message`: the
// layer only has a contract if a consumer can branch on it programmatically. The structure gate
// in tests/run.mjs compares this union against the codes src/machine actually throws, in both
// directions, so growing only one side turns it RED.
export type WebMachineErrorCode =
  | "WEB_MACHINE_ADAPTER_DUPLICATE"
  | "WEB_MACHINE_ADAPTER_INVALID"
  | "WEB_MACHINE_ADAPTER_UNAVAILABLE"
  | "WEB_MACHINE_BLOB_MISSING"
  | "WEB_MACHINE_BLOCK_INVALID"
  | "WEB_MACHINE_BLOCK_RANGE"
  | "WEB_MACHINE_BLOCK_SIZE"
  | "WEB_MACHINE_BLOCK_UNFLUSHED"
  | "WEB_MACHINE_CLOCK_DELAY"
  | "WEB_MACHINE_CLOCK_REGRESSION"
  | "WEB_MACHINE_CLOCK_TIMER_FULL"
  | "WEB_MACHINE_CLOCK_VALUE"
  | "WEB_MACHINE_COMMIT_STATE"
  | "WEB_MACHINE_COMPUTER_DISPOSED"
  | "WEB_MACHINE_DEVICE_IN_USE"
  | "WEB_MACHINE_DEVICE_INVALID"
  | "WEB_MACHINE_DEVICE_KIND_UNSUPPORTED"
  | "WEB_MACHINE_DEVICE_MISSING"
  | "WEB_MACHINE_DEVICE_MODE_UNSUPPORTED"
  | "WEB_MACHINE_DEVICE_PERMISSION_DENIED"
  | "WEB_MACHINE_DISPLAY_BUSY"
  | "WEB_MACHINE_DISPLAY_ENDPOINT_DUPLICATE"
  | "WEB_MACHINE_DISPLAY_GLYPH"
  | "WEB_MACHINE_DISPLAY_PIXELS"
  | "WEB_MACHINE_DISPLAY_PORT_CLOSED"
  | "WEB_MACHINE_DISPLAY_RANGE"
  | "WEB_MACHINE_DISPLAY_REGION"
  | "WEB_MACHINE_DISPLAY_SIZE"
  | "WEB_MACHINE_DISPLAY_STRIDE"
  | "WEB_MACHINE_DUPLICATE"
  | "WEB_MACHINE_DURABILITY_UNAVAILABLE"
  | "WEB_MACHINE_ENTROPY_SIZE"
  | "WEB_MACHINE_ENTROPY_SOURCE_FAILURE"
  | "WEB_MACHINE_ENVIRONMENT_MISMATCH"
  | "WEB_MACHINE_FLEET_BUSY"
  | "WEB_MACHINE_FLEET_CAPACITY"
  | "WEB_MACHINE_FLEET_COMMIT_UNVERIFIED"
  | "WEB_MACHINE_FLEET_DISPOSED"
  | "WEB_MACHINE_FLEET_DUPLICATE"
  | "WEB_MACHINE_FLEET_LEASE_STALE"
  | "WEB_MACHINE_FLEET_POLICY_INVALID"
  | "WEB_MACHINE_FLEET_PREFETCH_UNAVAILABLE"
  | "WEB_MACHINE_FLEET_STATE"
  | "WEB_MACHINE_FLEET_UNAVAILABLE"
  | "WEB_MACHINE_FLEET_UNSAFE"
  | "WEB_MACHINE_GENERATION_CORRUPT"
  | "WEB_MACHINE_GENERATION_EXISTS"
  | "WEB_MACHINE_GENERATION_INVALID"
  | "WEB_MACHINE_GENERATION_MISSING"
  | "WEB_MACHINE_GUEST_ABORTED"
  | "WEB_MACHINE_GUEST_BOOT"
  | "WEB_MACHINE_GUEST_STATE"
  | "WEB_MACHINE_GUEST_TIMEOUT"
  | "WEB_MACHINE_HEAD_CONFLICT"
  | "WEB_MACHINE_IMAGE_ADAPTER_SCOPE"
  | "WEB_MACHINE_IMAGE_ADAPTER_VERSION"
  | "WEB_MACHINE_IMAGE_BLOB_CORRUPT"
  | "WEB_MACHINE_IMAGE_BLOB_MISSING"
  | "WEB_MACHINE_IMAGE_CAPABILITY_MISSING"
  | "WEB_MACHINE_IMAGE_DEVICE_INVALID"
  | "WEB_MACHINE_IMAGE_DEVICE_KIND"
  | "WEB_MACHINE_IMAGE_DEVICE_MISSING"
  | "WEB_MACHINE_IMAGE_DEVICE_SIZE"
  | "WEB_MACHINE_IMAGE_EXPORT_STATE"
  | "WEB_MACHINE_IMAGE_FORMAT_INVALID"
  | "WEB_MACHINE_IMAGE_INTEGRITY_INVALID"
  | "WEB_MACHINE_IMAGE_MANIFEST_INVALID"
  | "WEB_MACHINE_IMAGE_PERMISSION_DENIED"
  | "WEB_MACHINE_IMAGE_SIGNATURE_INVALID"
  | "WEB_MACHINE_IMAGE_SNAPSHOT_SCOPE"
  | "WEB_MACHINE_IMAGE_UNTRUSTED"
  | "WEB_MACHINE_INPUT_BATCH_SIZE"
  | "WEB_MACHINE_INPUT_BUSY"
  | "WEB_MACHINE_INPUT_ENDPOINT_DUPLICATE"
  | "WEB_MACHINE_INPUT_INVALID"
  | "WEB_MACHINE_INPUT_QUEUE_FULL"
  | "WEB_MACHINE_INPUT_UNATTACHED"
  | "WEB_MACHINE_MACHINE_IN_USE"
  | "WEB_MACHINE_INVALID_STATE"
  | "WEB_MACHINE_NETWORK_ENDPOINT_DUPLICATE"
  | "WEB_MACHINE_NETWORK_PORT_CLOSED"
  | "WEB_MACHINE_OPERATION_ABORTED"
  | "WEB_MACHINE_OPERATION_TIMEOUT"
  | "WEB_MACHINE_OUTCOME_UNKNOWN"
  | "WEB_MACHINE_OWNERSHIP_CONFLICT"
  | "WEB_MACHINE_OWNERSHIP_STALE"
  | "WEB_MACHINE_OWNER_EPOCH_CORRUPT"
  | "WEB_MACHINE_OWNER_STALE"
  | "WEB_MACHINE_OWNER_STATE"
  | "WEB_MACHINE_OWNER_STOPPED"
  | "WEB_MACHINE_PACKET_INVALID"
  | "WEB_MACHINE_PACKET_QUEUE_FULL"
  | "WEB_MACHINE_PACKET_TOO_LARGE"
  | "WEB_MACHINE_POINTER_BUTTONS"
  | "WEB_MACHINE_POINTER_DELTA"
  | "WEB_MACHINE_RECOVERY_EMPTY"
  | "WEB_MACHINE_RECOVERY_UNAVAILABLE"
  | "WEB_MACHINE_RESTORE_TARGET_MISSING"
  | "WEB_MACHINE_SCHEMA_UPGRADE_BLOCKED"
  | "WEB_MACHINE_SIGNER_REQUIRED"
  | "WEB_MACHINE_SNAPSHOT_INCOMPATIBLE"
  | "WEB_MACHINE_SNAPSHOT_INVALID"
  | "WEB_MACHINE_SNAPSHOT_SCOPE"
  | "WEB_MACHINE_SNAPSHOT_UNSUPPORTED"
  | "WEB_MACHINE_STORE_FAILURE"
  | "WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE"
  | "WEB_MACHINE_SUSPEND_COMMIT_UNVERIFIED"
  | "WEB_MACHINE_SUSPEND_STATE"
  | "WEB_MACHINE_SUSPEND_UNSAFE"
  | "WEB_MACHINE_UNAVAILABLE"
  | "WEB_MACHINE_VOLUME_CAPACITY"
  | "WEB_MACHINE_VOLUME_EMPTY"
  | "WEB_MACHINE_VOLUME_INVALID";

export class WebMachineError extends Error {
  readonly code: WebMachineErrorCode;
  readonly details: unknown;
  constructor(code: WebMachineErrorCode, message: string, details?: unknown);
}

export function operationAbortError(
  control: OperationControl | undefined,
  label: string,
  options?: { outcomeUnknown?: boolean; details?: Record<string, unknown> },
): WebMachineError;
export function throwIfOperationAborted(
  control: OperationControl | undefined,
  label: string,
  options?: { outcomeUnknown?: boolean; details?: Record<string, unknown> },
): void;

export const WEB_MACHINE_FORMAT: "webmachine";
export const WEB_MACHINE_SCHEMA_VERSION: 1;

export interface WebMachinePayloadReference {
  blobId: string;
}

export interface WebMachineRecord {
  machineId: string;
  adapterId: string;
  adapterVersion: string;
  snapshotScope: SnapshotScope;
  requiredCapabilities: string[];
  permissions: MachinePermissions;
  guestManifest: Record<string, unknown>;
  payload: WebMachinePayloadReference;
}

export interface WebMachineDeviceRecord {
  name: string;
  kind: "block";
  byteLength: number;
  payload: WebMachinePayloadReference;
}

export interface WebMachineBlobRecord {
  blobId: string;
  byteLength: number;
  digest: string;
}

export interface WebMachineManifestContent {
  format: "webmachine";
  schemaVersion: 1;
  groupId: string;
  createdAt: number;
  machines: WebMachineRecord[];
  devices: WebMachineDeviceRecord[];
  blobs: WebMachineBlobRecord[];
}

export interface WebMachineSignature {
  version: 1;
  algorithm: "ECDSA-P256-SHA256";
  publicKey: { kty: "EC"; crv: "P-256"; x: string; y: string };
  value: string;
}

/** The state kernel's header-target signed tag: the provenance a bundle envelope carries. */
export interface MachineStateTag {
  alg: "ECDSA-P256-SHA256";
  target: string;
  publicKey: { kty: "EC"; crv: "P-256"; x: string; y: string };
  signature: string;
}

export interface WebMachineManifest extends WebMachineManifestContent {
  integrity: { algorithm: "SHA-256"; contentDigest: string };
  signature: WebMachineSignature;
}

export function isSnapshotScope(value: unknown): value is SnapshotScope;
export function asSnapshotBytes(value: ArrayBuffer | ArrayBufferView, label: string): Uint8Array;
export function createSnapshotEnvelope(options: {
  machineId: string;
  adapterId: string;
  capabilities: AdapterCapabilities;
  instanceId: string;
  payload: ArrayBuffer | ArrayBufferView;
}): SnapshotEnvelope;
export function validateSnapshotEnvelope(
  envelope: SnapshotEnvelope,
  expected: { machineId: string; adapterId: string; adapterVersion?: string | null },
): Uint8Array;
export function createWebMachineManifestContent(value: WebMachineManifestContent): Readonly<WebMachineManifestContent>;
export function createWebMachineManifest(
  content: WebMachineManifestContent,
  trust: { contentDigest: string; signature: WebMachineSignature },
): Readonly<WebMachineManifest>;
export function validateWebMachineManifest(value: unknown): Readonly<WebMachineManifest>;
export function getWebMachineManifestContent(manifest: WebMachineManifest): Readonly<WebMachineManifestContent>;

// ─── formerly @web-machine/browser ───
export function createBrowserHost(options: {
  devices?: Record<string, VirtualDevice>;
  cryptoProvider: MachineCryptoProvider;
}): WebMachineHost;

/**
 * Injected provider that delivers the state kernel's crypto law (digest, ECDSA) into the
 * machine layer. The persistence and image constructors require this provider rather than a
 * bare Crypto: the machine layer may not import the kernel across the boundary, so composition
 * plugs the function pieces in.
 */
export interface MachineCryptoProvider {
  readonly subtle: SubtleCrypto;
  randomUUID?(): string;
  digestBytes(bytes: Uint8Array): Promise<string>;
  signDigest(privateKey: CryptoKey, target: string): Promise<Uint8Array>;
  verifyDigest(publicKeyOrJwk: JsonWebKey | CryptoKey, target: string, signatureBytes: Uint8Array): Promise<boolean>;
  generateSigningKeyPair(): Promise<CryptoKeyPair>;
  exportPublicJwk(publicKey: CryptoKey): Promise<JsonWebKey>;
  /**
   * Function pieces of the state kernel grammar: the coordinator stores a generation as kernel
   * objects with them, and the image encoder uses them to write the .webmachine envelope in the
   * single bundle wire format.
   */
  state: {
    encodeObject(value: unknown): Uint8Array;
    decodeObject(bytes: Uint8Array): unknown;
    makePayloadTree(input: { entries: Array<{ id: string; address: string; byteLength: number; meta?: Record<string, unknown> | null }> }): Record<string, unknown>;
    makeStateCommit(input: Record<string, unknown>): Record<string, unknown>;
    validateStateCommit(commit: unknown): Record<string, unknown> & { tree: string; parents: string[] };
    validateStateTree(tree: unknown): Record<string, unknown> & { kind: string; entries?: GenerationEntry[] };
    /** Portable envelope codec (the bundleFormat canon, injected). objects is a Map of address to bytes, or an array of [address, bytes]. */
    encodeBundle(input: { commit?: string | null; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, Uint8Array]>; tag?: unknown }): Promise<Uint8Array>;
    decodeBundle(buffer: Uint8Array): Promise<{ commit: string | null; meta: unknown; objects: Map<string, Uint8Array>; tag: unknown; envelope: string; headerDigest: string }>;
    readBundleHeader(source: Uint8Array | Blob | { read(start: number, end: number): Promise<Uint8Array> | Uint8Array }): Promise<{ commit: string | null; meta: unknown; objects: Array<[string, number]>; tag: MachineStateTag | null; envelope: string; headerDigest: string; objectsOffset: number }>;
    bundleHeaderDigest(input: { commit?: string | null; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, unknown]> }): Promise<string>;
    /** header-target signature (provenance). tag.target is the header digest. */
    makeTag(privateKey: CryptoKey, publicKeyJwk: JsonWebKey, target: string): Promise<MachineStateTag>;
    verifyTag(tag: unknown, expectedTarget: string | null, opts?: { trustedPublicKeys?: Array<JsonWebKey | string> }): Promise<{ valid: boolean; trusted: boolean; signerFingerprint: string | null }>;
  };
}
export function createMachineCryptoProvider(cryptoProvider?: Crypto): MachineCryptoProvider;

export interface BlockDevice {
  readonly kind: "block";
  readonly byteLength: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  write(offset: number, value: ArrayBuffer | ArrayBufferView): Promise<void>;
  flush(): Promise<void>;
  snapshot(): Promise<Uint8Array>;
  restore(value: ArrayBuffer | ArrayBufferView): Promise<void>;
  inspect(): Record<string, unknown>;
}

export class MemoryBlockDevice implements BlockDevice {
  readonly kind: "block";
  readonly byteLength: number;
  constructor(options: { byteLength: number });
  read(offset: number, length: number): Promise<Uint8Array>;
  write(offset: number, value: ArrayBuffer | ArrayBufferView): Promise<void>;
  flush(): Promise<void>;
  snapshot(): Promise<Uint8Array>;
  restore(value: ArrayBuffer | ArrayBufferView): Promise<void>;
  crash(): void;
  inspect(): Record<string, unknown>;
}

export interface PacketPort {
  readonly endpointId: string;
  send(frame: ArrayBuffer | ArrayBufferView): Promise<void>;
  close(): void;
}

export class MemoryEthernetSwitch {
  readonly kind: "network";
  readonly mode: "packet";
  constructor(options?: { maxFrameBytes?: number; maxQueuedFrames?: number });
  connect(options: { endpointId: string; receive: (frame: Uint8Array) => void | Promise<void> }): PacketPort;
  inspect(): Record<string, unknown>;
}

export interface TextFrame {
  readonly mode: "text-cells";
  readonly columns: number;
  readonly rows: number;
  readonly revision: number;
  readonly cells: Uint32Array;
}

export class MemoryTextDisplayDevice {
  readonly kind: "display";
  readonly mode: "text-cells";
  constructor(options?: { maxColumns?: number; maxRows?: number });
  connect(options: { endpointId: string }): {
    readonly endpointId: string;
    configure(size: { columns: number; rows: number }): void;
    writeCell(cell: { row: number; column: number; glyph: number }): void;
    present(): number;
    close(): void;
  };
  subscribe(listener: (frame: TextFrame) => void): () => boolean;
  readFrame(): TextFrame;
  inspect(): Record<string, unknown>;
}

export interface RgbaFrame {
  readonly mode: "rgba-frame";
  readonly pixelFormat: "rgba8888";
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly pixels: Uint8ClampedArray;
}

export class MemoryRgbaDisplayDevice {
  readonly kind: "display";
  readonly mode: "rgba-frame";
  readonly pixelFormat: "rgba8888";
  constructor(options?: { maxWidth?: number; maxHeight?: number; maxFrameBytes?: number });
  connect(options: { endpointId: string }): {
    readonly endpointId: string;
    configure(size: { width: number; height: number }): void;
    writeRegion(region: {
      x: number;
      y: number;
      width: number;
      height: number;
      pixels: ArrayBuffer | ArrayBufferView;
      rowStride?: number;
    }): void;
    present(): number;
    close(): void;
  };
  subscribe(listener: (frame: RgbaFrame) => void): () => boolean;
  readFrame(): RgbaFrame;
  inspect(): Record<string, unknown>;
}

/**
 * Paints the frames an rgba-frame display device presents onto a canvas: the consuming direction,
 * symmetric to CanvasRgbaFrameSource. The frame decides the canvas size, frames whose revision does
 * not advance are skipped, and a paint failure is counted rather than thrown into the device's
 * listener loop.
 */
export class CanvasRgbaFrameSink {
  constructor(options: { canvas: HTMLCanvasElement; device: MemoryRgbaDisplayDevice });
  start(): this;
  stop(): this;
  inspect(): Readonly<{
    attached: boolean;
    width: number;
    height: number;
    lastRevision: number;
    paintedFrames: number;
    skippedFrames: number;
    paintErrors: number;
    lastError: string | null;
  }>;
}

export class CanvasRgbaFrameSource {
  constructor(options: { canvas: HTMLCanvasElement });
  subscribe(listener: (update: {
    canvasWidth: number;
    canvasHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
  }) => void): () => boolean;
  inspect(): Record<string, unknown>;
  destroy(): void;
}

export class MemoryScanCodeInputDevice {
  readonly kind: "input";
  readonly mode: "ps2-scan-code";
  constructor(options?: { maxBatchBytes?: number; maxQueuedBatches?: number });
  connect(options: { endpointId: string; receive: (codes: Uint8Array) => void | Promise<void> }): {
    readonly endpointId: string;
    close(): void;
  };
  sendScanCodes(value: ArrayBuffer | ArrayBufferView): Promise<void>;
  drain(): Promise<void>;
  inspect(): Record<string, unknown>;
}

export type RelativePointerEvent =
  | { type: "move"; deltaX: number; deltaY: number }
  | { type: "buttons"; left: boolean; middle: boolean; right: boolean }
  | { type: "wheel"; deltaX: number; deltaY: number };

export class MemoryRelativePointerDevice {
  readonly kind: "input";
  readonly mode: "relative-pointer";
  constructor(options?: { maxDelta?: number; maxQueuedEvents?: number });
  connect(options: { endpointId: string; receive: (event: RelativePointerEvent) => void | Promise<void> }): {
    readonly endpointId: string;
    close(): void;
  };
  move(value: { deltaX: number; deltaY: number }): Promise<void>;
  setButtons(value: { left: boolean; middle: boolean; right: boolean }): Promise<void>;
  wheel(value: { deltaX: number; deltaY: number }): Promise<void>;
  drain(): Promise<void>;
  inspect(): Record<string, unknown>;
}

export class BrowserClockDevice {
  readonly kind: "clock";
  readonly mode: "wall-monotonic";
  constructor(options: {
    wallNow: () => number;
    monotonicNow: () => number;
    scheduleTimer: (callback: () => void, delayMs: number) => unknown;
    cancelTimer: (handle: unknown) => void;
    maxTimerDelayMs?: number;
    maxPendingTimers?: number;
  });
  readWallTimeMs(): number;
  readMonotonicTimeMs(): number;
  schedule(options: { delayMs: number; callback: () => void }): { readonly id: number; cancel(): void };
  inspect(): Record<string, unknown>;
}

export class BrowserEntropyDevice {
  readonly kind: "entropy";
  readonly mode: "cryptographic-random";
  constructor(options: { fillRandomValues: (target: Uint8Array) => ArrayBufferView; maxBytesPerRead?: number });
  read(length: number): Uint8Array;
  inspect(): Record<string, unknown>;
}

export interface GenerationHead {
  head: string;
  prev: string | null;
  ownerEpoch: number;
}

/**
 * A generation record is a kernel commit address plus a gc reachability index. The commit chain
 * is the canon and restore does not trust the index: the coordinator walks commit to tree.
 */
export interface GenerationRecord {
  schemaVersion: 2;
  commitAddress: string;
  blobDigests: string[];
}

export interface GenerationEntry {
  id: string;
  address: string;
  byteLength: number;
  meta: Record<string, unknown> | null;
}

export interface GenerationCommitResult {
  schemaVersion: 2;
  commitAddress: string;
  commit: Record<string, unknown>;
  entries: GenerationEntry[];
  record: GenerationRecord;
  head: GenerationHead;
}

export interface OwnerToken {
  readonly groupId: string;
  readonly ownerId: string;
  readonly epoch: number;
}

export interface OwnerRecord extends OwnerToken {
  readonly active: boolean;
}

export interface PruneReport {
  readonly retainedGenerationKeys: readonly string[];
  readonly deletedGenerationKeys: readonly string[];
  readonly retainedBlobDigests: readonly string[];
  readonly deletedBlobDigests: readonly string[];
  readonly deletedGenerations: number;
  readonly deletedBlobs: number;
  readonly reclaimedBytes: number;
  readonly retainedGenerations: number;
  readonly retainedBlobs: number;
}

export interface MachineStore {
  claimOwner(identity: { groupId: string; ownerId: string; minimumEpoch?: number }): Promise<OwnerToken>;
  releaseOwner(token: OwnerToken): Promise<boolean>;
  assertOwner(token: OwnerToken): Promise<OwnerToken>;
  readOwner(groupId: string): Promise<OwnerRecord | null>;
  getBlob(digest: string): Promise<Uint8Array>;
  commitGeneration(value: {
    groupId: string;
    generationId: string;
    expectedHead: string | null;
    ownerToken: OwnerToken;
    blobs: ReadonlyArray<{ digest: string; bytes: Uint8Array }>;
    record: GenerationRecord;
    control?: OperationControl;
  }): Promise<GenerationHead>;
  readHead(groupId: string): Promise<GenerationHead | null>;
  readGeneration(groupId: string, generationId: string): Promise<GenerationRecord>;
  dryRunRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken }): Promise<PruneReport>;
  pruneRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken; control?: OperationControl }): Promise<PruneReport>;
  inspectStorage(): Promise<Readonly<{ blobs: number; blobBytes: number; generations: number; groups: number }>>;
  close(): void;
}

export class MemoryMachineStore implements MachineStore {
  constructor();
  claimOwner(identity: { groupId: string; ownerId: string; minimumEpoch?: number }): Promise<OwnerToken>;
  releaseOwner(token: OwnerToken): Promise<boolean>;
  assertOwner(token: OwnerToken): Promise<OwnerToken>;
  readOwner(groupId: string): Promise<OwnerRecord | null>;
  getBlob(digest: string): Promise<Uint8Array>;
  commitGeneration(value: Parameters<MachineStore["commitGeneration"]>[0]): Promise<GenerationHead>;
  readHead(groupId: string): Promise<GenerationHead | null>;
  readGeneration(groupId: string, generationId: string): Promise<GenerationRecord>;
  dryRunRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken }): Promise<PruneReport>;
  pruneRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken; control?: OperationControl }): Promise<PruneReport>;
  inspectStorage(): Promise<Readonly<{ blobs: number; blobBytes: number; generations: number; groups: number }>>;
  close(): void;
}

export class IndexedDbMachineStore implements MachineStore {
  constructor(options: { indexedDb: IDBFactory; databaseName: string; legacyOwnerDatabaseName?: string | null });
  claimOwner(identity: { groupId: string; ownerId: string; minimumEpoch?: number }): Promise<OwnerToken>;
  releaseOwner(token: OwnerToken): Promise<boolean>;
  assertOwner(token: OwnerToken): Promise<OwnerToken>;
  readOwner(groupId: string): Promise<OwnerRecord | null>;
  getBlob(digest: string): Promise<Uint8Array>;
  commitGeneration(value: Parameters<MachineStore["commitGeneration"]>[0]): Promise<GenerationHead>;
  readHead(groupId: string): Promise<GenerationHead | null>;
  readGeneration(groupId: string, generationId: string): Promise<GenerationRecord>;
  dryRunRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken }): Promise<PruneReport>;
  pruneRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken; control?: OperationControl }): Promise<PruneReport>;
  inspectStorage(): Promise<Readonly<{ blobs: number; blobBytes: number; generations: number; groups: number }>>;
  close(): void;
}

export class MachineCommitCoordinator {
  constructor(options: {
    store: MachineStore;
    cryptoProvider: MachineCryptoProvider;
    nowFactory: () => number;
  });
  readHead(groupId: string): Promise<GenerationHead | null>;
  commitPaused(options: {
    groupId: string;
    machines: Iterable<MachineHandle>;
    devices?: Record<string, BlockDevice>;
    expectedHead: string | null;
    ownerToken: OwnerToken;
    environmentFingerprint?: string | null;
    control?: OperationControl;
  }): Promise<GenerationCommitResult>;
  restoreLatest(options: {
    groupId: string;
    machines: ReadonlyMap<string, MachineHandle> | Record<string, MachineHandle>;
    devices?: Record<string, BlockDevice>;
    expectedEnvironmentFingerprint?: string | null;
    control?: OperationControl;
  }): Promise<{ generationId: string; recoveredFrom: string | null; failures: Array<{ generationId: string; code: string }>; commit: Record<string, unknown>; machines: Array<Record<string, unknown>>; devices: Array<Record<string, unknown>> }>;
  dryRunRecoveryWindow(options: { groupId: string; ownerToken: OwnerToken }): Promise<PruneReport>;
  pruneRecoveryWindow(options: { groupId: string; ownerToken: OwnerToken; control?: OperationControl }): Promise<PruneReport>;
  inspectStorage(): Promise<Readonly<{ blobs: number; blobBytes: number; generations: number; groups: number }>>;
}

export function webMachineOwnerLockName(groupId: string): string;

export class WebLockOwnerCoordinator {
  readonly groupId: string;
  readonly ownerId: string;
  constructor(options: {
    lockManager: LockManager;
    ownerStore: MachineStore;
    groupId: string;
    ownerId: string;
    onAcquired: (token: OwnerToken) => void | Promise<void>;
    onLost: (token: OwnerToken, reason: string) => void | Promise<void>;
  });
  start(control?: OperationControl): Promise<OwnerToken>;
  stop(reason?: string): Promise<void>;
  inspect(): Readonly<Record<string, unknown>>;
}

export interface WebMachineArchive {
  readonly manifest: Readonly<WebMachineManifest>;
  readonly signerFingerprint: string;
  readBlob(blobId: string): Uint8Array;
}

export interface WebMachineFile {
  readonly file: Blob;
  readonly manifest: Readonly<WebMachineManifest>;
}

export class MachineEnvelopeCoordinator {
  constructor(options: { cryptoProvider: MachineCryptoProvider; nowFactory: () => number });
  exportPaused(options: {
    groupId: string;
    machines: Iterable<MachineHandle>;
    devices?: Record<string, BlockDevice>;
    requiredCapabilities?: Record<string, string[]> | Map<string, string[]>;
    signingKeyPair: CryptoKeyPair;
    control?: OperationControl;
  }): Promise<WebMachineFile>;
  read(options: { file: Blob; trustedPublicKeys: JsonWebKey[]; control?: OperationControl }): Promise<WebMachineArchive>;
  preflightImport(options: {
    archive: WebMachineArchive;
    host: WebMachineHost;
    devices?: Record<string, BlockDevice>;
    approvedPermissions?: Record<string, MachinePermissions> | Map<string, MachinePermissions>;
    availableCapabilities?: Iterable<string>;
  }): Readonly<{ groupId: string; machineIds: readonly string[]; deviceNames: readonly string[] }>;
  importVerified(options: {
    archive: WebMachineArchive;
    host: WebMachineHost;
    devices?: Record<string, BlockDevice>;
    approvedPermissions?: Record<string, MachinePermissions> | Map<string, MachinePermissions>;
    availableCapabilities?: Iterable<string>;
    ownerToken?: OwnerToken;
    control?: OperationControl;
  }): Promise<Readonly<{
    archive: WebMachineArchive;
    machines: Map<string, MachineHandle>;
    preflight: Readonly<{ groupId: string; machineIds: readonly string[]; deviceNames: readonly string[] }>;
  }>>;
}

export function createWebMachineKeyPair(cryptoProvider: MachineCryptoProvider): Promise<CryptoKeyPair>;
export function exportWebMachinePublicKey(cryptoProvider: MachineCryptoProvider, publicKey: CryptoKey): Promise<JsonWebKey>;
export function fingerprintWebMachinePublicKey(cryptoProvider: MachineCryptoProvider, publicKey: CryptoKey): Promise<string>;
export function createWebMachineFile(options: {
  cryptoProvider: MachineCryptoProvider;
  groupId: string;
  createdAt: number;
  machines: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  signingKeyPair: CryptoKeyPair;
  control?: OperationControl;
}): Promise<WebMachineFile>;
export function readWebMachineFile(options: {
  file: Blob;
  cryptoProvider: MachineCryptoProvider;
  trustedPublicKeys: JsonWebKey[];
  control?: OperationControl;
}): Promise<WebMachineArchive>;
export function assertWebMachineArchive(value: unknown): asserts value is WebMachineArchive;


// Owned CPython/WASI guest adapter.
export function createCpythonWasiGuestFactory(options?: {
  bootMachine?: (options?: Record<string, unknown>) => Promise<KernelMachine>;
  openMachineImage?: (image: KernelMachineImage, options?: Record<string, unknown>) => Promise<KernelMachine>;
}): GuestAdapterFactory;


// ─── formerly @web-machine/guest-v86 ───
export interface V86Constructor {
  new(options: Record<string, unknown>): unknown;
}

export interface V86GuestFactoryOptions {
  V86: V86Constructor;
  adapterVersion?: string;
  blockDeviceName?: string | null;
  blockMode?: "drive" | "9p" | null;
  packetDeviceName?: string | null;
  displayDeviceName?: string | null;
  inputDeviceName?: string | null;
  framebufferDeviceName?: string | null;
  framebufferSource?: unknown;
  pointerDeviceName?: string | null;
  clockDeviceName?: string | null;
  entropyDeviceName?: string | null;
  instantiateWasm?: ((...args: unknown[]) => unknown) | null;
}

export function createV86GuestFactory(options: V86GuestFactoryOptions): GuestAdapterFactory;

// ─── Composition: one computer ───
export interface WebComputerPythonOptions {
  manifest?: Record<string, unknown>;
  kernel?: Record<string, unknown>;
  diskBytes?: number;
  bootMachine?: (options?: Record<string, unknown>) => Promise<KernelMachine>;
  openMachineImage?: (image: KernelMachineImage, options?: Record<string, unknown>) => Promise<KernelMachine>;
}

export interface WebComputerLinuxOptions {
  V86: V86Constructor;
  manifest: Record<string, unknown>;
  diskBytes?: number;
  adapterVersion?: string;
  adapterOptions?: Record<string, unknown>;
}

export interface WebComputerDurabilityOptions {
  groupId: string;
  store: MachineStore;
  /** Defaults to `navigator.locks` when available. */
  lockManager?: LockManager;
  ownerId?: string;
  nowFactory?: () => number;
  getSigningKeyPair?: () => Promise<CryptoKeyPair> | CryptoKeyPair;
  requiredCapabilities?: Record<string, string[]> | Map<string, string[]>;
  availableCapabilities?: string[];
  /** Exact engine, manifest, and asset identity persisted in every generation. */
  environmentFingerprint?: string | null;
  onOwnerChanged?: (event: Readonly<{
    state: "acquired" | "lost";
    token?: unknown;
    reason?: string;
  }>) => void;
}

export interface WebComputerInspection {
  readonly machines: Readonly<Record<string, MachineInspection>>;
  readonly devices: Readonly<Record<string, unknown>>;
  readonly owner: Readonly<Record<string, unknown>> | null;
  readonly startupMode: "none" | "deferred" | "booted" | "restored" | "imported" | "cold";
  readonly lifecycleState: "unconfigured" | "registered" | "waking" | "hot" | "draining" | "committing" | "stopping" | "cold" | "cleanupIncomplete" | "failed" | "disposed";
  readonly persistence: Readonly<{
    configured: boolean;
    environmentFingerprint: string | null;
    durabilityState: "unconfigured" | "clean" | "unsaved";
    durabilityError: string | null;
    cleanupPending: boolean;
    lastPrune: PruneReport | Readonly<{ error: string }> | null;
    cleanupError: string | null;
    lastSuspend: WebComputerSuspendReceipt | null;
    lastResume: Readonly<{
      generationId: string | null;
      recoveredFrom: string | null;
      environmentFingerprint: string | null;
    }> | null;
  }>;
}

export interface MachineSuspendSafety {
  activeCommands?: number;
  pendingApprovals?: number;
  unresolvedEffects?: number;
  outcomeUnknown?: boolean;
  unsaved?: boolean;
}

export interface WebComputerSuspendReceipt {
  readonly terminal: "suspended" | "cleanupIncomplete";
  readonly generationId: string;
  readonly environmentFingerprint: string | null;
  readonly error?: string;
  readonly retention?: PruneReport | Readonly<{ error: string }> | null;
  readonly cleanupPending?: boolean;
}

export interface WebComputer {
  host: WebMachineHost;
  devices: Record<string, unknown>;
  machines: Map<string, MachineHandle>;
  machine(machineId: string): MachineHandle;
  runningMachineIds(): string[];
  bootAll(control?: OperationControl): Promise<void>;
  pauseRunning(control?: OperationControl): Promise<string[]>;
  resumeMachineIds(machineIds: string[], control?: OperationControl): Promise<void>;
  resumeAll(control?: OperationControl): Promise<void>;
  shutdownAll(control?: OperationControl): Promise<void>;
  /**
   * Replace the machine set with machines built elsewhere - from an image manifest, a trust-screen
   * preflight, or a deferred-boot restore. The computer keeps the same Map instance, so every verb
   * above keeps operating on the adopted set. Throws if a value is not a machine handle.
   */
  adoptMachines(machines: Map<string, MachineHandle>): Map<string, MachineHandle>;
  adoptOwnership(token: unknown): void;
  invalidateOwnership(reason?: string): void;
  /** Acquire the single owner, then restore the durable HEAD or boot when no generation exists. */
  initialize(options?: {
    deferBoot?: boolean;
    control?: OperationControl;
    ownerControl?: OperationControl;
    restoreControl?: OperationControl;
    resumeControl?: OperationControl;
    pruneControl?: OperationControl;
  }): Promise<WebComputerInspection>;
  /** Reacquire ownership and restore the exact durable generation after a successful suspend. */
  resume(options?: {
    deferBoot?: boolean;
    control?: OperationControl;
    ownerControl?: OperationControl;
    restoreControl?: OperationControl;
    resumeControl?: OperationControl;
    pruneControl?: OperationControl;
  }): Promise<WebComputerInspection>;
  /** Pause every running guest, flush block devices, publish one fenced generation, then resume. */
  save(control?: OperationControl): Promise<GenerationCommitResult & {
    retention: PruneReport | Readonly<{ error: string }> | null;
    cleanupPending: boolean;
  }>;
  /** Commit and verify a safe terminal, terminate runtime owners, then release durable ownership. */
  suspend(options: {
    safety: MachineSuspendSafety;
    control?: OperationControl;
    pruneControl?: OperationControl;
    shutdownControl?: OperationControl;
  }): Promise<WebComputerSuspendReceipt>;
  /** Retry only the termination and owner-release half after a durable cleanupIncomplete terminal. */
  retrySuspendCleanup(control?: OperationControl): Promise<WebComputerSuspendReceipt>;
  /** Export all paused guest snapshots and block devices as one signed `.webmachine`. */
  exportImage(options?: {
    signingKeyPair?: CryptoKeyPair;
    requiredCapabilities?: Record<string, string[]> | Map<string, string[]>;
    control?: OperationControl;
  }): Promise<WebMachineFile>;
  /** Verify a signed image, stage it in an isolated context, atomically adopt it, and save it locally. */
  importImage(file: Blob | Uint8Array | ArrayBuffer, options: {
    trustedPublicKeys: Array<CryptoKey | JsonWebKey>;
    approvedPermissions: Record<string, MachinePermissions> | Map<string, MachinePermissions>;
    availableCapabilities?: string[];
    control?: OperationControl;
  }): Promise<Readonly<{
    archive: WebMachineArchive;
    machines: Map<string, MachineHandle>;
    committed: GenerationCommitResult;
    cleanupError: unknown;
  }>>;
  inspect(): WebComputerInspection;
  dispose(control?: OperationControl): Promise<void>;
}

export const WEB_COMPUTER_MACHINE_IDS: readonly string[];

export interface WebComputerBaseOptions {
  python?: WebComputerPythonOptions;
  linux?: WebComputerLinuxOptions | null;
  /** Additional adapter factories, installed in both the active and import-candidate contexts. */
  adapters?: Record<string, GuestAdapterFactory>;
  devices?: Record<string, unknown>;
  onConsole?: ((line: string) => void) | null;
  /**
   * Built-in L2 Ethernet switch, on by default and registered as the `network` device. With more
   * than one guest it is the only byte path between them. Pass `false` to disable it, or an
   * object to construct it with those options. TCP/IP is the guest's business; this device owns
   * only the frame contract (learning, flooding, queue bounds).
   */
  network?: boolean | { maxFrameBytes?: number; maxQueuedFrames?: number };
  /**
   * Whether to create the two default machines here. With `false` only the hardware is
   * assembled and the machines come from an image manifest instead; three call sites use that
   * mode (trust-screen preflight, assembling an import candidate, deferred-boot restore).
   */
  createMachines?: boolean;
}

export type WebComputerOptions = WebComputerBaseOptions & (
  | {
      /** Product-owned store/identity inputs that activate the durable lifecycle. */
      durability: WebComputerDurabilityOptions;
      /** Durability needs digest, signature, key generation, and random UUID support. */
      cryptoProvider?: Crypto;
    }
  | {
      durability?: null | undefined;
      /** The non-durable computer preserves the original minimal provider contract. */
      cryptoProvider?: { randomUUID(): string };
    }
);

export function createWebComputer(options?: WebComputerOptions): WebComputer;

// ─── Composition: bounded fleet of durable computers ───
export interface MachineFleetLease {
  readonly machineId: string;
  readonly leaseId: string;
  readonly epoch: number;
  readonly ownerEpoch: number;
  readonly purpose: string;
}

export interface MachineFleetRegistration {
  machineId: string;
  environmentFingerprint: string;
  createComputer(context: { machineId: string; environmentFingerprint: string }): WebComputer | Promise<WebComputer>;
  prefetch?: ((context: { machineId: string; environmentFingerprint: string; control?: OperationControl }) =>
    Promise<{ byteLength?: number } | void> | { byteLength?: number } | void) | null;
  priority?: number;
  pinned?: boolean;
}

export interface MachineFleetInspection {
  readonly hotLimit: number;
  readonly hot: number;
  readonly cold: number;
  readonly states: Readonly<Record<string, number>>;
  readonly machines: Readonly<Record<string, Readonly<{
    state: "registered" | "waking" | "hot" | "draining" | "committing" | "stopping" | "cold" | "cleanupIncomplete" | "failed";
    generationId: string | null;
    environmentFingerprint: string;
    leaseEpoch: number;
    leaseActive: boolean;
    activeCommands: number;
    safety: Readonly<Required<MachineSuspendSafety>>;
    lastTerminal: string | null;
    lastSuspend: WebComputerSuspendReceipt | null;
    lastResume: WebComputerInspection["persistence"]["lastResume"];
    prefetched: Readonly<{ environmentFingerprint: string; byteLength: number; completedAt: number }> | null;
    resources: Readonly<{ workers: number; runtimes: number; deviceLeases: number; timers: number | null }>;
  }>>>;
}

export interface MachineFleet {
  register(spec: MachineFleetRegistration): string;
  acquire(machineId: string, purpose?: string, control?: OperationControl): Promise<MachineFleetLease>;
  resume(machineId: string, purpose?: string, control?: OperationControl): Promise<MachineFleetLease>;
  use<T>(lease: MachineFleetLease, operation: (computer: WebComputer, lease: MachineFleetLease) => T | Promise<T>): Promise<T>;
  release(lease: MachineFleetLease, safety?: MachineSuspendSafety): Readonly<{ machineId: string; state: string; safety: Readonly<Required<MachineSuspendSafety>> }>;
  suspend(machineId: string, options: { lease: MachineFleetLease; control?: OperationControl }): Promise<WebComputerSuspendReceipt & { machineId: string; state: "cold" }>;
  retryCleanup(machineId: string, control?: OperationControl): Promise<WebComputerSuspendReceipt & { machineId: string; state: "cold" }>;
  setHotLimit(limit: number, control?: OperationControl): Promise<number>;
  prefetch(machineId: string, control?: OperationControl): Promise<Readonly<{ environmentFingerprint: string; byteLength: number; completedAt: number }>>;
  inspect(): MachineFleetInspection;
  dispose(control?: OperationControl): Promise<void>;
}

export function createMachineFleet(options?: {
  hotLimit?: number;
  idFactory?: () => string;
  nowFactory?: () => number;
  chooseCandidate?: ((candidates: ReadonlyArray<Readonly<{ machineId: string; lastUsedAt: number; priority: number; pinned: boolean }>>) => string) | null;
}): MachineFleet;
