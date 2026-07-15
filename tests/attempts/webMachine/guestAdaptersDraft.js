// guestAdaptersDraft.js - attempts 전용 실제 엔진 adapter.
// 공개 root export만 소비하고 host에는 engine 내부를 노출하지 않는다.
import { bootSession, openMachine, bootWasi } from "../../../index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createPyprocGuestFactory() {
  return () => new PyprocGuestAdapterDraft();
}

export function createWasiGuestFactory() {
  return () => new WasiGuestAdapterDraft();
}

class PyprocGuestAdapterDraft {
  constructor() {
    this.capabilities = {
      adapterVersion: "pyproc-session-v1",
      snapshotScope: "portable",
      pauseMode: "cooperative",
      shutdownMode: "release",
      requiredDevices: [{ name: "console", kind: "console" }],
    };
    this._session = null;
    this._context = null;
  }

  async boot(context, manifest) {
    this._context = context;
    this._session = await bootSession(manifest.session || {});
    this._session.rt.run("from pathlib import Path\nPath('/home/web').mkdir(parents=True, exist_ok=True)");
    consoleWrite(context, `pyproc:boot:${context.machineId}`);
  }

  async pause() {
    consoleWrite(this._context, "pyproc:pause");
  }

  async resume() {
    consoleWrite(this._context, "pyproc:resume");
  }

  async snapshot() {
    const image = await this._session.exportImage({ includeHome: true });
    return new Uint8Array(await image.arrayBuffer());
  }

  async restore(payload, context) {
    this._context = context;
    this._session = await openMachine(new Blob([payload], { type: "application/x-pymachine" }), { trust: true });
    consoleWrite(context, `pyproc:restore:${context.machineId}`);
  }

  async shutdown() {
    consoleWrite(this._context, "pyproc:shutdown");
    this._session = null;
  }

  async request(message) {
    if (!this._session) throw new Error("pyproc adapter: session 없음");
    if (message.type !== "run") throw new Error(`pyproc adapter request 미지원: ${message.type}`);
    return this._session.rt.run(String(message.code || ""));
  }

  inspect() {
    return {
      engine: "pyodide",
      ready: !!this._session,
      heapBytes: this._session ? this._session.rt.memory.byteLength() : 0,
      snapshotScope: this.capabilities.snapshotScope,
      shutdownMode: this.capabilities.shutdownMode,
    };
  }
}

class WasiGuestAdapterDraft {
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
