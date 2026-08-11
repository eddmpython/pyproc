// browserTrace.js - bounded action, command, outcome 원장. action input과 페이지 payload는 기록하지 않는다.

export const BROWSER_TRACE_SCHEMA_VERSION = "1";
export const BROWSER_TRACE_MAX_COMMANDS_PER_STEP = 64;

function commandRecord(entry) {
  const result = entry.result || {};
  return Object.freeze({
    method: entry.method,
    requestId: result.requestId || null,
    state: result.state || (entry.error ? "failed" : "unknown"),
    risk: result.risk || null,
    contextEpoch: Number.isInteger(result.contextEpoch) ? result.contextEpoch : null,
    ...(entry.error ? {
      code: entry.error.code || "PYPROC_INTERNAL",
      outcome: entry.error.outcome || "notSent",
      retryable: entry.error.retryable === true,
    } : {}),
  });
}

export class BrowserTrace {
  constructor({ traceId, runId, now = () => Date.now() } = {}) {
    if (!traceId || !runId) throw new TypeError("browser traceId and runId are required");
    if (typeof now !== "function") throw new TypeError("browser trace clock is required");
    this._traceId = traceId;
    this._runId = runId;
    this._now = now;
    this._startedAt = now();
    this._steps = [];
    this._finished = null;
  }

  begin({ index, actionId, kind, risk }) {
    if (this._finished) throw new Error("browser trace is already finished");
    return Object.freeze({ index, actionId, kind, risk, startedAt: this._now() });
  }

  complete(token, commandResults) {
    this._steps.push(this._step(token, commandResults, {
      state: token.risk === "read" ? "observed" : "applied",
      outcome: token.risk === "read" ? "observed" : "applied",
    }));
  }

  fail(token, commandResults, error) {
    this._steps.push(this._step(token, commandResults, {
      state: "failed",
      outcome: error?.outcome || "notSent",
      code: error?.code || "PYPROC_INTERNAL",
      retryable: error?.retryable === true,
    }));
  }

  finish(state) {
    if (!this._finished) {
      const finishedAt = this._now();
      this._finished = Object.freeze({
        schemaVersion: BROWSER_TRACE_SCHEMA_VERSION,
        traceId: this._traceId,
        runId: this._runId,
        state,
        startedAt: this._startedAt,
        durationMs: Math.max(0, finishedAt - this._startedAt),
        steps: Object.freeze([...this._steps]),
      });
    }
    return this._finished;
  }

  _step(token, commandResults, outcome) {
    const all = commandResults.map(commandRecord);
    const commands = all.slice(-BROWSER_TRACE_MAX_COMMANDS_PER_STEP);
    return Object.freeze({
      index: token.index,
      actionId: token.actionId,
      kind: token.kind,
      risk: token.risk,
      state: outcome.state,
      outcome: outcome.outcome,
      ...(outcome.code ? { code: outcome.code, retryable: outcome.retryable } : {}),
      durationMs: Math.max(0, this._now() - token.startedAt),
      commandCount: all.length,
      omittedCommands: Math.max(0, all.length - commands.length),
      commands: Object.freeze(commands),
    });
  }
}
