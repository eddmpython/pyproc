// situationCompiler.js - typed focus를 최소 충분하고 검증 가능한 SituationCapsule로 투영한다.
import { apxDigest } from "./apxCanonical.js";
import { planSituationProbes } from "./probePlanner.js";
import { isVisualApxUnresolvedReason } from "./unresolvedVocabulary.js";
import { evaluateRequirementCandidates, projectCandidateEvidence } from "./requirementCandidateEvaluator.js";
import {
  APX_SITUATION_PROFILE,
  APX_SITUATION_REPRESENTATION,
  assertSituationCapsule,
  validateSituationFocus,
} from "./situationCatalog.js";

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

function budgetError() {
  const error = new Error("situation budget cannot preserve every required answer");
  error.code = "APX_BUDGET_EXCEEDED";
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function canonicalRef(value) {
  if (value.claimRef) return value.claimRef;
  if (value.unknownRef) return value.unknownRef;
  if (value.transitionRef) return value.transitionRef;
  if (value.kind && value.action) return `${value.requirementRef || ""}:${value.kind}:${value.action}:`+
    `${value.entityRef || value.capabilityRef || value.reportedCapabilityRef || ""}`;
  return value.requirementRef || "";
}

function compareRef(left, right) {
  const leftRef = canonicalRef(left);
  const rightRef = canonicalRef(right);
  return leftRef < rightRef ? -1 : leftRef > rightRef ? 1 : 0;
}

function unknown(requirementRef, reason, entityRef = null, evidenceRefs = []) {
  const body = { requirementRef, reason, ...(entityRef ? { entityRef } : {}), evidenceRefs };
  return immutable({ unknownRef: `unknown:${apxDigest(body)}`, ...body });
}

function relationClosure(relations, seeds) {
  const related = new Set(seeds);
  for (const relation of relations) {
    if (related.has(relation.from) || related.has(relation.to)) {
      related.add(relation.from);
      related.add(relation.to);
    }
  }
  return related;
}

export class SituationCompiler {
  constructor({ capabilityProjector = null, now = () => Date.now() } = {}) {
    if (now !== null && typeof now !== "function") throw new TypeError("situation compiler clock is invalid");
    this.capabilityProjector = capabilityProjector;
    this.now = now;
  }

  compile(world, focusInput, { sessionRef = {}, profile = [], budget = {}, visual = {}, visualProbes = [],
    changes = null, candidateEvaluations = null } = {}) {
    const focus = validateSituationFocus(focusInput);
    if (candidateEvaluations === null) candidateEvaluations = evaluateRequirementCandidates(focus, world.entities, {
      documentEpoch: world.documentEpoch,
      sourceGraphSha256: world.integrity.sourceGraphSha256,
      enumeration: world.budget?.truncated ? "incomplete" : "complete",
      droppedCount: Math.max(0, Number(world.budget?.omitted?.entities) || 0),
    });
    if (!Array.isArray(candidateEvaluations) || candidateEvaluations.length !== focus.requirements.length) {
      throw new TypeError("situation compiler requires complete candidate evaluations");
    }
    const evaluationByRequirement = new Map(candidateEvaluations.map((entry) => [entry.requirementRef, entry]));
    const situationRef = `situation:${apxDigest({ worldRef: world.worldRef, focus,
      candidateEvaluations: candidateEvaluations.map((entry) => entry.evaluationSha256) })}`;
    const requirements = [];
    const facts = new Map();
    const affordances = [];
    const unknowns = [];
    const seedRefs = new Set();
    const ageMs = Math.max(0, this.now() - Date.parse(world.capturedAt));
    const availableEntityRefs = new Set(world.entities.map((entity) => entity.entityRef));
    const projectionLimit = Number.isInteger(budget.maxEntities) ? budget.maxEntities : 1000;
    const projectedUniverse = new Set();
    for (const requirement of focus.requirements) {
      const evaluation = evaluationByRequirement.get(requirement.requirementRef);
      if (!evaluation) throw new TypeError("candidate evaluation does not answer the focus");
      if (evaluation.state === "satisfied" && requirement.cardinality === "one") {
        const [entity] = evaluation.matchedEntities;
        if (entity && availableEntityRefs.has(entity.entityRef)) projectedUniverse.add(entity.entityRef);
      }
    }
    if (projectedUniverse.size > projectionLimit) throw budgetError();
    for (const evaluation of candidateEvaluations) {
      for (const entity of evaluation.matchedEntities) {
        if (projectedUniverse.size >= projectionLimit) break;
        if (availableEntityRefs.has(entity.entityRef)) projectedUniverse.add(entity.entityRef);
      }
    }

    for (const requirement of focus.requirements) {
      const evaluation = evaluationByRequirement.get(requirement.requirementRef);
      const matches = evaluation.matchedEntities.filter((entity) => projectedUniverse.has(entity.entityRef)
        && availableEntityRefs.has(entity.entityRef));
      const candidateEvidence = projectCandidateEvidence(evaluation, matches.map((entity) => entity.entityRef));
      let state = evaluation.state;
      const claims = world.claims.filter((claim) => matches.some((entity) => entity.entityRef === claim.subjectRef));
      let stateReason = null;
      if (state === "satisfied" && claims.some((claim) => claim.state === "conflicted")) state = "conflicted";
      if (state === "satisfied" && (claims.some((claim) => claim.state === "stale")
        || (focus.freshness.mode === "live" && ageMs > focus.freshness.maxAgeMs))) state = "stale";
      if (state === "satisfied" && requirement.need.includes("change")) {
        const matchingChanges = (world.changes || []).filter((change) =>
          !change.subjectRef || matches.some((entity) => entity.entityRef === change.subjectRef));
        if (!focus.changedSince || matchingChanges.length === 0) {
          state = "unknown";
          stateReason = "missingChangeBaseline";
        }
      }
      if (evaluation.enumeration !== "complete" && state !== "conflicted") stateReason = "inventoryTruncated";

      for (const entity of matches) seedRefs.add(entity.entityRef);
      if (requirement.need.includes("fact") || requirement.need.includes("affordance")) {
        for (const claim of claims) facts.set(claim.claimRef, claim);
      }
      if (state === "satisfied" && requirement.need.includes("affordance")) {
        const authorizationComplete = requirement.cardinality === "one"
          || (requirement.cardinality === "oneOrMore" && (candidateEvidence.omittedMatchedCount === 0
            || requirement.select.entityRef !== undefined));
        for (const entity of matches) {
          const projected = this.capabilityProjector?.project(world, entity, sessionRef, situationRef,
            requirement.requirementRef) || [];
          affordances.push(...(authorizationComplete ? projected : projected.filter((entry) => entry.kind !== "authorized")));
        }
      }

      if (state !== "satisfied") {
        unknowns.push(unknown(requirement.requirementRef,
          stateReason || (state === "conflicted" ? "cardinalityOrClaimConflict"
            : state === "stale" ? "stale" : "missingFact"),
          null, matches.map((entity) => entity.entityRef)));
      }
      for (const entity of matches) {
        if (!entity.unresolved) continue;
        unknowns.push(unknown(requirement.requirementRef,
          isVisualApxUnresolvedReason(entity.unresolved.reason)
            ? "visualEvidenceRequired" : entity.unresolved.reason,
          entity.entityRef, [entity.entityRef]));
      }
      if (state === "satisfied" && requirement.need.includes("affordance")
        && !affordances.some((entry) => entry.requirementRef === requirement.requirementRef
          && entry.kind === "authorized")) {
        unknowns.push(unknown(requirement.requirementRef, "providerGap", null,
          matches.map((entity) => entity.entityRef)));
      }
      requirements.push(immutable({ requirementRef: requirement.requirementRef, state,
        cardinality: requirement.cardinality, matched: evaluation.matchedCount,
        entityRefs: matches.map((entity) => entity.entityRef), claimRefs: claims.map((claim) => claim.claimRef),
        candidateEvidence }));
    }

    affordances.push(...(this.capabilityProjector?.reported(world) || []));
    const related = relationClosure(world.relations, seedRefs);
    const selectedChanges = focus.changedSince ? (changes || world.changes || []).filter((change) =>
      !change.subjectRef || related.has(change.subjectRef)) : [];
    const suggestedProbes = planSituationProbes(unknowns, {
      visualMode: visual.mode || "off",
      inference: visual.inference === true,
    });
    const outputProfile = [...new Set(["apx-core/1", "apx-web/1", APX_SITUATION_PROFILE, ...profile])];
    const base = {
      protocol: "apx",
      version: "1.0",
      representation: APX_SITUATION_REPRESENTATION,
      profile: outputProfile,
      situationRef,
      worldRef: world.worldRef,
      observationRef: world.observationRef,
      documentEpoch: world.documentEpoch,
      capturedAt: world.capturedAt,
      focus,
      requirements: requirements.sort(compareRef),
      facts: [...facts.values()].sort(compareRef),
      affordances: affordances.sort(compareRef),
      changes: selectedChanges,
      unknowns: unknowns.sort(compareRef),
      suggestedProbes,
      ...(visualProbes.length ? { visualProbes } : {}),
      completeness: { ...world.completeness, inventory: candidateEvaluations.every((entry) =>
        entry.enumeration === "complete") ? "taskComplete" : "truncated" },
      budget: { used: { requirements: requirements.length, facts: facts.size,
        affordances: affordances.length, bytes: 0 },
      omitted: { sourceEntities: Number(world.budget?.omitted?.entities) || 0,
        sourceRelations: Number(world.budget?.omitted?.relations) || 0 }, requiredPreserved: true },
      integrity: { canonicalSha256: null, worldSha256: world.integrity.worldSha256,
        sourceGraphSha256: world.integrity.sourceGraphSha256 },
    };
    base.budget.used.bytes = byteLength(base);
    if (base.budget.used.bytes > (budget.maxBytes || 65536)) throw budgetError();
    const capsule = immutable({ ...base, integrity: { ...base.integrity, canonicalSha256: apxDigest(base) } });
    assertSituationCapsule(capsule);
    return capsule;
  }
}
