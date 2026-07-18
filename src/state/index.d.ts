// state/index.d.ts - pyproc/history subpath 타입 계약.
// 모델: 상태는 두 구역의 단일 역사 저장소에 산다. 휘발 구역(체크포인트 나무)은 런타임
// 핸들의 history 동사가 다루고, 이 표면은 내구 구역의 계약이다: 오브젝트 문법, 커밋·부활
// 프로토콜, store 계약, 서명 tag, 이동 bundle.

export interface StateCryptoProvider {
  subtle: SubtleCrypto;
}

// ---- 주소/다이제스트 (정본 형식은 "sha256:<hex>" 하나) ----
export const SHA256_ADDRESS_RE: RegExp;
export function parseSha256Address(value: unknown): string | null;
export function sha256Address(data: Uint8Array | ArrayBuffer | string): Promise<string>;
export function sha256AddressWith(cryptoProvider: StateCryptoProvider, data: Uint8Array | ArrayBuffer | string): Promise<string>;
export function sha256HexWith(cryptoProvider: StateCryptoProvider, data: Uint8Array | ArrayBuffer | string): Promise<string>;
export function verifySha256(bytes: Uint8Array, expected: string): Promise<{ ok: boolean; actual: string; expectedHex: string | null }>;
export function verifySha256With(cryptoProvider: StateCryptoProvider, bytes: Uint8Array, expected: string): Promise<{ ok: boolean; actual: string; expectedHex: string | null }>;
export const PAGE_SIZE: number;

// ---- 오브젝트 모델 ----
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

// ---- store 계약 (backend 주입, 원자성은 backend 책임) ----
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

// ---- 커밋·부활 프로토콜 ----
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

// ---- 서명 tag (출처) ----
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

// ---- 이동 bundle (단일 봉투 포맷, docs/reference/bundleFormat.md가 레이아웃 정본) ----
export const STATE_BUNDLE_MAGIC: "PYBUNDLE1\n";
export const STATE_BUNDLE_VERSION: 1;
export const STATE_BUNDLE_HEAD_MAX_BYTES: number;
export function isStateBundle(buf: Uint8Array): boolean;
export function encodeStateBundle(
  cryptoProvider: StateCryptoProvider,
  input: { commit: string; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, Uint8Array]>; tag?: StateTag | null },
): Promise<Uint8Array>;
export function unsignedStateBundleDigest(
  cryptoProvider: StateCryptoProvider,
  input: { commit: string; meta?: unknown; objects: Map<string, Uint8Array> | Array<[string, Uint8Array]> },
): Promise<string>;
export function decodeStateBundle(
  cryptoProvider: StateCryptoProvider,
  buf: Uint8Array,
): Promise<{ commit: string; meta: unknown; objects: Map<string, Uint8Array>; tag: StateTag | null; envelope: string; unsignedDigest: string }>;
