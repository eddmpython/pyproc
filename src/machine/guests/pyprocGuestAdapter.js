// pyprocGuestAdapter.js - 주입된 공개 pyproc surface를 공통 guest 계약으로 변환한다.
import { throwIfOperationAborted } from "../contracts/operationControl.js";
import { readPyprocHomeVolume, writePyprocHomeVolume } from "./pyprocHomeVolume.js";

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createPyprocGuestFactory({ bootSession, openMachine, blockDeviceName = null } = {}) {
  if (typeof bootSession !== "function") throw new TypeError("bootSession 함수가 필요하다");
  if (typeof openMachine !== "function") throw new TypeError("openMachine 함수가 필요하다");
  return () => new PyprocGuestAdapter({ bootSession, openMachine, blockDeviceName });
}

class PyprocGuestAdapter {
  constructor({ bootSession, openMachine, blockDeviceName }) {
    this._bootSession = bootSession;
    this._openMachine = openMachine;
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

  async boot(context, manifest, control) {
    throwIfOperationAborted(control, `${context.machineId}: pyproc boot`);
    this._context = context;
    this._session = await this._bootSession(manifest.session || {});
    this._ensureHome();
    if (this._blockDeviceName) {
      await readPyprocHomeVolume({ device: this._blockDevice(), fs: this._session.rt.fs, allowEmpty: true });
    }
    throwIfOperationAborted(control, `${context.machineId}: pyproc boot`, { outcomeUnknown: true });
    consoleWrite(context, `pyproc:boot:${context.machineId}`);
  }

  async pause(control) {
    throwIfOperationAborted(control, "pyproc pause");
    if (this._blockDeviceName) {
      await writePyprocHomeVolume({ device: this._blockDevice(), fs: this._session.rt.fs });
    }
    consoleWrite(this._context, "pyproc:pause");
  }

  async resume(control) {
    throwIfOperationAborted(control, "pyproc resume");
    consoleWrite(this._context, "pyproc:resume");
  }

  async snapshot(control) {
    throwIfOperationAborted(control, "pyproc snapshot");
    const image = await this._session.exportImage({ includeHome: !this._blockDeviceName });
    throwIfOperationAborted(control, "pyproc snapshot", { outcomeUnknown: true });
    return new Uint8Array(await image.arrayBuffer());
  }

  async restore(payload, context, _manifest, control) {
    throwIfOperationAborted(control, `${context.machineId}: pyproc restore`);
    this._context = context;
    this._session = await this._openMachine(new Blob([payload], { type: "application/x-pymachine" }), { trust: true });
    this._ensureHome();
    if (this._blockDeviceName) {
      await readPyprocHomeVolume({ device: this._blockDevice(), fs: this._session.rt.fs });
    }
    throwIfOperationAborted(control, `${context.machineId}: pyproc restore`, { outcomeUnknown: true });
    consoleWrite(context, `pyproc:restore:${context.machineId}`);
  }

  async shutdown(control) {
    throwIfOperationAborted(control, "pyproc shutdown");
    if (this._session && this._blockDeviceName) {
      const device = this._blockDevice();
      await writePyprocHomeVolume({ device, fs: this._session.rt.fs });
      await device.flush();
    }
    consoleWrite(this._context, "pyproc:shutdown");
    this._session = null;
  }

  async request(message, control) {
    throwIfOperationAborted(control, "pyproc request");
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
