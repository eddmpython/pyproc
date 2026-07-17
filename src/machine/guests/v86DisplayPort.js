// v86DisplayPort.js - v86 VGA text bus를 공통 text-cells display port로 변환한다.
import { WebMachineError } from "../contracts/webMachineError.js";
export class V86DisplayPort {
  constructor({ device, endpointId }) {
    if (!device || device.kind !== "display" || device.mode !== "text-cells" || typeof device.connect !== "function") {
      throw new TypeError("text-cells display device가 필요하다");
    }
    if (!endpointId) throw new TypeError("endpointId가 필요하다");
    this._device = device;
    this._endpointId = String(endpointId);
    this._emulator = null;
    this._port = null;
    this._presentPromise = null;
    this._cellWrites = 0;
    this._presentations = 0;
    this._unsupportedModes = 0;
    this._errors = 0;
    this._lastError = null;
    this._onSize = (size) => this._acceptSize(size);
    this._onCell = (cell) => this._acceptCell(cell);
  }

  attach(emulator) {
    if (!emulator || typeof emulator.add_listener !== "function" || typeof emulator.remove_listener !== "function") {
      throw new TypeError("v86 emulator display bus가 필요하다");
    }
    if (this._emulator) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `v86 display port 이미 연결됨: ${this._endpointId}`);
    const port = this._device.connect({ endpointId: this._endpointId });
    try {
      this._emulator = emulator;
      this._port = port;
      port.configure({ columns: 80, rows: 25 });
      emulator.add_listener("screen-set-size", this._onSize);
      emulator.add_listener("screen-put-char", this._onCell);
      this._schedulePresent();
    } catch (error) {
      port.close();
      this._port = null;
      this._emulator = null;
      throw error;
    }
  }

  async drain() {
    while (this._presentPromise) await this._presentPromise;
  }

  detach() {
    if (!this._emulator) return;
    this._emulator.remove_listener("screen-set-size", this._onSize);
    this._emulator.remove_listener("screen-put-char", this._onCell);
    this._port?.close();
    this._port = null;
    this._emulator = null;
  }

  inspect() {
    return {
      mode: "text-cells",
      endpointId: this._endpointId,
      attached: !!this._emulator,
      cellWrites: this._cellWrites,
      presentations: this._presentations,
      unsupportedModes: this._unsupportedModes,
      errors: this._errors,
      lastError: this._lastError,
    };
  }

  _acceptSize(size) {
    try {
      const [columns, rows, bitsPerPixel] = size || [];
      if (bitsPerPixel !== 0) {
        this._unsupportedModes += 1;
        return;
      }
      this._port.configure({ columns, rows });
      this._schedulePresent();
    } catch (error) {
      this._recordError(error);
    }
  }

  _acceptCell(cell) {
    try {
      const [row, column, glyph] = cell || [];
      this._port.writeCell({ row, column, glyph });
      this._cellWrites += 1;
      this._schedulePresent();
    } catch (error) {
      this._recordError(error);
    }
  }

  _schedulePresent() {
    if (this._presentPromise) return;
    this._presentPromise = Promise.resolve().then(() => {
      if (!this._port) return;
      this._port.present();
      this._presentations += 1;
    }).catch((error) => this._recordError(error)).finally(() => {
      this._presentPromise = null;
    });
  }

  _recordError(error) {
    this._errors += 1;
    this._lastError = String(error?.message || error);
  }
}
