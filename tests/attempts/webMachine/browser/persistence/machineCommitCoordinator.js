// machineCommitCoordinator.js - paused guest snapshot과 flushed device를 한 CAS generation으로 commit한다.
import { WebMachineError } from "../../host/webMachineError.js";
import {
  copyGenerationBytes,
  digestGenerationBytes,
  digestGenerationManifest,
  verifyGenerationBlob,
} from "./generationIntegrity.js";

const RECOVERABLE_CODES = new Set([
  "WEB_MACHINE_BLOB_MISSING",
  "WEB_MACHINE_GENERATION_CORRUPT",
  "WEB_MACHINE_GENERATION_MISSING",
]);

function lookup(collection, key) {
  return collection instanceof Map ? collection.get(key) : collection?.[key];
}

function sortedMachines(machines) {
  return [...machines].sort((left, right) => left.machineId.localeCompare(right.machineId));
}

function sortedDevices(devices) {
  return Object.entries(devices).sort(([left], [right]) => left.localeCompare(right));
}

export class MachineCommitCoordinator {
  constructor({ store, cryptoProvider, idFactory, nowFactory }) {
    if (!store) throw new TypeError("store가 필요하다");
    if (!cryptoProvider?.subtle) throw new TypeError("cryptoProvider.subtle이 필요하다");
    if (typeof idFactory !== "function") throw new TypeError("idFactory가 필요하다");
    if (typeof nowFactory !== "function") throw new TypeError("nowFactory가 필요하다");
    this._store = store;
    this._cryptoProvider = cryptoProvider;
    this._idFactory = idFactory;
    this._nowFactory = nowFactory;
  }

  async readHead(groupId) {
    return this._store.readHead(groupId);
  }

  async commitPaused({ groupId, machines, devices = {}, expectedHead }) {
    if (!groupId) throw new TypeError("groupId가 필요하다");
    if (expectedHead === undefined) throw new TypeError("expectedHead가 필요하다");
    const machineList = sortedMachines(machines || []);
    if (!machineList.length) throw new TypeError("machines가 필요하다");
    for (const machine of machineList) {
      if (machine.state !== "paused") {
        throw new WebMachineError("WEB_MACHINE_COMMIT_STATE", `${machine.machineId}: paused commit만 허용`);
      }
    }
    const deviceEntries = sortedDevices(devices);
    for (const [name, device] of deviceEntries) this._assertBlockDevice(name, device);

    await Promise.all(deviceEntries.map(([, device]) => device.flush()));
    const [machineSnapshots, deviceSnapshots] = await Promise.all([
      Promise.all(machineList.map((machine) => machine.snapshot())),
      Promise.all(deviceEntries.map(async ([name, device]) => ({ name, device, payload: await device.snapshot() }))),
    ]);

    const machineRecords = await Promise.all(machineSnapshots.map(async (snapshot) => ({
      machineId: snapshot.machineId,
      adapterId: snapshot.adapterId,
      adapterVersion: snapshot.adapterVersion,
      snapshotScope: snapshot.snapshotScope,
      originInstanceId: snapshot.originInstanceId,
      payload: await this._storePayload(snapshot.payload),
    })));
    const deviceRecords = await Promise.all(deviceSnapshots.map(async ({ name, device, payload }) => ({
      name,
      kind: device.kind,
      byteLength: device.byteLength,
      payload: await this._storePayload(payload),
    })));

    const generationId = String(this._idFactory() || "");
    if (!generationId) throw new TypeError("idFactory는 generation ID를 반환해야 한다");
    const manifest = {
      schemaVersion: 1,
      groupId: String(groupId),
      generationId,
      previousGeneration: expectedHead,
      createdAt: Number(this._nowFactory()),
      machines: machineRecords,
      devices: deviceRecords,
    };
    const record = {
      manifest,
      manifestHash: await digestGenerationManifest(this._cryptoProvider, manifest),
    };
    const head = await this._store.commitGeneration({ groupId, generationId, expectedHead, record });
    return { ...record, head };
  }

