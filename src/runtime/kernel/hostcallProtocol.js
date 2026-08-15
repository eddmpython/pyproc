// hostcallProtocol.js - Layer 0: synchronous worker hostcall record and ABI constants.
import { PyProcError } from "../errors.js";

export const HOSTCALL_ABI_VERSION = 1;
export const HOSTCALL_MAGIC = 0x50595048;
export const HOSTCALL_CONTROL_WORDS = 16;
export const HOSTCALL_DATA_BYTES = 1 << 20;
export const HOSTCALL_PATH = "/hostcall";
export const HOSTCALL_REQUEST_HEADER_BYTES = 36;
export const HOSTCALL_RESPONSE_HEADER_BYTES = 20;

export const HOSTCALL_WORD = Object.freeze({
  magic: 0,
  abiVersion: 1,
  state: 2,
  opcode: 3,
  flags: 4,
  requestIdLow: 5,
  requestIdHigh: 6,
  requestOffset: 7,
  requestLength: 8,
  responseOffset: 9,
  responseCapacity: 10,
  responseLength: 11,
  errorCode: 12,
  deadlineMs: 13,
});

export const HOSTCALL_STATE = Object.freeze({
  idle: 0,
  request: 1,
  processing: 2,
  response: 3,
  error: 4,
  cancelled: 5,
  timeout: 6,
  brokerLost: 7,
  outcomeUnknown: 8,
});

export const HOSTCALL_ERROR = Object.freeze({
  none: 0,
  invalid: 1,
  denied: 2,
  overflow: 3,
  timeout: 4,
  cancelled: 5,
  brokerLost: 6,
  conflict: 7,
  provider: 8,
  outcomeUnknown: 9,
});

export const HOSTCALL_FLAG = Object.freeze({
  externalEffect: 1,
  stream: 2,
  redacted: 4,
});

export const HOSTCALL_OPCODE = Object.freeze({
  noop: 0x0000,
  clock: 0x0001,
  entropy: 0x0002,
  terminalWrite: 0x0003,
  httpRequest: 0x0100,
  httpBodyRead: 0x0101,
  httpCancel: 0x0102,
  socketConnect: 0x0200,
  socketSend: 0x0201,
  socketReceive: 0x0202,
  socketClose: 0x0203,
  processSpawn: 0x0300,
  processWait: 0x0301,
  processSignal: 0x0302,
  processPipe: 0x0303,
  gpuDispatch: 0x0600,
  clipboardRead: 0x0500,
  clipboardWrite: 0x0501,
  framebufferPublish: 0x0502,
  asgiExchange: 0x0700,
});

export const HOSTCALL_STREAM_MAX_CREDIT = 64 * 1024;

export function createHostcallSharedState(control, data) {
  if (!(control instanceof SharedArrayBuffer)
    || control.byteLength !== HOSTCALL_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT
    || !(data instanceof SharedArrayBuffer) || data.byteLength !== HOSTCALL_DATA_BYTES) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Hostcall shared buffers are invalid");
  }
  return Object.freeze({ control, data });
}

export function assertHostcallControl(control, data) {
  if (!(control instanceof Int32Array) || control.length !== HOSTCALL_CONTROL_WORDS
    || !(data instanceof Uint8Array) || data.byteLength !== HOSTCALL_DATA_BYTES) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Hostcall shared control or data region is invalid");
  }
  const state = Atomics.load(control, HOSTCALL_WORD.state);
  if (!Object.values(HOSTCALL_STATE).includes(state)) {
    throw new PyProcError("PYPROC_STATE_CORRUPT", "Hostcall shared state enum is invalid");
  }
  return true;
}

export function hostcallRequestId(control) {
  const low = BigInt(Atomics.load(control, HOSTCALL_WORD.requestIdLow) >>> 0);
  const high = BigInt(Atomics.load(control, HOSTCALL_WORD.requestIdHigh) >>> 0);
  return (high << 32n) | low;
}

export function hostcallTerminalState(state) {
  return [HOSTCALL_STATE.response, HOSTCALL_STATE.error, HOSTCALL_STATE.cancelled,
    HOSTCALL_STATE.timeout, HOSTCALL_STATE.brokerLost, HOSTCALL_STATE.outcomeUnknown].includes(state);
}
