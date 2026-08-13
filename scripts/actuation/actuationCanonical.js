// actuationCanonical.js - absolute intent부터 receipt와 episode까지의 closed canonical truth.
import { createHash, randomBytes } from "node:crypto";

export const ACTUATION_PROTOCOL = "pyproc.actuation";
export const ACTUATION_VERSION = 1;
export const ACTUATION_INTENTS = Object.freeze([
  "activate", "focus", "setValue", "setSelected", "setExpanded", "scrollTo", "dragTo",
]);
export const ACTUATOR_KINDS = Object.freeze([
  "cooperative", "browserInput", "accessibility", "osInput", "replay",
]);
export const ACTUATION_TERMINALS = Object.freeze([
  "confirmed", "contradicted", "ambiguous", "notObserved", "outcomeUnknown",
  "alreadySatisfied", "notSent", "rejected",
]);
export const ACTUATION_ERROR_CODES = Object.freeze({
  intentInvalid: "ACTUATION_INTENT_INVALID",
  targetStale: "ACTUATION_TARGET_STALE",
  targetAmbiguous: "ACTUATION_TARGET_AMBIGUOUS",
  perceptionIncomplete: "ACTUATION_PERCEPTION_INCOMPLETE",
  authorityRequired: "ACTUATION_AUTHORITY_REQUIRED",
  actuatorUnavailable: "ACTUATION_ACTUATOR_UNAVAILABLE",
  preflightFailed: "ACTUATION_PREFLIGHT_FAILED",
  controlRevoked: "ACTUATION_CONTROL_REVOKED",
  gestureAborted: "ACTUATION_GESTURE_ABORTED",
  providerRejected: "ACTUATION_PROVIDER_REJECTED",
  outcomeUnknown: "ACTUATION_OUTCOME_UNKNOWN",
  verificationAmbiguous: "ACTUATION_VERIFICATION_AMBIGUOUS",
  nativeIntegrity: "ACTUATION_NATIVE_INTEGRITY",
  policyStale: "ACTUATION_POLICY_STALE",
  policyRejected: "ACTUATION_POLICY_REJECTED",
  cleanupIncomplete: "ACTUATION_CLEANUP_INCOMPLETE",
  receiptInvalid: "ACTUATION_RECEIPT_INVALID",
  episodeInvalid: "ACTUATION_EPISODE_INVALID",
});

const INTENT_SET = new Set(ACTUATION_INTENTS);
const ACTUATOR_SET = new Set(ACTUATOR_KINDS);
const TERMINAL_SET = new Set(ACTUATION_TERMINALS);
const DIGEST_RE = /^[0-9a-f]{64}$/;
const REF_RE = /^[a-z][A-Za-z0-9.]*:[A-Za-z0-9._:-]{1,192}$/;
const MAX_DEPTH = 40;
const MAX_ITEMS = 100000;
const MAX_CANONICAL_BYTES = 4 * 1024 * 1024;
const SECRET_KEY = /password|secret|token|cookie|authorization|card|credential|clipboard/i;
const HANDLE_KEY = /^(?:.*(?:handle|pointer|nodeid|objectid|runtimeid|backendnode|coordinate)|x|y)$/i;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function actuationError(code, message, details = null, outcome = "notSent") {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  if (details) error.details = details;
  return error;
}

function fail(code, message, details = null, outcome = "notSent") {
  throw actuationError(code, message, details, outcome);
}

function plain(value, label, code = ACTUATION_ERROR_CODES.intentInvalid) {
  if (!plainObject(value)) fail(code, `${label} must be a plain object`);
  return value;
}

function exact(value, keys, label, code = ACTUATION_ERROR_CODES.intentInvalid) {
  plain(value, label, code);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(code, `${label}.${key} is unknown`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(code, `${label}.${key} is required`);
}

function digestValue(value, label, code = ACTUATION_ERROR_CODES.intentInvalid) {
  if (!DIGEST_RE.test(String(value || ""))) fail(code, `${label} must be a lowercase SHA-256 digest`);
  return value;
}

function reference(value, label, { nullable = false, code = ACTUATION_ERROR_CODES.intentInvalid } = {}) {
  if (nullable && value === null) return value;
  if (!REF_RE.test(String(value || ""))) fail(code, `${label} is invalid`);
  return value;
}

function finiteJson(value, path = "value", depth = 0, state = { items: 0 }) {
  state.items += 1;
  if (state.items > MAX_ITEMS || depth > MAX_DEPTH) {
    fail(ACTUATION_ERROR_CODES.intentInvalid, `${path} exceeds the structural limit`);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) finiteJson(value[index], `${path}[${index}]`, depth + 1, state);
    return;
  }
  plain(value, path);
  for (const [key, child] of Object.entries(value)) finiteJson(child, `${path}.${key}`, depth + 1, state);
}

