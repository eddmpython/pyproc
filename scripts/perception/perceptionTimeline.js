// perceptionTimeline.js - immutable full graph, delta, temporal metadata, graph digest의 bounded ledger.
import { createHash } from "node:crypto";
import { apxDigest, canonicalJsonImage } from "./apxCanonical.js";
import { compareNames } from "../../src/machine/contracts/deterministicOrder.js";

const DEFAULT_LIMIT = 32;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function comparableEntity(entity) {
  const copy = cloneJson(entity);
  delete copy.locatorRef;
  delete copy.temporal;
  return copy;
}

// The canonical text of an entity as the graph compares it (without its locator and temporal metadata), built once.
function comparableText(entity) {
  const { locatorRef: _locatorRef, temporal: _temporal, ...body } = entity;
  return canonicalJsonImage(body);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// apxDigest({entities, relations}) of the graph, entities ordered by entityRef and relations by type, from and to,
// streamed from texts already built: the same bytes and digest as canonicalizing the copied graph.
function graphDigest(entityTexts, relations) {
  const relationTexts = relations.map((relation) => ({ key: `${relation.type}:${relation.from}:${relation.to}`,
    text: canonicalJsonImage(relation) })).sort((left, right) => compareNames(left.key, right.key));
  const hash = createHash("sha256").update('{"entities":[');
  entityTexts.forEach((entry, index) => hash.update(index ? `,${entry.text}` : entry.text));
  hash.update('],"relations":[');
  relationTexts.forEach((entry, index) => hash.update(index ? `,${entry.text}` : entry.text));
  return hash.update("]}").digest("hex");
}

function difference(before, after, path = "") {
  if (Object.is(before, after)) return [];
  const beforeObject = before && typeof before === "object";
  const afterObject = after && typeof after === "object";
  if (Array.isArray(before) && Array.isArray(after) && apxDigest(before) === apxDigest(after)) return [];
  if (!beforeObject || !afterObject || Array.isArray(before) || Array.isArray(after)) {
    return [{ path: path || "/", before: before === undefined ? null : before, after: after === undefined ? null : after }];
  }
  const changes = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
    changes.push(...difference(before[key], after[key], `${path}/${escaped}`));
  }
  return changes;
}

export class PerceptionTimeline {
  constructor({ limit = DEFAULT_LIMIT } = {}) {
    if (!Number.isInteger(limit) || limit < 2 || limit > 256) throw new TypeError("perception timeline limit is invalid");
    this.limit = limit;
    this.sessions = new Map();
  }

  commit(sessionKey, documentEpoch, observationRef, sourceEntities, relations) {
    let session = this.sessions.get(sessionKey);
    const backup = session ? { documentEpoch: session.documentEpoch,
      observations: new Map(session.observations), order: [...session.order],
      temporal: new Map(session.temporal), latest: session.latest } : null;
    if (!session || session.documentEpoch !== documentEpoch) {
      session = { documentEpoch, observations: new Map(), order: [], temporal: new Map(), latest: null };
      this.sessions.set(sessionKey, session);
    }
    const previous = session.latest;
    const entityTexts = [];
    const entities = sourceEntities.map((entity) => {
      const text = comparableText(entity);
      entityTexts.push({ entityRef: entity.entityRef, text });
      const fingerprint = sha256(text);
      const known = session.temporal.get(entity.entityRef);
      const temporal = {
        firstSeen: known?.firstSeen || observationRef,
        lastSeen: observationRef,
        lastChanged: !known || known.fingerprint !== fingerprint ? observationRef : known.lastChanged,
      };
      session.temporal.set(entity.entityRef, { ...temporal, fingerprint });
      return Object.freeze({ ...entity, temporal: Object.freeze(temporal) });
    });
    const entityRefs = new Set(entities.map((entity) => entity.entityRef));
    for (const ref of [...session.temporal.keys()]) if (!entityRefs.has(ref)) session.temporal.delete(ref);
    const state = Object.freeze({
      observationRef,
      documentEpoch,
      entities: Object.freeze(entities),
      relations: Object.freeze([...relations]),
      graphSha256: graphDigest(entityTexts.sort((left, right) => compareNames(left.entityRef, right.entityRef)),
        relations),
    });
    session.observations.set(observationRef, state);
    session.order.push(observationRef);
    session.latest = state;
    while (session.order.length > this.limit) session.observations.delete(session.order.shift());
    const rollback = () => {
      if (this.sessions.get(sessionKey)?.latest?.observationRef !== observationRef) return false;
      if (backup) this.sessions.set(sessionKey, backup);
      else this.sessions.delete(sessionKey);
      return true;
    };
    return Object.freeze({ state, previous, rollback });
  }

