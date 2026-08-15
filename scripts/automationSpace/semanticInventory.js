// semanticInventory.js - 한 관찰 epoch의 의미 node를 유한 page와 검증 가능한 digest로 고정한다.

export const SEMANTIC_INVENTORY_PROTOCOL = "pyproc.semanticInventory";
export const SEMANTIC_INVENTORY_VERSION = 1;
export const SEMANTIC_INVENTORY_MAX_ITEMS = 10000;
export const SEMANTIC_INVENTORY_MAX_BYTES = 16 * 1024 * 1024;
export const SEMANTIC_INVENTORY_MAX_PAGE_ITEMS = 1000;
export const SEMANTIC_INVENTORY_TTL_MS = 5 * 60 * 1000;

export const SEMANTIC_INVENTORY_ERROR_CODES = Object.freeze({
  continuationInvalid: "AUTOMATION_OBSERVATION_CONTINUATION_INVALID",
  continuationExpired: "AUTOMATION_OBSERVATION_CONTINUATION_EXPIRED",
  continuationStale: "AUTOMATION_OBSERVATION_CONTINUATION_STALE",
  inventoryTooLarge: "AUTOMATION_OBSERVATION_INVENTORY_TOO_LARGE",
});

const CONTINUATION_PATTERN = /^continuation:[A-Za-z0-9_-]+$/u;

export function createSemanticInventoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function canonicalValue(value, depth = 0) {
  if (depth > 64) throw new TypeError("semantic inventory value nesting exceeds 64");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("semantic inventory numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, depth + 1));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("semantic inventory values must be plain JSON values");
  }
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`semantic inventory value is undefined: ${key}`);
    output[key] = canonicalValue(value[key], depth + 1);
  }
  return output;
}

export function canonicalSemanticInventoryJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function immutableJson(value) {
  const clone = JSON.parse(canonicalSemanticInventoryJson(value));
  const freeze = (candidate) => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return candidate;
    for (const child of Object.values(candidate)) freeze(child);
    return Object.freeze(candidate);
  };
  return freeze(clone);
}

function encodedBytes(value) {
  return new TextEncoder().encode(canonicalSemanticInventoryJson(value));
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", encodedBytes(value));
  return hex(new Uint8Array(digest));
}

function opaquePart(value) {
  const part = String(value ?? "").replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 160);
  if (!part) throw new TypeError("semantic inventory idFactory returned an invalid identifier");
  return part;
}

