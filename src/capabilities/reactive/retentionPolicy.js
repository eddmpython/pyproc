import { PyProcError } from "../../runtime/errors.js";

const LIMIT_KEYS = Object.freeze(["maxNodes", "maxDeltaBytes", "maxTotalBytes"]);

export function normalizeRetentionPolicy(policy) {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "retention policy 객체가 필요하다");
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
      throw new PyProcError("PYPROC_INPUT_INVALID", `retention.${key}: 1 이상의 정수가 필요하다`);
    }
  }
  if (LIMIT_KEYS.every((key) => normalized[key] === null)) {
    throw new PyProcError(
      "PYPROC_INPUT_INVALID",
      "retention: maxNodes/maxDeltaBytes/maxTotalBytes 중 하나가 필요하다",
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
