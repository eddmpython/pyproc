// memoryRelativePointerDevice.js - focus된 endpoint에 bounded relative pointer event를 전달한다.
import { WebMachineError } from "../../host/webMachineError.js";

function finiteDelta(value, maxDelta, label) {
  if (!Number.isFinite(value) || Math.abs(value) > maxDelta) {
    throw new WebMachineError("WEB_MACHINE_POINTER_DELTA", `${label} 범위 초과: ${value}/${maxDelta}`);
  }
  return value;
}

export class MemoryRelativePointerDevice {
  constructor({ maxDelta = 32767, maxQueuedEvents = 128 } = {}) {
    if (!Number.isFinite(maxDelta) || maxDelta <= 0) throw new TypeError("maxDelta는 양수여야 한다");
    if (!Number.isInteger(maxQueuedEvents) || maxQueuedEvents <= 0) throw new TypeError("maxQueuedEvents는 양의 정수여야 한다");
    this.kind = "input";
    this.mode = "relative-pointer";
    this.maxDelta = maxDelta;
    this.maxQueuedEvents = maxQueuedEvents;
    this._endpoint = null;
    this._sentEvents = 0;
    this._sentMoves = 0;
    this._sentButtons = 0;
    this._sentWheels = 0;
    this._deliveryErrors = 0;
    this._drainWaiters = new Set();
  }

  connect({ endpointId, receive }) {
    const id = String(endpointId || "");
    if (!id) throw new TypeError("endpointId가 필요하다");
    if (typeof receive !== "function") throw new TypeError("receive 함수가 필요하다");
    if (this._endpoint) {
      const code = this._endpoint.id === id ? "WEB_MACHINE_INPUT_ENDPOINT_DUPLICATE" : "WEB_MACHINE_INPUT_BUSY";
      throw new WebMachineError(code, `pointer 연결 중: ${this._endpoint.id}`);
    }
    const endpoint = { id, receive, queue: [], pumping: false, active: false, closed: false };
    this._endpoint = endpoint;
    return Object.freeze({ endpointId: id, close: () => this._disconnect(endpoint) });
  }

  move({ deltaX, deltaY } = {}) {
    const event = Object.freeze({
      type: "move",
      deltaX: finiteDelta(deltaX, this.maxDelta, "pointer deltaX"),
      deltaY: finiteDelta(deltaY, this.maxDelta, "pointer deltaY"),
    });
    return this._send(event);
  }

  setButtons({ left, middle, right } = {}) {
    if (![left, middle, right].every((value) => typeof value === "boolean")) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_POINTER_BUTTONS", "pointer button은 boolean이어야 한다"));
    }
    return this._send(Object.freeze({ type: "buttons", left, middle, right }));
  }

  wheel({ deltaX, deltaY } = {}) {
    const event = Object.freeze({
      type: "wheel",
      deltaX: finiteDelta(deltaX, this.maxDelta, "pointer wheel deltaX"),
      deltaY: finiteDelta(deltaY, this.maxDelta, "pointer wheel deltaY"),
    });
    return this._send(event);
  }

  drain() {
    const endpoint = this._endpoint;
    if (!endpoint || (!endpoint.active && endpoint.queue.length === 0)) return Promise.resolve();
    return new Promise((resolve) => this._drainWaiters.add(resolve));
  }

  inspect() {
    const endpoint = this._endpoint;
    return {
      kind: this.kind,
      mode: this.mode,
      attached: !!endpoint,
      endpointId: endpoint?.id || null,
      queuedEvents: endpoint ? endpoint.queue.length + Number(endpoint.active) : 0,
      sentEvents: this._sentEvents,
      sentMoves: this._sentMoves,
      sentButtons: this._sentButtons,
      sentWheels: this._sentWheels,
      deliveryErrors: this._deliveryErrors,
    };
  }

  _send(event) {
    const endpoint = this._endpoint;
    if (!endpoint || endpoint.closed) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_UNATTACHED", "pointer endpoint가 연결되지 않았다"));
    }
    if (endpoint.queue.length + Number(endpoint.active) >= this.maxQueuedEvents) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_QUEUE_FULL", `pointer queue 포화: ${endpoint.id}`));
    }
    return new Promise((resolve, reject) => {
      endpoint.queue.push({ event, resolve, reject });
      this._pump(endpoint);
    });
  }

  _pump(endpoint) {
    if (endpoint.pumping || endpoint.closed) return;
    endpoint.pumping = true;
    queueMicrotask(async () => {
      while (!endpoint.closed && endpoint.queue.length) {
        const delivery = endpoint.queue.shift();
        endpoint.active = true;
        try {
          await endpoint.receive(delivery.event);
          this._sentEvents += 1;
          if (delivery.event.type === "move") this._sentMoves += 1;
          else if (delivery.event.type === "buttons") this._sentButtons += 1;
          else this._sentWheels += 1;
          delivery.resolve();
        } catch (error) {
          this._deliveryErrors += 1;
          delivery.reject(error);
        } finally {
          endpoint.active = false;
          if (endpoint.queue.length === 0) this._resolveDrainWaiters();
        }
      }
      endpoint.pumping = false;
      if (!endpoint.closed && endpoint.queue.length) this._pump(endpoint);
    });
  }

  _disconnect(endpoint) {
    if (endpoint.closed) return;
    endpoint.closed = true;
    if (this._endpoint === endpoint) this._endpoint = null;
    const error = new WebMachineError("WEB_MACHINE_INPUT_UNATTACHED", `pointer endpoint 분리: ${endpoint.id}`);
    for (const delivery of endpoint.queue.splice(0)) delivery.reject(error);
    if (!endpoint.active) this._resolveDrainWaiters();
  }

  _resolveDrainWaiters() {
    for (const resolve of this._drainWaiters) resolve();
    this._drainWaiters.clear();
  }
}
