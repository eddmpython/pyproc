// v86SerialPort.js - serial output buffer, line projection, pattern waiter와 종료 경계.
import { operationAbortError } from "@web-machine/core";

export class V86SerialPort {
  constructor({ writeLine = () => {} } = {}) {
    if (typeof writeLine !== "function") throw new TypeError("writeLine 함수가 필요하다");
    this._writeLine = writeLine;
    this._serial = "";
    this._line = "";
    this._waiters = new Set();
  }

  get length() {
    return this._serial.length;
  }

  reset() {
    this.rejectAll(new Error("v86 serial reset"));
    this._serial = "";
    this._line = "";
  }

  acceptByte(byte) {
    const character = String.fromCharCode(byte);
    if (character === "\r") return;
    this._serial += character;
    if (character === "\n") {
      if (this._line) this._writeLine(this._line);
      this._line = "";
    } else {
      this._line += character;
    }
    for (const waiter of [...this._waiters]) {
      const matchAt = this._serial.indexOf(waiter.pattern, waiter.from);
      if (matchAt >= 0) waiter.resolve(matchAt + waiter.pattern.length);
    }
  }

  slice(from, to) {
    return this._serial.slice(from, to);
  }

  waitFor(pattern, from, timeoutMs, control) {
    const current = this._serial.indexOf(pattern, from);
    if (current >= 0) return Promise.resolve(current + pattern.length);
    return new Promise((resolve, reject) => {
      const waiter = {
        pattern,
        from,
        resolve: (value) => {
          clearTimeout(waiter.timer);
          control?.signal?.removeEventListener("abort", waiter.abort);
          this._waiters.delete(waiter);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          control?.signal?.removeEventListener("abort", waiter.abort);
          this._waiters.delete(waiter);
          reject(error);
        },
        abort: () => waiter.reject(operationAbortError(control, `v86 serial wait: ${pattern}`, { outcomeUnknown: true })),
        timer: null,
      };
      waiter.timer = setTimeout(() => waiter.reject(new Error(`x86 serial wait timeout: ${pattern}`)), timeoutMs);
      this._waiters.add(waiter);
      control?.signal?.addEventListener("abort", waiter.abort, { once: true });
      if (control?.signal?.aborted) waiter.abort();
    });
  }

  rejectAll(error) {
    for (const waiter of [...this._waiters]) waiter.reject(error);
  }

  inspect() {
    return Object.freeze({ serialChars: this._serial.length, pendingWaiters: this._waiters.size });
  }
}
