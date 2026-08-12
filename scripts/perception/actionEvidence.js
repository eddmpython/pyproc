// actionEvidence.js - Observe, Act, Capture, Verify를 한 번만 전송되는 effect 경계로 묶는다.
import { verifyPostcondition, validatePostcondition } from "./postconditionVerifier.js";

const POLL_MS = 100;
const EVIDENCE_REF_RE = /^evidence:[A-Za-z0-9_-]{1,128}$/;
const ACTION_REF_RE = /^action:[A-Za-z0-9_-]{1,128}$/;
const OBSERVATION_REF_RE = /^observation:[A-Za-z0-9_-]{1,128}$/;
const EVIDENCE_KEYS = new Set(["evidenceRef", "actionRef", "beforeObservationRef", "afterObservationRef",
  "effectOutcome", "verification", "correlatedEvidence", "effectWindow"]);
const delay = (ms, signal) => new Promise((resolve, reject) => {
  let timer;
  const finish = () => {
    signal?.removeEventListener("abort", abort);
    resolve();
  };
  const abort = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    reject(signal.reason || new Error("evidence loop cancelled"));
  };
  timer = setTimeout(finish, ms);
  if (!signal) return;
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
});

function mutableFailure(error) {
  if (error instanceof Error && Object.isExtensible(error)) return error;
  const failure = new Error(error?.message || String(error), { cause: error instanceof Error ? error : undefined });
  for (const key of ["code", "outcome", "retryable", "completed", "actionability", "trace"]) {
    if (error?.[key] !== undefined) failure[key] = error[key];
  }
  return failure;
}

function outcomeUnknown(error, evidence) {
  const failure = mutableFailure(error);
  failure.outcome = "outcomeUnknown";
  failure.retryable = false;
  failure.actionEvidence = assertActionEvidence(evidence);
  return failure;
}

function evidenceInvalid(message) {
  const error = new TypeError(message);
  error.code = "APX_SCHEMA_INVALID";
  error.outcome = "notSent";
  error.retryable = false;
  throw error;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) evidenceInvalid(`${label} does not accept ${key}`);
}

export function assertActionEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) evidenceInvalid("ActionEvidence is invalid");
  exactKeys(value, EVIDENCE_KEYS, "ActionEvidence");
  if (!EVIDENCE_REF_RE.test(String(value.evidenceRef || ""))
    || !ACTION_REF_RE.test(String(value.actionRef || ""))
    || !OBSERVATION_REF_RE.test(String(value.beforeObservationRef || ""))
    || (value.afterObservationRef !== null && !OBSERVATION_REF_RE.test(String(value.afterObservationRef || "")))
    || !["applied", "notSent", "rejected", "outcomeUnknown"].includes(value.effectOutcome)
    || !value.verification || typeof value.verification !== "object" || Array.isArray(value.verification)
    || !value.effectWindow || typeof value.effectWindow !== "object" || Array.isArray(value.effectWindow)) {
    evidenceInvalid("ActionEvidence envelope is invalid");
  }
  exactKeys(value.verification, new Set(["state", "postcondition", "evidenceRefs"]), "ActionEvidence verification");
  if (!["confirmed", "contradicted", "ambiguous", "notObserved", "outcomeUnknown"].includes(value.verification.state)
    || !Array.isArray(value.verification.evidenceRefs)
    || value.verification.evidenceRefs.some((ref) => !/^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9._:-]{1,128}$/.test(ref))
    || new Set(value.verification.evidenceRefs).size !== value.verification.evidenceRefs.length) {
    evidenceInvalid("ActionEvidence verification is invalid");
  }
  validatePostcondition(value.verification.postcondition);
  exactKeys(value.effectWindow, new Set(["startedAt", "endedAt"]), "ActionEvidence effectWindow");
  if (!Number.isFinite(value.effectWindow.startedAt) || !Number.isFinite(value.effectWindow.endedAt)
    || value.effectWindow.endedAt < value.effectWindow.startedAt) evidenceInvalid("ActionEvidence window is invalid");
  if (value.verification.state === "confirmed" && value.effectOutcome !== "applied") {
    evidenceInvalid("confirmed evidence requires an applied effect");
  }
  if (value.effectOutcome === "outcomeUnknown" && value.verification.state !== "outcomeUnknown") {
    evidenceInvalid("unknown effect requires unknown verification");
  }
  if (value.correlatedEvidence !== undefined) {
    const correlated = value.correlatedEvidence;
    if (!correlated || typeof correlated !== "object" || Array.isArray(correlated)) {
      evidenceInvalid("ActionEvidence correlation is invalid");
    }
    exactKeys(correlated, new Set(["level", "eventRefs", "delta"]), "ActionEvidence correlation");
    if (!["direct", "strong", "weak", "unknown"].includes(correlated.level)
      || !Array.isArray(correlated.eventRefs)
      || correlated.eventRefs.some((ref) => !/^event:[A-Za-z0-9._:-]{1,128}$/.test(ref))
      || new Set(correlated.eventRefs).size !== correlated.eventRefs.length) {
      evidenceInvalid("ActionEvidence correlation is invalid");
    }
  }
  return value;
}

