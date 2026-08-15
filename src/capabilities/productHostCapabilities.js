// productHostCapabilities.js - Layer 2: typed browser product adapters for the hostcall ABI.
import { base64FromBytes, bytesFromBase64, sha256Address } from "../runtime/contentDigest.js";
import { PyProcError } from "../runtime/errors.js";
import { HOSTCALL_OPCODE, HOSTCALL_STREAM_MAX_CREDIT } from "../runtime/kernel/hostcallProtocol.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

function inputError(message) {
  return new PyProcError("PYPROC_INPUT_INVALID", message);
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw inputError(`${label} must be an object`);
  return value;
}

function decodePayload(request, label) {
  try {
    return plain(JSON.parse(decoder.decode(request.payload)), label);
  } catch (error) {
    if (error instanceof PyProcError) throw error;
    throw inputError(`${label} is not valid UTF-8 JSON`);
  }
}

function stringValue(value, label) {
  if (typeof value !== "string" || !value) throw inputError(`${label} must be a non-empty string`);
  return value;
}

function creditValue(value, label = "creditBytes") {
  if (!Number.isSafeInteger(value) || value < 1 || value > HOSTCALL_STREAM_MAX_CREDIT) {
    throw inputError(`${label} must be between 1 and ${HOSTCALL_STREAM_MAX_CREDIT}`);
  }
  return value;
}

function byteValue(value, label) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw inputError(`${label} must be bytes or a string`);
}

function bodyBytes(input, field = "bodyBase64") {
  const encoded = input[field];
  if (encoded === undefined || encoded === null || encoded === "") return new Uint8Array();
  if (typeof encoded !== "string") throw inputError(`${field} must be base64 text`);
  return bytesFromBase64(encoded);
}

function asIterator(body) {
  if (body === undefined || body === null) return new Uint8Array()[Symbol.iterator]();
  if (body && typeof body[Symbol.asyncIterator] === "function") return body[Symbol.asyncIterator]();
  if (body && typeof body[Symbol.iterator] === "function" && typeof body !== "string"
    && !(body instanceof Uint8Array)) return body[Symbol.iterator]();
  return [byteValue(body, "response body")][Symbol.iterator]();
}

class BoundedByteStream {
  constructor(body, cancel = null) {
    this.iterator = asIterator(body);
    this.cancelSource = cancel;
    this.pending = new Uint8Array();
    this.done = false;
    this.cancelled = false;
  }

  async read(creditBytes, signal) {
    const chunks = [];
    let total = 0;
    while (total < creditBytes && !this.done) {
      if (signal?.aborted) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Host stream read was cancelled");
      if (this.pending.byteLength) {
        const length = Math.min(creditBytes - total, this.pending.byteLength);
        chunks.push(this.pending.slice(0, length));
        this.pending = this.pending.slice(length);
        total += length;
        continue;
      }
      const next = await this._next(signal);
      if (next.done) { this.done = true; break; }
      this.pending = byteValue(next.value, "stream chunk");
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return Object.freeze({ bytes, done: this.done && this.pending.byteLength === 0 });
  }

  _next(signal) {
    if (!signal) return this.iterator.next();
    if (signal.aborted) return Promise.reject(new PyProcError(
      "PYPROC_PROCESS_UNAVAILABLE", "Host stream read was cancelled"));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => {
        this.cancel("Host stream read was cancelled").finally(() => finish(reject,
          new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Host stream read was cancelled")));
      };
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(this.iterator.next()).then((value) => finish(resolve, value),
        (error) => finish(reject, error));
    });
  }

  async cancel(reason = "cancelled") {
    if (this.cancelled) return;
    this.cancelled = true;
    this.done = true;
    this.pending = new Uint8Array();
    if (typeof this.cancelSource === "function") await this.cancelSource(reason);
    if (typeof this.iterator.return === "function") await this.iterator.return();
  }
}

function adapterMethod(adapter, method, capability) {
  if (!adapter || typeof adapter[method] !== "function") {
    throw new PyProcError("PYPROC_ENV_UNSUPPORTED", `${capability} host capability is unavailable`);
  }
  return adapter[method].bind(adapter);
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map((entry) => [String(entry[0]), String(entry[1])]);
  if (typeof headers.entries === "function") return [...headers.entries()].map(([key, value]) => [key, value]);
  return Object.entries(headers).map(([key, value]) => [key, String(value)]);
}

export class ProductHostCapabilityPort {
  constructor({ http = null, socket = null, process = null, gpu = null, clipboard = null,
    framebuffer = null, asgi = null } = {}) {
    this.adapters = Object.freeze({ http, socket, process, gpu, clipboard, framebuffer, asgi });
    this.httpBodies = new Map();
    this.sockets = new Map();
    this.processes = new Map();
    this.installed = false;
    this.removeCheckpointInspector = null;
  }

