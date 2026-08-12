// pageCommandBridge.mjs - browser page long-poll의 queue, epoch, cancel, late-result 계약.

export class PageCommandError extends Error {
  constructor(code, message, { outcome = "notSent", retryable = false } = {}) {
    super(message);
    this.name = "PageCommandError";
    this.code = code;
    this.outcome = outcome;
    this.retryable = retryable;
  }
}

export class PageCommandBridge {
  constructor({ timeoutMs = 180000 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("page command timeoutMs must be positive");
    this.timeoutMs = timeoutMs;
    this.pageEpoch = null;
    this.spaceId = null;
    this._queue = [];
    this._pending = new Map();
    this._sequence = 0;
    this._readyWaiters = [];
    this._pollWaiter = null;
  }

  ready({ protocol, version, pageEpoch, spaceId }) {
    if (protocol !== "pyproc-control" || version !== 1 || typeof pageEpoch !== "string" || !pageEpoch
      || typeof spaceId !== "string" || !spaceId) throw new PageCommandError("CONTROL_BRIDGE_HANDSHAKE", "page bridge hello is invalid");
    if (this.pageEpoch && this.pageEpoch !== pageEpoch) {
      if (this._pollWaiter) {
        const waiter = this._pollWaiter;
        this._pollWaiter = null;
        waiter.deliver(null, new PageCommandError("CONTROL_PAGE_REPLACED", "page poll was replaced by a new epoch"));
      }
      for (const record of this._pending.values()) {
        if (record.state === "delivered" && record.pageEpoch !== pageEpoch) {
          this._finish(record, new PageCommandError("CONTROL_PAGE_REPLACED", "page was replaced after command delivery", {
            outcome: "outcomeUnknown", retryable: false,
          }));
        }
      }
    }
    this.pageEpoch = pageEpoch;
    this.spaceId = spaceId;
    for (const resolve of this._readyWaiters.splice(0)) resolve();
    return Object.freeze({ ready: true, pageEpoch, spaceId });
  }

  waitForReady() {
    if (this.pageEpoch) return Promise.resolve();
    return new Promise((resolve) => this._readyWaiters.push(resolve));
  }

  dispatch(operation, input, { signal, requestId = `page:${++this._sequence}` } = {}) {
    if (this._pending.has(requestId)) return Promise.reject(new PageCommandError("CONTROL_REQUEST_DUPLICATE", `page request ID is active: ${requestId}`));
    return new Promise((resolve, reject) => {
      const record = { requestId, operation, input, state: "queued", pageEpoch: null, resolve, reject, timer: null, abort: null, signal };
      const finishCancel = (reason) => {
        const outcome = record.state === "queued" ? "notSent" : "outcomeUnknown";
        this._finish(record, new PageCommandError("CONTROL_CANCELLED", String(reason || "page command cancelled"), {
          outcome, retryable: false,
        }));
      };
      if (signal?.aborted) { finishCancel(signal.reason); return; }
      if (signal) {
        record.abort = () => finishCancel(signal.reason);
        signal.addEventListener("abort", record.abort, { once: true });
      }
      record.timer = setTimeout(() => {
        const delivered = record.state === "delivered";
        this._finish(record, new PageCommandError("CONTROL_TIMEOUT", `page command timed out: ${operation}`, {
          outcome: delivered ? "outcomeUnknown" : "notSent", retryable: !delivered,
        }));
      }, this.timeoutMs);
      this._pending.set(requestId, record);
      this._queue.push(record);
      this._drainPoll();
    });
  }

  poll(pageEpoch) {
    if (!this.pageEpoch || pageEpoch !== this.pageEpoch) throw new PageCommandError("CONTROL_PAGE_STALE", "page epoch is stale");
    while (this._queue.length) {
      const record = this._queue.shift();
      if (record.state !== "queued") continue;
      record.state = "delivered";
      record.pageEpoch = pageEpoch;
      return Object.freeze({ requestId: record.requestId, operation: record.operation, input: record.input, pageEpoch });
    }
    return null;
  }

  holdPoll(pageEpoch, deliver) {
    if (this._pollWaiter) throw new PageCommandError("CONTROL_POLL_CONFLICT", "only one page poll may be held");
    this._pollWaiter = { pageEpoch, deliver };
    this._drainPoll();
    return () => { if (this._pollWaiter?.deliver === deliver) this._pollWaiter = null; };
  }

  result({ requestId, pageEpoch, ok, value, error }) {
    const record = this._pending.get(requestId);
    if (!record || record.state !== "delivered") return Object.freeze({ accepted: false, reason: "late-or-unknown" });
    if (pageEpoch !== record.pageEpoch || pageEpoch !== this.pageEpoch) return Object.freeze({ accepted: false, reason: "stale-page" });
    if (ok === true) this._finish(record, null, value);
    else {
      const failure = new PageCommandError(error?.code || "PYPROC_INTERNAL", String(error?.message || "page command failed"), {
        outcome: error?.outcome || "notSent", retryable: error?.retryable === true,
      });
      if (error?.details && typeof error.details === "object") failure.details = error.details;
      this._finish(record, failure);
    }
    return Object.freeze({ accepted: true });
  }

  close() {
    for (const record of [...this._pending.values()]) {
      const delivered = record.state === "delivered";
      this._finish(record, new PageCommandError("CONTROL_BRIDGE_CLOSED", "page command bridge closed", {
        outcome: delivered ? "outcomeUnknown" : "notSent", retryable: !delivered,
      }));
    }
    this._pollWaiter = null;
  }

  _drainPoll() {
    if (!this._pollWaiter) return;
    let command;
    try { command = this.poll(this._pollWaiter.pageEpoch); }
    catch (error) { const waiter = this._pollWaiter; this._pollWaiter = null; waiter.deliver(null, error); return; }
    if (!command) return;
    const waiter = this._pollWaiter;
    this._pollWaiter = null;
    waiter.deliver(command, null);
  }

  _finish(record, error, value) {
    if (!record || record.state === "terminal") return false;
    record.state = "terminal";
    clearTimeout(record.timer);
    if (record.abort) record.signal?.removeEventListener("abort", record.abort);
    record.abort = null;
    this._pending.delete(record.requestId);
    const index = this._queue.indexOf(record);
    if (index >= 0) this._queue.splice(index, 1);
    if (error) record.reject(error);
    else record.resolve(value);
    return true;
  }
}
