// kernelVfs.js - Layer 0: journaled content-addressed kernel filesystem.
import { PyProcError } from "../errors.js";
import { normalizeBrowserStorageWriteError } from "../browserStorageDurability.js";
import { sha256Address } from "../contentDigest.js";

export const KERNEL_VFS_ROOT_PROTOCOL = "pyproc.kernel-vfs-root";
export const KERNEL_VFS_ROOT_VERSION = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function vfsError(code, message, context = {}) {
  const pyprocCode = code === "KERNEL_VFS_CORRUPT" ? "PYPROC_STATE_CORRUPT"
    : code === "KERNEL_VFS_HEAD_CONFLICT" || code === "KERNEL_VFS_OWNER_STALE"
      ? "PYPROC_STATE_FENCE_STALE" : "PYPROC_INPUT_INVALID";
  return new PyProcError(pyprocCode, message, { context: { ...context, kernelCode: code } });
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return textEncoder.encode(value);
  throw vfsError("KERNEL_VFS_INPUT_INVALID", "KernelVfs accepts bytes or strings");
}

function jsonBytes(value) {
  return textEncoder.encode(JSON.stringify(value));
}

function parseJson(bytes, label) {
  try { return JSON.parse(textDecoder.decode(bytes)); }
  catch (error) { throw vfsError("KERNEL_VFS_CORRUPT", `KernelVfs ${label} JSON is invalid`, { cause: String(error) }); }
}

function normalizePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs path must be an absolute POSIX path");
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || !part)) {
    throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs path cannot contain traversal segments");
  }
  const normalized = `/${parts.join("/")}`;
  if (!normalized.startsWith("/home/") && normalized !== "/home"
    && !normalized.startsWith("/tmp/") && normalized !== "/tmp"
    && !normalized.startsWith("/dev/") && normalized !== "/dev") {
    throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs path is outside a writable mount");
  }
  return normalized;
}