  install(broker) {
    if (this.installed || !broker || typeof broker.register !== "function") {
      throw inputError("Product host capability port requires one uninstalled HostCapabilityBroker");
    }
    const bind = (opcode, name, authority, effect, handler) => broker.register({
      opcode, name, authority, effect, explicitEffectBoundary: effect,
      handler: (request) => handler.call(this, request),
    });
    bind(HOSTCALL_OPCODE.httpRequest, "http.request", "network.http", true, this._httpRequest);
    bind(HOSTCALL_OPCODE.httpBodyRead, "http.body.read", "network.http", false, this._httpBodyRead);
    bind(HOSTCALL_OPCODE.httpCancel, "http.cancel", "network.http", false, this._httpCancel);
    bind(HOSTCALL_OPCODE.socketConnect, "socket.connect", "network.socket", true, this._socketConnect);
    bind(HOSTCALL_OPCODE.socketSend, "socket.send", "network.socket", true, this._socketSend);
    bind(HOSTCALL_OPCODE.socketReceive, "socket.receive", "network.socket", false, this._socketReceive);
    bind(HOSTCALL_OPCODE.socketClose, "socket.close", "network.socket", false, this._socketClose);
    bind(HOSTCALL_OPCODE.processSpawn, "process.spawn", "process.spawn", true, this._processSpawn);
    bind(HOSTCALL_OPCODE.processWait, "process.wait", "process.spawn", false, this._processWait);
    bind(HOSTCALL_OPCODE.processSignal, "process.signal", "process.signal", true, this._processSignal);
    bind(HOSTCALL_OPCODE.processPipe, "process.pipe", "process.spawn", false, this._processPipe);
    bind(HOSTCALL_OPCODE.gpuDispatch, "gpu.dispatch", "accelerator.gpu", false, this._gpuDispatch);
    bind(HOSTCALL_OPCODE.clipboardRead, "clipboard.read", "device.clipboard.read", false, this._clipboardRead);
    bind(HOSTCALL_OPCODE.clipboardWrite, "clipboard.write", "device.clipboard.write", true, this._clipboardWrite);
    bind(HOSTCALL_OPCODE.framebufferPublish, "framebuffer.publish", "device.framebuffer", true,
      this._framebufferPublish);
    bind(HOSTCALL_OPCODE.asgiExchange, "asgi.exchange", "application.asgi", true, this._asgiExchange);
    if (typeof broker.addCheckpointInspector === "function") {
      this.removeCheckpointInspector = broker.addCheckpointInspector(() => this.inspectCheckpointBoundary());
    }
    this.installed = true;
    return this;
  }

  inspectCheckpointBoundary() {
    const openResources = [
      ...[...this.httpBodies.keys()].map((resourceRef) => Object.freeze({
        kind: "httpBody", resourceRef, disposition: "forbidden",
      })),
      ...[...this.sockets.keys()].map((resourceRef) => Object.freeze({
        kind: "socket", resourceRef, disposition: "forbidden",
      })),
      ...[...this.processes.keys()].map((resourceRef) => Object.freeze({
        kind: "process", resourceRef, disposition: "forbidden",
      })),
    ];
    return Object.freeze({ acceptedHostcalls: 0, activeTransactions: 0, outputDrained: true,
      openResources: Object.freeze(openResources), vfsRootDigest: null });
  }

  async close(reason = "port closed") {
    const operations = [];
    for (const body of this.httpBodies.values()) operations.push(body.cancel(reason));
    for (const entry of this.sockets.values()) {
      const close = this.adapters.socket?.close;
      if (typeof close === "function") operations.push(close.call(this.adapters.socket, entry.handle, "both"));
    }
    for (const entry of this.processes.values()) {
      const signal = this.adapters.process?.signal;
      if (typeof signal === "function") operations.push(signal.call(this.adapters.process, entry.handle, "terminate"));
    }
    await Promise.allSettled(operations);
    this.httpBodies.clear();
    this.sockets.clear();
    this.processes.clear();
    if (this.removeCheckpointInspector) this.removeCheckpointInspector();
    this.removeCheckpointInspector = null;
  }

