// perceptionIdentity.js - driver native identity를 document epoch 한정 opaque entityRef로 바꾼다.

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.spaceId || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

export class PerceptionIdentity {
  constructor({ idFactory = () => crypto.randomUUID() } = {}) {
    if (typeof idFactory !== "function") throw new TypeError("perception identity idFactory is required");
    this.idFactory = idFactory;
    this.sessions = new Map();
  }

  state(sessionRef, documentEpoch) {
    const key = sessionKey(sessionRef);
    let state = this.sessions.get(key);
    if (!state || state.documentEpoch !== documentEpoch) {
      state = { documentEpoch, entities: new Map(), frames: new Map() };
      this.sessions.set(key, state);
    }
    return state;
  }

  entityRef(state, nativeRef) {
    let ref = state.entities.get(nativeRef);
    if (!ref) {
      ref = `entity:${this.idFactory()}`;
      state.entities.set(nativeRef, ref);
    }
    return ref;
  }

  retainEntities(state, nativeRefs) {
    const retained = new Set(nativeRefs);
    for (const nativeRef of state.entities.keys()) {
      if (!retained.has(nativeRef)) state.entities.delete(nativeRef);
    }
  }

  frameRef(state, nativeRef) {
    if (!nativeRef) return null;
    let ref = state.frames.get(nativeRef);
    if (!ref) {
      ref = `frame:${this.idFactory()}`;
      state.frames.set(nativeRef, ref);
    }
    return ref;
  }

  snapshot(sessionRef) {
    const state = this.sessions.get(sessionKey(sessionRef));
    return state ? { documentEpoch: state.documentEpoch,
      entities: new Map(state.entities), frames: new Map(state.frames) } : null;
  }

  restore(sessionRef, snapshot) {
    const key = sessionKey(sessionRef);
    if (!snapshot) this.sessions.delete(key);
    else this.sessions.set(key, { documentEpoch: snapshot.documentEpoch,
      entities: new Map(snapshot.entities), frames: new Map(snapshot.frames) });
  }

  dropSession(sessionRef) { this.sessions.delete(sessionKey(sessionRef)); }
  close() { this.sessions.clear(); }
}

export { sessionKey as perceptionSessionKey };
