// machineHandle.js - machine 하나의 lifecycle, snapshot, ownership 상태 머신.
import { WebMachineError } from "../contracts/webMachineError.js";
import { createSnapshotEnvelope, validateSnapshotEnvelope } from "../image/snapshotEnvelope.js";
import { CommandQueue } from "./commandQueue.js";

function copyRecord(value) {
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

export class MachineHandle {
  constructor(host, { machineId, adapterId, manifest, permissions, instanceId }) {
    this._host = host;
    this.machineId = machineId;
    this.adapterId = adapterId;
    this.manifest = copyRecord(manifest);
    this.permissions = { devices: [...(permissions?.devices || [])] };
    this.instanceId = instanceId;
    this.state = "created";
    this.ownerId = null;
    this.epoch = 1;
    this._adapter = null;
    this._capabilities = null;
    this._context = null;
    this._history = [{ event: "created", state: "created", epoch: this.epoch }];
    this._commands = new CommandQueue({
      machineId,
      instanceId,
      readFence: () => ({ ownerId: this.ownerId, epoch: this.epoch }),
    });
  }

  get history() {
    return this._history.map((entry) => ({ ...entry }));
  }

  get capabilities() {
    return this._capabilities
      ? { ...this._capabilities, requiredDevices: this._capabilities.requiredDevices.map(copyRecord) }
      : null;
  }

  adoptOwnership({ ownerId, epoch }) {
    const nextOwnerId = String(ownerId || "");
    if (!nextOwnerId) throw new TypeError("ownerId가 필요하다");
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError("ownership epoch는 1 이상 정수여야 한다");
    if (epoch < this.epoch) {
      throw new WebMachineError("WEB_MACHINE_OWNERSHIP_STALE", `${this.machineId}: ownership epoch ${epoch} < ${this.epoch}`);
    }
    if (epoch === this.epoch && this.ownerId && this.ownerId !== nextOwnerId) {
      throw new WebMachineError(
        "WEB_MACHINE_OWNERSHIP_CONFLICT",
        `${this.machineId}: epoch ${epoch} owner ${this.ownerId} != ${nextOwnerId}`,
      );
    }
    this.ownerId = nextOwnerId;
    this.epoch = epoch;
    this._history.push({ event: "ownershipAdopted", state: this.state, ownerId: this.ownerId, epoch: this.epoch });
    return Object.freeze({ ownerId: this.ownerId, epoch: this.epoch });
  }

  invalidateOwnership(reason = "owner lost") {
    this.ownerId = null;
    this.epoch += 1;
    this._history.push({ event: "ownershipInvalidated", state: this.state, epoch: this.epoch, reason: String(reason) });
    return this.epoch;
  }

  async boot(control) {
    return this._enqueue("boot", async () => {
      this._expect(["created", "stopped"], "boot");
      const created = this._host._createAdapter(this.adapterId);
      const context = this._host._openContext(this, created.capabilities);
      this._adapter = created.adapter;
      this._capabilities = created.capabilities;
      this._context = context;
      try {
        await this._adapter.boot(context, this.manifest, control);
        this._setState("running", "booted");
        return this.inspectNow();
      } catch (error) {
        this._setState("failed", "bootFailed");
        throw error;
      }
    }, { control });
  }

  async pause(control) {
    return this._enqueue("pause", async () => {
      this._expect(["running"], "pause");
      await this._adapter.pause(control);
      this._setState("paused", "paused");
      return this.inspectNow();
    }, { control });
  }

  async resume(control) {
    return this._enqueue("resume", async () => {
      this._expect(["paused"], "resume");
      await this._adapter.resume(control);
      this._setState("running", "resumed");
      return this.inspectNow();
    }, { control });
  }

  async request(message, control) {
    return this._enqueue("request", async () => {
      this._expect(["running"], "request");
      return this._adapter.request(message, control);
    }, { control });
  }

  async snapshot(control) {
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
        payload: await this._adapter.snapshot(control),
      });
      this._history.push({
        event: "snapshotted",
        state: this.state,
        epoch: this.epoch,
        bytes: envelope.payload.byteLength,
        scope: envelope.snapshotScope,
      });
      return envelope;
    }, { control });
  }

  async restore(envelope, control) {
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
        const created = this._host._createAdapter(this.adapterId);
        const context = this._host._openContext(this, created.capabilities);
        if (created.capabilities.adapterVersion !== envelope.adapterVersion || created.capabilities.snapshotScope !== envelope.snapshotScope) {
          throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${this.machineId}: adapter capability 불일치`);
        }
        this._adapter = created.adapter;
        this._capabilities = created.capabilities;
        this._context = context;
      } else if (envelope.snapshotScope === "session" && envelope.originInstanceId !== this.instanceId) {
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_SCOPE", `${this.machineId}: 다른 session snapshot`);
      }
      await this._adapter.restore(payload, this._context, this.manifest, control);
      this._setState("paused", "restored");
      return this.inspectNow();
    }, { control });
  }

  async shutdown(control) {
    return this._enqueue("shutdown", async () => {
      this._expect(["created", "running", "paused", "failed"], "shutdown");
      if (this._adapter) await this._adapter.shutdown(control);
      this._adapter = null;
      this._context = null;
      this._setState("stopped", "shutdown");
      return this.inspectNow();
    }, { fenced: false, control });
  }

  async inspect() {
    return this._enqueue("inspect", async () => this.inspectNow(), { fenced: false });
  }

  inspectNow() {
    return {
      machineId: this.machineId,
      adapterId: this.adapterId,
      instanceId: this.instanceId,
      ownerId: this.ownerId,
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

  _enqueue(label, operation, options) {
    return this._commands.enqueue(label, operation, options);
  }
}
