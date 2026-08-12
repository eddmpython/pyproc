// controlProtocol.js - 설치 제품의 언어 중립 NDJSON wire 계약과 client 상태기계.

export const CONTROL_PROTOCOL = "pyproc-control";
export const CONTROL_VERSION = 1;
export const CONTROL_MAX_FRAME_BYTES = 1024 * 1024;
export const CONTROL_ATTACHMENT_CHUNK_BYTES = 256 * 1024;
export const CONTROL_MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NAME_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{2,95}$/;
const MIME_RE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FRAME_TYPES = new Set(["hello", "request", "response", "error", "cancel", "event", "attachment"]);
const SUCCESS_OUTCOMES = new Set(["observed", "applied"]);
const ERROR_OUTCOMES = new Set(["notSent", "rejected", "applied", "outcomeUnknown"]);
const COMMON_KEYS = new Set(["protocol", "version", "type"]);

export class ControlProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ControlProtocolError";
    this.code = code;
  }
}

function fail(code, message) { throw new ControlProtocolError(code, message); }
function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function assertObject(value, label) {
  if (!plainObject(value)) fail("CONTROL_INVALID_FRAME", `${label} must be an object`);
}
function assertExactKeys(value, allowed, required, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("CONTROL_INVALID_FRAME", `${label} has unknown field: ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail("CONTROL_INVALID_FRAME", `${label} is missing field: ${key}`);
}
function assertId(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) fail("CONTROL_INVALID_FRAME", `${label} is invalid`);
}
function assertName(value, label) {
  if (typeof value !== "string" || !NAME_RE.test(value)) fail("CONTROL_INVALID_FRAME", `${label} is invalid`);
}
function assertJson(value, label, depth = 0) {
  if (depth > 64) fail("CONTROL_INVALID_FRAME", `${label} exceeds nesting limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertJson(value[index], `${label}[${index}]`, depth + 1);
    return;
  }
  if (plainObject(value)) {
    for (const [key, child] of Object.entries(value)) assertJson(child, `${label}.${key}`, depth + 1);
    return;
  }
  fail("CONTROL_INVALID_FRAME", `${label} is not a JSON value`);
}
function assertPeer(peer) {
  assertObject(peer, "hello.peer");
  assertExactKeys(peer, new Set(["name", "version"]), new Set(["name", "version"]), "hello.peer");
  if (typeof peer.name !== "string" || peer.name.length < 1 || peer.name.length > 80) fail("CONTROL_INVALID_FRAME", "hello.peer.name is invalid");
  if (typeof peer.version !== "string" || peer.version.length < 1 || peer.version.length > 40) fail("CONTROL_INVALID_FRAME", "hello.peer.version is invalid");
}
function assertCapabilities(value) {
  assertObject(value, "hello.capabilities");
  assertExactKeys(value, new Set(["cancel", "events", "attachments"]), new Set(["cancel", "events", "attachments"]), "hello.capabilities");
  if (typeof value.cancel !== "boolean" || typeof value.events !== "boolean") fail("CONTROL_INVALID_FRAME", "hello capabilities are invalid");
  assertObject(value.attachments, "hello.capabilities.attachments");
  assertExactKeys(value.attachments, new Set(["encoding", "maxChunkBytes"]), new Set(["encoding", "maxChunkBytes"]), "hello.capabilities.attachments");
  if (value.attachments.encoding !== "base64" || !Number.isSafeInteger(value.attachments.maxChunkBytes)
    || value.attachments.maxChunkBytes < 1 || value.attachments.maxChunkBytes > CONTROL_ATTACHMENT_CHUNK_BYTES) {
    fail("CONTROL_INVALID_FRAME", "hello attachment capability is invalid");
  }
}
function assertDescriptor(value) {
  assertObject(value, "response.attachments[]");
  const keys = new Set(["attachmentId", "kind", "mimeType", "byteLength", "sha256"]);
  assertExactKeys(value, keys, keys, "response.attachments[]");
  assertId(value.attachmentId, "response attachmentId");
  assertName(value.kind, "response attachment kind");
  if (typeof value.mimeType !== "string" || !MIME_RE.test(value.mimeType)) fail("CONTROL_INVALID_FRAME", "response attachment mimeType is invalid");
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0) fail("CONTROL_INVALID_FRAME", "response attachment byteLength is invalid");
  if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256)) fail("CONTROL_INVALID_FRAME", "response attachment sha256 is invalid");
}
function assertError(value) {
  assertObject(value, "error.error");
  const allowed = new Set(["code", "message", "retryable", "outcome", "details"]);
  assertExactKeys(value, allowed, new Set(["code", "message", "retryable", "outcome"]), "error.error");
  if (typeof value.code !== "string" || !CODE_RE.test(value.code)) fail("CONTROL_INVALID_FRAME", "error code is invalid");
  if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 2000) fail("CONTROL_INVALID_FRAME", "error message is invalid");
  if (typeof value.retryable !== "boolean") fail("CONTROL_INVALID_FRAME", "error retryable is invalid");
  if (!ERROR_OUTCOMES.has(value.outcome)) fail("CONTROL_INVALID_FRAME", "error outcome is invalid");
  if ((value.outcome === "applied" || value.outcome === "outcomeUnknown") && value.retryable) {
    fail("CONTROL_INVALID_FRAME", `error outcome ${value.outcome} cannot be retryable`);
  }
  if (value.details !== undefined) assertJson(value.details, "error.error.details");
}
function assertBase(frame) {
  assertObject(frame, "control frame");
  if (frame.protocol !== CONTROL_PROTOCOL) fail("CONTROL_INVALID_FRAME", "control protocol name is invalid");
  if (frame.version !== CONTROL_VERSION) fail("CONTROL_VERSION_UNSUPPORTED", `control protocol version is unsupported: ${frame.version}`);
  if (!FRAME_TYPES.has(frame.type)) fail("CONTROL_INVALID_FRAME", `control frame type is invalid: ${frame.type}`);
}

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Hex(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateControlFrame(frame) {
  assertBase(frame);
  if (frame.type === "hello") {
    const allowed = new Set([...COMMON_KEYS, "requestId", "role", "peer", "capabilities", "operations"]);
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "requestId", "role", "peer", "capabilities"]), "hello");
    assertId(frame.requestId, "hello.requestId");
    if (frame.role !== "client" && frame.role !== "server") fail("CONTROL_INVALID_FRAME", "hello.role is invalid");
    assertPeer(frame.peer);
    assertCapabilities(frame.capabilities);
    if (frame.role === "client" && frame.operations !== undefined) fail("CONTROL_INVALID_FRAME", "client hello cannot declare operations");
    if (frame.role === "server") {
      if (!Array.isArray(frame.operations)) fail("CONTROL_INVALID_FRAME", "server hello operations are required");
      const seen = new Set();
      for (const operation of frame.operations) {
        assertName(operation, "hello operation");
        if (seen.has(operation)) fail("CONTROL_INVALID_FRAME", `duplicate hello operation: ${operation}`);
        seen.add(operation);
      }
    }
  } else if (frame.type === "request") {
    const allowed = new Set([...COMMON_KEYS, "requestId", "operation", "input", "spaceId"]);
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "requestId", "operation", "input"]), "request");
    assertId(frame.requestId, "request.requestId");
    assertName(frame.operation, "request.operation");
    assertJson(frame.input, "request.input");
    if (!plainObject(frame.input)) fail("CONTROL_INVALID_FRAME", "request.input must be an object");
    if (frame.spaceId !== undefined) assertId(frame.spaceId, "request.spaceId");
  } else if (frame.type === "cancel") {
    const allowed = new Set([...COMMON_KEYS, "requestId", "reason"]);
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "requestId"]), "cancel");
    assertId(frame.requestId, "cancel.requestId");
    if (frame.reason !== undefined && (typeof frame.reason !== "string" || frame.reason.length > 200)) fail("CONTROL_INVALID_FRAME", "cancel.reason is invalid");
  } else if (frame.type === "event") {
    const allowed = new Set([...COMMON_KEYS, "eventId", "requestId", "name", "data"]);
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "eventId", "name", "data"]), "event");
    assertId(frame.eventId, "event.eventId");
    if (frame.requestId !== undefined) assertId(frame.requestId, "event.requestId");
    assertName(frame.name, "event.name");
    assertJson(frame.data, "event.data");
  } else if (frame.type === "attachment") {
    const allowed = new Set([...COMMON_KEYS, "requestId", "attachmentId", "mimeType", "offset", "dataBase64", "eof", "byteLength", "sha256"]);
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "requestId", "attachmentId", "mimeType", "offset", "dataBase64", "eof"]), "attachment");
    assertId(frame.requestId, "attachment.requestId");
    assertId(frame.attachmentId, "attachment.attachmentId");
    if (typeof frame.mimeType !== "string" || !MIME_RE.test(frame.mimeType)) fail("CONTROL_ATTACHMENT_INVALID", "attachment mimeType is invalid");
    if (!Number.isSafeInteger(frame.offset) || frame.offset < 0) fail("CONTROL_ATTACHMENT_INVALID", "attachment offset is invalid");
    if (typeof frame.dataBase64 !== "string" || !BASE64_RE.test(frame.dataBase64)) fail("CONTROL_ATTACHMENT_INVALID", "attachment dataBase64 is invalid");
    if (typeof frame.eof !== "boolean") fail("CONTROL_ATTACHMENT_INVALID", "attachment eof is invalid");
    const decodedBytes = frame.dataBase64.length === 0 ? 0 : atob(frame.dataBase64).length;
    if (decodedBytes > CONTROL_ATTACHMENT_CHUNK_BYTES) fail("CONTROL_ATTACHMENT_INVALID", "attachment chunk exceeds the byte limit");
    if (frame.eof) {
      if (!Number.isSafeInteger(frame.byteLength) || frame.byteLength < 0 || typeof frame.sha256 !== "string" || !SHA256_RE.test(frame.sha256)) {
        fail("CONTROL_ATTACHMENT_INVALID", "final attachment metadata is invalid");
      }
    } else if (Object.hasOwn(frame, "byteLength") || Object.hasOwn(frame, "sha256")) {
      fail("CONTROL_ATTACHMENT_INVALID", "non-final attachment cannot carry terminal metadata");
    }
  } else if (frame.type === "response") {
    const allowed = new Set([...COMMON_KEYS, "requestId", "output", "outcome", "attachments"]);
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "requestId", "output", "outcome"]), "response");
    assertId(frame.requestId, "response.requestId");
    if (!SUCCESS_OUTCOMES.has(frame.outcome)) fail("CONTROL_INVALID_FRAME", "response outcome is invalid");
    assertJson(frame.output, "response.output");
    if (frame.attachments !== undefined) {
      if (!Array.isArray(frame.attachments)) fail("CONTROL_INVALID_FRAME", "response.attachments must be an array");
      const seen = new Set();
      for (const descriptor of frame.attachments) {
        assertDescriptor(descriptor);
        if (seen.has(descriptor.attachmentId)) fail("CONTROL_INVALID_FRAME", `duplicate response attachment: ${descriptor.attachmentId}`);
        seen.add(descriptor.attachmentId);
      }
    }
  } else if (frame.type === "error") {
    const allowed = new Set([...COMMON_KEYS, "requestId", "fatal", "error", "attachments"]);
    const fatal = frame.fatal === true;
    assertExactKeys(frame, allowed, new Set([...COMMON_KEYS, "error"]), "error");
    if (fatal) {
      if (frame.requestId !== undefined || frame.attachments !== undefined) {
        fail("CONTROL_INVALID_FRAME", "fatal error cannot belong to a request or carry attachments");
      }
    } else {
      if (frame.fatal !== undefined) fail("CONTROL_INVALID_FRAME", "error.fatal must be true when present");
      assertId(frame.requestId, "error.requestId");
    }
    assertError(frame.error);
    if (frame.attachments !== undefined) {
      if (!Array.isArray(frame.attachments)) fail("CONTROL_INVALID_FRAME", "error.attachments must be an array");
      const seen = new Set();
      for (const descriptor of frame.attachments) {
        assertDescriptor(descriptor);
        if (seen.has(descriptor.attachmentId)) fail("CONTROL_INVALID_FRAME", `duplicate error attachment: ${descriptor.attachmentId}`);
        seen.add(descriptor.attachmentId);
      }
    }
  }
  return frame;
}

