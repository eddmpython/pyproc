// snapshotEnvelope.js - engine payload를 해석하지 않는 image envelope 경계.
import { WebMachineError } from "./webMachineError.js";

const snapshotScopes = new Set(["portable", "session", "none"]);

export function isSnapshotScope(value) {
  return snapshotScopes.has(value);
}

export function asSnapshotBytes(value, label) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INVALID", `${label}: snapshot payload는 bytes여야 한다`);
}

export function createSnapshotEnvelope({ machineId, adapterId, capabilities, instanceId, payload }) {
  const bytes = asSnapshotBytes(payload, machineId);
  return Object.freeze({
    schemaVersion: 1,
    machineId,
    adapterId,
    adapterVersion: capabilities.adapterVersion,
    snapshotScope: capabilities.snapshotScope,
    originInstanceId: instanceId,
    payload: bytes,
  });
}

export function validateSnapshotEnvelope(envelope, { machineId, adapterId, adapterVersion = null }) {
  if (!envelope || envelope.schemaVersion !== 1) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INVALID", "snapshot schema 불일치");
  if (envelope.machineId !== machineId) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${machineId}: machineId 불일치`);
  if (envelope.adapterId !== adapterId) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${machineId}: adapterId 불일치`);
  if (adapterVersion && envelope.adapterVersion !== adapterVersion) {
    throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${machineId}: adapterVersion 불일치`);
  }
  if (!isSnapshotScope(envelope.snapshotScope)) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INVALID", "snapshotScope 불일치");
  return asSnapshotBytes(envelope.payload, machineId);
}
