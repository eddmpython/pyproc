// worldModel.js - APX graph를 atomic claim, freshness, transition world로 재조정한다.
import { apxDigest } from "./apxCanonical.js";

const FORBIDDEN_KEYS = new Set(["backendNodeId", "backendDOMNodeId", "nodeId", "objectId",
  "executionContextId", "nativeRef", "locatorData", "frameNativeRef", "fromNativeRef", "toNativeRef"]);
const SENSITIVE = new Set(["credential", "financial", "health", "secret", "unknown-sensitive"]);

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])));
}

function scanBoundary(value) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`world input exposes raw provider field ${key}`);
      stack.push(child);
    }
  }
}

function attestation(subjectRef, predicate, value, provenance, observation, { redacted = false,
  sensitivity = "public" } = {}) {
  return immutable({ subjectRef, predicate, scope: "document", ...(redacted ? {} : { value }),
    provenance: provenance || { mode: "observed", source: "apx.graph", trust: "browser" },
    evidenceRefs: [observation.observationRef], freshness: { status: "fresh",
      capturedAt: observation.capturedAt, documentEpoch: observation.documentEpoch }, sensitivity,
    ...(redacted ? { redacted: true } : {}) });
}

function entityAttestations(entity, observation) {
  const values = [
    ["entity.kind", entity.kind, entity.provenance?.structure, false],
    ["semantic.role", entity.semantic?.role, entity.provenance?.semantic, false],
    ["semantic.name", entity.semantic?.name, entity.provenance?.semantic, false],
    ["semantic.value", entity.semantic?.value, entity.provenance?.semantic,
      SENSITIVE.has(entity.semantic?.sensitivity), entity.semantic?.sensitivity || "public"],
    ["geometry.visible", entity.geometry?.visible, entity.provenance?.geometry, false],
    ["geometry.occluded", entity.geometry?.occluded, entity.provenance?.geometry, false],
    ["interaction.actionable", entity.interaction?.actionable, entity.provenance?.interaction, false],
  ];
  for (const [name, value] of Object.entries(entity.semantic?.states || {})) {
    values.push([`semantic.state.${name}`, value, entity.provenance?.semantic, false]);
  }
  return values.filter(([, value]) => value !== undefined)
    .map(([predicate, value, provenance, redacted, sensitivity]) => attestation(entity.entityRef, predicate, value,
      provenance, observation, { redacted, sensitivity }));
}

function claimKey(value) { return `${value.subjectRef}\u0000${value.predicate}\u0000${value.scope}`; }

function reconcile(attestations) {
  const values = new Map();
  let redacted = false;
  let stale = true;
  for (const item of attestations) {
    if (item.redacted) redacted = true;
    else {
      const key = JSON.stringify(item.value);
      if (!values.has(key)) values.set(key, item.value);
    }
    if (item.freshness.status !== "stale") stale = false;
  }
  const state = stale ? "stale" : redacted && values.size === 0 ? "unknown"
    : values.size === 0 ? "unknown" : values.size === 1 ? "known" : "conflicted";
  const body = { subjectRef: attestations[0].subjectRef, predicate: attestations[0].predicate,
    scope: attestations[0].scope, state,
    ...(state === "known" ? { value: values.values().next().value } : {}), attestations };
  return immutable({ claimRef: `claim:${apxDigest(body)}`, ...body });
}

function compareRef(left, right) { return left.claimRef < right.claimRef ? -1 : left.claimRef > right.claimRef ? 1 : 0; }

function comparableClaim(claim) {
  return { subjectRef: claim.subjectRef, predicate: claim.predicate, scope: claim.scope, state: claim.state,
    ...(Object.hasOwn(claim, "value") ? { value: claim.value } : {}),
    attestations: claim.attestations.map((item) => ({ ...(Object.hasOwn(item, "value") ? { value: item.value } : {}),
      ...(item.redacted ? { redacted: true } : {}), sensitivity: item.sensitivity,
      provenance: item.provenance })) };
}

function worldDigest(observation, reportedClaims) {
  return apxDigest({ documentEpoch: observation.documentEpoch,
    graphSha256: observation.integrity.graphSha256, reportedClaims });
}