function canonicalEntries(entries) {
  return [...entries.values()].map((entry) => ({ ...entry }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function rootRecord(entries) {
  const record = { protocol: KERNEL_VFS_ROOT_PROTOCOL, version: KERNEL_VFS_ROOT_VERSION,
    entries: canonicalEntries(entries) };
  const bytes = jsonBytes(record);
  return { record, bytes, rootDigest: await sha256Address(bytes) };
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export class MemoryKernelVfsStore {
  constructor() {
    this.collections = new Map();
    this.head = null;
  }

  _collection(kind) {
    if (!this.collections.has(kind)) this.collections.set(kind, new Map());
    return this.collections.get(kind);
  }

  async put(kind, key, bytes) {
    const collection = this._collection(kind);
    const copy = bytesOf(bytes).slice();
    const previous = collection.get(key);
    if (previous && !equalBytes(previous, copy)) {
      throw vfsError("KERNEL_VFS_CORRUPT", "Immutable KernelVfs object key was reused with different bytes", { kind, key });
    }
    if (!previous) collection.set(key, copy);
  }

  async get(kind, key) {
    const value = this._collection(kind).get(key);
    return value ? value.slice() : null;
  }

  async list(kind) { return [...this._collection(kind).keys()].sort(); }
  async remove(kind, key) { return this._collection(kind).delete(key); }
  async getHead() { return this.head ? structuredClone(this.head) : null; }

  async compareAndSwapHead(expectedRootDigest, nextHead) {
    const actual = this.head?.rootDigest || null;
    if (actual !== expectedRootDigest) return false;
    this.head = structuredClone(nextHead);
    return true;
  }

  async replaceHead(nextHead) { this.head = structuredClone(nextHead); }
  async withCommitLock(operation) { return operation(); }
}

function safeStoreName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw vfsError("KERNEL_VFS_INPUT_INVALID", "KernelVfs OPFS volume name is invalid");
  }
  return value;
}

async function readFileHandle(directory, name) {
  try {
    const handle = await directory.getFileHandle(name);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

async function writeFileHandle(directory, name, bytes) {
  let existed = true;
  let handle = null;
  let writable = null;
  try {
    try { handle = await directory.getFileHandle(name); }
    catch (error) {
      if (error?.name !== "NotFoundError") throw error;
      existed = false;
      handle = await directory.getFileHandle(name,{create:true});
    }
    writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }
  catch (error) {
    if (writable) try { await writable.abort(); } catch (ignored) {}
    if (!existed) try { await directory.removeEntry(name); } catch (ignored) {}
    throw normalizeBrowserStorageWriteError(error, {
      operation:"kernelVfs.write", file:name, requiredBytes:bytes.byteLength,
    });
  }
}

export class OpfsKernelVfsStore {
  constructor(directory, volumeName) {
    this.directory = directory;
    this.volumeName = volumeName;
    this.lockName = `pyproc-kernel-vfs:${volumeName}`;
  }

  static async open({ volumeName, root = null } = {}) {
    const acceptedName = safeStoreName(volumeName);
    const storageRoot = root || await navigator.storage.getDirectory();
    const pyprocRoot = await storageRoot.getDirectoryHandle("pyproc-kernel-vfs", { create: true });
    const directory = await pyprocRoot.getDirectoryHandle(acceptedName, { create: true });
    return new OpfsKernelVfsStore(directory, acceptedName);
  }

  _name(kind, key) { return `${kind}--${encodeURIComponent(key)}`; }

  async put(kind, key, bytes) {
    const name = this._name(kind, key);
    const copy = bytesOf(bytes);
    const previous = await readFileHandle(this.directory, name);
    if (previous && !equalBytes(previous, copy)) {
      throw vfsError("KERNEL_VFS_CORRUPT", "Immutable OPFS KernelVfs object key was reused", { kind, key });
    }
    if (!previous) await writeFileHandle(this.directory, name, copy);
  }

  async get(kind, key) { return readFileHandle(this.directory, this._name(kind, key)); }

  async list(kind) {
    const prefix = `${kind}--`;
    const keys = [];
    for await (const [name, handle] of this.directory.entries()) {
      if (handle.kind === "file" && name.startsWith(prefix)) keys.push(decodeURIComponent(name.slice(prefix.length)));
    }
    return keys.sort();
  }

  async remove(kind, key) {
    try { await this.directory.removeEntry(this._name(kind, key)); return true; }
    catch (error) { if (error?.name === "NotFoundError") return false; throw error; }
  }

  async getHead() {
    const bytes = await readFileHandle(this.directory, "HEAD.json");
    return bytes ? parseJson(bytes, "HEAD") : null;
  }

  async compareAndSwapHead(expectedRootDigest, nextHead) {
    return this.withCommitLock(async () => {
      const actual = (await this.getHead())?.rootDigest || null;
      if (actual !== expectedRootDigest) return false;
      await writeFileHandle(this.directory, "HEAD.json", jsonBytes(nextHead));
      return true;
    });
  }

  async replaceHead(nextHead) { await writeFileHandle(this.directory, "HEAD.json", jsonBytes(nextHead)); }

  async withCommitLock(operation) {
    if (!navigator.locks?.request) return operation();
    return navigator.locks.request(this.lockName, { mode: "exclusive" }, operation);
  }
}

export class KernelDeviceRegistry {
  constructor({ authorize = () => false } = {}) {
    this.authorize = authorize;
    this.providers = new Map();
  }

  register(name, provider) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(name)
      || !provider || !Array.isArray(provider.operations) || typeof provider.invoke !== "function"
      || typeof provider.checkpointDisposition !== "function") {
      throw vfsError("KERNEL_VFS_DEVICE_INVALID", "Kernel device provider contract is invalid");
    }
    if (this.providers.has(name)) throw vfsError("KERNEL_VFS_DEVICE_INVALID", "Kernel device is already registered", { name });
    this.providers.set(name, provider);
    return Object.freeze({ protocol: "pyproc.device-ref", version: 1, path: `/dev/${name}`,
      name, operations: Object.freeze([...provider.operations]) });
  }

  async invoke(reference, operation, input, context = {}) {
    const provider = this.providers.get(reference?.name);
    if (!provider || reference.path !== `/dev/${reference.name}` || !provider.operations.includes(operation)) {
      throw vfsError("KERNEL_VFS_DEVICE_INVALID", "Kernel device reference or operation is invalid");
    }
    if (!await this.authorize({ reference, operation, input, context })) {
      throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Kernel device operation is not authorized", {
        context: { kernelCode: "KERNEL_VFS_DEVICE_DENIED", operation, device: reference.name },
      });
    }
    return provider.invoke(operation, input, context);
  }

  checkpointResources() {
    return [...this.providers.entries()].map(([name, provider]) => {
      const disposition = provider.checkpointDisposition();
      if (!["closed", "reopenable", "reconcile", "forbidden"].includes(disposition)) {
        throw vfsError("KERNEL_VFS_DEVICE_INVALID", "Kernel device checkpoint disposition is invalid", { name, disposition });
      }
      return Object.freeze({ resourceRef: `device:${name}`, type: "device", disposition });
    });
  }
}

