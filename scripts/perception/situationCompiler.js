// situationCompiler.js - typed focus를 최소 충분하고 검증 가능한 SituationCapsule로 투영한다.
import { apxDigest } from "./apxCanonical.js";
import { matchesPerceptionQuery } from "./perceptionQuery.js";
import { planSituationProbes } from "./probePlanner.js";
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

function cardinalityState(cardinality, count) {
  if (cardinality === "one") return count === 1 ? "satisfied" : count > 1 ? "conflicted" : "unknown";
  if (cardinality === "oneOrMore") return count > 0 ? "satisfied" : "unknown";
  return "satisfied";
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
    changes = null } = {}) {
    const focus = validateSituationFocus(focusInput);
    const situationRef = `situation:${apxDigest({ worldRef: world.worldRef, focus })}`;
    const requirements = [];
    const facts = new Map();
    const affordances = [];
    const unknowns = [];
    const seedRefs = new Set();
    const ageMs = Math.max(0, this.now() - Date.parse(world.capturedAt));
    const sourceTruncated = world.budget?.truncated === true;

    for (const requirement of focus.requirements) {
      const matches = world.entities.filter((entity) => matchesPerceptionQuery(entity, requirement.select));
      let state = cardinalityState(requirement.cardinality, matches.length);
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
      if (sourceTruncated) {
        state = "unknown";
        stateReason = "inventoryTruncated";
      }

      for (const entity of matches) seedRefs.add(entity.entityRef);
      if (requirement.need.includes("fact") || requirement.need.includes("affordance")) {
        for (const claim of claims) facts.set(claim.claimRef, claim);
      }
      if (state === "satisfied" && requirement.need.includes("affordance")) {
        for (const entity of matches) {
          affordances.push(...(this.capabilityProjector?.project(world, entity, sessionRef, situationRef,
            requirement.requirementRef) || []));
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
          entity.unresolved.reason === "canvas" || entity.unresolved.reason === "imageOnly"
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
        cardinality: requirement.cardinality, matched: matches.length,
        entityRefs: matches.map((entity) => entity.entityRef), claimRefs: claims.map((claim) => claim.claimRef) }));
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
      completeness: { ...world.completeness, inventory: sourceTruncated ? "truncated" : "taskComplete" },
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
