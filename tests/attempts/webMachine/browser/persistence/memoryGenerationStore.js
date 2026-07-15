// memoryGenerationStore.js - generation store port의 deterministic 기준 구현.
import { WebMachineError } from "../../host/webMachineError.js";
import { copyGenerationBytes } from "./generationIntegrity.js";

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function generationKey(groupId, generationId) {
  return `${groupId}\n${generationId}`;
}

export class MemoryGenerationStore {
  constructor() {
    this._blobs = new Map();
    this._generations = new Map();
    this._heads = new Map();
    this._commitTail = Promise.resolve();
  }

  async putBlob({ digest, bytes }) {
    if (!this._blobs.has(digest)) this._blobs.set(digest, copyGenerationBytes(bytes));
  }

  async getBlob(digest) {
    const bytes = this._blobs.get(digest);
    if (!bytes) throw new WebMachineError("WEB_MACHINE_BLOB_MISSING", `blob 없음: ${digest}`);
    return bytes.slice();
  }

  async commitGeneration({ groupId, generationId, expectedHead, record }) {
    const task = this._commitTail.then(() => {
      const current = this._heads.get(groupId)?.head || null;
      if (current !== expectedHead) {
        throw new WebMachineError("WEB_MACHINE_HEAD_CONFLICT", `${groupId}: HEAD ${current} != ${expectedHead}`, {
          expectedHead,
          actualHead: current,
        });
      }
      const key = generationKey(groupId, generationId);
      if (this._generations.has(key)) {
        throw new WebMachineError("WEB_MACHINE_GENERATION_EXISTS", `${groupId}: generation 이미 존재 ${generationId}`);
      }
      this._generations.set(key, cloneRecord(record));
      this._heads.set(groupId, { head: generationId, prev: current });
      return { head: generationId, prev: current };
    });
    this._commitTail = task.catch(() => undefined);
    return task;
  }

  async readHead(groupId) {
    const value = this._heads.get(groupId);
    return value ? { ...value } : null;
  }

  async readGeneration(groupId, generationId) {
    const value = this._generations.get(generationKey(groupId, generationId));
    if (!value) throw new WebMachineError("WEB_MACHINE_GENERATION_MISSING", `${groupId}: generation 없음 ${generationId}`);
    return cloneRecord(value);
  }
}
