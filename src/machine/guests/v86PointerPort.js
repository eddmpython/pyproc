// v86PointerPort.js - 공통 relative pointer event를 v86 PS/2 mouse bus에 주입한다.
import { WebMachineError } from "../contracts/webMachineError.js";
export class V86PointerPort {
  constructor({ device, endpointId }) {
    if (!device || device.kind !== "input" || device.mode !== "relative-pointer" || typeof device.connect !== "function" || typeof device.drain !== "function") {
      throw new TypeError("relative-pointer input device가 필요하다");
    }
    if (!endpointId) throw new TypeError("endpointId가 필요하다");
    this._device = device;
    this._endpointId = String(endpointId);
    this._emulator = null;
    this._port = null;
    this._guestEnabled = false;
    this._receivedEvents = 0;
    this._receivedMoves = 0;
    this._receivedButtons = 0;
    this._receivedWheels = 0;
    this._onPointer = (event) => this._receive(event);
    this._onGuestEnabled = (enabled) => { this._guestEnabled = !!enabled; };
  }

  attach(emulator) {
    if (!emulator?.bus || typeof emulator.add_listener !== "function" || typeof emulator.remove_listener !== "function") {
      throw new TypeError("v86 mouse bus가 필요하다");
    }
    if (this._emulator) return;
    const port = this._device.connect({ endpointId: this._endpointId, receive: this._onPointer });
    try {
      this._emulator = emulator;
      this._port = port;
      emulator.add_listener("mouse-enable", this._onGuestEnabled);
    } catch (error) {
      port.close();
      this._port = null;
      this._emulator = null;
      throw error;
    }
  }

  async drain() {
    await this._device.drain();
  }

  detach() {
    if (this._emulator) this._emulator.remove_listener("mouse-enable", this._onGuestEnabled);
    this._port?.close();
    this._port = null;
    this._emulator = null;
    this._guestEnabled = false;
  }

  inspect() {
    return {
      mode: "relative-pointer",
      endpointId: this._endpointId,
      attached: !!this._emulator,
      guestEnabled: this._guestEnabled,
      receivedEvents: this._receivedEvents,
      receivedMoves: this._receivedMoves,
      receivedButtons: this._receivedButtons,
      receivedWheels: this._receivedWheels,
    };
  }

  _receive(event) {
    if (!this._emulator) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `v86 pointer port 분리됨: ${this._endpointId}`);
    if (event.type === "move") {
      this._emulator.bus.send("mouse-delta", [event.deltaX, -event.deltaY]);
      this._receivedMoves += 1;
    } else if (event.type === "buttons") {
      this._emulator.bus.send("mouse-click", [event.left, event.middle, event.right]);
      this._receivedButtons += 1;
    } else if (event.type === "wheel") {
      this._emulator.bus.send("mouse-wheel", [-event.deltaY, -event.deltaX]);
      this._receivedWheels += 1;
    } else {
      throw new TypeError(`pointer event 미지원: ${event.type}`);
    }
    this._receivedEvents += 1;
  }
}
