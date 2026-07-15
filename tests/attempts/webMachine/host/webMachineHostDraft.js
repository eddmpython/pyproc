// webMachineHostDraft.js - engine과 browser 구현을 모르는 lifecycle/device/fencing core.
import { instantiateAdapter } from "./adapterContract.js";
import { createSnapshotEnvelope, validateSnapshotEnvelope } from "./snapshotEnvelope.js";
import { WebMachineError } from "./webMachineError.js";

function copyRecord(value) {
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

export class WebMachineHostDraft {
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
    if (this._adapterFactories.has(adapterId)) throw new WebMachineError("WEB_MACHINE_ADAPTER_DUPLICATE", `adapter 중복: ${adapterId}`);
    this._adapterFactories.set(adapterId, factory);
    return this;
  }

  registerDevice(name, device) {
    if (!name || typeof name !== "string") throw new TypeError("device name이 필요하다");
    if (!device || typeof device !== "object" || typeof device.kind !== "string") {
      throw new TypeError(`device ${name}: kind가 필요하다`);
    }
    this._devices.set(name, Object.freeze({ ...device }));
    return this;
  }

  createMachine({ machineId, adapterId, manifest = {}, permissions = { devices: [] } }) {
    if (!machineId || typeof machineId !== "string") throw new TypeError("machineId가 필요하다");
    if (this._machines.has(machineId)) throw new WebMachineError("WEB_MACHINE_DUPLICATE", `machine 중복: ${machineId}`);
    if (!this._adapterFactories.has(adapterId)) throw new WebMachineError("WEB_MACHINE_ADAPTER_UNAVAILABLE", `adapter 없음: ${adapterId}`);
    const machine = new WebMachineDraft(this, {
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
        throw new WebMachineError("WEB_MACHINE_DEVICE_MODE_UNSUPPORTED", `${machine.machineId}: ${name} mode ${device.mode || "none"} != ${requirement.mode}`);
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

class WebMachineDraft {
  constructor(host, { machineId, adapterId, manifest, permissions, instanceId }) {
    this.host = host;
    this.machineId = machineId;
    this.adapterId = adapterId;
    this.manifest = copyRecord(manifest);
    this.permissions = { devices: [...(permissions?.devices || [])] };
    this.instanceId = instanceId;
    this.state = "created";
    this.epoch = 1;
    this._adapter = null;
    this._capabilities = null;
    this._context = null;
    this._tail = Promise.resolve();
    this._operationSeq = 0;
    this._history = [{ event: "created", state: "created", epoch: this.epoch }];
  }

  get history() {
    return this._history.map((entry) => ({ ...entry }));
  }

  get capabilities() {
    return this._capabilities
      ? { ...this._capabilities, requiredDevices: this._capabilities.requiredDevices.map(copyRecord) }
      : null;
  }

  invalidateOwnership(reason = "owner lost") {
    this.epoch += 1;
    this._history.push({ event: "ownershipInvalidated", state: this.state, epoch: this.epoch, reason: String(reason) });
    return this.epoch;
  }

  async boot() {
    return this._enqueue("boot", async () => {
      this._expect(["created", "stopped"], "boot");
      const created = this.host._createAdapter(this.adapterId);
      const context = this.host._openContext(this, created.capabilities);
      this._adapter = created.adapter;
      this._capabilities = created.capabilities;
      this._context = context;
      try {
        await this._adapter.boot(context, this.manifest);
        this._setState("running", "booted");
        return this.inspectNow();
      } catch (error) {
        this._setState("failed", "bootFailed");
        throw error;
      }
    });
  }

  async pause() {
    return this._enqueue("pause", async () => {
      this._expect(["running"], "pause");
      await this._adapter.pause();
      this._setState("paused", "paused");
      return this.inspectNow();
    });
  }

  async resume() {
    return this._enqueue("resume", async () => {
      this._expect(["paused"], "resume");
      await this._adapter.resume();
      this._setState("running", "resumed");
      return this.inspectNow();
    });
  }

  async request(message) {
    return this._enqueue("request", async () => {
      this._expect(["running"], "request");
      return this._adapter.request(message);
    });
  }

  async snapshot() {
    return this._enqueue("snapshot", async () => {
      this._expect(["paused"], "snapshot");
      if (!this._capabilities || this._capabilities.snapshotScope === "none") {
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_UNSUPPORTED", `${this.machineId}: snapshot 미지원`);
      }
      const envelope = createSnapshotEnvelope({
        machineId: this.machineId,
        adapterId: this.adapterId,
        capabilities: this._capabilities,
        instanceId: this.instanceId,
        payload: await this._adapter.snapshot(),
      });
      this._history.push({
        event: "snapshotted",
        state: this.state,
        epoch: this.epoch,
        bytes: envelope.payload.byteLength,
        scope: envelope.snapshotScope,
      });
      return envelope;
    });
  }

  async restore(envelope) {
    return this._enqueue("restore", async () => {
      this._expect(["created", "paused", "stopped"], "restore");
      const payload = validateSnapshotEnvelope(envelope, {
        machineId: this.machineId,
        adapterId: this.adapterId,
        adapterVersion: this._capabilities?.adapterVersion || null,
      });
      const cold = this.state === "created" || this.state === "stopped";
      if (cold && envelope.snapshotScope !== "portable") {
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_SCOPE", `${this.machineId}: ${envelope.snapshotScope} snapshot은 cold restore 불가`);
      }
      if (cold) {
        const created = this.host._createAdapter(this.adapterId);
        const context = this.host._openContext(this, created.capabilities);
        if (created.capabilities.adapterVersion !== envelope.adapterVersion || created.capabilities.snapshotScope !== envelope.snapshotScope) {
          throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${this.machineId}: adapter capability 불일치`);
        }
        this._adapter = created.adapter;
        this._capabilities = created.capabilities;
        this._context = context;
      } else if (envelope.snapshotScope === "session" && envelope.originInstanceId !== this.instanceId) {
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_SCOPE", `${this.machineId}: 다른 session snapshot`);
      }
      await this._adapter.restore(payload, this._context, this.manifest);
      this._setState("paused", "restored");
      return this.inspectNow();
    });
  }

  async shutdown() {
    return this._enqueue("shutdown", async () => {
      this._expect(["created", "running", "paused", "failed"], "shutdown");
      if (this._adapter) await this._adapter.shutdown();
      this._adapter = null;
      this._context = null;
      this._setState("stopped", "shutdown");
      return this.inspectNow();
    }, { fenced: false });
  }

  async inspect() {
    return this._enqueue("inspect", async () => this.inspectNow(), { fenced: false });
  }

  inspectNow() {
    return {
      machineId: this.machineId,
      adapterId: this.adapterId,
      instanceId: this.instanceId,
      state: this.state,
      epoch: this.epoch,
      capabilities: this.capabilities,
      guest: this._adapter ? this._adapter.inspect() : null,
      history: this.history,
    };
  }

  _expect(states, operation) {
    if (!states.includes(this.state)) {
      throw new WebMachineError("WEB_MACHINE_INVALID_STATE", `${this.machineId}: ${operation}은 ${this.state}에서 불가`, {
        expected: states,
        actual: this.state,
      });
    }
  }

  _setState(state, event) {
    this.state = state;
    this._history.push({ event, state, epoch: this.epoch });
  }

  _enqueue(label, operation, { fenced = true } = {}) {
    const operationId = `${this.instanceId}/${++this._operationSeq}`;
    const task = this._tail.then(async () => {
      const sentEpoch = this.epoch;
      let result;
      let failure = null;
      try {
        result = await operation();
      } catch (error) {
        failure = error;
      }
      if (fenced && sentEpoch !== this.epoch) {
        throw new WebMachineError(
          "WEB_MACHINE_OUTCOME_UNKNOWN",
          `${this.machineId}: ${label} 결과 불명, 자동 replay 금지`,
          { operationId, sentEpoch, currentEpoch: this.epoch, retryable: false },
        );
      }
      if (failure) throw failure;
      return result;
    });
    this._tail = task.catch(() => undefined);
    return task;
  }
}
