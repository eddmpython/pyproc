// memoryBlockDevice.js - write와 flush 완료 경계를 분리하는 block device 기준 구현.
import { WebMachineError } from "@web-machine/core";

function copyBytes(value, label) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new WebMachineError("WEB_MACHINE_BLOCK_INVALID", `${label}: bytes 필요`);
}

export class MemoryBlockDevice {
  constructor({ byteLength }) {
    if (!Number.isInteger(byteLength) || byteLength <= 0) throw new TypeError("byteLength는 양의 정수여야 한다");
    this.kind = "block";
    this.byteLength = byteLength;
    this._working = new Uint8Array(byteLength);
    this._durable = new Uint8Array(byteLength);
    this._dirty = false;
    this._writes = 0;
    this._flushes = 0;
  }

  async read(offset, length) {
    this._assertRange(offset, length);
    return this._working.slice(offset, offset + length);
  }

  async write(offset, value) {
    const bytes = copyBytes(value, "block write");
    this._assertRange(offset, bytes.byteLength);
    this._working.set(bytes, offset);
    this._dirty = true;
    this._writes += 1;
  }

  async flush() {
    this._durable.set(this._working);
    this._dirty = false;
    this._flushes += 1;
  }

  async snapshot() {
    if (this._dirty) throw new WebMachineError("WEB_MACHINE_BLOCK_UNFLUSHED", "block snapshot 전 flush 필요");
    return this._durable.slice();
  }

  async restore(value) {
    const bytes = copyBytes(value, "block restore");
    if (bytes.byteLength !== this.byteLength) {
      throw new WebMachineError("WEB_MACHINE_BLOCK_SIZE", `block 크기 불일치: ${bytes.byteLength} != ${this.byteLength}`);
    }
    this._working.set(bytes);
    this._durable.set(bytes);
    this._dirty = false;
  }

  crash() {
    this._working.set(this._durable);
    this._dirty = false;
  }

  inspect() {
    return {
      kind: this.kind,
      byteLength: this.byteLength,
      dirty: this._dirty,
      writes: this._writes,
      flushes: this._flushes,
    };
  }

  _assertRange(offset, length) {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > this.byteLength) {
      throw new WebMachineError("WEB_MACHINE_BLOCK_RANGE", `block range 불일치: ${offset}+${length}/${this.byteLength}`);
    }
  }
}
