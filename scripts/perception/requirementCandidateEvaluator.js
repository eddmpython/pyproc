// requirementCandidateEvaluator.js - requirement universe를 output projection 전에 완전하게 판정한다.
import { apxDigest } from "./apxCanonical.js";
import { matchesPerceptionQuery } from "./perceptionQuery.js";

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

function compareEntity(left, right) {
  return left.entityRef < right.entityRef ? -1 : left.entityRef > right.entityRef ? 1 : 0;
}

function cardinalityState(cardinality, matchedCount, enumeration) {
  if (cardinality === "one") {
    if (matchedCount > 1) return "conflicted";
    return enumeration === "complete" && matchedCount === 1 ? "satisfied" : "unknown";
  }
  if (cardinality === "oneOrMore") {
    return enumeration === "complete" && matchedCount > 0 ? "satisfied" : "unknown";
  }
  return enumeration === "complete" ? "satisfied" : "unknown";
}

function enumerationState(value, droppedCount) {
  if (value === "complete" && droppedCount === 0) return "complete";
  if (value === "unknown") return "unknown";
  return droppedCount > 0 || value === "incomplete" ? "incomplete" : "complete";
}

function continuationPayload(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
    || typeof binding.continuationSeed !== "string" || !binding.continuationSeed
    || !/^world:[a-f0-9]{64}$/u.test(String(binding.worldRef || ""))
    || !/^document:\d+$/u.test(String(binding.surfaceEpoch || ""))
    || !/^requirement:[A-Za-z0-9_-]{1,128}$/u.test(String(binding.requirementRef || ""))
    || !/^[a-f0-9]{64}$/u.test(String(binding.selectorSha256 || ""))
    || !/^[a-f0-9]{64}$/u.test(String(binding.orderingSha256 || ""))
    || !Number.isInteger(binding.nextOffset) || binding.nextOffset < 0
    || !Number.isFinite(Date.parse(binding.expiresAt))) {
    throw new TypeError("candidate continuation binding is invalid");
  }
  return { continuationSeed: binding.continuationSeed, worldRef: binding.worldRef,
    surfaceEpoch: binding.surfaceEpoch, requirementRef: binding.requirementRef,
    selectorSha256: binding.selectorSha256, orderingSha256: binding.orderingSha256,
    nextOffset: binding.nextOffset, expiresAt: binding.expiresAt };
}

export function candidateContinuationRef(binding) {
  return `continuation:${apxDigest(continuationPayload(binding))}`;
}

export function assertCandidateContinuation(ref, binding, { now = Date.now() } = {}) {
  const payload = continuationPayload(binding);
  if (String(ref || "") !== candidateContinuationRef(payload)) {
    throw new TypeError("candidate continuation does not match its read binding");
  }
  if (!Number.isFinite(now) || now >= Date.parse(payload.expiresAt)) {
    throw new TypeError("candidate continuation is expired");
  }
  return payload;
}

export function evaluateRequirementCandidates(focus, entities, { documentEpoch = 0, sourceGraphSha256,
  enumeration = "complete", droppedCount = 0, continuationSeed = null, expiresAt = null } = {}) {
  if (!Array.isArray(focus?.requirements) || !Array.isArray(entities)) {
    throw new TypeError("candidate evaluation requires focus and entities");
  }
  if (!Number.isInteger(documentEpoch) || documentEpoch < 0 || !Number.isInteger(droppedCount) || droppedCount < 0) {
    throw new TypeError("candidate enumeration metadata is invalid");
  }
  const state = enumerationState(enumeration, droppedCount);
  const surfaceEpoch = `document:${documentEpoch}`;
  const graphSha256 = String(sourceGraphSha256 || apxDigest(entities.map((entity) => entity.entityRef)));
  return Object.freeze(focus.requirements.map((requirement) => {
    const matchedEntities = entities.filter((entity) => matchesPerceptionQuery(entity, requirement.select))
      .sort(compareEntity);
    const entityRefs = matchedEntities.map((entity) => entity.entityRef);
    const selectorSha256 = apxDigest(requirement.select);
    const orderingSha256 = apxDigest({ order: "entityRefLexicographic", entityRefs });
    const continuationRef = state === "incomplete" && continuationSeed
      ? candidateContinuationRef({ continuationSeed, worldRef: `world:${graphSha256}`, surfaceEpoch,
        requirementRef: requirement.requirementRef, selectorSha256, orderingSha256,
        nextOffset: entities.length, expiresAt }) : null;
    const evaluation = {
      requirementRef: requirement.requirementRef,
      cardinality: requirement.cardinality,
      surfaceEpoch,
      universeScopeSha256: apxDigest({ surfaceEpoch, graphSha256, requirementRef: requirement.requirementRef,
        selectorSha256, observedCount: entities.length, droppedCount }),
      enumeration: state,
      observedCount: entities.length,
      droppedCount,
      matchedEntities,
      matchedCount: matchedEntities.length,
      orderingSha256,
      continuationRef,
      ...(state === "complete" ? { matchSetSha256: apxDigest({ entityRefs }) } : {}),
      state: cardinalityState(requirement.cardinality, matchedEntities.length, state),
    };
    return immutable({ ...evaluation, evaluationSha256: apxDigest({ ...evaluation, matchedEntities: entityRefs }) });
  }));
}

export function projectCandidateEvidence(evaluation, projectedEntityRefs) {
  if (!evaluation || !Array.isArray(projectedEntityRefs)) {
    throw new TypeError("candidate evidence projection is invalid");
  }
  const projected = [...new Set(projectedEntityRefs)].sort();
  const matchedRefs = new Set(evaluation.matchedEntities.map((entity) => entity.entityRef));
  if (projected.some((entityRef) => !matchedRefs.has(entityRef))) {
    throw new TypeError("candidate evidence projection includes a noncandidate");
  }
  const evidence = {
    surfaceEpoch: evaluation.surfaceEpoch,
    universeScopeSha256: evaluation.universeScopeSha256,
    enumeration: evaluation.enumeration,
    observedCount: evaluation.observedCount,
    droppedCount: evaluation.droppedCount,
    ...(evaluation.enumeration === "complete"
      ? { matchedCount: evaluation.matchedCount, matchSetSha256: evaluation.matchSetSha256 }
      : { matchedLowerBound: evaluation.matchedCount }),
    projectedCount: projected.length,
    omittedMatchedCount: Math.max(0, evaluation.matchedCount - projected.length),
    orderingSha256: evaluation.orderingSha256,
    continuationRef: evaluation.continuationRef,
  };
  return immutable(evidence);
}
