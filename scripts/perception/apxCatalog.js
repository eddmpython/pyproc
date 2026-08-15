// apxCatalog.js - APX v1 vocabulary, input limits, conformance, strict validation의 SSOT.
import { createHash } from "node:crypto";
import { apxDigest } from "./apxCanonical.js";
import { isApxUnresolvedReason } from "./unresolvedVocabulary.js";
import {
  APX_FOCUS_SCHEMA,
  APX_SITUATION_PROFILE,
  APX_SITUATION_REPRESENTATION,
  validateSituationFocus,
} from "./situationCatalog.js";

export const APX_REPRESENTATION = "apx.graph";
export const APX_LEGACY_REPRESENTATION = "legacy.ax-list";
export const APX_VERSION = "1.0";
export const APX_GRAPH_PROFILES = Object.freeze(["apx-core/1", "apx-web/1", "apx-action/1", "apx-visual/1"]);
export const APX_PROFILES = Object.freeze([...APX_GRAPH_PROFILES, APX_SITUATION_PROFILE]);
export const APX_REPRESENTATIONS = Object.freeze([APX_REPRESENTATION, APX_SITUATION_REPRESENTATION]);
export const APX_CHANNELS = Object.freeze([
  "semantic", "structure", "geometry", "interaction", "events", "networkMetadata", "environment", "visual",
]);
export const APX_DEFAULT_CHANNELS = Object.freeze([
  "semantic", "structure", "geometry", "interaction", "events", "networkMetadata",
]);
export const APX_VISUAL_MODES = Object.freeze(["off", "auto", "full"]);
export const APX_DEFAULT_BUDGET = Object.freeze({ maxEntities: 120, maxRelations: 300, maxBytes: 65536 });
export const APX_MAX_BUDGET = Object.freeze({ maxEntities: 1000, maxRelations: 3000, maxBytes: 1024 * 1024 });

export const APX_ERROR_CODES = Object.freeze({
  schemaInvalid: "APX_SCHEMA_INVALID",
  profileUnsupported: "APX_PROFILE_UNSUPPORTED",
  observationStale: "APX_OBSERVATION_STALE",
  entityNotFound: "APX_ENTITY_NOT_FOUND",
  entityEpochMismatch: "APX_ENTITY_EPOCH_MISMATCH",
  locatorStale: "APX_LOCATOR_STALE",
  budgetExceeded: "APX_BUDGET_EXCEEDED",
  resyncRequired: "APX_RESYNC_REQUIRED",
  visualProviderDenied: "APX_VISUAL_PROVIDER_DENIED",
  verificationAmbiguous: "APX_VERIFICATION_AMBIGUOUS",
  replayDiverged: "APX_REPLAY_DIVERGED",
  artifactIntegrityFailed: "APX_ARTIFACT_INTEGRITY_FAILED",
  capabilityStale: "APX_CAPABILITY_STALE",
});

const OBSERVATION_REF_RE = /^observation:[A-Za-z0-9_-]{1,128}$/;
const ENTITY_REF_RE = /^entity:[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_REF_RE = /^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9._:-]{1,128}$/;
const LOCATOR_REF_RE = /^locator:[A-Za-z0-9._:-]{1,256}$/;
const ARTIFACT_REF_RE = /^artifact:[A-Za-z0-9_-]+$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = new Set(["representation", "profile", "since", "query", "focus", "visual", "budget", "channels"]);
const QUERY_KEYS = new Set(["entityRef", "kind", "role", "name", "state", "actionable", "changedSince"]);
const OBSERVATION_KEYS = new Set(["protocol", "version", "representation", "profile", "kind", "spaceRef",
  "targetRef", "sessionRef", "observationRef", "baseObservationRef", "documentEpoch", "capturedAt", "page",
  "channels", "entities", "relations", "events", "delta", "unresolved", "visualProbes", "completeness",
  "eventWindows", "query", "resyncRequired", "budget", "integrity"]);
const ENTITY_KEYS = new Set(["entityRef", "kind", "semantic", "structure", "geometry", "interaction",
  "temporal", "provenance", "locatorRef", "unresolved"]);
const RELATION_KEYS = new Set(["type", "from", "to", "provenance"]);
const VISUAL_PROBE_KEYS = new Set(["kind", "entityRef", "reason", "artifact", "provenance"]);
const PROVENANCE_MODES = new Set(["observed", "derived", "inferred", "reported"]);
const PROVENANCE_TRUST = new Set(["broker", "browser", "page", "model", "external"]);

