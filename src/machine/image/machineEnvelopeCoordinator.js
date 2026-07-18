// machineEnvelopeCoordinator.js - paused machine과 block을 한 이동 이미지로 조정한다.
import { throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { assertWebMachineArchive, createWebMachineFile, readWebMachineFile } from "./webMachineFile.js";

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lookup(collection, key) {
  return collection instanceof Map ? collection.get(key) : collection?.[key];
}

function sortedMachines(machines) {
  return [...(machines || [])].sort((left, right) => compareNames(left.machineId, right.machineId));
}

function sortedDevices(devices) {
  return Object.entries(devices || {}).sort(([left], [right]) => compareNames(left, right));
}

function asStringSet(value) {
  return new Set(value || []);
}

function copyJson(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copyJson);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyJson(entry)]));
}

export class MachineEnvelopeCoordinator {
  constructor({ cryptoProvider, nowFactory }) {
    // digest·서명 법은 커널 한 벌이다: 조립은 createMachineCryptoProvider가 배달한다(맨 Crypto 거부).
    if (typeof cryptoProvider?.digestBytes !== "function" || typeof cryptoProvider?.signDigest !== "function") {
      throw new TypeError("cryptoProvider.digestBytes/signDigest가 필요하다(createMachineCryptoProvider로 감싸라)");
    }
    if (typeof nowFactory !== "function") throw new TypeError("nowFactory가 필요하다");
    this._cryptoProvider = cryptoProvider;
    this._nowFactory = nowFactory;
  }

  async exportPaused({ groupId, machines, devices = {}, requiredCapabilities = {}, signingKeyPair, control }) {
    throwIfOperationAborted(control, `${groupId}: image export`);
    const machineList = sortedMachines(machines);
    if (!machineList.length) throw new TypeError("machines가 필요하다");
    for (const machine of machineList) {
      if (machine.state !== "paused") {
        throw new WebMachineError("WEB_MACHINE_IMAGE_EXPORT_STATE", `${machine.machineId}: paused export만 허용`);
      }
    }
    const deviceEntries = sortedDevices(devices);
    for (const [name, device] of deviceEntries) this._assertBlockDevice(name, device);
    await Promise.all(deviceEntries.map(([, device]) => device.flush()));
    throwIfOperationAborted(control, `${groupId}: image export`);
    const [machineSnapshots, deviceSnapshots] = await Promise.all([
      Promise.all(machineList.map((machine) => machine.snapshot(control))),
      Promise.all(deviceEntries.map(async ([name, device]) => ({
        name,
        kind: device.kind,
        byteLength: device.byteLength,
        payload: await device.snapshot(),
      }))),
    ]);
    const machineById = new Map(machineList.map((machine) => [machine.machineId, machine]));
    const machineRecords = machineSnapshots.map((snapshot) => {
      if (snapshot.snapshotScope !== "portable") {
        throw new WebMachineError("WEB_MACHINE_IMAGE_SNAPSHOT_SCOPE", `${snapshot.machineId}: portable snapshot 필요`);
      }
      const machine = machineById.get(snapshot.machineId);
      return {
        machineId: snapshot.machineId,
        adapterId: snapshot.adapterId,
        adapterVersion: snapshot.adapterVersion,
        snapshotScope: snapshot.snapshotScope,
        requiredCapabilities: [...(lookup(requiredCapabilities, snapshot.machineId) || [])],
        permissions: { devices: [...(machine.permissions?.devices || [])] },
        guestManifest: { ...(machine.manifest || {}) },
        payload: snapshot.payload,
      };
    });
    return createWebMachineFile({
      cryptoProvider: this._cryptoProvider,
      groupId,
      createdAt: Number(this._nowFactory()),
      machines: machineRecords,
      devices: deviceSnapshots,
      signingKeyPair,
      control,
    });
  }

  async read({ file, trustedPublicKeys, control }) {
    return readWebMachineFile({ file, cryptoProvider: this._cryptoProvider, trustedPublicKeys, control });
  }

