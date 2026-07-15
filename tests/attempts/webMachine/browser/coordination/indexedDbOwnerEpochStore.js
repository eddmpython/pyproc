// indexedDbOwnerEpochStore.js - machine별 owner identity와 단조 epoch를 durable하게 관리한다.
import { WebMachineError } from "../../host/webMachineError.js";

const DATABASE_VERSION = 1;
const OWNERS = "owners";

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

function identity(machineId, ownerId) {
  const machine = String(machineId || "");
  const owner = String(ownerId || "");
  if (!machine) throw new TypeError("machineId가 필요하다");
  if (!owner) throw new TypeError("ownerId가 필요하다");
  return { machineId: machine, ownerId: owner };
}

export class IndexedDbOwnerEpochStore {
  constructor({ indexedDb, databaseName }) {
    if (!indexedDb || typeof indexedDb.open !== "function") throw new TypeError("indexedDb가 필요하다");
    if (!databaseName) throw new TypeError("databaseName이 필요하다");
    this._indexedDb = indexedDb;
    this._databaseName = String(databaseName);
    this._databasePromise = null;
  }

  async claim({ machineId, ownerId }) {
    const key = identity(machineId, ownerId);
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readwrite");
    const done = transactionDone(transaction);
    const owners = transaction.objectStore(OWNERS);
    const current = await requestValue(owners.get(key.machineId));
    const currentEpoch = current?.epoch || 0;
    if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new WebMachineError("WEB_MACHINE_OWNER_EPOCH_CORRUPT", `${key.machineId}: owner epoch 파손`);
    }
    const record = Object.freeze({ machineId: key.machineId, ownerId: key.ownerId, epoch: currentEpoch + 1 });
    owners.put(record, key.machineId);
    await done;
    return record;
  }

  async release({ machineId, ownerId, epoch }) {
    const key = identity(machineId, ownerId);
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readwrite");
    const done = transactionDone(transaction);
    const owners = transaction.objectStore(OWNERS);
    const current = await requestValue(owners.get(key.machineId));
    if (!current || current.ownerId !== key.ownerId || current.epoch !== epoch) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new WebMachineError("WEB_MACHINE_OWNER_STALE", `${key.machineId}: stale owner release ${key.ownerId}/${epoch}`);
    }
    owners.put({ machineId: key.machineId, ownerId: null, epoch }, key.machineId);
    await done;
    return true;
  }

  async assertOwner({ machineId, ownerId, epoch }) {
    const key = identity(machineId, ownerId);
    const current = await this.read(key.machineId);
    if (!current || current.ownerId !== key.ownerId || current.epoch !== epoch) {
      throw new WebMachineError("WEB_MACHINE_OWNER_STALE", `${key.machineId}: stale owner ${key.ownerId}/${epoch}`, { current });
    }
    return current;
  }

  async read(machineId) {
    const key = String(machineId || "");
    if (!key) throw new TypeError("machineId가 필요하다");
    const database = await this._open();
    const transaction = database.transaction(OWNERS, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(OWNERS).get(key));
    await done;
    return value ? Object.freeze({ machineId: value.machineId, ownerId: value.ownerId || null, epoch: value.epoch }) : null;
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
        if (!database.objectStoreNames.contains(OWNERS)) database.createObjectStore(OWNERS);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open 실패"));
      request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
    return this._databasePromise;
  }
}