  async restoreLatest({ groupId, machines, devices = {} }) {
    const head = await this._store.readHead(groupId);
    if (!head?.head) throw new WebMachineError("WEB_MACHINE_RECOVERY_EMPTY", `${groupId}: HEAD 없음`);
    const failures = [];
    for (const generationId of [head.head, head.prev].filter(Boolean)) {
      let verified;
      try {
        verified = await this._readVerifiedGeneration(groupId, generationId);
      } catch (error) {
        if (!RECOVERABLE_CODES.has(error?.code)) throw error;
        failures.push({ generationId, code: error.code });
        continue;
      }
      await this._applyGeneration(verified, machines, devices);
      return {
        generationId,
        recoveredFrom: generationId === head.head ? null : head.head,
        failures,
        manifest: verified.manifest,
      };
    }
    throw new WebMachineError("WEB_MACHINE_RECOVERY_UNAVAILABLE", `${groupId}: HEAD/PREV 복구 실패`, { failures });
  }

  async _storePayload(value) {
    const bytes = copyGenerationBytes(value);
    const digest = await digestGenerationBytes(this._cryptoProvider, bytes);
    await this._store.putBlob({ digest, bytes });
    return { digest, byteLength: bytes.byteLength };
  }

  async _readVerifiedGeneration(groupId, generationId) {
    const record = await this._store.readGeneration(groupId, generationId);
    const actualManifestHash = await digestGenerationManifest(this._cryptoProvider, record.manifest);
    if (record.manifestHash !== actualManifestHash) {
      throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", `${groupId}: manifest hash 불일치 ${generationId}`);
    }
    const manifest = record.manifest;
    if (manifest.schemaVersion !== 1 || manifest.groupId !== groupId || manifest.generationId !== generationId) {
      throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", `${groupId}: manifest identity 불일치 ${generationId}`);
    }
    const machinePayloads = new Map();
    const devicePayloads = new Map();
    for (const entry of manifest.machines) {
      const payload = await this._store.getBlob(entry.payload.digest);
      machinePayloads.set(entry.machineId, await verifyGenerationBlob(this._cryptoProvider, entry.payload, payload));
    }
    for (const entry of manifest.devices) {
      const payload = await this._store.getBlob(entry.payload.digest);
      devicePayloads.set(entry.name, await verifyGenerationBlob(this._cryptoProvider, entry.payload, payload));
    }
    return { manifest, machinePayloads, devicePayloads };
  }

  async _applyGeneration(verified, machines, devices) {
    for (const entry of verified.manifest.devices) {
      const device = lookup(devices, entry.name);
      if (!device) throw new WebMachineError("WEB_MACHINE_RESTORE_TARGET_MISSING", `device target 없음: ${entry.name}`);
      this._assertBlockDevice(entry.name, device);
      if (device.byteLength !== entry.byteLength) {
        throw new WebMachineError("WEB_MACHINE_BLOCK_SIZE", `${entry.name}: block 크기 불일치`);
      }
      await device.restore(verified.devicePayloads.get(entry.name));
    }
    for (const entry of verified.manifest.machines) {
      const machine = lookup(machines, entry.machineId);
      if (!machine) throw new WebMachineError("WEB_MACHINE_RESTORE_TARGET_MISSING", `machine target 없음: ${entry.machineId}`);
      await machine.restore({
        schemaVersion: 1,
        machineId: entry.machineId,
        adapterId: entry.adapterId,
        adapterVersion: entry.adapterVersion,
        snapshotScope: entry.snapshotScope,
        originInstanceId: entry.originInstanceId,
        payload: verified.machinePayloads.get(entry.machineId),
      });
    }
  }

  _assertBlockDevice(name, device) {
    if (!device || device.kind !== "block") throw new WebMachineError("WEB_MACHINE_DEVICE_KIND_UNSUPPORTED", `${name}: block device 필요`);
    for (const method of ["flush", "snapshot", "restore"]) {
      if (typeof device[method] !== "function") throw new WebMachineError("WEB_MACHINE_DEVICE_INVALID", `${name}: ${method}() 없음`);
    }
  }
}
