// probePlanner.js - unknown reason을 최소 권한의 다음 측정으로 연결하는 prototype.
const COST = Object.freeze({ cache: 0, semantic: 1, reported: 2, geometry: 3, networkMetadata: 4,
  entityCrop: 5, inference: 6 });

export function planPrototypeProbes(unknowns, { visualMode = "off", inference = false } = {}) {
  const probes = [];
  for (const unknown of unknowns) {
    if (unknown.reason === "visualEvidenceRequired" && visualMode !== "off") {
      probes.push({ kind: "entityCrop", entityRef: unknown.entityRef, risk: "read",
        cost: COST.entityCrop, expectedInformation: "bounded visual evidence" });
      if (inference) probes.push({ kind: "inference", entityRef: unknown.entityRef, risk: "read",
        cost: COST.inference, expectedInformation: "inferred claim with explicit provenance" });
    } else if (unknown.reason === "stale") {
      probes.push({ kind: "semantic", risk: "read", cost: COST.semantic,
        expectedInformation: "fresh reconciled snapshot" });
    } else if (unknown.reason === "providerGap") {
      probes.push({ kind: "reported", risk: "read", cost: COST.reported,
        expectedInformation: "provider support boundary" });
    }
  }
  return Object.freeze(probes.sort((left, right) => left.cost - right.cost).map(Object.freeze));
}