class KernelVfsTransaction {
  constructor(vfs, transactionId, baseRootDigest, entries) {
    this.vfs = vfs;
    this.transactionId = transactionId;
    this.baseRootDigest = baseRootDigest;
    this.entries = new Map(entries.map((entry) => [entry.path, { ...entry }]));
    this.objects = new Map();
    this.state = "open";
  }

  _open() {
    if (this.state !== "open") throw vfsError("KERNEL_VFS_TRANSACTION_CLOSED", "KernelVfs transaction is closed");
  }

  async write(path, value, options = {}) {
    this._open();
    const normalized = normalizePath(path);
    if (!normalized.startsWith("/home/")) throw vfsError("KERNEL_VFS_PATH_INVALID", "Durable transaction writes only /home");
    const bytes = bytesOf(value).slice();
    const objectSha256 = await sha256Address(bytes);
    this.objects.set(objectSha256, bytes);
    this.entries.set(normalized, { path: normalized, type: "file", objectSha256,
      byteLength: bytes.byteLength, mode: options.mode ?? 0o600 });
  }

  remove(path) {
    this._open();
    const normalized = normalizePath(path);
    if (!this.entries.delete(normalized)) throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs remove target does not exist", { path: normalized });
  }

  rename(from, to) {
    this._open();
    const source = normalizePath(from);
    const destination = normalizePath(to);
    const entry = this.entries.get(source);
    if (!entry || !source.startsWith("/home/") || !destination.startsWith("/home/")) {
      throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs rename source or destination is invalid");
    }
    this.entries.delete(source);
    this.entries.set(destination, { ...entry, path: destination });
  }

  async commit(options = {}) {
    this._open();
    const receipt = await this.vfs._commit(this, options);
    this.state = "committed";
    return receipt;
  }

  abort() {
    this._open();
    this.state = "aborted";
    this.vfs._transactionFinished(this.transactionId);
  }
}

export class KernelVfs {
  constructor(store, { volumeId = "default", ownerId = null, leaseMs = 30000, now = () => Date.now(),
    devices = null } = {}) {
    if (!store || typeof store.put !== "function" || typeof store.compareAndSwapHead !== "function") {
      throw vfsError("KERNEL_VFS_INPUT_INVALID", "KernelVfs requires a storage adapter");
    }
    this.store = store;
    this.volumeId = safeStoreName(volumeId);
    this.ownerId = ownerId || `owner:${crypto.randomUUID()}`;
    this.leaseMs = leaseMs;
    this.now = now;
    this.ownerEpoch = null;
    this.rootDigest = null;
    this.entries = new Map();
    this.sequence = 0;
    this.transactionCounter = 0;
    this.activeTransactions = new Set();
    this.tmp = new Map();
    this.devices = devices || new KernelDeviceRegistry();
  }

  async open() {
    await this._acquireOwner();
    const recovery = await this.recover();
    if (!this.rootDigest) await this._createGenesis();
    return Object.freeze({ protocol: "pyproc.kernel-vfs-open", version: 1, volumeId: this.volumeId,
      ownerId: this.ownerId, ownerEpoch: this.ownerEpoch, rootDigest: this.rootDigest,
      recovered: recovery.recovered, discardedCandidates: recovery.discardedCandidates });
  }

