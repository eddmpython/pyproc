// fakeGuestAdapter.js - 같은 contract suite를 여러 adapter에 재사용하기 위한 deterministic guest.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createFakeGuestFactory({
  adapterVersion = "1",
  snapshotScope = "portable",
  requiredDevices = [{ name: "console", kind: "console" }],
  metrics = {},
} = {}) {
  metrics.boots ||= 0;
  metrics.requests ||= 0;
  metrics.executions ||= 0;
  metrics.restores ||= 0;
  metrics.shutdowns ||= 0;
  return () => new FakeGuestAdapter({ adapterVersion, snapshotScope, requiredDevices, metrics });
}
class FakeGuestAdapter {
  constructor({ adapterVersion, snapshotScope, requiredDevices, metrics }) {
    this.capabilities = {
      adapterVersion,
      snapshotScope,
      pauseMode: "strong",
      shutdownMode: "terminate",
      requiredDevices,
    };
    this._metrics = metrics;
    this._value = 0;
    this._active = false;
    this._paused = false;
    this._context = null;
  }

  async boot(context, manifest) {
    this._metrics.boots += 1;
    this._value = Number(manifest.initialValue || 0);
    this._active = true;
    this._paused = false;
    this._context = context;
    context.devices.console?.write?.(`boot:${context.machineId}`);
  }

  async pause() {
    this._paused = true;
  }

  async resume() {
    this._paused = false;
  }

  async snapshot() {
    return encoder.encode(JSON.stringify({ value: this._value }));
  }

  async restore(payload, context) {
    this._value = JSON.parse(decoder.decode(payload)).value;
    this._active = true;
    this._paused = true;
    this._context = context;
    this._metrics.restores += 1;
  }

  async shutdown() {
    this._active = false;
    this._metrics.shutdowns += 1;
  }

  async request(message) {
    this._metrics.requests += 1;
    if (message.type === "get") return this._value;
    if (message.type === "increment") {
      this._metrics.executions += 1;
      this._value += Number(message.by || 1);
      return this._value;
    }
    if (message.type === "slowIncrement") {
      this._metrics.executions += 1;
      this._value += Number(message.by || 1);
      if (typeof message.started === "function") message.started();
      await message.wait;
      return this._value;
    }
    if (message.type === "blockWrite") {
      const device = this._context?.devices?.[String(message.device || "block")];
      if (!device || typeof device.write !== "function") throw new Error("fake guest block device 없음");
      await device.write(Number(message.offset || 0), new Uint8Array(message.bytes || []));
      return true;
    }
    if (message.type === "blockRead") {
      const device = this._context?.devices?.[String(message.device || "block")];
      if (!device || typeof device.read !== "function") throw new Error("fake guest block device 없음");
      return [...await device.read(Number(message.offset || 0), Number(message.length || 0))];
    }
    throw new Error(`fake guest request 미지원: ${message.type}`);
  }

  inspect() {
    return {
      value: this._value,
      active: this._active,
      paused: this._paused,
      metrics: { ...this._metrics },
    };
  }
}
