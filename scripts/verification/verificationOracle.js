// verificationOracle.js - deterministic checkpoint truth와 stable finding identity.
import { verificationDigest } from "./verificationCanonical.js";

function factFor(situation, requirementRef, predicate) {
  const requirement = situation.requirements.find((entry) => entry.requirementRef === requirementRef);
  const refs = new Set(requirement?.claimRefs || []);
  return situation.facts.find((fact) => refs.has(fact.claimRef) && fact.predicate === predicate);
}

export function findingIdentity({ projectId, scenarioId, checkpointId, ruleId, entityLineage, environmentClass }) {
  return `finding:${verificationDigest({ projectId, scenarioId, checkpointId, ruleId,
    entityLineage, environmentClass })}`;
}

export function evaluateVerificationCheckpoint({ projectId, scenarioId, checkpoint, environmentId, situation,
  actionEvidence = null, diagnostics = { console: [], network: [] }, inference = null }) {
  const evaluations = [];
  const findings = [];
  let incomplete = false;
  for (const rule of checkpoint.rules) {
    let state = "pass";
    let evidenceRefs = [];
    let entityLineage = `checkpoint:${checkpoint.checkpointId}`;
    if (rule.kind === "perceptual") {
      state = rule.referenceSha256 && inference?.inputSha256 ? "needsReview" : "incomplete";
      incomplete ||= state === "incomplete";
      evidenceRefs = [...(inference?.evidenceRefs || [])];
    } else if (rule.check === "requirementSatisfied") {
      const requirement = situation.requirements.find((entry) => entry.requirementRef === rule.requirementRef);
      state = requirement?.state === "satisfied" ? "pass"
        : !requirement || ["unknown", "stale"].includes(requirement.state) ? "incomplete" : "fail";
      incomplete ||= state === "incomplete";
      evidenceRefs = [...(requirement?.claimRefs || [])];
      entityLineage = requirement?.entityRefs?.[0] || `requirement:${rule.requirementRef}`;
    } else if (rule.check === "minimumHitTarget") {
      const fact = factFor(situation, rule.requirementRef, "geometry.rect");
      state = !fact ? "incomplete" : fact.value.width >= rule.minimum && fact.value.height >= rule.minimum ? "pass" : "fail";
      incomplete ||= state === "incomplete";
      evidenceRefs = fact ? [fact.claimRef] : [];
      entityLineage = fact?.subjectRef || `requirement:${rule.requirementRef}`;
    } else if (rule.check === "notOccluded" || rule.check === "stateEquals") {
      const predicate = rule.check === "notOccluded" ? "geometry.occluded" : rule.predicate;
      const expected = rule.check === "notOccluded" ? false : rule.expected;
      const fact = factFor(situation, rule.requirementRef, predicate);
      state = !fact ? "incomplete" : Object.is(fact.value, expected) ? "pass" : "fail";
      incomplete ||= state === "incomplete";
      evidenceRefs = fact ? [fact.claimRef] : [];
      entityLineage = fact?.subjectRef || `requirement:${rule.requirementRef}`;
    } else if (rule.check === "actionConfirmed") {
      state = !actionEvidence ? "incomplete" : actionEvidence.verification?.state === "confirmed" ? "pass" : "fail";
      incomplete ||= state === "incomplete";
      evidenceRefs = actionEvidence ? [actionEvidence.evidenceRef] : [];
      entityLineage = actionEvidence?.actionRef || entityLineage;
    } else if (rule.check === "diagnosticsClean") {
      const unexpected = [...diagnostics.console, ...diagnostics.network];
      state = unexpected.length ? "fail" : "pass";
      evidenceRefs = unexpected.map((entry) => entry.eventRef).filter(Boolean);
    }
    const evaluation = Object.freeze({ ruleId: rule.ruleId, kind: rule.kind, state,
      severity: rule.severity, evidenceRefs: Object.freeze(evidenceRefs) });
    evaluations.push(evaluation);
    if (state === "fail" || state === "needsReview") findings.push(Object.freeze({
      findingRef: findingIdentity({ projectId, scenarioId, checkpointId: checkpoint.checkpointId,
        ruleId: rule.ruleId, entityLineage, environmentClass: environmentId }),
      scenarioId, checkpointId: checkpoint.checkpointId, ruleId: rule.ruleId, kind: rule.kind,
      severity: rule.severity, state, entityLineage, environmentId, evidenceRefs: Object.freeze(evidenceRefs),
    }));
  }
  return Object.freeze({ evaluations: Object.freeze(evaluations), findings: Object.freeze(findings), incomplete });
}

export function verificationScenarioTerminal({ required, checkpointResults, actionTerminals = [], cleanup = "completed",
  rejectSeverities = ["blocker", "major", "minor"] }) {
  if (cleanup !== "completed" || actionTerminals.some((terminal) =>
    ["cancelled", "outcomeUnknown", "incomplete"].includes(terminal))
    || checkpointResults.some((result) => result.incomplete)) return "incomplete";
  const rejected = new Set(rejectSeverities);
  const failed = checkpointResults.some((result) => result.evaluations.some((evaluation) =>
    evaluation.state === "fail" && rejected.has(evaluation.severity)));
  return required && failed ? "rejected" : "verified";
}

export function redactVerificationEvidence(value, secrets = []) {
  const secretSet = secrets.filter((secret) => typeof secret === "string" && secret);
  const visit = (current) => {
    if (Array.isArray(current)) return current.map((entry) => visit(entry));
    if (current && typeof current === "object") return Object.fromEntries(Object.entries(current).map(([key, child]) =>
      [key, /authorization|cookie|password|secret|token/i.test(key) ? "[REDACTED]" : visit(child)]));
    if (typeof current !== "string") return current;
    let text = current.replace(/([?&](?:token|key|secret)=)[^&#\s]+/gi, "$1[REDACTED]");
    for (const secret of secretSet) text = text.split(secret).join("[REDACTED]");
    return text;
  };
  return visit(value);
}
