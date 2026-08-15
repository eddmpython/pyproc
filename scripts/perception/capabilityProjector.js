// capabilityProjector.js - 보이는 affordance와 broker 권한을 분리하고 proof-carrying action을 검사한다.
import { apxDigest } from "./apxCanonical.js";
import { validateActionContext } from "./situationCatalog.js";

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

function sessionKey(sessionRef) {
  return `${sessionRef?.spaceId || ""}:${sessionRef?.sessionId || ""}:${sessionRef?.targetRef || ""}`;
}

function stale(message) {
  const error = new Error(message);
  error.code = "APX_CAPABILITY_STALE";
  error.outcome = "notSent";
  error.retryable = true;
  return error;
}

function observedAffordances(entity) {
  const output = [];
  for (const action of entity.interaction?.supportedActions || []) {
    output.push(immutable({ kind: "observed", action, entityRef: entity.entityRef,
      provenance: { mode: "observed", source: "interaction.supportedActions", trust: "browser" } }));
    output.push(immutable({ kind: "derived", action, entityRef: entity.entityRef,
      actionable: entity.interaction?.actionable === true,
      provenance: { mode: "derived", source: "broker.actionability", trust: "broker" } }));
  }
  return output;
}

export class CapabilityProjector {
  constructor({ authorize = () => null, now = () => Date.now(), ttlMs = 60000 } = {}) {
    if (typeof authorize !== "function" || typeof now !== "function") {
      throw new TypeError("capability projector factories are invalid");
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000) {
      throw new TypeError("capability ttlMs must be from 1 to 300000");
    }
    this.authorize = authorize;
    this.now = now;
    this.ttlMs = ttlMs;
    this.capabilities = new Map();
  }

  project(world, entity, sessionRef, situationRef, requirementRef) {
    const output = observedAffordances(entity).map((entry) => immutable({ ...entry, requirementRef }));
    if (!entity.interaction?.actionable || !entity.locatorRef) return Object.freeze(output);
    for (const action of entity.interaction?.supportedActions || []) {
      const grant = this.authorize({ world, entity, sessionRef, action });
      if (!grant) continue;
      const issuedAtMs = Date.parse(world.capturedAt);
      const body = {
        worldRef: world.worldRef,
        situationRef,
        entityRef: entity.entityRef,
        locatorRef: entity.locatorRef,
        action,
        risk: grant.risk,
        destination: grant.destination || null,
        sessionKey: sessionKey(sessionRef),
        documentEpoch: world.documentEpoch,
        issuedAt: world.capturedAt,
        expiresAt: new Date(issuedAtMs + this.ttlMs).toISOString(),
        preconditions: immutable(grant.preconditions || []),
        expectedTransition: immutable(grant.expectedTransition || {}),
      };
      output.push(immutable({ kind: "authorized", capabilityRef: `capability:${apxDigest(body)}`,
        requirementRef, ...body,
        provenance: { mode: "derived", source: "broker.policy", trust: "broker" } }));
    }
    return Object.freeze(output);
  }

  reported(world) {
    return Object.freeze((world.reportedCapabilities || []).map((capability) => immutable({
      kind: "reported",
      reportedCapabilityRef: capability.reportedCapabilityRef,
      action: capability.action,
      name: capability.name,
      destination: capability.destination || null,
      origin: capability.origin || null,
      revision: capability.revision || null,
      provenance: { mode: "reported", source: capability.source || "page.capability", trust: "page" },
    })));
  }

  commit(capsule) {
    for (const affordance of capsule.affordances) {
      if (affordance.kind === "authorized") this.capabilities.set(affordance.capabilityRef, affordance);
    }
    return capsule;
  }

  assert(actionContext, action, sessionRef, { world, situationRef, now = this.now() } = {}) {
    const context = validateActionContext(actionContext);
    const capability = this.capabilities.get(context.capabilityRef);
    const actualRisk = action.expectedRisk;
    const actualDestination = action.url || action.destination || null;
    const valid = capability
      && context.worldRef === world?.worldRef
      && context.situationRef === situationRef
      && capability.worldRef === world?.worldRef
      && capability.situationRef === situationRef
      && capability.sessionKey === sessionKey(sessionRef)
      && capability.documentEpoch === world?.documentEpoch
      && capability.action === action.kind
      && capability.locatorRef === action.locatorRef
      && capability.risk === actualRisk
      && (capability.destination === null || capability.destination === actualDestination)
      && (context.expectedTransition === undefined
        || apxDigest(context.expectedTransition) === apxDigest(capability.expectedTransition))
      && Date.parse(capability.expiresAt) >= now;
    if (!valid) throw stale("perception capability is stale or does not authorize this action");
    return capability;
  }

  dropWorld(worldRef) {
    for (const [ref, capability] of this.capabilities) {
      if (capability.worldRef === worldRef) this.capabilities.delete(ref);
    }
  }

  dropSession(sessionRef) {
    const key = sessionKey(sessionRef);
    for (const [ref, capability] of this.capabilities) {
      if (capability.sessionKey === key) this.capabilities.delete(ref);
    }
  }

  inspect() {
    return Object.freeze({ capabilities: this.capabilities.size });
  }

  close() {
    this.capabilities.clear();
  }
}
