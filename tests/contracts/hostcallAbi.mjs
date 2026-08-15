import { readFile } from "node:fs/promises";

import { HostCapabilityBroker } from "../../src/capabilities/hostCapabilityBroker.js";
import {
  HOSTCALL_ABI_VERSION,
  HOSTCALL_CONTROL_WORDS,
  HOSTCALL_DATA_BYTES,
  HOSTCALL_ERROR,
  HOSTCALL_FLAG,
  HOSTCALL_MAGIC,
  HOSTCALL_OPCODE,
  HOSTCALL_STATE,
  HOSTCALL_WORD,
  assertHostcallControl,
  createHostcallSharedState,
  hostcallRequestId,
  hostcallTerminalState,
} from "../../src/runtime/kernel/hostcallProtocol.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(requestKey, opcode = HOSTCALL_OPCODE.noop, payload = new Uint8Array(), overrides = {}) {
  return { requestKey, opcode, flags: 0, payload, responseCapacity: 65536, deadlineMs: 1000,
    authorityRef: "authority:test", commandId: "command:test", kernelRef: "kernel:test", ...overrides };
}

function deferred() {
  let resolve;
  const promise = new Promise((accepted) => { resolve = accepted; });
  return { promise, resolve };
}

export async function assertHostcallAbiContract() {
  const shared = createHostcallSharedState(
    new SharedArrayBuffer(HOSTCALL_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT),
    new SharedArrayBuffer(HOSTCALL_DATA_BYTES),
  );
  const control = new Int32Array(shared.control);
  const data = new Uint8Array(shared.data);
  control[HOSTCALL_WORD.magic] = HOSTCALL_MAGIC;
  control[HOSTCALL_WORD.abiVersion] = HOSTCALL_ABI_VERSION;
  control[HOSTCALL_WORD.requestIdLow] = 0x89abcdef | 0;
  control[HOSTCALL_WORD.requestIdHigh] = 0x01234567;
  assert(shared.control.byteLength === HOSTCALL_CONTROL_WORDS * 4
    && shared.data.byteLength === HOSTCALL_DATA_BYTES
    && assertHostcallControl(control, data)
    && hostcallRequestId(control) === 0x0123456789abcdefn
    && hostcallTerminalState(HOSTCALL_STATE.outcomeUnknown)
    && !hostcallTerminalState(HOSTCALL_STATE.processing),
  "hostcall SAB record layout or state enumeration changed");

  let allowTerminal = false;
  const terminalWrites = [];
  const broker = new HostCapabilityBroker({
    authorize: ({ capability }) => capability === "terminal.write" && allowTerminal,
    terminal: { write(payload) { terminalWrites.push(payload.slice()); return "written"; } },
    clock: () => 1700000000123,
    entropy: (bytes) => bytes.fill(0x5a),
  });

  for (let index = 0; index < 10000; index += 1) {
    const result = await broker.dispatch(request(`stress:${index}`, HOSTCALL_OPCODE.noop,
      new Uint8Array([index & 0xff])));
    if (result.state !== HOSTCALL_STATE.response || result.bytes[0] !== (index & 0xff)) {
      throw new Error(`hostcall noop stress failed at ${index}`);
    }
  }

  const clock = await broker.dispatch(request("core:clock", HOSTCALL_OPCODE.clock));
  const entropyPayload = new Uint8Array(4);
  new DataView(entropyPayload.buffer).setUint32(0, 32, true);
  const entropy = await broker.dispatch(request("core:entropy", HOSTCALL_OPCODE.entropy, entropyPayload));
  const deniedTerminal = await broker.dispatch(request("core:terminal:denied", HOSTCALL_OPCODE.terminalWrite,
    encoder.encode("denied")));
  allowTerminal = true;
  const allowedTerminal = await broker.dispatch(request("core:terminal:allowed", HOSTCALL_OPCODE.terminalWrite,
    encoder.encode("allowed")));
  assert(decoder.decode(clock.bytes) === "1700000000123"
    && entropy.bytes.byteLength === 32 && entropy.bytes.every((byte) => byte === 0x5a)
    && deniedTerminal.errorCode === HOSTCALL_ERROR.denied
    && allowedTerminal.state === HOSTCALL_STATE.response
    && terminalWrites.length === 1 && decoder.decode(terminalWrites[0]) === "allowed",
  "core host capability provider or terminal authority boundary failed");

  const deniedCapabilities = ["http.fetch", "socket.connect", "process.spawn", "gpu.dispatch", "clipboard.write"];
  for (let index = 0; index < deniedCapabilities.length; index += 1) {
    broker.register({ opcode: 0x1000 + index, name: deniedCapabilities[index],
      authority: deniedCapabilities[index], handler: () => "must not run" });
    const denied = await broker.dispatch(request(`denied:${index}`, 0x1000 + index));
    assert(denied.errorCode === HOSTCALL_ERROR.denied,
      `hostcall authority denial failed for ${deniedCapabilities[index]}`);
  }

  broker.register({ opcode: 0x1100, name: "test.overflow", handler: () => new Uint8Array(9) });
  const overflow = await broker.dispatch(request("edge:overflow", 0x1100, new Uint8Array(),
    { responseCapacity: 8 }));
  broker.register({ opcode: 0x1101, name: "test.timeout", async handler() { return new Promise(() => {}); } });
  const timeout = await broker.dispatch(request("edge:timeout", 0x1101, new Uint8Array(), { deadlineMs: 5 }));
  const beforeSendController = new AbortController();
  beforeSendController.abort("contract cancellation");
  const cancelledBeforeSend = await broker.dispatch(request("edge:cancel:before"),
    { signal: beforeSendController.signal });
  assert(overflow.errorCode === HOSTCALL_ERROR.overflow && overflow.omittedBytes === 1
    && timeout.state === HOSTCALL_STATE.timeout && timeout.errorCode === HOSTCALL_ERROR.timeout
    && cancelledBeforeSend.state === HOSTCALL_STATE.cancelled,
  "hostcall response overflow, timeout, or pre-send cancellation is unstable");

  broker.register({ opcode: 0x1102, name: "test.stream", async *handler() {
    yield "alpha";
    yield new Uint8Array([0x2d]);
    yield "omega";
  } });
  const chunks = [];
  const streamed = await broker.dispatch(request("edge:stream", 0x1102, new Uint8Array(),
    { flags: HOSTCALL_FLAG.stream, onChunk: (chunk) => chunks.push(decoder.decode(chunk)) }));
  const streamOverflow = await broker.dispatch(request("edge:stream:overflow", 0x1102, new Uint8Array(),
    { flags: HOSTCALL_FLAG.stream, responseCapacity: 5 }));
  assert(decoder.decode(streamed.bytes) === "alpha-omega" && chunks.join("") === "alpha-omega"
    && streamOverflow.errorCode === HOSTCALL_ERROR.overflow,
    "hostcall streaming response lost order or bytes");

  const effectSent = deferred();
  let effectSends = 0;
  broker.register({ opcode: 0x1200, name: "effect.once", authority: null, effect: true,
    async handler({ signal }) {
      effectSends += 1;
      effectSent.resolve();
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve("late"), { once: true }));
    } });
  const effectController = new AbortController();
  const firstEffect = broker.dispatch(request("effect:dedupe", 0x1200), { signal: effectController.signal });
  const duplicateEffect = broker.dispatch(request("effect:dedupe", 0x1200), { signal: effectController.signal });
  await effectSent.promise;
  effectController.abort("contract cancellation");
  const [firstReceipt, duplicateReceipt] = await Promise.all([firstEffect, duplicateEffect]);
  const conflict = await broker.dispatch(request("effect:dedupe", 0x1200, encoder.encode("different")));
  assert(effectSends === 1 && firstReceipt === duplicateReceipt
    && firstReceipt.state === HOSTCALL_STATE.outcomeUnknown
    && firstReceipt.errorCode === HOSTCALL_ERROR.outcomeUnknown
    && conflict.errorCode === HOSTCALL_ERROR.conflict,
  "hostcall receipt dedupe, conflict, or after-send outcome boundary failed");

  const lostBroker = new HostCapabilityBroker();
  const lostStarted = deferred();
  lostBroker.register({ opcode: 0x1300, name: "loss.read", async handler({ signal }) {
    lostStarted.resolve();
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve("late"), { once: true }));
  } });
  const lostOperation = lostBroker.dispatch(request("loss:read", 0x1300));
  await lostStarted.promise;
  assert(lostBroker.inspectCheckpointBoundary().acceptedHostcalls === 1,
    "active hostcall was omitted from checkpoint boundary");
  lostBroker.close();
  const lost = await lostOperation;

  const unknownBroker = new HostCapabilityBroker();
  const unknownStarted = deferred();
  unknownBroker.register({ opcode: 0x1301, name: "loss.effect", effect: true, async handler({ signal }) {
    unknownStarted.resolve();
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve("late"), { once: true }));
  } });
  const unknownOperation = unknownBroker.dispatch(request("loss:effect", 0x1301));
  await unknownStarted.promise;
  unknownBroker.close();
  const unknown = await unknownOperation;
  assert(lost.state === HOSTCALL_STATE.brokerLost && lost.errorCode === HOSTCALL_ERROR.brokerLost
    && unknown.state === HOSTCALL_STATE.outcomeUnknown && unknown.errorCode === HOSTCALL_ERROR.outcomeUnknown,
  "broker loss did not preserve the external effect outcome boundary");

  const [workerSource, sessionSource, hostSource] = await Promise.all([
    readFile(new URL("../../src/runtime/engines/wasi/wasiWorker.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/runtime/engines/wasi/wasiSession.js", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/engineBuilder/_pyprocHost.c", import.meta.url), "utf8"),
  ]);
  for (const required of ["class HostcallOpenFile", "Atomics.wait(this.control", "type: \"hostcallRequest\"",
    "HOSTCALL_PATH.slice(1)"]) {
    assert(workerSource.includes(required), `WASI worker hostcall bridge is missing ${required}`);
  }
  for (const required of ["_dispatchHostcall()", "this._hostBroker.dispatch", "Atomics.notify(control",
    "this._hostcallControllers.size"]) {
    assert(sessionSource.includes(required), `WASI session hostcall bridge is missing ${required}`);
  }
  for (const required of ["open(\"/hostcall\", O_RDWR)", "PYPROC_HOSTCALL_REQUEST_HEADER 36u",
    "PYPROC_HOSTCALL_RESPONSE_HEADER 20u", "HostcallOutcomeUnknown", "PyArg_ParseTupleAndKeywords"]) {
    assert(hostSource.includes(required), `static CPython host module is missing ${required}`);
  }
  for (const forbidden of ["fetch(", "WebSocket", "navigator.gpu", "navigator.clipboard", "child_process"]) {
    assert(!workerSource.includes(forbidden), `WASI worker hostcall transport contains provider policy: ${forbidden}`);
  }
}
