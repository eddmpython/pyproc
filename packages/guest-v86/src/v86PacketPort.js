// v86PacketPort.js - v86 NIC bus와 공통 packet network port 사이의 유일한 변환 경계.
export class V86PacketPort {
  constructor({ device, endpointId, interfaceId = 0 }) {
    if (!device || device.kind !== "network" || device.mode !== "packet" || typeof device.connect !== "function") {
      throw new TypeError("packet network device가 필요하다");
    }
    if (!endpointId) throw new TypeError("endpointId가 필요하다");
    if (!Number.isInteger(interfaceId) || interfaceId < 0) throw new TypeError("interfaceId는 0 이상 정수여야 한다");
    this._device = device;
    this._endpointId = String(endpointId);
    this._interfaceId = interfaceId;
    this._emulator = null;
    this._port = null;
    this._pending = new Set();
    this._sentFrames = 0;
    this._receivedFrames = 0;
    this._sendErrors = 0;
    this._lastError = null;
    this._onTransmit = (frame) => this._transmit(frame);
    this._onReceive = (frame) => this._receive(frame);
  }

  attach(emulator) {
    if (!emulator?.bus || typeof emulator.add_listener !== "function" || typeof emulator.remove_listener !== "function") {
      throw new TypeError("v86 emulator packet bus가 필요하다");
    }
    if (this._emulator) throw new Error(`v86 packet port 이미 연결됨: ${this._endpointId}`);
    const port = this._device.connect({ endpointId: this._endpointId, receive: this._onReceive });
    try {
      this._emulator = emulator;
      this._port = port;
      emulator.add_listener(this._sendEvent(), this._onTransmit);
    } catch (error) {
      port.close();
      this._port = null;
      this._emulator = null;
      throw error;
    }
  }

  async drain() {
    while (this._pending.size) await Promise.allSettled([...this._pending]);
  }

  detach() {
    if (!this._emulator) return;
    this._emulator.remove_listener(this._sendEvent(), this._onTransmit);
    this._port?.close();
    this._port = null;
    this._emulator = null;
  }

  inspect() {
    return {
      mode: "packet",
      endpointId: this._endpointId,
      interfaceId: this._interfaceId,
      attached: !!this._emulator,
      sentFrames: this._sentFrames,
      receivedFrames: this._receivedFrames,
      pendingFrames: this._pending.size,
      sendErrors: this._sendErrors,
      lastError: this._lastError,
    };
  }

  _transmit(frame) {
    this._sentFrames += 1;
    let pending;
    try {
      pending = Promise.resolve(this._port.send(frame));
    } catch (error) {
      pending = Promise.reject(error);
    }
    this._pending.add(pending);
    pending.catch((error) => {
      this._sendErrors += 1;
      this._lastError = String(error?.message || error);
    }).finally(() => this._pending.delete(pending));
  }

  _receive(frame) {
    if (!this._emulator) return;
    this._receivedFrames += 1;
    this._emulator.bus.send(this._receiveEvent(), frame);
  }

  _sendEvent() {
    return `net${this._interfaceId}-send`;
  }

  _receiveEvent() {
    return `net${this._interfaceId}-receive`;
  }
}
