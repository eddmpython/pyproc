// indexedDbMachineStore.js - owner, blob, generation, HEAD를 한 IndexedDB transaction으로 fence한다.
import { operationAbortError, throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { copyGenerationBytes } from "./generationIntegrity.js";
import { generationStorageKey, planGenerationRetention } from "./generationRetention.js";

const DATABASE_VERSION = 2;
const BLOBS = "blobs";
const GENERATIONS = "generations";
const HEADS = "heads";
const OWNERS = "owners";
const ALL_STORES = Object.freeze([BLOBS, GENERATIONS, HEADS, OWNERS]);

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request 실패"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction abort"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction 실패"));
  });
}

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyToken(value) {
  return Object.freeze({ groupId: value.groupId, ownerId: value.ownerId, epoch: value.epoch });
}

function validateIdentity(groupId, ownerId) {
  const group = String(groupId || "");
  const owner = String(ownerId || "");
  if (!group) throw new TypeError("groupId가 필요하다");
  if (!owner) throw new TypeError("ownerId가 필요하다");
  return { groupId: group, ownerId: owner };
}

async function abortAndReject(transaction, done, error) {
  try { transaction.abort(); } catch (abortError) {}
  await done.catch(() => undefined);
  throw error;
}

export class IndexedDbMachineStore {
  constructor({ indexedDb, databaseName, legacyOwnerDatabaseName = null }) {
    if (!indexedDb || typeof indexedDb.open !== "function") throw new TypeError("indexedDb가 필요하다");
    if (!databaseName) throw new TypeError("databaseName이 필요하다");
    this._indexedDb = indexedDb;
    this._databaseName = String(databaseName);
    this._legacyOwnerDatabaseName = legacyOwnerDatabaseName ? String(legacyOwnerDatabaseName) : null;
    this._databasePromise = null;
    this._legacyEpochs = new Map();
  }

