// experienceContract.js - repository prose와 strict machine contract의 경계를 강제한다.
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { BROWSER_AUTOMATION_ACTIONS } from "../browserControl/browserAutomationCatalog.js";
import { validatePostcondition } from "../perception/postconditionVerifier.js";
import { verificationBytesDigest, verificationDigest, verificationError } from "./verificationCanonical.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 1024 * 1024;
const SEVERITIES = new Set(["blocker", "major", "minor", "advisory"]);
const RULE_KINDS = new Set(["structural", "behavioral", "perceptual"]);
const CHECKS = new Set(["requirementSatisfied", "minimumHitTarget", "notOccluded",
  "stateEquals", "actionConfirmed", "diagnosticsClean", "referenceReview"]);
const ACTIONS = new Set(["click", "fill", "press", "select", "check", "uncheck", "focus", "hover", "scroll"]);

function fail(message, code = "EYES_CONTRACT_INVALID") { throw verificationError(code, message); }
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}
function exact(value, required, optional, label) {
  plain(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is unknown`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
}
function text(value, label, id = false) {
  if (typeof value !== "string" || !value || (id && !ID.test(value))) fail(`${label} is invalid`);
}
function positive(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(`${label} is invalid`);
}

export function confinedContractPath(rootInput, pathInput, label = "path") {
  if (typeof rootInput !== "string" || !isAbsolute(rootInput)) fail("contract root must be absolute", "EYES_PATH_INVALID");
  if (typeof pathInput !== "string" || !pathInput || isAbsolute(pathInput)) fail(`${label} must be relative`, "EYES_PATH_INVALID");
  const root = resolve(rootInput);
  const candidate = resolve(root, pathInput);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail(`${label} escapes the contract root`, "EYES_PATH_ESCAPE");
  return candidate;
}

function requirement(value, label) {
  exact(value, ["requirementRef", "select", "need", "cardinality"], [], label);
  text(value.requirementRef, `${label}.requirementRef`, true);
  exact(value.select, ["role"], ["name", "actionable"], `${label}.select`);
  text(value.select.role, `${label}.select.role`);
  if (value.select.name !== undefined) text(value.select.name, `${label}.select.name`);
  if (value.select.actionable !== undefined && typeof value.select.actionable !== "boolean") fail(`${label}.select.actionable is invalid`);
  if (!Array.isArray(value.need) || value.need.length < 1
    || value.need.some((need) => !["fact", "affordance", "change"].includes(need))) fail(`${label}.need is invalid`);
  if (!["one", "oneOrMore", "zeroOrMore"].includes(value.cardinality)) fail(`${label}.cardinality is invalid`);
}

function environment(value, index) {
  const label = `experience.environments[${index}]`;
  exact(value, ["environmentId", "viewport", "locale", "timezoneId", "colorScheme",
    "reducedMotion", "fontFingerprint"], [], label);
  text(value.environmentId, `${label}.environmentId`, true);
  exact(value.viewport, ["width", "height", "deviceScaleFactor", "mobile", "touch"], [], `${label}.viewport`);
  positive(value.viewport.width, `${label}.viewport.width`, 10000);
  positive(value.viewport.height, `${label}.viewport.height`, 10000);
  if (typeof value.viewport.deviceScaleFactor !== "number" || value.viewport.deviceScaleFactor <= 0
    || value.viewport.deviceScaleFactor > 8 || typeof value.viewport.mobile !== "boolean"
    || typeof value.viewport.touch !== "boolean" || typeof value.reducedMotion !== "boolean") fail(`${label} environment is invalid`);
  for (const key of ["locale", "timezoneId", "fontFingerprint"]) text(value[key], `${label}.${key}`);
  if (!["light", "dark", "no-preference"].includes(value.colorScheme)) fail(`${label}.colorScheme is invalid`);
}

export function assertExperienceContract({ contractRoot, eyesText, experience, scenarios, baselines }) {
  if (typeof eyesText !== "string") fail("EYES.md must be text");
  exact(experience, ["schemaVersion", "project", "target", "readiness", "environments", "scenarioCatalog",
    "baselineCatalog", "policy"], [], "experience");
  if (experience.schemaVersion !== "1") fail("experience.schemaVersion must be 1");
  exact(experience.project, ["id"], [], "experience.project");
  text(experience.project.id, "experience.project.id", true);
  exact(experience.target, ["baseUrl", "allowedOrigins"], [], "experience.target");
  let base;
  try { base = new URL(experience.target.baseUrl); } catch (error) { fail("target.baseUrl is invalid"); }
  if (!["http:", "https:"].includes(base.protocol) || base.origin !== experience.target.baseUrl) fail("target.baseUrl must be an exact HTTP(S) origin");
  if (!Array.isArray(experience.target.allowedOrigins) || experience.target.allowedOrigins.length < 1) fail("target.allowedOrigins is required");
  for (const origin of experience.target.allowedOrigins) {
    try { if (origin === "*" || new URL(origin).origin !== origin) fail("target origin must be exact"); }
    catch (error) { if (error?.code) throw error; fail("target origin is invalid"); }
  }
  if (!experience.target.allowedOrigins.includes(base.origin)) fail("base origin is not allowed");
  exact(experience.readiness, ["scenarioRef", "timeoutMs"], [], "experience.readiness");
  text(experience.readiness.scenarioRef, "experience.readiness.scenarioRef", true);
  positive(experience.readiness.timeoutMs, "experience.readiness.timeoutMs", 300000);
  if (!Array.isArray(experience.environments) || experience.environments.length < 1) fail("environments are required");
  experience.environments.forEach(environment);
  if (new Set(experience.environments.map((entry) => entry.environmentId)).size !== experience.environments.length) fail("environmentId values must be unique");
  confinedContractPath(contractRoot, experience.scenarioCatalog, "scenarioCatalog");
  confinedContractPath(contractRoot, experience.baselineCatalog, "baselineCatalog");
  exact(experience.policy, ["console", "network", "visual", "externalEffects", "rejectSeverities",
    "redactions", "artifactQuota"], [], "experience.policy");
  if (experience.policy.console !== "rejectUnexpectedError" || experience.policy.network !== "rejectUnexpectedFailure"
    || experience.policy.visual !== "boundedEvidence" || !["deny", "acknowledged"].includes(experience.policy.externalEffects)) fail("policy is invalid");
  if (!Array.isArray(experience.policy.rejectSeverities)
    || experience.policy.rejectSeverities.some((value) => !SEVERITIES.has(value))) fail("rejectSeverities are invalid");
  if (!Array.isArray(experience.policy.redactions)
    || experience.policy.redactions.some((value) => typeof value !== "string" || !value)) fail("redactions are invalid");
  exact(experience.policy.artifactQuota, ["maxArtifacts", "maxArtifactBytes", "maxTotalBytes"], [], "artifactQuota");
  positive(experience.policy.artifactQuota.maxArtifacts, "artifactQuota.maxArtifacts", 256);
  positive(experience.policy.artifactQuota.maxArtifactBytes, "artifactQuota.maxArtifactBytes", 64 * 1024 * 1024);
  positive(experience.policy.artifactQuota.maxTotalBytes, "artifactQuota.maxTotalBytes", 256 * 1024 * 1024);

  exact(scenarios, ["schemaVersion", "scenarios"], [], "scenarios");
  if (scenarios.schemaVersion !== "1" || !Array.isArray(scenarios.scenarios) || scenarios.scenarios.length < 1) fail("scenario catalog is invalid");
  const ids = new Set();
  const perceptualReferences = new Set();
  for (const [index, scenario] of scenarios.scenarios.entries()) {
    const label = `scenarios[${index}]`;
    exact(scenario, ["scenarioId", "purpose", "route", "fixturePath", "fixtureSha256", "required", "readiness", "steps",
      "checkpoints", "cleanup"], [], label);
    text(scenario.scenarioId, `${label}.scenarioId`, true);
    if (ids.has(scenario.scenarioId)) fail("scenarioId values must be unique");
    ids.add(scenario.scenarioId);
    text(scenario.purpose, `${label}.purpose`);
    if (typeof scenario.route !== "string" || !scenario.route.startsWith("/") || scenario.route.startsWith("//")) fail(`${label}.route is invalid`);
    confinedContractPath(contractRoot, scenario.fixturePath, `${label}.fixturePath`);
    if (!SHA.test(scenario.fixtureSha256)) fail(`${label}.fixtureSha256 is invalid`);
    if (typeof scenario.required !== "boolean") fail(`${label}.required is invalid`);
    exact(scenario.readiness, ["requirements"], [], `${label}.readiness`);
    if (!Array.isArray(scenario.readiness.requirements) || scenario.readiness.requirements.length < 1) fail(`${label}.readiness requirements are required`);
    scenario.readiness.requirements.forEach((item, itemIndex) => requirement(item, `${label}.readiness.requirements[${itemIndex}]`));
    if (!Array.isArray(scenario.steps)) fail(`${label}.steps is invalid`);
    const effectSteps = scenario.steps.filter((step) => step?.action?.expectedRisk !== "read");
    if (effectSteps.length > 1) fail(`${label} may declare at most one effect step`);
    for (const [stepIndex, step] of scenario.steps.entries()) {
      const stepLabel = `${label}.steps[${stepIndex}]`;
      exact(step, ["stepId", "target", "action"], ["verify", "expectedTransition"], stepLabel);
      text(step.stepId, `${stepLabel}.stepId`, true);
      requirement({ requirementRef: `requirement:${step.stepId}`, select: step.target,
        need: ["fact", "affordance"], cardinality: "one" }, `${stepLabel}.target`);
      exact(step.action, ["kind", "expectedRisk"], ["value", "values", "key", "modifiers"], `${stepLabel}.action`);
      if (!ACTIONS.has(step.action.kind) || !["read", "mutate", "externalEffect"].includes(step.action.expectedRisk)) fail(`${stepLabel}.action is invalid`);
      if (BROWSER_AUTOMATION_ACTIONS[step.action.kind]?.risk !== step.action.expectedRisk) {
        fail(`${stepLabel}.action.expectedRisk does not match the browser action catalog`);
      }
      if (step.action.kind === "fill" && typeof step.action.value !== "string") fail(`${stepLabel}.action.value is required`);
      if (step.action.kind === "select" && (!Array.isArray(step.action.values) || step.action.values.length < 1
        || step.action.values.some((entry) => typeof entry !== "string"))) fail(`${stepLabel}.action.values are required`);
      if (step.action.kind === "press" && typeof step.action.key !== "string") fail(`${stepLabel}.action.key is required`);
      if (step.verify !== undefined) {
        plain(step.verify, `${stepLabel}.verify`);
        try { validatePostcondition(step.verify); }
        catch (error) { fail(`${stepLabel}.verify is invalid: ${error?.message || error}`); }
      }
      if (step.expectedTransition !== undefined) plain(step.expectedTransition, `${stepLabel}.expectedTransition`);
      if (step.action.expectedRisk !== "read" && step.verify === undefined) {
        fail(`${stepLabel}.verify is required for an effect step`);
      }
      if (step.action.expectedRisk === "externalEffect" && experience.policy.externalEffects !== "acknowledged") {
        fail("external effect is not acknowledged by the experience contract", "EYES_AUTHORITY_DENIED");
      }
    }
    if (!Array.isArray(scenario.checkpoints) || scenario.checkpoints.length < 1) fail(`${label}.checkpoints are required`);
    for (const [checkpointIndex, checkpoint] of scenario.checkpoints.entries()) {
      const checkpointLabel = `${label}.checkpoints[${checkpointIndex}]`;
      exact(checkpoint, ["checkpointId", "focus", "rules"], [], checkpointLabel);
      text(checkpoint.checkpointId, `${checkpointLabel}.checkpointId`, true);
      exact(checkpoint.focus, ["requirements"], [], `${checkpointLabel}.focus`);
      if (!Array.isArray(checkpoint.focus.requirements) || checkpoint.focus.requirements.length < 1) fail(`${checkpointLabel}.focus.requirements are required`);
      checkpoint.focus.requirements.forEach((item, itemIndex) => requirement(item, `${checkpointLabel}.focus.requirements[${itemIndex}]`));
      if (!Array.isArray(checkpoint.rules) || checkpoint.rules.length < 1) fail(`${checkpointLabel}.rules are required`);
      for (const [ruleIndex, rule] of checkpoint.rules.entries()) {
        const ruleLabel = `${checkpointLabel}.rules[${ruleIndex}]`;
        exact(rule, ["ruleId", "kind", "check", "severity"], ["requirementRef", "predicate", "expected", "minimum", "referenceSha256"], ruleLabel);
        text(rule.ruleId, `${ruleLabel}.ruleId`, true);
        if (!RULE_KINDS.has(rule.kind) || !CHECKS.has(rule.check) || !SEVERITIES.has(rule.severity)) fail(`${ruleLabel} is invalid`);
        if (rule.kind === "perceptual" && rule.severity !== "advisory") fail("perceptual rules must be advisory");
        if (["requirementSatisfied", "minimumHitTarget", "notOccluded", "stateEquals"].includes(rule.check)
          && !rule.requirementRef) fail(`${ruleLabel}.requirementRef is required`);
        if (rule.check === "minimumHitTarget" && (typeof rule.minimum !== "number" || rule.minimum < 0)) {
          fail(`${ruleLabel}.minimum is required`);
        }
        if (rule.check === "stateEquals" && (!rule.predicate || !Object.hasOwn(rule, "expected"))) {
          fail(`${ruleLabel}.predicate and expected are required`);
        }
        if (rule.check === "actionConfirmed" && rule.kind !== "behavioral") fail(`${ruleLabel} must be behavioral`);
        if (rule.check === "diagnosticsClean" && rule.kind !== "behavioral") fail(`${ruleLabel} must be behavioral`);
        if (rule.check === "referenceReview" && (rule.kind !== "perceptual" || !SHA.test(String(rule.referenceSha256 || "")))) {
          fail(`${ruleLabel} requires a perceptual referenceSha256`);
        }
        if (rule.kind === "perceptual") perceptualReferences.add(rule.referenceSha256);
      }
    }
    if (effectSteps.length && !scenario.checkpoints.some((checkpoint) => checkpoint.rules.some((rule) =>
      rule.kind === "behavioral" && rule.check === "actionConfirmed"))) {
      fail(`${label} effect step requires a behavioral actionConfirmed rule`);
    }
    exact(scenario.cleanup, ["kind"], [], `${label}.cleanup`);
    if (scenario.cleanup.kind !== "detach") fail(`${label}.cleanup.kind is invalid`);
  }
  if (!ids.has(experience.readiness.scenarioRef)) fail("readiness scenario is missing");
  exact(baselines, ["schemaVersion", "references"], [], "baselines");
  if (baselines.schemaVersion !== "1" || !Array.isArray(baselines.references)) fail("baseline catalog is invalid");
  const baselineIds = new Set();
  const baselineDigests = new Set();
  for (const [index, reference] of baselines.references.entries()) {
    const label = `baselines.references[${index}]`;
    exact(reference, ["referenceId", "path", "sha256", "mimeType", "purpose"], [], label);
    text(reference.referenceId, `${label}.referenceId`, true);
    if (baselineIds.has(reference.referenceId)) fail("baseline referenceId values must be unique");
    baselineIds.add(reference.referenceId);
    confinedContractPath(contractRoot, reference.path, `${label}.path`);
    if (!SHA.test(reference.sha256)) fail(`${label}.sha256 is invalid`);
    baselineDigests.add(reference.sha256);
    text(reference.mimeType, `${label}.mimeType`);
    text(reference.purpose, `${label}.purpose`);
  }
  for (const digest of perceptualReferences) {
    if (!baselineDigests.has(digest)) fail(`perceptual reference is absent from the baseline catalog: ${digest}`);
  }
  return Object.freeze({ contractRoot, eyesText, experience: Object.freeze(structuredClone(experience)),
    scenarios: Object.freeze(structuredClone(scenarios)), baselines: Object.freeze(structuredClone(baselines)) });
}

async function boundedRead(path, label) {
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) { fail(`${label} is unavailable`, "EYES_CONTRACT_MISSING"); }
  if (bytes.byteLength > MAX_FILE_BYTES) fail(`${label} exceeds the byte limit`, "EYES_CONTRACT_TOO_LARGE");
  return bytes;
}
async function boundedConfinedRead(root, pathInput, label) {
  const candidate = confinedContractPath(root, pathInput, label);
  let actual;
  try { actual = await realpath(candidate); }
  catch (error) { fail(`${label} is unavailable`, "EYES_CONTRACT_MISSING"); }
  const rel = relative(resolve(root), actual);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail(`${label} escapes the contract root`, "EYES_PATH_ESCAPE");
  return boundedRead(actual, label);
}
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch (error) { fail(`${label} is not valid JSON`); }
}

export async function loadExperienceContract(contractRootInput) {
  if (typeof contractRootInput !== "string" || !isAbsolute(contractRootInput)) fail("contractRoot must be absolute", "EYES_PATH_INVALID");
  const contractRoot = await realpath(resolve(contractRootInput));
  const eyesBytes = await boundedConfinedRead(contractRoot, "EYES.md", "EYES.md");
  const experienceBytes = await boundedConfinedRead(contractRoot, "experience.json", "experience.json");
  const experience = parseJson(experienceBytes, "experience.json");
  const scenarioBytes = await boundedConfinedRead(contractRoot, experience.scenarioCatalog || "", "scenarioCatalog");
  const baselineBytes = await boundedConfinedRead(contractRoot, experience.baselineCatalog || "", "baselineCatalog");
  const contract = assertExperienceContract({ contractRoot, eyesText: eyesBytes.toString("utf8"), experience,
    scenarios: parseJson(scenarioBytes, "scenario catalog"), baselines: parseJson(baselineBytes, "baseline catalog") });
  for (const scenario of contract.scenarios.scenarios) {
    const bytes = await boundedConfinedRead(contractRoot, scenario.fixturePath, `scenario fixture ${scenario.scenarioId}`);
    if (`sha256:${verificationBytesDigest(bytes)}` !== scenario.fixtureSha256) {
      fail(`scenario fixture digest mismatch: ${scenario.scenarioId}`, "EYES_FIXTURE_MUTATED");
    }
  }
  for (const reference of contract.baselines.references) {
    const bytes = await boundedConfinedRead(contractRoot, reference.path, `baseline ${reference.referenceId}`);
    if (`sha256:${verificationBytesDigest(bytes)}` !== reference.sha256) {
      fail(`baseline digest mismatch: ${reference.referenceId}`, "EYES_BASELINE_MUTATED");
    }
  }
  return Object.freeze({ ...contract, identity: Object.freeze({
    eyesSha256: `sha256:${verificationBytesDigest(eyesBytes)}`,
    experienceSha256: `sha256:${verificationDigest(contract.experience)}`,
    scenarioCatalogSha256: `sha256:${verificationDigest(contract.scenarios)}`,
    baselineCatalogSha256: `sha256:${verificationDigest(contract.baselines)}`,
  }) });
}
