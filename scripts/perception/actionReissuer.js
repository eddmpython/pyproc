// actionReissuer.js - replaced document의 typed focus를 새 capability에 한 번 다시 묶는 순수 계약.
import { apxDigest } from "./apxCanonical.js";
import { validateActionContext } from "./situationCatalog.js";

function failure(message) {
  const error = new Error(message);
  error.code = "APX_CAPABILITY_STALE";
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function oneAuthorizedAffordance(capsule, requirementRef, action) {
  const matches = capsule.affordances.filter((entry) => entry.kind === "authorized"
    && entry.requirementRef === requirementRef && entry.action === action);
  const requirement = capsule.requirements.filter((entry) => entry.requirementRef === requirementRef);
  if (requirement.length !== 1 || requirement[0].state !== "satisfied" || requirement[0].matched !== 1
    || matches.length !== 1) {
    throw failure("document replacement no longer has one authorized target for the original requirement");
  }
  return matches[0];
}

function equalValue(left, right) {
  return apxDigest(left === undefined ? null : left) === apxDigest(right === undefined ? null : right);
}

function rebaseEntityRefs(value, refs) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => rebaseEntityRefs(entry, refs)));
  if (!value || typeof value !== "object") return typeof value === "string" && refs.has(value) ? refs.get(value) : value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, rebaseEntityRefs(entry, refs)])));
}

function entityReplacements(prior, refreshed) {
  const refs = new Map();
  for (const requirement of prior.requirements) {
    const replacement = refreshed.requirements.find((entry) => entry.requirementRef === requirement.requirementRef);
    if (requirement.entityRefs.length === 1 && replacement?.entityRefs?.length === 1) {
      refs.set(requirement.entityRefs[0], replacement.entityRefs[0]);
    }
  }
  return refs;
}

export function prepareActionReissue(history, action) {
  const actionContext = validateActionContext(action?.actionContext);
  const prior = history?.get(actionContext.situationRef);
  if (!prior || prior.worldRef !== actionContext.worldRef) {
    throw failure("document replacement no longer has the original SituationCapsule");
  }
  const original = prior.affordances.filter((entry) => entry.kind === "authorized"
    && entry.capabilityRef === actionContext.capabilityRef);
  if (original.length !== 1 || original[0].locatorRef !== action.locatorRef
    || original[0].action !== action.kind || original[0].risk !== action.expectedRisk) {
    throw failure("document replacement action does not match its original capability");
  }
  return Object.freeze({ action, actionContext, prior, original: original[0] });
}

export function completeActionReissue(prepared, refreshed) {
  const { action, actionContext, prior, original } = prepared;
  const replacement = oneAuthorizedAffordance(refreshed, original.requirementRef, original.action);
  const refs = entityReplacements(prior, refreshed);
  const authorityTransition = rebaseEntityRefs(original.expectedTransition, refs);
  const expectedTransition = actionContext.expectedTransition === undefined ? undefined
    : rebaseEntityRefs(actionContext.expectedTransition, refs);
  if (replacement.risk !== original.risk || !equalValue(replacement.destination, original.destination)
    || !equalValue(replacement.expectedTransition, authorityTransition)
    || (expectedTransition !== undefined && !equalValue(replacement.expectedTransition, expectedTransition))) {
    throw failure("document replacement changed the action authority or expected transition");
  }
  let toLocatorRef = action.toLocatorRef;
  if (toLocatorRef !== undefined) {
    const destinationRequirements = [...new Set(prior.affordances.filter((entry) => entry.kind === "authorized"
      && entry.locatorRef === toLocatorRef).map((entry) => entry.requirementRef))];
    if (destinationRequirements.length !== 1) {
      throw failure("document replacement lost the original drag destination requirement");
    }
    const destinationLocators = [...new Set(refreshed.affordances.filter((entry) => entry.kind === "authorized"
      && entry.requirementRef === destinationRequirements[0]).map((entry) => entry.locatorRef).filter(Boolean))];
    if (destinationLocators.length !== 1) {
      throw failure("document replacement no longer has one drag destination");
    }
    [toLocatorRef] = destinationLocators;
  }
  const reboundContext = Object.freeze({
    ...(actionContext.intent === undefined ? {} : { intent: actionContext.intent }),
    situationRef: refreshed.situationRef,
    worldRef: refreshed.worldRef,
    capabilityRef: replacement.capabilityRef,
    ...(actionContext.expectedTransition === undefined ? {} : {
      expectedTransition: replacement.expectedTransition,
    }),
  });
  return Object.freeze({
    action: Object.freeze({ ...action, locatorRef: replacement.locatorRef,
      ...(action.verify === undefined ? {} : { verify: rebaseEntityRefs(action.verify, refs) }),
      ...(toLocatorRef === undefined ? {} : { toLocatorRef }), actionContext: reboundContext }),
    convergence: Object.freeze({ reason: "documentReplacement", attempts: 2, effectRetries: 0,
      fromSituationRef: prior.situationRef, toSituationRef: refreshed.situationRef,
      fromDocumentEpoch: prior.documentEpoch, toDocumentEpoch: refreshed.documentEpoch }),
  });
}