  async claimOwner({ groupId, ownerId, minimumEpoch = 1 }) {
    const identity = validateIdentity(groupId, ownerId);
    if (!Number.isSafeInteger(minimumEpoch) || minimumEpoch < 1) throw new TypeError("minimumEpoch는 1 이상 정수여야 한다");
    const legacyEpoch = await this._readLegacyEpoch(identity.groupId);
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readwrite");
    const done = transactionDone(transaction);
    const owners = transaction.objectStore(OWNERS);
    const current = await requestValue(owners.get(identity.groupId));
    const currentEpoch = current?.epoch || 0;
    if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0) {
      return abortAndReject(transaction, done, new WebMachineError("WEB_MACHINE_OWNER_EPOCH_CORRUPT", `${identity.groupId}: owner epoch 파손`));
    }
    const record = {
      ...identity,
      epoch: Math.max(currentEpoch + 1, minimumEpoch, legacyEpoch + 1),
      active: true,
    };
    owners.put(record, identity.groupId);
    await done;
    return copyToken(record);
  }

  async releaseOwner(token) {
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readwrite");
    const done = transactionDone(transaction);
    try {
      const owners = transaction.objectStore(OWNERS);
      const current = await requestValue(owners.get(token?.groupId));
      this._requireOwner(current, token, token?.groupId);
      owners.put({ ...current, active: false }, token.groupId);
      await done;
      return true;
    } catch (error) {
      return abortAndReject(transaction, done, error);
    }
  }

  async assertOwner(token) {
    const current = await this.readOwner(token?.groupId);
    this._requireOwner(current, token, token?.groupId);
    return copyToken(current);
  }

  async readOwner(groupId) {
    const group = String(groupId || "");
    if (!group) throw new TypeError("groupId가 필요하다");
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(OWNERS).get(group));
    await done;
    return value ? Object.freeze({ ...value }) : null;
  }

  async getBlob(digest) {
    const database = await this._open();
    const transaction = database.transaction(BLOBS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(BLOBS).get(digest));
    await done;
    if (!value) throw new WebMachineError("WEB_MACHINE_BLOB_MISSING", `blob 없음: ${digest}`);
    return copyGenerationBytes(value);
  }

  async commitGeneration({ groupId, generationId, expectedHead, ownerToken, blobs = [], record, control }) {
    const group = String(groupId || "");
    const generation = String(generationId || "");
    if (!group) throw new TypeError("groupId가 필요하다");
    if (!generation) throw new TypeError("generationId가 필요하다");
    throwIfOperationAborted(control, `${group}: generation commit`);
    const payloads = blobs.map(({ digest, bytes }) => ({ digest: String(digest || ""), bytes: copyGenerationBytes(bytes) }));
    const storedRecord = cloneRecord(record);
    const database = await this._open();
    const transaction = database.transaction(ALL_STORES, "readwrite");
    const done = transactionDone(transaction);
    const onAbort = () => { try { transaction.abort(); } catch (error) {} };
    control?.signal?.addEventListener("abort", onAbort, { once: true });
    if (control?.signal?.aborted) onAbort();
    try {
      const owner = await requestValue(transaction.objectStore(OWNERS).get(group));
      this._requireOwner(owner, ownerToken, group);
      const heads = transaction.objectStore(HEADS);
      const currentRecord = await requestValue(heads.get(group));
      const current = currentRecord?.head || null;
      if (current !== expectedHead) {
        throw new WebMachineError("WEB_MACHINE_HEAD_CONFLICT", `${group}: HEAD ${current} != ${expectedHead}`, {
          expectedHead,
          actualHead: current,
        });
      }
      const generationKey = generationStorageKey(group, generation);
      const existingGeneration = await requestValue(transaction.objectStore(GENERATIONS).get(generationKey));
      if (existingGeneration) throw new WebMachineError("WEB_MACHINE_GENERATION_EXISTS", `${group}: generation 이미 존재 ${generation}`);
      const blobStore = transaction.objectStore(BLOBS);
      for (const payload of payloads) {
        if (!payload.digest) throw new TypeError("blob digest가 필요하다");
        const existing = await requestValue(blobStore.get(payload.digest));
        if (!existing) blobStore.add(payload.bytes.buffer, payload.digest);
      }
      transaction.objectStore(GENERATIONS).add(storedRecord, generationKey);
      const head = { head: generation, prev: current, ownerEpoch: owner.epoch };
      heads.put(head, group);
      await done;
      return head;
    } catch (error) {
      try { transaction.abort(); } catch (abortError) {}
      await done.catch(() => undefined);
      if (control?.signal?.aborted) throw operationAbortError(control, `${group}: generation commit`);
      throw error;
    } finally {
      control?.signal?.removeEventListener("abort", onAbort);
    }
  }

  async readHead(groupId) {
    const database = await this._open();
    const transaction = database.transaction(HEADS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(HEADS).get(groupId));
    await done;
    return value ? { head: value.head, prev: value.prev || null, ownerEpoch: value.ownerEpoch || 0 } : null;
  }

  async readGeneration(groupId, generationId) {
    const database = await this._open();
    const transaction = database.transaction(GENERATIONS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(GENERATIONS).get(generationStorageKey(groupId, generationId)));
    await done;
    if (!value) throw new WebMachineError("WEB_MACHINE_GENERATION_MISSING", `${groupId}: generation 없음 ${generationId}`);
    return cloneRecord(value);
  }

  dryRunRecoveryWindow({ groupId, ownerToken }) {
    return this._planRecoveryWindow({ groupId, ownerToken, mutate: false });
  }

  pruneRecoveryWindow({ groupId, ownerToken, control }) {
    return this._planRecoveryWindow({ groupId, ownerToken, mutate: true, control });
  }

  async inspectStorage() {
    const database = await this._open();
    const transaction = database.transaction([BLOBS, GENERATIONS, HEADS], "readonly");
    const done = transactionDone(transaction);
    const [blobValues, generationKeys, headKeys] = await Promise.all([
      requestValue(transaction.objectStore(BLOBS).getAll()),
      requestValue(transaction.objectStore(GENERATIONS).getAllKeys()),
      requestValue(transaction.objectStore(HEADS).getAllKeys()),
    ]);
    await done;
    return Object.freeze({
      blobs: blobValues.length,
      blobBytes: blobValues.reduce((sum, value) => sum + copyGenerationBytes(value).byteLength, 0),
      generations: generationKeys.length,
      groups: headKeys.length,
    });
  }

  close() {
    if (!this._databasePromise) return;
    this._databasePromise.then((database) => database.close()).catch(() => undefined);
    this._databasePromise = null;
  }

  async _planRecoveryWindow({ groupId, ownerToken, mutate, control }) {
    const group = String(groupId || "");
    if (!group) throw new TypeError("groupId가 필요하다");
    throwIfOperationAborted(control, `${group}: generation prune`);
    const database = await this._open();
    const transaction = database.transaction(ALL_STORES, mutate ? "readwrite" : "readonly");
    const done = transactionDone(transaction);
    const onAbort = () => { try { transaction.abort(); } catch (error) {} };
    control?.signal?.addEventListener("abort", onAbort, { once: true });
    if (control?.signal?.aborted) onAbort();
    try {
      const owner = await requestValue(transaction.objectStore(OWNERS).get(group));
      this._requireOwner(owner, ownerToken, group);
      const [headKeys, headValues, generationKeys, generationValues, blobKeys, blobValues] = await Promise.all([
        requestValue(transaction.objectStore(HEADS).getAllKeys()),
        requestValue(transaction.objectStore(HEADS).getAll()),
        requestValue(transaction.objectStore(GENERATIONS).getAllKeys()),
        requestValue(transaction.objectStore(GENERATIONS).getAll()),
        requestValue(transaction.objectStore(BLOBS).getAllKeys()),
        requestValue(transaction.objectStore(BLOBS).getAll()),
      ]);
      const heads = new Map(headKeys.map((key, index) => [String(key), headValues[index]]));
      const generations = new Map(generationKeys.map((key, index) => [String(key), generationValues[index]]));
      const plan = planGenerationRetention({ targetGroupId: group, heads, generations, blobDigests: blobKeys.map(String) });
      const blobBytes = new Map(blobKeys.map((key, index) => [String(key), copyGenerationBytes(blobValues[index]).byteLength]));
      const report = Object.freeze({
        ...plan,
        deletedGenerations: plan.deletedGenerationKeys.length,
        deletedBlobs: plan.deletedBlobDigests.length,
        reclaimedBytes: plan.deletedBlobDigests.reduce((sum, digest) => sum + (blobBytes.get(digest) || 0), 0),
        retainedGenerations: plan.retainedGenerationKeys.length,
        retainedBlobs: plan.retainedBlobDigests.length,
      });
      if (mutate) {
        const generationsStore = transaction.objectStore(GENERATIONS);
        const blobsStore = transaction.objectStore(BLOBS);
        for (const key of plan.deletedGenerationKeys) generationsStore.delete(key);
        for (const digest of plan.deletedBlobDigests) blobsStore.delete(digest);
      }
      await done;
      return report;
    } catch (error) {
      try { transaction.abort(); } catch (abortError) {}
      await done.catch(() => undefined);
      if (control?.signal?.aborted) throw operationAbortError(control, `${group}: generation prune`);
      throw error;
    } finally {
      control?.signal?.removeEventListener("abort", onAbort);
    }
  }

  _requireOwner(current, token, groupId) {
    if (!current || !current.active || current.groupId !== groupId || current.ownerId !== token?.ownerId
      || current.epoch !== token?.epoch || token?.groupId !== groupId) {
      throw new WebMachineError("WEB_MACHINE_OWNER_STALE", `${groupId}: stale owner ${token?.ownerId || "none"}/${token?.epoch || 0}`, {
        current: current ? { ...current } : null,
      });
    }
    return current;
  }

  _open() {
    if (this._databasePromise) return this._databasePromise;
    this._databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      const request = this._indexedDb.open(this._databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BLOBS)) database.createObjectStore(BLOBS);
        if (!database.objectStoreNames.contains(GENERATIONS)) database.createObjectStore(GENERATIONS);
        if (!database.objectStoreNames.contains(HEADS)) database.createObjectStore(HEADS);
        if (!database.objectStoreNames.contains(OWNERS)) database.createObjectStore(OWNERS);
        if (request.transaction && database.objectStoreNames.contains(HEADS)) {
          const heads = request.transaction.objectStore(HEADS);
          const keysRequest = heads.getAllKeys();
          const valuesRequest = heads.getAll();
          let keys = null;
          let values = null;
          const migrateHeads = () => {
            if (!keys || !values) return;
            values.forEach((value, index) => {
              if (!Number.isSafeInteger(value?.ownerEpoch)) heads.put({ ...value, ownerEpoch: 0 }, keys[index]);
            });
          };
          keysRequest.onsuccess = () => { keys = keysRequest.result; migrateHeads(); };
          valuesRequest.onsuccess = () => { values = valuesRequest.result; migrateHeads(); };
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(request.error || new Error("IndexedDB open 실패"));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new WebMachineError("WEB_MACHINE_SCHEMA_UPGRADE_BLOCKED", `${this._databaseName}: schema v2 upgrade blocked`));
      };
    });
    return this._databasePromise;
  }

  _readLegacyEpoch(groupId) {
    if (!this._legacyOwnerDatabaseName) return Promise.resolve(0);
    if (this._legacyEpochs.has(groupId)) return this._legacyEpochs.get(groupId);
    const pending = new Promise((resolve, reject) => {
      const request = this._indexedDb.open(this._legacyOwnerDatabaseName);
      request.onsuccess = async () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OWNERS)) {
          database.close();
          resolve(0);
          return;
        }
        const transaction = database.transaction(OWNERS, "readonly");
        const done = transactionDone(transaction);
        try {
          const value = await requestValue(transaction.objectStore(OWNERS).get(groupId));
          await done;
          database.close();
          resolve(Number.isSafeInteger(value?.epoch) ? value.epoch : 0);
        } catch (error) {
          database.close();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error || new Error("legacy owner database open 실패"));
    });
    this._legacyEpochs.set(groupId, pending);
    return pending;
  }
}
