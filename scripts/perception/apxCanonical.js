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

function leftOut(value) {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

// The canonical form of what JSON would carry of `value`, the same string as
// canonicalApxJson(JSON.parse(JSON.stringify(value))) without building that copy: members JSON leaves out (undefined,
// functions, symbols) are left out, array slots holding them (or holes) are null, and a non-finite number is null.
// A value with its own toJSON, or any object that is not plain data, goes through the copy, so the result is the same.
export function canonicalJsonImage(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new TypeError("APX value exceeds the canonical depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value) && typeof value.toJSON !== "function") {
    const parts = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      parts[index] = leftOut(entry) ? "null" : canonicalJsonImage(entry, depth + 1);
    }
    return `[${parts.join(",")}]`;
  }
  if (plainObject(value) && typeof value.toJSON !== "function") {
    const keys = Object.keys(value).filter((key) => !leftOut(value[key])).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonImage(value[key], depth + 1)}`).join(",")}}`;
  }
  return canonicalApxJson(JSON.parse(JSON.stringify(value)), depth);
}

export function apxDigest(value) {
  return createHash("sha256").update(canonicalApxJson(value)).digest("hex");
}
