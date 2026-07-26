// v86BlockBuffer.js - Layer 5/guests: callback block buffer를 공통 async block device로 변환한다.
import { WebMachineError } from "../contracts/webMachineError.js";
export class V86BlockBuffer {
  constructor(device) {
    if (!device || device.kind !== "block" || typeof device.read !== "function" || typeof device.write !== "function") {
      throw new TypeError("v86 block buffer: a block device is required");
    }
    if (!Number.isInteger(device.byteLength) || device.byteLength <= 0 || device.byteLength % 512 !== 0) {
      throw new TypeError("v86 block buffer: byteLength must be a multiple of 512");
    }
    this.byteLength = device.byteLength;
    this.onload = null;
    this.onprogress = null;
    this._device = device;
    this._pending = new Set();
    this._failure = null;
    this._reads = 0;
    this._writes = 0;
  }

  load() {
    queueMicrotask(() => this.onload?.(Object.create(null)));
  }

  get(offset, length, callback) {
    this._track(this._device.read(offset, length).then((bytes) => {
      this._reads += 1;
      callback(bytes);
    }));
  }

  set(offset, bytes, callback) {
    this._track(this._device.write(offset, bytes).then(() => {
      this._writes += 1;
      callback?.();
    }));
  }

  get_buffer(callback) {
    callback?.();
  }

  get_state() {
    return [1];
  }

  set_state(state) {
    if (!Array.isArray(state) || state[0] !== 1) throw new WebMachineError("WEB_MACHINE_VOLUME_INVALID", "v86 block buffer: state version mismatch");
  }

  async drain() {
    while (this._pending.size) await Promise.all([...this._pending]);
    if (this._failure) throw this._failure;
  }

  inspect() {
    return { byteLength: this.byteLength, reads: this._reads, writes: this._writes, pending: this._pending.size };
  }

  _track(promise) {
    this._pending.add(promise);
    promise.catch((error) => { this._failure ||= error; }).finally(() => this._pending.delete(promise));
  }
}
