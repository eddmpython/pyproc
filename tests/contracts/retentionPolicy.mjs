import {
  normalizeRetentionPolicy,
  retentionExceeded,
} from "../../src/capabilities/reactive/retentionPolicy.js";

export function assertRetentionPolicyContract() {
  const onPressure = () => {};
  const policy = normalizeRetentionPolicy({
    maxNodes: 3,
    maxDeltaBytes: 100,
    pruneBranches: true,
    onPressure,
  });
  if (!Object.isFrozen(policy)) throw new Error("retention policy가 불변 객체가 아니다");
  if (policy.maxTotalBytes !== null || policy.onPressure !== onPressure || !policy.pruneBranches) {
    throw new Error("retention policy 정규화 의미 불일치");
  }
  const exceeded = retentionExceeded(policy, {
    activeNodes: 4,
    deltaBytes: 100,
    totalBytes: 1000,
  });
  if (exceeded.join(",") !== "maxNodes") throw new Error(`retention 초과 판정 불일치: ${exceeded}`);

  let invalid = false;
  try { normalizeRetentionPolicy({ maxNodes: 0 }); }
  catch (error) { invalid = error?.code === "PYPROC_INPUT_INVALID"; }
  if (!invalid) throw new Error("retention invalid limit를 거부하지 않았다");
  return true;
}
