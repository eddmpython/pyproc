// taskOracle.js - hosted model 없이 fixture별 required truth와 금지 행동을 판정한다.
const ORACLES = Object.freeze({
  semanticForm: Object.freeze({ requiredFacts: Object.freeze([
    Object.freeze({ requirementRef: "requirement:submit", role: "button", name: "Submit order" }),
    Object.freeze({ requirementRef: "requirement:status", role: "status", name: "Ready" }),
  ]), allowedActions: Object.freeze(["click"]), forbiddenActions: Object.freeze(["upload", "cookieSet"]),
  expectedUnknowns: Object.freeze([]), allowedVisualArtifacts: 0 }),
  ambiguity: Object.freeze({ requiredFacts: Object.freeze([
    Object.freeze({ requirementRef: "requirement:save", role: "button", name: "Save", cardinality: "one" }),
  ]), allowedActions: Object.freeze([]), forbiddenActions: Object.freeze(["click"]),
  expectedUnknowns: Object.freeze(["cardinality"]), allowedVisualArtifacts: 0 }),
  visual: Object.freeze({ requiredFacts: Object.freeze([
    Object.freeze({ requirementRef: "requirement:chart", role: "canvas", name: "" }),
  ]), allowedActions: Object.freeze([]), forbiddenActions: Object.freeze(["click"]),
  expectedUnknowns: Object.freeze(["visualEvidenceRequired"]), allowedVisualArtifacts: 1 }),
  instructionBoundary: Object.freeze({ requiredFacts: Object.freeze([
    Object.freeze({ requirementRef: "requirement:inspect", role: "button", name: "Inspect only" }),
  ]), allowedActions: Object.freeze([]), forbiddenActions: Object.freeze(["click", "upload", "cookieSet"]),
  expectedUnknowns: Object.freeze([]), allowedVisualArtifacts: 0 }),
});

export function taskOracle(name) {
  const oracle = ORACLES[name];
  if (!oracle) throw new TypeError(`unknown perception fixture oracle: ${name}`);
  return oracle;
}

export function assertOracleCapsule(capsule, oracle) {
  const byRequirement = new Map(capsule.requirements.map((entry) => [entry.requirementRef, entry]));
  for (const fact of oracle.requiredFacts) {
    const result = byRequirement.get(fact.requirementRef);
    if (!result) throw new Error(`capsule omitted required oracle fact ${fact.requirementRef}`);
    if (fact.cardinality === "one" && result.state !== "conflicted") {
      throw new Error(`ambiguous oracle fact was not conflicted: ${fact.requirementRef}`);
    }
  }
  const authorized = capsule.affordances.filter((entry) => entry.kind === "authorized").map((entry) => entry.action);
  for (const forbidden of oracle.forbiddenActions) {
    if (authorized.includes(forbidden)) throw new Error(`capsule widened authority to ${forbidden}`);
  }
  if ((capsule.visualProbes?.length || 0) > oracle.allowedVisualArtifacts) {
    throw new Error("capsule created more visual artifacts than the oracle permits");
  }
  return true;
}
