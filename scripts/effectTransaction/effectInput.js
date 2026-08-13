// effectInput.js - secret placeholder와 APX requirement target을 실제 provider input으로 결속한다.
import { createHmac, timingSafeEqual } from "node:crypto";
import { BROWSER_AUTOMATION_ACTIONS, validateBrowserAutomationAction }
  from "../browserControl/browserAutomationCatalog.js";
import { assertSituationCapsule, validateSituationFocus } from "../perception/situationCatalog.js";
import { validatePostcondition } from "../perception/postconditionVerifier.js";
import { canonicalExecutionMemoryJson } from "../executionMemory/executionMemoryCanonical.js";
import { effectTransactionDigest, effectTransactionError } from "./effectTransactionCanonical.js";

const DIGEST = /^[0-9a-f]{64}$/;
const REQUIREMENT = /^requirement:[A-Za-z0-9._:-]{1,128}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;
const SUPPORTED_ACTIONS = new Set(["click", "hover", "focus", "check", "uncheck", "fill", "press", "select", "scroll", "upload"]);
const TEMPLATE_KEYS = new Set(["sessionRef", "focus", "actions"]);
const SESSION_KEYS = new Set(["protocolVersion", "spaceId", "brokerId", "brokerEpoch", "sessionId", "targetRef"]);
const SECRET_INPUT_KEYS = new Set(["secretEnv"]);
const SECRET_STORED_KEYS = new Set(["secretEnv", "bindingSha256"]);

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `${label} must be an object`);
  }
  return value;
}

function exact(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.has(key)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `${label}.${key} is unknown`);
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `${label}.${key} is required`);
  }
}

function secretBinding(bindingKey, name, value) {
  return createHmac("sha256", bindingKey).update(name).update("\0").update(value).digest("hex");
}

function normalizeValue(value, secretBindings, bindingKey, secretValues, depth = 0) {
  if (depth > 24) throw effectTransactionError("EFFECT_INPUT_INVALID", "effect template exceeds the depth limit");
  if (typeof value === "string") {
    if (secretValues.some((secret) => secret && value.includes(secret))) {
      throw effectTransactionError("EFFECT_TRANSACTION_SECRET", "effect template contains secret material; use secretEnv");
    }
    return value;
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry, secretBindings, bindingKey, secretValues, depth + 1));
  plain(value, "effect template value");
  if (Object.keys(value).length === 1 && Object.hasOwn(value, "secretEnv")) {
    exact(value, SECRET_INPUT_KEYS, "secret placeholder");
    if (!SECRET_NAME.test(value.secretEnv) || !secretBindings.has(value.secretEnv)) {
      throw effectTransactionError("EFFECT_SECRET_UNAVAILABLE", `secret provider is unavailable: ${String(value.secretEnv)}`);
    }
    return Object.freeze({ secretEnv: value.secretEnv,
      bindingSha256: secretBinding(bindingKey, value.secretEnv, secretBindings.get(value.secretEnv)) });
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    normalizeValue(child, secretBindings, bindingKey, secretValues, depth + 1)]));
}

function materializeValue(value, secretBindings, bindingKey, depth = 0) {
  if (depth > 24) throw effectTransactionError("EFFECT_INPUT_INVALID", "effect template exceeds the depth limit");
  if (Array.isArray(value)) return value.map((entry) => materializeValue(entry, secretBindings, bindingKey, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 2 && Object.hasOwn(value, "secretEnv") && Object.hasOwn(value, "bindingSha256")) {
    exact(value, SECRET_STORED_KEYS, "stored secret placeholder");
    const secret = secretBindings.get(value.secretEnv);
    if (typeof secret !== "string") {
      throw effectTransactionError("EFFECT_SECRET_UNAVAILABLE", `secret provider is unavailable: ${String(value.secretEnv)}`);
    }
    const actual = Buffer.from(secretBinding(bindingKey, value.secretEnv, secret));
    const expected = Buffer.from(String(value.bindingSha256 || ""));
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw effectTransactionError("EFFECT_SECRET_CHANGED", `secret binding changed: ${value.secretEnv}`);
    }
    return secret;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    materializeValue(child, secretBindings, bindingKey, depth + 1)]));
}

function validateSessionRef(value) {
  plain(value, "effectTemplate.sessionRef");
  for (const key of Object.keys(value)) if (!SESSION_KEYS.has(key)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `effectTemplate.sessionRef.${key} is unknown`);
  }
  const native = typeof value.brokerId === "string" && Number.isInteger(value.brokerEpoch)
    && value.spaceId === undefined;
  const framed = typeof value.spaceId === "string" && value.brokerId === undefined
    && value.brokerEpoch === undefined;
  if (value.protocolVersion !== "1" || (!native && !framed)
    || ![native ? value.brokerId : value.spaceId, value.sessionId, value.targetRef]
      .every((entry) => typeof entry === "string" && entry && entry.length <= 256)
    || (native && value.brokerEpoch < 1)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", "effectTemplate.sessionRef is invalid");
  }
}

