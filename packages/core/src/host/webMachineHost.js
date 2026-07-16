// webMachineHost.js - engine과 browser 구현을 모르는 machine registry와 device gate.
import { instantiateAdapter } from "../contracts/adapterContract.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { MachineHandle } from "./machineHandle.js";

function copyRecord(value) {
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

export class WebMachineHost {
  constructor({ devices = {}, idFactory } = {}) {
    if (typeof idFactory !== "function") throw new TypeError("idFactory가 필요하다");
    this._idFactory = idFactory;
    this._adapterFactories = new Map();
    this._devices = new Map();
    this._machines = new Map();
    for (const [name, device] of Object.entries(devices)) this.registerDevice(name, device);
  }

  registerAdapter(adapterId, factory) {
    if (!adapterId || typeof adapterId !== "string") throw new TypeError("adapterId가 필요하다");
    if (typeof factory !== "function") throw new TypeError("adapter factory는 함수여야 한다");
    if (this._adapterFactories.has(adapterId)) {
      throw new WebMachineError("WEB_MACHINE_ADAPTER_DUPLICATE", `adapter 중복: ${adapterId}`);
    }
    this._adapterFactories.set(adapterId, factory);
    return this;
  }

  registerDevice(name, device) {
    if (!name || typeof name !== "string") throw new TypeError("device name이 필요하다");
    if (!device || typeof device !== "object" || typeof device.kind !== "string") {
      throw new TypeError(`device ${name}: kind가 필요하다`);
    }
    this._devices.set(name, device);
    return this;
  }

  createMachine({ machineId, adapterId, manifest = {}, permissions = { devices: [] } }) {
    if (!machineId || typeof machineId !== "string") throw new TypeError("machineId가 필요하다");
    if (this._machines.has(machineId)) {
      throw new WebMachineError("WEB_MACHINE_DUPLICATE", `machine 중복: ${machineId}`);
    }
    if (!this._adapterFactories.has(adapterId)) {
      throw new WebMachineError("WEB_MACHINE_ADAPTER_UNAVAILABLE", `adapter 없음: ${adapterId}`);
    }
    const machine = new MachineHandle(this, {
      machineId,
      adapterId,
      manifest,
      permissions,
      instanceId: this._nextInstanceId(),
    });
    this._machines.set(machineId, machine);
    return machine;
  }

  getMachine(machineId) {
    return this._machines.get(machineId) || null;
  }

  preflightMachine({ machineId, adapterId, adapterVersion, snapshotScope, permissions = { devices: [] } }) {
    if (!machineId || typeof machineId !== "string") throw new TypeError("machineId가 필요하다");
    if (this._machines.has(machineId)) {
      throw new WebMachineError("WEB_MACHINE_DUPLICATE", `machine 중복: ${machineId}`);
    }
    const created = this._createAdapter(adapterId);
    if (created.capabilities.adapterVersion !== adapterVersion) {
      throw new WebMachineError(
        "WEB_MACHINE_IMAGE_ADAPTER_VERSION",
        `${machineId}: adapterVersion ${created.capabilities.adapterVersion} != ${adapterVersion}`,
      );
    }
    if (created.capabilities.snapshotScope !== snapshotScope) {
      throw new WebMachineError(
        "WEB_MACHINE_IMAGE_ADAPTER_SCOPE",
        `${machineId}: snapshotScope ${created.capabilities.snapshotScope} != ${snapshotScope}`,
      );
    }
    this._openContext({ machineId, permissions }, created.capabilities);
    return Object.freeze({
      ...created.capabilities,
      requiredDevices: Object.freeze(created.capabilities.requiredDevices.map((entry) => Object.freeze(copyRecord(entry)))),
    });
  }

  _nextInstanceId() {
    const instanceId = String(this._idFactory() || "");
    if (!instanceId) throw new TypeError("idFactory는 비어 있지 않은 ID를 반환해야 한다");
    return instanceId;
  }

  _createAdapter(adapterId) {
    const factory = this._adapterFactories.get(adapterId);
    if (!factory) throw new WebMachineError("WEB_MACHINE_ADAPTER_UNAVAILABLE", `adapter 없음: ${adapterId}`);
    return instantiateAdapter(adapterId, factory);
  }

  _openContext(machine, capabilities) {
    const allowed = new Set(machine.permissions.devices || []);
    const devices = {};
    for (const requirement of capabilities.requiredDevices) {
      const name = String(requirement.name || "");
      if (!allowed.has(name)) {
        throw new WebMachineError("WEB_MACHINE_DEVICE_PERMISSION_DENIED", `${machine.machineId}: device 권한 없음 ${name}`);
      }
      const device = this._devices.get(name);
      if (!device) throw new WebMachineError("WEB_MACHINE_DEVICE_MISSING", `${machine.machineId}: device 없음 ${name}`);
      if (requirement.kind && device.kind !== requirement.kind) {
        throw new WebMachineError("WEB_MACHINE_DEVICE_KIND_UNSUPPORTED", `${machine.machineId}: ${name} kind ${device.kind} != ${requirement.kind}`);
      }
      if (requirement.mode && device.mode !== requirement.mode) {
        throw new WebMachineError(
          "WEB_MACHINE_DEVICE_MODE_UNSUPPORTED",
          `${machine.machineId}: ${name} mode ${device.mode || "none"} != ${requirement.mode}`,
        );
      }
      devices[name] = device;
    }
    return Object.freeze({
      machineId: machine.machineId,
      devices: Object.freeze(devices),
      permissions: Object.freeze({ devices: Object.freeze([...allowed]) }),
    });
  }
}
