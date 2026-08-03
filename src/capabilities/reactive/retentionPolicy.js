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
    // 선형 역사의 배출 밸브. 가지치기는 경로 밖만 놓으므로 문장마다 체크포인트를 찍는 모양에서
    // 0바이트를 회수한다. 이것을 켜면 경로 자체를 base로 접어 넣는다: 경계가 옮겨가므로 그
    // 이전으로의 시간여행과 그 경계로 쓴 저널·이미지를 잃는다. 그래서 기본값은 꺼짐이다.
    rebaseLinear: policy.rebaseLinear === true,
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