export class WorldModel {
  constructor({ limit = 32 } = {}) {
    if (!Number.isInteger(limit) || limit < 2 || limit > 256) throw new TypeError("world limit must be from 2 to 256");
    this.limit = limit;
    this.sessions = new Map();
  }

  prepare(sessionKey, observation, { reportedClaims = [] } = {}) {
    if (typeof sessionKey !== "string" || !sessionKey) throw new TypeError("world session key is required");
    if (!observation || observation.representation !== "apx.graph") {
      throw new TypeError("world reconciliation requires an APX graph observation");
    }
    scanBoundary(observation);
    scanBoundary(reportedClaims);
    const priorState = this.sessions.get(sessionKey) || Object.freeze({ worlds: Object.freeze([]), current: null });
    const digest = worldDigest(observation, reportedClaims);
    if (priorState.current?.integrity.worldSha256 === digest) {
      return Object.freeze({ world: priorState.current, unchanged: true, commit: () => priorState.current });
    }
    const byKey = new Map();
    for (const entity of observation.entities) {
      for (const item of entityAttestations(entity, observation)) {
        const key = claimKey(item);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(item);
      }
    }
    for (const reported of reportedClaims) {
      const item = attestation(reported.subjectRef, reported.predicate, reported.value,
        reported.provenance || { mode: "reported", source: "page.capability", trust: "page" }, observation,
      { redacted: SENSITIVE.has(reported.sensitivity), sensitivity: reported.sensitivity || "public" });
      const key = claimKey(item);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    }
    const claims = [...byKey.values()].map(reconcile).sort(compareRef);
    const previous = priorState.current;
    const replacement = !!previous && previous.documentEpoch !== observation.documentEpoch;
    const previousClaims = new Map((previous?.claims || []).map((claim) => [claimKey(claim), claim]));
    const changes = [];
    if (previous && !replacement) {
      for (const claim of claims) {
        const before = previousClaims.get(claimKey(claim));
        if (!before || apxDigest(comparableClaim(before)) !== apxDigest(comparableClaim(claim))) changes.push(immutable({
          subjectRef: claim.subjectRef, predicate: claim.predicate,
          beforeClaimRef: before?.claimRef || null, afterClaimRef: claim.claimRef, causality: "unknown",
        }));
      }
      const currentKeys = new Set(claims.map(claimKey));
      for (const before of previous.claims) {
        if (currentKeys.has(claimKey(before))) continue;
        changes.push(immutable({ subjectRef: before.subjectRef, predicate: before.predicate,
          beforeClaimRef: before.claimRef, afterClaimRef: null, causality: "unknown" }));
      }
    }
    const world = immutable({ protocol: "apx", version: "1.0", representation: "apx.world",
      worldRef: `world:${digest}`, observationRef: observation.observationRef,
      documentEpoch: observation.documentEpoch, capturedAt: observation.capturedAt,
      entities: observation.entities, relations: observation.relations, claims,
      reportedCapabilities: reportedClaims.filter((claim) => claim.capability).map((claim) => claim.capability),
      changes: replacement ? [{ kind: "documentReplacement", beforeWorldRef: previous.worldRef,
        afterDocumentEpoch: observation.documentEpoch, causality: "unknown" }] : changes,
      completeness: observation.completeness,
      integrity: { worldSha256: digest, sourceGraphSha256: observation.integrity.canonicalSha256 } });
    let committed = false;
    const commit = () => {
      if (committed) return world;
      if (this.sessions.get(sessionKey) !== undefined && this.sessions.get(sessionKey) !== priorState) {
        throw new Error("world commit lost its session turn");
      }
      const next = immutable({ worlds: [...priorState.worlds, world].slice(-this.limit), current: world });
      this.sessions.set(sessionKey, next);
      committed = true;
      return next.current;
    };
    return Object.freeze({ world, unchanged: false, commit });
  }

  current(sessionKey) { return this.sessions.get(sessionKey)?.current || null; }
  get(sessionKey, worldRef) {
    return this.sessions.get(sessionKey)?.worlds.find((world) => world.worldRef === worldRef) || null;
  }
  dropSession(sessionKey) { this.sessions.delete(sessionKey); }
  close() { this.sessions.clear(); }
}
