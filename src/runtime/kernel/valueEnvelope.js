// valueEnvelope.js - Layer 0: bounded engine-neutral value transport.
import { PyProcError } from "../errors.js";
import {
  SHA256_ADDRESS_RE,
  base64FromBytes,
  bytesFromBase64,
  parseSha256Address,
  sha256Address,
} from "../contentDigest.js";

export const VALUE_ENVELOPE_PROTOCOL = "pyproc.value-envelope";
export const VALUE_ENVELOPE_VERSION = 1;

export const DEFAULT_VALUE_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 10000,
  maxInlineBytes: 1024 * 1024,
  maxStringBytes: 1024 * 1024,
  artifactThresholdBytes: 64 * 1024,
});

function valueError(message, kernelCode = "KERNEL_VALUE_INVALID", context = {}) {
  return new PyProcError("PYPROC_INPUT_INVALID", message, { context: { ...context, kernelCode } });
}

function limitsOf(options = {}) {
  const limits = { ...DEFAULT_VALUE_LIMITS, ...(options.limits || options) };
  for (const key of Object.keys(DEFAULT_VALUE_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) {
      throw valueError(`ValueEnvelope limit ${key} must be a non-negative safe integer`);
    }
  }
  return Object.freeze(limits);
}

function compareUtf8(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function assertProtocol(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || envelope.protocol !== VALUE_ENVELOPE_PROTOCOL || envelope.version !== VALUE_ENVELOPE_VERSION) {
    throw valueError("ValueEnvelope protocol identity is invalid");
  }
}

function visitEnvelope(envelope, state, depth) {
  assertProtocol(envelope);
  if (depth > state.limits.maxDepth) throw valueError("ValueEnvelope depth limit exceeded", "KERNEL_VALUE_LIMIT");
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) throw valueError("ValueEnvelope node limit exceeded", "KERNEL_VALUE_LIMIT");
  switch (envelope.kind) {
    case "null":
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "null" };
    case "bool":
      if (typeof envelope.value !== "boolean") throw valueError("ValueEnvelope bool value is invalid");
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "bool", value: envelope.value };
    case "number":
      if (typeof envelope.value !== "number" || !Number.isFinite(envelope.value)) {
        throw valueError("ValueEnvelope number must be finite");
      }
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "number", value: Object.is(envelope.value, -0) ? 0 : envelope.value };
    case "bigint":
      if (typeof envelope.decimal !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(envelope.decimal)
        || envelope.decimal === "-0") throw valueError("ValueEnvelope bigint decimal is invalid");
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "bigint", decimal: envelope.decimal };
    case "string": {
      if (typeof envelope.value !== "string") throw valueError("ValueEnvelope string value is invalid");
      const byteLength = new TextEncoder().encode(envelope.value).byteLength;
      if (byteLength > state.limits.maxStringBytes) throw valueError("ValueEnvelope string limit exceeded", "KERNEL_VALUE_LIMIT");
      state.inlineBytes += byteLength;
      if (state.inlineBytes > state.limits.maxInlineBytes) {
        throw valueError("ValueEnvelope inline byte limit exceeded", "KERNEL_VALUE_LIMIT");
      }
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "string", value: envelope.value };
    }
    case "bytes": {
      if (typeof envelope.base64 !== "string" || !Number.isSafeInteger(envelope.byteLength) || envelope.byteLength < 0
        || typeof envelope.sha256 !== "string" || !SHA256_ADDRESS_RE.test(envelope.sha256)) {
        throw valueError("ValueEnvelope bytes metadata is invalid");
      }
      let bytes;
      try { bytes = bytesFromBase64(envelope.base64); }
      catch (error) { throw valueError("ValueEnvelope bytes base64 is invalid", "KERNEL_VALUE_INVALID", { cause: String(error) }); }
      if (bytes.byteLength !== envelope.byteLength) throw valueError("ValueEnvelope bytes length does not match metadata");
      state.inlineBytes += bytes.byteLength;
      if (state.inlineBytes > state.limits.maxInlineBytes) {
        throw valueError("ValueEnvelope inline byte limit exceeded", "KERNEL_VALUE_LIMIT");
      }
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "bytes",
        base64: envelope.base64, byteLength: envelope.byteLength, sha256: envelope.sha256 };
    }
    case "list":
      if (!Array.isArray(envelope.items)) throw valueError("ValueEnvelope list items are invalid");
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "list",
        items: envelope.items.map((item) => visitEnvelope(item, state, depth + 1)) };
    case "map": {
      if (!Array.isArray(envelope.entries)) throw valueError("ValueEnvelope map entries are invalid");
      const entries = [];
      const keys = new Set();
      for (const pair of envelope.entries) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
          throw valueError("ValueEnvelope map entry is invalid");
        }
        if (keys.has(pair[0])) throw valueError("ValueEnvelope map contains a duplicate key");
        keys.add(pair[0]);
        const keyBytes = new TextEncoder().encode(pair[0]).byteLength;
        if (keyBytes > state.limits.maxStringBytes) throw valueError("ValueEnvelope map key limit exceeded", "KERNEL_VALUE_LIMIT");
        state.inlineBytes += keyBytes;
        entries.push([pair[0], visitEnvelope(pair[1], state, depth + 1)]);
      }
      entries.sort((left, right) => compareUtf8(left[0], right[0]));
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "map", entries };
    }
    case "artifact":
      if (typeof envelope.artifactRef !== "string" || !envelope.artifactRef
        || typeof envelope.mediaType !== "string" || !envelope.mediaType
        || typeof envelope.sha256 !== "string" || !SHA256_ADDRESS_RE.test(envelope.sha256)
        || !Number.isSafeInteger(envelope.byteLength) || envelope.byteLength < 0) {
        throw valueError("ValueEnvelope artifact metadata is invalid");
      }
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "artifact",
        artifactRef: envelope.artifactRef, mediaType: envelope.mediaType,
        byteLength: envelope.byteLength, sha256: envelope.sha256 };
    case "ephemeralRef":
      if (typeof envelope.ref !== "string" || !envelope.ref || typeof envelope.type !== "string" || !envelope.type
        || typeof envelope.kernelRef !== "string" || !envelope.kernelRef
        || !Number.isSafeInteger(envelope.generation) || envelope.generation < 0
        || !Number.isFinite(envelope.expiresAt) || envelope.expiresAt <= 0) {
        throw valueError("ValueEnvelope ephemeralRef metadata is invalid");
      }
      return { protocol: VALUE_ENVELOPE_PROTOCOL, version: 1, kind: "ephemeralRef", ref: envelope.ref,
        type: envelope.type, kernelRef: envelope.kernelRef, generation: envelope.generation, expiresAt: envelope.expiresAt };
    default:
      throw valueError(`ValueEnvelope kind is unsupported: ${String(envelope.kind)}`);
  }
  throw valueError(`ValueEnvelope kind is unsupported: ${String(envelope.kind)}`);
}

