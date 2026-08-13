// situationCatalog.js - APX situation 1.0 focus, capsule, actionContext의 strict wire 정본.
import { apxDigest } from "./apxCanonical.js";

export const APX_SITUATION_REPRESENTATION = "apx.situation";
export const APX_SITUATION_PROFILE = "apx-situation/1";
export const APX_REQUIREMENT_STATES = Object.freeze(["satisfied", "conflicted", "unknown", "stale"]);
export const APX_CLAIM_STATES = Object.freeze(["known", "conflicted", "unknown", "stale"]);
export const APX_AFFORDANCE_KINDS = Object.freeze(["observed", "derived", "reported", "authorized"]);

const FOCUS_KEYS = new Set(["objective", "requirements", "changedSince", "freshness"]);
const REQUIREMENT_KEYS = new Set(["requirementRef", "select", "need", "cardinality"]);
const SELECT_KEYS = new Set(["entityRef", "kind", "role", "name", "state", "actionable"]);
const CAPSULE_KEYS = new Set(["protocol", "version", "representation", "profile", "situationRef", "worldRef",
  "observationRef", "documentEpoch", "capturedAt", "focus", "requirements", "facts", "affordances", "changes",
  "unknowns", "suggestedProbes", "visualProbes", "completeness", "budget", "integrity"]);
const ACTION_CONTEXT_KEYS = new Set(["intent", "situationRef", "worldRef", "capabilityRef", "expectedTransition"]);
const NEEDS = new Set(["fact", "affordance", "change"]);
const CARDINALITIES = new Set(["one", "oneOrMore", "zeroOrMore"]);
const REF_PATTERNS = Object.freeze({
  situation: /^situation:[a-f0-9]{64}$/,
  world: /^world:[a-f0-9]{64}$/,
  observation: /^observation:[A-Za-z0-9_-]{1,128}$/,
  requirement: /^requirement:[A-Za-z0-9._:-]{1,128}$/,
  entity: /^entity:[A-Za-z0-9_-]{1,128}$/,
  claim: /^claim:[a-f0-9]{64}$/,
  capability: /^capability:[a-f0-9]{64}$/,
  unknown: /^unknown:[A-Za-z0-9._:-]{1,128}$/,
});
const DIGEST = /^[a-f0-9]{64}$/;
const LOCATOR = /^locator:[A-Za-z0-9._:-]{1,256}$/;
const FORBIDDEN_DRIVER_KEYS = new Set(["nativeRef", "locatorData", "frameNativeRef", "fromNativeRef",
  "toNativeRef", "backendNodeId", "backendDOMNodeId", "nodeId", "objectId", "executionContextId"]);

