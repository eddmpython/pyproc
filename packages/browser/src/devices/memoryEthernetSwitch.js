// memoryEthernetSwitch.js - guest를 모르는 bounded packet network 기준 구현.
import { WebMachineError } from "@web-machine/core";

const ETHERNET_HEADER_BYTES = 14;

function copyFrame(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new WebMachineError("WEB_MACHINE_PACKET_INVALID", "packet frame은 bytes여야 한다");
}

function macKey(frame, offset) {
  let key = "";
  for (let index = 0; index < 6; index += 1) key += frame[offset + index].toString(16).padStart(2, "0");
  return key;
}

function isGroupAddress(frame, offset) {
  return (frame[offset] & 1) === 1;
}

function isZeroAddress(frame, offset) {
  for (let index = 0; index < 6; index += 1) if (frame[offset + index] !== 0) return false;
  return true;
}

export class MemoryEthernetSwitch {
  constructor({ maxFrameBytes = 1518, maxQueuedFrames = 64 } = {}) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < ETHERNET_HEADER_BYTES) {
      throw new TypeError(`maxFrameBytes는 ${ETHERNET_HEADER_BYTES} 이상 정수여야 한다`);
    }
    if (!Number.isInteger(maxQueuedFrames) || maxQueuedFrames <= 0) throw new TypeError("maxQueuedFrames는 양의 정수여야 한다");
    this.kind = "network";
    this.mode = "packet";
    this.maxFrameBytes = maxFrameBytes;
    this.maxQueuedFrames = maxQueuedFrames;
    this._endpoints = new Map();
    this._learnedEndpoints = new Map();
    this._transmittedFrames = 0;
    this._transmittedBytes = 0;
    this._deliveredFrames = 0;
    this._deliveredBytes = 0;
    this._droppedFrames = 0;
    this._deliveryErrors = 0;
    this._floodedFrames = 0;
    this._unicastFrames = 0;
  }

  connect({ endpointId, receive }) {
    const id = String(endpointId || "");
    if (!id) throw new TypeError("endpointId가 필요하다");
    if (typeof receive !== "function") throw new TypeError("receive 함수가 필요하다");
    if (this._endpoints.has(id)) {
      throw new WebMachineError("WEB_MACHINE_NETWORK_ENDPOINT_DUPLICATE", `network endpoint 중복: ${id}`);
    }
    const endpoint = {
      id,
      receive,
      queue: [],
      pumping: false,
      active: false,
      closed: false,
      receivedFrames: 0,
      receivedBytes: 0,
    };
    this._endpoints.set(id, endpoint);
    let closed = false;
    return Object.freeze({
      endpointId: id,
      send: (frame) => {
        if (closed) return Promise.reject(new WebMachineError("WEB_MACHINE_NETWORK_PORT_CLOSED", `network port 닫힘: ${id}`));
        return this._send(endpoint, frame);
      },
      close: () => {
        if (closed) return;
        closed = true;
        this._disconnect(endpoint);
      },
    });
  }

  inspect() {
    return {
      kind: this.kind,
      mode: this.mode,
      endpoints: this._endpoints.size,
      learnedAddresses: this._learnedEndpoints.size,
      transmittedFrames: this._transmittedFrames,
      transmittedBytes: this._transmittedBytes,
      deliveredFrames: this._deliveredFrames,
      deliveredBytes: this._deliveredBytes,
      droppedFrames: this._droppedFrames,
      deliveryErrors: this._deliveryErrors,
      floodedFrames: this._floodedFrames,
      unicastFrames: this._unicastFrames,
      queuedFrames: [...this._endpoints.values()].reduce((total, endpoint) => total + endpoint.queue.length + Number(endpoint.active), 0),
    };
  }

  _send(source, value) {
    if (source.closed || this._endpoints.get(source.id) !== source) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_NETWORK_PORT_CLOSED", `network port 닫힘: ${source.id}`));
    }
    const frame = copyFrame(value);
    if (frame.byteLength < ETHERNET_HEADER_BYTES) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_PACKET_INVALID", `Ethernet frame이 너무 짧다: ${frame.byteLength}`));
    }
    if (frame.byteLength > this.maxFrameBytes) {
      return Promise.reject(new WebMachineError("WEB_MACHINE_PACKET_TOO_LARGE", `Ethernet frame 크기 초과: ${frame.byteLength}/${this.maxFrameBytes}`));
    }

    const sourceAddress = macKey(frame, 6);
    if (!isGroupAddress(frame, 6) && !isZeroAddress(frame, 6)) this._learnedEndpoints.set(sourceAddress, source.id);
    const targetId = isGroupAddress(frame, 0) ? null : this._learnedEndpoints.get(macKey(frame, 0));
    const recipients = targetId
      ? [...this._endpoints.values()].filter((endpoint) => endpoint.id === targetId && endpoint !== source)
      : [...this._endpoints.values()].filter((endpoint) => endpoint !== source);

    if (recipients.some((endpoint) => endpoint.queue.length + Number(endpoint.active) >= this.maxQueuedFrames)) {
      this._droppedFrames += 1;
      return Promise.reject(new WebMachineError("WEB_MACHINE_PACKET_QUEUE_FULL", `packet queue 포화: ${source.id}`));
    }

    this._transmittedFrames += 1;
    this._transmittedBytes += frame.byteLength;
    if (targetId) this._unicastFrames += 1;
    else this._floodedFrames += 1;
    const deliveries = recipients.map((endpoint) => new Promise((resolve, reject) => {
      endpoint.queue.push({ frame: frame.slice(), resolve, reject });
      this._pump(endpoint);
    }));
    return Promise.all(deliveries).then(() => undefined);
  }

  _pump(endpoint) {
    if (endpoint.pumping || endpoint.closed) return;
    endpoint.pumping = true;
    queueMicrotask(async () => {
      while (!endpoint.closed && endpoint.queue.length) {
        const delivery = endpoint.queue.shift();
        endpoint.active = true;
        try {
          await endpoint.receive(delivery.frame.slice());
          endpoint.receivedFrames += 1;
          endpoint.receivedBytes += delivery.frame.byteLength;
          this._deliveredFrames += 1;
          this._deliveredBytes += delivery.frame.byteLength;
          delivery.resolve();
        } catch (error) {
          this._deliveryErrors += 1;
          delivery.reject(error);
        } finally {
          endpoint.active = false;
        }
      }
      endpoint.pumping = false;
      if (!endpoint.closed && endpoint.queue.length) this._pump(endpoint);
    });
  }

  _disconnect(endpoint) {
    if (endpoint.closed) return;
    endpoint.closed = true;
    if (this._endpoints.get(endpoint.id) === endpoint) this._endpoints.delete(endpoint.id);
    for (const [address, endpointId] of this._learnedEndpoints) {
      if (endpointId === endpoint.id) this._learnedEndpoints.delete(address);
    }
    const error = new WebMachineError("WEB_MACHINE_NETWORK_PORT_CLOSED", `network port 닫힘: ${endpoint.id}`);
    for (const delivery of endpoint.queue.splice(0)) delivery.reject(error);
  }
}
