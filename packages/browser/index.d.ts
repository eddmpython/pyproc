import type {
  MachineHandle,
  MachinePermissions,
  OperationControl,
  SnapshotScope,
  VirtualDevice,
  WebMachineHost,
  WebMachineManifest,
  WebMachineManifestContent,
} from "@web-machine/core";

export function createBrowserHost(options: {
  devices?: Record<string, VirtualDevice>;
  cryptoProvider: Crypto;
}): WebMachineHost;

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

export interface GenerationRecord {
  manifest: Record<string, unknown>;
  manifestHash: string;
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
    cryptoProvider: Crypto;
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
  }): Promise<GenerationRecord & { head: GenerationHead }>;
  restoreLatest(options: {
    groupId: string;
    machines: ReadonlyMap<string, MachineHandle> | Record<string, MachineHandle>;
    devices?: Record<string, BlockDevice>;
    control?: OperationControl;
  }): Promise<Record<string, unknown>>;
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
  constructor(options: { cryptoProvider: Crypto; nowFactory: () => number });
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

export function createWebMachineKeyPair(cryptoProvider: Crypto): Promise<CryptoKeyPair>;
export function exportWebMachinePublicKey(cryptoProvider: Crypto, publicKey: CryptoKey): Promise<JsonWebKey>;
export function fingerprintWebMachinePublicKey(cryptoProvider: Crypto, publicKey: CryptoKey): Promise<string>;
export function createWebMachineFile(options: {
  cryptoProvider: Crypto;
  groupId: string;
  createdAt: number;
  machines: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  signingKeyPair: CryptoKeyPair;
  control?: OperationControl;
}): Promise<WebMachineFile>;
export function readWebMachineFile(options: {
  file: Blob;
  cryptoProvider: Crypto;
  trustedPublicKeys: JsonWebKey[];
  control?: OperationControl;
}): Promise<WebMachineArchive>;
export function assertWebMachineArchive(value: unknown): asserts value is WebMachineArchive;

export type { SnapshotScope, WebMachineManifestContent };