function fail(message, code = "APX_SCHEMA_INVALID") {
  const error = new TypeError(message);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  throw error;
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} does not accept ${key}`);
}

function validateName(value, label) {
  if (typeof value === "string") {
    if (value.length > 300) fail(`${label} is too long`);
    return;
  }
  plain(value, label);
  const allowed = new Set(["exact", "prefix", "contains", "token", "regex"]);
  exactKeys(value, allowed, label);
  if (Object.keys(value).length !== 1) fail(`${label} requires exactly one matcher`);
  const [kind] = Object.keys(value);
  const maximum = ["token", "regex"].includes(kind) ? 100 : 300;
  if (typeof value[kind] !== "string" || value[kind].length > maximum) fail(`${label}.${kind} is invalid`);
  if (kind === "regex") {
    if (/\\[1-9]|\(\?|\([^)]*[+*{][^)]*\)[+*{]|[+*?}][+*?{]/u.test(value.regex)) {
      fail(`${label}.regex uses an unsafe construct`);
    }
    try { new RegExp(value.regex, "u"); } catch (error) { fail(`${label}.regex is invalid`); }
  }
}

function validateSelect(value, label) {
  plain(value, label);
  exactKeys(value, SELECT_KEYS, label);
  if (Object.keys(value).length === 0) fail(`${label} requires a selector`);
  if (value.entityRef !== undefined && !REF_PATTERNS.entity.test(value.entityRef)) fail(`${label}.entityRef is invalid`);
  for (const key of ["kind", "role"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key] || value[key].length > 80)) {
      fail(`${label}.${key} is invalid`);
    }
  }
  if (value.name !== undefined) validateName(value.name, `${label}.name`);
  if (value.state !== undefined) {
    plain(value.state, `${label}.state`);
    if (Object.keys(value.state).length > 16) fail(`${label}.state has too many entries`);
  }
  if (value.actionable !== undefined && typeof value.actionable !== "boolean") fail(`${label}.actionable is invalid`);
}

export function validateSituationFocus(value) {
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
    const label = `focus.requirements[${index}]`;
    plain(entry, label);
    exactKeys(entry, REQUIREMENT_KEYS, label);
    if (!REF_PATTERNS.requirement.test(String(entry.requirementRef || "")) || refs.has(entry.requirementRef)) {
      fail(`${label}.requirementRef is invalid or duplicated`);
    }
    refs.add(entry.requirementRef);
    validateSelect(entry.select, `${label}.select`);
    if (!Array.isArray(entry.need) || entry.need.length < 1 || entry.need.length > 3
      || entry.need.some((need) => !NEEDS.has(need)) || new Set(entry.need).size !== entry.need.length) {
      fail(`${label}.need is invalid`);
    }
    const cardinality = entry.cardinality || "one";
    if (!CARDINALITIES.has(cardinality)) fail(`${label}.cardinality is invalid`);
    return Object.freeze({ requirementRef: entry.requirementRef, select: Object.freeze({ ...entry.select }),
      need: Object.freeze([...entry.need]), cardinality });
  });
  if (focus.changedSince !== undefined && !REF_PATTERNS.situation.test(focus.changedSince)) {
    fail("focus.changedSince is invalid");
  }
  let freshness = Object.freeze({ mode: "live", maxAgeMs: 1000 });
  if (focus.freshness !== undefined) {
    plain(focus.freshness, "focus.freshness");
    exactKeys(focus.freshness, new Set(["mode", "maxAgeMs"]), "focus.freshness");
    if (!["live", "recorded"].includes(focus.freshness.mode)
      || !Number.isInteger(focus.freshness.maxAgeMs) || focus.freshness.maxAgeMs < 0
      || focus.freshness.maxAgeMs > 300000) fail("focus.freshness is invalid");
    freshness = Object.freeze({ mode: focus.freshness.mode, maxAgeMs: focus.freshness.maxAgeMs });
  }
  return Object.freeze({ ...(focus.objective === undefined ? {} : { objective: focus.objective }),
    requirements: Object.freeze(requirements), ...(focus.changedSince ? { changedSince: focus.changedSince } : {}),
    freshness });
}

export function validateActionContext(value) {
  const context = plain(value, "actionContext");
  exactKeys(context, ACTION_CONTEXT_KEYS, "actionContext");
  for (const key of ["situationRef", "worldRef", "capabilityRef"]) {
    if (!REF_PATTERNS[key.replace("Ref", "")].test(String(context[key] || ""))) fail(`actionContext.${key} is invalid`);
  }
  if (context.intent !== undefined && (typeof context.intent !== "string" || context.intent.length > 1000)) {
    fail("actionContext.intent is invalid");
  }
  if (context.expectedTransition !== undefined) plain(context.expectedTransition, "actionContext.expectedTransition");
  if (JSON.stringify(context).length > 16384) fail("actionContext exceeds its byte limit");
  scanPublicBoundary(context);
  return Object.freeze({ ...context });
}

function scanPublicBoundary(value) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_DRIVER_KEYS.has(key)) fail(`APX situation exposes driver field ${key}`);
      stack.push(child);
    }
  }
}

function assertProvenance(value, label) {
  plain(value, label);
  exactKeys(value, new Set(["mode", "source", "trust"]), label);
  if (!["observed", "derived", "reported", "inferred"].includes(value.mode)
    || typeof value.source !== "string" || !value.source
    || !["broker", "browser", "page", "model", "external"].includes(value.trust)) fail(`${label} is invalid`);
}

function assertCanonicalOrder(values, refOf, label) {
  const refs = values.map(refOf);
  if (new Set(refs).size !== refs.length || refs.some((ref, index) => index > 0 && refs[index - 1] > ref)) {
    fail(`${label} is not unique canonical order`);
  }
}

export function assertSituationCapsule(value) {
  plain(value, "SituationCapsule");
  exactKeys(value, CAPSULE_KEYS, "SituationCapsule");
  if (value.protocol !== "apx" || value.version !== "1.0"
    || value.representation !== APX_SITUATION_REPRESENTATION
    || !Array.isArray(value.profile) || !value.profile.includes("apx-core/1")
    || !value.profile.includes("apx-web/1") || !value.profile.includes(APX_SITUATION_PROFILE)
    || !REF_PATTERNS.situation.test(String(value.situationRef || ""))
    || !REF_PATTERNS.world.test(String(value.worldRef || ""))
    || !REF_PATTERNS.observation.test(String(value.observationRef || ""))
    || !Number.isInteger(value.documentEpoch) || value.documentEpoch < 0
    || !Number.isFinite(Date.parse(value.capturedAt))) fail("SituationCapsule envelope is invalid");
  validateSituationFocus(value.focus);
  for (const key of ["requirements", "facts", "affordances", "changes", "unknowns", "suggestedProbes"]) {
    if (!Array.isArray(value[key])) fail(`SituationCapsule.${key} must be an array`);
  }
  const requirementRefs = new Set();
  for (const requirement of value.requirements) {
    plain(requirement, "SituationCapsule.requirements[]");
    exactKeys(requirement, new Set(["requirementRef", "state", "cardinality", "matched", "entityRefs", "claimRefs"]),
      "SituationCapsule.requirements[]");
    if (!REF_PATTERNS.requirement.test(requirement.requirementRef) || requirementRefs.has(requirement.requirementRef)
      || !APX_REQUIREMENT_STATES.includes(requirement.state) || !CARDINALITIES.has(requirement.cardinality)
      || !Number.isInteger(requirement.matched) || requirement.matched < 0
      || !Array.isArray(requirement.entityRefs) || requirement.entityRefs.some((ref) => !REF_PATTERNS.entity.test(ref))
      || !Array.isArray(requirement.claimRefs) || requirement.claimRefs.some((ref) => !REF_PATTERNS.claim.test(ref))) {
      fail("SituationCapsule requirement is invalid");
    }
    requirementRefs.add(requirement.requirementRef);
  }
  assertCanonicalOrder(value.requirements, (entry) => entry.requirementRef, "SituationCapsule requirements");
  if (requirementRefs.size !== value.focus.requirements.length
    || value.focus.requirements.some((entry) => !requirementRefs.has(entry.requirementRef))) {
    fail("SituationCapsule requirements do not answer the focus");
  }
  const factRefs = new Set();
  for (const fact of value.facts) {
    plain(fact, "SituationCapsule.facts[]");
    exactKeys(fact, new Set(["claimRef", "subjectRef", "predicate", "scope", "state", "value", "attestations"]),
      "SituationCapsule.facts[]");
    if (!REF_PATTERNS.claim.test(String(fact.claimRef || "")) || !REF_PATTERNS.entity.test(String(fact.subjectRef || ""))
      || typeof fact.predicate !== "string" || !fact.predicate || typeof fact.scope !== "string"
      || !APX_CLAIM_STATES.includes(fact.state)
      || !Array.isArray(fact.attestations)) fail("SituationCapsule fact is invalid");
    if ((fact.state === "known") !== Object.hasOwn(fact, "value")) fail("SituationCapsule known fact value is invalid");
    for (const attestation of fact.attestations) {
      plain(attestation, "SituationCapsule fact attestation");
      exactKeys(attestation, new Set(["subjectRef", "predicate", "scope", "value", "provenance",
        "evidenceRefs", "freshness", "sensitivity", "redacted"]), "SituationCapsule fact attestation");
      if (attestation.subjectRef !== fact.subjectRef || attestation.predicate !== fact.predicate
        || attestation.scope !== fact.scope || !Array.isArray(attestation.evidenceRefs)
        || !attestation.evidenceRefs.every((ref) => REF_PATTERNS.observation.test(ref))) {
        fail("SituationCapsule fact attestation binding is invalid");
      }
      plain(attestation.freshness, "SituationCapsule fact freshness");
      exactKeys(attestation.freshness, new Set(["status", "capturedAt", "documentEpoch"]),
        "SituationCapsule fact freshness");
      if (!['fresh', 'stale'].includes(attestation.freshness.status)
        || !Number.isFinite(Date.parse(attestation.freshness.capturedAt))
        || !Number.isInteger(attestation.freshness.documentEpoch)) fail("SituationCapsule fact freshness is invalid");
      if (attestation.redacted === true && Object.hasOwn(attestation, "value")) {
        fail("SituationCapsule redacted attestation exposes a value");
      }
      if (typeof attestation.sensitivity !== "string"
        || (["credential", "financial", "health", "secret", "unknown-sensitive"]
          .includes(attestation.sensitivity) && (attestation.redacted !== true || Object.hasOwn(attestation, "value")))) {
        fail("SituationCapsule sensitive attestation is not redacted");
      }
      assertProvenance(attestation.provenance, "SituationCapsule fact provenance");
    }
    const attestedValues = new Map(fact.attestations.filter((item) => !item.redacted)
      .map((item) => [JSON.stringify(item.value), item.value]));
    const expectedState = fact.attestations.length > 0
      && fact.attestations.every((item) => item.freshness.status === "stale") ? "stale"
      : attestedValues.size === 0 ? "unknown" : attestedValues.size === 1 ? "known" : "conflicted";
    if (fact.state !== expectedState || (expectedState === "known"
      && JSON.stringify(fact.value) !== JSON.stringify(attestedValues.values().next().value))) {
      fail("SituationCapsule fact does not reconcile its attestations");
    }
    const claimBody = { subjectRef: fact.subjectRef, predicate: fact.predicate, scope: fact.scope,
      state: fact.state, ...(fact.state === "known" ? { value: fact.value } : {}), attestations: fact.attestations };
    if (fact.claimRef !== `claim:${apxDigest(claimBody)}`) fail("SituationCapsule claim digest does not match");
    if (factRefs.has(fact.claimRef)) fail("SituationCapsule fact is duplicated");
    factRefs.add(fact.claimRef);
  }
  assertCanonicalOrder(value.facts, (entry) => entry.claimRef, "SituationCapsule facts");
  for (const requirement of value.requirements) {
    if (requirement.claimRefs.some((ref) => !factRefs.has(ref))) {
      fail("SituationCapsule requirement references an absent fact");
    }
  }
  for (const affordance of value.affordances) {
    plain(affordance, "SituationCapsule.affordances[]");
    const common = ["kind", "action", "provenance"];
    const keys = affordance.kind === "authorized"
      ? [...common, "capabilityRef", "requirementRef", "entityRef", "locatorRef", "worldRef", "situationRef",
        "risk", "destination", "sessionKey", "documentEpoch", "issuedAt", "expiresAt", "preconditions",
        "expectedTransition"]
      : affordance.kind === "reported"
        ? [...common, "reportedCapabilityRef", "name", "destination", "origin", "revision"]
        : [...common, "requirementRef", "entityRef", "actionable"];
    exactKeys(affordance, new Set(keys), "SituationCapsule.affordances[]");
    if (!APX_AFFORDANCE_KINDS.includes(affordance.kind) || typeof affordance.action !== "string") {
      fail("SituationCapsule affordance is invalid");
    }
    assertProvenance(affordance.provenance, "SituationCapsule affordance provenance");
    if (affordance.kind === "authorized" && (!REF_PATTERNS.capability.test(String(affordance.capabilityRef || ""))
      || !REF_PATTERNS.world.test(String(affordance.worldRef || ""))
      || !REF_PATTERNS.situation.test(String(affordance.situationRef || ""))
      || !REF_PATTERNS.entity.test(String(affordance.entityRef || ""))
      || !LOCATOR.test(String(affordance.locatorRef || ""))
      || !REF_PATTERNS.requirement.test(String(affordance.requirementRef || ""))
      || !Number.isInteger(affordance.documentEpoch)
      || !Number.isFinite(Date.parse(affordance.issuedAt))
      || !Number.isFinite(Date.parse(affordance.expiresAt)))) {
      fail("SituationCapsule authorized affordance is invalid");
    }
    if (affordance.kind === "authorized" && (affordance.worldRef !== value.worldRef
      || affordance.situationRef !== value.situationRef || !requirementRefs.has(affordance.requirementRef))) {
      fail("SituationCapsule authorized affordance binding is invalid");
    }
  }
  assertCanonicalOrder(value.affordances, (entry) => `${entry.requirementRef || ""}:${entry.kind}:${entry.action}:`+
    `${entry.entityRef || entry.capabilityRef || entry.reportedCapabilityRef || ""}`,
  "SituationCapsule affordances");
  for (const item of value.unknowns) {
    plain(item, "SituationCapsule.unknowns[]");
    exactKeys(item, new Set(["unknownRef", "requirementRef", "reason", "entityRef", "evidenceRefs"]),
      "SituationCapsule.unknowns[]");
    if (!REF_PATTERNS.unknown.test(String(item.unknownRef || ""))
      || !REF_PATTERNS.requirement.test(String(item.requirementRef || ""))
      || typeof item.reason !== "string" || !item.reason || !Array.isArray(item.evidenceRefs)
      || (item.entityRef !== undefined && !REF_PATTERNS.entity.test(item.entityRef))) {
      fail("SituationCapsule unknown is invalid");
    }
    if (!requirementRefs.has(item.requirementRef)) fail("SituationCapsule unknown requirement is absent");
  }
  assertCanonicalOrder(value.unknowns, (entry) => entry.unknownRef, "SituationCapsule unknowns");
  for (const probe of value.suggestedProbes) {
    plain(probe, "SituationCapsule.suggestedProbes[]");
    exactKeys(probe, new Set(["kind", "entityRef", "risk", "cost", "expectedInformation", "requirementRef"]),
      "SituationCapsule.suggestedProbes[]");
    if (typeof probe.kind !== "string" || probe.risk !== "read" || !Number.isInteger(probe.cost)
      || typeof probe.expectedInformation !== "string") fail("SituationCapsule suggested probe is invalid");
  }
  if (value.visualProbes !== undefined && !Array.isArray(value.visualProbes)) {
    fail("SituationCapsule.visualProbes must be an array");
  }
  plain(value.completeness, "SituationCapsule.completeness");
  plain(value.budget, "SituationCapsule.budget");
  exactKeys(value.budget, new Set(["used", "omitted", "requiredPreserved"]), "SituationCapsule.budget");
  if (value.budget.requiredPreserved !== true) fail("SituationCapsule required answers were not preserved");
  plain(value.budget.used, "SituationCapsule.budget.used");
  plain(value.budget.omitted, "SituationCapsule.budget.omitted");
  if (value.budget.used.requirements !== value.requirements.length
    || value.budget.used.facts !== value.facts.length
    || value.budget.used.affordances !== value.affordances.length) {
    fail("SituationCapsule budget usage does not match the payload");
  }
  plain(value.integrity, "SituationCapsule.integrity");
  exactKeys(value.integrity, new Set(["canonicalSha256", "worldSha256", "sourceGraphSha256"]),
    "SituationCapsule.integrity");
  if (![value.integrity.canonicalSha256, value.integrity.worldSha256, value.integrity.sourceGraphSha256]
    .every((digest) => DIGEST.test(String(digest || "")))) fail("SituationCapsule integrity is invalid");
  const digestBody = { ...value, integrity: { ...value.integrity, canonicalSha256: null } };
  if (apxDigest(digestBody) !== value.integrity.canonicalSha256) fail("SituationCapsule digest does not match");
  scanPublicBoundary(value);
  return value;
}

export const APX_FOCUS_SCHEMA = Object.freeze({ type: "object", properties: Object.freeze({
  objective: { type: "string", maxLength: 1000 },
  requirements: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: {
    requirementRef: { type: "string", pattern: "^requirement:[A-Za-z0-9._:-]{1,128}$" },
    select: { type: "object" }, need: { type: "array", minItems: 1, maxItems: 3,
      items: { type: "string", enum: [...NEEDS] }, uniqueItems: true },
    cardinality: { type: "string", enum: [...CARDINALITIES] },
  }, required: ["requirementRef", "select", "need"], additionalProperties: false } },
  changedSince: { type: "string", pattern: "^situation:[a-f0-9]{64}$" },
  freshness: { type: "object", properties: { mode: { type: "string", enum: ["live", "recorded"] },
    maxAgeMs: { type: "integer", minimum: 0, maximum: 300000 } },
  required: ["mode", "maxAgeMs"], additionalProperties: false },
}), required: Object.freeze(["requirements"]), additionalProperties: false });

export const APX_ACTION_CONTEXT_SCHEMA = Object.freeze({ type: "object", properties: Object.freeze({
  intent: { type: "string", maxLength: 1000 },
  situationRef: { type: "string", pattern: "^situation:[a-f0-9]{64}$" },
  worldRef: { type: "string", pattern: "^world:[a-f0-9]{64}$" },
  capabilityRef: { type: "string", pattern: "^capability:[a-f0-9]{64}$" },
  expectedTransition: { type: "object", additionalProperties: true },
}), required: Object.freeze(["situationRef", "worldRef", "capabilityRef"]), additionalProperties: false });
