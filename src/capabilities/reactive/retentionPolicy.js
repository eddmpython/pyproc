// retentionPolicy.js - Layer 2: 체크포인트 보존 한도의 해석과 정규화(리액티브 능력의 정책 조각).
import { PyProcError } from "../../runtime/errors.js";

const LIMIT_KEYS = Object.freeze(["maxNodes", "maxDeltaBytes", "maxTotalBytes"]);

export function normalizeRetentionPolicy(policy) {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "a retention policy object is required");
  }
  const normalized = {
    maxNodes: policy.maxNodes ?? null,
    maxDeltaBytes: policy.maxDeltaBytes ?? null,
    maxTotalBytes: policy.maxTotalBytes ?? null,
    pruneBranches: policy.pruneBranches === true,
    onPressure: typeof policy.onPressure === "function" ? policy.onPressure : null,
  };
  for (const key of LIMIT_KEYS) {
    const value = normalized[key];
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `retention.${key}: an integer of at least 1 is required`);
    }
  }
  if (LIMIT_KEYS.every((key) => normalized[key] === null)) {
    throw new PyProcError(
      "PYPROC_INPUT_INVALID",
      "retention: one of maxNodes, maxDeltaBytes, or maxTotalBytes is required",
    );
  }
  return Object.freeze(normalized);
}

export function retentionExceeded(policy, stats) {
  const exceeded = [];
  if (policy.maxNodes !== null && stats.activeNodes > policy.maxNodes) exceeded.push("maxNodes");
  if (policy.maxDeltaBytes !== null && stats.deltaBytes > policy.maxDeltaBytes) exceeded.push("maxDeltaBytes");
  if (policy.maxTotalBytes !== null && stats.totalBytes > policy.maxTotalBytes) exceeded.push("maxTotalBytes");
  return exceeded;
}