function noSensitiveOrHandleKeys(value, path = "value") {
  const stack = [{ value, path }];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((child, index) => stack.push({ value: child, path: `${current.path}[${index}]` }));
    } else if (plainObject(current.value)) {
      for (const [key, child] of Object.entries(current.value)) {
        if (SECRET_KEY.test(key)) fail(ACTUATION_ERROR_CODES.intentInvalid, `${current.path}.${key} is sensitive`);
        if (HANDLE_KEY.test(key)) fail(ACTUATION_ERROR_CODES.intentInvalid, `${current.path}.${key} is provider-local`);
        stack.push({ value: child, path: `${current.path}.${key}` });
      }
    }
  }
}

export function canonicalActuationJson(value, depth = 0) {
  if (depth > MAX_DEPTH) fail(ACTUATION_ERROR_CODES.intentInvalid, "actuation value exceeds the depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalActuationJson(entry, depth + 1)).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalActuationJson(value[key], depth + 1)}`).join(",")}}`;
  fail(ACTUATION_ERROR_CODES.intentInvalid, "actuation values must be finite plain JSON");
}

export function actuationDigest(value) {
  const canonical = canonicalActuationJson(value);
  if (Buffer.byteLength(canonical) > MAX_CANONICAL_BYTES) {
    fail(ACTUATION_ERROR_CODES.intentInvalid, "actuation value exceeds the byte limit");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

function clone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(clone));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])));
}
const sortedUnique = (values) => [...new Set(values)].sort();

function validateDesired(intent, desired) {
  plain(desired, "ActuationIntent.desired");
  const keys = Object.keys(desired);
  if (intent === "activate") {
    exact(desired, new Set(["activated"]), "ActuationIntent.desired");
    if (desired.activated !== true) fail(ACTUATION_ERROR_CODES.intentInvalid, "activate requires activated true");
  } else if (intent === "focus") {
    exact(desired, new Set(["focused"]), "ActuationIntent.desired");
    if (desired.focused !== true) fail(ACTUATION_ERROR_CODES.intentInvalid, "focus requires focused true");
  } else if (intent === "setValue") {
    if (keys.length !== 1 || !["value", "valueRef"].includes(keys[0])) {
      fail(ACTUATION_ERROR_CODES.intentInvalid, "setValue requires exactly one value or valueRef");
    }
    if (keys[0] === "value" && !(typeof desired.value === "string"
      || (typeof desired.value === "number" && Number.isFinite(desired.value)))) {
      fail(ACTUATION_ERROR_CODES.intentInvalid, "setValue value is invalid");
    }
    if (keys[0] === "valueRef") reference(desired.valueRef, "ActuationIntent.desired.valueRef");
  } else if (intent === "setSelected") {
    exact(desired, new Set(["selected"]), "ActuationIntent.desired");
    if (!(typeof desired.selected === "boolean" || (Array.isArray(desired.selected)
      && desired.selected.length > 0 && desired.selected.length <= 100
      && desired.selected.every((item) => typeof item === "string")))) {
      fail(ACTUATION_ERROR_CODES.intentInvalid, "setSelected state is invalid");
    }
  } else if (intent === "setExpanded") {
    exact(desired, new Set(["expanded"]), "ActuationIntent.desired");
    if (typeof desired.expanded !== "boolean") fail(ACTUATION_ERROR_CODES.intentInvalid, "expanded state is invalid");
  } else if (intent === "scrollTo") {
    exact(desired, new Set(["visibility"]), "ActuationIntent.desired");
    if (!["full", "nearest", "start", "center", "end"].includes(desired.visibility)) {
      fail(ACTUATION_ERROR_CODES.intentInvalid, "scroll visibility is invalid");
    }
  } else if (intent === "dragTo") {
    if (keys.length !== 1 || !["targetEntityRef", "semanticValue"].includes(keys[0])) {
      fail(ACTUATION_ERROR_CODES.intentInvalid, "dragTo requires one semantic destination");
    }
    if (keys[0] === "targetEntityRef") reference(desired.targetEntityRef, "ActuationIntent.desired.targetEntityRef");
    if (keys[0] === "semanticValue" && !(typeof desired.semanticValue === "string"
      || (typeof desired.semanticValue === "number" && Number.isFinite(desired.semanticValue)))) {
      fail(ACTUATION_ERROR_CODES.intentInvalid, "dragTo semantic value is invalid");
    }
  }
}

