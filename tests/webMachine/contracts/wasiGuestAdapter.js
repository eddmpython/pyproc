// wasiGuestAdapter.js - 공개 WASI surface만 소비하는 guest adapter.
import { bootWasi } from "../../../index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createWasiGuestFactory() {
  return () => new WasiGuestAdapter();
}

class WasiGuestAdapter {
  constructor() {
    this.capabilities = {
      adapterVersion: "wasi-session-v1",
      snapshotScope: "session",
      pauseMode: "cooperative",
      shutdownMode: "terminate",
      requiredDevices: [{ name: "console", kind: "console" }],
    };
    this._session = null;
    this._context = null;
  }

  async boot(context, manifest) {
    this._context = context;
    this._session = await bootWasi(manifest.wasi || {});
    consoleWrite(context, `wasi:boot:${context.machineId}`);
  }

  async pause() {
    consoleWrite(this._context, "wasi:pause");
  }

  async resume() {
    consoleWrite(this._context, "wasi:resume");
  }

  async snapshot() {
    const checkpoint = await this._session.checkpoint();
    return encoder.encode(JSON.stringify(checkpoint));
  }

  async restore(payload) {
    const checkpoint = JSON.parse(decoder.decode(payload));
    await this._session.timeTravel(checkpoint.idx);
    consoleWrite(this._context, `wasi:restore:${checkpoint.idx}`);
  }

  async shutdown() {
    consoleWrite(this._context, "wasi:shutdown");
    this._session?.terminate();
    this._session = null;
  }

  async request(message) {
    if (!this._session) throw new Error("WASI adapter: session 없음");
    if (message.type !== "run") throw new Error(`WASI adapter request 미지원: ${message.type}`);
    return this._session.run(String(message.code || ""));
  }

  inspect() {
    return {
      engine: "wasi",
      ready: !!this._session,
      snapshotScope: this.capabilities.snapshotScope,
      shutdownMode: this.capabilities.shutdownMode,
    };
  }
}
