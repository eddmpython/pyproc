// state/index.d.ts - type contract of the pyproc/history subpath.
// Model: state lives in one history store with two regions. The volatile region (the
// checkpoint tree) is driven by the history verbs on a runtime handle; this surface is the
// contract of the durable region: object grammar, commit/revive protocol, the store
// contract, signed tags, and the portable bundle.

export interface StateCryptoProvider {
  subtle: SubtleCrypto;
}

// ---- Addresses and digests (one canonical form: "sha256:<hex>") ----
export const SHA256_ADDRESS_RE: RegExp;
export function parseSha256Address(value: unknown): string | null;
export function sha256Address(data: Uint8Array | ArrayBuffer | string): Promise<string>;
export function sha256AddressWith(cryptoProvider: StateCryptoProvider, data: Uint8Array | ArrayBuffer | string): Promise<string>;
export function sha256HexWith(cryptoProvider: StateCryptoProvider, data: Uint8Array | ArrayBuffer | string): Promise<string>;
export function verifySha256(bytes: Uint8Array, expected: string): Promise<{ ok: boolean; actual: string; expectedHex: string | null }>;
export function verifySha256With(cryptoProvider: StateCryptoProvider, bytes: Uint8Array, expected: string): Promise<{ ok: boolean; actual: string; expectedHex: string | null }>;
export const PAGE_SIZE: number;

export interface StorageDurabilityInspection {
  readonly protocol: "pyproc.storage-durability";
  readonly version: 1;
  readonly mode: "persistent" | "best-effort";
  readonly persisted: boolean;
  readonly estimate: Readonly<{ usage: number | null; quota: number | null;
    remaining: number | null; exact: false }>;
  readonly eviction: Readonly<{
    protection: "user-mediated" | "browser-heuristic";
    detection: "external-witness-required";
    recovery: "external-copy-required";
  }>;
  readonly quotaFailureCode: "PYPROC_STORAGE_QUOTA_EXCEEDED";
  readonly evictionFailureCode: "PYPROC_STORAGE_EVICTED";
}
export interface StorageEvictionWitness {
  readonly protocol: "pyproc.storage-eviction-witness";
  readonly version: 1;
  readonly namespace: string;
  readonly witnessId: string;
  readonly digest: `sha256:${string}`;
}
export const STORAGE_DURABILITY_PROTOCOL: "pyproc.storage-durability";
export const STORAGE_DURABILITY_VERSION: 1;
export const STORAGE_EVICTION_WITNESS_PROTOCOL: "pyproc.storage-eviction-witness";
export const STORAGE_EVICTION_WITNESS_VERSION: 1;
export class BrowserStorageDurability {
  constructor(options: { storageManager: StorageManager; directory: FileSystemDirectoryHandle; namespace?: string });
  static open(options?: { storageManager?: StorageManager; directory?: FileSystemDirectoryHandle | null;
    namespace?: string }): Promise<BrowserStorageDurability>;
  inspect(): Promise<StorageDurabilityInspection>;
  requestPersistence(): Promise<Readonly<{ protocol: "pyproc.storage-persistence-receipt"; version: 1;
    granted: boolean; durability: StorageDurabilityInspection }>>;
  createWitness(input: { witnessId: string }): Promise<StorageEvictionWitness>;
  verifyWitness(witness: StorageEvictionWitness): Promise<Readonly<{
    protocol: "pyproc.storage-witness-verification"; version: 1; state: "available";
    witness: StorageEvictionWitness;
  }>>;
  runWrite<T>(operation: () => T | Promise<T>, options?: {
    operation?: string; requiredBytes?: number | null;
  }): Promise<T>;
}

