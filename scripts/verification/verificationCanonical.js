// verificationCanonical.js - Experience Contract와 Evidence Pack의 finite JSON digest 정본.
import { createHash } from "node:crypto";

const MAX_DEPTH = 48;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function canonicalVerificationJson(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new TypeError("verification value exceeds the canonical depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalVerificationJson(entry, depth + 1)).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalVerificationJson(value[key], depth + 1)}`).join(",")}}`;
  throw new TypeError("verification value must be finite plain JSON");
}

export function verificationDigest(value) {
  return createHash("sha256").update(canonicalVerificationJson(value)).digest("hex");
}

export function verificationBytesDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verificationError(code, message, outcome = "notSent") {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  return error;
}
