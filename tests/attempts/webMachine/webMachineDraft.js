// webMachineDraft.js - attempts 전용 Web Machine Host 계약 초안.
// engine 내부를 모르는 얇은 lifecycle/device/image/fencing 계층만 둔다.

const SNAPSHOT_SCOPES = new Set(["portable", "session", "none"]);

function randomId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function asBytes(value, label) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INVALID", `${label}: snapshot payload는 bytes여야 한다`);
}

function copyRecord(value) {
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

export class WebMachineError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "WebMachineError";
    this.code = code;
    this.details = details;
  }
}

export class WebMachineHostDraft {
  constructor({ devices = {} } = {}) {
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
    const machine = new WebMachineDraft(this, { machineId, adapterId, manifest, permissions });
    this._machines.set(machineId, machine);
    return machine;
  }

  getMachine(machineId) {
    return this._machines.get(machineId) || null;
  }

  _createAdapter(adapterId) {
    const factory = this._adapterFactories.get(adapterId);
    if (!factory) throw new WebMachineError("WEB_MACHINE_ADAPTER_UNAVAILABLE", `adapter 없음: ${adapterId}`);
    const adapter = factory();
    if (!adapter || typeof adapter !== "object") throw new WebMachineError("WEB_MACHINE_ADAPTER_INVALID", `${adapterId}: adapter object가 아니다`);
    const required = ["boot", "pause", "resume", "snapshot", "restore", "shutdown", "request", "inspect"];
    for (const method of required) {
      if (typeof adapter[method] !== "function") throw new WebMachineError("WEB_MACHINE_ADAPTER_INVALID", `${adapterId}: ${method}() 없음`);
    }
    const capabilities = {
      adapterVersion: String(adapter.capabilities?.adapterVersion || "0"),
      snapshotScope: String(adapter.capabilities?.snapshotScope || "none"),
      pauseMode: String(adapter.capabilities?.pauseMode || "cooperative"),
      shutdownMode: String(adapter.capabilities?.shutdownMode || "terminate"),
      requiredDevices: Array.isArray(adapter.capabilities?.requiredDevices) ? adapter.capabilities.requiredDevices.map(copyRecord) : [],
    };
    if (!SNAPSHOT_SCOPES.has(capabilities.snapshotScope)) {
      throw new WebMachineError("WEB_MACHINE_ADAPTER_INVALID", `${adapterId}: snapshotScope ${capabilities.snapshotScope} 미지원`);
    }
    return { adapter, capabilities };
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
  constructor(host, { machineId, adapterId, manifest, permissions }) {
    this.host = host;
    this.machineId = machineId;
    this.adapterId = adapterId;
    this.manifest = copyRecord(manifest);
    this.permissions = { devices: [...(permissions?.devices || [])] };
    this.instanceId = randomId();
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
    return this._capabilities ? { ...this._capabilities, requiredDevices: this._capabilities.requiredDevices.map(copyRecord) } : null;
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
      const payload = asBytes(await this._adapter.snapshot(), this.machineId);
      const envelope = Object.freeze({
        schemaVersion: 1,
        machineId: this.machineId,
        adapterId: this.adapterId,
        adapterVersion: this._capabilities.adapterVersion,
        snapshotScope: this._capabilities.snapshotScope,
        originInstanceId: this.instanceId,
        payload,
      });
      this._history.push({ event: "snapshotted", state: this.state, epoch: this.epoch, bytes: payload.byteLength, scope: envelope.snapshotScope });
      return envelope;
    });
  }

  async restore(envelope) {
    return this._enqueue("restore", async () => {
      this._expect(["created", "paused", "stopped"], "restore");
      this._validateEnvelope(envelope);
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
      await this._adapter.restore(asBytes(envelope.payload, this.machineId), this._context, this.manifest);
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

  _validateEnvelope(envelope) {
    if (!envelope || envelope.schemaVersion !== 1) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INVALID", "snapshot schema 불일치");
    if (envelope.machineId !== this.machineId) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${this.machineId}: machineId 불일치`);
    if (envelope.adapterId !== this.adapterId) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${this.machineId}: adapterId 불일치`);
    if (this._capabilities && envelope.adapterVersion !== this._capabilities.adapterVersion) {
      throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${this.machineId}: adapterVersion 불일치`);
    }
    if (!SNAPSHOT_SCOPES.has(envelope.snapshotScope)) throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INVALID", "snapshotScope 불일치");
    asBytes(envelope.payload, this.machineId);
  }

  _expect(states, operation) {
    if (!states.includes(this.state)) {
      throw new WebMachineError("WEB_MACHINE_INVALID_STATE", `${this.machineId}: ${operation}은 ${this.state}에서 불가`, { expected: states, actual: this.state });
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