export const APX_OBSERVE_OPTION_KEYS = Object.freeze([...TOP_LEVEL_KEYS]);

export const APX_OBSERVE_PROPERTIES = Object.freeze({
  representation: { type: "string", enum: [...APX_REPRESENTATIONS, APX_LEGACY_REPRESENTATION] },
  profile: { type: "array", items: { type: "string", enum: APX_PROFILES }, uniqueItems: true, minItems: 1, maxItems: 5 },
  since: { type: "string", pattern: "^observation:[A-Za-z0-9_-]{1,128}$" },
  channels: { type: "array", items: { type: "string", enum: APX_CHANNELS }, uniqueItems: true, minItems: 1, maxItems: 8 },
  query: {
    type: "object",
    properties: {
      entityRef: { type: "string", pattern: "^entity:[A-Za-z0-9_-]{1,128}$" },
      kind: { type: "string", minLength: 1, maxLength: 80 },
      role: { type: "string", minLength: 1, maxLength: 80 },
      name: {
        oneOf: [
          { type: "string", maxLength: 300 },
          { type: "object", properties: {
            exact: { type: "string", maxLength: 300 }, prefix: { type: "string", maxLength: 300 },
            contains: { type: "string", maxLength: 300 }, token: { type: "string", maxLength: 100 },
            regex: { type: "string", maxLength: 100 },
          }, additionalProperties: false },
        ],
      },
      state: { type: "object", additionalProperties: true },
      actionable: { type: "boolean" },
      changedSince: { type: "string", pattern: "^observation:[A-Za-z0-9_-]{1,128}$" },
    },
    additionalProperties: false,
  },
  focus: APX_FOCUS_SCHEMA,
  visual: {
    type: "object",
    properties: {
      mode: { type: "string", enum: APX_VISUAL_MODES },
      overview: { type: "string", enum: ["none", "lowResolution"] },
      maxCrops: { type: "integer", minimum: 0, maximum: 8 },
    },
    additionalProperties: false,
  },
  budget: {
    type: "object",
    properties: {
      maxEntities: { type: "integer", minimum: 1, maximum: APX_MAX_BUDGET.maxEntities },
      maxRelations: { type: "integer", minimum: 0, maximum: APX_MAX_BUDGET.maxRelations },
      maxBytes: { type: "integer", minimum: 4096, maximum: APX_MAX_BUDGET.maxBytes },
    },
    additionalProperties: false,
  },
});

const WITHIN_MS_SCHEMA = Object.freeze({ type: "integer", minimum: 1, maximum: 30000 });

function postconditionSchema(depth = 0) {
  const time = depth === 0 ? { withinMs: WITHIN_MS_SCHEMA } : {};
  const variants = [
    {
      type: "object",
      properties: { entityAppeared: { type: "object", properties: {
        role: { type: "string", minLength: 1, maxLength: 300 },
        name: { type: "string", minLength: 1, maxLength: 300 },
        nameContains: { type: "string", minLength: 1, maxLength: 300 },
      }, minProperties: 1, additionalProperties: false }, ...time },
      required: ["entityAppeared"], additionalProperties: false,
    },
    {
      type: "object",
      properties: { entityState: { type: "object", properties: {
        entityRef: { type: "string", pattern: "^entity:[A-Za-z0-9_-]{1,128}$" },
        disabled: { type: "boolean" }, checked: { type: "boolean" }, selected: { type: "boolean" },
        expanded: { type: "boolean" }, value: { type: ["string", "number", "boolean"] },
      }, required: ["entityRef"], minProperties: 2, additionalProperties: false }, ...time },
      required: ["entityState"], additionalProperties: false,
    },
    {
      type: "object",
      properties: { networkResponse: { type: "object", properties: {
        method: { type: "string", pattern: "^[A-Z]{1,20}$" },
        urlPath: { type: "string", pattern: "^/[^?#]{0,1999}$" },
        status: { type: "integer", minimum: 100, maximum: 599 },
      }, minProperties: 1, additionalProperties: false }, ...time },
      required: ["networkResponse"], additionalProperties: false,
    },
  ];
  if (depth < 4) {
    for (const group of ["all", "any"]) variants.push({
      type: "object",
      properties: { [group]: { type: "array", minItems: 1, maxItems: 8, items: postconditionSchema(depth + 1) }, ...time },
      required: [group], additionalProperties: false,
    });
  }
  return Object.freeze({ oneOf: Object.freeze(variants.map(Object.freeze)) });
}