const INTENT_KEYS = new Set(["intent", "target", "desired", "preconditions", "expectedTransition", "authority", "policy"]);
const TARGET_KEYS = new Set(["spaceRef", "entityRef", "worldRef", "surfaceEpoch"]);
const AUTHORITY_KEYS = new Set(["actionCapabilityRef", "approvalGrantRef", "commitLeaseRef", "controlLeaseRef"]);
const POLICY_KEYS = new Set(["allowedActuatorKinds", "allowPreContactFallback"]);

export function createActuationIntent(input) {
  exact(input, INTENT_KEYS, "ActuationIntent");
  if (!INTENT_SET.has(input.intent)) fail(ACTUATION_ERROR_CODES.intentInvalid, "intent must be absolute and supported");
  exact(input.target, TARGET_KEYS, "ActuationIntent.target");
  for (const key of TARGET_KEYS) reference(input.target[key], `ActuationIntent.target.${key}`);
  validateDesired(input.intent, input.desired);
  if (!Array.isArray(input.preconditions) || !plainObject(input.expectedTransition)) {
    fail(ACTUATION_ERROR_CODES.intentInvalid, "preconditions must be an array and expectedTransition must be an object");
  }
  exact(input.authority, AUTHORITY_KEYS, "ActuationIntent.authority");
  reference(input.authority.actionCapabilityRef, "ActuationIntent.authority.actionCapabilityRef");
  for (const key of ["approvalGrantRef", "commitLeaseRef", "controlLeaseRef"]) {
    reference(input.authority[key], `ActuationIntent.authority.${key}`, { nullable: true });
  }
  exact(input.policy, POLICY_KEYS, "ActuationIntent.policy");
  if (!Array.isArray(input.policy.allowedActuatorKinds) || !input.policy.allowedActuatorKinds.length
    || new Set(input.policy.allowedActuatorKinds).size !== input.policy.allowedActuatorKinds.length
    || input.policy.allowedActuatorKinds.some((kind) => !ACTUATOR_SET.has(kind))
    || typeof input.policy.allowPreContactFallback !== "boolean") {
    fail(ACTUATION_ERROR_CODES.intentInvalid, "actuator policy is invalid");
  }
  finiteJson(input);
  noSensitiveOrHandleKeys(input);
  const body = clone({ protocol: "pyproc.actuationIntent", version: 1, ...input,
    policy: { ...input.policy, allowedActuatorKinds: sortedUnique(input.policy.allowedActuatorKinds) } });
  return Object.freeze({ ...body, intentSha256: actuationDigest(body) });
}

export function assertActuationIntent(value) {
  plain(value, "ActuationIntent");
  const { intentSha256, protocol, version, ...input } = value;
  if (protocol !== "pyproc.actuationIntent" || version !== 1) fail(ACTUATION_ERROR_CODES.intentInvalid, "intent protocol is invalid");
  const recreated = createActuationIntent(input);
  if (intentSha256 !== recreated.intentSha256) fail(ACTUATION_ERROR_CODES.intentInvalid, "intent digest changed");
  return value;
}

const BINDING_KEYS = new Set(["spaceRef", "worldRef", "entityRef", "surfaceEpoch", "actuatorKind",
  "invariants", "candidateCount", "uniqueness", "freshUntil", "providerFenceSha256"]);

export function createTargetBinding(input) {
  exact(input, BINDING_KEYS, "TargetBinding", ACTUATION_ERROR_CODES.targetStale);
  for (const key of ["spaceRef", "worldRef", "entityRef", "surfaceEpoch"]) {
    reference(input[key], `TargetBinding.${key}`, { code: ACTUATION_ERROR_CODES.targetStale });
  }
  if (!ACTUATOR_SET.has(input.actuatorKind) || !Array.isArray(input.invariants) || input.invariants.length < 2
    || !Number.isInteger(input.candidateCount) || input.candidateCount < 0 || input.uniqueness !== "unique"
    || input.candidateCount !== 1 || !Number.isFinite(input.freshUntil)) {
    fail(input.candidateCount > 1 ? ACTUATION_ERROR_CODES.targetAmbiguous : ACTUATION_ERROR_CODES.targetStale,
      "target binding must prove one fresh candidate");
  }
  digestValue(input.providerFenceSha256, "TargetBinding.providerFenceSha256", ACTUATION_ERROR_CODES.targetStale);
  finiteJson(input);
  noSensitiveOrHandleKeys(input);
  const body = clone({ protocol: "pyproc.targetBinding", version: 1, ...input });
  const bindingSha256 = actuationDigest(body);
  return Object.freeze({ bindingRef: `binding:${bindingSha256}`, ...body, bindingSha256 });
}

