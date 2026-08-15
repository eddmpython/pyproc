// indexedDbMachineStore.js - Layer 5/platform: owner, blob, generation, HEAD를 한 IndexedDB transaction으로 fence한다.
import { operationAbortError, throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { isBrowserStorageQuotaError } from "../../runtime/browserStorageDurability.js";
import { copyGenerationBytes } from "./generationIntegrity.js";
import { generationStorageKey, planGenerationRetention } from "./generationRetention.js";

// v3: blob 크기 색인(blobSizes)을 들인다. 이전에는 크기를 알려면 blob 값을 통째로 역직렬화해야
// 했다(cursor로 하나씩 지나가도 바이트는 디스크에서 읽힌다). 회수 계획과 저장소 조회가 그 경로를
// 타므로, 몇 GB짜리 저장소에서 "얼마나 쓰고 있나"를 묻는 것이 저장소 전체를 읽는 일이었다.
// 크기는 작은 레코드로 따로 산다. 마이그레이션은 v3 미만에서 열릴 때 blob을 한 번 훑어 채운다.
const DATABASE_VERSION = 3;
const BLOBS = "blobs";
const BLOB_SIZES = "blobSizes";
const GENERATIONS = "generations";
const HEADS = "heads";
const OWNERS = "owners";
const ALL_STORES = Object.freeze([BLOBS, BLOB_SIZES, GENERATIONS, HEADS, OWNERS]);

import { cloneRecord, copyToken, requestValue, transactionDone, validateIdentity } from "./indexedDbPrimitives.js";

// blob 크기 표. 값 레코드가 숫자 하나라 키와 함께 통째로 읽어도 바이트를 붙잡지 않는다.
// 색인에 없는 digest는 0으로 친다: 마이그레이션 도중에도 계획이 서야 하고, 크기를 모르는 것이
// 회수 대상 판정을 바꾸지는 않는다(무엇을 지울지는 세대 참조가 정한다).
async function readBlobSizes(transaction) {
  const store = transaction.objectStore(BLOB_SIZES);
  const [keys, values] = await Promise.all([requestValue(store.getAllKeys()), requestValue(store.getAll())]);
  return new Map(keys.map((key, index) => [String(key), Number.isFinite(values[index]) ? values[index] : 0]));
}

async function abortAndReject(transaction, done, error) {
  try { transaction.abort(); } catch (abortError) {}
  await done.catch(() => undefined);
  throw error;
}

export class IndexedDbMachineStore {
  constructor({ indexedDb, databaseName, legacyOwnerDatabaseName = null }) {
    if (!indexedDb || typeof indexedDb.open !== "function") throw new TypeError("an indexedDb is required");
    if (!databaseName) throw new TypeError("a databaseName is required");
    this._indexedDb = indexedDb;
    this._databaseName = String(databaseName);
    this._legacyOwnerDatabaseName = legacyOwnerDatabaseName ? String(legacyOwnerDatabaseName) : null;
    this._databasePromise = null;
    this._legacyEpochs = new Map();
  }

  async claimOwner({ groupId, ownerId, minimumEpoch = 1 }) {
    const identity = validateIdentity(groupId, ownerId);
    if (!Number.isSafeInteger(minimumEpoch) || minimumEpoch < 1) throw new TypeError("minimumEpoch must be an integer >= 1");
    const legacyEpoch = await this._readLegacyEpoch(identity.groupId);
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readwrite");
    const done = transactionDone(transaction);
    const owners = transaction.objectStore(OWNERS);
    const current = await requestValue(owners.get(identity.groupId));
    const currentEpoch = current?.epoch || 0;
    if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0) {
      return abortAndReject(transaction, done, new WebMachineError("WEB_MACHINE_OWNER_EPOCH_CORRUPT", `${identity.groupId}: the owner epoch is corrupt`));
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
    if (!group) throw new TypeError("a groupId is required");
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
    if (!value) throw new WebMachineError("WEB_MACHINE_BLOB_MISSING", `no such blob: ${digest}`);
    return copyGenerationBytes(value);
  }

  async commitGeneration({ groupId, generationId, expectedHead, ownerToken, blobs = [], record, control }) {
    const group = String(groupId || "");
    const generation = String(generationId || "");
    if (!group) throw new TypeError("a groupId is required");
    if (!generation) throw new TypeError("a generationId is required");
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
      if (existingGeneration) throw new WebMachineError("WEB_MACHINE_GENERATION_EXISTS", `${group}: generation already exists: ${generation}`);
      const blobStore = transaction.objectStore(BLOBS);
      const blobSizeStore = transaction.objectStore(BLOB_SIZES);
      for (const payload of payloads) {
        if (!payload.digest) throw new TypeError("a blob digest is required");
        const existing = await requestValue(blobStore.get(payload.digest));
        if (!existing) blobStore.add(payload.bytes.buffer, payload.digest);
        // 크기는 blob과 같은 transaction에서 쓴다. 따로 쓰면 abort된 커밋이 크기만 남긴다.
        blobSizeStore.put(payload.bytes.byteLength, payload.digest);
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
      if (isBrowserStorageQuotaError(error)) {
        throw new WebMachineError("WEB_MACHINE_STORAGE_QUOTA_EXCEEDED",
          `${group}: browser storage quota rejected the generation before HEAD publication`, {
            expectedHead, generationId:generation, browserErrorName:error?.name || null,
          });
      }
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
    if (!value) throw new WebMachineError("WEB_MACHINE_GENERATION_MISSING", `${groupId}: no such generation: ${generationId}`);
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
    const transaction = database.transaction([BLOBS, BLOB_SIZES, GENERATIONS, HEADS], "readonly");
    const done = transactionDone(transaction);
    // 값을 하나도 읽지 않는다. blob은 키만, 크기는 크기 색인에서. 예전에는 blob 값을 전부
    // 역직렬화해 byteLength만 읽고 버렸고, 그 전에는 getAll로 저장소 크기의 2배를 상주시켰다.
    const [blobKeys, blobSizes, generationKeys, headKeys] = await Promise.all([
      requestValue(transaction.objectStore(BLOBS).getAllKeys()),
      readBlobSizes(transaction),
      requestValue(transaction.objectStore(GENERATIONS).getAllKeys()),
      requestValue(transaction.objectStore(HEADS).getAllKeys()),
    ]);
    await done;
    let totalBlobBytes = 0;
    for (const size of blobSizes.values()) totalBlobBytes += size;
    return Object.freeze({
      blobs: blobKeys.length,
      blobBytes: totalBlobBytes,
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
    if (!group) throw new TypeError("a groupId is required");
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
      const [headKeys, headValues, generationKeys, generationValues, blobKeyList, blobSizes] = await Promise.all([
        requestValue(transaction.objectStore(HEADS).getAllKeys()),
        requestValue(transaction.objectStore(HEADS).getAll()),
        requestValue(transaction.objectStore(GENERATIONS).getAllKeys()),
        requestValue(transaction.objectStore(GENERATIONS).getAll()),
        // blob은 키만 읽는다. 값을 끌어오면 회수 계획 한 번이 저장소 전체를 읽는 일이 된다.
        requestValue(transaction.objectStore(BLOBS).getAllKeys()),
        readBlobSizes(transaction),
      ]);
      const blobKeys = blobKeyList.map(String);
      const heads = new Map(headKeys.map((key, index) => [String(key), headValues[index]]));
      const generations = new Map(generationKeys.map((key, index) => [String(key), generationValues[index]]));
      const plan = planGenerationRetention({ targetGroupId: group, heads, generations, blobDigests: blobKeys.map(String) });
      const report = Object.freeze({
        ...plan,
        deletedGenerations: plan.deletedGenerationKeys.length,
        deletedBlobs: plan.deletedBlobDigests.length,
        reclaimedBytes: plan.deletedBlobDigests.reduce((sum, digest) => sum + (blobSizes.get(digest) || 0), 0),
        retainedGenerations: plan.retainedGenerationKeys.length,
        retainedBlobs: plan.retainedBlobDigests.length,
      });
      if (mutate) {
        const generationsStore = transaction.objectStore(GENERATIONS);
        const blobsStore = transaction.objectStore(BLOBS);
        const blobSizeStore = transaction.objectStore(BLOB_SIZES);
        for (const key of plan.deletedGenerationKeys) generationsStore.delete(key);
        for (const digest of plan.deletedBlobDigests) { blobsStore.delete(digest); blobSizeStore.delete(digest); }
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
      request.onupgradeneeded = (event) => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BLOBS)) database.createObjectStore(BLOBS);
        if (!database.objectStoreNames.contains(BLOB_SIZES)) database.createObjectStore(BLOB_SIZES);
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
        // v3 미만에서 올라오면 크기 색인이 비어 있다. 이 versionchange transaction 안에서 blob을
        // 한 번 훑어 채운다(그 한 번이 크기를 묻는 모든 이후 호출의 전량 읽기를 대신한다).
        if (event.oldVersion < 3 && request.transaction) {
          const blobs = request.transaction.objectStore(BLOBS);
          const sizes = request.transaction.objectStore(BLOB_SIZES);
          const cursorRequest = blobs.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const value = cursor.value;
            sizes.put(value && Number.isFinite(value.byteLength) ? value.byteLength : 0, cursor.key);
            cursor.continue();
          };
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
        reject(request.error || new WebMachineError("WEB_MACHINE_STORE_FAILURE", "opening IndexedDB failed"));
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
      request.onerror = () => reject(request.error || new WebMachineError("WEB_MACHINE_STORE_FAILURE", "opening the legacy owner database failed"));
    });
    this._legacyEpochs.set(groupId, pending);
    return pending;
  }
}
