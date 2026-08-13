// Initiative 8 M0 prototype. Pure canonical actuation contract with no provider dependency.
import { createHash, randomBytes } from "node:crypto";

const INTENTS = new Set(["activate", "focus", "setValue", "setSelected", "setExpanded", "scrollTo", "dragTo"]);
const ACTUATORS = new Set(["cooperative", "browserInput", "accessibility", "osInput", "replay"]);
const TERMINALS = new Set(["confirmed", "contradicted", "ambiguous", "notObserved", "outcomeUnknown",
  "alreadySatisfied", "notSent", "rejected"]);
const DIGEST_RE = /^[0-9a-f]{64}$/;
const REF_RE = /^[a-z][a-z0-9.]*:[A-Za-z0-9._:-]{1,160}$/;
const SECRET_KEYS = /password|secret|token|cookie|authorization|card|credential|clipboard/i;
const HANDLE_KEYS = /^(?:.*(?:handle|pointer|nodeid|objectid|runtimeid|backendnode|coordinate)|x|y)$/i;

function fail(code, message, details = null, outcome = "notSent") {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  if (details) error.details = details;
  throw error;
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("ACTUATION_INTENT_INVALID", `${label} must be a plain object`);
  }
  return value;
}

function exact(value, keys, label, code = "ACTUATION_INTENT_INVALID") {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(code, `${label}.${key} is unknown`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(code, `${label}.${key} is required`);
}

function ref(value, label, nullable = false) {
  if (nullable && value === null) return value;
  if (!REF_RE.test(String(value || ""))) fail("ACTUATION_INTENT_INVALID", `${label} is invalid`);
  return value;
}

function scan(value, { forbidSecrets = true, forbidHandles = true } = {}, path = "value", depth = 0) {
  if (depth > 32) fail("ACTUATION_INTENT_INVALID", `${path} exceeds depth`);
  if (value === null || typeof value === "boolean" || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    if (value.length > 1000) fail("ACTUATION_INTENT_INVALID", `${path} exceeds item limit`);
    value.forEach((child, index) => scan(child, { forbidSecrets, forbidHandles }, `${path}[${index}]`, depth + 1));
    return;
  }
  plain(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (forbidSecrets && SECRET_KEYS.test(key)) fail("ACTUATION_INTENT_INVALID", `${path}.${key} is sensitive`);
    if (forbidHandles && HANDLE_KEYS.test(key)) fail("ACTUATION_INTENT_INVALID", `${path}.${key} is provider-local`);
    scan(child, { forbidSecrets, forbidHandles }, `${path}.${key}`, depth + 1);
  }
}

export function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  plain(value, "canonical value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function digest(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
const freeze = (value) => Object.freeze(structuredClone(value));

function validateDesired(intent, desired) {
  plain(desired, "desired");
  const keys = Object.keys(desired);
  if (intent === "activate") exact(desired, new Set(["activated"]), "desired");
  if (intent === "focus") exact(desired, new Set(["focused"]), "desired");
  if (intent === "setValue") {
    if (keys.length !== 1 || !["value", "valueRef"].includes(keys[0])) fail("ACTUATION_INTENT_INVALID",
      "setValue requires exactly one value or valueRef");
    if (keys[0] === "value" && !(typeof desired.value === "string" || (typeof desired.value === "number"
      && Number.isFinite(desired.value)))) fail("ACTUATION_INTENT_INVALID", "setValue value is invalid");
    if (keys[0] === "valueRef") ref(desired.valueRef, "desired.valueRef");
  }
  if (intent === "setSelected") {
    exact(desired, new Set(["selected"]), "desired");
    if (!(typeof desired.selected === "boolean" || (Array.isArray(desired.selected)
      && desired.selected.every((item) => typeof item === "string")))) {
      fail("ACTUATION_INTENT_INVALID", "selected state is invalid");
    }
  }
  if (intent === "setExpanded") {
    exact(desired, new Set(["expanded"]), "desired");
    if (typeof desired.expanded !== "boolean") fail("ACTUATION_INTENT_INVALID", "expanded state is invalid");
  }
  if (intent === "scrollTo") {
    exact(desired, new Set(["visibility"]), "desired");
    if (!["full", "nearest", "start", "center", "end"].includes(desired.visibility)) {
      fail("ACTUATION_INTENT_INVALID", "visibility is invalid");
    }
  }
  if (intent === "dragTo") {
    if (keys.length !== 1 || !["targetEntityRef", "semanticValue"].includes(keys[0])) {
      fail("ACTUATION_INTENT_INVALID", "dragTo requires one semantic destination");
    }
    if (keys[0] === "targetEntityRef") ref(desired.targetEntityRef, "desired.targetEntityRef");
    if (keys[0] === "semanticValue" && !(typeof desired.semanticValue === "string"
      || (typeof desired.semanticValue === "number" && Number.isFinite(desired.semanticValue)))) {
      fail("ACTUATION_INTENT_INVALID", "drag semantic value is invalid");
    }
  }
  if ((intent === "activate" && desired.activated !== true) || (intent === "focus" && desired.focused !== true)) {
    fail("ACTUATION_INTENT_INVALID", `${intent} desired state must be true`);
  }
}

export function createIntent(input) {
  exact(input, new Set(["intent", "target", "desired", "preconditions", "expectedTransition", "authority", "policy"]),
    "ActuationIntent");
  if (!INTENTS.has(input.intent)) fail("ACTUATION_INTENT_INVALID", "intent must be absolute and supported");
  exact(input.target, new Set(["spaceRef", "entityRef", "worldRef", "surfaceEpoch"]), "target");
  for (const key of ["spaceRef", "entityRef", "worldRef", "surfaceEpoch"]) ref(input.target[key], `target.${key}`);
  validateDesired(input.intent, input.desired);
  if (!Array.isArray(input.preconditions) || !Array.isArray(input.expectedTransition)) {
    fail("ACTUATION_INTENT_INVALID", "preconditions and expectedTransition must be arrays");
  }
  exact(input.authority, new Set(["actionCapabilityRef", "approvalGrantRef", "commitLeaseRef", "controlLeaseRef"]),
    "authority");
  ref(input.authority.actionCapabilityRef, "authority.actionCapabilityRef");
  for (const key of ["approvalGrantRef", "commitLeaseRef", "controlLeaseRef"]) ref(input.authority[key], `authority.${key}`, true);
  exact(input.policy, new Set(["allowedActuatorKinds", "allowPreContactFallback"]), "policy");
  if (!Array.isArray(input.policy.allowedActuatorKinds) || !input.policy.allowedActuatorKinds.length
    || new Set(input.policy.allowedActuatorKinds).size !== input.policy.allowedActuatorKinds.length
    || input.policy.allowedActuatorKinds.some((kind) => !ACTUATORS.has(kind))
    || typeof input.policy.allowPreContactFallback !== "boolean") {
    fail("ACTUATION_INTENT_INVALID", "actuator policy is invalid");
  }
  scan(input);
  const body = freeze({ protocol: "pyproc.actuationIntent", version: 1, ...input,
    policy: { ...input.policy, allowedActuatorKinds: [...input.policy.allowedActuatorKinds].sort() } });
  return Object.freeze({ ...body, intentSha256: digest(body) });
}

export function createBinding(input) {
  exact(input, new Set(["spaceRef", "worldRef", "entityRef", "surfaceEpoch", "actuatorKind", "invariants",
    "candidateCount", "uniqueness", "freshUntil", "providerFenceSha256"]), "TargetBinding", "ACTUATION_TARGET_STALE");
  for (const key of ["spaceRef", "worldRef", "entityRef", "surfaceEpoch"]) ref(input[key], key);
  if (!ACTUATORS.has(input.actuatorKind) || !Array.isArray(input.invariants) || input.invariants.length < 2
    || !Number.isInteger(input.candidateCount) || input.candidateCount < 0 || input.uniqueness !== "unique"
    || input.candidateCount !== 1 || !Number.isFinite(input.freshUntil)
    || !DIGEST_RE.test(String(input.providerFenceSha256 || ""))) {
    fail(input.candidateCount > 1 ? "ACTUATION_TARGET_AMBIGUOUS" : "ACTUATION_TARGET_STALE",
      "binding must prove one fresh target");
  }
  scan(input);
  const body = freeze({ protocol: "pyproc.targetBinding", version: 1, ...input });
  return Object.freeze({ bindingRef: `binding:${digest(body)}`, ...body, bindingSha256: digest(body) });
}

export function chooseActuator(intent, candidates, preference = []) {
  const permitted = new Set(intent.policy.allowedActuatorKinds);
  const rank = new Map(preference.map((kind, index) => [kind, index]));
  const inspected = candidates.map((candidate) => {
    const reasons = [];
    if (!ACTUATORS.has(candidate.kind) || !permitted.has(candidate.kind)) reasons.push("kindNotAllowed");
    if (!candidate.supportedIntents?.includes(intent.intent)) reasons.push("intentUnsupported");
    if (candidate.binding?.uniqueness !== "unique" || candidate.binding?.candidateCount !== 1) reasons.push("targetNotUnique");
    if (candidate.binding?.worldRef !== intent.target.worldRef
      || candidate.binding?.surfaceEpoch !== intent.target.surfaceEpoch
      || candidate.binding?.entityRef !== intent.target.entityRef) reasons.push("bindingMismatch");
    if (candidate.binding?.freshUntil < candidate.now) reasons.push("bindingExpired");
    if (candidate.healthy !== true) reasons.push("providerUnhealthy");
    if (candidate.authoritySatisfied !== true) reasons.push("authorityMissing");
    if (candidate.evidenceAvailable !== true) reasons.push("evidenceUnavailable");
    if (candidate.effectWindowRepresentable !== true) reasons.push("windowUnavailable");
    return freeze({ ...candidate, eligible: reasons.length === 0, exclusionReasons: reasons });
  });
  const ordered = inspected.filter((candidate) => candidate.eligible).sort((left, right) => {
    const leftTuple = [left.semanticSetter ? 0 : 1, left.additionalAuthority ? 1 : 0,
      left.postconditionEvidence ? 0 : 1, left.sharedInput ? 1 : 0, rank.get(left.kind) ?? 999, left.providerId];
    const rightTuple = [right.semanticSetter ? 0 : 1, right.additionalAuthority ? 1 : 0,
      right.postconditionEvidence ? 0 : 1, right.sharedInput ? 1 : 0, rank.get(right.kind) ?? 999, right.providerId];
    return canonical(leftTuple).localeCompare(canonical(rightTuple), "en");
  });
  if (!ordered.length) fail("ACTUATION_ACTUATOR_UNAVAILABLE", "no actuator passed hard eligibility", {
    excluded: inspected.map(({ kind, providerId, exclusionReasons }) => ({ kind, providerId, exclusionReasons })) });
  return freeze({ ruleVersion: 1, selected: ordered[0], ordered: ordered.map(({ kind, providerId }) => ({ kind, providerId })),
    excluded: inspected.filter((candidate) => !candidate.eligible)
      .map(({ kind, providerId, exclusionReasons }) => ({ kind, providerId, exclusionReasons })) });
}

export class EffectWindow {
  constructor() { this.phase = "preContact"; this.segments = []; this.providerCalls = 0; this.safetyRelease = null; }
  approach(segment) {
    if (this.phase !== "preContact") fail("ACTUATION_GESTURE_ABORTED", "approach after effect boundary", null, "outcomeUnknown");
    this.segments.push(freeze({ phase: "preContact", segment }));
  }
  cross(boundary) {
    if (this.phase !== "preContact") fail("ACTUATION_GESTURE_ABORTED", "effect boundary crossed twice", null, "outcomeUnknown");
    this.phase = "committedGesture";
    this.boundary = boundary;
  }
  sent(segment) {
    if (this.phase !== "committedGesture") fail("ACTUATION_GESTURE_ABORTED", "provider effect outside committed gesture",
      null, this.phase === "preContact" ? "notSent" : "outcomeUnknown");
    this.providerCalls += 1;
    this.segments.push(freeze({ phase: "committedGesture", segment }));
  }
  release(segment) {
    if (this.phase !== "committedGesture" || this.safetyRelease) return false;
    this.safetyRelease = freeze({ sent: true, segment });
    this.segments.push(freeze({ phase: "committedGesture", segment, safetyRelease: true }));
    return true;
  }
  close() { this.phase = "postContact"; return this.inspect(); }
  inspect() { return freeze({ phase: this.phase, boundary: this.boundary || null, crossed: Boolean(this.boundary),
    providerCalls: this.providerCalls, completedSegments: this.segments, safetyRelease: this.safetyRelease || { sent: false } }); }
}

export class ControlLease {
  constructor(scope, { now = () => Date.now(), idFactory = () => randomBytes(16).toString("hex") } = {}) {
    exact(scope, new Set(["spaceRef", "applicationRef", "processRef", "windowRef", "surfaceEpoch", "intentSha256",
      "devices", "foregroundRequired", "expiresAt", "cancelOnUserInput", "sessionRevisionSha256"]), "ControlLease");
    for (const key of ["spaceRef", "applicationRef", "processRef", "windowRef", "surfaceEpoch"]) ref(scope[key], key);
    if (!DIGEST_RE.test(scope.intentSha256) || !DIGEST_RE.test(scope.sessionRevisionSha256)
      || !Array.isArray(scope.devices) || !scope.devices.length || !Number.isFinite(scope.expiresAt)
      || typeof scope.foregroundRequired !== "boolean" || scope.cancelOnUserInput !== true) {
      fail("ACTUATION_AUTHORITY_REQUIRED", "ControlLease scope is invalid");
    }
    this.scope = freeze(scope);
    this.now = now;
    this.leaseRef = `controlLease:${idFactory()}`;
    this.state = "requested";
    this.reason = null;
  }
  activate(live) {
    if (this.state !== "requested" || this.now() >= this.scope.expiresAt
      || (this.scope.foregroundRequired && live.windowRef !== this.scope.windowRef)
      || live.surfaceEpoch !== this.scope.surfaceEpoch) fail("ACTUATION_CONTROL_REVOKED", "ControlLease preflight failed");
    this.state = "active";
    return this.inspect();
  }
  assert(segmentScope) {
    if (this.now() >= this.scope.expiresAt) { this.state = "expired"; this.reason = "expired"; }
    if (this.state !== "active" || segmentScope.windowRef !== this.scope.windowRef
      || segmentScope.surfaceEpoch !== this.scope.surfaceEpoch) {
      fail("ACTUATION_CONTROL_REVOKED", "ControlLease is not active for the segment");
    }
  }
  userInput() { if (this.scope.cancelOnUserInput) { this.state = "revoked"; this.reason = "physicalUserInput"; } return this.inspect(); }
  inspect() { return freeze({ leaseRef: this.leaseRef, state: this.state, reason: this.reason, scope: this.scope }); }
}

export function createPlan(intent, binding, decision, input = {}) {
  if (intent.intentSha256 !== input.intentSha256 || binding.bindingSha256 !== input.bindingSha256
    || decision.selected.binding.bindingSha256 !== binding.bindingSha256) {
    fail("ACTUATION_PREFLIGHT_FAILED", "plan inputs do not share one exact intent and binding");
  }
  const body = freeze({ protocol: "pyproc.actuationPlan", version: 1, intentSha256: intent.intentSha256,
    bindingSha256: binding.bindingSha256, selectedActuator: decision.selected.kind,
    adapterVersion: decision.selected.adapterVersion, providerId: decision.selected.providerId,
    authority: intent.authority, decisionRuleVersion: decision.ruleVersion,
    preflightSha256: digest(input.preflight || {}), approach: input.approach || [], boundary: input.boundary,
    gestureEnvelope: input.gestureEnvelope || [], safetyRelease: input.safetyRelease || [],
    verification: input.verification || intent.expectedTransition, budgets: input.budgets || {} });
  scan(body);
  return Object.freeze({ planRef: `plan:${digest(body)}`, ...body, planSha256: digest(body) });
}

export function createReceipt({ intent, binding, plan, decision, effectWindow, terminal, actionEvidenceRef = null,
  effectReceiptRef = null, replayEdgeRef = null, cleanup = { state: "complete", failures: [] } }) {
  if (!TERMINALS.has(terminal) || plan.intentSha256 !== intent.intentSha256
    || plan.bindingSha256 !== binding.bindingSha256 || effectWindow.phase !== "postContact"
    || (terminal === "alreadySatisfied" && effectWindow.crossed)
    || (terminal === "confirmed" && !actionEvidenceRef && !replayEdgeRef)
    || cleanup.failures?.some((entry) => typeof entry !== "string")) {
    fail("ACTUATION_OUTCOME_UNKNOWN", "receipt lineage or terminal is invalid", null, "outcomeUnknown");
  }
  const body = freeze({ protocol: "pyproc.actuation", version: 1,
    actuationRef: `actuation:${randomBytes(16).toString("hex")}`, intentSha256: intent.intentSha256,
    bindingSha256: binding.bindingSha256, planSha256: plan.planSha256, authorityRefs: intent.authority,
    decision: { ruleVersion: decision.ruleVersion, selectedActuator: decision.selected.kind,
      providerId: decision.selected.providerId, ordered: decision.ordered, excluded: decision.excluded },
    effectWindow, terminal, actionEvidenceRef, effectReceiptRef, replayEdgeRef,
    cleanup: { state: cleanup.state, failures: [...cleanup.failures] } });
  scan(body);
  return Object.freeze({ ...body, receiptSha256: digest(body) });
}

export function createEpisode({ receipt, policyRevisionSha256, provider, timeline, failurePoint = null,
  robustnessSignals = [], evidenceRefs = [], redactionManifestSha256 }) {
  if (!DIGEST_RE.test(policyRevisionSha256) || !DIGEST_RE.test(redactionManifestSha256)
    || !Array.isArray(timeline) || !Array.isArray(robustnessSignals) || !Array.isArray(evidenceRefs)
    || robustnessSignals.some((signal) => signal.positive === true
      && (receipt.terminal !== "confirmed" || !signal.deterministicEvidenceRef))) {
    fail("ACTUATION_POLICY_REJECTED", "episode or positive signal is invalid");
  }
  const body = freeze({ protocol: "pyproc.actuationEpisode", version: 1,
    intentSha256: receipt.intentSha256, worldRef: timeline[0]?.worldRef || null,
    bindingSha256: receipt.bindingSha256, planSha256: receipt.planSha256, policyRevisionSha256,
    provider, timeline, failurePoint, robustnessSignals, evidenceRefs,
    receiptSha256: receipt.receiptSha256, redactionManifestSha256 });
  scan(body);
  return Object.freeze({ episodeRef: `episode:${digest(body)}`, ...body, episodeSha256: digest(body) });
}

export function evaluateCorrection({ basePolicySha256, corpusSha256, evaluationManifestSha256, proposal }) {
  for (const value of [basePolicySha256, corpusSha256, evaluationManifestSha256]) {
    if (!DIGEST_RE.test(value)) fail("ACTUATION_POLICY_REJECTED", "policy evaluation digest is invalid");
  }
  exact(proposal, new Set(["changeKind", "patch", "protectedInvariants", "coverage"]), "CorrectionProposal",
    "ACTUATION_POLICY_REJECTED");
  if (!new Set(["probeOrder", "approach", "gestureSegmentation", "actuatorTieBreak", "budgetAllocation"])
    .has(proposal.changeKind)) fail("ACTUATION_POLICY_REJECTED", "constitution changes cannot be proposed");
  const patchText = canonical(proposal.patch).toLowerCase();
  if (/authority|uniqueness|effectboundary|nonretry|userprecedence|redaction|allowedorigin/.test(patchText)
    || proposal.coverage.gaps > 0 || proposal.coverage.negativeFailed > 0 || proposal.coverage.replayFailed > 0) {
    fail("ACTUATION_POLICY_REJECTED", "proposal weakens constitution or lacks effect-free coverage");
  }
  const body = { basePolicySha256, corpusSha256, evaluationManifestSha256,
    proposalSha256: digest(proposal), verdict: "promotable" };
  return freeze({ ...body, verdictSha256: digest(body), policyRevisionSha256: digest({ previous: basePolicySha256,
    proposalSha256: body.proposalSha256, verdictSha256: digest(body) }) });
}