export function assertTargetBinding(value) {
  plain(value, "TargetBinding", ACTUATION_ERROR_CODES.targetStale);
  const { bindingRef, bindingSha256, protocol, version, ...input } = value;
  if (protocol !== "pyproc.targetBinding" || version !== 1) fail(ACTUATION_ERROR_CODES.targetStale, "binding protocol is invalid");
  const recreated = createTargetBinding(input);
  if (bindingRef !== recreated.bindingRef || bindingSha256 !== recreated.bindingSha256) {
    fail(ACTUATION_ERROR_CODES.targetStale, "binding digest changed");
  }
  return value;
}

export function createActuationPlan({ intent, binding, decision, preflight = {}, approach = [], boundary,
  gestureEnvelope = [], safetyRelease = [], verification = [], budgets = {} }) {
  assertActuationIntent(intent);
  assertTargetBinding(binding);
  if (!decision || decision.selected?.binding?.bindingSha256 !== binding.bindingSha256
    || decision.selected.kind !== binding.actuatorKind || !Number.isInteger(decision.ruleVersion)
    || typeof boundary !== "string" || !boundary) {
    fail(ACTUATION_ERROR_CODES.preflightFailed, "actuation plan inputs do not share one exact route");
  }
  const body = clone({ protocol: "pyproc.actuationPlan", version: 1,
    intentSha256: intent.intentSha256, bindingSha256: binding.bindingSha256,
    selectedActuator: decision.selected.kind, adapterVersion: decision.selected.adapterVersion,
    providerId: decision.selected.providerId, authorityRefs: intent.authority,
    decisionRuleVersion: decision.ruleVersion, preflightSha256: actuationDigest(preflight),
    approach, boundary, gestureEnvelope, safetyRelease, verification, budgets });
  finiteJson(body);
  noSensitiveOrHandleKeys(body);
  const planSha256 = actuationDigest(body);
  return Object.freeze({ planRef: `plan:${planSha256}`, ...body, planSha256 });
}

export function assertActuationPlan(value) {
  plain(value, "ActuationPlan", ACTUATION_ERROR_CODES.preflightFailed);
  const { planRef, planSha256, ...body } = value;
  if (body.protocol !== "pyproc.actuationPlan" || body.version !== 1
    || planRef !== `plan:${planSha256}` || planSha256 !== actuationDigest(body)) {
    fail(ACTUATION_ERROR_CODES.preflightFailed, "actuation plan digest changed");
  }
  return value;
}

function assertEffectWindow(value) {
  exact(value, new Set(["phase", "boundary", "crossed", "providerCalls", "completedSegments", "safetyRelease"]),
    "ActuationReceipt.effectWindow", ACTUATION_ERROR_CODES.receiptInvalid);
  if (value.phase !== "postContact" || typeof value.boundary !== "string" || typeof value.crossed !== "boolean"
    || !Number.isInteger(value.providerCalls) || value.providerCalls < 0 || !Array.isArray(value.completedSegments)
    || !plainObject(value.safetyRelease) || typeof value.safetyRelease.sent !== "boolean") {
    fail(ACTUATION_ERROR_CODES.receiptInvalid, "effect window is invalid");
  }
}

