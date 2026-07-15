// pyprocGuestAdapter.js - 공개 pyproc surface만 소비하는 guest adapter.
import { bootSession, openMachine } from "../../../../index.js";

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createPyprocGuestFactory() {
  return () => new PyprocGuestAdapter();
}

class PyprocGuestAdapter {
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
    this._ensureHome();
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
    this._ensureHome();
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

  _ensureHome() {
    this._session.rt.run("from pathlib import Path\nPath('/home/web').mkdir(parents=True, exist_ok=True)");
  }
}
