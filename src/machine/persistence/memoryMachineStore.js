// memoryMachineStore.js - owner fencing, atomic generation publish, retention의 deterministic 기준 구현.
import { throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { copyGenerationBytes } from "./generationIntegrity.js";
import { generationStorageKey, planGenerationRetention } from "./generationRetention.js";

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function identity(groupId, ownerId) {
  const group = String(groupId || "");
  const owner = String(ownerId || "");
  if (!group) throw new TypeError("groupId가 필요하다");
  if (!owner) throw new TypeError("ownerId가 필요하다");
  return { groupId: group, ownerId: owner };
}

function copyToken(value) {
  return Object.freeze({ groupId: value.groupId, ownerId: value.ownerId, epoch: value.epoch });
}

export class MemoryMachineStore {
  constructor() {
    this._blobs = new Map();
    this._generations = new Map();
    this._heads = new Map();
    this._owners = new Map();
    this._writeTail = Promise.resolve();
  }

  claimOwner({ groupId, ownerId, minimumEpoch = 1 }) {
    const key = identity(groupId, ownerId);
    if (!Number.isSafeInteger(minimumEpoch) || minimumEpoch < 1) throw new TypeError("minimumEpoch는 1 이상 정수여야 한다");
    return this._write(() => {
      const current = this._owners.get(key.groupId);
      const epoch = Math.max((current?.epoch || 0) + 1, minimumEpoch);
      const record = { ...key, epoch, active: true };
      this._owners.set(key.groupId, record);
      return copyToken(record);
    });
  }

  releaseOwner(token) {
    return this._write(() => {
      const current = this._assertOwnerRecord(token);
      this._owners.set(current.groupId, { ...current, active: false });
      return true;
    });
  }

  async assertOwner(token) {
    return copyToken(this._assertOwnerRecord(token));
  }

  async readOwner(groupId) {
    const key = String(groupId || "");
    if (!key) throw new TypeError("groupId가 필요하다");
    const value = this._owners.get(key);
    return value ? Object.freeze({ ...value }) : null;
  }

  async getBlob(digest) {
    const bytes = this._blobs.get(digest);
    if (!bytes) throw new WebMachineError("WEB_MACHINE_BLOB_MISSING", `blob 없음: ${digest}`);
    return bytes.slice();
  }

  commitGeneration({ groupId, generationId, expectedHead, ownerToken, blobs = [], record, control }) {
    const group = String(groupId || "");
    const generation = String(generationId || "");
    if (!group) throw new TypeError("groupId가 필요하다");
    if (!generation) throw new TypeError("generationId가 필요하다");
    const payloads = blobs.map(({ digest, bytes }) => ({ digest: String(digest || ""), bytes: copyGenerationBytes(bytes) }));
    const storedRecord = cloneRecord(record);
    return this._write(() => {
      throwIfOperationAborted(control, `${group}: generation commit`);
      const owner = this._assertOwnerRecord(ownerToken, group);
      const current = this._heads.get(group)?.head || null;
      if (current !== expectedHead) {
        throw new WebMachineError("WEB_MACHINE_HEAD_CONFLICT", `${group}: HEAD ${current} != ${expectedHead}`, {
          expectedHead,
          actualHead: current,
        });
      }
      const key = generationStorageKey(group, generation);
      if (this._generations.has(key)) {
        throw new WebMachineError("WEB_MACHINE_GENERATION_EXISTS", `${group}: generation 이미 존재 ${generation}`);
      }
      for (const payload of payloads) {
        if (!payload.digest) throw new TypeError("blob digest가 필요하다");
        if (!this._blobs.has(payload.digest)) this._blobs.set(payload.digest, payload.bytes);
      }
      this._generations.set(key, storedRecord);
      const head = { head: generation, prev: current, ownerEpoch: owner.epoch };
      this._heads.set(group, head);
      return { ...head };
    });
  }

  async readHead(groupId) {
    const value = this._heads.get(groupId);
    return value ? { ...value } : null;
  }

  async readGeneration(groupId, generationId) {
    const value = this._generations.get(generationStorageKey(groupId, generationId));
    if (!value) throw new WebMachineError("WEB_MACHINE_GENERATION_MISSING", `${groupId}: generation 없음 ${generationId}`);
    return cloneRecord(value);
  }

  dryRunRecoveryWindow({ groupId, ownerToken }) {
    return this._write(() => {
      this._assertOwnerRecord(ownerToken, groupId);
      return this._retentionReport(groupId);
    });
  }

  pruneRecoveryWindow({ groupId, ownerToken, control }) {
    return this._write(() => {
      throwIfOperationAborted(control, `${groupId}: generation prune`);
      this._assertOwnerRecord(ownerToken, groupId);
      const report = this._retentionReport(groupId);
      for (const key of report.deletedGenerationKeys) this._generations.delete(key);
      for (const digest of report.deletedBlobDigests) this._blobs.delete(digest);
      return report;
    });
  }

  async inspectStorage() {
    let blobBytes = 0;
    for (const bytes of this._blobs.values()) blobBytes += bytes.byteLength;
    return Object.freeze({
      blobs: this._blobs.size,
      blobBytes,
      generations: this._generations.size,
      groups: this._heads.size,
    });
  }

  close() {}

  _assertOwnerRecord(token, expectedGroupId = token?.groupId) {
    const groupId = String(expectedGroupId || "");
    const current = this._owners.get(groupId);
    if (!current || !current.active || current.ownerId !== token?.ownerId || current.epoch !== token?.epoch || token?.groupId !== groupId) {
      throw new WebMachineError("WEB_MACHINE_OWNER_STALE", `${groupId}: stale owner ${token?.ownerId || "none"}/${token?.epoch || 0}`, {
        current: current ? { ...current } : null,
      });
    }
    return current;
  }

  _retentionReport(groupId) {
    const plan = planGenerationRetention({
      targetGroupId: groupId,
      heads: this._heads,
      generations: this._generations,
      blobDigests: this._blobs.keys(),
    });
    let reclaimedBytes = 0;
    for (const digest of plan.deletedBlobDigests) reclaimedBytes += this._blobs.get(digest)?.byteLength || 0;
    return Object.freeze({
      ...plan,
      deletedGenerations: plan.deletedGenerationKeys.length,
      deletedBlobs: plan.deletedBlobDigests.length,
      reclaimedBytes,
      retainedGenerations: plan.retainedGenerationKeys.length,
      retainedBlobs: plan.retainedBlobDigests.length,
    });
  }

  _write(operation) {
    const task = this._writeTail.then(operation);
    this._writeTail = task.catch(() => undefined);
    return task;
  }
}
