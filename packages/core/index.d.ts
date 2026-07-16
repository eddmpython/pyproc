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
