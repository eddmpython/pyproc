// appSpaceCanonical.js - cooperative logical state와 paired Machine generation의 closed format.
import { createHash } from "node:crypto";
import { canonicalExecutionMemoryJson } from "../executionMemory/executionMemoryCanonical.js";

export const APP_SPACE_FORMAT = "pyproc.pairedAppGeneration";
export const APP_SPACE_VERSION = 1;
export const APP_OUTBOX_STATES = Object.freeze(["staged", "terminal"]);

const DIGEST = /^[0-9a-f]{64}$/;
const ADDRESS = /^sha256:[0-9a-f]{64}$/;
const APP_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/;
const APP_REVISION = /^apprev:[A-Za-z0-9._:-]{1,128}$/;
const PAIR_ID = /^pair:[A-Za-z0-9._:-]{1,96}$/;
const FORBIDDEN_STATE_KEY = /^(password|passwd|token|access[_-]?token|api[_-]?key|cookie|set-cookie|authorization|client[_-]?secret|secret|dom|html|javascriptHeap)$/i;
const IDENTITY_KEYS = new Set(["appId", "origin", "adapterVersion", "stateSchema"]);
const SNAPSHOT_KEYS = new Set(["format", "version", "identity", "revision", "state", "outbox", "scope",
  "stateSha256", "contentSha256"]);
const OUTBOX_KEYS = new Set(["intentSha256", "state", "terminal", "effectReceiptSha256"]);
const PAIR_KEYS = new Set(["format", "version", "pairId", "parentPairSha256", "app", "machine", "session",
  "provenance", "contentSha256"]);
const MACHINE_KEYS = new Set(["checkpointIndex", "imageSha256", "generation", "environment"]);
const SESSION_KEYS = new Set(["executionSessionId", "revisionSha256"]);
const PROVENANCE_KEYS = new Set(["createdAt", "source"]);
const SCOPE = new Set(["router", "form", "domainStore", "declaredRecords", "localOperations", "effectOutbox"]);

export function appSpaceError(code, message, details = null, outcome = "notSent") {
  return Object.assign(new Error(message), { code, details, outcome, retryable: false });
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw appSpaceError("APP_SPACE_INVALID", `${label} must be an object`);
  }
  return value;
}

function exact(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.has(key)) {
    throw appSpaceError("APP_SPACE_INVALID", `${label}.${key} is unknown`);
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) {
    throw appSpaceError("APP_SPACE_INVALID", `${label}.${key} is required`);
  }
}

function bounded(value, label, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw appSpaceError("APP_SPACE_INVALID", `${label} must contain 1 to ${maximum} characters`);
  }
}

export function appSpaceDigest(value) {
  return createHash("sha256").update(canonicalExecutionMemoryJson(value)).digest("hex");
}

function contentAddressed(content) {
  return Object.freeze({ ...content, contentSha256: appSpaceDigest(content) });
}

function assertAddress(value, keys, label) {
  exact(value, keys, label);
  const { contentSha256, ...content } = value;
  if (!DIGEST.test(String(contentSha256 || "")) || appSpaceDigest(content) !== contentSha256) {
    throw appSpaceError("APP_SPACE_MUTATED", `${label} digest does not match its content`);
  }
}

export function validateAppIdentity(value, label = "app identity") {
  exact(value, IDENTITY_KEYS, label);
  let url;
  try { url = new URL(value.origin); } catch (error) {
    throw appSpaceError("APP_SPACE_IDENTITY_INVALID", `${label}.origin is invalid`);
  }
  if (!APP_ID.test(String(value.appId || "")) || !["http:", "https:"].includes(url.protocol)
    || url.origin !== value.origin || url.username || url.password) {
    throw appSpaceError("APP_SPACE_IDENTITY_INVALID", `${label} is invalid`);
  }
  bounded(value.adapterVersion, `${label}.adapterVersion`, 64);
  bounded(value.stateSchema, `${label}.stateSchema`, 128);
  return value;
}

function scanState(value, secrets, path = "state", depth = 0, budget = { items: 0 }) {
  if (depth > 24 || ++budget.items > 100000) {
    throw appSpaceError("APP_SPACE_STATE_LIMIT", "logical state exceeds the structural limit");
  }
  if (typeof value === "string") {
    for (const secret of secrets) if (secret && value.includes(secret)) {
      throw appSpaceError("APP_SPACE_SECRET", `${path} contains configured secret material`);
    }
    return;
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) scanState(value[index], secrets, `${path}[${index}]`, depth + 1, budget);
    return;
  }
  plain(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_STATE_KEY.test(key)) throw appSpaceError("APP_SPACE_SECRET", `${path}.${key} is forbidden`);
    scanState(child, secrets, `${path}.${key}`, depth + 1, budget);
  }
}

function validateOutbox(value) {
  if (!Array.isArray(value) || value.length > 64) throw appSpaceError("APP_SPACE_OUTBOX_INVALID", "outbox exceeds its limit");
  const seen = new Set();
  for (const entry of value) {
    exact(entry, OUTBOX_KEYS, "outbox entry");
    if (!DIGEST.test(String(entry.intentSha256 || "")) || seen.has(entry.intentSha256)
      || !APP_OUTBOX_STATES.includes(entry.state)
      || (entry.terminal !== null && !["confirmed", "contradicted", "ambiguous", "notObserved", "outcomeUnknown"].includes(entry.terminal))
      || (entry.effectReceiptSha256 !== null && !DIGEST.test(String(entry.effectReceiptSha256)))) {
      throw appSpaceError("APP_SPACE_OUTBOX_INVALID", "outbox entry is invalid");
    }
    if (entry.state === "staged" && (entry.terminal !== null || entry.effectReceiptSha256 !== null)) {
      throw appSpaceError("APP_SPACE_OUTBOX_INVALID", "staged effect cannot carry a terminal receipt");
    }
    if (entry.state === "terminal" && entry.terminal === null) {
      throw appSpaceError("APP_SPACE_OUTBOX_INVALID", "terminal effect requires its outcome");
    }
    seen.add(entry.intentSha256);
  }
}