export function canonicalValueEnvelope(envelope, options = {}) {
  const state = { limits: limitsOf(options), nodes: 0, inlineBytes: 0 };
  const canonical = visitEnvelope(envelope, state, 0);
  if (state.inlineBytes > state.limits.maxInlineBytes) {
    throw valueError("ValueEnvelope inline byte limit exceeded", "KERNEL_VALUE_LIMIT");
  }
  return Object.freeze(canonical);
}

export function assertValueEnvelope(envelope, options = {}) {
  canonicalValueEnvelope(envelope, options);
  return envelope;
}

function envelope(kind, fields = {}) {
  return Object.freeze({ protocol: VALUE_ENVELOPE_PROTOCOL, version: VALUE_ENVELOPE_VERSION, kind, ...fields });
}

async function encodeNode(value, state, depth) {
  if (depth > state.limits.maxDepth) throw valueError("ValueEnvelope depth limit exceeded", "KERNEL_VALUE_LIMIT");
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) throw valueError("ValueEnvelope node limit exceeded", "KERNEL_VALUE_LIMIT");
  if (value === null) return envelope("null");
  if (typeof value === "boolean") return envelope("bool", { value });
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw valueError("ValueEnvelope number must be finite");
    return envelope("number", { value: Object.is(value, -0) ? 0 : value });
  }
  if (typeof value === "bigint") return envelope("bigint", { decimal: value.toString(10) });
  if (typeof value === "string") {
    const byteLength = new TextEncoder().encode(value).byteLength;
    if (byteLength > state.limits.maxStringBytes) throw valueError("ValueEnvelope string limit exceeded", "KERNEL_VALUE_LIMIT");
    state.inlineBytes += byteLength;
    if (state.inlineBytes > state.limits.maxInlineBytes) throw valueError("ValueEnvelope inline byte limit exceeded", "KERNEL_VALUE_LIMIT");
    return envelope("string", { value });
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const digest = await sha256Address(bytes);
    if (bytes.byteLength > state.limits.artifactThresholdBytes) {
      if (!state.artifactStore || typeof state.artifactStore.put !== "function") {
        throw valueError("ValueEnvelope bytes require an artifact store", "KERNEL_VALUE_LIMIT", { byteLength: bytes.byteLength });
      }
      const stored = await state.artifactStore.put(bytes.slice(), {
        mediaType: "application/octet-stream",
        sha256: digest,
      });
      const artifactRef = typeof stored === "string" ? stored : stored?.artifactRef;
      if (typeof artifactRef !== "string" || !artifactRef) throw valueError("ValueEnvelope artifact store returned no reference");
      return envelope("artifact", { artifactRef, mediaType: "application/octet-stream", byteLength: bytes.byteLength, sha256: digest });
    }
    state.inlineBytes += bytes.byteLength;
    if (state.inlineBytes > state.limits.maxInlineBytes) throw valueError("ValueEnvelope inline byte limit exceeded", "KERNEL_VALUE_LIMIT");
    return envelope("bytes", { base64: base64FromBytes(bytes), byteLength: bytes.byteLength, sha256: digest });
  }
  if (typeof value !== "object") throw valueError(`ValueEnvelope cannot encode ${typeof value}`);
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    throw valueError("ValueEnvelope accepts only plain maps, lists, bytes, and scalar values");
  }
  if (state.seen.has(value)) throw valueError("ValueEnvelope cannot encode cycles or shared object identity");
  state.seen.add(value);
  if (Array.isArray(value)) {
    const items = [];
    for (const item of value) items.push(await encodeNode(item, state, depth + 1));
    return envelope("list", { items: Object.freeze(items) });
  }
  if (Object.getOwnPropertySymbols(value).length) throw valueError("ValueEnvelope map cannot contain symbol keys");
  const entries = [];
  for (const key of Object.keys(value).sort(compareUtf8)) {
    if (value[key] === undefined) throw valueError("ValueEnvelope map cannot contain undefined");
    const keyBytes = new TextEncoder().encode(key).byteLength;
    if (keyBytes > state.limits.maxStringBytes) throw valueError("ValueEnvelope map key limit exceeded", "KERNEL_VALUE_LIMIT");
    state.inlineBytes += keyBytes;
    entries.push(Object.freeze([key, await encodeNode(value[key], state, depth + 1)]));
  }
  if (state.inlineBytes > state.limits.maxInlineBytes) throw valueError("ValueEnvelope inline byte limit exceeded", "KERNEL_VALUE_LIMIT");
  return envelope("map", { entries: Object.freeze(entries) });
}