export function createActuationReceipt({ intent, binding, plan, decision, effectWindow, terminal,
  effectOutcome, actionEvidenceRef = null, effectReceiptRef = null, replayEdgeRef = null,
  cleanup = { state: "complete", failures: [] }, actuationRef = `actuation:${randomBytes(16).toString("hex")}` }) {
  assertActuationIntent(intent);
  assertTargetBinding(binding);
  if (!TERMINAL_SET.has(terminal) || !["applied", "notSent", "rejected", "outcomeUnknown"].includes(effectOutcome)
    || plan.intentSha256 !== intent.intentSha256 || plan.bindingSha256 !== binding.bindingSha256
    || decision.selected.kind !== plan.selectedActuator) {
    fail(ACTUATION_ERROR_CODES.receiptInvalid, "receipt lineage or terminal is invalid");
  }
  assertEffectWindow(effectWindow);
  if (terminal === "alreadySatisfied" && (effectWindow.crossed || effectWindow.providerCalls !== 0)) {
    fail(ACTUATION_ERROR_CODES.receiptInvalid, "alreadySatisfied cannot cross the effect boundary");
  }
  if (terminal === "confirmed" && !actionEvidenceRef && !effectReceiptRef && !replayEdgeRef) {
    fail(ACTUATION_ERROR_CODES.receiptInvalid, "confirmed receipt requires verified evidence");
  }
  if (effectOutcome === "outcomeUnknown" && terminal !== "outcomeUnknown") {
    fail(ACTUATION_ERROR_CODES.receiptInvalid, "unknown effect outcome requires an unknown terminal");
  }
  if (!plainObject(cleanup) || !["complete", "incomplete"].includes(cleanup.state)
    || !Array.isArray(cleanup.failures) || cleanup.failures.some((entry) => typeof entry !== "string")) {
    fail(ACTUATION_ERROR_CODES.receiptInvalid, "cleanup summary is invalid");
  }
  reference(actuationRef, "ActuationReceipt.actuationRef", { code: ACTUATION_ERROR_CODES.receiptInvalid });
  for (const [value, label] of [[actionEvidenceRef, "actionEvidenceRef"], [effectReceiptRef, "effectReceiptRef"],
    [replayEdgeRef, "replayEdgeRef"]]) if (value !== null) reference(value, label,
    { code: ACTUATION_ERROR_CODES.receiptInvalid });
  const body = clone({ protocol: ACTUATION_PROTOCOL, version: ACTUATION_VERSION, actuationRef,
    intentSha256: intent.intentSha256, bindingSha256: binding.bindingSha256, planSha256: plan.planSha256,
    authorityRefs: intent.authority, decision: { ruleVersion: decision.ruleVersion,
      selectedActuator: decision.selected.kind, providerId: decision.selected.providerId,
      ordered: decision.ordered, excluded: decision.excluded }, effectWindow, effectOutcome, terminal,
    actionEvidenceRef, effectReceiptRef, replayEdgeRef, cleanup });
  finiteJson(body);
  noSensitiveOrHandleKeys(body);
  return Object.freeze({ ...body, receiptSha256: actuationDigest(body) });
}

export function assertActuationReceipt(value) {
  plain(value, "ActuationReceipt", ACTUATION_ERROR_CODES.receiptInvalid);
  const { receiptSha256, ...body } = value;
  if (body.protocol !== ACTUATION_PROTOCOL || body.version !== ACTUATION_VERSION
    || receiptSha256 !== actuationDigest(body)) fail(ACTUATION_ERROR_CODES.receiptInvalid, "receipt digest changed");
  assertEffectWindow(body.effectWindow);
  noSensitiveOrHandleKeys(body);
  return value;
}

export function createActuationEpisode({ receipt, worldRef, policyRevisionSha256, provider, timeline,
  failurePoint = null, robustnessSignals = [], evidenceRefs = [], redactionManifestSha256,
  experienceState = "complete" }) {
  assertActuationReceipt(receipt);
  reference(worldRef, "ActuationEpisode.worldRef", { code: ACTUATION_ERROR_CODES.episodeInvalid });
  digestValue(policyRevisionSha256, "ActuationEpisode.policyRevisionSha256", ACTUATION_ERROR_CODES.episodeInvalid);
  digestValue(redactionManifestSha256, "ActuationEpisode.redactionManifestSha256", ACTUATION_ERROR_CODES.episodeInvalid);
  if (!plainObject(provider) || !Array.isArray(timeline) || !timeline.length || !Array.isArray(robustnessSignals)
    || !Array.isArray(evidenceRefs) || !["complete", "incomplete"].includes(experienceState)
    || robustnessSignals.some((signal) => signal.positive === true
      && (receipt.terminal !== "confirmed" || !REF_RE.test(String(signal.deterministicEvidenceRef || ""))))) {
    fail(ACTUATION_ERROR_CODES.episodeInvalid, "episode or positive signal is invalid");
  }
  const body = clone({ protocol: "pyproc.actuationEpisode", version: 1,
    intentSha256: receipt.intentSha256, worldRef, bindingSha256: receipt.bindingSha256,
    planSha256: receipt.planSha256, policyRevisionSha256, provider, timeline, failurePoint,
    robustnessSignals, evidenceRefs: sortedUnique(evidenceRefs), receiptSha256: receipt.receiptSha256,
    redactionManifestSha256, experienceState });
  finiteJson(body);
  noSensitiveOrHandleKeys(body);
  const episodeSha256 = actuationDigest(body);
  return Object.freeze({ episodeRef: `episode:${episodeSha256}`, ...body, episodeSha256 });
}

