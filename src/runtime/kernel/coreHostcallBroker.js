// coreHostcallBroker.js - Layer 0: dependency-free handlers for the mandatory hostcall opcodes.
import { PyProcError } from "../errors.js";
import {
  HOSTCALL_ERROR,
  HOSTCALL_OPCODE,
  HOSTCALL_STATE,
} from "./hostcallProtocol.js";

const encoder = new TextEncoder();

function terminal(state, errorCode, bytes = new Uint8Array()) {
  return Object.freeze({ state, errorCode, bytes });
}

function validRequest(request) {
  return request && typeof request.requestKey === "string" && request.requestKey
    && Number.isSafeInteger(request.opcode) && request.opcode >= 0
    && request.payload instanceof Uint8Array
    && Number.isSafeInteger(request.responseCapacity) && request.responseCapacity >= 0
    && Number.isSafeInteger(request.deadlineMs) && request.deadlineMs > 0;
}

export class CoreHostcallBroker {
  constructor({ clock = () => Date.now(), entropy = (bytes) => globalThis.crypto.getRandomValues(bytes) } = {}) {
    if (typeof clock !== "function" || typeof entropy !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Core hostcall broker configuration is invalid");
    }
    this.clock = clock;
    this.entropy = entropy;
    this.closed = false;
  }

  async dispatch(request, { signal } = {}) {
    if (this.closed) return terminal(HOSTCALL_STATE.brokerLost, HOSTCALL_ERROR.brokerLost,
      encoder.encode("core hostcall broker is closed"));
    if (!validRequest(request)) return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.invalid,
      encoder.encode("invalid hostcall request"));
    if (signal?.aborted) return terminal(HOSTCALL_STATE.cancelled, HOSTCALL_ERROR.cancelled,
      encoder.encode("hostcall cancelled"));
    try {
      let bytes;
      if (request.opcode === HOSTCALL_OPCODE.noop) bytes = request.payload.slice();
      else if (request.opcode === HOSTCALL_OPCODE.clock) bytes = encoder.encode(String(this.clock()));
      else if (request.opcode === HOSTCALL_OPCODE.entropy) {
        if (request.payload.byteLength !== Uint32Array.BYTES_PER_ELEMENT) {
          return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.invalid,
            encoder.encode("entropy request must contain uint32 length"));
        }
        const length = new DataView(request.payload.buffer, request.payload.byteOffset,
          request.payload.byteLength).getUint32(0, true);
        if (length > 65536) return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.invalid,
          encoder.encode("entropy request exceeds 65536 bytes"));
        bytes = this.entropy(new Uint8Array(length));
      } else {
        return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.denied,
          encoder.encode(`hostcall opcode ${request.opcode} requires an injected capability broker`));
      }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > request.responseCapacity) {
        return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.overflow,
          encoder.encode("hostcall response exceeds capacity"));
      }
      return terminal(HOSTCALL_STATE.response, HOSTCALL_ERROR.none, bytes);
    } catch (error) {
      return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.provider,
        encoder.encode(String(error?.message || error).slice(-1000)));
    }
  }

  inspectCheckpointBoundary() {
    return Object.freeze({ acceptedHostcalls: 0, activeTransactions: 0,
      outputDrained: true, openResources: [], vfsRootDigest: null });
  }

  close() {
    this.closed = true;
  }
}
