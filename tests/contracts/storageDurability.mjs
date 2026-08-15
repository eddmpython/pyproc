import { BrowserStorageDurability, OpfsStateStore,
  STORAGE_DURABILITY_PROTOCOL } from "../../src/state/index.js";
import { OpfsKernelVfsStore } from "../../src/runtime/kernel/index.js";

function assert(condition,message) { if (!condition) throw new Error(message); }

function namedError(name,message = name) { const error = new Error(message); error.name = name; return error; }

class MemoryDirectory {
  constructor() { this.files = new Map(); }

  async getFileHandle(name,{create = false} = {}) {
    if (!this.files.has(name) && !create) throw namedError("NotFoundError");
    if (!this.files.has(name)) this.files.set(name,new Uint8Array());
    return {
      getFile:async () => ({ arrayBuffer:async () => this.files.get(name).slice().buffer }),
      createWritable:async () => {
        let staged = this.files.get(name).slice();
        return {
          write:async (value) => { staged = typeof value === "string"
            ? new TextEncoder().encode(value) : new Uint8Array(value).slice(); },
          close:async () => { this.files.set(name,staged); },
          abort:async () => {},
        };
      },
    };
  }

  async removeEntry(name) {
    if (!this.files.delete(name)) throw namedError("NotFoundError");
  }
}

async function errorOf(operation) { try { await operation(); return null; } catch (error) { return error; } }

export async function assertStorageDurability() {
  const directory = new MemoryDirectory();
  let persisted = false;
  const storageManager = {
    persisted:async () => persisted,
    persist:async () => { persisted = true; return true; },
    estimate:async () => ({usage:32,quota:100}),
    getDirectory:async () => directory,
  };
  const durability = await BrowserStorageDurability.open({storageManager,namespace:"contract"});
  const initial = await durability.inspect();
  assert(initial.protocol === STORAGE_DURABILITY_PROTOCOL && initial.version === 1
    && initial.mode === "best-effort" && !initial.persisted
    && initial.estimate.usage === 32 && initial.estimate.quota === 100
    && initial.estimate.remaining === 68 && initial.estimate.exact === false
    && initial.eviction.protection === "browser-heuristic"
    && initial.eviction.detection === "external-witness-required"
    && initial.eviction.recovery === "external-copy-required",
  "storage durability inspection did not preserve the browser boundary");
  const persistence = await durability.requestPersistence();
  assert(persistence.granted && persistence.durability.mode === "persistent"
    && persistence.durability.eviction.protection === "user-mediated",
  "explicit persistence request did not return a versioned receipt");

  const witness = await durability.createWitness({witnessId:"outside-copy"});
  const verified = await durability.verifyWitness(witness);
  assert(verified.state === "available" && verified.witness.digest === witness.digest,
    "storage witness did not verify after an atomic write");
  directory.files.delete(".pyproc-storage-witness-contract.json");
  const evicted = await errorOf(() => durability.verifyWitness(witness));
  assert(evicted?.code === "PYPROC_STORAGE_EVICTED" && evicted.context?.witnessId === "outside-copy",
    "missing externally witnessed storage was mistaken for first boot");
  const malformed = await errorOf(() => durability.verifyWitness({...witness,extra:true}));
  assert(malformed?.code === "PYPROC_INPUT_INVALID", "storage witness accepted an open schema");

  const quota = namedError("QuotaExceededError","quota fixture"); quota.code = 22;
  const quotaFailure = await errorOf(() => durability.runWrite(() => { throw quota; }, {
    operation:"contract.write", requiredBytes:64,
  }));
  assert(quotaFailure?.code === "PYPROC_STORAGE_QUOTA_EXCEEDED" && quotaFailure.retryable === false
    && quotaFailure.context?.operation === "contract.write"
    && quotaFailure.context?.durability?.estimate.remaining === 68,
  "quota failure was not normalized with the last conservative estimate");

  const address = `sha256:${"0".repeat(64)}`;
  for (const failurePoint of ["getFileHandle","createWritable","write"]) {
    const quotaObjects = new Set();
    const quotaObjectDirectory = {
      getFileHandle:async (name,{create = false} = {}) => {
        if (!quotaObjects.has(name) && !create) throw namedError("NotFoundError");
        if (create) {
          quotaObjects.add(name);
          if (failurePoint === "getFileHandle") throw namedError("QuotaExceededError");
        }
        return {
          getFile:async () => ({ arrayBuffer:async () => new Uint8Array().buffer }),
          createWritable:async () => {
            if (failurePoint === "createWritable") throw namedError("QuotaExceededError");
            return {
              write:async () => { throw namedError("QuotaExceededError"); },
              close:async () => {}, abort:async () => {},
            };
          },
        };
      },
      removeEntry:async (name) => { quotaObjects.delete(name); },
      keys:async function* () { yield* quotaObjects; },
      entries:async function* () {},
    };
    const quotaDirectory = {
      getFileHandle:async () => { throw namedError("NotFoundError"); },
      getDirectoryHandle:async () => quotaObjectDirectory,
    };
    const store = new OpfsStateStore(quotaDirectory);
    const storeQuota = await errorOf(() => store.writeObject(address,new Uint8Array([1])));
    assert(storeQuota?.code === "PYPROC_STORAGE_QUOTA_EXCEEDED"
      && storeQuota.context?.operation === "state.writeObject" && !await store.hasObject(address),
    `OPFS state store retained a false object after ${failurePoint} quota failure`);

    const kernelStore = new OpfsKernelVfsStore(quotaObjectDirectory,"quota-contract");
    const kernelQuota = await errorOf(() => kernelStore.put("blob","quota",new Uint8Array([1])));
    assert(kernelQuota?.code === "PYPROC_STORAGE_QUOTA_EXCEEDED"
      && kernelQuota.context?.operation === "kernelVfs.write"
      && !quotaObjects.has("blob--quota"),
    `OPFS kernel store retained a false object after ${failurePoint} quota failure`);
  }
}