  async _httpRequest(request) {
    const input = decodePayload(request, "HTTP request");
    stringValue(input.url, "HTTP URL");
    let parsedUrl;
    try { parsedUrl = new URL(input.url); }
    catch (error) { throw inputError("HTTP URL is invalid"); }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw inputError("HTTP URL protocol must be http or https");
    }
    const send = adapterMethod(this.adapters.http, "request", "HTTP");
    request.markSent();
    const response = plain(await send({ ...input, body: bodyBytes(input) }, { signal: request.signal }),
      "HTTP response");
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "HTTP adapter returned an invalid status");
    }
    const bodyRef = response.body === undefined || response.body === null
      ? null : `httpBody:${request.requestKey}`;
    if (bodyRef) this.httpBodies.set(bodyRef, new BoundedByteStream(response.body, async (reason) => {
      this.httpBodies.delete(bodyRef);
      if (typeof response.cancel === "function") await response.cancel.call(response, reason);
    }));
    return Object.freeze({ status: response.status, headers: normalizeHeaders(response.headers),
      url: response.url || input.url, redirected: response.redirected === true,
      bodyRef, bodyDone: bodyRef === null });
  }

  async _httpBodyRead(request) {
    const input = decodePayload(request, "HTTP body read");
    const bodyRef = stringValue(input.bodyRef, "HTTP bodyRef");
    const body = this.httpBodies.get(bodyRef);
    if (!body) throw inputError("HTTP bodyRef is unknown or already drained");
    let chunk;
    try { chunk = await body.read(creditValue(input.creditBytes), request.signal); }
    catch (error) {
      this.httpBodies.delete(bodyRef);
      await body.cancel(request.signal?.aborted ? "HTTP body read was cancelled" : "HTTP body read failed");
      throw error;
    }
    if (chunk.done) this.httpBodies.delete(bodyRef);
    return Object.freeze({ bodyRef, bodyBase64: base64FromBytes(chunk.bytes), byteLength: chunk.bytes.byteLength,
      done: chunk.done });
  }

  async _httpCancel(request) {
    const input = decodePayload(request, "HTTP cancel");
    const bodyRef = stringValue(input.bodyRef, "HTTP bodyRef");
    const body = this.httpBodies.get(bodyRef);
    if (!body) return Object.freeze({ bodyRef, cancelled: false });
    this.httpBodies.delete(bodyRef);
    await body.cancel("HTTP body cancelled");
    return Object.freeze({ bodyRef, cancelled: true });
  }

  async _socketConnect(request) {
    const input = decodePayload(request, "Socket connect");
    stringValue(input.host, "Socket host");
    if (!Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw inputError("Socket port must be an integer between 1 and 65535");
    }
    const connect = adapterMethod(this.adapters.socket, "connect", "Socket relay");
    request.markSent();
    const handle = await connect(input, { signal: request.signal });
    const socketRef = `socket:${request.requestKey}`;
    this.sockets.set(socketRef, { handle, pending: new Uint8Array() });
    return Object.freeze({ socketRef, connected: true });
  }

  async _socketSend(request) {
    const input = decodePayload(request, "Socket send");
    const socketRef = stringValue(input.socketRef, "Socket socketRef");
    const entry = this.sockets.get(socketRef);
    if (!entry) throw inputError("Socket socketRef is unknown");
    const bytes = bodyBytes(input, "dataBase64");
    const send = adapterMethod(this.adapters.socket, "send", "Socket relay");
    request.markSent();
    await send(entry.handle, bytes, { signal: request.signal });
    return Object.freeze({ socketRef, byteLength: bytes.byteLength });
  }

  async _socketReceive(request) {
    const input = decodePayload(request, "Socket receive");
    const socketRef = stringValue(input.socketRef, "Socket socketRef");
    const entry = this.sockets.get(socketRef);
    if (!entry) throw inputError("Socket socketRef is unknown");
    const maxBytes = creditValue(input.maxBytes, "maxBytes");
    if (!entry.pending.byteLength) {
      const receive = adapterMethod(this.adapters.socket, "receive", "Socket relay");
      entry.pending = byteValue(await receive(entry.handle, { signal: request.signal }), "socket data");
    }
    const bytes = entry.pending.slice(0, maxBytes);
    entry.pending = entry.pending.slice(bytes.byteLength);
    return Object.freeze({ socketRef, dataBase64: base64FromBytes(bytes), byteLength: bytes.byteLength,
      eof: bytes.byteLength === 0 });
  }

  async _socketClose(request) {
    const input = decodePayload(request, "Socket close");
    const socketRef = stringValue(input.socketRef, "Socket socketRef");
    const entry = this.sockets.get(socketRef);
    if (!entry) return Object.freeze({ socketRef, closed: false });
    const direction = input.direction || "both";
    if (!["write", "both"].includes(direction)) throw inputError("Socket close direction must be write or both");
    const close = adapterMethod(this.adapters.socket, "close", "Socket relay");
    await close(entry.handle, direction, { signal: request.signal });
    if (direction === "both") this.sockets.delete(socketRef);
    return Object.freeze({ socketRef, closed: direction === "both", writeClosed: true });
  }

  async _processSpawn(request) {
    const input = decodePayload(request, "Process spawn");
    const spawn = adapterMethod(this.adapters.process, "spawn", "Process");
    request.markSent();
    const handle = await spawn(input, { signal: request.signal });
    const processRef = `process:${request.requestKey}`;
    this.processes.set(processRef, { handle });
    return Object.freeze({ processRef, spawned: true });
  }

  async _processWait(request) {
    const input = decodePayload(request, "Process wait");
    const processRef = stringValue(input.processRef, "Process processRef");
    const entry = this.processes.get(processRef);
    if (!entry) throw inputError("Process processRef is unknown");
    const wait = adapterMethod(this.adapters.process, "wait", "Process");
    const result = await wait(entry.handle, { signal: request.signal });
    if (result?.terminal !== false) this.processes.delete(processRef);
    return Object.freeze({ processRef, ...plain(result, "Process wait result") });
  }

  async _processSignal(request) {
    const input = decodePayload(request, "Process signal");
    const processRef = stringValue(input.processRef, "Process processRef");
    const entry = this.processes.get(processRef);
    if (!entry) throw inputError("Process processRef is unknown");
    const processSignal = input.signal || "terminate";
    if (!["interrupt", "terminate", "kill"].includes(processSignal)) {
      throw inputError("Process signal must be interrupt, terminate, or kill");
    }
    const signal = adapterMethod(this.adapters.process, "signal", "Process");
    request.markSent();
    const result = await signal(entry.handle, processSignal, { signal: request.signal });
    return Object.freeze({ processRef, signalled: true, result: result ?? null });
  }

  async _processPipe(request) {
    const input = decodePayload(request, "Process pipe read");
    const processRef = stringValue(input.processRef, "Process processRef");
    const entry = this.processes.get(processRef);
    if (!entry) throw inputError("Process processRef is unknown");
    const pipe = adapterMethod(this.adapters.process, "pipe", "Process");
    const maxBytes = creditValue(input.maxBytes, "maxBytes");
    const bytes = byteValue(await pipe(entry.handle, input.stream || "stdout",
      maxBytes, { signal: request.signal }), "process pipe data");
    if (bytes.byteLength > maxBytes) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "Process adapter exceeded the pipe read credit");
    }
    return Object.freeze({ processRef, stream: input.stream || "stdout", dataBase64: base64FromBytes(bytes),
      byteLength: bytes.byteLength });
  }

  async _gpuDispatch(request) {
    const input = decodePayload(request, "GPU dispatch");
    const dispatch = adapterMethod(this.adapters.gpu, "dispatch", "GPU");
    const result = await dispatch(input, { signal: request.signal });
    if (result instanceof Uint8Array || result instanceof ArrayBuffer || ArrayBuffer.isView(result)) {
      const bytes = byteValue(result, "GPU result");
      return Object.freeze({ dataBase64: base64FromBytes(bytes), byteLength: bytes.byteLength });
    }
    return plain(result, "GPU result");
  }

  async _clipboardRead(request) {
    const input = decodePayload(request, "Clipboard read");
    const read = adapterMethod(this.adapters.clipboard, "read", "Clipboard");
    const text = await read(input, { signal: request.signal });
    return Object.freeze({ text: String(text), redacted: false });
  }

  async _clipboardWrite(request) {
    const input = decodePayload(request, "Clipboard write");
    if (typeof input.text !== "string") throw inputError("Clipboard text must be a string");
    const write = adapterMethod(this.adapters.clipboard, "write", "Clipboard");
    request.markSent();
    await write(input.text, input, { signal: request.signal });
    return Object.freeze({ written: true, byteLength: new TextEncoder().encode(input.text).byteLength,
      redacted: true });
  }

  async _framebufferPublish(request) {
    const input = decodePayload(request, "Framebuffer publish");
    if (!Number.isSafeInteger(input.width) || input.width < 1
      || !Number.isSafeInteger(input.height) || input.height < 1) {
      throw inputError("Framebuffer dimensions must be positive integers");
    }
    const bytes = bodyBytes(input, "dataBase64");
    if (bytes.byteLength !== input.width * input.height * 4) {
      throw inputError("Framebuffer RGBA byte length does not match dimensions");
    }
    const publish = adapterMethod(this.adapters.framebuffer, "publish", "Framebuffer");
    const digest = await sha256Address(bytes);
    request.markSent();
    await publish({ bytes, width: input.width, height: input.height,
      mediaType: input.mediaType || "image/rgba", digest }, { signal: request.signal });
    return Object.freeze({ published: true, width: input.width, height: input.height,
      mediaType: input.mediaType || "image/rgba", byteLength: bytes.byteLength, digest });
  }

  async _asgiExchange(request) {
    const input = decodePayload(request, "ASGI exchange");
    stringValue(input.method, "ASGI method");
    stringValue(input.path, "ASGI path");
    const exchange = adapterMethod(this.adapters.asgi, "exchange", "ASGI");
    if (this.adapters.asgi?.kernelRef === request.kernelRef) {
      throw inputError("ASGI hostcall cannot reenter its source kernel");
    }
    request.markSent();
    return plain(await exchange(input, { signal: request.signal, kernelRef: request.kernelRef }), "ASGI response");
  }
}

