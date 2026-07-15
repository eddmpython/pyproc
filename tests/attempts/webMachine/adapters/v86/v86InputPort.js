// v86InputPort.js - 공통 PS/2 scan code batch를 v86 keyboard bus에 주입한다.
export class V86InputPort {
  constructor({ device, endpointId, codeDelayMs = 1 }) {
    if (!device || device.kind !== "input" || device.mode !== "ps2-scan-code" || typeof device.connect !== "function" || typeof device.drain !== "function") {
      throw new TypeError("ps2-scan-code input device가 필요하다");
    }
    if (!endpointId) throw new TypeError("endpointId가 필요하다");
    if (!Number.isFinite(codeDelayMs) || codeDelayMs < 0) throw new TypeError("codeDelayMs는 0 이상이어야 한다");
    this._device = device;
    this._endpointId = String(endpointId);
    this._codeDelayMs = codeDelayMs;
    this._emulator = null;
    this._port = null;
    this._receivedBatches = 0;
    this._receivedCodes = 0;
    this._onScanCodes = (codes) => this._receive(codes);
  }

  attach(emulator) {
    if (!emulator || typeof emulator.keyboard_send_scancodes !== "function") throw new TypeError("v86 keyboard API가 필요하다");
    if (this._emulator) return;
    const port = this._device.connect({ endpointId: this._endpointId, receive: this._onScanCodes });
    this._emulator = emulator;
    this._port = port;
  }

  async drain() {
    await this._device.drain();
  }

  detach() {
    this._port?.close();
    this._port = null;
    this._emulator = null;
  }

  inspect() {
    return {
      mode: "ps2-scan-code",
      endpointId: this._endpointId,
      attached: !!this._emulator,
      receivedBatches: this._receivedBatches,
      receivedCodes: this._receivedCodes,
    };
  }

  async _receive(codes) {
    if (!this._emulator) throw new Error(`v86 input port 분리됨: ${this._endpointId}`);
    this._receivedBatches += 1;
    this._receivedCodes += codes.byteLength;
    await this._emulator.keyboard_send_scancodes(codes, this._codeDelayMs);
  }
}
