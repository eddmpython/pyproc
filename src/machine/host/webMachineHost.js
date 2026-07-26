// webMachineHost.js - Layer 5/pure: engine과 browser 구현을 모르는 machine registry와 device gate.
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

  // 장치 열거. 컴퓨터라면 무엇이 꽂혀 있는지 물을 수 있어야 한다. 반환은 요약이다:
  // device 객체 자체를 넘기면 권한 gate를 우회하는 경로가 열린다.
  listDevices() {
    return [...this._devices.entries()].map(([name, device]) => Object.freeze({
      name,
      kind: device.kind,
      mode: typeof device.mode === "string" ? device.mode : null,
    }));
  }

  // 핫플러그: 부팅된 머신이 그 이름을 요구하고 있으면 거부한다(frozen context가 이미 그 장치를
  // 들고 있어서, 떼도 guest는 옛 참조를 계속 쓴다 = 조용한 불일치).
  detachDevice(name) {
    if (!this._devices.has(name)) {
      throw new WebMachineError("WEB_MACHINE_DEVICE_MISSING", `device 없음: ${name}`);
    }
    const users = [...this._machines.values()].filter((machine) => machine.usesDevice(name));
    if (users.length) {
      throw new WebMachineError("WEB_MACHINE_DEVICE_IN_USE",
        `device 사용 중: ${name} (${users.map((machine) => machine.machineId).join(", ")})`);
    }
    this._devices.delete(name);
    return this;
  }

  // 머신 제거. 이 동사가 없어서 machineId가 한 번 쓰면 영구 점유였고, 그 결핍을
  // createWebComputer의 createMachines 플래그가 메우고 있었다(동사 부재를 플래그로 메우면
  // 정상 동선이 우회로를 탄다). 실행 중 제거는 거부한다: 정지가 먼저다.
  destroyMachine(machineId) {
    const machine = this._machines.get(machineId);
    if (!machine) {
      throw new WebMachineError("WEB_MACHINE_UNAVAILABLE", `machine 없음: ${machineId}`);
    }
    if (machine.state !== "created" && machine.state !== "stopped") {
      throw new WebMachineError("WEB_MACHINE_MACHINE_IN_USE",
        `machine 제거는 정지 상태에서만 가능하다: ${machineId} (${machine.state})`);
    }
    this._machines.delete(machineId);
    return this;
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