export function createFetchHostAdapter(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw inputError("Fetch host adapter requires fetch");
  return Object.freeze({
    async request(input, { signal } = {}) {
      const response = await fetchImpl(input.url, { method: input.method || "GET",
        headers: input.headers || [], body: input.body.byteLength ? input.body : undefined,
        redirect: input.redirect || "follow", signal });
      let body = null;
      let cancel = null;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        body = { async *[Symbol.asyncIterator]() {
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) return;
              yield next.value;
            }
          } finally { reader.releaseLock(); }
        } };
        cancel = (reason) => reader.cancel(reason);
      } else body = new Uint8Array(await response.arrayBuffer());
      return Object.freeze({ status: response.status, headers: [...response.headers.entries()],
        url: response.url, redirected: response.redirected, body, cancel });
    },
  });
}

export function createBrowserClipboardHostAdapter(clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard || typeof clipboard.readText !== "function" || typeof clipboard.writeText !== "function") {
    throw inputError("Clipboard host adapter requires the browser Clipboard API");
  }
  return Object.freeze({ read: () => clipboard.readText(), write: (text) => clipboard.writeText(text) });
}

export function createFramebufferHostAdapter(publish) {
  if (typeof publish !== "function") throw inputError("Framebuffer host adapter requires a publish callback");
  return Object.freeze({ publish });
}

