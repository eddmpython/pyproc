// memoryScanCodeInputDevice.js - Layer 5/platform: focus된 한 endpoint에 bounded scan code batch를 전달한다.
import { WebMachineError } from "../contracts/webMachineError.js";

function copyScanCodes(value) {
  let codes;
  if (value instanceof Uint8Array) codes = value.slice();
  else if (value instanceof ArrayBuffer) codes = new Uint8Array(value.slice(0));
  else if (ArrayBuffer.isView(value)) codes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  else throw new WebMachineError("WEB_MACHINE_INPUT_INVALID", "scan codes must be bytes");
  if (!codes.byteLength) throw new WebMachineError("WEB_MACHINE_INPUT_INVALID", "the scan code batch is empty");
  return codes;
}

export class MemoryScanCodeInputDevice {
  constructor({ maxBatchBytes = 256, maxQueuedBatches = 64 } = {}) {
    if (!Number.isInteger(maxBatchBytes) || maxBatchBytes <= 0) throw new TypeError("maxBatchBytes must be a positive integer");
    if (!Number.isInteger(maxQueuedBatches) || maxQueuedBatches <= 0) throw new TypeError("maxQueuedBatches must be a positive integer");
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
    if (!id) throw new TypeError("an endpointId is required");
    if (typeof receive !== "function") throw new TypeError("a receive function is required");
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
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_BATCH_SIZE", `scan code batch is too large: ${codes.byteLength}/${this.maxBatchBytes}`));
    }
    const endpoint = this._endpoint;
    if (!endpoint || endpoint.closed) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_UNATTACHED", "no input endpoint is attached"));
    }
    if (endpoint.queue.length + Number(endpoint.active) >= this.maxQueuedBatches) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_INPUT_QUEUE_FULL", `the input queue is full: ${endpoint.id}`));
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
    const error = new WebMachineError("WEB_MACHINE_INPUT_UNATTACHED", `the input endpoint was detached: ${endpoint.id}`);
    for (const delivery of endpoint.queue.splice(0)) delivery.reject(error);
    if (!endpoint.active) this._resolveDrainWaiters();
  }

  _resolveDrainWaiters() {
    for (const resolve of this._drainWaiters) resolve();
    this._drainWaiters.clear();
  }
}
