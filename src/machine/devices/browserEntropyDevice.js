// browserEntropyDevice.js - 주입된 CSPRNG를 bounded random byte 계약으로 좁힌다.
import { WebMachineError } from "../contracts/webMachineError.js";

export class BrowserEntropyDevice {
  constructor({ fillRandomValues, maxBytesPerRead = 65536 } = {}) {
    if (typeof fillRandomValues !== "function") throw new TypeError("fillRandomValues 함수가 필요하다");
    if (!Number.isInteger(maxBytesPerRead) || maxBytesPerRead <= 0 || maxBytesPerRead > 65536) {
      throw new TypeError("maxBytesPerRead는 1..65536 정수여야 한다");
    }
    this.kind = "entropy";
    this.mode = "cryptographic-random";
    this.maxBytesPerRead = maxBytesPerRead;
    this._fillRandomValues = fillRandomValues;
    this._reads = 0;
    this._bytes = 0;
    this._failures = 0;
    this._lastError = null;
  }

  read(length) {
    if (!Number.isInteger(length) || length <= 0 || length > this.maxBytesPerRead) {
      throw new WebMachineError("WEB_MACHINE_ENTROPY_SIZE", `entropy read 범위 초과: ${length}/${this.maxBytesPerRead}`);
    }
    const output = new Uint8Array(length);
    try {
      const result = this._fillRandomValues(output);
      if (result && typeof result.then === "function") throw new TypeError("entropy source는 동기 함수여야 한다");
    } catch (error) {
      this._failures += 1;
      this._lastError = String(error?.message || error);
      throw new WebMachineError("WEB_MACHINE_ENTROPY_SOURCE_FAILURE", `entropy source 실패: ${this._lastError}`);
    }
    this._reads += 1;
    this._bytes += output.byteLength;
    return new Uint8Array(output);
  }

  inspect() {
    return {
      kind: this.kind,
      mode: this.mode,
      reads: this._reads,
      bytes: this._bytes,
      failures: this._failures,
      lastError: this._lastError,
    };
  }
}
