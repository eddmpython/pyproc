// cdpConnection.mjs - broker가 띄운 브라우저와 --remote-debugging-pipe로만 잇는 최소 CDP 연결.
// 메시지 의미론(요청 id, 대기, 시간 초과, 이벤트)은 운반 채널과 분리한다. 제품의 채널은 브라우저 프로세스의
// fd 3(브라우저가 읽음)과 fd 4(브라우저가 씀) pipe이고 메시지는 NUL로 끝나는 JSON이다. loopback DevTools
// listener를 열지 않으므로 같은 사용자 공간의 다른 프로세스가 브라우저 제어권에 붙을 입구가 없다.

const DEFAULT_TIMEOUT_MS = 10000;
const MESSAGE_END = 0;

/** CDP 메시지 채널: 문자열을 보내고, 받은 문자열과 닫힘을 알린다. */
export function cdpPipeChannel(pipe) {
  const { write, read } = pipe || {};
  if (!write || typeof write.write !== "function" || !read || typeof read.on !== "function") {
    throw new TypeError("CDP pipe requires the browser's writable fd 3 and readable fd 4 streams");
  }
  let onMessage = () => {};
  let onClose = () => {};
  let parts = [];
  const closeWith = (error) => onClose(error);
  read.on("data", (chunk) => {
    let start = 0;
    let end = chunk.indexOf(MESSAGE_END, start);
    while (end >= 0) {
      parts.push(chunk.subarray(start, end));
      const message = Buffer.concat(parts).toString("utf8");
      parts = [];
      onMessage(message);
      start = end + 1;
      end = chunk.indexOf(MESSAGE_END, start);
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  });
  read.on("end", () => closeWith(new Error("CDP pipe closed by the browser")));
  read.on("close", () => closeWith(new Error("CDP pipe closed by the browser")));
  read.on("error", (error) => closeWith(new Error(`CDP pipe read failed: ${errorMessage(error)}`)));
  write.on?.("error", (error) => closeWith(new Error(`CDP pipe write failed: ${errorMessage(error)}`)));
  return Object.freeze({
    listen(messageListener, closeListener) { onMessage = messageListener; onClose = closeListener; },
    send(text) { write.write(Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([MESSAGE_END])])); },
    close() {
      try { write.end(); } catch (error) {}
      try { read.destroy(); } catch (error) {}
    },
  });
}

function errorMessage(value) {
  return String(value?.message || value || "unknown CDP error");
}

function cdpError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

function clearPending(pending) {
  clearTimeout(pending.timer);
  pending.signal?.removeEventListener("abort", pending.onAbort);
}

export class CdpConnection {
  /** Connect to a browser launched with `launchBrowser(url, { cdpPipe: true })`. */
  static overPipe(cdpPipe, options = {}) {
    return new CdpConnection(cdpPipeChannel(cdpPipe), options);
  }

  constructor(channel, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!channel || typeof channel.send !== "function" || typeof channel.listen !== "function") {
      throw new TypeError("CDP channel must send and listen");
    }
    this._channel = channel;
    this._timeoutMs = timeoutMs;
    this._nextId = 0;
    this._pending = new Map();
    this._listeners = new Set();
    this._closed = false;
    channel.listen((data) => this._receive(data), (error) => this._finish(error));
  }

  send(method, params = {}, sessionId = undefined, { signal } = {}) {
    if (this._closed) {
      return Promise.reject(cdpError(`CDP connection is closed: ${method}`, { outcomeUnknown: false }));
    }
    if (signal?.aborted) {
      return Promise.reject(cdpError(`CDP command cancelled before send: ${method}`, {
        cancelled: true,
        outcomeUnknown: false,
      }));
    }
    const id = ++this._nextId;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this._pending.get(id);
        if (!pending) return;
        this._pending.delete(id);
        clearPending(pending);
        reject(cdpError(`CDP command timeout: ${method}`, { outcomeUnknown: true, timedOut: true }));
      }, this._timeoutMs);
      const onAbort = () => {
        const pending = this._pending.get(id);
        if (!pending) return;
        this._pending.delete(id);
        clearPending(pending);
        reject(cdpError(`CDP command cancelled after send: ${method}`, {
          cancelled: true,
          outcomeUnknown: true,
        }));
      };
      const pending = { method, resolve, reject, timer, signal, onAbort };
      this._pending.set(id, pending);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this._channel.send(JSON.stringify(message));
      } catch (error) {
        this._pending.delete(id);
        clearPending(pending);
        reject(cdpError(errorMessage(error), { outcomeUnknown: false, cause: error }));
      }
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("CDP listener must be a function");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  inspect() {
    return Object.freeze({
      closed: this._closed,
      pending: this._pending.size,
      listeners: this._listeners.size,
    });
  }

  once(method, predicate = () => true, timeoutMs = this._timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
      const unsubscribe = this.subscribe((event) => {
        if (event.method !== method || !predicate(event)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      });
    });
  }

  close() {
    if (this._closed) return;
    this._finish(new Error("CDP connection closed by client"));
    this._channel.close();
  }

  _receive(data) {
    let message;
    try { message = JSON.parse(String(data)); }
    catch (error) {
      this._finish(new Error(`CDP message parse failed: ${errorMessage(error)}`));
      return;
    }
    if (Number.isInteger(message.id)) {
      const pending = this._pending.get(message.id);
      if (!pending) return;
      this._pending.delete(message.id);
      clearPending(pending);
      if (message.error) {
        pending.reject(cdpError(`CDP ${pending.method} failed (${message.error.code}): ${message.error.message}`, {
          outcomeUnknown: false,
          protocolRejected: true,
          protocolCode: message.error.code,
        }));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    if (!message.method) return;
    const event = Object.freeze({
      method: message.method,
      params: message.params || {},
      sessionId: message.sessionId || null,
    });
    for (const listener of [...this._listeners]) listener(event);
  }

  _finish(error) {
    if (this._closed) return;
    this._closed = true;
    for (const pending of this._pending.values()) {
      clearPending(pending);
      pending.reject(cdpError(errorMessage(error), { outcomeUnknown: true, cause: error }));
    }
    this._pending.clear();
    this._listeners.clear();
  }
}
