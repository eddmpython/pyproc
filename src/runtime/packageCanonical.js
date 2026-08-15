// packageCanonical.js - Layer 0: canonical package names, JSON, and immutable values.
import { PyProcError } from "./errors.js";
import { compareNames } from "./memoryLayout.js";

export function normalizePackageName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Package name is invalid");
  }
  return value.toLowerCase().replace(/[-_.]+/gu, "-");
}

export function canonicalRequiresPython(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Requires-Python must be text or null");
  }
  const clauses = value.split(",").map((clause) => clause.replace(/\s+/gu, "")).filter(Boolean);
  if (!clauses.length) return null;
  return [...new Set(clauses)].sort(compareNames).join(",");
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const result = {};
    for (const key of Object.keys(value).sort(compareNames)) {
      if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  throw new PyProcError("PYPROC_INPUT_INVALID", "Package canonical value contains an unsupported type");
}

export const canonicalPackageJson = (value) => JSON.stringify(canonicalValue(value));

export function immutablePackageValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutablePackageValue));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = immutablePackageValue(item);
    return Object.freeze(result);
  }
  return value;
}
