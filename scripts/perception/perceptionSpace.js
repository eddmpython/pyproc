// perceptionSpace.js - provider facts를 identity, timeline, query, visual, evidence-ready APX graph로 만든다.
import {
  APX_MAX_BUDGET,
  APX_REPRESENTATION,
  APX_VERSION,
  assertApxObservation,
  assertApxVisualProbe,
  inspectApxConformance,
  validatePerceptionOptions,
} from "./apxCatalog.js";
import { apxDigest } from "./apxCanonical.js";
import { completeActionReissue, prepareActionReissue } from "./actionReissuer.js";
import { CapabilityProjector } from "./capabilityProjector.js";
import { applyPerceptionBudget } from "./perceptionBudget.js";
import { PerceptionIdentity, perceptionSessionKey } from "./perceptionIdentity.js";
import { queryPerceptionEntities } from "./perceptionQuery.js";
import { PerceptionTimeline } from "./perceptionTimeline.js";
import { evaluateRequirementCandidates } from "./requirementCandidateEvaluator.js";
import { SituationCompiler } from "./situationCompiler.js";
import { APX_SITUATION_PROFILE, APX_SITUATION_REPRESENTATION } from "./situationCatalog.js";
import { WorldModel } from "./worldModel.js";

function frozenObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze({ ...value });
}

