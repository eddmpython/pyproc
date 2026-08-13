// transitionLedger.js - before/effect/after evidence를 보수적인 causality proof로 묶는다.
import { apxDigest } from "./apxCanonical.js";

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

export function createTransitionProof({ beforeWorldRef, afterWorldRef, actionRef, effectOutcome,
  postcondition, correlatedEvents = [], captureGap = false } = {}) {
  let causality = "unknown";
  if (!captureGap && actionRef && correlatedEvents.some((event) => event.actionRef === actionRef)) causality = "direct";
  else if (!captureGap && postcondition?.state === "confirmed"
    && postcondition.evidenceRefs?.length === 1) causality = "strong";
  else if (!captureGap && beforeWorldRef && afterWorldRef && beforeWorldRef !== afterWorldRef
    && correlatedEvents.length > 0) causality = "weak";
  const businessState = causality === "weak" && postcondition?.state === "confirmed"
    ? "ambiguous" : postcondition?.state || "notObserved";
  const body = immutable({ beforeWorldRef: beforeWorldRef || null, afterWorldRef: afterWorldRef || null,
    actionRef: actionRef || null, effectOutcome: effectOutcome || "unknown", causality, businessState,
    evidenceRefs: [...(postcondition?.evidenceRefs || [])], captureGap });
  return immutable({ transitionRef: `transition:${apxDigest(body)}`, ...body,
    integrity: { canonicalSha256: apxDigest(body) } });
}

export class TransitionLedger {
  constructor({ limit = 32 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 256) throw new TypeError("transition limit is invalid");
    this.limit = limit;
    this.sessions = new Map();
  }

  append(sessionKey, input) {
    const proof = createTransitionProof(input);
    const entries = [...(this.sessions.get(sessionKey) || []), proof].slice(-this.limit);
    this.sessions.set(sessionKey, Object.freeze(entries));
    return proof;
  }

  since(sessionKey, worldRef) {
    return Object.freeze((this.sessions.get(sessionKey) || [])
      .filter((entry) => entry.beforeWorldRef === worldRef || entry.afterWorldRef === worldRef));
  }

  dropSession(sessionKey) { this.sessions.delete(sessionKey); }
  close() { this.sessions.clear(); }
}
