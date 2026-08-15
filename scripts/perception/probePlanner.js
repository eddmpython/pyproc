// probePlanner.js - unknown을 권한과 비용이 명시된 최소 다음 관측으로 연결한다.
import { compareNames } from "../../src/machine/contracts/deterministicOrder.js";
import { isVisualApxUnresolvedReason } from "./unresolvedVocabulary.js";

const COST = Object.freeze({
  cache: 0,
  semantic: 1,
  reported: 2,
  geometry: 3,
  networkMetadata: 4,
  entityCrop: 5,
  contextCrop: 6,
  inference: 7,
});

const READ_PROBES = new Set(["cache", "semantic", "reported", "geometry", "networkMetadata",
  "entityCrop", "contextCrop", "inference"]);

function immutable(value) {
  return Object.freeze({ ...value });
}

export function planSituationProbes(unknowns, {
  visualMode = "off",
  inference = false,
  supported = Object.keys(COST),
  maxProbes = 16,
} = {}) {
  const available = new Set(supported);
  const candidates = [];
  for (const unknown of unknowns) {
    if ((unknown.reason === "visualEvidenceRequired" || isVisualApxUnresolvedReason(unknown.reason))
      && visualMode !== "off") {
      candidates.push({ kind: "entityCrop", entityRef: unknown.entityRef, risk: "read",
        expectedInformation: "bounded visual evidence", requirementRef: unknown.requirementRef });
      if (visualMode === "full") candidates.push({ kind: "contextCrop", entityRef: unknown.entityRef, risk: "read",
        expectedInformation: "bounded visual context", requirementRef: unknown.requirementRef });
      if (inference) candidates.push({ kind: "inference", entityRef: unknown.entityRef, risk: "read",
        expectedInformation: "an inferred claim with explicit provenance", requirementRef: unknown.requirementRef });
    } else if (unknown.reason === "stale") {
      candidates.push({ kind: "semantic", risk: "read", expectedInformation: "a fresh reconciled snapshot",
        requirementRef: unknown.requirementRef });
    } else if (unknown.reason === "providerGap" || unknown.reason === "missingChannel") {
      candidates.push({ kind: "reported", risk: "read", expectedInformation: "the provider support boundary",
        requirementRef: unknown.requirementRef });
    }
  }
  const seen = new Set();
  return Object.freeze(candidates
    .filter((probe) => available.has(probe.kind) && READ_PROBES.has(probe.kind))
    .map((probe) => immutable({ ...probe, cost: COST[probe.kind] }))
    .sort((left, right) => left.cost - right.cost
      || compareNames(String(left.requirementRef), String(right.requirementRef))
      || compareNames(String(left.entityRef), String(right.entityRef)))
    .filter((probe) => {
      const key = `${probe.kind}:${probe.requirementRef || ""}:${probe.entityRef || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxProbes));
}

export const SITUATION_PROBE_COSTS = COST;
