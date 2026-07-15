// pyprocGuestAdapter.js - 공개 pyproc surface만 소비하는 guest adapter.
import { bootSession, openMachine } from "../../../../index.js";
import { readPyprocHomeVolume, writePyprocHomeVolume } from "./pyproc/pyprocHomeVolume.js";

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createPyprocGuestFactory({ blockDeviceName = null } = {}) {
  return () => new PyprocGuestAdapter({ blockDeviceName });
}

class PyprocGuestAdapter {
  constructor({ blockDeviceName }) {
    this._blockDeviceName = blockDeviceName ? String(blockDeviceName) : null;
    this.capabilities = {
      adapterVersion: this._blockDeviceName ? "pyproc-session-block-v1" : "pyproc-session-v1",
      snapshotScope: "portable",
      pauseMode: "cooperative",
      shutdownMode: "release",
      requiredDevices: [
        { name: "console", kind: "console" },
        ...(this._blockDeviceName ? [{ name: this._blockDeviceName, kind: "block" }] : []),
      ],
    };
    this._session = null;
    this._context = null;
  }

  async boot(context, manifest) {
    this._context = context;
    this._session = await bootSession(manifest.session || {});
    this._ensureHome();
    if (this._blockDeviceName) {
      await readPyprocHomeVolume({ device: this._blockDevice(), fs: this._session.rt.fs, allowEmpty: true });
    }
    consoleWrite(context, `pyproc:boot:${context.machineId}`);
  }

  async pause() {
    if (this._blockDeviceName) {
      await writePyprocHomeVolume({ device: this._blockDevice(), fs: this._session.rt.fs });
    }
    consoleWrite(this._context, "pyproc:pause");
  }

  async resume() {
    consoleWrite(this._context, "pyproc:resume");
  }

  async snapshot() {
    const image = await this._session.exportImage({ includeHome: !this._blockDeviceName });
    return new Uint8Array(await image.arrayBuffer());
  }

  async restore(payload, context) {
    this._context = context;
    this._session = await openMachine(new Blob([payload], { type: "application/x-pymachine" }), { trust: true });
    this._ensureHome();
    if (this._blockDeviceName) {
      await readPyprocHomeVolume({ device: this._blockDevice(), fs: this._session.rt.fs });
    }
    consoleWrite(context, `pyproc:restore:${context.machineId}`);
  }

  async shutdown() {
    if (this._session && this._blockDeviceName) {
      const device = this._blockDevice();
      await writePyprocHomeVolume({ device, fs: this._session.rt.fs });
      await device.flush();
    }
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

  _blockDevice() {
    const device = this._context?.devices?.[this._blockDeviceName];
    if (!device || device.kind !== "block") throw new Error(`pyproc adapter: block device 없음 ${this._blockDeviceName}`);
    return device;
  }
}