function normalizedEpoch(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function publicRef(value, prefix) {
  const text = String(value || "");
  if (new RegExp(`^${prefix}:[A-Za-z0-9._:-]{1,128}$`, "u").test(text)) return text;
  return `${prefix}:${apxDigest(text).slice(0, 32)}`;
}

function publicStructure(structure, identityState, identity) {
  const output = {};
  if (structure?.nodeName) output.nodeName = String(structure.nodeName).slice(0, 80);
  const frameRef = identity.frameRef(identityState, structure?.frameNativeRef);
  if (frameRef) output.frameRef = frameRef;
  if (structure?.shadowRoot) output.shadowRoot = String(structure.shadowRoot).slice(0, 20);
  return Object.freeze(output);
}

function normalizedEntity(source, entityRef, identityState, identity, locatorRef) {
  const structure = publicStructure(source.structure, identityState, identity);
  return Object.freeze({
    entityRef,
    kind: String(source.kind || "ui.container"),
    ...(source.semantic ? { semantic: frozenObject({ ...source.semantic,
      ...(source.semantic.states ? { states: frozenObject(source.semantic.states) } : {}) }) } : {}),
    ...(Object.keys(structure).length ? { structure } : {}),
    ...(source.geometry ? { geometry: frozenObject({ ...source.geometry,
      ...(source.geometry.rect ? { rect: frozenObject(source.geometry.rect) } : {}) }) } : {}),
    ...(source.interaction ? { interaction: frozenObject({ ...source.interaction,
      supportedActions: Object.freeze([...(source.interaction.supportedActions || [])]),
      reasons: Object.freeze([...(source.interaction.reasons || [])]),
    }) } : {}),
    provenance: frozenObject(Object.fromEntries(Object.entries(source.provenance || {})
      .map(([key, value]) => [key, frozenObject(value)]))),
    ...(locatorRef ? { locatorRef } : {}),
    ...(source.unresolved ? { unresolved: frozenObject(source.unresolved) } : {}),
  });
}

function selectEntityChannels(entity, channels) {
  const selected = { entityRef: entity.entityRef, kind: entity.kind, provenance: entity.provenance };
  for (const channel of ["semantic", "structure", "geometry", "interaction"]) {
    if (channels.includes(channel) && entity[channel] !== undefined) selected[channel] = entity[channel];
  }
  if (entity.temporal) selected.temporal = entity.temporal;
  if (entity.locatorRef) selected.locatorRef = entity.locatorRef;
  if (entity.unresolved) selected.unresolved = entity.unresolved;
  return Object.freeze(selected);
}

function artifactRefOf(probe) {
  const ref = probe?.artifact?.artifactRef;
  return typeof ref === "string" ? ref : null;
}

function postconditionEntityQuery(query) {
  if (query.kind === "entityState") return Object.freeze({ entityRef: query.entityRef });
  return Object.freeze({
    ...(query.role ? { role: query.role } : {}),
    ...(query.name ? { name: query.name } : {}),
  });
}

function withoutTemporal(entity) {
  const { temporal, ...body } = entity;
  return Object.freeze(body);
}

function normalizedPage(page = {}) {
  return Object.freeze({
    url: String(page.url || "[redacted-url]").slice(0, 10000),
    title: String(page.title || "").slice(0, 500),
    viewport: frozenObject(page.viewport || { width: 0, height: 0, scale: 1 }),
    scroll: frozenObject(page.scroll || { x: 0, y: 0 }),
    ...(page.environment ? { environment: frozenObject(page.environment) } : {}),
    ...(page.focusedNativeRef ? {} : {}),
  });
}

export class PerceptionSpace {
  constructor({ sensor, idFactory = () => crypto.randomUUID(), locatorIssuer = null,
    locatorReset = null, visualProbe = null, visualRelease = null, now = () => Date.now(), timelineLimit = 32,
    providerKind = "nativeCdp", conformanceLevel = "L4", capabilityPolicy = () => null,
    subscriptions = false, inference = false, reportedCapabilities = false,
    nativeWebMcp = "unsupported" } = {}) {
    if (!sensor || typeof sensor.capture !== "function") throw new TypeError("PerceptionSpace sensor is required");
    if (typeof idFactory !== "function" || typeof now !== "function") throw new TypeError("PerceptionSpace factories are invalid");
    if (locatorIssuer !== null && typeof locatorIssuer !== "function") throw new TypeError("PerceptionSpace locatorIssuer is invalid");
    if (locatorReset !== null && typeof locatorReset !== "function") throw new TypeError("PerceptionSpace locatorReset is invalid");
    if (visualProbe !== null && typeof visualProbe !== "function") throw new TypeError("PerceptionSpace visualProbe is invalid");
    if (visualRelease !== null && typeof visualRelease !== "function") throw new TypeError("PerceptionSpace visualRelease is invalid");
    if (typeof capabilityPolicy !== "function") throw new TypeError("PerceptionSpace capabilityPolicy is invalid");
    this.sensor = sensor;
    this.idFactory = idFactory;
    this.locatorIssuer = locatorIssuer;
    this.locatorReset = locatorReset;
    this.visualProbe = visualProbe;
    this.visualRelease = visualRelease;
    this.now = now;
    this.providerKind = providerKind;
    this.conformanceLevel = conformanceLevel;
    this.providerFeatures = Object.freeze({ subscriptions, inference, reportedCapabilities, nativeWebMcp });
    this.identity = new PerceptionIdentity({ idFactory });
    this.timeline = new PerceptionTimeline({ limit: timelineLimit });
    this.worldModel = new WorldModel({ limit: timelineLimit });
    this.capabilityProjector = new CapabilityProjector({ authorize: capabilityPolicy, now });
    this.situationCompiler = new SituationCompiler({ capabilityProjector: this.capabilityProjector, now });
    this.situations = new Map();
    this.situationHistory = new Map();
    this.turns = new Map();
    this.observations = 0;
  }

  observe(sessionRef, input = {}, context = {}) {
    const key = perceptionSessionKey(sessionRef);
    const previous = this.turns.get(key) || Promise.resolve();
    let releaseTurn;
    const turn = new Promise((resolve) => { releaseTurn = resolve; });
    const tail = previous.catch(() => {}).then(() => turn);
    this.turns.set(key, tail);
    return previous.catch(() => {}).then(() => this._observe(sessionRef, input, context)).finally(() => {
      releaseTurn();
      if (this.turns.get(key) === tail) this.turns.delete(key);
    });
  }

  async _observe(sessionRef, input = {}, context = {}) {
    const options = validatePerceptionOptions(input);
    const situationRequested = options.representation === APX_SITUATION_REPRESENTATION;
    const conformance = inspectApxConformance({ visual: !!this.visualProbe, providerKind: this.providerKind,
      level: this.conformanceLevel, ...this.providerFeatures });
    if (options.visual.mode !== "off" && !this.visualProbe) {
      const error = new Error("APX visual mode is unavailable in this provider");
      error.code = "APX_VISUAL_PROVIDER_DENIED";
      error.outcome = "notSent";
      error.retryable = false;
      throw error;
    }
    const unsupportedProfile = options.profile.find((profile) => !conformance.profiles.includes(profile));
    if (unsupportedProfile) {
      const error = new Error(`APX profile is unavailable in this provider: ${unsupportedProfile}`);
      error.code = "APX_PROFILE_UNSUPPORTED";
      error.outcome = "notSent";
      error.retryable = false;
      throw error;
    }
    if (context.signal?.aborted) throw context.signal.reason || new Error("APX observation cancelled");
    const captureOptions = situationRequested ? Object.freeze({ ...options, budget: APX_MAX_BUDGET }) : options;
    const identitySnapshot = this.identity.snapshot(sessionRef);
    let sensorContext = context;
    if (context.postconditionPlan) {
      const nativeByEntity = new Map([...(identitySnapshot?.entities || new Map())]
        .map(([nativeRef, entityRef]) => [entityRef, nativeRef]));
      const entityQueries = context.postconditionPlan.entityQueries.map((query) => {
        if (!query.entityRef) return query;
        const nativeRef = nativeByEntity.get(query.entityRef);
        const match = /:(\d+)$/u.exec(String(nativeRef || ""));
        return Object.freeze({ ...query,
          ...(match ? { backendNodeId: Number(match[1]) } : { focusedUnsupported: true }) });
      });
      sensorContext = { ...context, postconditionPlan: Object.freeze({ ...context.postconditionPlan,
        entityQueries: Object.freeze(entityQueries) }) };
    }
    const facts = await this.sensor.capture(sessionRef, captureOptions, sensorContext);
    const documentEpoch = normalizedEpoch(facts.documentEpoch);
    const sessionKey = perceptionSessionKey(sessionRef);
    const visualProbes = [];
    const releasedArtifactRefs = new Set();
    let rollbackTimeline = null;
    try {
      const identityState = this.identity.state(sessionRef, documentEpoch);
      if (context.issueLocators !== false) this.locatorReset?.(sessionRef);
      const refByNative = new Map();
      const entities = [];
      for (const source of facts.entities || []) {
        const entityRef = this.identity.entityRef(identityState, source.nativeRef);
        refByNative.set(source.nativeRef, entityRef);
        const locatorRef = context.issueLocators === false || !source.locatorData || !this.locatorIssuer
          ? null : this.locatorIssuer(sessionRef, documentEpoch, source.locatorData);
        entities.push(normalizedEntity(source, entityRef, identityState, this.identity, locatorRef));
      }
      const reportedClaims = (facts.reportedClaims || []).map((claim) => {
        const subjectRef = claim.subjectRef || refByNative.get(claim.subjectNativeRef);
        if (!subjectRef) {
          const error = new Error("reported claim target is outside the observed world");
          error.code = "APX_SCHEMA_INVALID";
          error.outcome = "notSent";
          error.retryable = false;
          throw error;
        }
        const { subjectNativeRef, ...publicClaim } = claim;
        return Object.freeze({ ...publicClaim, subjectRef });
      });
      const focusedEnumeration = facts.enumeration?.entities === "focused";
      if (!focusedEnumeration) this.identity.retainEntities(identityState, refByNative.keys());
      let relations = [];
      const seenRelations = new Set();
      for (const relation of facts.relations || []) {
        const from = refByNative.get(relation.fromNativeRef);
        const to = refByNative.get(relation.toNativeRef);
        if (!from || !to || from === to) continue;
        const key = `${relation.type}:${from}:${to}`;
        if (seenRelations.has(key)) continue;
        seenRelations.add(key);
        relations.push(Object.freeze({ type: String(relation.type), from, to,
          provenance: frozenObject(relation.provenance
            || { mode: "observed", source: "provider", trust: "browser" }) }));
      }
      let sourceEntities = entities;
      if (focusedEnumeration) {
        const previousState = this.timeline.latest(sessionKey);
        if (previousState?.documentEpoch === documentEpoch) {
          const refreshedQueries = context.postconditionPlan.entityQueries.map(postconditionEntityQuery);
          const refreshedRefs = new Set(entities.map((entity) => entity.entityRef));
          const retained = previousState.entities.filter((entity) =>
            !refreshedRefs.has(entity.entityRef)
            && !refreshedQueries.some((query) => queryPerceptionEntities([entity], query, null).length));
          sourceEntities = [...retained.map(withoutTemporal), ...entities];
          const sourceRefs = new Set(sourceEntities.map((entity) => entity.entityRef));
          relations = [...previousState.relations, ...relations].filter((relation) =>
            sourceRefs.has(relation.from) && sourceRefs.has(relation.to));
        }
      }
      const observationRef = `observation:${this.idFactory()}`;
      const committed = this.timeline.commit(sessionKey, documentEpoch, observationRef, sourceEntities, relations);
      const { state } = committed;
      rollbackTimeline = committed.rollback;
      const candidateEvaluations = situationRequested ? evaluateRequirementCandidates(options.focus, state.entities, {
        documentEpoch,
        sourceGraphSha256: state.graphSha256,
        enumeration: facts.enumeration?.entities || "complete",
        droppedCount: Math.max(0, Number(facts.omitted?.entities) || 0),
        continuationSeed: facts.enumeration?.continuationRef || null,
        expiresAt: facts.enumeration?.expiresAt || null,
      }) : null;

      let base = null;
      let resyncRequired = false;
      if (options.since) {
        base = this.timeline.get(sessionKey, options.since);
        if (!base || base.documentEpoch !== documentEpoch) resyncRequired = true;
      }
      const delta = base ? this.timeline.diff(base, state) : null;
      const changedBase = options.query?.changedSince
        ? this.timeline.get(sessionKey, options.query.changedSince) : null;
      const changedDelta = changedBase && changedBase.documentEpoch === documentEpoch
        ? this.timeline.diff(changedBase, state) : null;
      const changedRefs = changedDelta
        ? new Set([...changedDelta.added, ...changedDelta.removed,
          ...changedDelta.changed.map((entry) => entry.entityRef)]) : null;
      if (options.query?.changedSince && !changedRefs) resyncRequired = true;
      const queried = queryPerceptionEntities(state.entities, options.query, changedRefs);
      let selected = queried;
      if (context.postconditionPlan?.entityQueries?.length) {
        selected = Object.freeze([...new Map(context.postconditionPlan.entityQueries.flatMap((query) =>
          queryPerceptionEntities(state.entities, postconditionEntityQuery(query), null))
          .map((entity) => [entity.entityRef, entity])).values()]);
      }
      if (delta && !options.query) {
        const selectedRefs = new Set([...delta.added, ...delta.changed.map((entry) => entry.entityRef)]);
        selected = Object.freeze(state.entities.filter((entity) => selectedRefs.has(entity.entityRef)));
      }
      if (situationRequested) {
        selected = Object.freeze([...new Map(candidateEvaluations.flatMap((evaluation) =>
          evaluation.matchedEntities)
          .map((entity) => [entity.entityRef, entity])).values()]);
      }
      if (options.visual.mode !== "off" && this.visualProbe && options.visual.maxCrops > 0) {
        const visualCandidates = situationRequested
          ? [...new Map(options.focus.requirements.flatMap((requirement) =>
            queryPerceptionEntities(state.entities, requirement.select, null))
            .map((entity) => [entity.entityRef, entity])).values()]
          : selected;
        const unresolved = visualCandidates.filter((entity) => entity.unresolved);
        for (const entity of unresolved) {
          const cropKinds = options.visual.mode === "full" ? ["entityCrop", "contextCrop"] : ["entityCrop"];
          for (const cropKind of cropKinds) {
            if (visualProbes.length >= options.visual.maxCrops) break;
            const probe = await this.visualProbe(sessionRef, entity, options.visual,
              { ...context, page: facts.page, cropKind });
            assertApxVisualProbe(probe);
            visualProbes.push(Object.freeze(probe));
          }
          if (visualProbes.length >= options.visual.maxCrops) break;
        }
        if (options.visual.mode === "full" && options.visual.overview === "lowResolution"
          && visualProbes.length < options.visual.maxCrops) {
          const probe = await this.visualProbe(sessionRef, null, options.visual,
            { ...context, page: facts.page });
          assertApxVisualProbe(probe);
          visualProbes.unshift(Object.freeze(probe));
        }
      }

      selected = Object.freeze(selected.map((entity) => selectEntityChannels(entity, options.channels)));
      const relationRefs = new Set(selected.map((entity) => entity.entityRef));
      const selectedRelations = state.relations.filter((relation) =>
        relationRefs.has(relation.from) && relationRefs.has(relation.to));
      const graphProfile = options.profile.filter((profile) => profile !== APX_SITUATION_PROFILE);
      const payload = {
        protocol: "apx",
        version: APX_VERSION,
        representation: APX_REPRESENTATION,
        profile: graphProfile,
        kind: delta && !resyncRequired ? "delta" : "full",
        spaceRef: publicRef(sessionRef?.spaceId || "space:browser", "space"),
        targetRef: publicRef(sessionRef?.targetRef || "target:opaque", "target"),
        sessionRef: publicRef(sessionRef?.sessionId || "session:opaque", "session"),
        observationRef,
        ...(delta && !resyncRequired ? { baseObservationRef: base.observationRef, delta } : {}),
        documentEpoch,
        capturedAt: new Date(this.now()).toISOString(),
        page: normalizedPage(facts.page),
        channels: options.channels,
        entities: [...selected],
        relations: selectedRelations,
        events: Object.freeze([...(facts.events || [])]),
        ...(facts.eventWindows?.length ? { eventWindows: Object.freeze([...facts.eventWindows]) } : {}),
        unresolved: Object.freeze(selected.filter((entity) => entity.unresolved)
          .map((entity) => Object.freeze({ entityRef: entity.entityRef, ...entity.unresolved }))),
        ...(visualProbes.length ? { visualProbes } : {}),
        completeness: Object.freeze({ ...(facts.completeness || {}),
          ...(context.postconditionPlan?.entityQueries?.length ? {
            entityEnumeration: focusedEnumeration || facts.enumeration?.entities !== "incomplete"
              ? "focusedComplete" : "unknown",
            omittedRelevantCount: 0,
          } : {}),
          visual: options.visual.mode === "off" ? "notRequested" : `${visualProbes.length}-probes` }),
        ...(options.query ? { query: Object.freeze({ matched: queried.length, total: state.entities.length }) } : {}),
        ...(resyncRequired ? { resyncRequired: true } : {}),
        integrity: { canonicalSha256: "0".repeat(64), graphSha256: state.graphSha256 },
      };
      const graphBudget = situationRequested ? APX_MAX_BUDGET : options.budget;
      let bounded = applyPerceptionBudget(payload, graphBudget, facts.omitted);
      const keptArtifacts = new Set((bounded.visualProbes || []).map(artifactRefOf).filter(Boolean));
      for (const probe of visualProbes) {
        const artifactRef = artifactRefOf(probe);
        if (artifactRef && !keptArtifacts.has(artifactRef)) {
          await this.visualRelease?.(probe);
          releasedArtifactRefs.add(artifactRef);
        }
      }
      const digestBody = { ...bounded, integrity: { ...bounded.integrity, canonicalSha256: null } };
      bounded = { ...bounded, integrity: { ...bounded.integrity, canonicalSha256: apxDigest(digestBody) } };
      assertApxObservation(bounded);
      if (situationRequested) {
        const history = this.situationHistory.get(sessionKey) || new Map();
        if (options.focus.changedSince && !history.has(options.focus.changedSince)) {
          const error = new Error("situation history no longer contains focus.changedSince");
          error.code = "APX_RESYNC_REQUIRED";
          error.outcome = "notSent";
          error.retryable = false;
          throw error;
        }
        const prepared = this.worldModel.prepare(sessionKey, bounded,
          { reportedClaims });
        const capsule = this.situationCompiler.compile(prepared.world, options.focus, {
          sessionRef,
          profile: options.profile,
          budget: options.budget,
          visual: options.visual,
          visualProbes: bounded.visualProbes || [],
          candidateEvaluations,
        });
        prepared.commit();
        const priorSituation = this.situations.get(sessionKey);
        if (priorSituation) this.capabilityProjector.dropWorld(priorSituation.worldRef);
        this.capabilityProjector.commit(capsule);
        this.situations.set(sessionKey, capsule);
        history.set(capsule.situationRef, capsule);
        while (history.size > 32) history.delete(history.keys().next().value);
        this.situationHistory.set(sessionKey, history);
        this.observations += 1;
        return capsule;
      }
      this.observations += 1;
      return Object.freeze(bounded);
    } catch (error) {
      rollbackTimeline?.();
      this.identity.restore(sessionRef, identitySnapshot);
      try { if (context.issueLocators !== false) this.locatorReset?.(sessionRef); }
      catch (resetError) { if (!error.cause) error.cause = resetError; }
      for (const probe of visualProbes) {
        const artifactRef = artifactRefOf(probe);
        if (!artifactRef || releasedArtifactRefs.has(artifactRef)) continue;
        try {
          await this.visualRelease?.(probe);
          releasedArtifactRefs.add(artifactRef);
        }
        catch (releaseError) { if (!error.cause) error.cause = releaseError; }
      }
      throw error;
    }
  }

  inspect() {
    return Object.freeze({ ...inspectApxConformance({ visual: !!this.visualProbe, providerKind: this.providerKind,
      level: this.conformanceLevel, ...this.providerFeatures }),
      observations: this.observations });
  }

  async reissueAction(sessionRef, action, context = {}) {
    const key = perceptionSessionKey(sessionRef);
    const prepared = prepareActionReissue(this.situationHistory.get(key), action);
    const refreshed = await this.observe(sessionRef, {
      representation: APX_SITUATION_REPRESENTATION,
      focus: prepared.prior.focus,
      visual: { mode: "off" },
    }, context);
    return completeActionReissue(prepared, refreshed);
  }

  assertActionContext(sessionRef, actionContext, action) {
    const key = perceptionSessionKey(sessionRef);
    const situation = this.situations.get(key);
    const world = this.worldModel.current(key);
    return this.capabilityProjector.assert(actionContext, action, sessionRef, {
      world,
      situationRef: situation?.situationRef,
      now: this.now(),
    });
  }

  dropSession(sessionRef) {
    const key = perceptionSessionKey(sessionRef);
    this.sensor.dropSession?.(sessionRef);
    this.identity.dropSession(sessionRef);
    this.timeline.dropSession(key);
    this.worldModel.dropSession(key);
    this.capabilityProjector.dropSession(sessionRef);
    this.situations.delete(key);
    this.situationHistory.delete(key);
  }

  close() {
    this.sensor.close?.();
    this.identity.close();
    this.timeline.close();
    this.worldModel.close();
    this.capabilityProjector.close();
    this.situations.clear();
    this.situationHistory.clear();
    this.turns.clear();
  }
}