export async function encodeValueEnvelope(value, options = {}) {
  return encodeNode(value, {
    limits: limitsOf(options),
    artifactStore: options.artifactStore || null,
    nodes: 0,
    inlineBytes: 0,
    seen: new WeakSet(),
  }, 0);
}

async function decodeNode(envelopeValue, options) {
  switch (envelopeValue.kind) {
    case "null": return null;
    case "bool":
    case "number":
    case "string": return envelopeValue.value;
    case "bigint": return BigInt(envelopeValue.decimal);
    case "bytes": {
      const bytes = bytesFromBase64(envelopeValue.base64);
      if (await sha256Address(bytes) !== envelopeValue.sha256) throw valueError("ValueEnvelope bytes digest mismatch");
      return bytes;
    }
    case "list": return Promise.all(envelopeValue.items.map((item) => decodeNode(item, options)));
    case "map": {
      const result = {};
      for (const [key, item] of envelopeValue.entries) result[key] = await decodeNode(item, options);
      return result;
    }
    case "artifact": {
      if (!options.artifactStore || typeof options.artifactStore.get !== "function") {
        throw valueError("ValueEnvelope artifact requires an artifact store");
      }
      const loaded = await options.artifactStore.get(envelopeValue.artifactRef);
      const bytes = loaded instanceof Uint8Array ? loaded : new Uint8Array(loaded);
      if (bytes.byteLength !== envelopeValue.byteLength || await sha256Address(bytes) !== envelopeValue.sha256) {
        throw valueError("ValueEnvelope artifact integrity mismatch");
      }
      return bytes;
    }
    case "ephemeralRef": return envelopeValue;
    default: throw valueError(`ValueEnvelope kind is unsupported: ${String(envelopeValue.kind)}`);
  }
}

export async function decodeValueEnvelope(envelopeValue, options = {}) {
  const canonical = canonicalValueEnvelope(envelopeValue, options);
  return decodeNode(canonical, options);
}

export async function digestValueEnvelope(envelopeValue, options = {}) {
  return sha256Address(JSON.stringify(canonicalValueEnvelope(envelopeValue, options)));
}

export class MemoryValueArtifactStore {
  #objects = new Map();

  async put(bytes, metadata = {}) {
    const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
    const actual = await sha256Address(copy);
    if (metadata.sha256 && metadata.sha256 !== actual) {
      throw valueError("ValueEnvelope artifact bytes do not match the declared digest",
        "KERNEL_VALUE_ARTIFACT_INTEGRITY", { expected: metadata.sha256, actual });
    }
    const digest = metadata.sha256 || actual;
    const artifactRef = `artifact:value:${parseSha256Address(digest)}`;
    this.#objects.set(artifactRef, copy);
    return Object.freeze({ artifactRef, sha256: digest, byteLength: copy.byteLength });
  }

  async get(artifactRef) {
    const bytes = this.#objects.get(artifactRef);
    if (!bytes) throw valueError("ValueEnvelope artifact is unavailable", "KERNEL_VALUE_ARTIFACT_MISSING", { artifactRef });
    return bytes.slice();
  }
}