export function assertActuationEpisode(value) {
  plain(value, "ActuationEpisode", ACTUATION_ERROR_CODES.episodeInvalid);
  const { episodeRef, episodeSha256, ...body } = value;
  if (body.protocol !== "pyproc.actuationEpisode" || body.version !== 1
    || episodeRef !== `episode:${episodeSha256}` || episodeSha256 !== actuationDigest(body)) {
    fail(ACTUATION_ERROR_CODES.episodeInvalid, "actuation episode digest changed");
  }
  noSensitiveOrHandleKeys(body);
  return value;
}

export function createPolicyRevision({ previousSha256 = null, policy = {}, proposalSha256 = null,
  evaluationSha256 = null, state = "active" }) {
  for (const [value, label] of [[previousSha256, "previousSha256"], [proposalSha256, "proposalSha256"],
    [evaluationSha256, "evaluationSha256"]]) if (value !== null) digestValue(value, label,
    ACTUATION_ERROR_CODES.policyRejected);
  if (!["active", "candidate", "rejected", "rolledBack"].includes(state) || !plainObject(policy)) {
    fail(ACTUATION_ERROR_CODES.policyRejected, "policy revision input is invalid");
  }
  const serialized = canonicalActuationJson(policy).toLowerCase();
  if (/authority|uniqueness|effectboundary|nonretry|userprecedence|redaction|allowedorigin/.test(serialized)) {
    fail(ACTUATION_ERROR_CODES.policyRejected, "policy cannot change the safety constitution");
  }
  const body = clone({ protocol: "pyproc.actuationPolicy", version: 1, previousSha256,
    policy, proposalSha256, evaluationSha256, state });
  return Object.freeze({ ...body, policySha256: actuationDigest(body) });
}

export function assertPolicyRevision(value) {
  plain(value, "ActuationPolicy", ACTUATION_ERROR_CODES.policyRejected);
  const { policySha256, ...body } = value;
  if (body.protocol !== "pyproc.actuationPolicy" || body.version !== 1
    || policySha256 !== actuationDigest(body)) {
    fail(ACTUATION_ERROR_CODES.policyRejected, "policy revision digest changed");
  }
  return value;
}

export function evaluateCorrection({ basePolicySha256, corpusSha256, evaluationManifestSha256, proposal }) {
  for (const [value, label] of [[basePolicySha256, "basePolicySha256"], [corpusSha256, "corpusSha256"],
    [evaluationManifestSha256, "evaluationManifestSha256"]]) digestValue(value, label,
    ACTUATION_ERROR_CODES.policyRejected);
  exact(proposal, new Set(["changeKind", "patch", "protectedInvariants", "coverage"]),
    "CorrectionProposal", ACTUATION_ERROR_CODES.policyRejected);
  if (!["probeOrder", "approach", "gestureSegmentation", "actuatorTieBreak", "budgetAllocation"].includes(proposal.changeKind)
    || !plainObject(proposal.patch) || !Array.isArray(proposal.protectedInvariants) || !plainObject(proposal.coverage)) {
    fail(ACTUATION_ERROR_CODES.policyRejected, "correction proposal is invalid");
  }
  const patchText = canonicalActuationJson(proposal.patch).toLowerCase();
  if (/authority|uniqueness|effectboundary|nonretry|userprecedence|redaction|allowedorigin/.test(patchText)
    || proposal.coverage.gaps !== 0 || proposal.coverage.negativeFailed !== 0
    || proposal.coverage.replayFailed !== 0) {
    fail(ACTUATION_ERROR_CODES.policyRejected, "proposal weakens constitution or lacks effect-free coverage");
  }
  const body = clone({ basePolicySha256, corpusSha256, evaluationManifestSha256,
    proposalSha256: actuationDigest(proposal), verdict: "promotable" });
  const verdictSha256 = actuationDigest(body);
  return Object.freeze({ ...body, verdictSha256,
    policyRevisionSha256: actuationDigest({ previousSha256: basePolicySha256,
      proposalSha256: body.proposalSha256, verdictSha256 }) });
}
