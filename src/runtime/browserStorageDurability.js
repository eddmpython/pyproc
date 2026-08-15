// browserStorageDurability.js - browser bucket의 persistence, quota와 축출 증거 계약.
import { SHA256_ADDRESS_RE, sha256Address, verifySha256 } from "./contentDigest.js";
import { PyProcError } from "./errors.js";

export const STORAGE_DURABILITY_PROTOCOL = "pyproc.storage-durability";
export const STORAGE_DURABILITY_VERSION = 1;
export const STORAGE_EVICTION_WITNESS_PROTOCOL = "pyproc.storage-eviction-witness";
export const STORAGE_EVICTION_WITNESS_VERSION = 1;

const textEncoder = new TextEncoder();
const NAMESPACE_RE = /^[A-Za-z0-9._-]{1,80}$/u;

function inputError(message) { return new PyProcError("PYPROC_INPUT_INVALID", message); }

function requireStorageManager(value) {
  if (!value || typeof value.persisted !== "function" || typeof value.persist !== "function"
    || typeof value.estimate !== "function" || typeof value.getDirectory !== "function") {
    throw new PyProcError("PYPROC_ENV_UNSUPPORTED",
      "Browser storage durability requires persisted, persist, estimate, and getDirectory");
  }
  return value;
}

function namespace(value) {
  if (typeof value !== "string" || !NAMESPACE_RE.test(value)) {
    throw inputError("Storage durability namespace must contain 1 to 80 safe characters");
  }
  return value;
}

function witnessId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || /[\u0000-\u001f]/u.test(value)) {
    throw inputError("Storage eviction witnessId must be a bounded non-control string");
  }
  return value;
}

function witnessCore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.protocol !== STORAGE_EVICTION_WITNESS_PROTOCOL || value.version !== STORAGE_EVICTION_WITNESS_VERSION
    || typeof value.namespace !== "string" || typeof value.witnessId !== "string"
    || typeof value.digest !== "string" || !SHA256_ADDRESS_RE.test(value.digest)
    || Object.keys(value).some((key) => !["protocol","version","namespace","witnessId","digest"].includes(key))) {
    throw inputError("Storage eviction witness is invalid");
  }
  const record = { protocol:STORAGE_EVICTION_WITNESS_PROTOCOL, version:STORAGE_EVICTION_WITNESS_VERSION,
    namespace:namespace(value.namespace), witnessId:witnessId(value.witnessId) };
  return { record, digest:value.digest };
}

function witnessBytes(record) { return textEncoder.encode(JSON.stringify(record)); }

function finiteEstimate(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function isBrowserStorageQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22;
}

export function normalizeBrowserStorageWriteError(error, context = {}) {
  if (!isBrowserStorageQuotaError(error)) return error;
  return new PyProcError("PYPROC_STORAGE_QUOTA_EXCEEDED",
    "Browser storage quota rejected the write and no automatic retry was attempted", {
      cause:error, retryable:false, context:{ ...context, browserErrorName:error?.name || null },
    });
}

async function readFile(directory, name) {
  try {
    const handle = await directory.getFileHandle(name);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

async function writeFile(directory, name, bytes) {
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
    throw error;
  }
}

export class BrowserStorageDurability {
  constructor({ storageManager, directory, namespace:scope = "default" } = {}) {
    this.storageManager = requireStorageManager(storageManager);
    if (!directory || typeof directory.getFileHandle !== "function" || typeof directory.removeEntry !== "function") {
      throw inputError("Browser storage durability requires a FileSystemDirectoryHandle");
    }
    this.directory = directory;
    this.namespace = namespace(scope);
    this.fileName = `.pyproc-storage-witness-${this.namespace}.json`;
  }

  static async open({ storageManager = globalThis.navigator?.storage, directory = null,
    namespace:scope = "default" } = {}) {
    const accepted = requireStorageManager(storageManager);
    return new BrowserStorageDurability({ storageManager:accepted,
      directory:directory || await accepted.getDirectory(), namespace:scope });
  }

  async inspect() {
    const [persisted, estimate] = await Promise.all([
      this.storageManager.persisted(), this.storageManager.estimate(),
    ]);
    const usage = finiteEstimate(estimate?.usage);
    const quota = finiteEstimate(estimate?.quota);
    const remaining = usage === null || quota === null ? null : Math.max(0,quota - usage);
    return Object.freeze({ protocol:STORAGE_DURABILITY_PROTOCOL, version:STORAGE_DURABILITY_VERSION,
      mode:persisted ? "persistent" : "best-effort", persisted:Boolean(persisted),
      estimate:Object.freeze({ usage, quota, remaining, exact:false }),
      eviction:Object.freeze({ protection:persisted ? "user-mediated" : "browser-heuristic",
        detection:"external-witness-required", recovery:"external-copy-required" }),
      quotaFailureCode:"PYPROC_STORAGE_QUOTA_EXCEEDED",
      evictionFailureCode:"PYPROC_STORAGE_EVICTED" });
  }

  async requestPersistence() {
    const granted = Boolean(await this.storageManager.persist());
    return Object.freeze({ protocol:"pyproc.storage-persistence-receipt", version:1,
      granted, durability:await this.inspect() });
  }

  async createWitness({ witnessId:identifier } = {}) {
    const record = { protocol:STORAGE_EVICTION_WITNESS_PROTOCOL, version:STORAGE_EVICTION_WITNESS_VERSION,
      namespace:this.namespace, witnessId:witnessId(identifier) };
    const bytes = witnessBytes(record);
    const digest = await sha256Address(bytes);
    await this.runWrite(() => writeFile(this.directory,this.fileName,bytes), {
      operation:"storage.witness.create", requiredBytes:bytes.byteLength,
    });
    return Object.freeze({ ...record, digest });
  }

  async verifyWitness(value) {
    const { record, digest } = witnessCore(value);
    if (record.namespace !== this.namespace) throw inputError("Storage eviction witness namespace differs");
    let bytes;
    try { bytes = await readFile(this.directory,this.fileName); }
    catch (error) {
      if (error?.name !== "NotFoundError") throw error;
      bytes = null;
    }
    if (!bytes) {
      throw new PyProcError("PYPROC_STORAGE_EVICTED",
        "Browser storage no longer contains the externally witnessed durable bucket", {
          context:{ namespace:this.namespace, witnessId:record.witnessId },
        });
    }
    const verified = await verifySha256(bytes,digest);
    if (!verified.ok || new TextDecoder().decode(bytes) !== JSON.stringify(record)) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "Storage eviction witness is corrupt", {
        context:{ namespace:this.namespace, expected:digest, actual:`sha256:${verified.actual}` },
      });
    }
    return Object.freeze({ protocol:"pyproc.storage-witness-verification", version:1,
      state:"available", witness:Object.freeze({ ...record, digest }) });
  }

  async runWrite(operation, { operation:operationName = "storage.write", requiredBytes = null } = {}) {
    if (typeof operation !== "function") throw inputError("Storage write operation must be a function");
    if (requiredBytes !== null && (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0)) {
      throw inputError("Storage write requiredBytes must be a non-negative safe integer or null");
    }
    try { return await operation(); }
    catch (error) {
      const normalized = normalizeBrowserStorageWriteError(error, {
        operation:operationName, requiredBytes,
        durability:await this.inspect().catch(() => null),
      });
      throw normalized;
    }
  }
}