  // The latest graph again as a new observation, for a capture whose evidence shows the page did not change: the same
  // entities, relations, and graph digest, each entity seen again now (its first-seen and last-changed stay), with the
  // locators issued for this observation (`locatorRefs` by entity), or the ones it had (null). Null when there is no
  // latest graph of this document.
  repeat(sessionKey, documentEpoch, observationRef, locatorRefs) {
    const session = this.sessions.get(sessionKey);
    const previous = session?.latest;
    if (!previous || session.documentEpoch !== documentEpoch) return null;
    const backup = { documentEpoch: session.documentEpoch, observations: new Map(session.observations),
      order: [...session.order], temporal: new Map(session.temporal), latest: session.latest };
    const entities = previous.entities.map((entity) => {
      const temporal = Object.freeze({ firstSeen: entity.temporal.firstSeen, lastSeen: observationRef,
        lastChanged: entity.temporal.lastChanged });
      session.temporal.set(entity.entityRef, { ...temporal, fingerprint: session.temporal.get(entity.entityRef)?.fingerprint });
      if (!locatorRefs) return Object.freeze({ ...entity, temporal });
      const { locatorRef: _locatorRef, ...body } = entity;
      const locatorRef = locatorRefs.get(entity.entityRef);
      return Object.freeze({ ...body, ...(locatorRef ? { locatorRef } : {}), temporal });
    });
    const state = Object.freeze({ observationRef, documentEpoch, entities: Object.freeze(entities),
      relations: previous.relations, graphSha256: previous.graphSha256 });
    session.observations.set(observationRef, state);
    session.order.push(observationRef);
    session.latest = state;
    while (session.order.length > this.limit) session.observations.delete(session.order.shift());
    const rollback = () => {
      if (this.sessions.get(sessionKey)?.latest?.observationRef !== observationRef) return false;
      this.sessions.set(sessionKey, backup);
      return true;
    };
    return Object.freeze({ state, previous, rollback });
  }

  get(sessionKey, observationRef) { return this.sessions.get(sessionKey)?.observations.get(observationRef) || null; }
  latest(sessionKey) { return this.sessions.get(sessionKey)?.latest || null; }

  diff(base, current) {
    // Entities are compared by their canonical text; only one that differs is copied to find the changed paths.
    const before = new Map(base.entities.map((entity) => [entity.entityRef, entity]));
    const after = new Map(current.entities.map((entity) => [entity.entityRef, entity]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const [ref, entity] of after) {
      if (!before.has(ref)) added.push(ref);
      else if (comparableText(before.get(ref)) !== comparableText(entity)) {
        const paths = difference(comparableEntity(before.get(ref)), comparableEntity(entity));
        if (paths.length) changed.push(Object.freeze({ entityRef: ref, paths: Object.freeze(paths.map(Object.freeze)) }));
      }
    }
    for (const ref of before.keys()) if (!after.has(ref)) removed.push(ref);
    return Object.freeze({ added: Object.freeze(added), removed: Object.freeze(removed), changed: Object.freeze(changed) });
  }

  changedRefs(sessionKey, baseRef) {
    const current = this.latest(sessionKey);
    const base = this.get(sessionKey, baseRef);
    if (!current || !base) return null;
    const delta = this.diff(base, current);
    return new Set([...delta.added, ...delta.removed, ...delta.changed.map((entry) => entry.entityRef)]);
  }

  dropSession(sessionKey) { this.sessions.delete(sessionKey); }
  inspect() {
    let observations = 0;
    let temporalEntities = 0;
    for (const session of this.sessions.values()) {
      observations += session.observations.size;
      temporalEntities += session.temporal.size;
    }
    return Object.freeze({ sessions: this.sessions.size, observations, temporalEntities });
  }
  close() { this.sessions.clear(); }
}
