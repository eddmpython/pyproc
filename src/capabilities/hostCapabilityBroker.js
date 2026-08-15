// hostCapabilityBroker.js - Layer 2: authority-bound host capability dispatch and receipts.
import { PyProcError } from "../runtime/errors.js";
import { sha256Address } from "../runtime/contentDigest.js";
import {
  HOSTCALL_ERROR,
  HOSTCALL_FLAG,
  HOSTCALL_OPCODE,
  HOSTCALL_STATE,
} from "../runtime/kernel/hostcallProtocol.js";

const encoder = new TextEncoder();
const BROKER_LOST_REASON = Symbol("host capability broker lost");

function responseBytes(value) {
  if (value === undefined || value === null) return new Uint8Array();
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (typeof value === "string") return encoder.encode(value);
  return encoder.encode(JSON.stringify(value));
}

function terminal(state, errorCode, bytes = new Uint8Array(), details = {}) {
  return Object.freeze({ state, errorCode, bytes, ...details });
}

function errorMessage(error) {
  return String(error?.message || error).slice(-1000);
}

async function collectResponse(value, request, capacity) {
  if (!value || typeof value[Symbol.asyncIterator] !== "function") return responseBytes(value);
  if (!(request.flags & HOSTCALL_FLAG.stream)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "streaming hostcall response requires the stream flag");
  }
  const chunks = [];
  let total = 0;
  for await (const valueChunk of value) {
    const chunk = responseBytes(valueChunk);
    total += chunk.byteLength;
    if (total > capacity) {
      return Object.freeze({ overflow: true, byteLength: total, chunks: Object.freeze(chunks) });
    }
    chunks.push(chunk);
    if (typeof request.onChunk === "function") await request.onChunk(chunk.slice());
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export class HostCapabilityBroker {
  constructor({ authorize = () => false, terminal = null, clock = () => Date.now(),
    entropy = (bytes) => crypto.getRandomValues(bytes), maxResponseBytes = 1 << 20 } = {}) {
    if (typeof authorize !== "function" || typeof clock !== "function" || typeof entropy !== "function"
      || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Host capability broker configuration is invalid");
    }
    this.authorize = authorize;
    this.clock = clock;
    this.entropy = entropy;
    this.maxResponseBytes = maxResponseBytes;
    this.providers = new Map();
    this.receipts = new Map();
    this.active = new Map();
    this.checkpointInspectors = new Set();
    this.closed = false;
    this.register({ opcode: HOSTCALL_OPCODE.noop, name: "kernel.noop", authority: null,
      async handler(request) { return request.payload; } });
    this.register({ opcode: HOSTCALL_OPCODE.clock, name: "kernel.clock", authority: null,
      handler: () => String(this.clock()) });
    this.register({ opcode: HOSTCALL_OPCODE.entropy, name: "kernel.entropy", authority: null,
      handler: (request) => {
        if (request.payload.byteLength !== 4) throw new PyProcError("PYPROC_INPUT_INVALID", "entropy request must contain uint32 length");
        const length = new DataView(request.payload.buffer, request.payload.byteOffset, 4).getUint32(0, true);
        if (length > 65536) throw new PyProcError("PYPROC_INPUT_INVALID", "entropy request exceeds 65536 bytes");
        return this.entropy(new Uint8Array(length));
      } });
    if (terminal) this.register({ opcode: HOSTCALL_OPCODE.terminalWrite, name: "terminal.write",
      authority: "terminal.write", handler: (request) => terminal.write(request.payload, request) });
  }

  register({ opcode, name, authority = null, effect = false, explicitEffectBoundary = false, handler }) {
    if (!Number.isSafeInteger(opcode) || opcode < 0 || opcode > 0xffff || typeof name !== "string" || !name
      || typeof explicitEffectBoundary !== "boolean" || typeof handler !== "function" || this.providers.has(opcode)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Host capability provider registration is invalid");
    }
    this.providers.set(opcode, Object.freeze({ opcode, name, authority, effect, explicitEffectBoundary, handler }));
  }

  async dispatch(rawRequest, { signal } = {}) {
    if (this.closed) return terminal(HOSTCALL_STATE.brokerLost, HOSTCALL_ERROR.brokerLost,
      encoder.encode("host capability broker is closed"));
    if (!rawRequest || typeof rawRequest.requestKey !== "string" || !rawRequest.requestKey
      || !Number.isSafeInteger(rawRequest.opcode) || !(rawRequest.payload instanceof Uint8Array)
      || !Number.isSafeInteger(rawRequest.responseCapacity) || rawRequest.responseCapacity < 0
      || !Number.isSafeInteger(rawRequest.deadlineMs) || rawRequest.deadlineMs <= 0
      || !Number.isSafeInteger(rawRequest.flags || 0) || (rawRequest.flags || 0) < 0) {
      return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.invalid, encoder.encode("invalid hostcall request"));
    }
    const inputDigest = await sha256Address(rawRequest.payload);
    const identityDigest = await sha256Address(`${rawRequest.opcode}\n${rawRequest.flags || 0}\n${inputDigest}\n${rawRequest.kernelRef || ""}\n${rawRequest.authorityRef || ""}`);
    const previous = this.receipts.get(rawRequest.requestKey);
    if (previous) {
      if (previous.identityDigest !== identityDigest) {
        return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.conflict,
          encoder.encode("hostcall request ID was reused with different input"));
      }
      return previous.promise;
    }
    const operation = this._dispatchOnce({ ...rawRequest, inputDigest, identityDigest }, signal);
    this.receipts.set(rawRequest.requestKey, { identityDigest, promise: operation });
    return operation;
  }

  async _dispatchOnce(request, signal) {
    const provider = this.providers.get(request.opcode);
    if (!provider) return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.invalid,
      encoder.encode(`unknown hostcall opcode ${request.opcode}`));
    if (provider.authority) {
      let authorized = false;
      try {
        authorized = await this.authorize(Object.freeze({ authorityRef: request.authorityRef,
          capability: provider.authority, opcode: request.opcode, provider: provider.name,
          commandId: request.commandId, kernelRef: request.kernelRef, flags: request.flags,
          inputDigest: request.inputDigest, payload: request.payload.slice(),
          responseCapacity: request.responseCapacity, deadlineMs: request.deadlineMs,
          effect: provider.effect === true }));
      } catch (error) {
        authorized = false;
      }
      if (!authorized) return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.denied,
        encoder.encode(`hostcall authority denied: ${provider.authority}`));
    }
    if (signal?.aborted) return terminal(HOSTCALL_STATE.cancelled, HOSTCALL_ERROR.cancelled,
      encoder.encode("hostcall cancelled before provider send"));
    const controller = new AbortController();
    const active = { controller, provider, sent: false };
    this.active.set(request.requestKey, active);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort("deadline");
        resolve(terminal(HOSTCALL_STATE.timeout, HOSTCALL_ERROR.timeout, encoder.encode("hostcall deadline elapsed")));
      }, request.deadlineMs);
    });
    const cancelled = new Promise((resolve) => {
      controller.signal.addEventListener("abort", () => {
        if (controller.signal.reason === "deadline") return;
        const externalOutcomeUnknown = active.sent
          && (provider.effect || request.flags & HOSTCALL_FLAG.externalEffect);
        const brokerLost = controller.signal.reason === BROKER_LOST_REASON;
        resolve(terminal(externalOutcomeUnknown ? HOSTCALL_STATE.outcomeUnknown
          : brokerLost ? HOSTCALL_STATE.brokerLost : HOSTCALL_STATE.cancelled,
        externalOutcomeUnknown ? HOSTCALL_ERROR.outcomeUnknown
          : brokerLost ? HOSTCALL_ERROR.brokerLost : HOSTCALL_ERROR.cancelled,
        encoder.encode(externalOutcomeUnknown ? "hostcall outcome is unknown after provider loss"
          : brokerLost ? "host capability broker was lost" : active.sent
            ? "hostcall cancelled after provider send" : "hostcall cancelled")));
      }, { once: true });
    });
    const invoke = (async () => {
      try {
        const markSent = () => { active.sent = true; };
        if (!provider.explicitEffectBoundary) markSent();
        const value = await provider.handler(Object.freeze({ ...request, signal: controller.signal, markSent }));
        const capacity = Math.min(request.responseCapacity, this.maxResponseBytes);
        const bytes = await collectResponse(value, request, capacity);
        if (bytes?.overflow) return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.overflow,
          encoder.encode(`hostcall response exceeds capacity ${capacity}`),
          { omittedBytes: bytes.byteLength - capacity });
        if (bytes.byteLength > capacity) return terminal(HOSTCALL_STATE.error, HOSTCALL_ERROR.overflow,
          encoder.encode(`hostcall response ${bytes.byteLength} exceeds capacity ${capacity}`),
          { omittedBytes: bytes.byteLength - capacity });
        return terminal(HOSTCALL_STATE.response, HOSTCALL_ERROR.none, bytes,
          { provider: provider.name, inputDigest: request.inputDigest });
      } catch (error) {
        const unknown = error?.outcome === "outcomeUnknown"
          || error?.outcomeUnknown === true
          || active.sent && (provider.effect || request.flags & HOSTCALL_FLAG.externalEffect);
        return terminal(unknown ? HOSTCALL_STATE.outcomeUnknown : HOSTCALL_STATE.error,
          unknown ? HOSTCALL_ERROR.outcomeUnknown : HOSTCALL_ERROR.provider,
          encoder.encode(errorMessage(error)), { provider: provider.name });
      }
    })();
    try { return await Promise.race([invoke, timeout, cancelled]); }
    finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      this.active.delete(request.requestKey);
    }
  }

  cancel(requestKey, reason = "cancelled") {
    const active = this.active.get(requestKey);
    if (!active) return false;
    active.controller.abort(reason);
    return true;
  }

  addCheckpointInspector(inspector) {
    if (typeof inspector !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Checkpoint inspector must be a function");
    }
    this.checkpointInspectors.add(inspector);
    return () => this.checkpointInspectors.delete(inspector);
  }

  inspectCheckpointBoundary() {
    const boundaries = [...this.checkpointInspectors].map((inspect) => inspect());
    return Object.freeze({ acceptedHostcalls: this.active.size,
      activeTransactions: boundaries.reduce((count, item) => count + (item?.activeTransactions || 0), 0),
      outputDrained: boundaries.every((item) => item?.outputDrained !== false),
      openResources: Object.freeze(boundaries.flatMap((item) => item?.openResources || [])),
      vfsRootDigest: null });
  }

  close(reason = "broker lost") {
    this.closed = true;
    this.closeReason = reason;
    for (const active of this.active.values()) active.controller.abort(BROKER_LOST_REASON);
    this.checkpointInspectors.clear();
  }
}
