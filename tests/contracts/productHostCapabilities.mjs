import { base64FromBytes, bytesFromBase64 } from "../../src/runtime/contentDigest.js";
import { HostCapabilityBroker } from "../../src/capabilities/hostCapabilityBroker.js";
import {
  ProductHostCapabilityPort,
  createAsgiHostAdapter,
} from "../../src/capabilities/productHostCapabilities.js";
import {
  HOSTCALL_ERROR,
  HOSTCALL_FLAG,
  HOSTCALL_OPCODE,
  HOSTCALL_STATE,
  HOSTCALL_STREAM_MAX_CREDIT,
} from "../../src/runtime/kernel/hostcallProtocol.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function payload(value) {
  return encoder.encode(JSON.stringify(value));
}

function request(requestKey, opcode, value, overrides = {}) {
  return { requestKey, opcode, flags: 0, payload: payload(value), responseCapacity: 65536,
    deadlineMs: 1000, authorityRef: "authority:product", commandId: "command:product",
    kernelRef: "kernel:product", ...overrides };
}

async function call(broker, requestKey, opcode, value, overrides) {
  const result = await broker.dispatch(request(requestKey, opcode, value, overrides));
  const body = result.bytes.byteLength ? JSON.parse(decoder.decode(result.bytes)) : null;
  return { result, body };
}