export function createAsgiHostAdapter(server, { kernelRef } = {}) {
  if (!server || typeof server.serve !== "function" || typeof kernelRef !== "string" || !kernelRef) {
    throw inputError("ASGI host adapter requires AsgiServer and its target kernelRef");
  }
  return Object.freeze({ kernelRef, async exchange(input) {
    const result = plain(await server.serve(input.method, input.path, input.body ?? null,
      input.query || "", input.headers || []), "ASGI server response");
    const responseBody = result.bodyBytes === undefined ? byteValue(result.body || "", "ASGI response body")
      : byteValue(result.bodyBytes, "ASGI response body");
    return Object.freeze({ status: result.status, headers: normalizeHeaders(result.headers),
      bodyBase64: base64FromBytes(responseBody), byteLength: responseBody.byteLength });
  } });
}

export function createGpuComputeHostAdapter(gpu) {
  if (!gpu || typeof gpu.array !== "function") throw inputError("GPU host adapter requires GpuCompute");
  return Object.freeze({
    async dispatch(input) {
      if (input.operation !== "vectorAdd") throw inputError("GPU operation must be vectorAdd");
      const leftBytes = bodyBytes(input, "leftBase64");
      const rightBytes = bodyBytes(input, "rightBase64");
      if (leftBytes.byteLength !== rightBytes.byteLength || leftBytes.byteLength % 4 !== 0) {
        throw inputError("GPU vector inputs must have equal f32 byte lengths");
      }
      const length = leftBytes.byteLength / 4;
      const left = gpu.array(new Float32Array(leftBytes.buffer, leftBytes.byteOffset, length), 1, length);
      const right = gpu.array(new Float32Array(rightBytes.buffer, rightBytes.byteOffset, length), 1, length);
      try {
        const result = left.binary(right, "a + b");
        try { return (await result.toArray()).data.buffer; }
        finally { result.destroy(); }
      } finally { left.destroy(); right.destroy(); }
    },
  });
}