// ---- Object model ----
export interface StatePageTableTree {
  kind: "pageTable";
  pageSize: number;
  heapLen: number;
  sp: number | null;
  pages: Array<[number, string]>;
  files?: Array<{ id: string; address: string; byteLength: number; meta: object | null }>;
}
export interface StatePayloadTree {
  kind: "payload";
  entries: Array<{ id: string; address: string; byteLength: number }>;
}
export type StateTree = StatePageTableTree | StatePayloadTree;
export interface StateCommitEnv {
  h0: string | null;
  engineAssetDigest: string | null;
  deterministic: boolean;
}
export interface StateCommit {
  parents: string[];
  tree: string;
  env: StateCommitEnv;
  fence: { ownerId: string; epoch: number } | null;
  createdAt: string | null;
}
export function canonicalStateJson(value: unknown): string;
export function encodeStateObject(value: unknown): Uint8Array;
export function decodeStateObject(bytes: Uint8Array): unknown;
export function stateAddressOf(cryptoProvider: StateCryptoProvider, bytes: Uint8Array): Promise<string>;
export function makePageTableTree(input: Omit<StatePageTableTree, "kind">): StatePageTableTree;
export function makePayloadTree(input: Omit<StatePayloadTree, "kind">): StatePayloadTree;
export function validateStateTree(tree: unknown): StateTree;
export function makeStateCommit(input: Partial<StateCommit> & { tree: string }): StateCommit;
export function validateStateCommit(commit: unknown): StateCommit;

// ---- Store contract (the backend is injected; atomicity is the backend's duty) ----
export interface StateRefReading {
  ref?: { commit: string };
  missing?: true;
  corrupt?: string;
}
export interface StateStore {
  hasObject(address: string): Promise<boolean>;
  writeObject(address: string, bytes: Uint8Array): Promise<void>;
  readObject(address: string): Promise<Uint8Array | null>;
  readRef(name: string): Promise<StateRefReading>;
  writeRef(name: string, ref: { commit: string }): Promise<void>;
  readOwner(): Promise<{ ownerId: string; epoch: number } | null>;
}
export class MemoryStateStore implements StateStore {
  hasObject(address: string): Promise<boolean>;
  writeObject(address: string, bytes: Uint8Array): Promise<void>;
  readObject(address: string): Promise<Uint8Array | null>;
  readRef(name: string): Promise<StateRefReading>;
  writeRef(name: string, ref: { commit: string }): Promise<void>;
  readOwner(): Promise<{ ownerId: string; epoch: number } | null>;
  claimOwner(ownerId: string): Promise<{ ownerId: string; epoch: number }>;
  corruptRef(name: string, reason?: string): void;
  deleteRef(name: string): void;
  tamperObject(address: string, bytes: Uint8Array): void;
  objectCount(): number;
  entries(): Array<[string, Uint8Array]>;
}
export class OpfsStateStore implements StateStore {
  constructor(dir: FileSystemDirectoryHandle);
  hasObject(address: string): Promise<boolean>;
  writeObject(address: string, bytes: Uint8Array): Promise<void>;
  readObject(address: string): Promise<Uint8Array | null>;
  readRef(name: string): Promise<StateRefReading>;
  writeRef(name: string, ref: { commit: string }): Promise<void>;
  readOwner(): Promise<null>;
  countObjects(): Promise<number>;
}

// ---- Commit and revive protocol ----
export interface CommitStateResult {
  commitAddress: string;
  treeAddress: string;
  wrote: number;
  deduped: number;
  pagesWrote: number;
  filesWrote: number;
  metaWrote: number;
}
export function commitState(
  cryptoProvider: StateCryptoProvider,
  store: StateStore,
  input: {
    pages?: Array<[number, Uint8Array]>;
    pageSize?: number;
    heapLen?: number;
    sp?: number | null;
    files?: Array<{ id: string; bytes: Uint8Array; meta?: object | null }>;
    payloads?: Array<{ id: string; bytes: Uint8Array }>;
    env?: Partial<StateCommitEnv>;
    fence?: { ownerId: string; epoch: number } | null;
    parents?: string[];
    createdAt?: string | null;
  },
): Promise<CommitStateResult>;
export interface OpenStateResult {
  commit: StateCommit;
  commitAddress: string;
  tree: StateTree;
  pages?: Map<number, Uint8Array>;
  files?: Map<string, { bytes: Uint8Array; meta: object | null }>;
  entries?: Map<string, Uint8Array>;
  generation: "head" | "prev";
  fallback?: true;
  headFailure?: string | null;
}
export function openState(
  cryptoProvider: StateCryptoProvider,
  store: StateStore,
  opts?: { expectH0?: string | null },
): Promise<OpenStateResult | null>;

