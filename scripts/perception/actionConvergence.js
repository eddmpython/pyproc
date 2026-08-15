// actionConvergence.js - proof-carrying action의 provider-neutral 제한과 영수증.

export const ACTION_CONVERGENCE_PROTOCOL = "pyproc.actionConvergence";
export const ACTION_CONVERGENCE_VERSION = 1;
export const ACTION_CONVERGENCE_MAX_ATTEMPTS = 2;
export const ACTION_CONVERGENCE_MAX_REOBSERVATIONS = 1;
export const ACTION_CONVERGENCE_MAX_DURATION_MS = 30000;

const REASONS = new Set([
  "ready",
  "staleTarget",
  "documentReplacement",
  "occlusionCleared",
  "ambiguousTarget",
  "targetUnavailable",
  "authorityChanged",
  "actionabilityTimeout",
  "convergenceTimeout",
  "cancelled",
  "providerRejected",
]);

function immutableStrings(values) {
  const entries = values ? Array.from(values) : [];
  return Object.freeze([...new Set(entries.map(String).filter(Boolean))].sort());
}

function timeoutFailure(cause) {
  const error = new Error("action convergence exceeded the first-effect deadline", { cause });
  error.code = "APX_ACTION_CONVERGENCE_TIMEOUT";
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

export function actionConvergenceFailureReason(error) {
  if (REASONS.has(error?.convergenceReason)) return error.convergenceReason;
  const reasons = error?.actionability?.reasonsSeen || error?.details?.actionability?.reasonsSeen
    || error?.actionability?.reasons || error?.details?.actionability?.reasons || [];
  if (error?.code === "BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT"
    || error?.code === "FRAME_SPACE_ACTIONABILITY_TIMEOUT") {
    return reasons.includes("intercepted") ? "actionabilityTimeout" : "targetUnavailable";
  }
  if (["BROWSER_AUTOMATION_STALE_LOCATOR", "BROWSER_AUTOMATION_TARGET_MISSING",
    "FRAME_SPACE_TARGET_NOT_FOUND"].includes(error?.code)) {
    return "targetUnavailable";
  }
  if (error?.code === "APX_CAPABILITY_STALE") return "authorityChanged";
  if (["BROWSER_AUTOMATION_COMMAND_CANCELLED", "CONTROL_CANCELLED"].includes(error?.code)) return "cancelled";
  return "providerRejected";
}

export function shouldReobserveAction(error) {
  if (error?.outcome !== "notSent") return false;
  if (["BROWSER_AUTOMATION_STALE_LOCATOR", "BROWSER_AUTOMATION_TARGET_MISSING",
    "FRAME_SPACE_TARGET_NOT_FOUND", "APX_CAPABILITY_STALE"].includes(error?.code)) return true;
  const reasons = error?.actionability?.reasonsSeen || error?.details?.actionability?.reasonsSeen
    || error?.actionability?.reasons || error?.details?.actionability?.reasons || [];
  return ["BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT", "FRAME_SPACE_ACTIONABILITY_TIMEOUT"].includes(error?.code)
    && reasons.includes("notAttached");
}

export class ActionConvergence {
  constructor({ signal, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this._now = now;
    this._clearTimer = clearTimer;
    this._startedAt = now();
    this._attempts = 1;
    this._reobservations = 0;
    this._effectAttempts = 0;
    this._preEffectEndedAt = null;
    this._polls = 0;
    this._reasonsSeen = new Set();
    this._binding = null;
    this._timedOut = false;
    this._closed = false;
    this._controller = new AbortController();
    this.signal = this._controller.signal;
    this._upstream = signal || null;
    this._onUpstreamAbort = () => this._controller.abort(signal.reason);
    if (signal?.aborted) this._onUpstreamAbort();
    else signal?.addEventListener("abort", this._onUpstreamAbort, { once: true });
    this._timer = setTimer(() => {
      this._timedOut = true;
      this._controller.abort(new Error("action convergence deadline reached"));
    }, ACTION_CONVERGENCE_MAX_DURATION_MS);
  }

  get timedOut() {
    return this._timedOut;
  }

  beginReobservation() {
    if (this._reobservations >= ACTION_CONVERGENCE_MAX_REOBSERVATIONS
      || this._attempts >= ACTION_CONVERGENCE_MAX_ATTEMPTS) {
      throw new Error("action convergence reobservation limit exceeded");
    }
    this._reobservations += 1;
    this._attempts += 1;
  }

  adoptBinding(binding) {
    this._binding = binding && typeof binding === "object" ? binding : null;
  }

  recordActionability(actionability) {
    if (!actionability || typeof actionability !== "object") return;
    this._polls += Math.max(0, Number(actionability.polls) || 0);
    for (const reason of actionability.reasonsSeen || actionability.reasons || []) {
      if (reason) this._reasonsSeen.add(String(reason));
    }
  }

  markEffectAttempt() {
    if (this._effectAttempts === 0) {
      this._effectAttempts = 1;
      this._preEffectEndedAt = this._now();
    }
    this._clearDeadline();
  }

  success(result) {
    this.recordActionability(result?.actionability);
    let reason = REASONS.has(this._binding?.reason) ? this._binding.reason : "ready";
    if (!this._binding && this._reasonsSeen.has("intercepted")) reason = "occlusionCleared";
    return this._receipt("converged", reason, this._effectAttempts ? "applied" : "notSent");
  }

  failure(error, reason = actionConvergenceFailureReason(error)) {
    this.recordActionability(error?.actionability || error?.details?.actionability);
    const failure = this._timedOut ? timeoutFailure(error) : error;
    const selectedReason = this._timedOut ? "convergenceTimeout" : reason;
    const outcome = failure?.outcome || "notSent";
    const state = outcome === "outcomeUnknown" ? "unknown" : outcome === "applied" ? "effectObserved" : "refused";
    failure.convergence = this._receipt(state, selectedReason, outcome);
    return failure;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._clearDeadline();
    this._upstream?.removeEventListener("abort", this._onUpstreamAbort);
  }

  _clearDeadline() {
    if (this._timer !== null) {
      this._clearTimer(this._timer);
      this._timer = null;
    }
  }

  _receipt(state, reason, effectOutcome) {
    const binding = this._binding || {};
    const endedAt = this._now();
    const preEffectEndedAt = this._preEffectEndedAt ?? endedAt;
    return Object.freeze({
      protocol: ACTION_CONVERGENCE_PROTOCOL,
      version: ACTION_CONVERGENCE_VERSION,
      state,
      reason: REASONS.has(reason) ? reason : "providerRejected",
      attempts: this._attempts,
      maxAttempts: ACTION_CONVERGENCE_MAX_ATTEMPTS,
      reobservations: this._reobservations,
      maxReobservations: ACTION_CONVERGENCE_MAX_REOBSERVATIONS,
      effectAttempts: this._effectAttempts,
      effectRetries: 0,
      effectOutcome,
      maxPreEffectDurationMs: ACTION_CONVERGENCE_MAX_DURATION_MS,
      preEffectDurationMs: Math.max(0, preEffectEndedAt - this._startedAt),
      durationMs: Math.max(0, endedAt - this._startedAt),
      actionabilityPolls: this._polls,
      actionabilityReasonsSeen: immutableStrings(this._reasonsSeen),
      ...(binding.fromSituationRef ? { fromSituationRef: binding.fromSituationRef } : {}),
      ...(binding.toSituationRef ? { toSituationRef: binding.toSituationRef } : {}),
      ...(binding.fromDocumentEpoch !== undefined ? { fromDocumentEpoch: binding.fromDocumentEpoch } : {}),
      ...(binding.toDocumentEpoch !== undefined ? { toDocumentEpoch: binding.toDocumentEpoch } : {}),
    });
  }
}
