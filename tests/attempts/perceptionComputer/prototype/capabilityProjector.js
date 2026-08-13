// capabilityProjector.js - observed, reported, authorized affordance를 분리하는 prototype.
import { apxDigest } from "../../../../scripts/perception/apxCanonical.js";

function sessionKey(sessionRef) {
  return `${sessionRef?.spaceId || ""}:${sessionRef?.sessionId || ""}:${sessionRef?.targetRef || ""}`;
}

export class PrototypeCapabilityProjector {
  constructor({ actions = [], riskByAction = {}, ttlMs = 5000 } = {}) {
    this.actions = new Set(actions);
    this.riskByAction = Object.freeze({ ...riskByAction });
    this.ttlMs = ttlMs;
    this.capabilities = new Map();
  }

  project(world, entity, sessionRef, situationRef) {
    const affordances = [];
    for (const action of entity.interaction?.supportedActions || []) {
      affordances.push(Object.freeze({ kind: "observed", action, entityRef: entity.entityRef,
        provenance: { mode: "observed", source: "interaction.supportedActions", trust: "browser" } }));
      if (!entity.interaction?.actionable || !entity.locatorRef || !this.actions.has(action)) continue;
      const expiresAt = new Date(Date.parse(world.capturedAt) + this.ttlMs).toISOString();
      const body = { worldRef: world.worldRef, situationRef, entityRef: entity.entityRef,
        locatorRef: entity.locatorRef, action, risk: this.riskByAction[action] || "externalEffect",
        sessionKey: sessionKey(sessionRef), documentEpoch: world.documentEpoch, expiresAt };
      const capability = Object.freeze({ kind: "authorized", capabilityRef: `capability:${apxDigest(body)}`,
        ...body, provenance: { mode: "derived", source: "broker.policy", trust: "broker" } });
      this.capabilities.set(capability.capabilityRef, capability);
      affordances.push(capability);
    }
    return Object.freeze(affordances);
  }

  reported(world) {
    return Object.freeze((world.reportedCapabilities || []).map((capability) => Object.freeze({
      kind: "reported", reportedCapabilityRef: capability.reportedCapabilityRef,
      action: capability.action, name: capability.name,
      provenance: { mode: "reported", source: capability.source || "page.capability", trust: "page" },
    })));
  }

  assert(actionContext, action, sessionRef, { world, situationRef, now = Date.now() } = {}) {
    const capability = this.capabilities.get(actionContext?.capabilityRef);
    const valid = capability && actionContext.worldRef === world?.worldRef
      && actionContext.situationRef === situationRef
      && capability.worldRef === world?.worldRef && capability.situationRef === situationRef
      && capability.sessionKey === sessionKey(sessionRef) && capability.documentEpoch === world?.documentEpoch
      && capability.action === action.kind && capability.locatorRef === action.locatorRef
      && Date.parse(capability.expiresAt) >= now;
    if (!valid) {
      const error = new Error("perception capability is stale or does not authorize this action");
      error.code = "APX_CAPABILITY_STALE"; error.outcome = "notSent"; error.retryable = false;
      throw error;
    }
    return capability;
  }

  dropWorld(worldRef) {
    for (const [ref, capability] of this.capabilities) {
      if (capability.worldRef === worldRef) this.capabilities.delete(ref);
    }
  }
  clear() { this.capabilities.clear(); }
}