export const APX_POSTCONDITION_SCHEMA = postconditionSchema();

function apxError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function fail(message) {
  throw apxError(APX_ERROR_CODES.schemaInvalid, message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function exactKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${label} does not accept ${key}`);
}

function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function stringArray(value, allowed, label, maximum) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum
    || value.some((entry) => typeof entry !== "string" || !allowed.includes(entry))
    || new Set(value).size !== value.length) fail(`${label} is invalid`);
}

function validateNameMatch(value) {
  if (typeof value === "string") {
    if (value.length > 300) fail("query.name is too long");
    return;
  }
  plainObject(value, "query.name");
  const keys = new Set(["exact", "prefix", "contains", "token", "regex"]);
  exactKeys(value, keys, "query.name");
  if (Object.keys(value).length !== 1) fail("query.name requires exactly one matcher");
  const [key] = Object.keys(value);
  const limit = key === "token" || key === "regex" ? 100 : 300;
  if (typeof value[key] !== "string" || value[key].length > limit) fail(`query.name.${key} is invalid`);
  if (key === "regex") {
    if (/\\[1-9]|\(\?|\([^)]*[+*{][^)]*\)[+*{]|[+*?}][+*?{]/u.test(value.regex)) {
      fail("query.name.regex uses an unsafe construct");
    }
    try { new RegExp(value.regex, "u"); }
    catch (error) { fail("query.name.regex is invalid"); }
  }
}

function validateQuery(query) {
  plainObject(query, "query");
  exactKeys(query, QUERY_KEYS, "query");
  if (query.entityRef !== undefined && !ENTITY_REF_RE.test(query.entityRef)) fail("query.entityRef is invalid");
  for (const key of ["kind", "role"]) {
    if (query[key] !== undefined && (typeof query[key] !== "string" || !query[key] || query[key].length > 80)) {
      fail(`query.${key} is invalid`);
    }
  }
  if (query.name !== undefined) validateNameMatch(query.name);
  if (query.state !== undefined) {
    plainObject(query.state, "query.state");
    if (Object.keys(query.state).length > 16) fail("query.state has too many entries");
  }
  if (query.actionable !== undefined && typeof query.actionable !== "boolean") fail("query.actionable must be boolean");
  if (query.changedSince !== undefined && !OBSERVATION_REF_RE.test(query.changedSince)) fail("query.changedSince is invalid");
}

export function validatePerceptionOptions(input = {}) {
  plainObject(input, "APX observation options");
  exactKeys(input, TOP_LEVEL_KEYS, "APX observation options");
  const representation = input.representation || APX_REPRESENTATION;
  if (!APX_REPRESENTATIONS.includes(representation)) {
    fail(`APX observation representation is unsupported: ${representation}`);
  }
  if (input.profile !== undefined) stringArray(input.profile, APX_PROFILES, "profile", APX_PROFILES.length);
  if (input.profile !== undefined && (!input.profile.includes("apx-core/1") || !input.profile.includes("apx-web/1"))) {
    fail("profile requires apx-core/1 and apx-web/1");
  }
  if (representation === APX_REPRESENTATION && input.profile?.includes(APX_SITUATION_PROFILE)) {
    fail("apx.graph does not accept the situation profile");
  }
  if (representation === APX_REPRESENTATION && input.focus !== undefined) fail("apx.graph does not accept focus");
  if (representation === APX_SITUATION_REPRESENTATION) {
    if (input.since !== undefined || input.query !== undefined) {
      fail("apx.situation uses focus and does not accept graph since or query");
    }
    validateSituationFocus(input.focus);
    if (input.profile !== undefined && !input.profile.includes(APX_SITUATION_PROFILE)) {
      fail(`apx.situation profile requires ${APX_SITUATION_PROFILE}`);
    }
  }
  if (input.channels !== undefined) stringArray(input.channels, APX_CHANNELS, "channels", APX_CHANNELS.length);
  if (input.since !== undefined && !OBSERVATION_REF_RE.test(input.since)) fail("since is invalid");
  if (input.query !== undefined) validateQuery(input.query);
  if (input.visual !== undefined) {
    plainObject(input.visual, "visual");
    exactKeys(input.visual, new Set(["mode", "overview", "maxCrops"]), "visual");
    if (input.visual.mode !== undefined && !APX_VISUAL_MODES.includes(input.visual.mode)) fail("visual.mode is invalid");
    if (input.visual.overview !== undefined && !["none", "lowResolution"].includes(input.visual.overview)) {
      fail("visual.overview is invalid");
    }
    if (input.visual.maxCrops !== undefined) integer(input.visual.maxCrops, "visual.maxCrops", 0, 8);
  }
  if (input.budget !== undefined) {
    plainObject(input.budget, "budget");
    exactKeys(input.budget, new Set(["maxEntities", "maxRelations", "maxBytes"]), "budget");
    if (input.budget.maxEntities !== undefined) integer(input.budget.maxEntities, "budget.maxEntities", 1, APX_MAX_BUDGET.maxEntities);
    if (input.budget.maxRelations !== undefined) integer(input.budget.maxRelations, "budget.maxRelations", 0, APX_MAX_BUDGET.maxRelations);
    if (input.budget.maxBytes !== undefined) integer(input.budget.maxBytes, "budget.maxBytes", 4096, APX_MAX_BUDGET.maxBytes);
  }
  const visual = Object.freeze({ mode: input.visual?.mode || "off", overview: input.visual?.overview || "none",
    maxCrops: input.visual?.maxCrops ?? 4 });
  const profile = [...(input.profile || ["apx-core/1", "apx-web/1",
    ...(representation === APX_SITUATION_REPRESENTATION ? [APX_SITUATION_PROFILE] : [])])];
  if (visual.mode !== "off" && !profile.includes("apx-visual/1")) profile.push("apx-visual/1");
  const channels = [...(input.channels || APX_DEFAULT_CHANNELS)];
  if (visual.mode !== "off" && !channels.includes("visual")) channels.push("visual");
  return Object.freeze({
    representation,
    profile: Object.freeze(profile),
    channels: Object.freeze(channels),
    ...(input.since ? { since: input.since } : {}),
    ...(input.query ? { query: Object.freeze({ ...input.query }) } : {}),
    ...(input.focus ? { focus: validateSituationFocus(input.focus) } : {}),
    visual,
    budget: Object.freeze({ ...APX_DEFAULT_BUDGET, ...(input.budget || {}) }),
  });
}

export function perceptionOptionsFromInput(input = {}) {
  const selected = {};
  for (const key of APX_OBSERVE_OPTION_KEYS) if (input[key] !== undefined) selected[key] = input[key];
  return selected;
}

export function inspectApxConformance({ visual = true, providerKind = "nativeCdp", level = "L4",
  subscriptions = false, inference = false, reportedCapabilities = false,
  nativeWebMcp = "unsupported" } = {}) {
  const levelNumber = Number(level.slice(1));
  const profiles = ["apx-core/1", "apx-web/1"];
  if (levelNumber >= 4) profiles.push("apx-action/1");
  if (visual) profiles.push("apx-visual/1");
  profiles.push(APX_SITUATION_PROFILE);
  return Object.freeze({
    name: "APX",
    version: APX_VERSION,
    representation: APX_REPRESENTATION,
    representations: APX_REPRESENTATIONS,
    providerKind,
    profiles: Object.freeze(profiles),
    channels: APX_CHANNELS,
    visualModes: Object.freeze(visual ? [...APX_VISUAL_MODES] : ["off"]),
    delta: true,
    query: true,
    subscriptions,
    situation: true,
    inference,
    reportedCapabilities,
    nativeWebMcp,
    level,
    conformance: Object.freeze(["L0", "L1", "L2", "L3", "L4"].slice(0, levelNumber + 1)),
  });
}

export function assertApxObservation(value) {
  plainObject(value, "APX observation");
  exactKeys(value, OBSERVATION_KEYS, "APX observation");
  if (value.protocol !== "apx" || value.version !== APX_VERSION || value.representation !== APX_REPRESENTATION
    || !["full", "delta"].includes(value.kind)
    || !OPAQUE_REF_RE.test(String(value.spaceRef || ""))
    || !OPAQUE_REF_RE.test(String(value.targetRef || ""))
    || !OPAQUE_REF_RE.test(String(value.sessionRef || ""))
    || !OBSERVATION_REF_RE.test(String(value.observationRef || ""))
    || !Number.isInteger(value.documentEpoch) || value.documentEpoch < 0
    || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))
    || !plainObjectForCheck(value.page)
    || !Array.isArray(value.profile) || !Array.isArray(value.entities) || !Array.isArray(value.relations)
    || !Array.isArray(value.events) || !Array.isArray(value.unresolved)
    || !plainObjectForCheck(value.completeness)
    || !plainObjectForCheck(value.budget) || !plainObjectForCheck(value.integrity)
    || !DIGEST_RE.test(String(value.integrity.canonicalSha256 || ""))
    || !DIGEST_RE.test(String(value.integrity.graphSha256 || ""))) fail("APX observation envelope is invalid");
  stringArray(value.profile, APX_GRAPH_PROFILES, "APX observation profile", APX_GRAPH_PROFILES.length);
  if (!value.profile.includes("apx-core/1") || !value.profile.includes("apx-web/1")) {
    fail("APX observation profile requires core and web");
  }
  stringArray(value.channels, APX_CHANNELS, "APX observation channels", APX_CHANNELS.length);
  if (value.kind === "full" && (value.baseObservationRef !== undefined || value.delta !== undefined)) {
    fail("APX full observation cannot carry delta state");
  }
  if (value.kind === "delta" && (!OBSERVATION_REF_RE.test(String(value.baseObservationRef || ""))
    || !plainObjectForCheck(value.delta) || !Array.isArray(value.delta.added)
    || !Array.isArray(value.delta.removed) || !Array.isArray(value.delta.changed))) fail("APX delta is invalid");
  if (value.resyncRequired !== undefined && typeof value.resyncRequired !== "boolean") {
    fail("APX resyncRequired is invalid");
  }
  const entityRefs = new Set();
  for (const entity of value.entities) {
    if (plainObjectForCheck(entity)) exactKeys(entity, ENTITY_KEYS, "APX entity");
    if (!plainObjectForCheck(entity) || !ENTITY_REF_RE.test(String(entity.entityRef || ""))
      || typeof entity.kind !== "string" || !plainObjectForCheck(entity.provenance)) fail("APX entity is invalid");
    if (entityRefs.has(entity.entityRef)) fail("APX entityRef is duplicated");
    entityRefs.add(entity.entityRef);
    if (entity.locatorRef !== undefined && !LOCATOR_REF_RE.test(entity.locatorRef)) fail("APX locatorRef is invalid");
    if (entity.temporal !== undefined && (!plainObjectForCheck(entity.temporal)
      || !OBSERVATION_REF_RE.test(String(entity.temporal.firstSeen || ""))
      || !OBSERVATION_REF_RE.test(String(entity.temporal.lastSeen || ""))
      || !OBSERVATION_REF_RE.test(String(entity.temporal.lastChanged || "")))) fail("APX temporal state is invalid");
    for (const provenance of Object.values(entity.provenance)) assertApxProvenance(provenance);
  }
  const relationKeys = new Set();
  for (const relation of value.relations) {
    if (plainObjectForCheck(relation)) exactKeys(relation, RELATION_KEYS, "APX relation");
    if (!plainObjectForCheck(relation) || typeof relation.type !== "string"
      || !ENTITY_REF_RE.test(String(relation.from || "")) || !ENTITY_REF_RE.test(String(relation.to || ""))) {
      fail("APX relation is invalid");
    }
    if (!entityRefs.has(relation.from) || !entityRefs.has(relation.to)) fail("APX relation endpoint is absent");
    const relationKey = `${relation.type}:${relation.from}:${relation.to}`;
    if (relationKeys.has(relationKey)) fail("APX relation is duplicated");
    relationKeys.add(relationKey);
    assertApxProvenance(relation.provenance);
  }
  if (value.events.some((event) => !plainObjectForCheck(event))) fail("APX event is invalid");
  if (value.eventWindows !== undefined && (!Array.isArray(value.eventWindows)
    || value.eventWindows.some((window) => !plainObjectForCheck(window)
      || !["console", "network"].includes(window.channel)
      || !Number.isInteger(window.startSequence) || window.startSequence < 0
      || !Number.isInteger(window.endSequence) || window.endSequence < window.startSequence
      || !Number.isInteger(window.returnedCount) || window.returnedCount < 0
      || !Number.isInteger(window.droppedBeforeStart) || window.droppedBeforeStart < 0
      || !Number.isInteger(window.droppedWithinWindow) || window.droppedWithinWindow < 0
      || typeof window.complete !== "boolean"))) fail("APX event window is invalid");
  for (const unresolved of value.unresolved) {
    if (!plainObjectForCheck(unresolved) || !entityRefs.has(unresolved.entityRef)
      || !isApxUnresolvedReason(unresolved.reason)) fail("APX unresolved entry is invalid");
  }
  for (const probe of value.visualProbes || []) assertApxVisualProbe(probe);
  if ((value.visualProbes?.length || 0) > 0 && !value.profile.includes("apx-visual/1")) {
    fail("APX visual probe requires the visual profile");
  }
  assertApxBudget(value.budget, value);
  exactKeys(value.integrity, new Set(["canonicalSha256", "graphSha256"]), "APX integrity");
  const digestBody = { ...value, integrity: { ...value.integrity, canonicalSha256: null } };
  if (apxDigest(digestBody) !== value.integrity.canonicalSha256) fail("APX observation digest does not match");
  const forbiddenDriverKeys = new Set(["nativeRef", "locatorData", "frameNativeRef", "fromNativeRef", "toNativeRef",
    "backendNodeId", "backendDOMNodeId", "nodeId", "objectId", "executionContextId"]);
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!plainObjectForCheck(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenDriverKeys.has(key)) fail(`APX observation exposes driver field ${key}`);
      stack.push(child);
    }
  }
  return value;
}

function assertApxProvenance(value) {
  if (!plainObjectForCheck(value)) fail("APX provenance is invalid");
  exactKeys(value, new Set(["mode", "source", "trust"]), "APX provenance");
  if (!PROVENANCE_MODES.has(value.mode) || typeof value.source !== "string" || !value.source
    || !PROVENANCE_TRUST.has(value.trust)) fail("APX provenance is invalid");
}

export function assertApxVisualProbe(value) {
  plainObject(value, "APX visual probe");
  exactKeys(value, VISUAL_PROBE_KEYS, "APX visual probe");
  if (!["entityCrop", "contextCrop", "overview"].includes(value.kind)
    || (["entityCrop", "contextCrop"].includes(value.kind) && !ENTITY_REF_RE.test(String(value.entityRef || "")))
    || (value.kind === "overview" && value.entityRef !== null)
    || typeof value.reason !== "string" || !value.reason
    || !plainObjectForCheck(value.artifact)
    || value.artifact.kind !== "screenshot"
    || typeof value.artifact.mimeType !== "string" || !value.artifact.mimeType.startsWith("image/")
    || !ARTIFACT_REF_RE.test(String(value.artifact.artifactRef || ""))
    || !Number.isInteger(value.artifact.byteLength) || value.artifact.byteLength < 1
    || !DIGEST_RE.test(String(value.artifact.sha256 || ""))) fail("APX visual probe is invalid");
  if (value.artifact.dataBase64 !== undefined) {
    if (typeof value.artifact.dataBase64 !== "string") fail("APX visual artifact base64 is invalid");
    const bytes = Buffer.from(value.artifact.dataBase64, "base64");
    if (bytes.toString("base64") !== value.artifact.dataBase64
      || bytes.byteLength !== value.artifact.byteLength
      || apxDigestBytes(bytes) !== value.artifact.sha256) fail("APX visual artifact integrity is invalid");
  }
  assertApxProvenance(value.provenance);
  if (!["observed", "inferred"].includes(value.provenance.mode) || value.provenance.trust === "broker") {
    fail("APX visual provenance is invalid");
  }
  return value;
}

function apxDigestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertApxBudget(value, observation) {
  exactKeys(value, new Set(["maxEntities", "maxRelations", "maxBytes", "usedBytes", "truncated", "omitted"]),
    "APX budget");
  if (!Number.isInteger(value.maxEntities) || value.maxEntities < 1 || value.maxEntities > APX_MAX_BUDGET.maxEntities
    || !Number.isInteger(value.maxRelations) || value.maxRelations < 0 || value.maxRelations > APX_MAX_BUDGET.maxRelations
    || !Number.isInteger(value.maxBytes) || value.maxBytes < 4096 || value.maxBytes > APX_MAX_BUDGET.maxBytes
    || !Number.isInteger(value.usedBytes) || value.usedBytes < 0 || value.usedBytes > value.maxBytes
    || typeof value.truncated !== "boolean" || !plainObjectForCheck(value.omitted)) fail("APX budget is invalid");
  exactKeys(value.omitted, new Set(["entities", "relations", "visualProbes"]), "APX budget omitted");
  if (Object.values(value.omitted).some((count) => !Number.isInteger(count) || count < 0)
    || value.truncated !== Object.values(value.omitted).some((count) => count > 0)
    || Buffer.byteLength(JSON.stringify(observation)) !== value.usedBytes) fail("APX budget accounting is invalid");
}

function plainObjectForCheck(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
