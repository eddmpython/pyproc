// memoryScanCodeInputDevice.js - focus된 한 endpoint에 bounded scan code batch를 전달한다.
import { WebMachineError } from "../../host/webMachineError.js";

function copyScanCodes(value) {
  let codes;
  if (value instanceof Uint8Array) codes = value.slice();
  else if (value instanceof ArrayBuffer) codes = new Uint8Array(value.slice(0));
  else if (ArrayBuffer.isView(value)) codes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  else throw new WebMachineError("WEB_MACHINE_INPUT_INVALID", "scan code는 bytes여야 한다");
  if (!codes.byteLength) throw new WebMachineError("WEB_MACHINE_INPUT_INVALID", "scan code가 비어 있다");
  return codes;
}

export class MemoryScanCodeInputDevice {
  constructor({ maxBatchBytes = 256, maxQueuedBatches = 64 } = {}) {
    if (!Number.isInteger(maxBatchBytes) || maxBatchBytes <= 0) throw new TypeError("maxBatchBytes는 양의 정수여야 한다");
    if (!Number.isInteger(maxQueuedBatches) || maxQueuedBatches <= 0) throw new TypeError("maxQueuedBatches는 양의 정수여야 한다");
    this.kind = "input";
    this.mode = "ps2-scan-code";
    this.maxBatchBytes = maxBatchBytes;
    this.maxQueuedBatches = maxQueuedBatches;
    this._endpoint = null;
    this._sentBatches = 0;
    this._sentCodes = 0;
    this._deliveryErrors = 0;
    this._drainWaiters = new Set();
  }

  connect({ endpointId, receive }) {
    const id = String(endpointId || "");
    if (!id) throw new TypeError("endpointId가 필요하다");
    if (typeof receive !== "function") throw new TypeError("receive 함수가 필요하다");
    if (this._endpoint) {
      const code = this._endpoint.id === id ? "WEB_MACHINE_INPUT_ENDPOINT_DUPLICATE" : "WEB_MACHINE_INPUT_BUSY";
      throw new WebMachineError(code, `input 연결 중: ${this._endpoint.id}`);
    }
    const endpoint = { id, receive, queue: [], pumping: false, active: false, closed: false };
    this._endpoint = endpoint;
    return Object.freeze({ endpointId: id, close: () => this._disconnect(endpoint) });
  }

  sendScanCodes(value) {
    const codes = copyScanCodes(value);
    if (codes.byteLength > this.maxBatchBytes) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_BATCH_SIZE", `scan code batch 크기 초과: ${codes.byteLength}/${this.maxBatchBytes}`));
    }
    const endpoint = this._endpoint;
    if (!endpoint || endpoint.closed) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_UNATTACHED", "input endpoint가 연결되지 않았다"));
    }
    if (endpoint.queue.length + Number(endpoint.active) >= this.maxQueuedBatches) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_QUEUE_FULL", `input queue 포화: ${endpoint.id}`));
    }
    return new Promise((resolve, reject) => {
      endpoint.queue.push({ codes, resolve, reject });
      this._pump(endpoint);
    });
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
      queuedBatches: endpoint ? endpoint.queue.length + Number(endpoint.active) : 0,
      sentBatches: this._sentBatches,
      sentCodes: this._sentCodes,
      deliveryErrors: this._deliveryErrors,
    };
  }

  _pump(endpoint) {
    if (endpoint.pumping || endpoint.closed) return;
    endpoint.pumping = true;
    queueMicrotask(async () => {
      while (!endpoint.closed && endpoint.queue.length) {
        const delivery = endpoint.queue.shift();
        endpoint.active = true;
        try {
          await endpoint.receive(delivery.codes.slice());
          this._sentBatches += 1;
          this._sentCodes += delivery.codes.byteLength;
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
    const error = new WebMachineError("WEB_MACHINE_INPUT_UNATTACHED", `input endpoint 분리: ${endpoint.id}`);
    for (const delivery of endpoint.queue.splice(0)) delivery.reject(error);
    if (!endpoint.active) this._resolveDrainWaiters();
  }

  _resolveDrainWaiters() {
    for (const resolve of this._drainWaiters) resolve();
    this._drainWaiters.clear();
  }
}
