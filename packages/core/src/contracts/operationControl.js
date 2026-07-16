// operationControl.js - 장시간 operation의 취소, timeout, 결과 불명 오류 의미를 고정한다.
import { WebMachineError } from "./webMachineError.js";

function isTimeoutReason(reason) {
  return reason?.name === "TimeoutError" || reason?.code === "WEB_MACHINE_OPERATION_TIMEOUT";
}

export function operationAbortError(control, label, { outcomeUnknown = false, details = {} } = {}) {
  const reason = control?.signal?.reason;
  if (outcomeUnknown) {
    return new WebMachineError(
      "WEB_MACHINE_OUTCOME_UNKNOWN",
      `${label}: 실행 시작 뒤 중단되어 결과 불명, 자동 replay 금지`,
      { ...details, retryable: false, cause: isTimeoutReason(reason) ? "timeout" : "aborted" },
    );
  }
  const timedOut = isTimeoutReason(reason);
  return new WebMachineError(
    timedOut ? "WEB_MACHINE_OPERATION_TIMEOUT" : "WEB_MACHINE_OPERATION_ABORTED",
    `${label}: ${timedOut ? "timeout" : "취소"}`,
    { ...details, retryable: true },
  );
}

export function throwIfOperationAborted(control, label, options) {
  if (control?.signal?.aborted) throw operationAbortError(control, label, options);
}