// ---- Signed tags (provenance) ----
export const STATE_TAG_ALG: "ECDSA-P256-SHA256";
export interface StateTag {
  alg: "ECDSA-P256-SHA256";
  target: string;
  publicKey: { kty: "EC"; crv: "P-256"; x: string; y: string };
  signature: string;
}
export function canonicalStateJwk(jwk: JsonWebKey): { kty: "EC"; crv: "P-256"; x: string; y: string };
export function createStateKeyPair(cryptoProvider: StateCryptoProvider): Promise<CryptoKeyPair>;
export function exportStatePublicKey(cryptoProvider: StateCryptoProvider, publicKey: CryptoKey): Promise<{ kty: "EC"; crv: "P-256"; x: string; y: string }>;
export function fingerprintStatePublicKey(cryptoProvider: StateCryptoProvider, publicKeyOrJwk: CryptoKey | JsonWebKey): Promise<string>;
export function importStatePublicKey(cryptoProvider: StateCryptoProvider, key: CryptoKey | JsonWebKey): Promise<CryptoKey>;
export function signStateDigest(cryptoProvider: StateCryptoProvider, privateKey: CryptoKey, target: string): Promise<Uint8Array>;
export function verifyStateDigest(cryptoProvider: StateCryptoProvider, publicKeyOrJwk: CryptoKey | JsonWebKey, target: string, signatureBytes: Uint8Array): Promise<boolean>;
export function makeStateTag(cryptoProvider: StateCryptoProvider, privateKey: CryptoKey, publicKeyJwk: JsonWebKey, target: string): Promise<StateTag>;
export function signStateTag(cryptoProvider: StateCryptoProvider, keyPair: CryptoKeyPair, target: string): Promise<StateTag>;
export function verifyStateTag(
  cryptoProvider: StateCryptoProvider,
  tag: StateTag,
  expectedTarget: string | null,
  opts?: { trustedPublicKeys?: Array<JsonWebKey | CryptoKey | string> },
): Promise<{ valid: boolean; trusted: boolean; signerFingerprint: string | null }>;

// ---- Portable bundle (one envelope format; skills/reference-pyproc-api/references/bundle-format.md is the layout canon) ----
export const STATE_BUNDLE_MAGIC: "PYBUNDLE1\n";
export const STATE_BUNDLE_VERSION: 1;
export const STATE_BUNDLE_HEAD_MAX_BYTES: number;
export function isStateBundle(buf: Uint8Array): boolean;
export function encodeStateBundle(
  cryptoProvider: StateCryptoProvider,
  input: { commit: string; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, Uint8Array]>; tag?: StateTag | null },
): Promise<Uint8Array>;
export function stateBundleHeaderDigest(
  cryptoProvider: StateCryptoProvider,
  input: { commit: string; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, Uint8Array]> | Array<[string, number]> },
): Promise<string>;
export function readStateBundleHeader(
  cryptoProvider: StateCryptoProvider,
  source: Uint8Array | Blob | { read(start: number, end: number): Promise<Uint8Array> },
): Promise<{ commit: string; meta: unknown; objects: Array<[string, number]>; tag: StateTag | null; envelope: string; headerDigest: string; objectsOffset: number }>;
export function decodeStateBundle(
  cryptoProvider: StateCryptoProvider,
  buf: Uint8Array,
): Promise<{ commit: string; meta: unknown; objects: Map<string, Uint8Array>; tag: StateTag | null; envelope: string; headerDigest: string }>;
