// situationBinding.js - complete SituationCapsule에서 exact provider binding과 internal action을 만든다.
import { assertSituationCapsule } from "../perception/situationCatalog.js";
import { validatePostcondition } from "../perception/postconditionVerifier.js";
import {
  ACTUATION_ERROR_CODES,
  actuationDigest,
  actuationError,
  assertActuationIntent,
  createTargetBinding,
} from "./actuationCanonical.js";

const PROVIDER_ACTUATORS = Object.freeze({ nativeCdp: "browserInput", frame: "cooperative", replay: "replay" });
const INTENT_ACTIONS = Object.freeze({ activate: "click", focus: "focus", setValue: "fill",
  setExpanded: "click", scrollTo: "scroll", dragTo: "drag" });

function oneRequirement(situation, requirementRef, entityRef) {
  const matches = situation.requirements.filter((entry) => entry.requirementRef === requirementRef);
  const requirement = matches[0];
  if (matches.length !== 1 || requirement.state !== "satisfied" || requirement.cardinality !== "one"
    || requirement.matched !== 1 || requirement.entityRefs.length !== 1
    || requirement.entityRefs[0] !== entityRef
    || situation.unknowns.some((entry) => entry.requirementRef === requirementRef)) {
    throw actuationError(matches.length > 1 || requirement?.matched > 1
      ? ACTUATION_ERROR_CODES.targetAmbiguous : ACTUATION_ERROR_CODES.perceptionIncomplete,
    "target requirement must contain one complete satisfied entity");
  }
  return requirement;
}

function actionKind(intent, situation) {
  if (intent.intent !== "setSelected") return INTENT_ACTIONS[intent.intent];
  if (Array.isArray(intent.desired.selected)) return "select";
  const role = knownFact(situation, intent.target.entityRef, "semantic.role");
  return intent.desired.selected ? "check" : role === "radio" ? null : "uncheck";
}

function knownFact(situation, entityRef, predicate) {
  const facts = situation.facts.filter((entry) => entry.subjectRef === entityRef && entry.predicate === predicate);
  return facts.length === 1 && facts[0].state === "known" ? facts[0].value : undefined;
}

function desiredAlreadyHolds(intent, situation) {
  const entityRef = intent.target.entityRef;
  if (intent.intent === "setValue") {
    return Object.hasOwn(intent.desired, "value")
      && knownFact(situation, entityRef, "semantic.value") === intent.desired.value;
  }
  if (intent.intent === "setSelected" && typeof intent.desired.selected === "boolean") {
    const role = knownFact(situation, entityRef, "semantic.role");
    const predicate = ["checkbox", "radio"].includes(role) ? "semantic.state.checked" : "semantic.state.selected";
    return knownFact(situation, entityRef, predicate) === intent.desired.selected;
  }
  if (intent.intent === "setExpanded") {
    return knownFact(situation, entityRef, "semantic.state.expanded") === intent.desired.expanded;
  }
  if (intent.intent === "focus") {
    return knownFact(situation, entityRef, "semantic.state.focused") === true;
  }
  return false;
}

function desiredPostcondition(intent, situation) {
  if (Object.keys(intent.expectedTransition).length) return intent.expectedTransition;
  const entityRef = intent.target.entityRef;
  if (intent.intent === "setValue" && Object.hasOwn(intent.desired, "value")) {
    return { entityState: { entityRef, value: intent.desired.value } };
  }
  if (intent.intent === "setSelected" && typeof intent.desired.selected === "boolean") {
    const role = knownFact(situation, entityRef, "semantic.role");
    const field = ["checkbox", "radio"].includes(role) ? "checked" : "selected";
    return { entityState: { entityRef, [field]: intent.desired.selected } };
  }
  if (intent.intent === "setExpanded") {
    return { entityState: { entityRef, expanded: intent.desired.expanded } };
  }
  return null;
}

function exactAffordance(situation, requirementRef, entityRef, action, capabilityRef, now) {
  const matches = situation.affordances.filter((entry) => entry.kind === "authorized"
    && entry.requirementRef === requirementRef && entry.entityRef === entityRef
    && entry.action === action && entry.capabilityRef === capabilityRef);
  if (matches.length !== 1) {
    throw actuationError(matches.length > 1 ? ACTUATION_ERROR_CODES.targetAmbiguous
      : ACTUATION_ERROR_CODES.authorityRequired,
    "target requires one exact authorized affordance");
  }
  const affordance = matches[0];
  if (Date.parse(affordance.expiresAt) < now) {
    throw actuationError(ACTUATION_ERROR_CODES.targetStale, "target affordance expired before binding", {
      expiredByMs: now - Date.parse(affordance.expiresAt),
    });
  }
  return affordance;
}

