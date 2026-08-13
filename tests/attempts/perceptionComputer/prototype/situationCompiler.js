// situationCompiler.js - typed focus의 최소 충분 SituationCapsule을 만드는 prototype.
import { apxDigest } from "../../../../scripts/perception/apxCanonical.js";
import { matchesPerceptionQuery } from "../../../../scripts/perception/perceptionQuery.js";
import { planPrototypeProbes } from "./probePlanner.js";

const FOCUS_KEYS = new Set(["objective", "requirements", "changedSince", "freshness"]);
const REQUIREMENT_KEYS = new Set(["requirementRef", "select", "need", "cardinality"]);
const NEEDS = new Set(["fact", "affordance", "change"]);
const CARDINALITIES = new Set(["one", "oneOrMore", "zeroOrMore"]);

function fail(message, code = "APX_SCHEMA_INVALID") {
  const error = new TypeError(message); error.code = code; error.outcome = "notSent"; error.retryable = false;
  throw error;
}

function exactKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${label} does not accept ${key}`);
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

export function validatePrototypeFocus(value = {}) {
  const focus = plain(value, "focus");
  exactKeys(focus, FOCUS_KEYS, "focus");
  if (focus.objective !== undefined && (typeof focus.objective !== "string" || focus.objective.length > 1000)) {
    fail("focus.objective is invalid");
  }
  if (!Array.isArray(focus.requirements) || focus.requirements.length < 1 || focus.requirements.length > 32) {
    fail("focus.requirements requires 1 to 32 entries");
  }
  const refs = new Set();
  const requirements = focus.requirements.map((entry, index) => {
    plain(entry, `focus.requirements[${index}]`);
    exactKeys(entry, REQUIREMENT_KEYS, `focus.requirements[${index}]`);
    if (!/^requirement:[A-Za-z0-9._:-]{1,128}$/.test(entry.requirementRef || "")
      || refs.has(entry.requirementRef)) fail(`focus.requirements[${index}].requirementRef is invalid`);
    refs.add(entry.requirementRef);
    plain(entry.select, `focus.requirements[${index}].select`);
    const selectKeys = new Set(["entityRef", "kind", "role", "name", "state", "actionable"]);
    exactKeys(entry.select, selectKeys, `focus.requirements[${index}].select`);
    if (!Array.isArray(entry.need) || entry.need.length < 1 || entry.need.some((need) => !NEEDS.has(need))) {
      fail(`focus.requirements[${index}].need is invalid`);
    }
    const cardinality = entry.cardinality || "one";
    if (!CARDINALITIES.has(cardinality)) fail(`focus.requirements[${index}].cardinality is invalid`);
    return Object.freeze({ requirementRef: entry.requirementRef, select: Object.freeze({ ...entry.select }),
      need: Object.freeze([...new Set(entry.need)]), cardinality });
  });
  if (focus.changedSince !== undefined && !/^situation:[a-f0-9]{64}$/.test(focus.changedSince)) {
    fail("focus.changedSince is invalid");
  }
  let freshness = Object.freeze({ mode: "live", maxAgeMs: 1000 });
  if (focus.freshness !== undefined) {
    plain(focus.freshness, "focus.freshness");
    exactKeys(focus.freshness, new Set(["mode", "maxAgeMs"]), "focus.freshness");
    if (!['live', 'recorded'].includes(focus.freshness.mode)
      || !Number.isInteger(focus.freshness.maxAgeMs) || focus.freshness.maxAgeMs < 0
      || focus.freshness.maxAgeMs > 300000) fail("focus.freshness is invalid");
    freshness = Object.freeze({ mode: focus.freshness.mode, maxAgeMs: focus.freshness.maxAgeMs });
  }
  return Object.freeze({ ...(focus.objective === undefined ? {} : { objective: focus.objective }),
    requirements: Object.freeze(requirements), ...(focus.changedSince ? { changedSince: focus.changedSince } : {}),
    freshness });
}

function cardinalityState(cardinality, count) {
  if (cardinality === "one") return count === 1 ? "satisfied" : count > 1 ? "conflicted" : "unknown";
  if (cardinality === "oneOrMore") return count > 0 ? "satisfied" : "unknown";
  return "satisfied";
}

function requirementUnknown(requirement, state, matches) {
  if (state === "satisfied") return [];
  return [Object.freeze({ unknownRef: `unknown:${requirement.requirementRef.slice("requirement:".length)}`,
    requirementRef: requirement.requirementRef,
    reason: state === "conflicted" ? "cardinality" : "missingFact",
    evidenceRefs: Object.freeze(matches.map((entity) => entity.entityRef)) })];
}

function byteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

export class PrototypeSituationCompiler {
  constructor({ capabilityProjector = null } = {}) {
    this.capabilityProjector = capabilityProjector;
  }

  compile(world, focusInput, { sessionRef = {}, budget = {}, visual = {}, visualProbes = [] } = {}) {
    const focus = validatePrototypeFocus(focusInput);
    const situationBasis = { worldRef: world.worldRef, focus };
    const situationRef = `situation:${apxDigest(situationBasis)}`;
    const requirements = [];
    const facts = new Map();
    const affordances = [];
    const unknowns = [];
    const entityRefs = new Set();
    for (const requirement of focus.requirements) {
      const matches = world.entities.filter((entity) => matchesPerceptionQuery(entity, requirement.select));
      let state = cardinalityState(requirement.cardinality, matches.length);
      const claims = world.claims.filter((claim) => matches.some((entity) => entity.entityRef === claim.subjectRef));
      if (state === "satisfied" && claims.some((claim) => claim.state === "conflicted")) state = "conflicted";
      if (state === "satisfied" && claims.some((claim) => claim.state === "stale")) state = "stale";
      const refs = matches.map((entity) => entity.entityRef);
      refs.forEach((ref) => entityRefs.add(ref));
      claims.forEach((claim) => facts.set(claim.claimRef, claim));
      if (state === "satisfied" && requirement.need.includes("affordance")) {
        for (const entity of matches) {
          const projected = this.capabilityProjector?.project(world, entity, sessionRef, situationRef) || [];
          affordances.push(...projected.map((entry) => Object.freeze({ ...entry,
            requirementRef: requirement.requirementRef })));
        }
      }
      const missing = requirementUnknown(requirement, state, matches);
      unknowns.push(...missing);
      for (const entity of matches) {
        if (entity.unresolved) unknowns.push(Object.freeze({ unknownRef: `unknown:${apxDigest({
          requirementRef: requirement.requirementRef, entityRef: entity.entityRef, reason: entity.unresolved.reason })}`,
        requirementRef: requirement.requirementRef, entityRef: entity.entityRef,
        reason: entity.unresolved.reason === "canvas" ? "visualEvidenceRequired" : entity.unresolved.reason,
        evidenceRefs: Object.freeze([entity.entityRef]) }));
      }
      requirements.push(Object.freeze({ requirementRef: requirement.requirementRef, state,
        cardinality: requirement.cardinality, matched: matches.length,
        entityRefs: Object.freeze(refs), claimRefs: Object.freeze(claims.map((claim) => claim.claimRef)) }));
    }
    affordances.push(...(this.capabilityProjector?.reported(world) || []));
    const related = new Set(entityRefs);
    for (const relation of world.relations) {
      if (entityRefs.has(relation.from) || entityRefs.has(relation.to)) {
        related.add(relation.from); related.add(relation.to);
      }
    }
    const changes = focus.changedSince ? world.changes.filter((change) =>
      !change.subjectRef || related.has(change.subjectRef)) : [];
    const suggestedProbes = planPrototypeProbes(unknowns, {
      visualMode: visual.mode || "off", inference: visual.inference === true,
    });
    const base = { protocol: "apx", version: "1.0", representation: "apx.situation",
      profile: ["apx-core/1", "apx-web/1", "apx-situation/1"], situationRef,
      worldRef: world.worldRef, observationRef: world.observationRef, documentEpoch: world.documentEpoch,
      capturedAt: world.capturedAt, focus, requirements, facts: [...facts.values()], affordances,
      changes, unknowns, suggestedProbes,
      ...(visualProbes.length ? { visualProbes } : {}),
      completeness: world.completeness,
      budget: { used: { requirements: requirements.length, facts: facts.size,
        affordances: affordances.length, bytes: 0 }, omitted: {}, requiredPreserved: true },
      integrity: { canonicalSha256: null, worldSha256: world.integrity.worldSha256,
        sourceGraphSha256: world.integrity.sourceGraphSha256 } };
    base.budget.used.bytes = byteLength(base);
    const maxBytes = budget.maxBytes || 65536;
    if (base.budget.used.bytes > maxBytes) fail("situation budget cannot preserve every required answer",
      "APX_BUDGET_EXCEEDED");
    const canonicalSha256 = apxDigest(base);
    return Object.freeze({ ...base, integrity: Object.freeze({ ...base.integrity, canonicalSha256 }) });
  }
}
