// browserLifecycle.js - click와 동시에 발생해 command 응답을 막을 수 있는 page lifecycle event waiter.
import { BrowserControlError, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

export class BrowserLifecycle {
  constructor({ port } = {}) {
    if (!port || typeof port.subscribe !== "function") throw new TypeError("browser lifecycle port is required");
    this._port = port;
    this._sessions = new Map();
  }

  watch(sessionRef, method, { timeoutMs, signal, timeoutOutcome = "notSent", predicate = () => true } = {}) {
    if (typeof method !== "string" || !method) throw new TypeError("browser lifecycle event method is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("browser lifecycle timeout is invalid");
    if (typeof predicate !== "function") throw new TypeError("browser lifecycle predicate is invalid");
    const session = this._ensureSession(sessionRef);
    let settled = false;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    promise.catch(() => {});
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      session.watchers.delete(watcher);
      callback(value);
    };
    const watcher = {
      method,
      predicate,
      deliver: (event) => finish(resolvePromise, event),
      cancel: null,
    };
    const abort = () => finish(rejectPromise, new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
      `browser lifecycle wait was cancelled: ${method}`, { outcome: timeoutOutcome }));
    const timer = setTimeout(() => finish(rejectPromise, new BrowserControlError("BROWSER_AUTOMATION_EVENT_TIMEOUT",
      `browser lifecycle event timed out: ${method}`, { outcome: timeoutOutcome })), timeoutMs);
    watcher.cancel = () => finish(rejectPromise, new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
      `browser lifecycle wait was cancelled: ${method}`, { outcome: timeoutOutcome }));
    session.watchers.add(watcher);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const queuedIndex = session.queue.findIndex((event) => event.method === method && predicate(event));
    if (queuedIndex >= 0) watcher.deliver(session.queue.splice(queuedIndex, 1)[0]);
    return Object.freeze({
      promise,
      cancel: watcher.cancel,
    });
  }

  dropSession(sessionRef) {
    const key = sessionKey(sessionRef);
    const session = this._sessions.get(key);
    if (!session) return;
    session.unsubscribe();
    for (const watcher of [...session.watchers]) watcher.cancel();
    session.watchers.clear();
    this._sessions.delete(key);
  }

  close() {
    for (const session of this._sessions.values()) {
      session.unsubscribe();
      for (const watcher of [...session.watchers]) watcher.cancel();
    }
    this._sessions.clear();
  }

  inspect() {
    let watchers = 0;
    let queuedEvents = 0;
    for (const session of this._sessions.values()) {
      watchers += session.watchers.size;
      queuedEvents += session.queue.length;
    }
    return Object.freeze({ sessions: this._sessions.size, watchers, queuedEvents });
  }

  _ensureSession(sessionRef) {
    const key = sessionKey(sessionRef);
    const present = this._sessions.get(key);
    if (present) return present;
    const session = { watchers: new Set(), queue: [], unsubscribe: null };
    session.unsubscribe = this._port.subscribe(sessionRef, (event) => {
      let delivered = false;
      for (const watcher of [...session.watchers]) {
        if (watcher.method === event.method && watcher.predicate(event)) {
          watcher.deliver(event);
          delivered = true;
        }
      }
      if (!delivered) {
        session.queue.push(event);
        if (session.queue.length > 32) session.queue.splice(0, session.queue.length - 32);
      }
    });
    this._sessions.set(key, session);
    return session;
  }
}
