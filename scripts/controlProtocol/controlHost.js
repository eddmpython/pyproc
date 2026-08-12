// controlHost.js - operation 실행, request 단회성, cancel, terminal과 attachment의 정본.
import { controlAttachmentDescriptors, extractControlAttachments } from "./controlAttachments.mjs";
import { controlBase, validateControlFrame } from "./controlProtocol.js";
import { controlSuccessOutcome } from "./controlOperations.js";

function controlErrorDetails(error) {
  const details = {
    ...(Number.isInteger(error?.failedActionIndex) ? { failedActionIndex: error.failedActionIndex } : {}),
    ...(error?.failedAction ? { failedAction: error.failedAction } : {}),
    ...(Array.isArray(error?.completed) ? { completed: error.completed } : {}),
    ...(error?.actionability ? { actionability: error.actionability } : {}),
    ...(error?.trace ? { trace: error.trace } : {}),
    ...(error?.details && typeof error.details === "object" ? error.details : {}),
  };
  return Object.keys(details).length ? details : null;
}

export function canonicalControlError(error) {
  const outcome = ["notSent", "rejected", "applied", "outcomeUnknown"].includes(error?.outcome)
    ? error.outcome : "notSent";
  const retryable = (outcome === "applied" || outcome === "outcomeUnknown")
    ? false : error?.retryable === true;
  const details = controlErrorDetails(error);
  return Object.freeze({
    code: String(error?.code || "PYPROC_INTERNAL"),
    message: String(error?.message || error || "control operation failed").slice(-2000),
    retryable,
    outcome,
    ...(details ? { details } : {}),
  });
}

export class ControlHost {
  constructor({ handlers = {}, operations = [] } = {}) {
    this._handlers = new Map(Object.entries(handlers));
    this.operations = Object.freeze([...operations]);
    this._used = new Set();
    this._active = new Map();
  }

  async request(frame) {
    validateControlFrame(frame);
    if (frame.type !== "request") throw new TypeError("control host requires a request frame");
    if (this._used.has(frame.requestId)) {
      const error = new Error(`control request ID was already used: ${frame.requestId}`);
      error.code = "CONTROL_REQUEST_DUPLICATE";
      throw error;
    }
    const handler = this._handlers.get(frame.operation);
    this._used.add(frame.requestId);
    if (!handler) {
      return Object.freeze({
        terminal: Object.freeze({ ...controlBase("error"), requestId: frame.requestId,
          error: Object.freeze({ code: "CONTROL_OPERATION_UNKNOWN", message: `unknown control operation: ${frame.operation}`, retryable: false, outcome: "notSent" }) }),
        attachments: Object.freeze([]),
      });
    }
    const controller = new AbortController();
    const record = { controller, terminal: false };
    this._active.set(frame.requestId, record);
    try {
      const payload = await handler(frame.input, { signal: controller.signal, requestId: frame.requestId, spaceId: frame.spaceId || null });
      if (record.terminal) return null;
      record.terminal = true;
      const extracted = extractControlAttachments(payload);
      const descriptors = controlAttachmentDescriptors(extracted.attachments);
      const terminal = Object.freeze({
        ...controlBase("response"), requestId: frame.requestId,
        outcome: controlSuccessOutcome(frame.operation, frame.input), output: extracted.output,
        ...(descriptors.length ? { attachments: descriptors } : {}),
      });
      validateControlFrame(terminal);
      return Object.freeze({ terminal, attachments: extracted.attachments });
    } catch (error) {
      if (record.terminal) return null;
      record.terminal = true;
      const terminal = Object.freeze({ ...controlBase("error"), requestId: frame.requestId, error: canonicalControlError(error) });
      validateControlFrame(terminal);
      return Object.freeze({ terminal, attachments: Object.freeze([]) });
    } finally {
      this._active.delete(frame.requestId);
    }
  }

  cancel(requestId, reason = "control request cancelled") {
    const record = this._active.get(requestId);
    if (!record || record.terminal) return false;
    record.controller.abort(reason);
    return true;
  }

  close(reason = "control host closed") {
    for (const record of this._active.values()) record.controller.abort(reason);
  }
}
