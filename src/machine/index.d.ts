// machine/index.d.ts - pyproc/machine subpath 타입 계약.
// 옛 @web-machine/{core,browser,guest-pyproc,guest-v86} 네 index.d.ts를 한 모듈로 합쳤다.
// 계약 의미는 그대로다: 게이트가 GenerationHead/MachineStore 의미 일치를 검사한다.

// ─── 옛 @web-machine/core ───
export type SnapshotScope = "portable" | "session" | "none";
export type MachineState = "created" | "running" | "paused" | "stopped" | "failed";

export interface OperationControl {
  signal?: AbortSignal;
  deadlineAt?: number;
}

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
}

export class WebMachineHost {
  constructor(options: { devices?: Record<string, VirtualDevice>; idFactory: () => string });
  registerAdapter(adapterId: string, factory: GuestAdapterFactory): this;
  registerDevice(name: string, device: VirtualDevice): this;
  createMachine(options: CreateMachineOptions): MachineHandle;
  getMachine(machineId: string): MachineHandle | null;
  preflightMachine(options: {
    machineId: string;
    adapterId: string;
    adapterVersion: string;
    snapshotScope: SnapshotScope;
    permissions?: MachinePermissions;
  }): Readonly<AdapterCapabilities>;
}

export class WebMachineError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown);
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

/** 상태 커널의 header-target 서명 tag(bundle 봉투가 나르는 출처). */
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

// ─── 옛 @web-machine/browser ───
export function createBrowserHost(options: {
  devices?: Record<string, VirtualDevice>;
  cryptoProvider: MachineCryptoProvider;
}): WebMachineHost;

/**
 * 상태 커널의 암호 법(digest·ECDSA)을 machine 층에 배달하는 주입 provider.
 * persistence/image 생성자는 맨 Crypto가 아니라 이 provider를 요구한다:
 * machine은 커널을 import하지 못하므로(경계), 조립이 함수 조각을 꽂는다.
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
   * 상태 커널 문법의 함수 조각(coordinator가 generation을 커널 오브젝트로 저장하고,
   * image가 .webmachine 봉투를 단일 bundle wire 포맷으로 인코딩하는 데 쓴다).
   */
  state: {
    encodeObject(value: unknown): Uint8Array;
    decodeObject(bytes: Uint8Array): unknown;
    makePayloadTree(input: { entries: Array<{ id: string; address: string; byteLength: number; meta?: Record<string, unknown> | null }> }): Record<string, unknown>;
    makeStateCommit(input: Record<string, unknown>): Record<string, unknown>;
    validateStateCommit(commit: unknown): Record<string, unknown> & { tree: string; parents: string[] };
    validateStateTree(tree: unknown): Record<string, unknown> & { kind: string; entries?: GenerationEntry[] };
    /** 이동 봉투 코덱(bundleFormat 정본 주입). objects = Map(주소 -> 바이트) 또는 [주소, 바이트] 배열. */
    encodeBundle(input: { commit?: string | null; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, Uint8Array]>; tag?: unknown }): Promise<Uint8Array>;
    decodeBundle(buffer: Uint8Array): Promise<{ commit: string | null; meta: unknown; objects: Map<string, Uint8Array>; tag: unknown; envelope: string; headerDigest: string }>;
    readBundleHeader(source: Uint8Array | Blob | { read(start: number, end: number): Promise<Uint8Array> | Uint8Array }): Promise<{ commit: string | null; meta: unknown; objects: Array<[string, number]>; tag: MachineStateTag | null; envelope: string; headerDigest: string; objectsOffset: number }>;
    bundleHeaderDigest(input: { commit?: string | null; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, unknown]> }): Promise<string>;
    /** header-target 서명(출처). tag.target = 헤더 다이제스트. */
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
 * generation record = 커널 commit 주소 + gc 도달 색인. 정본은 commit 체인이고
 * 복원은 색인을 신뢰하지 않는다(coordinator가 commit -> tree를 걷는다).
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
    idFactory: () => string;
    nowFactory: () => number;
  });
  readHead(groupId: string): Promise<GenerationHead | null>;
  commitPaused(options: {
    groupId: string;
    machines: Iterable<MachineHandle>;
    devices?: Record<string, BlockDevice>;
    expectedHead: string | null;
    ownerToken: OwnerToken;
    control?: OperationControl;
  }): Promise<GenerationCommitResult>;
  restoreLatest(options: {
    groupId: string;
    machines: ReadonlyMap<string, MachineHandle> | Record<string, MachineHandle>;
    devices?: Record<string, BlockDevice>;
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


// ─── 옛 @web-machine/guest-pyproc ───
export interface PyprocFileSystem {
  exists(path: string): boolean;
  mkdirTree(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { isDir: boolean; isFile: boolean };
  readFile(path: string): Uint8Array;
  writeFile(path: string, value: ArrayBuffer | ArrayBufferView): void;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export interface PyprocGuestSession {
  rt: {
    fs: PyprocFileSystem;
    memory: { byteLength(): number };
    run(code: string): unknown;
  };
  exportImage(options: { includeHome: boolean }): Promise<Blob>;
}

export function createPyprocGuestFactory(options: {
  bootSession: (options: Record<string, unknown>) => Promise<PyprocGuestSession>;
  openMachine: (image: Blob, options: { trust: true }) => Promise<PyprocGuestSession>;
  blockDeviceName?: string | null;
}): GuestAdapterFactory;

// ─── 옛 @web-machine/guest-v86 ───
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

// ─── 조립: 컴퓨터 한 대 ───
export interface WebComputerPythonOptions {
  manifest?: Record<string, unknown>;
  session?: Record<string, unknown>;
  diskBytes?: number;
  bootSession?: (options: Record<string, unknown>) => Promise<unknown>;
  openMachine?: (...args: unknown[]) => Promise<unknown>;
}

export interface WebComputerLinuxOptions {
  V86: V86Constructor;
  manifest: Record<string, unknown>;
  diskBytes?: number;
  adapterVersion?: string;
  adapterOptions?: Record<string, unknown>;
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
  adoptOwnership(token: unknown): void;
  invalidateOwnership(reason?: string): void;
}

export const WEB_COMPUTER_MACHINE_IDS: readonly string[];

export function createWebComputer(options?: {
  python?: WebComputerPythonOptions;
  linux?: WebComputerLinuxOptions | null;
  devices?: Record<string, unknown>;
  onConsole?: ((line: string) => void) | null;
  cryptoProvider?: { randomUUID(): string };
}): WebComputer;
