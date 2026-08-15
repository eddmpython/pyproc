// controlError.js - Control terminal과 recording이 공유하는 안정 오류 정규화.
export function controlErrorDetails(error) {
  const details = {
    ...(Number.isInteger(error?.failedActionIndex) ? { failedActionIndex: error.failedActionIndex } : {}),
    ...(error?.failedAction ? { failedAction: error.failedAction } : {}),
    ...(Array.isArray(error?.completed) ? { completed: error.completed } : {}),
    ...(error?.actionability ? { actionability: error.actionability } : {}),
    ...(error?.convergence ? { convergence: error.convergence } : {}),
    ...(error?.actionEvidence ? { actionEvidence: error.actionEvidence } : {}),
    ...(error?.trace ? { trace: error.trace } : {}),
    ...(error?.details && typeof error.details === "object" ? error.details : {}),
  };
  return Object.keys(details).length ? details : null;
}

export function canonicalControlError(error) {
  const outcome = ["notSent", "rejected", "applied", "outcomeUnknown"].includes(error?.outcome)
    ? error.outcome : "notSent";
  const retryable = (outcome === "applied" || outcome === "outcomeUnknown")
    ? false : error?.retryable === true;
  const details = controlErrorDetails(error);
  return Object.freeze({
    code: String(error?.code || "PYPROC_INTERNAL"),
    message: String(error?.message || error || "control operation failed").slice(-2000),
    retryable,
    outcome,
    ...(details ? { details } : {}),
  });
}

export function controlTerminalStatus(error) {
  if (error?.outcome === "outcomeUnknown") return "outcomeUnknown";
  if (Array.isArray(error?.details?.completed) && error.details.completed.length > 0) return "partial";
  if (error?.code === "CONTROL_CANCELLED") return "cancelled";
  return "rejected";
}