export function encodeControlFrame(frame) {
  validateControlFrame(frame);
  const text = JSON.stringify(frame);
  if (new TextEncoder().encode(text).byteLength > CONTROL_MAX_FRAME_BYTES) fail("CONTROL_FRAME_TOO_LARGE", "control frame exceeds the byte limit");
  return text + "\n";
}

export function decodeControlFrame(line) {
  if (typeof line !== "string") fail("CONTROL_INVALID_FRAME", "control frame must be text");
  if (new TextEncoder().encode(line).byteLength > CONTROL_MAX_FRAME_BYTES) fail("CONTROL_FRAME_TOO_LARGE", "control frame exceeds the byte limit");
  let frame;
  try { frame = JSON.parse(line); }
  catch (error) { fail("CONTROL_INVALID_FRAME", "control frame is not valid JSON"); }
  return validateControlFrame(frame);
}

export const controlBase = (type) => ({ protocol: CONTROL_PROTOCOL, version: CONTROL_VERSION, type });

export class ControlClientConversation {
  constructor() {
    this._started = new Set();
    this._active = new Set();
    this._terminal = new Set();
    this._events = new Set();
    this._attachments = new Map();
  }

  begin(frame) {
    validateControlFrame(frame);
    if (frame.type !== "request") fail("CONTROL_INVALID_FRAME", "conversation begin requires a request");
    if (this._started.has(frame.requestId)) fail("CONTROL_REQUEST_DUPLICATE", `request ID was already used: ${frame.requestId}`);
    this._started.add(frame.requestId);
    this._active.add(frame.requestId);
  }

