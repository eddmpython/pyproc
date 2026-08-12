// apxCanonical.js - APX integrity와 replay가 공유하는 finite JSON canonicalization.
import { createHash } from "node:crypto";

const MAX_DEPTH = 40;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalApxJson(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new TypeError("APX value exceeds the canonical depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalApxJson(entry, depth + 1)).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalApxJson(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError("APX value must be finite plain JSON");
}

export function apxDigest(value) {
  return createHash("sha256").update(canonicalApxJson(value)).digest("hex");
}
