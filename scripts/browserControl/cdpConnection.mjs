// cdpConnection.mjs - Node 22 표준 WebSocket만 사용하는 최소 CDP 연결.

const DEFAULT_TIMEOUT_MS = 10000;

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
  static async connect(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof WebSocket !== "function") throw new Error("Node WebSocket is unavailable");
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        try { socket.close(); } catch (error) {}
        finish(reject, new Error("CDP connect timeout"));
      }, timeoutMs);
      socket.addEventListener("open", () => finish(resolve), { once: true });
      socket.addEventListener("error", (event) => {
        finish(reject, new Error(`CDP connect failed: ${errorMessage(event.error)}`));
      }, { once: true });
    });
    return new CdpConnection(socket, { timeoutMs });
  }

  constructor(socket, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this._socket = socket;
    this._timeoutMs = timeoutMs;
    this._nextId = 0;
    this._pending = new Map();
    this._listeners = new Set();
    this._closed = false;
    socket.addEventListener("message", (event) => this._receive(event.data));
    socket.addEventListener("close", () => this._finish(new Error("CDP connection closed")));
    socket.addEventListener("error", (event) => this._finish(new Error(`CDP socket error: ${errorMessage(event.error)}`)));
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
        this._socket.send(JSON.stringify(message));
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
    this._socket.close();
    this._finish(new Error("CDP connection closed by client"));
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
