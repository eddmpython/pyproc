// worldModel.js - APX graph를 atomic typed claim world로 재조정하는 prototype.
import { apxDigest } from "../../../../scripts/perception/apxCanonical.js";

const FORBIDDEN_KEYS = new Set(["backendNodeId", "backendDOMNodeId", "nodeId", "objectId",
  "executionContextId", "nativeRef", "locatorData"]);
const SECRET_KEY = /password|passwd|authorization|cookie|token|secret|apiKey/i;

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

function scanBoundary(value, path = "world") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanBoundary(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${path} exposes raw provider field ${key}`);
    if (SECRET_KEY.test(key) && child !== undefined && child !== null && child !== "") {
      throw new TypeError(`${path} contains forbidden secret field ${key}`);
    }
    scanBoundary(child, `${path}.${key}`);
  }
}

function claimAttestation(subjectRef, predicate, value, provenance, observationRef, freshness) {
  return immutable({ subjectRef, predicate, scope: "document", value,
    provenance: provenance || { mode: "observed", source: "apx.graph", trust: "browser" },
    evidenceRefs: [observationRef], freshness });
}

function entityAttestations(entity, observation) {
  const freshness = { status: "fresh", capturedAt: observation.capturedAt,
    documentEpoch: observation.documentEpoch };
  const values = [
    ["entity.kind", entity.kind, entity.provenance?.structure],
    ["semantic.role", entity.semantic?.role, entity.provenance?.semantic],
    ["semantic.name", entity.semantic?.name, entity.provenance?.semantic],
    ["semantic.value", entity.semantic?.value, entity.provenance?.semantic],
    ["geometry.visible", entity.geometry?.visible, entity.provenance?.geometry],
    ["geometry.occluded", entity.geometry?.occluded, entity.provenance?.geometry],
    ["interaction.actionable", entity.interaction?.actionable, entity.provenance?.interaction],
  ];
  for (const [name, value] of Object.entries(entity.semantic?.states || {})) {
    values.push([`semantic.state.${name}`, value, entity.provenance?.semantic]);
  }
  return values.filter(([, value]) => value !== undefined)
    .map(([predicate, value, provenance]) => claimAttestation(entity.entityRef, predicate, value,
      provenance, observation.observationRef, freshness));
}

function claimKey(attestation) {
  return `${attestation.subjectRef}\u0000${attestation.predicate}\u0000${attestation.scope}`;
}

function reconcileClaim(attestations) {
  const values = new Map();
  let stale = true;
  for (const attestation of attestations) {
    const valueKey = JSON.stringify(attestation.value);
    if (!values.has(valueKey)) values.set(valueKey, attestation.value);
    if (attestation.freshness?.status !== "stale") stale = false;
  }
  const state = stale ? "stale" : values.size === 0 ? "unknown" : values.size === 1 ? "known" : "conflicted";
  const body = { subjectRef: attestations[0].subjectRef, predicate: attestations[0].predicate,
    scope: attestations[0].scope, state,
    ...(state === "known" ? { value: values.values().next().value } : {}), attestations };
  return immutable({ claimRef: `claim:${apxDigest(body)}`, ...body });
}

function graphBody(observation, reportedClaims) {
  return { documentEpoch: observation.documentEpoch,
    graphSha256: observation.integrity?.graphSha256 || observation.integrity?.canonicalSha256,
    entities: observation.entities, relations: observation.relations, reportedClaims };
}

export class PrototypeWorldModel {
  constructor({ maxWorlds = 32 } = {}) {
    if (!Number.isInteger(maxWorlds) || maxWorlds < 2 || maxWorlds > 256) {
      throw new TypeError("world maxWorlds must be from 2 to 256");
    }
    this.maxWorlds = maxWorlds;
    this.sessions = new Map();
  }

  ingest(sessionKey, observation, { reportedClaims = [] } = {}) {
    if (typeof sessionKey !== "string" || !sessionKey) throw new TypeError("world sessionKey is required");
    if (!observation || observation.representation !== "apx.graph") {
      throw new TypeError("world ingest requires an APX graph observation");
    }
    scanBoundary(observation);
    scanBoundary(reportedClaims);
    const current = this.sessions.get(sessionKey) || immutable({ worlds: [], current: null });
    const worldDigest = apxDigest(graphBody(observation, reportedClaims));
    if (current.current?.integrity.worldSha256 === worldDigest) return current.current;
    const byKey = new Map();
    for (const entity of observation.entities) {
      for (const attestation of entityAttestations(entity, observation)) {
        const key = claimKey(attestation);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(attestation);
      }
    }
    for (const claim of reportedClaims) {
      const attestation = claimAttestation(claim.subjectRef, claim.predicate, claim.value,
        claim.provenance || { mode: "reported", source: "page.capability", trust: "page" },
        observation.observationRef, { status: claim.stale ? "stale" : "fresh",
          capturedAt: observation.capturedAt, documentEpoch: observation.documentEpoch });
      const key = claimKey(attestation);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(attestation);
    }
    const claims = [...byKey.values()].map(reconcileClaim)
      .sort((left, right) => left.claimRef < right.claimRef ? -1 : left.claimRef > right.claimRef ? 1 : 0);
    const previous = current.current;
    const replacement = !!previous && previous.documentEpoch !== observation.documentEpoch;
    const previousClaims = new Map((previous?.claims || []).map((claim) =>
      [`${claim.subjectRef}\u0000${claim.predicate}\u0000${claim.scope}`, claim]));
    const changes = [];
    if (previous && !replacement) {
      for (const claim of claims) {
        const prior = previousClaims.get(`${claim.subjectRef}\u0000${claim.predicate}\u0000${claim.scope}`);
        if (!prior || apxDigest(prior) !== apxDigest(claim)) changes.push(immutable({
          subjectRef: claim.subjectRef, predicate: claim.predicate,
          beforeClaimRef: prior?.claimRef || null, afterClaimRef: claim.claimRef, causality: "unknown",
        }));
      }
    }
    const world = immutable({ protocol: "apx", version: "1.0", representation: "apx.world",
      worldRef: `world:${worldDigest}`, observationRef: observation.observationRef,
      documentEpoch: observation.documentEpoch, capturedAt: observation.capturedAt,
      entities: observation.entities, relations: observation.relations, claims,
      reportedCapabilities: reportedClaims.filter((claim) => claim.capability).map((claim) => claim.capability),
      changes: replacement ? [{ kind: "documentReplacement", beforeWorldRef: previous.worldRef,
        afterDocumentEpoch: observation.documentEpoch, causality: "unknown" }] : changes,
      completeness: observation.completeness,
      integrity: { worldSha256: worldDigest, sourceGraphSha256: observation.integrity?.canonicalSha256 || worldDigest } });
    const worlds = [...current.worlds, world].slice(-this.maxWorlds);
    const next = immutable({ worlds, current: world });
    this.sessions.set(sessionKey, next);
    return next.current;
  }

  current(sessionKey) { return this.sessions.get(sessionKey)?.current || null; }
  get(sessionKey, worldRef) {
    return this.sessions.get(sessionKey)?.worlds.find((world) => world.worldRef === worldRef) || null;
  }
  dropSession(sessionKey) { this.sessions.delete(sessionKey); }
  close() { this.sessions.clear(); }
}