function destinationLocator(intent, situation, destinationRequirementRef) {
  if (intent.intent !== "dragTo") return null;
  if (!intent.desired.targetEntityRef || !destinationRequirementRef) {
    throw actuationError(ACTUATION_ERROR_CODES.intentInvalid,
      "dragTo requires targetEntityRef and destinationRequirementRef");
  }
  oneRequirement(situation, destinationRequirementRef, intent.desired.targetEntityRef);
  const locators = situation.affordances.filter((entry) => entry.kind === "authorized"
    && entry.requirementRef === destinationRequirementRef && entry.entityRef === intent.desired.targetEntityRef)
    .map((entry) => entry.locatorRef);
  const unique = [...new Set(locators)];
  if (unique.length !== 1) {
    throw actuationError(unique.length > 1 ? ACTUATION_ERROR_CODES.targetAmbiguous
      : ACTUATION_ERROR_CODES.perceptionIncomplete, "drag destination requires one opaque locator");
  }
  return unique[0];
}

function bindingInvariants(situation, affordance) {
  const axes = [{ kind: "entity", sha256: actuationDigest({ entityRef: affordance.entityRef }) },
    { kind: "capability", sha256: actuationDigest({ capabilityRef: affordance.capabilityRef,
      situationRef: situation.situationRef, documentEpoch: situation.documentEpoch }) }];
  for (const predicate of ["semantic.role", "semantic.name"]) {
    const fact = situation.facts.find((entry) => entry.subjectRef === affordance.entityRef
      && entry.predicate === predicate && entry.state === "known");
    if (fact) axes.push({ kind: predicate, sha256: actuationDigest({ value: fact.value }) });
  }
  return axes;
}

function actionFor(intent, affordance, situation, action, transition, destinationLocatorRef, resolveValue) {
  const output = { kind: action, locatorRef: affordance.locatorRef, expectedRisk: affordance.risk,
    actionContext: { intent: `${intent.intent}:${intent.intentSha256}`, situationRef: situation.situationRef,
      worldRef: situation.worldRef, capabilityRef: affordance.capabilityRef,
      ...(Object.keys(affordance.expectedTransition || {}).length
        ? { expectedTransition: affordance.expectedTransition } : {}) },
    verify: transition };
  if (intent.intent === "setValue") {
    const value = Object.hasOwn(intent.desired, "value") ? intent.desired.value : resolveValue(intent.desired.valueRef);
    if (typeof value !== "string" && typeof value !== "number") {
      throw actuationError(ACTUATION_ERROR_CODES.authorityRequired, "valueRef is unavailable in the bounded value provider");
    }
    output.value = String(value);
  } else if (intent.intent === "setSelected" && Array.isArray(intent.desired.selected)) {
    output.values = [...intent.desired.selected];
  } else if (intent.intent === "scrollTo") {
    output.block = intent.desired.visibility === "full" ? "center" : intent.desired.visibility;
  } else if (intent.intent === "dragTo") {
    output.toLocatorRef = destinationLocatorRef;
  }
  return Object.freeze(output);
}

export function compileSituationBinding({ intent, situation, requirementRef, destinationRequirementRef = null,
  providerKind, spaceId, now = Date.now(), resolveValue = () => undefined } = {}) {
  assertActuationIntent(intent);
  assertSituationCapsule(situation);
  const actuatorKind = PROVIDER_ACTUATORS[providerKind];
  if (!actuatorKind) throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
    `automation provider has no Motor actuator: ${String(providerKind)}`);
  if (intent.target.spaceRef !== spaceId || intent.target.worldRef !== situation.worldRef
    || intent.target.surfaceEpoch !== `document:${situation.documentEpoch}`) {
    throw actuationError(ACTUATION_ERROR_CODES.targetStale, "intent target differs from the live situation epoch");
  }
  oneRequirement(situation, requirementRef, intent.target.entityRef);
  const action = actionKind(intent, situation);
  if (!action) throw actuationError(ACTUATION_ERROR_CODES.intentInvalid,
    "requested desired state cannot be expressed by this control");
  const affordance = exactAffordance(situation, requirementRef, intent.target.entityRef, action,
    intent.authority.actionCapabilityRef, now);
  const destinationLocatorRef = destinationLocator(intent, situation, destinationRequirementRef);
  const transition = desiredPostcondition(intent, situation)
    || (Object.keys(affordance.expectedTransition || {}).length ? affordance.expectedTransition : null);
  if (!transition) throw actuationError(ACTUATION_ERROR_CODES.perceptionIncomplete,
    "verified actuation requires a deterministic postcondition");
  try { validatePostcondition(transition); }
  catch (error) { throw actuationError(ACTUATION_ERROR_CODES.intentInvalid,
    "actuation expectedTransition is not an APX postcondition", { code: error?.code || null }); }
  const binding = createTargetBinding({ spaceRef: intent.target.spaceRef, worldRef: intent.target.worldRef,
    entityRef: intent.target.entityRef, surfaceEpoch: intent.target.surfaceEpoch, actuatorKind,
    invariants: bindingInvariants(situation, affordance), candidateCount: 1, uniqueness: "unique",
    freshUntil: Date.parse(affordance.expiresAt), providerFenceSha256: actuationDigest({ providerKind, spaceId,
      situationSha256: situation.integrity.canonicalSha256, sourceGraphSha256: situation.integrity.sourceGraphSha256 }) });
  return Object.freeze({ binding, affordance, actionKind: action, transition,
    alreadySatisfied: desiredAlreadyHolds(intent, situation),
    action: actionFor(intent, affordance, situation, action, transition, destinationLocatorRef, resolveValue) });
}