export function createAppStateSnapshot({ identity, revision, state, outbox = [], scope = [] }, {
  secretValues = [], maxStateBytes = 1024 * 1024,
} = {}) {
  validateAppIdentity(identity);
  if (!APP_REVISION.test(String(revision || ""))) throw appSpaceError("APP_SPACE_REVISION_INVALID", "app revision is invalid");
  if (!Array.isArray(scope) || scope.length < 1 || scope.some((entry) => !SCOPE.has(entry))
    || new Set(scope).size !== scope.length) throw appSpaceError("APP_SPACE_SCOPE_INVALID", "app state scope is invalid");
  scanState(state, secretValues);
  validateOutbox(outbox);
  const encoded = Buffer.from(canonicalExecutionMemoryJson(state));
  if (encoded.byteLength > maxStateBytes) throw appSpaceError("APP_SPACE_STATE_LIMIT", "logical state exceeds maxStateBytes");
  const content = { format: "pyproc.appStateSnapshot", version: 1, identity: structuredClone(identity), revision,
    state: structuredClone(state), outbox: structuredClone(outbox), scope: [...scope], stateSha256: appSpaceDigest(state) };
  return validateAppStateSnapshot(contentAddressed(content), { secretValues, maxStateBytes });
}

export function validateAppStateSnapshot(value, options = {}) {
  assertAddress(value, SNAPSHOT_KEYS, "AppStateSnapshot");
  if (value.format !== "pyproc.appStateSnapshot" || value.version !== 1) throw appSpaceError("APP_SPACE_INVALID", "snapshot envelope is invalid");
  validateAppIdentity(value.identity);
  if (!APP_REVISION.test(String(value.revision || "")) || !DIGEST.test(String(value.stateSha256 || ""))
    || appSpaceDigest(value.state) !== value.stateSha256) throw appSpaceError("APP_SPACE_MUTATED", "snapshot state digest differs");
  scanState(value.state, options.secretValues || []);
  validateOutbox(value.outbox);
  if (!Array.isArray(value.scope) || value.scope.length < 1 || value.scope.some((entry) => !SCOPE.has(entry))) {
    throw appSpaceError("APP_SPACE_SCOPE_INVALID", "snapshot scope is invalid");
  }
  if (Buffer.byteLength(canonicalExecutionMemoryJson(value.state)) > (options.maxStateBytes || 1024 * 1024)) {
    throw appSpaceError("APP_SPACE_STATE_LIMIT", "snapshot state exceeds maxStateBytes");
  }
  return value;
}

export function createPairedGeneration({ pairId, parentPairSha256 = null, app, machine, session, createdAt, source }) {
  const content = { format: APP_SPACE_FORMAT, version: APP_SPACE_VERSION, pairId, parentPairSha256,
    app: structuredClone(app), machine: structuredClone(machine), session: structuredClone(session),
    provenance: { createdAt, source } };
  return validatePairedGeneration(contentAddressed(content));
}

export function validatePairedGeneration(value) {
  assertAddress(value, PAIR_KEYS, "PairedGeneration");
  exact(value.machine, MACHINE_KEYS, "PairedGeneration.machine");
  exact(value.session, SESSION_KEYS, "PairedGeneration.session");
  exact(value.provenance, PROVENANCE_KEYS, "PairedGeneration.provenance");
  if (value.format !== APP_SPACE_FORMAT || value.version !== APP_SPACE_VERSION || !PAIR_ID.test(String(value.pairId || ""))
    || (value.parentPairSha256 !== null && !DIGEST.test(String(value.parentPairSha256)))) {
    throw appSpaceError("APP_SPACE_INVALID", "paired generation envelope is invalid");
  }
  validateAppStateSnapshot(value.app);
  if (!Number.isInteger(value.machine.checkpointIndex) || value.machine.checkpointIndex < 0
    || !DIGEST.test(String(value.machine.imageSha256 || "")) || !ADDRESS.test(String(value.machine.generation || ""))
    || !DIGEST.test(String(value.machine.environment || ""))) throw appSpaceError("APP_SPACE_MACHINE_INVALID", "Machine link is invalid");
  if (!/^session:[A-Za-z0-9._:-]{1,96}$/.test(String(value.session.executionSessionId || ""))
    || !DIGEST.test(String(value.session.revisionSha256 || ""))) throw appSpaceError("APP_SPACE_SESSION_INVALID", "Execution Session link is invalid");
  if (typeof value.provenance.source !== "string" || !value.provenance.source || value.provenance.source.length > 128
    || !Number.isFinite(Date.parse(value.provenance.createdAt))) throw appSpaceError("APP_SPACE_INVALID", "provenance is invalid");
  return value;
}

export function pairedGenerationBytes(value) {
  const { contentSha256: _contentSha256, ...content } = value;
  return Buffer.from(canonicalExecutionMemoryJson(content));
}