  preflightImport({ archive, host, devices = {}, approvedPermissions = {}, availableCapabilities = [] }) {
    assertWebMachineArchive(archive);
    if (!host || typeof host.preflightMachine !== "function") throw new TypeError("preflightMachine host가 필요하다");
    const capabilities = asStringSet(availableCapabilities);
    for (const record of archive.manifest.devices) {
      const device = lookup(devices, record.name);
      if (!device) throw new WebMachineError("WEB_MACHINE_IMAGE_DEVICE_MISSING", `device target 없음: ${record.name}`);
      this._assertBlockDevice(record.name, device);
      if (device.byteLength !== record.byteLength) {
        throw new WebMachineError("WEB_MACHINE_IMAGE_DEVICE_SIZE", `${record.name}: ${device.byteLength} != ${record.byteLength}`);
      }
    }
    for (const record of archive.manifest.machines) {
      const approved = asStringSet(lookup(approvedPermissions, record.machineId)?.devices);
      const deniedDevices = record.permissions.devices.filter((name) => !approved.has(name));
      if (deniedDevices.length) {
        throw new WebMachineError(
          "WEB_MACHINE_IMAGE_PERMISSION_DENIED",
          `${record.machineId}: 승인되지 않은 device ${deniedDevices.join(", ")}`,
          { deniedDevices },
        );
      }
      const missingCapabilities = record.requiredCapabilities.filter((name) => !capabilities.has(name));
      if (missingCapabilities.length) {
        throw new WebMachineError(
          "WEB_MACHINE_IMAGE_CAPABILITY_MISSING",
          `${record.machineId}: capability 없음 ${missingCapabilities.join(", ")}`,
          { missingCapabilities },
        );
      }
      host.preflightMachine({
        machineId: record.machineId,
        adapterId: record.adapterId,
        adapterVersion: record.adapterVersion,
        snapshotScope: record.snapshotScope,
        permissions: record.permissions,
      });
    }
    return Object.freeze({
      groupId: archive.manifest.groupId,
      machineIds: Object.freeze(archive.manifest.machines.map((record) => record.machineId)),
      deviceNames: Object.freeze(archive.manifest.devices.map((record) => record.name)),
    });
  }

  async importVerified({
    archive,
    host,
    devices = {},
    approvedPermissions = {},
    availableCapabilities = [],
    ownerToken,
    control,
  }) {
    throwIfOperationAborted(control, "webmachine verified import");
    const preflight = this.preflightImport({ archive, host, devices, approvedPermissions, availableCapabilities });
    const machines = new Map();
    try {
      for (const record of archive.manifest.devices) {
        throwIfOperationAborted(control, "webmachine device import");
        await lookup(devices, record.name).restore(archive.readBlob(record.payload.blobId));
      }
      for (const record of archive.manifest.machines) {
        throwIfOperationAborted(control, "webmachine machine import");
        const machine = host.createMachine({
          machineId: record.machineId,
          adapterId: record.adapterId,
          manifest: copyJson(record.guestManifest),
          permissions: record.permissions,
        });
        if (ownerToken) machine.adoptOwnership(ownerToken);
        machines.set(record.machineId, machine);
      }
      for (const record of archive.manifest.machines) {
        throwIfOperationAborted(control, "webmachine machine restore");
        await machines.get(record.machineId).restore({
          schemaVersion: 1,
          machineId: record.machineId,
          adapterId: record.adapterId,
          adapterVersion: record.adapterVersion,
          snapshotScope: record.snapshotScope,
          originInstanceId: `webmachine:${archive.manifest.integrity.contentDigest}`,
          payload: archive.readBlob(record.payload.blobId),
        }, control);
      }
      return Object.freeze({ archive, machines, preflight });
    } catch (error) {
      await Promise.allSettled([...machines.values()]
        .filter((machine) => machine.state !== "stopped")
        .map((machine) => machine.shutdown()));
      throw error;
    }
  }

  _assertBlockDevice(name, device) {
    if (!device || device.kind !== "block") {
      throw new WebMachineError("WEB_MACHINE_IMAGE_DEVICE_KIND", `${name}: block device 필요`);
    }
    for (const method of ["flush", "snapshot", "restore"]) {
      if (typeof device[method] !== "function") {
        throw new WebMachineError("WEB_MACHINE_IMAGE_DEVICE_INVALID", `${name}: ${method}() 없음`);
      }
    }
  }
}
