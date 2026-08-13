// actuatorBroker.js - hard eligibility 뒤 versioned lexicographic route만 고른다.
import { ACTUATOR_KINDS, ACTUATION_ERROR_CODES, actuationError, assertActuationIntent,
  assertTargetBinding } from "./actuationCanonical.js";

const KINDS = new Set(ACTUATOR_KINDS);
const clone = (value) => Object.freeze(structuredClone(value));

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function chooseActuator(intent, candidates, preference = []) {
  assertActuationIntent(intent);
  if (!Array.isArray(candidates) || !candidates.length || !Array.isArray(preference)) {
    throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable, "actuator candidates are required");
  }
  const allowed = new Set(intent.policy.allowedActuatorKinds);
  const preferenceRank = new Map(preference.map((kind, index) => [kind, index]));
  const inspected = candidates.map((candidate) => {
    const reasons = [];
    if (!candidate || typeof candidate !== "object" || !KINDS.has(candidate.kind) || !allowed.has(candidate.kind)) {
      reasons.push("kindNotAllowed");
    }
    try { assertTargetBinding(candidate.binding); } catch { reasons.push("bindingInvalid"); }
    if (!candidate.supportedIntents?.includes(intent.intent)) reasons.push("intentUnsupported");
    if (candidate.binding?.worldRef !== intent.target.worldRef
      || candidate.binding?.surfaceEpoch !== intent.target.surfaceEpoch
      || candidate.binding?.entityRef !== intent.target.entityRef) reasons.push("bindingMismatch");
    if (!Number.isFinite(candidate.now) || candidate.binding?.freshUntil < candidate.now) reasons.push("bindingExpired");
    if (candidate.healthy !== true) reasons.push("providerUnhealthy");
    if (candidate.authoritySatisfied !== true) reasons.push("authorityMissing");
    if (candidate.evidenceAvailable !== true) reasons.push("evidenceUnavailable");
    if (candidate.effectWindowRepresentable !== true) reasons.push("effectWindowUnavailable");
    return { ...candidate, eligible: reasons.length === 0, exclusionReasons: [...new Set(reasons)] };
  });
  const eligible = inspected.filter((candidate) => candidate.eligible).sort((left, right) => compareTuple([
    left.semanticSetter ? 0 : 1,
    left.additionalAuthority ? 1 : 0,
    left.postconditionEvidence ? 0 : 1,
    left.sharedInput ? 1 : 0,
    preferenceRank.get(left.kind) ?? Number.MAX_SAFE_INTEGER,
    String(left.providerId),
  ], [
    right.semanticSetter ? 0 : 1,
    right.additionalAuthority ? 1 : 0,
    right.postconditionEvidence ? 0 : 1,
    right.sharedInput ? 1 : 0,
    preferenceRank.get(right.kind) ?? Number.MAX_SAFE_INTEGER,
    String(right.providerId),
  ]));
  if (!eligible.length) throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
    "no actuator passed hard eligibility", { excluded: inspected.map(({ kind, providerId, exclusionReasons }) =>
      ({ kind, providerId, exclusionReasons })) });
  return clone({ ruleVersion: 1, selected: eligible[0],
    ordered: eligible.map(({ kind, providerId }) => ({ kind, providerId })),
    excluded: inspected.filter((candidate) => !candidate.eligible)
      .map(({ kind, providerId, exclusionReasons }) => ({ kind, providerId, exclusionReasons })) });
}