export class ActionEvidenceLoop {
  constructor({ idFactory = () => crypto.randomUUID(), now = () => Date.now() } = {}) {
    this.idFactory = idFactory;
    this.now = now;
  }

  async run({ actionRef, postcondition, capture, effect, signal }) {
    validatePostcondition(postcondition);
    const evidenceRef = `evidence:${this.idFactory()}`;
    if (!ACTION_REF_RE.test(String(actionRef || "")) || !EVIDENCE_REF_RE.test(evidenceRef)) {
      evidenceInvalid("ActionEvidence references are invalid");
    }
    const before = await capture({ phase: "before", signal });
    if (!before || !OBSERVATION_REF_RE.test(String(before.observationRef || ""))) {
      evidenceInvalid("ActionEvidence before observation is invalid");
    }
    const startedAt = this.now();
    let effectResult;
    try { effectResult = await effect(); }
    catch (error) {
      const evidence = Object.freeze({ evidenceRef, actionRef,
        beforeObservationRef: before.observationRef, afterObservationRef: null,
        effectOutcome: error?.outcome || "notSent",
        verification: Object.freeze({ state: error?.outcome === "outcomeUnknown" ? "outcomeUnknown" : "notObserved",
          postcondition, evidenceRefs: Object.freeze([]) }),
        effectWindow: Object.freeze({ startedAt, endedAt: this.now() }) });
      const failure = mutableFailure(error);
      failure.actionEvidence = assertActionEvidence(evidence);
      throw failure;
    }
    const deadline = startedAt + (postcondition.withinMs || 5000);
    let after;
    let verification;
    const accumulatedEvents = [];
    const eventRefs = new Set();
    try {
      do {
        after = await capture({ phase: "after", signal, since: before.observationRef });
        if (!after || !OBSERVATION_REF_RE.test(String(after.observationRef || ""))
          || !Array.isArray(after.events)) evidenceInvalid("ActionEvidence after observation is invalid");
        for (const event of after.events || []) {
          const ref = String(event.eventId || "");
          if (ref && eventRefs.has(ref)) continue;
          if (ref) eventRefs.add(ref);
          accumulatedEvents.push(event);
        }
        verification = verifyPostcondition(postcondition, { observation: after, events: accumulatedEvents, final: false });
        if (["confirmed", "contradicted"].includes(verification.state) || this.now() >= deadline) break;
        await delay(Math.min(POLL_MS, Math.max(1, deadline - this.now())), signal);
      } while (this.now() <= deadline);
      if (!["confirmed", "contradicted"].includes(verification.state)) {
        verification = verifyPostcondition(postcondition, { observation: after, events: accumulatedEvents, final: true });
      }
    } catch (error) {
      throw outcomeUnknown(error, Object.freeze({ evidenceRef, actionRef,
        beforeObservationRef: before.observationRef, afterObservationRef: after?.observationRef || null,
        effectOutcome: "outcomeUnknown",
        verification: Object.freeze({ state: "outcomeUnknown", postcondition,
          evidenceRefs: Object.freeze([...eventRefs]) }),
        effectWindow: Object.freeze({ startedAt, endedAt: this.now() }) }));
    }
    const evidence = Object.freeze({ evidenceRef, actionRef,
      beforeObservationRef: before.observationRef,
      afterObservationRef: after.observationRef,
      effectOutcome: "applied",
      verification,
      correlatedEvidence: Object.freeze({
        level: verification.evidenceRefs.length ? "strong" : "unknown",
        eventRefs: Object.freeze(accumulatedEvents.map((event) => event.eventId).filter(Boolean)),
        delta: after.delta || null,
      }),
      effectWindow: Object.freeze({ startedAt, endedAt: this.now() }) });
    assertActionEvidence(evidence);
    return Object.freeze({
      effectResult,
      evidence,
    });
  }
}
