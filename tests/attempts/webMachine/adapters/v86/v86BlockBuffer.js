// v86BlockBuffer.js - callback block buffer를 공통 async block device로 변환한다.
export class V86BlockBuffer {
  constructor(device) {
    if (!device || device.kind !== "block" || typeof device.read !== "function" || typeof device.write !== "function") {
      throw new TypeError("v86 block buffer: block device 필요");
    }
    if (!Number.isInteger(device.byteLength) || device.byteLength <= 0 || device.byteLength % 512 !== 0) {
      throw new TypeError("v86 block buffer: byteLength는 512 배수여야 한다");
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
    if (!Array.isArray(state) || state[0] !== 1) throw new Error("v86 block buffer: state version 불일치");
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
