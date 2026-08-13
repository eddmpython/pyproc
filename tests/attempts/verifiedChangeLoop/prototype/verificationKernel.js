// verificationKernel.js - Initiative 2 pure prototype. No browser or public product imports.
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const TERMINALS = new Set(["verified", "rejected", "incomplete"]);
const SEVERITIES = new Set(["blocker", "major", "minor", "advisory"]);
const RULE_KINDS = new Set(["structural", "behavioral", "perceptual"]);
const CHECKS = new Set(["requirementSatisfied", "minimumHitTarget", "notOccluded",
  "stateEquals", "actionConfirmed", "diagnosticsClean", "referenceReview"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  throw error;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("EYES_CONTRACT_INVALID", `${label} must be an object`);
  return value;
}

function exact(value, required, optional, label) {
  object(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("EYES_CONTRACT_INVALID", `${label}.${key} is unknown`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail("EYES_CONTRACT_INVALID", `${label}.${key} is required`);
}

function string(value, label, { id = false } = {}) {
  if (typeof value !== "string" || !value || (id && !ID.test(value))) fail("EYES_CONTRACT_INVALID", `${label} is invalid`);
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail("EYES_CONTRACT_INVALID", `${label} is invalid`);
}

export function canonicalVerificationJson(value, depth = 0) {
  if (depth > 48) fail("EYES_PACK_TOO_COMPLEX", "verification value exceeds the depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalVerificationJson(entry, depth + 1)).join(",")}]`;
  if (value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalVerificationJson(value[key], depth + 1)}`).join(",")}}`;
  }
  fail("EYES_PACK_INVALID", "verification value must be finite plain JSON");
}

export function verificationDigest(value) {
  return createHash("sha256").update(canonicalVerificationJson(value)).digest("hex");
}

export function confinedPath(rootInput, pathInput, label = "path") {
  if (typeof rootInput !== "string" || !isAbsolute(rootInput)) fail("EYES_PATH_INVALID", "repository root must be absolute");
  if (typeof pathInput !== "string" || !pathInput || isAbsolute(pathInput)) fail("EYES_PATH_INVALID", `${label} must be relative`);
  const root = resolve(rootInput);
  const candidate = resolve(root, pathInput);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail("EYES_PATH_ESCAPE", `${label} escapes the repository root`);
  return candidate;
}

function validateRequirement(requirement, label) {
  exact(requirement, ["requirementRef", "select", "need", "cardinality"], [], label);
  string(requirement.requirementRef, `${label}.requirementRef`, { id: true });
  exact(requirement.select, ["role"], ["name", "actionable"], `${label}.select`);
  string(requirement.select.role, `${label}.select.role`);
  if (requirement.select.name !== undefined) string(requirement.select.name, `${label}.select.name`);
  if (requirement.select.actionable !== undefined && typeof requirement.select.actionable !== "boolean") {
    fail("EYES_CONTRACT_INVALID", `${label}.select.actionable is invalid`);
  }
  if (!Array.isArray(requirement.need) || requirement.need.length < 1
    || requirement.need.some((need) => !["fact", "affordance", "change"].includes(need))) {
    fail("EYES_CONTRACT_INVALID", `${label}.need is invalid`);
  }
  if (!["one", "oneOrMore", "zeroOrMore"].includes(requirement.cardinality)) {
    fail("EYES_CONTRACT_INVALID", `${label}.cardinality is invalid`);
  }
}

function validateEnvironment(environment, index) {
  const label = `experience.environments[${index}]`;
  exact(environment, ["environmentId", "viewport", "locale", "timezoneId", "colorScheme",
    "reducedMotion", "fontFingerprint"], [], label);
  string(environment.environmentId, `${label}.environmentId`, { id: true });
  exact(environment.viewport, ["width", "height", "deviceScaleFactor", "mobile", "touch"], [], `${label}.viewport`);
  positiveInt(environment.viewport.width, `${label}.viewport.width`, 10000);
  positiveInt(environment.viewport.height, `${label}.viewport.height`, 10000);
  if (typeof environment.viewport.deviceScaleFactor !== "number" || environment.viewport.deviceScaleFactor <= 0
    || environment.viewport.deviceScaleFactor > 8) fail("EYES_CONTRACT_INVALID", `${label}.viewport.deviceScaleFactor is invalid`);
  if (typeof environment.viewport.mobile !== "boolean" || typeof environment.viewport.touch !== "boolean"
    || typeof environment.reducedMotion !== "boolean") fail("EYES_CONTRACT_INVALID", `${label} boolean is invalid`);
  for (const key of ["locale", "timezoneId", "fontFingerprint"]) string(environment[key], `${label}.${key}`);
  if (!["light", "dark", "no-preference"].includes(environment.colorScheme)) fail("EYES_CONTRACT_INVALID", `${label}.colorScheme is invalid`);
}

export function validateExperienceContract({ repositoryRoot, eyesText = "", experience, scenarios, baselines }) {
  if (typeof eyesText !== "string") fail("EYES_CONTRACT_INVALID", "EYES.md must be text");
  exact(experience, ["schemaVersion", "project", "target", "readiness", "environments", "scenarioCatalog",
    "baselineCatalog", "policy"], [], "experience");
  if (experience.schemaVersion !== "1") fail("EYES_CONTRACT_INVALID", "experience.schemaVersion must be 1");
  exact(experience.project, ["id"], [], "experience.project");
  string(experience.project.id, "experience.project.id", { id: true });
  exact(experience.target, ["baseUrl", "allowedOrigins"], [], "experience.target");
  let base;
  try { base = new URL(experience.target.baseUrl); } catch (error) { fail("EYES_CONTRACT_INVALID", "target.baseUrl is invalid"); }
  if (!["http:", "https:"].includes(base.protocol) || base.origin !== experience.target.baseUrl) {
    fail("EYES_CONTRACT_INVALID", "target.baseUrl must be an exact HTTP(S) origin");
  }
  if (!Array.isArray(experience.target.allowedOrigins) || experience.target.allowedOrigins.length < 1) {
    fail("EYES_CONTRACT_INVALID", "target.allowedOrigins is required");
  }
  for (const origin of experience.target.allowedOrigins) {
    if (origin === "*" || new URL(origin).origin !== origin) fail("EYES_CONTRACT_INVALID", "target origin must be exact");
  }
  if (!experience.target.allowedOrigins.includes(base.origin)) fail("EYES_CONTRACT_INVALID", "base origin is not allowed");
  exact(experience.readiness, ["scenarioRef", "timeoutMs"], [], "experience.readiness");
  string(experience.readiness.scenarioRef, "experience.readiness.scenarioRef", { id: true });
  positiveInt(experience.readiness.timeoutMs, "experience.readiness.timeoutMs", 300000);
  if (!Array.isArray(experience.environments) || experience.environments.length < 1) fail("EYES_CONTRACT_INVALID", "environments are required");
  experience.environments.forEach(validateEnvironment);
  if (new Set(experience.environments.map((entry) => entry.environmentId)).size !== experience.environments.length) {
    fail("EYES_CONTRACT_INVALID", "environmentId values must be unique");
  }
  confinedPath(repositoryRoot, experience.scenarioCatalog, "scenarioCatalog");
  confinedPath(repositoryRoot, experience.baselineCatalog, "baselineCatalog");
  exact(experience.policy, ["console", "network", "visual", "externalEffects", "rejectSeverities",
    "redactions", "artifactQuota"], [], "experience.policy");
  if (experience.policy.console !== "rejectUnexpectedError"
    || experience.policy.network !== "rejectUnexpectedFailure"
    || experience.policy.visual !== "boundedEvidence"
    || !["deny", "acknowledged"].includes(experience.policy.externalEffects)) fail("EYES_CONTRACT_INVALID", "policy is invalid");
  if (!Array.isArray(experience.policy.rejectSeverities)
    || experience.policy.rejectSeverities.some((value) => !SEVERITIES.has(value))) fail("EYES_CONTRACT_INVALID", "rejectSeverities are invalid");
  if (!Array.isArray(experience.policy.redactions)
    || experience.policy.redactions.some((value) => typeof value !== "string" || !value)) fail("EYES_CONTRACT_INVALID", "redactions are invalid");
  exact(experience.policy.artifactQuota, ["maxArtifacts", "maxArtifactBytes", "maxTotalBytes"], [], "artifactQuota");
  positiveInt(experience.policy.artifactQuota.maxArtifacts, "artifactQuota.maxArtifacts", 256);
  positiveInt(experience.policy.artifactQuota.maxArtifactBytes, "artifactQuota.maxArtifactBytes", 64 * 1024 * 1024);
  positiveInt(experience.policy.artifactQuota.maxTotalBytes, "artifactQuota.maxTotalBytes", 256 * 1024 * 1024);

  exact(scenarios, ["schemaVersion", "scenarios"], [], "scenarios");
  if (scenarios.schemaVersion !== "1" || !Array.isArray(scenarios.scenarios) || scenarios.scenarios.length < 1) {
    fail("EYES_CONTRACT_INVALID", "scenario catalog is invalid");
  }
  const scenarioIds = new Set();
  for (const [index, scenario] of scenarios.scenarios.entries()) {
    const label = `scenarios[${index}]`;
    exact(scenario, ["scenarioId", "purpose", "route", "fixtureSha256", "required", "readiness", "steps",
      "checkpoints", "cleanup"], [], label);
    string(scenario.scenarioId, `${label}.scenarioId`, { id: true });
    if (scenarioIds.has(scenario.scenarioId)) fail("EYES_CONTRACT_INVALID", "scenarioId values must be unique");
    scenarioIds.add(scenario.scenarioId);
    string(scenario.purpose, `${label}.purpose`);
    if (typeof scenario.route !== "string" || !scenario.route.startsWith("/") || scenario.route.startsWith("//")) fail("EYES_CONTRACT_INVALID", `${label}.route is invalid`);
    if (!SHA.test(scenario.fixtureSha256)) fail("EYES_CONTRACT_INVALID", `${label}.fixtureSha256 is invalid`);
    if (typeof scenario.required !== "boolean") fail("EYES_CONTRACT_INVALID", `${label}.required is invalid`);
    exact(scenario.readiness, ["requirements"], [], `${label}.readiness`);
    if (!Array.isArray(scenario.readiness.requirements) || scenario.readiness.requirements.length < 1) fail("EYES_CONTRACT_INVALID", `${label}.readiness requirements are required`);
    scenario.readiness.requirements.forEach((requirement, item) => validateRequirement(requirement, `${label}.readiness.requirements[${item}]`));
    if (!Array.isArray(scenario.steps)) fail("EYES_CONTRACT_INVALID", `${label}.steps is invalid`);
    for (const [stepIndex, step] of scenario.steps.entries()) {
      exact(step, ["stepId", "target", "action"], ["verify", "expectedTransition"], `${label}.steps[${stepIndex}]`);
      string(step.stepId, `${label}.steps[${stepIndex}].stepId`, { id: true });
      validateRequirement({ requirementRef: `requirement:${step.stepId}`, select: step.target,
        need: ["fact", "affordance"], cardinality: "one" }, `${label}.steps[${stepIndex}].target`);
      exact(step.action, ["kind", "expectedRisk"], [], `${label}.steps[${stepIndex}].action`);
      if (!["click", "fill", "press", "select", "check", "uncheck", "focus", "hover", "scroll"].includes(step.action.kind)
        || !["read", "mutate", "externalEffect"].includes(step.action.expectedRisk)) fail("EYES_CONTRACT_INVALID", `${label}.steps[${stepIndex}].action is invalid`);
      if (step.action.expectedRisk === "externalEffect" && experience.policy.externalEffects !== "acknowledged") {
        fail("EYES_AUTHORITY_DENIED", "external effect is not acknowledged by the experience contract");
      }
    }
    if (!Array.isArray(scenario.checkpoints) || scenario.checkpoints.length < 1) fail("EYES_CONTRACT_INVALID", `${label}.checkpoints are required`);
    for (const [checkpointIndex, checkpoint] of scenario.checkpoints.entries()) {
      const checkpointLabel = `${label}.checkpoints[${checkpointIndex}]`;
      exact(checkpoint, ["checkpointId", "focus", "rules"], [], checkpointLabel);
      string(checkpoint.checkpointId, `${checkpointLabel}.checkpointId`, { id: true });
      exact(checkpoint.focus, ["requirements"], [], `${checkpointLabel}.focus`);
      checkpoint.focus.requirements.forEach((requirement, item) => validateRequirement(requirement, `${checkpointLabel}.focus.requirements[${item}]`));
      if (!Array.isArray(checkpoint.rules) || checkpoint.rules.length < 1) fail("EYES_CONTRACT_INVALID", `${checkpointLabel}.rules are required`);
      for (const [ruleIndex, rule] of checkpoint.rules.entries()) {
        exact(rule, ["ruleId", "kind", "check", "severity"], ["requirementRef", "predicate", "expected", "minimum", "referenceSha256"], `${checkpointLabel}.rules[${ruleIndex}]`);
        string(rule.ruleId, `${checkpointLabel}.rules[${ruleIndex}].ruleId`, { id: true });
        if (!RULE_KINDS.has(rule.kind) || !CHECKS.has(rule.check) || !SEVERITIES.has(rule.severity)) fail("EYES_CONTRACT_INVALID", `${checkpointLabel}.rules[${ruleIndex}] is invalid`);
        if (rule.kind === "perceptual" && rule.severity !== "advisory") fail("EYES_CONTRACT_INVALID", "perceptual rules must be advisory");
      }
    }
    exact(scenario.cleanup, ["kind"], [], `${label}.cleanup`);
    if (scenario.cleanup.kind !== "detach") fail("EYES_CONTRACT_INVALID", `${label}.cleanup.kind is invalid`);
  }
  if (!scenarioIds.has(experience.readiness.scenarioRef)) fail("EYES_CONTRACT_INVALID", "readiness scenario is missing");

  exact(baselines, ["schemaVersion", "references"], [], "baselines");
  if (baselines.schemaVersion !== "1" || !Array.isArray(baselines.references)) fail("EYES_CONTRACT_INVALID", "baseline catalog is invalid");
  return Object.freeze({ experience: structuredClone(experience), scenarios: structuredClone(scenarios),
    baselines: structuredClone(baselines), eyesSha256: `sha256:${verificationDigest(eyesText)}` });
}

function factFor(situation, requirementRef, predicate) {
  const requirement = situation.requirements.find((entry) => entry.requirementRef === requirementRef);
  const refs = new Set(requirement?.claimRefs || []);
  return situation.facts.find((fact) => refs.has(fact.claimRef) && fact.predicate === predicate);
}

export function issueIdentity({ projectId, scenarioId, checkpointId, ruleId, entityLineage, environmentClass }) {
  const body = { projectId, scenarioId, checkpointId, ruleId, entityLineage, environmentClass };
  return `finding:${verificationDigest(body)}`;
}

export function evaluateCheckpoint({ projectId, scenarioId, checkpoint, environmentId, situation,
  actionEvidence = null, diagnostics = { console: [], network: [] }, inference = null }) {
  const evaluations = [];
  const findings = [];
  let incomplete = false;
  for (const rule of checkpoint.rules) {
    let state = "pass";
    let evidenceRefs = [];
    let entityLineage = `checkpoint:${checkpoint.checkpointId}`;
    if (rule.kind === "perceptual") {
      state = rule.referenceSha256 && inference?.inputSha256 === rule.referenceSha256 ? "needsReview" : "incomplete";
      incomplete ||= state === "incomplete";
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
      evidenceRefs = unexpected.map((entry) => entry.eventRef);
    }
    const evaluation = Object.freeze({ ruleId: rule.ruleId, kind: rule.kind, state, severity: rule.severity,
      evidenceRefs: Object.freeze(evidenceRefs) });
    evaluations.push(evaluation);
    if (state === "fail" || state === "needsReview") findings.push(Object.freeze({
      findingRef: issueIdentity({ projectId, scenarioId, checkpointId: checkpoint.checkpointId,
        ruleId: rule.ruleId, entityLineage, environmentClass: environmentId }),
      scenarioId, checkpointId: checkpoint.checkpointId, ruleId: rule.ruleId, kind: rule.kind,
      severity: rule.severity, state, entityLineage, environmentId, evidenceRefs: Object.freeze(evidenceRefs),
    }));
  }
  return Object.freeze({ evaluations: Object.freeze(evaluations), findings: Object.freeze(findings), incomplete });
}

export function scenarioTerminal({ required, checkpointResults, actionTerminals = [], cleanup = "completed" }) {
  if (cleanup !== "completed" || actionTerminals.some((terminal) => ["cancelled", "outcomeUnknown", "incomplete"].includes(terminal))
    || checkpointResults.some((result) => result.incomplete)) return "incomplete";
  const failed = checkpointResults.some((result) => result.evaluations.some((evaluation) => evaluation.state === "fail"));
  return required && failed ? "rejected" : "verified";
}

export function compareEvidencePacks(reference, current) {
  const keys = ["projectId", "contractSha256", "scenarioCatalogSha256", "fixtureSha256", "browserFamily",
    "browserVersion", "environmentId", "viewportSha256", "locale", "timezoneId", "fontFingerprint"];
  const mismatch = keys.filter((key) => reference.manifest[key] !== current.manifest[key]);
  if (mismatch.length) return Object.freeze({ comparable: false, terminal: "incomplete", mismatch: Object.freeze(mismatch), findings: Object.freeze([]) });
  const before = new Map(reference.findings.map((finding) => [finding.findingRef, finding]));
  const after = new Map(current.findings.map((finding) => [finding.findingRef, finding]));
  const findings = [];
  for (const [findingRef, finding] of after) {
    const old = before.get(findingRef);
    findings.push(Object.freeze({ findingRef, classification: !old ? "introduced"
      : old.severity !== finding.severity || verificationDigest(old.evidenceRefs) !== verificationDigest(finding.evidenceRefs)
        ? "changed" : "persisting" }));
  }
  for (const findingRef of before.keys()) if (!after.has(findingRef)) findings.push(Object.freeze({ findingRef, classification: "resolved" }));
  return Object.freeze({ comparable: true, terminal: current.verdict, mismatch: Object.freeze([]), findings: Object.freeze(findings) });
}

export function redactEvidence(value, secrets = []) {
  const secretSet = secrets.filter((secret) => typeof secret === "string" && secret);
  const visit = (current, key = "") => {
    if (Array.isArray(current)) return current.map((entry) => visit(entry));
    if (current && typeof current === "object") return Object.fromEntries(Object.entries(current).map(([childKey, child]) =>
      [childKey, /authorization|cookie|password|secret|token/i.test(childKey) ? "[REDACTED]" : visit(child, childKey)]));
    if (typeof current !== "string") return current;
    let text = current.replace(/([?&](?:token|key|secret)=)[^&#\s]+/gi, "$1[REDACTED]");
    for (const secret of secretSet) text = text.split(secret).join("[REDACTED]");
    return text;
  };
  return visit(value);
}

export function buildEvidencePack({ manifest, scenarioRuns, findings, artifacts = [], verdict,
  generatedAt = "1970-01-01T00:00:00.000Z", runId = "run:deterministic" }) {
  if (!TERMINALS.has(verdict)) fail("EYES_PACK_INVALID", "pack verdict is invalid");
  const content = Object.freeze({ format: "pyproc.evidencePack", version: 1,
    manifest: Object.freeze(structuredClone(manifest)), scenarioRuns: Object.freeze(structuredClone(scenarioRuns)),
    findings: Object.freeze(structuredClone(findings)), artifacts: Object.freeze(structuredClone(artifacts)), verdict });
  return Object.freeze({ ...content, generatedAt, runId, complete: true, contentSha256: verificationDigest(content) });
}

export function replayEvidencePack(pack, artifactBytes = new Map()) {
  exact(pack, ["format", "version", "manifest", "scenarioRuns", "findings", "artifacts", "verdict",
    "generatedAt", "runId", "complete", "contentSha256"], [], "pack");
  if (pack.format !== "pyproc.evidencePack" || pack.version !== 1 || pack.complete !== true || !TERMINALS.has(pack.verdict)) {
    fail("EYES_PACK_INVALID", "evidence pack header is invalid");
  }
  const content = { format: pack.format, version: pack.version, manifest: pack.manifest,
    scenarioRuns: pack.scenarioRuns, findings: pack.findings, artifacts: pack.artifacts, verdict: pack.verdict };
  if (verificationDigest(content) !== pack.contentSha256) fail("EYES_PACK_MUTATED", "evidence pack digest mismatch");
  for (const artifact of pack.artifacts) {
    const bytes = artifactBytes.get(artifact.sha256);
    if (!bytes || bytes.byteLength !== artifact.byteLength
      || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      fail("EYES_ARTIFACT_MISSING", `evidence artifact is missing or mutated: ${artifact.sha256}`);
    }
  }
  const recomputed = pack.scenarioRuns.some((run) => run.terminal === "incomplete") ? "incomplete"
    : pack.scenarioRuns.some((run) => run.terminal === "rejected") ? "rejected" : "verified";
  if (recomputed !== pack.verdict) fail("EYES_VERDICT_DIVERGED", "stored verdict does not match scenario terminals");
  return Object.freeze({ verdict: recomputed, contentSha256: pack.contentSha256,
    findingRefs: Object.freeze(pack.findings.map((finding) => finding.findingRef)) });
}
