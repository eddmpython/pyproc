// machineHandle.js - Layer 5/pure: machine 하나의 lifecycle, snapshot, ownership 상태 머신.
import { WebMachineError } from "../contracts/webMachineError.js";
import { createSnapshotEnvelope, validateSnapshotEnvelope } from "../contracts/snapshotEnvelope.js";
import { CommandQueue } from "./commandQueue.js";

function copyRecord(value) {
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

const HISTORY_MAX = 128; // 상태 전이 이력의 상한. 그 위는 오래된 것부터 자르고 수를 센다.

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
    this._historyTruncated = 0;
    this._commands = new CommandQueue({
      machineId,
      instanceId,
      readFence: () => ({ ownerId: this.ownerId, epoch: this.epoch }),
    });
  }

  // 이력은 상한을 갖는다. pause/save/resume을 반복하는 내구 소비자에서 배열이 무한히 자라고,
  // inspect를 폴링하는 UI가 있으면 매 호출이 전체 복사가 된다. 자르는 쪽은 오래된 것이고
  // created 엔트리는 남긴다(그것이 없으면 이력이 어디서 시작했는지 알 수 없다).
  _note(entry) {
    this._history.push(entry);
    if (this._history.length <= HISTORY_MAX) return;
    const drop = this._history.length - HISTORY_MAX;
    this._history.splice(1, drop);
    this._historyTruncated += drop;
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
    if (!nextOwnerId) throw new TypeError("an ownerId is required");
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError("the ownership epoch must be an integer >= 1");
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
    this._note({ event: "ownershipAdopted", state: this.state, ownerId: this.ownerId, epoch: this.epoch });
    return Object.freeze({ ownerId: this.ownerId, epoch: this.epoch });
  }

  invalidateOwnership(reason = "owner lost") {
    this.ownerId = null;
    this.epoch += 1;
    this._note({ event: "ownershipInvalidated", state: this.state, epoch: this.epoch, reason: String(reason) });
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
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_UNSUPPORTED", `${this.machineId}: snapshots are not supported`);
      }
      const envelope = createSnapshotEnvelope({
        machineId: this.machineId,
        adapterId: this.adapterId,
        capabilities: this._capabilities,
        instanceId: this.instanceId,
        payload: await this._adapter.snapshot(control),
      });
      this._note({
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
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_SCOPE", `${this.machineId}: a ${envelope.snapshotScope} snapshot cannot be cold-restored`);
      }
      if (cold) {
        const created = this._host._createAdapter(this.adapterId);
        const context = this._host._openContext(this, created.capabilities);
        if (created.capabilities.adapterVersion !== envelope.adapterVersion || created.capabilities.snapshotScope !== envelope.snapshotScope) {
          throw new WebMachineError("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", `${this.machineId}: adapter capability mismatch`);
        }
        this._adapter = created.adapter;
        this._capabilities = created.capabilities;
        this._context = context;
      } else if (envelope.snapshotScope === "session" && envelope.originInstanceId !== this.instanceId) {
        throw new WebMachineError("WEB_MACHINE_SNAPSHOT_SCOPE", `${this.machineId}: snapshot belongs to a different session`);
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

  // 이 머신이 그 장치를 요구하는가. detachDevice가 사용 중 판정에 쓴다.
  usesDevice(name) {
    return (this.permissions?.devices || []).includes(name);
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
      throw new WebMachineError("WEB_MACHINE_INVALID_STATE", `${this.machineId}: ${operation} is not allowed while ${this.state}`, {
        expected: states,
        actual: this.state,
      });
    }
  }

  _setState(state, event) {
    this.state = state;
    this._note({ event, state, epoch: this.epoch });
  }

  _enqueue(label, operation, options) {
    return this._commands.enqueue(label, operation, options);
  }
}