function validateLogicalAction(action, index) {
  plain(action, `effectTemplate.actions[${index}]`);
  if (!SUPPORTED_ACTIONS.has(action.kind) || !Object.hasOwn(BROWSER_AUTOMATION_ACTIONS, action.kind)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `unsupported transaction action: ${String(action.kind)}`);
  }
  const spec = BROWSER_AUTOMATION_ACTIONS[action.kind];
  const allowed = new Set([...Object.keys(spec.schema.properties), "requirementRef"]);
  for (const key of ["selector", "locator", "locatorRef", "actionContext"]) allowed.delete(key);
  for (const key of Object.keys(action)) if (!allowed.has(key)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `${action.kind} transaction action does not accept ${key}`);
  }
  if (!REQUIREMENT.test(String(action.requirementRef || "")) || action.expectedRisk !== "externalEffect"
    || !action.verify) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", `${action.kind} requires requirementRef, externalEffect, and verify`);
  }
  validatePostcondition(action.verify);
}

export function validateStoredEffectTemplate(value, { expectedTransition = null } = {}) {
  exact(value, TEMPLATE_KEYS, "effectTemplate");
  validateSessionRef(value.sessionRef);
  validateSituationFocus(value.focus);
  if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 16) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", "effectTemplate.actions requires 1 to 16 entries");
  }
  value.actions.forEach(validateLogicalAction);
  const requirementRefs = new Set(value.focus.requirements.map((entry) => entry.requirementRef));
  if (value.actions.some((action) => !requirementRefs.has(action.requirementRef))) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", "effect action references an undeclared requirement");
  }
  if (expectedTransition && canonicalExecutionMemoryJson(value.actions.at(-1).verify)
    !== canonicalExecutionMemoryJson(expectedTransition)) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", "last action verify must equal the intent transition");
  }
  if (canonicalExecutionMemoryJson(value).length > 256 * 1024) {
    throw effectTransactionError("EFFECT_INPUT_INVALID", "effect template exceeds the byte limit");
  }
  return value;
}

export function normalizeEffectTemplate(value, { secretBindings = new Map(), bindingKey } = {}) {
  if (!(bindingKey instanceof Uint8Array) || bindingKey.byteLength < 32) {
    throw new TypeError("effect input bindingKey must contain at least 32 bytes");
  }
  const secretValues = [...secretBindings.values()];
  const stored = normalizeValue(structuredClone(value), secretBindings, bindingKey, secretValues);
  validateStoredEffectTemplate(stored);
  return Object.freeze({ template: Object.freeze(stored), payloadBindingSha256: effectTransactionDigest(stored) });
}

export function materializeEffectTemplate(value, { secretBindings = new Map(), bindingKey } = {}) {
  validateStoredEffectTemplate(value);
  return materializeValue(structuredClone(value), secretBindings, bindingKey);
}

function authorizedAffordance(situation, action) {
  const matches = situation.affordances.filter((entry) => entry.kind === "authorized"
    && entry.requirementRef === action.requirementRef && entry.action === action.kind);
  if (matches.length !== 1) {
    throw effectTransactionError(matches.length ? "EFFECT_PREFLIGHT_AMBIGUOUS" : "EFFECT_PREFLIGHT_MISMATCH",
      `live preflight requires one authorized ${action.kind} affordance for ${action.requirementRef}`);
  }
  return matches[0];
}

export function bindEffectTemplate(template, situation, { materializedTemplate = template, replay = false } = {}) {
  validateStoredEffectTemplate(template);
  validateStoredEffectTemplate(materializedTemplate);
  assertSituationCapsule(situation);
  const states = new Map(situation.requirements.map((entry) => [entry.requirementRef, entry.state]));
  for (const requirement of template.focus.requirements) {
    if (states.get(requirement.requirementRef) !== "satisfied") {
      throw effectTransactionError("EFFECT_PREFLIGHT_MISMATCH",
        `live requirement is not satisfied: ${requirement.requirementRef}`);
    }
  }
  const bindActions = (source, validate) => source.actions.map((action, index) => {
    const affordance = authorizedAffordance(situation, template.actions[index]);
    const { requirementRef: _requirementRef, ...fields } = action;
    const bound = { ...fields, locatorRef: affordance.locatorRef,
      actionContext: { intent: `Commit ${template.actions[index].kind} for ${template.actions[index].requirementRef}`,
        situationRef: situation.situationRef, worldRef: situation.worldRef, capabilityRef: affordance.capabilityRef,
        expectedTransition: affordance.expectedTransition } };
    if (validate) validateBrowserAutomationAction(bound);
    return Object.freeze(bound);
  });
  const input = Object.freeze({ sessionRef: structuredClone(materializedTemplate.sessionRef),
    actions: Object.freeze(bindActions(materializedTemplate, !replay)) });
  const recordingInput = Object.freeze({ sessionRef: structuredClone(template.sessionRef),
    actions: Object.freeze(bindActions(template, false)) });
  return Object.freeze({ input: replay ? recordingInput : input, recordingInput,
    situationSha256: situation.integrity.canonicalSha256 });
}

export function effectSecretBindingIsValid(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2 && SECRET_NAME.test(String(value.secretEnv || ""))
    && DIGEST.test(String(value.bindingSha256 || ""));
}
