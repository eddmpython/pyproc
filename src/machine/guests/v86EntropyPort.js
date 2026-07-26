// v86EntropyPort.js - Layer 5/guests: 공통 entropy bytes를 x86 RDRAND의 signed int32로 변환한다.
export class V86EntropyPort {
  constructor({ device }) {
    if (!device || device.kind !== "entropy" || device.mode !== "cryptographic-random" || typeof device.read !== "function") {
      throw new TypeError("cryptographic-random entropy device가 필요하다");
    }
    this._device = device;
    this._reads = 0;
    this._bytes = 0;
    this.getRandInt = () => this._readInt32();
  }

  inspect() {
    return {
      mode: "cryptographic-random",
      reads: this._reads,
      bytes: this._bytes,
    };
  }

  _readInt32() {
    const bytes = this._device.read(4);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 4) {
      throw new TypeError(`entropy device는 4 bytes를 반환해야 한다: ${bytes?.byteLength}`);
    }
    this._reads += 1;
    this._bytes += bytes.byteLength;
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
  }
}
