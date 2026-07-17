// v86FramebufferPort.js - v86 canvas dirty region을 공통 RGBA display port로 변환한다.
import { WebMachineError } from "../contracts/webMachineError.js";
export class V86FramebufferPort {
  constructor({ device, source, endpointId }) {
    if (!device || device.kind !== "display" || device.mode !== "rgba-frame" || typeof device.connect !== "function") {
      throw new TypeError("rgba-frame display device가 필요하다");
    }
    if (!source || typeof source.subscribe !== "function") throw new TypeError("RGBA frame source가 필요하다");
    if (!endpointId) throw new TypeError("endpointId가 필요하다");
    this._device = device;
    this._source = source;
    this._endpointId = String(endpointId);
    this._emulator = null;
    this._port = null;
    this._unsubscribe = null;
    this._presentPromise = null;
    this._active = false;
    this._width = 0;
    this._height = 0;
    this._bitsPerPixel = 0;
    this._regionWrites = 0;
    this._presentations = 0;
    this._inactiveUpdates = 0;
    this._errors = 0;
    this._lastError = null;
    this._frameWaiters = new Set();
    this._onSize = (size) => this._acceptSize(size);
    this._onRegion = (region) => this._acceptRegion(region);
  }

  attach(emulator) {
    if (!emulator || typeof emulator.add_listener !== "function" || typeof emulator.remove_listener !== "function") {
      throw new TypeError("v86 emulator display bus가 필요하다");
    }
    if (this._emulator) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `v86 framebuffer port 이미 연결됨: ${this._endpointId}`);
    const port = this._device.connect({ endpointId: this._endpointId });
    try {
      this._emulator = emulator;
      this._port = port;
      this._unsubscribe = this._source.subscribe(this._onRegion);
      emulator.add_listener("screen-set-size", this._onSize);
    } catch (error) {
      this._unsubscribe?.();
      port.close();
      this._unsubscribe = null;
      this._port = null;
      this._emulator = null;
      throw error;
    }
  }

  waitForFrame(timeoutMs) {
    if (this._presentations > 0) return Promise.resolve(this._presentations);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("frame timeout은 양수여야 한다");
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value) => {
          clearTimeout(waiter.timer);
          this._frameWaiters.delete(waiter);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          this._frameWaiters.delete(waiter);
          reject(error);
        },
        timer: null,
      };
      waiter.timer = setTimeout(() => waiter.reject(new WebMachineError("WEB_MACHINE_GUEST_TIMEOUT", `v86 framebuffer timeout: ${timeoutMs}ms`)), timeoutMs);
      this._frameWaiters.add(waiter);
    });
  }

  async drain() {
    while (this._presentPromise) await this._presentPromise;
  }

  detach() {
    if (!this._emulator) return;
    this._emulator.remove_listener("screen-set-size", this._onSize);
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._port?.close();
    this._port = null;
    this._emulator = null;
    this._active = false;
    const error = new WebMachineError("WEB_MACHINE_GUEST_ABORTED", `v86 framebuffer port 분리됨: ${this._endpointId}`);
    for (const waiter of [...this._frameWaiters]) waiter.reject(error);
  }

  inspect() {
    return {
      mode: "rgba-frame",
      pixelFormat: "rgba8888",
      endpointId: this._endpointId,
      attached: !!this._emulator,
      active: this._active,
      width: this._width,
      height: this._height,
      bitsPerPixel: this._bitsPerPixel,
      regionWrites: this._regionWrites,
      presentations: this._presentations,
      inactiveUpdates: this._inactiveUpdates,
      errors: this._errors,
      lastError: this._lastError,
    };
  }

  _acceptSize(size) {
    try {
      const [width, height, bitsPerPixel] = size || [];
      this._bitsPerPixel = Number(bitsPerPixel) || 0;
      this._active = this._bitsPerPixel > 0;
      if (!this._active) return;
      this._port.configure({ width, height });
      this._width = width;
      this._height = height;
    } catch (error) {
      this._recordError(error);
    }
  }

  _acceptRegion(region) {
    try {
      if (!this._active || region.canvasWidth !== this._width || region.canvasHeight !== this._height) {
        this._inactiveUpdates += 1;
        return;
      }
      this._port.writeRegion(region);
      this._regionWrites += 1;
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
      for (const waiter of [...this._frameWaiters]) waiter.resolve(this._presentations);
    }).catch((error) => this._recordError(error)).finally(() => {
      this._presentPromise = null;
    });
  }

  _recordError(error) {
    this._errors += 1;
    this._lastError = String(error?.message || error);
  }
}
