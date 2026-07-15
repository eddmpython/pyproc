// indexedDbGenerationStore.js - blob과 HEAD CAS를 IndexedDB에 영속하는 browser 구현.
import { WebMachineError } from "../../host/webMachineError.js";
import { copyGenerationBytes } from "./generationIntegrity.js";

const DATABASE_VERSION = 1;
const BLOBS = "blobs";
const GENERATIONS = "generations";
const HEADS = "heads";

function generationKey(groupId, generationId) {
  return `${groupId}\n${generationId}`;
}

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

export class IndexedDbGenerationStore {
  constructor({ indexedDb, databaseName }) {
    if (!indexedDb || typeof indexedDb.open !== "function") throw new TypeError("indexedDb가 필요하다");
    if (!databaseName) throw new TypeError("databaseName이 필요하다");
    this._indexedDb = indexedDb;
    this._databaseName = String(databaseName);
    this._databasePromise = null;
  }

  async putBlob({ digest, bytes }) {
    const database = await this._open();
    const transaction = database.transaction(BLOBS, "readwrite");
    const done = transactionDone(transaction);
    const payload = copyGenerationBytes(bytes);
    const blobs = transaction.objectStore(BLOBS);
    const existing = await requestValue(blobs.get(digest));
    if (!existing) blobs.add(payload.buffer, digest);
    await done;
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

  async commitGeneration({ groupId, generationId, expectedHead, record }) {
    const database = await this._open();
    const transaction = database.transaction([GENERATIONS, HEADS], "readwrite");
    const done = transactionDone(transaction);
    const heads = transaction.objectStore(HEADS);
    const currentRecord = await requestValue(heads.get(groupId));
    const current = currentRecord?.head || null;
    if (current !== expectedHead) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new WebMachineError("WEB_MACHINE_HEAD_CONFLICT", `${groupId}: HEAD ${current} != ${expectedHead}`, {
        expectedHead,
        actualHead: current,
      });
    }
    try {
      await requestValue(transaction.objectStore(GENERATIONS).add(record, generationKey(groupId, generationId)));
      heads.put({ head: generationId, prev: current }, groupId);
      await done;
    } catch (error) {
      await done.catch(() => undefined);
      if (error?.name === "ConstraintError") {
        throw new WebMachineError("WEB_MACHINE_GENERATION_EXISTS", `${groupId}: generation 이미 존재 ${generationId}`);
      }
      throw error;
    }
    return { head: generationId, prev: current };
  }

  async readHead(groupId) {
    const database = await this._open();
    const transaction = database.transaction(HEADS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(HEADS).get(groupId));
    await done;
    return value ? { head: value.head, prev: value.prev || null } : null;
  }

  async readGeneration(groupId, generationId) {
    const database = await this._open();
    const transaction = database.transaction(GENERATIONS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(GENERATIONS).get(generationKey(groupId, generationId)));
    await done;
    if (!value) throw new WebMachineError("WEB_MACHINE_GENERATION_MISSING", `${groupId}: generation 없음 ${generationId}`);
    return value;
  }

  close() {
    if (!this._databasePromise) return;
    this._databasePromise.then((database) => database.close()).catch(() => undefined);
    this._databasePromise = null;
  }

  _open() {
    if (this._databasePromise) return this._databasePromise;
    this._databasePromise = new Promise((resolve, reject) => {
      const request = this._indexedDb.open(this._databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BLOBS)) database.createObjectStore(BLOBS);
        if (!database.objectStoreNames.contains(GENERATIONS)) database.createObjectStore(GENERATIONS);
        if (!database.objectStoreNames.contains(HEADS)) database.createObjectStore(HEADS);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open 실패"));
      request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
    return this._databasePromise;
  }
}