export function createKernelProcessHostAdapter(kernelFactory) {
  if (!kernelFactory || typeof kernelFactory.open !== "function") {
    throw inputError("Process host adapter requires KernelFactory.open");
  }
  return Object.freeze({
    async spawn(input) {
      const kernel = await kernelFactory.open(input.manifest || {});
      const execution = typeof input.code === "string" ? kernel.execute({ code: input.code })
        : Promise.resolve({ state: "completed", stdout: [] });
      return { kernel, execution, result: null };
    },
    async wait(handle) {
      if (!handle.result) handle.result = await handle.execution;
      return Object.freeze({ terminal: true, state: handle.result.state, stdout: handle.result.stdout || [] });
    },
    async signal(handle, signal) {
      return signal === "interrupt" ? handle.kernel.interrupt({ reason: "hostcall process signal" })
        : handle.kernel.close();
    },
    async pipe(handle, stream, maxBytes) {
      if (!handle.result) handle.result = await handle.execution;
      const text = (handle.result.stdout || []).filter((entry) => (entry.stream || "stdout") === stream)
        .map((entry) => entry.text).join("\n");
      return new TextEncoder().encode(text).slice(0, maxBytes);
    },
  });
}

export function createSocketRelayHostAdapter({ relayURL, WebSocketImpl = globalThis.WebSocket } = {}) {
  if (typeof relayURL !== "string" || !relayURL || typeof WebSocketImpl !== "function") {
    throw inputError("Socket relay host adapter requires relayURL and WebSocket");
  }
  return Object.freeze({
    connect(input, { signal } = {}) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocketImpl(relayURL);
        socket.binaryType = "arraybuffer";
        const handle = { socket, queue: [], pending: null, closed: false };
        const fail = (message) => reject(new PyProcError("PYPROC_ENV_UNSUPPORTED", message, { retryable: true }));
        const abort = () => { socket.close(); fail("Socket relay connect was cancelled"); };
        signal?.addEventListener("abort", abort, { once: true });
        socket.onopen = () => socket.send(JSON.stringify({ host: input.host, port: input.port }));
        socket.onerror = () => fail("Socket relay transport failed");
        socket.onclose = () => {
          handle.closed = true;
          if (handle.pending) { handle.pending(new Uint8Array()); handle.pending = null; }
        };
        socket.onmessage = (event) => {
          if (typeof event.data === "string") {
            const message = JSON.parse(event.data);
            if (message.type === "connected") {
              signal?.removeEventListener("abort", abort);
              resolve(handle);
            } else if (message.type === "error") fail(`Socket relay failed: ${message.msg || "unknown error"}`);
            else if (message.type === "closed") socket.close();
            return;
          }
          const bytes = new Uint8Array(event.data);
          if (handle.pending) { handle.pending(bytes); handle.pending = null; }
          else handle.queue.push(bytes);
        };
      });
    },
    send(handle, bytes) { handle.socket.send(bytes); },
    receive(handle, { signal } = {}) {
      if (handle.queue.length) return Promise.resolve(handle.queue.shift());
      if (handle.closed) return Promise.resolve(new Uint8Array());
      return new Promise((resolve, reject) => {
        const abort = () => {
          handle.pending = null;
          reject(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Socket receive was cancelled"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        handle.pending = (bytes) => { signal?.removeEventListener("abort", abort); resolve(bytes); };
      });
    },
    close(handle, direction) {
      if (direction === "write") handle.socket.send(JSON.stringify({ type: "halfClose", direction: "write" }));
      else handle.socket.close();
    },
  });
}