  async _acquireOwner() {
    const previousBytes = await this.store.get("meta", "owner");
    const previous = previousBytes ? parseJson(previousBytes, "owner") : null;
    const currentTime = this.now();
    if (previous && previous.ownerId !== this.ownerId && previous.expiresAt > currentTime) {
      throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "KernelVfs volume has a live owner", {
        context: { kernelCode: "KERNEL_VFS_OWNER_BUSY", ownerId: previous.ownerId, expiresAt: previous.expiresAt },
      });
    }
    this.ownerEpoch = (previous?.ownerEpoch || 0) + 1;
    await this.store.put("meta", `owner-history:${this.ownerEpoch}`, jsonBytes(previous || {}));
    await this.store.remove("meta", "owner");
    await this.store.put("meta", "owner", jsonBytes({ ownerId: this.ownerId, ownerEpoch: this.ownerEpoch,
      expiresAt: currentTime + this.leaseMs }));
  }

  async _assertOwner() {
    const bytes = await this.store.get("meta", "owner");
    const owner = bytes ? parseJson(bytes, "owner") : null;
    if (!owner || owner.ownerId !== this.ownerId || owner.ownerEpoch !== this.ownerEpoch || owner.expiresAt <= this.now()) {
      throw vfsError("KERNEL_VFS_OWNER_STALE", "KernelVfs owner lease is stale");
    }
  }

  async renew() {
    await this._assertOwner();
    await this.store.remove("meta", "owner");
    await this.store.put("meta", "owner", jsonBytes({ ownerId: this.ownerId, ownerEpoch: this.ownerEpoch,
      expiresAt: this.now() + this.leaseMs }));
  }

  async _validateRoot(rootDigest) {
    const rootBytes = await this.store.get("roots", rootDigest);
    if (!rootBytes || await sha256Address(rootBytes) !== rootDigest) return null;
    const root = parseJson(rootBytes, "root");
    if (root.protocol !== KERNEL_VFS_ROOT_PROTOCOL || root.version !== KERNEL_VFS_ROOT_VERSION || !Array.isArray(root.entries)) return null;
    const entries = new Map();
    let previousPath = null;
    for (const entry of root.entries) {
      if (!entry || entry.type !== "file" || normalizePath(entry.path) !== entry.path || !entry.path.startsWith("/home/")
        || typeof entry.objectSha256 !== "string" || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0
        || previousPath !== null && previousPath >= entry.path) return null;
      const object = await this.store.get("objects", entry.objectSha256);
      if (!object || object.byteLength !== entry.byteLength || await sha256Address(object) !== entry.objectSha256) return null;
      entries.set(entry.path, entry);
      previousPath = entry.path;
    }
    return { root, entries };
  }

  async recover() {
    const discardedCandidates = [];
    const head = await this.store.getHead();
    if (head?.rootDigest) {
      const markerBytes = head.sequence === 0 ? new Uint8Array()
        : await this.store.get("markers", head.transactionId);
      const marker = markerBytes?.byteLength ? parseJson(markerBytes, "marker") : null;
      const markerMatches = head.sequence === 0 || marker?.rootDigest === head.rootDigest
        && marker?.sequence === head.sequence && marker?.ownerEpoch === head.ownerEpoch;
      const valid = markerMatches ? await this._validateRoot(head.rootDigest) : null;
      if (valid) {
        this.rootDigest = head.rootDigest;
        this.entries = valid.entries;
        this.sequence = head.sequence || 0;
        return { recovered: "head", discardedCandidates };
      }
      discardedCandidates.push(head.rootDigest);
    }
    const adopted = [];
    for (const key of await this.store.list("adoptions")) {
      const bytes = await this.store.get("adoptions", key);
      const record = bytes ? parseJson(bytes, "adoption") : null;
      if (record?.rootDigest) adopted.push(record);
    }
    adopted.sort((left, right) => right.sequence - left.sequence);
    for (const record of adopted) {
      const markerBytes = record.sequence === 0 ? new Uint8Array()
        : await this.store.get("markers", record.transactionId);
      const marker = markerBytes?.byteLength ? parseJson(markerBytes, "marker") : null;
      const markerMatches = record.sequence === 0 || marker?.rootDigest === record.rootDigest
        && marker?.sequence === record.sequence && marker?.ownerEpoch === record.ownerEpoch;
      const valid = markerMatches ? await this._validateRoot(record.rootDigest) : null;
      if (!valid) { discardedCandidates.push(record.rootDigest); continue; }
      this.rootDigest = record.rootDigest;
      this.entries = valid.entries;
      this.sequence = record.sequence;
      await this.store.replaceHead(record);
      return { recovered: "adoption", discardedCandidates };
    }
    this.rootDigest = null;
    this.entries = new Map();
    this.sequence = 0;
    if (discardedCandidates.length) {
      throw vfsError("KERNEL_VFS_CORRUPT", "KernelVfs has no valid committed root", { discardedCandidates });
    }
    return { recovered: "empty", discardedCandidates };
  }

  async _createGenesis() {
    const root = await rootRecord(new Map());
    const transactionId = "transaction:genesis";
    await this.store.put("roots", root.rootDigest, root.bytes);
    const head = { protocol: "pyproc.kernel-vfs-head", version: 1, rootDigest: root.rootDigest,
      sequence: 0, transactionId, ownerEpoch: this.ownerEpoch };
    if (!await this.store.compareAndSwapHead(null, head)) {
      await this.recover();
      return;
    }
    await this.store.put("adoptions", transactionId, jsonBytes(head));
    this.rootDigest = root.rootDigest;
    this.entries = new Map();
  }

  beginTransaction() {
    if (!this.rootDigest) throw vfsError("KERNEL_VFS_INPUT_INVALID", "KernelVfs is not open");
    const transactionId = `transaction:${this.ownerEpoch}:${++this.transactionCounter}`;
    this.activeTransactions.add(transactionId);
    return new KernelVfsTransaction(this, transactionId, this.rootDigest, [...this.entries.values()]);
  }

  _transactionFinished(transactionId) { this.activeTransactions.delete(transactionId); }

  async _commit(transaction, { faultInjector = null } = {}) {
    await this._assertOwner();
    const fault = async (step, context = {}) => {
      if (typeof faultInjector === "function") await faultInjector(step, { transactionId: transaction.transactionId, ...context });
    };
    try {
      for (const [digest, bytes] of transaction.objects) await this.store.put("objects", digest, bytes);
      await fault("afterObjects");
      const root = await rootRecord(transaction.entries);
      await this.store.put("roots", root.rootDigest, root.bytes);
      await fault("afterRoot", { rootDigest: root.rootDigest });
      const intent = { protocol: "pyproc.kernel-vfs-intent", version: 1,
        transactionId: transaction.transactionId, baseRootDigest: transaction.baseRootDigest,
        rootDigest: root.rootDigest, ownerEpoch: this.ownerEpoch, sequence: this.sequence + 1,
        objectDigests: [...transaction.objects.keys()].sort() };
      await this.store.put("intents", transaction.transactionId, jsonBytes(intent));
      await fault("afterIntent", { rootDigest: root.rootDigest });
      const marker = { ...intent, protocol: "pyproc.kernel-vfs-marker" };
      await this.store.put("markers", transaction.transactionId, jsonBytes(marker));
      await fault("afterMarker", { rootDigest: root.rootDigest });
      const head = { protocol: "pyproc.kernel-vfs-head", version: 1, rootDigest: root.rootDigest,
        sequence: intent.sequence, transactionId: transaction.transactionId, ownerEpoch: this.ownerEpoch };
      const adopted = await this.store.compareAndSwapHead(transaction.baseRootDigest, head);
      if (!adopted) throw vfsError("KERNEL_VFS_HEAD_CONFLICT", "KernelVfs HEAD changed before commit", {
        expectedRootDigest: transaction.baseRootDigest,
        actualRootDigest: (await this.store.getHead())?.rootDigest || null,
      });
      await fault("afterHead", { rootDigest: root.rootDigest });
      await this.store.put("adoptions", transaction.transactionId, jsonBytes(head));
      await fault("afterAdoption", { rootDigest: root.rootDigest });
      this.rootDigest = root.rootDigest;
      this.entries = transaction.entries;
      this.sequence = intent.sequence;
      return Object.freeze({ protocol: "pyproc.kernel-vfs-commit", version: 1,
        transactionId: transaction.transactionId, baseRootDigest: transaction.baseRootDigest,
        rootDigest: root.rootDigest, sequence: this.sequence, objectCount: transaction.objects.size });
    } finally {
      this._transactionFinished(transaction.transactionId);
    }
  }

  async read(path) {
    const normalized = normalizePath(path);
    if (normalized.startsWith("/tmp/")) {
      const bytes = this.tmp.get(normalized);
      if (!bytes) throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs temporary file does not exist");
      return bytes.slice();
    }
    const entry = this.entries.get(normalized);
    if (!entry) throw vfsError("KERNEL_VFS_PATH_INVALID", "KernelVfs file does not exist", { path: normalized });
    const bytes = await this.store.get("objects", entry.objectSha256);
    if (!bytes || await sha256Address(bytes) !== entry.objectSha256) {
      throw vfsError("KERNEL_VFS_CORRUPT", "KernelVfs file object failed verify-on-read", { path: normalized });
    }
    return bytes;
  }

  writeTmp(path, value) {
    const normalized = normalizePath(path);
    if (!normalized.startsWith("/tmp/")) throw vfsError("KERNEL_VFS_PATH_INVALID", "Temporary writes require /tmp");
    this.tmp.set(normalized, bytesOf(value).slice());
  }

  list(prefix = "/home") {
    const normalized = normalizePath(prefix);
    return Object.freeze([...this.entries.keys()].filter((path) => path === normalized || path.startsWith(`${normalized}/`)).sort());
  }

  mounts() {
    return Object.freeze([
      Object.freeze({ path: "/", provider: "immutable-kernel-root", durability: "engine-bound" }),
      Object.freeze({ path: "/site", provider: "environment-layer", durability: "content-addressed" }),
      Object.freeze({ path: "/home", provider: "persistent-volume", durability: "journaled" }),
      Object.freeze({ path: "/tmp", provider: "ephemeral-memory", durability: "generation" }),
      Object.freeze({ path: "/dev", provider: "typed-device", durability: "live" }),
    ]);
  }

  async inspectCheckpointBoundary() {
    return Object.freeze({ acceptedHostcalls: 0, activeTransactions: this.activeTransactions.size,
      outputDrained: true, openResources: this.devices.checkpointResources(), vfsRootDigest: this.rootDigest });
  }
}
