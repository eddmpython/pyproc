// perceptionTimeline.js - immutable full graph, delta, temporal metadata, graph digest의 bounded ledger.
import { apxDigest } from "./apxCanonical.js";
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

function graphBody(entities, relations) {
  return {
    entities: entities.map(comparableEntity).sort((left, right) => compareNames(left.entityRef, right.entityRef)),
    relations: relations.map(cloneJson).sort((left, right) =>
      compareNames(`${left.type}:${left.from}:${left.to}`, `${right.type}:${right.from}:${right.to}`)),
  };
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
    const entities = sourceEntities.map((entity) => {
      const comparable = comparableEntity(entity);
      const fingerprint = apxDigest(comparable);
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
      graphSha256: apxDigest(graphBody(entities, relations)),
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

  get(sessionKey, observationRef) { return this.sessions.get(sessionKey)?.observations.get(observationRef) || null; }
  latest(sessionKey) { return this.sessions.get(sessionKey)?.latest || null; }

  diff(base, current) {
    const before = new Map(base.entities.map((entity) => [entity.entityRef, comparableEntity(entity)]));
    const after = new Map(current.entities.map((entity) => [entity.entityRef, comparableEntity(entity)]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const [ref, entity] of after) {
      if (!before.has(ref)) added.push(ref);
      else if (apxDigest(before.get(ref)) !== apxDigest(entity)) {
        const paths = difference(before.get(ref), entity);
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