  async accept(frame) {
    validateControlFrame(frame);
    if (frame.type === "event") {
      if (this._events.has(frame.eventId)) fail("CONTROL_EVENT_DUPLICATE", `event ID was already used: ${frame.eventId}`);
      if (frame.requestId !== undefined && !this._active.has(frame.requestId)) fail("CONTROL_REQUEST_UNKNOWN", `event request is not active: ${frame.requestId}`);
      this._events.add(frame.eventId);
      return;
    }
    if (frame.type === "attachment") {
      if (!this._active.has(frame.requestId)) fail("CONTROL_REQUEST_UNKNOWN", `attachment request is not active: ${frame.requestId}`);
      const key = `${frame.requestId}\u0000${frame.attachmentId}`;
      const current = this._attachments.get(key) || { offset: 0, complete: false, mimeType: frame.mimeType, parts: [] };
      if (current.complete || current.offset !== frame.offset || current.mimeType !== frame.mimeType) {
        fail("CONTROL_ATTACHMENT_INVALID", `attachment chunk is out of order: ${frame.attachmentId}`);
      }
      const bytes = base64Bytes(frame.dataBase64);
      current.parts.push(bytes);
      current.offset += bytes.byteLength;
      if (current.offset > CONTROL_MAX_ATTACHMENT_BYTES) fail("CONTROL_ATTACHMENT_INVALID", `attachment exceeds the byte limit: ${frame.attachmentId}`);
      if (frame.eof) {
        if (frame.byteLength !== current.offset) fail("CONTROL_ATTACHMENT_INVALID", `attachment byte length mismatch: ${frame.attachmentId}`);
        if (await sha256Hex(current.parts) !== frame.sha256) fail("CONTROL_ATTACHMENT_INVALID", `attachment digest mismatch: ${frame.attachmentId}`);
        current.complete = true;
        current.byteLength = frame.byteLength;
        current.sha256 = frame.sha256;
        const joined = new Uint8Array(current.offset);
        let joinedOffset = 0;
        for (const part of current.parts) { joined.set(part, joinedOffset); joinedOffset += part.byteLength; }
        current.bytes = joined;
        current.parts = [];
      }
      this._attachments.set(key, current);
      return;
    }
    if (frame.type !== "response" && frame.type !== "error") return;
    if (this._terminal.has(frame.requestId)) fail("CONTROL_TERMINAL_DUPLICATE", `request already has a terminal response: ${frame.requestId}`);
    if (!this._active.has(frame.requestId)) fail("CONTROL_REQUEST_UNKNOWN", `response request is not active: ${frame.requestId}`);
    const descriptors = frame.attachments || [];
    const declared = new Set();
    for (const descriptor of descriptors) {
      const key = `${frame.requestId}\u0000${descriptor.attachmentId}`;
      const state = this._attachments.get(key);
      if (!state?.complete || state.byteLength !== descriptor.byteLength || state.sha256 !== descriptor.sha256 || state.mimeType !== descriptor.mimeType) {
        fail("CONTROL_ATTACHMENT_INVALID", `response attachment is incomplete: ${descriptor.attachmentId}`);
      }
      declared.add(key);
    }
    for (const key of this._attachments.keys()) {
      if (key.startsWith(`${frame.requestId}\u0000`) && !declared.has(key)) fail("CONTROL_ATTACHMENT_INVALID", "response omitted a received attachment");
    }
    this._active.delete(frame.requestId);
    this._terminal.add(frame.requestId);
  }

  attachmentsFor(requestId, descriptors = []) {
    return Object.freeze(descriptors.map((descriptor) => {
      const state = this._attachments.get(`${requestId}\u0000${descriptor.attachmentId}`);
      if (!state?.complete || !state.bytes) fail("CONTROL_ATTACHMENT_INVALID", `attachment is unavailable: ${descriptor.attachmentId}`);
      return Object.freeze({ ...descriptor, bytes: state.bytes.slice() });
    }));
  }
}