function validPageSize(value, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`semantic inventory pageSize must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function evidenceDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  const descriptor = {};
  for (const key of ["kind", "format", "mimeType", "artifactRef", "byteLength", "sha256", "width", "height"]) {
    if (value[key] !== undefined) descriptor[key] = value[key];
  }
  return Object.keys(descriptor).length ? descriptor : null;
}

export async function createSemanticInventoryEvidence(observation = {}, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new TypeError("semantic inventory requires Web Crypto");
  const evidence = {};
  const screenshot = evidenceDescriptor(observation.screenshot);
  if (screenshot) evidence.screenshot = screenshot;
  for (const key of ["console", "network", "eventWindows"]) {
    if (!Array.isArray(observation[key])) continue;
    evidence[key] = Object.freeze({ count: observation[key].length,
      sha256: await sha256(observation[key], cryptoProvider) });
  }
  return immutableJson(evidence);
}

export class SemanticInventory {
  constructor({ idFactory = () => crypto.randomUUID(), now = () => Date.now(),
    cryptoProvider = globalThis.crypto, maxItems = SEMANTIC_INVENTORY_MAX_ITEMS,
    maxBytes = SEMANTIC_INVENTORY_MAX_BYTES, maxPageItems = SEMANTIC_INVENTORY_MAX_PAGE_ITEMS,
    ttlMs = SEMANTIC_INVENTORY_TTL_MS } = {}) {
    if (typeof idFactory !== "function" || typeof now !== "function") {
      throw new TypeError("semantic inventory requires idFactory and clock functions");
    }
    if (!cryptoProvider?.subtle) throw new TypeError("semantic inventory requires Web Crypto");
    for (const [label, value] of [["maxItems", maxItems], ["maxBytes", maxBytes],
      ["maxPageItems", maxPageItems], ["ttlMs", ttlMs]]) {
      if (!Number.isInteger(value) || value < 1) throw new TypeError(`semantic inventory ${label} must be positive`);
    }
    if (maxPageItems > maxItems) throw new TypeError("semantic inventory maxPageItems cannot exceed maxItems");
    this._idFactory = idFactory;
    this._now = now;
    this._crypto = cryptoProvider;
    this._maxItems = maxItems;
    this._maxBytes = maxBytes;
    this._maxPageItems = maxPageItems;
    this._ttlMs = ttlMs;
    this._states = new Map();
    this._tokens = new Map();
    this._sessions = new Map();
  }

  async open({ sessionKey, documentEpoch, snapshotRef, nodes, pageSize, metadata = {}, binding = {}, evidence = {} } = {}) {
    if (typeof sessionKey !== "string" || !sessionKey) throw new TypeError("semantic inventory sessionKey is required");
    if (typeof snapshotRef !== "string" || !snapshotRef) throw new TypeError("semantic inventory snapshotRef is required");
    if (!Array.isArray(nodes)) throw new TypeError("semantic inventory nodes must be an array");
    validPageSize(pageSize, this._maxPageItems);
    if (nodes.length > this._maxItems) {
      throw createSemanticInventoryError(SEMANTIC_INVENTORY_ERROR_CODES.inventoryTooLarge,
        `semantic inventory exceeds ${this._maxItems} items`);
    }
    const canonicalNodes = canonicalSemanticInventoryJson(nodes);
    const byteLength = new TextEncoder().encode(canonicalNodes).byteLength;
    if (byteLength > this._maxBytes) {
      throw createSemanticInventoryError(SEMANTIC_INVENTORY_ERROR_CODES.inventoryTooLarge,
        `semantic inventory exceeds ${this._maxBytes} bytes`);
    }
    this.invalidateSession(sessionKey);
    const frozenNodes = immutableJson(JSON.parse(canonicalNodes));
    const frozenMetadata = immutableJson(metadata);
    const frozenBinding = immutableJson(binding);
    const frozenEvidence = immutableJson(evidence);
    const inventoryRef = `inventory:${opaquePart(this._idFactory())}`;
    const expiresAtMs = this._now() + this._ttlMs;
    const nodesSha256 = await sha256(frozenNodes, this._crypto);
    const bindingSha256 = await sha256(frozenBinding, this._crypto);
    const evidenceSha256 = await sha256(frozenEvidence, this._crypto);
    const receipt = Object.freeze({
      protocol: SEMANTIC_INVENTORY_PROTOCOL,
      version: SEMANTIC_INVENTORY_VERSION,
      inventoryRef,
      snapshotRef,
      documentEpoch,
      ordering: "provider",
      total: frozenNodes.length,
      byteLength,
      nodesSha256,
      bindingSha256,
      evidenceSha256,
    });
    const state = {
      inventoryRef, sessionKey, documentEpoch, epochJson: canonicalSemanticInventoryJson(documentEpoch),
      snapshotRef, nodes: frozenNodes, pageSize, offset: 0, byteLength, metadata: frozenMetadata,
      binding: frozenBinding, evidence: frozenEvidence, nodesSha256, bindingSha256, evidenceSha256,
      receiptSha256: await sha256(receipt, this._crypto), expiresAtMs, tokenRef: null,
    };
    this._states.set(inventoryRef, state);
    this._sessions.set(sessionKey, inventoryRef);
    return this._page(state);
  }

  async continue({ sessionKey, continuationRef, documentEpoch } = {}) {
    if (typeof sessionKey !== "string" || !sessionKey || !CONTINUATION_PATTERN.test(String(continuationRef || ""))) {
      throw createSemanticInventoryError(SEMANTIC_INVENTORY_ERROR_CODES.continuationInvalid,
        "semantic inventory continuation is invalid");
    }
    const inventoryRef = this._tokens.get(continuationRef);
    const state = inventoryRef ? this._states.get(inventoryRef) : null;
    if (!state || state.sessionKey !== sessionKey || state.tokenRef !== continuationRef) {
      throw createSemanticInventoryError(SEMANTIC_INVENTORY_ERROR_CODES.continuationInvalid,
        "semantic inventory continuation is unavailable or already consumed");
    }
    this._tokens.delete(continuationRef);
    state.tokenRef = null;
    if (this._now() > state.expiresAtMs) {
      this._drop(state);
      throw createSemanticInventoryError(SEMANTIC_INVENTORY_ERROR_CODES.continuationExpired,
        "semantic inventory continuation expired");
    }
    if (canonicalSemanticInventoryJson(documentEpoch) !== state.epochJson) {
      this._drop(state);
      throw createSemanticInventoryError(SEMANTIC_INVENTORY_ERROR_CODES.continuationStale,
        "semantic inventory document epoch changed");
    }
    return this._page(state);
  }

  invalidateSession(sessionKey) {
    const inventoryRef = this._sessions.get(sessionKey);
    if (!inventoryRef) return false;
    const state = this._states.get(inventoryRef);
    if (state) this._drop(state);
    else this._sessions.delete(sessionKey);
    return true;
  }

  close() {
    this._states.clear();
    this._tokens.clear();
    this._sessions.clear();
  }

  inspect() {
    this._reap();
    let items = 0;
    let bytes = 0;
    for (const state of this._states.values()) {
      items += state.nodes.length;
      bytes += state.byteLength;
    }
    return Object.freeze({ active: this._states.size, continuations: this._tokens.size, items, bytes,
      maxItems: this._maxItems, maxBytes: this._maxBytes, maxPageItems: this._maxPageItems,
      ttlMs: this._ttlMs });
  }

  async _page(state) {
    const offset = state.offset;
    const nextOffset = Math.min(state.nodes.length, offset + state.pageSize);
    const nodes = Object.freeze(state.nodes.slice(offset, nextOffset));
    const complete = nextOffset === state.nodes.length;
    const continuationRef = complete ? null : `continuation:${opaquePart(this._idFactory())}`;
    if (continuationRef) {
      state.tokenRef = continuationRef;
      this._tokens.set(continuationRef, state.inventoryRef);
      state.offset = nextOffset;
    }
    const inventory = Object.freeze({
      protocol: SEMANTIC_INVENTORY_PROTOCOL,
      version: SEMANTIC_INVENTORY_VERSION,
      inventoryRef: state.inventoryRef,
      snapshotRef: state.snapshotRef,
      documentEpoch: state.documentEpoch,
      ordering: "provider",
      offset,
      returned: nodes.length,
      nextOffset,
      total: state.nodes.length,
      byteLength: state.byteLength,
      complete,
      pageSha256: await sha256(nodes, this._crypto),
      prefixSha256: await sha256(state.nodes.slice(0, nextOffset), this._crypto),
      nodesSha256: state.nodesSha256,
      bindingSha256: state.bindingSha256,
      evidenceSha256: state.evidenceSha256,
      receiptSha256: state.receiptSha256,
      binding: state.binding,
      evidence: state.evidence,
      continuationExpiresAt: continuationRef ? new Date(state.expiresAtMs).toISOString() : null,
    });
    const output = Object.freeze({ nodes, continuationRef, inventory, metadata: state.metadata });
    if (complete) this._drop(state);
    return output;
  }

  _drop(state) {
    if (state.tokenRef) this._tokens.delete(state.tokenRef);
    this._states.delete(state.inventoryRef);
    if (this._sessions.get(state.sessionKey) === state.inventoryRef) this._sessions.delete(state.sessionKey);
  }

  _reap() {
    const now = this._now();
    for (const state of [...this._states.values()]) if (now > state.expiresAtMs) this._drop(state);
  }
}
