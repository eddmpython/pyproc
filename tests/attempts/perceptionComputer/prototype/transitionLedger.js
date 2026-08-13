// transitionLedger.js - before/effect/after causality를 보수적으로 판정하는 prototype.
import { apxDigest } from "../../../../scripts/perception/apxCanonical.js";

export function prototypeTransitionProof({ beforeWorldRef, afterWorldRef, actionRef, effectOutcome,
  postcondition, correlatedEvents = [], captureGap = false } = {}) {
  let causality = "unknown";
  if (!captureGap && actionRef && correlatedEvents.some((event) => event.actionRef === actionRef)) causality = "direct";
  else if (!captureGap && postcondition?.state === "confirmed" && postcondition.evidenceRefs?.length === 1) causality = "strong";
  else if (!captureGap && beforeWorldRef !== afterWorldRef && correlatedEvents.length) causality = "weak";
  const businessState = causality === "weak" && postcondition?.state === "confirmed" ? "ambiguous"
    : postcondition?.state || "notObserved";
  const body = { beforeWorldRef, afterWorldRef, actionRef: actionRef || null,
    effectOutcome: effectOutcome || "unknown", causality, businessState,
    evidenceRefs: Object.freeze([...(postcondition?.evidenceRefs || [])]), captureGap };
  return Object.freeze({ transitionRef: `transition:${apxDigest(body)}`, ...body,
    integrity: Object.freeze({ canonicalSha256: apxDigest(body) }) });
}
