import assert from "node:assert/strict";
import {
  ACTION_CONVERGENCE_MAX_ATTEMPTS,
  ACTION_CONVERGENCE_MAX_DURATION_MS,
  ACTION_CONVERGENCE_MAX_REOBSERVATIONS,
  ActionConvergence,
  shouldReobserveAction,
} from "../../scripts/perception/actionConvergence.js";
import { canonicalControlError } from "../../scripts/controlProtocol/controlError.js";

export function assertActionConvergenceContracts() {
  assert.equal(ACTION_CONVERGENCE_MAX_ATTEMPTS, 2);
  assert.equal(ACTION_CONVERGENCE_MAX_REOBSERVATIONS, 1);
  assert.equal(ACTION_CONVERGENCE_MAX_DURATION_MS, 30000);
  let now = 1000;
  let deadline = null;
  let cleared = 0;
  const convergence = new ActionConvergence({
    now: () => now,
    setTimer: (callback, ms) => { deadline = { callback, ms }; return deadline; },
    clearTimer: () => { cleared += 1; },
  });
  convergence.recordActionability({ polls: 1, reasonsSeen: ["notAttached"] });
  convergence.beginReobservation();
  convergence.adoptBinding({ reason: "staleTarget",
    fromSituationRef: "situation:old", toSituationRef: "situation:new",
    fromDocumentEpoch: 7, toDocumentEpoch: 7 });
  convergence.recordActionability({ polls: 3, reasonsSeen: [] });
  now = 1100;
  convergence.markEffectAttempt();
  now = 1125;
  const receipt = convergence.success({});
  assert.equal(deadline.ms, ACTION_CONVERGENCE_MAX_DURATION_MS);
  assert.deepEqual(receipt, {
    protocol: "pyproc.actionConvergence", version: 1, state: "converged", reason: "staleTarget",
    attempts: 2, maxAttempts: 2,
    reobservations: 1,
    maxReobservations: 1,
    effectAttempts: 1, effectRetries: 0, effectOutcome: "applied",
    maxPreEffectDurationMs: 30000, preEffectDurationMs: 100, durationMs: 125,
    actionabilityPolls: 4, actionabilityReasonsSeen: ["notAttached"],
    fromSituationRef: "situation:old", toSituationRef: "situation:new",
    fromDocumentEpoch: 7, toDocumentEpoch: 7,
  });
  assert.equal(cleared, 1);
  assert.throws(() => convergence.beginReobservation(), /limit exceeded/);
  convergence.close();

  const refusal = new ActionConvergence({ now: () => now });
  refusal.beginReobservation();
  const ambiguous = new Error("two targets");
  ambiguous.code = "APX_CAPABILITY_STALE";
  ambiguous.outcome = "notSent";
  ambiguous.retryable = false;
  ambiguous.convergenceReason = "ambiguousTarget";
  const refused = refusal.failure(ambiguous);
  assert.equal(refused.convergence.state, "refused");
  assert.equal(refused.convergence.reason, "ambiguousTarget");
  assert.equal(refused.convergence.effectAttempts, 0);
  assert.equal(canonicalControlError(refused).details.convergence.reason, "ambiguousTarget");
  refusal.close();

  let timeoutCallback = null;
  const timed = new ActionConvergence({ now: () => now,
    setTimer: (callback) => { timeoutCallback = callback; return 1; }, clearTimer: () => {} });
  timeoutCallback();
  const timedFailure = timed.failure(new Error("cancelled"));
  assert.equal(timedFailure.code, "APX_ACTION_CONVERGENCE_TIMEOUT");
  assert.equal(timedFailure.outcome, "notSent");
  assert.equal(timedFailure.convergence.reason, "convergenceTimeout");
  timed.close();

  assert.equal(shouldReobserveAction({ code: "BROWSER_AUTOMATION_TARGET_MISSING", outcome: "notSent" }), true);
  assert.equal(shouldReobserveAction({ code: "FRAME_SPACE_TARGET_NOT_FOUND", outcome: "notSent" }), true);
  assert.equal(shouldReobserveAction({ code: "BROWSER_AUTOMATION_TARGET_MISSING", outcome: "outcomeUnknown" }), false);
  assert.equal(shouldReobserveAction({ code: "BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT", outcome: "notSent",
    actionability: { reasonsSeen: ["intercepted"] } }), false);
}