export async function assertProductHostCapabilitiesContract() {
  let slowStartedResolve;
  const slowStarted = new Promise((resolve) => { slowStartedResolve = resolve; });
  let bodyReadStartedResolve;
  const bodyReadStarted = new Promise((resolve) => { bodyReadStartedResolve = resolve; });
  let bodyCancelledResolve;
  const bodyCancelled = new Promise((resolve) => { bodyCancelledResolve = resolve; });
  let bodyCancelCount = 0;
  const calls = { http: 0, socketConnect: 0, socketSend: 0, socketClose: [], processSpawn: 0,
    processSignal: 0, gpu: 0, clipboardRead: 0, clipboardWrite: 0, framebuffer: 0, asgi: 0 };
  const http = {
    async request(input, { signal }) {
      calls.http += 1;
      if (input.url.endsWith("/slow")) {
        slowStartedResolve();
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(
          Object.assign(new Error("cancelled fetch"), { outcomeUnknown: true })), { once: true }));
      }
      if (input.url.endsWith("/body-slow")) {
        return { status: 200, body: { [Symbol.asyncIterator]() { return {
          next() { bodyReadStartedResolve(); return new Promise(() => {}); },
          return() { return Promise.resolve({ done: true }); },
        }; } }, cancel() { bodyCancelCount += 1; bodyCancelledResolve(); } };
      }
      if (input.url.endsWith("/cors")) throw new Error("CORS blocked");
      const first = new Uint8Array(40000).fill(65);
      const second = new Uint8Array(30000).fill(66);
      return { status: 200, headers: [["content-type", "application/octet-stream"]],
        url: input.url.replace("/redirect", "/final"), redirected: input.url.endsWith("/redirect"),
        body: { async *[Symbol.asyncIterator]() { yield first; yield second; } } };
    },
  };
  const socket = {
    async connect(input) {
      calls.socketConnect += 1;
      if (input.host === "fail.test") throw new Error("relay connect failed");
      return { queue: [] };
    },
    async send(handle, bytes) { calls.socketSend += 1; handle.queue.push(bytes.slice()); },
    async receive(handle) { return handle.queue.shift() || new Uint8Array(); },
    async close(handle, direction) { calls.socketClose.push(direction); handle.closed = direction === "both"; },
  };
  const process = {
    async spawn(input) { calls.processSpawn += 1; return { output: encoder.encode(input.code || ""), signal: null }; },
    async wait(handle) { return { terminal: true, state: handle.signal || "completed", exitCode: handle.signal ? 143 : 0 }; },
    async signal(handle, signal) { calls.processSignal += 1; handle.signal = signal; return signal; },
    async pipe(handle, stream, maxBytes) { return handle.output.slice(0, maxBytes); },
  };
  const gpu = { async dispatch(input) {
    calls.gpu += 1;
    if (input.operation === "invalid") throw new Error("GPU validation failed");
    if (input.operation === "deviceLoss") throw new Error("GPU device lost");
    return { values: input.left.map((value, index) => value + input.right[index]) };
  } };
  let clipboardText = "initial";
  const clipboard = { async read() { calls.clipboardRead += 1; return clipboardText; },
    async write(text) { calls.clipboardWrite += 1; clipboardText = text; } };
  const framebuffer = { async publish(frame) { calls.framebuffer += 1; assert(frame.bytes.byteLength === 8,
    "framebuffer adapter received the wrong byte count"); } };
  const asgi = { async exchange(input) { calls.asgi += 1; return { status: 207,
    headers: [["x-asgi", "hostcall"]], bodyBase64: base64FromBytes(encoder.encode(input.disconnect ? "disconnect" : input.path)) }; } };

  const allowed = new Set(["network.http", "network.socket", "process.spawn", "process.signal",
    "accelerator.gpu", "device.clipboard.read", "device.clipboard.write", "device.framebuffer",
    "application.asgi"]);
  let observedHttpAuthority = null;
  const broker = new HostCapabilityBroker({ authorize: (context) => {
    if (context.capability === "network.http") observedHttpAuthority = context;
    return allowed.has(context.capability);
  } });
  const port = new ProductHostCapabilityPort({ http, socket, process, gpu, clipboard, framebuffer, asgi })
    .install(broker);

  assert(HOSTCALL_OPCODE.httpRequest === 0x0100 && HOSTCALL_OPCODE.socketConnect === 0x0200
    && HOSTCALL_OPCODE.processSpawn === 0x0300 && HOSTCALL_OPCODE.gpuDispatch === 0x0600
    && HOSTCALL_OPCODE.clipboardRead === 0x0500 && HOSTCALL_OPCODE.asgiExchange === 0x0700
    && HOSTCALL_STREAM_MAX_CREDIT === 65536, "product opcode registry or stream credit changed");

  const opened = await call(broker, "http:redirect", HOSTCALL_OPCODE.httpRequest,
    { url: "https://example.test/redirect", method: "GET" }, { flags: HOSTCALL_FLAG.externalEffect });
  assert(opened.result.state === HOSTCALL_STATE.response && opened.body.status === 200
    && opened.body.redirected && opened.body.url.endsWith("/final") && opened.body.bodyRef,
  "HTTP redirect metadata did not cross the hostcall port");
  assert(observedHttpAuthority?.payload instanceof Uint8Array && observedHttpAuthority.effect === true
    && observedHttpAuthority.inputDigest.startsWith("sha256:")
    && observedHttpAuthority.responseCapacity === 65536,
  "authority did not receive destination payload, digest, effect, and quota context");
  const collected = [];
  let done = false;
  let readIndex = 0;
  while (!done) {
    const read = await call(broker, `http:read:${readIndex++}`, HOSTCALL_OPCODE.httpBodyRead,
      { bodyRef: opened.body.bodyRef, creditBytes: 24000 });
    assert(read.result.state === HOSTCALL_STATE.response && read.body.byteLength <= 24000,
      "HTTP stream exceeded its declared credit");
    collected.push(bytesFromBase64(read.body.bodyBase64));
    done = read.body.done;
  }
  const joined = new Uint8Array(collected.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let joinedAt = 0;
  for (const chunk of collected) { joined.set(chunk, joinedAt); joinedAt += chunk.byteLength; }
  assert(joined.byteLength === 70000 && joined[0] === 65 && joined[39999] === 65 && joined[40000] === 66,
    "HTTP large body stream was not lossless");

  const duplicateA = call(broker, "http:dedupe", HOSTCALL_OPCODE.httpRequest,
    { url: "https://example.test/dedupe", method: "POST", bodyBase64: "eA==" },
    { flags: HOSTCALL_FLAG.externalEffect });
  const duplicateB = call(broker, "http:dedupe", HOSTCALL_OPCODE.httpRequest,
    { url: "https://example.test/dedupe", method: "POST", bodyBase64: "eA==" },
    { flags: HOSTCALL_FLAG.externalEffect });
  const [dedupeA, dedupeB] = await Promise.all([duplicateA, duplicateB]);
  assert(dedupeA.body.bodyRef === dedupeB.body.bodyRef && calls.http === 2,
    "HTTP effect replay sent a duplicate provider request");
  await call(broker, "http:dedupe:cancel", HOSTCALL_OPCODE.httpCancel, { bodyRef: dedupeA.body.bodyRef });

  const deniedCalls = { count: 0 };
  const deniedBroker = new HostCapabilityBroker();
  new ProductHostCapabilityPort({ http: { async request() { deniedCalls.count += 1; return {}; } } }).install(deniedBroker);
  const denied = await deniedBroker.dispatch(request("http:denied", HOSTCALL_OPCODE.httpRequest,
    { url: "https://denied.test/" }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(denied.state === HOSTCALL_STATE.error && denied.errorCode === HOSTCALL_ERROR.denied
    && deniedCalls.count === 0, "unauthorized HTTP crossed the provider send boundary");
  const beforeInvalid = calls.http;
  const invalid = await broker.dispatch(request("http:invalid", HOSTCALL_OPCODE.httpRequest,
    { method: "GET" }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(invalid.state === HOSTCALL_STATE.error && invalid.errorCode === HOSTCALL_ERROR.provider
    && calls.http === beforeInvalid, "invalid HTTP input crossed the effect boundary or became uncertain");
  let reentrantCalls = 0;
  const reentrantBroker = new HostCapabilityBroker({ authorize: () => true });
  new ProductHostCapabilityPort({ asgi: { kernelRef: "kernel:product", async exchange() {
    reentrantCalls += 1; return {};
  } } }).install(reentrantBroker);
  const reentrant = await reentrantBroker.dispatch(request("asgi:reentrant", HOSTCALL_OPCODE.asgiExchange,
    { method: "GET", path: "/" }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(reentrant.state === HOSTCALL_STATE.error && reentrant.errorCode === HOSTCALL_ERROR.provider
    && reentrantCalls === 0, "same-kernel ASGI reentrancy crossed the effect boundary");

  const slowController = new AbortController();
  const slow = broker.dispatch(request("http:slow", HOSTCALL_OPCODE.httpRequest,
    { url: "https://example.test/slow" }, { flags: HOSTCALL_FLAG.externalEffect }),
  { signal: slowController.signal });
  await slowStarted;
  slowController.abort("test cancellation");
  const slowResult = await slow;
  assert(slowResult.state === HOSTCALL_STATE.outcomeUnknown
    && slowResult.errorCode === HOSTCALL_ERROR.outcomeUnknown,
  "HTTP cancellation after provider send lost uncertain-effect truth");
  const cors = await broker.dispatch(request("http:cors", HOSTCALL_OPCODE.httpRequest,
    { url: "https://example.test/cors" }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(cors.state === HOSTCALL_STATE.outcomeUnknown, "CORS transport failure was reported as false completion");

  const bodySlow = await call(broker, "http:body-slow", HOSTCALL_OPCODE.httpRequest,
    { url: "https://example.test/body-slow" }, { flags: HOSTCALL_FLAG.externalEffect });
  const bodyController = new AbortController();
  const bodyRead = broker.dispatch(request("http:body-slow:read", HOSTCALL_OPCODE.httpBodyRead,
    { bodyRef: bodySlow.body.bodyRef, creditBytes: 1024 }), { signal: bodyController.signal });
  await bodyReadStarted;
  bodyController.abort("cancel streaming body");
  const bodyReadResult = await bodyRead;
  await bodyCancelled;
  assert(bodyReadResult.state === HOSTCALL_STATE.cancelled && bodyCancelCount === 1
    && !port.inspectCheckpointBoundary().openResources
      .some((resource) => resource.resourceRef === bodySlow.body.bodyRef),
  "HTTP body cancellation left a checkpoint-blocking resource or cancelled the source twice");

  const socketConnectsBeforeInvalid = calls.socketConnect;
  const invalidSocket = await broker.dispatch(request("socket:invalid", HOSTCALL_OPCODE.socketConnect,
    { host: "echo.test", port: 65536 }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(invalidSocket.state === HOSTCALL_STATE.error && invalidSocket.errorCode === HOSTCALL_ERROR.provider
    && calls.socketConnect === socketConnectsBeforeInvalid,
  "invalid socket input crossed the effect boundary or became uncertain");

  const connected = await call(broker, "socket:connect", HOSTCALL_OPCODE.socketConnect,
    { host: "echo.test", port: 443 }, { flags: HOSTCALL_FLAG.externalEffect });
  const socketRef = connected.body.socketRef;
  const echoBytes = encoder.encode("binary-echo");
  await call(broker, "socket:send", HOSTCALL_OPCODE.socketSend,
    { socketRef, dataBase64: base64FromBytes(echoBytes) }, { flags: HOSTCALL_FLAG.externalEffect });
  const echo = await call(broker, "socket:receive", HOSTCALL_OPCODE.socketReceive,
    { socketRef, maxBytes: 1024 });
  assert(decoder.decode(bytesFromBase64(echo.body.dataBase64)) === "binary-echo",
    "socket relay binary echo changed bytes");
  const half = await call(broker, "socket:half", HOSTCALL_OPCODE.socketClose,
    { socketRef, direction: "write" });
  assert(half.body.writeClosed && !half.body.closed && port.inspectCheckpointBoundary().openResources
    .some((resource) => resource.resourceRef === socketRef), "socket half-close lost the readable resource");
  await call(broker, "socket:close", HOSTCALL_OPCODE.socketClose, { socketRef, direction: "both" });
  const socketFailure = await broker.dispatch(request("socket:failure", HOSTCALL_OPCODE.socketConnect,
    { host: "fail.test", port: 1 }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(socketFailure.state === HOSTCALL_STATE.outcomeUnknown, "socket connect failure became false completion");

  const spawned = await call(broker, "process:spawn", HOSTCALL_OPCODE.processSpawn,
    { code: "print(7)" }, { flags: HOSTCALL_FLAG.externalEffect });
  const processRef = spawned.body.processRef;
  const pipe = await call(broker, "process:pipe", HOSTCALL_OPCODE.processPipe,
    { processRef, stream: "stdout", maxBytes: 1024 });
  assert(decoder.decode(bytesFromBase64(pipe.body.dataBase64)) === "print(7)",
    "process pipe bytes did not cross the port");
  const processSignalsBeforeInvalid = calls.processSignal;
  const invalidSignal = await broker.dispatch(request("process:signal:invalid", HOSTCALL_OPCODE.processSignal,
    { processRef, signal: "pause" }, { flags: HOSTCALL_FLAG.externalEffect }));
  assert(invalidSignal.state === HOSTCALL_STATE.error && invalidSignal.errorCode === HOSTCALL_ERROR.provider
    && calls.processSignal === processSignalsBeforeInvalid,
  "invalid process signal crossed the effect boundary or became uncertain");
  await call(broker, "process:signal", HOSTCALL_OPCODE.processSignal,
    { processRef, signal: "terminate" }, { flags: HOSTCALL_FLAG.externalEffect });
  const waited = await call(broker, "process:wait", HOSTCALL_OPCODE.processWait, { processRef });
  assert(waited.body.state === "terminate" && waited.body.exitCode === 143,
    "process signal and wait terminal changed");

  const vector = await call(broker, "gpu:vector", HOSTCALL_OPCODE.gpuDispatch,
    { operation: "vectorAdd", left: [1, 2], right: [3, 4] });
  assert(vector.body.values.join(",") === "4,6", "GPU vector workload changed");
  for (const operation of ["invalid", "deviceLoss"]) {
    const failed = await broker.dispatch(request(`gpu:${operation}`, HOSTCALL_OPCODE.gpuDispatch,
      { operation }));
    assert(failed.state === HOSTCALL_STATE.error && failed.errorCode === HOSTCALL_ERROR.provider,
      `GPU ${operation} did not produce a typed provider terminal`);
  }

  const clipRead = await call(broker, "clipboard:read", HOSTCALL_OPCODE.clipboardRead, {});
  assert(clipRead.body.text === "initial", "clipboard read changed text");
  const clipWrite = await call(broker, "clipboard:write", HOSTCALL_OPCODE.clipboardWrite,
    { text: "secret value" }, { flags: HOSTCALL_FLAG.externalEffect | HOSTCALL_FLAG.redacted });
  assert(clipWrite.body.redacted && !decoder.decode(clipWrite.result.bytes).includes("secret value")
    && clipboardText === "secret value", "clipboard write leaked redacted content or did not apply");

  const frameBytes = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const frame = await call(broker, "framebuffer:publish", HOSTCALL_OPCODE.framebufferPublish,
    { width: 2, height: 1, dataBase64: base64FromBytes(frameBytes) },
    { flags: HOSTCALL_FLAG.externalEffect });
  assert(frame.body.digest.startsWith("sha256:") && frame.body.byteLength === 8,
    "framebuffer receipt lacks the exact artifact digest");
  const asgiResponse = await call(broker, "asgi:exchange", HOSTCALL_OPCODE.asgiExchange,
    { method: "POST", path: "/stream", disconnect: true }, { flags: HOSTCALL_FLAG.externalEffect });
  assert(asgiResponse.body.status === 207
    && decoder.decode(bytesFromBase64(asgiResponse.body.bodyBase64)) === "disconnect",
  "ASGI exchange lost response or disconnect meaning");
  const asgiAdapter = createAsgiHostAdapter({ async serve(method, path, body, query, headers) {
    assert(method === "PUT" && path === "/adapter" && body === "request"
      && query === "a=1" && headers[0][0] === "x-test", "ASGI adapter changed the request");
    return { status: 202, headers: [["x-adapter", "yes"]], body: "ignored",
      bodyBytes: encoder.encode("adapter-bytes") };
  } }, { kernelRef: "kernel:asgi-target" });
  const adaptedAsgi = await asgiAdapter.exchange({ method: "PUT", path: "/adapter", body: "request",
    query: "a=1", headers: [["x-test", "yes"]] });
  assert(adaptedAsgi.status === 202 && adaptedAsgi.byteLength === 13
    && decoder.decode(bytesFromBase64(adaptedAsgi.bodyBase64)) === "adapter-bytes",
  "ASGI adapter did not convert the binary server response into a serializable envelope");

  const overCreditBroker = new HostCapabilityBroker({ authorize: () => true });
  const overCreditPort = new ProductHostCapabilityPort({ process: {
    async spawn() { return {}; },
    async pipe(handle, stream, maxBytes) { return new Uint8Array(maxBytes + 1); },
    async wait() { return { terminal: true, state: "completed", exitCode: 0 }; },
  } }).install(overCreditBroker);
  const overCreditSpawn = await call(overCreditBroker, "process:over-credit:spawn", HOSTCALL_OPCODE.processSpawn,
    {}, { flags: HOSTCALL_FLAG.externalEffect });
  const overCreditPipe = await overCreditBroker.dispatch(request("process:over-credit:pipe",
    HOSTCALL_OPCODE.processPipe, { processRef: overCreditSpawn.body.processRef, maxBytes: 8 }));
  assert(overCreditPipe.state === HOSTCALL_STATE.error && overCreditPipe.errorCode === HOSTCALL_ERROR.provider,
    "process pipe adapter credit violation did not produce a typed provider terminal");
  await call(overCreditBroker, "process:over-credit:wait", HOSTCALL_OPCODE.processWait,
    { processRef: overCreditSpawn.body.processRef });
  await overCreditPort.close();

  assert(port.inspectCheckpointBoundary().openResources.length === 0,
    "closed product resources still block checkpoint");
  assert(calls.socketConnect === 2 && calls.socketSend === 1 && calls.socketClose.join(",") === "write,both"
    && calls.processSpawn === 1 && calls.processSignal === 1 && calls.gpu === 3
    && calls.clipboardRead === 1 && calls.clipboardWrite === 1 && calls.framebuffer === 1 && calls.asgi === 1,
  "product adapter send counts changed");
  await port.close();
}
