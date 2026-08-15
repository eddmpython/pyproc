"""Immutable public values returned by the pyproc Control Protocol client."""

from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class Attachment:
    attachmentId: str
    kind: str
    mimeType: str
    byteLength: int
    sha256: str
    bytes: bytes


@dataclass(frozen=True, slots=True)
class ControlResult:
    output: Any
    outcome: str
    attachments: tuple[Attachment, ...] = ()
    terminal: str = "completed"


@dataclass(frozen=True, slots=True)
class ActionConvergenceReceipt:
    """Provider-neutral first-effect convergence receipt for a proof-carrying action."""

    state: str
    reason: str
    attempts: int
    maxAttempts: int
    reobservations: int
    maxReobservations: int
    effectAttempts: int
    effectRetries: int
    effectOutcome: str
    maxPreEffectDurationMs: int
    preEffectDurationMs: int
    durationMs: int
    actionabilityPolls: int
    actionabilityReasonsSeen: tuple[str, ...]
    fromSituationRef: str | None = None
    toSituationRef: str | None = None
    fromDocumentEpoch: int | None = None
    toDocumentEpoch: int | None = None
    protocol: str = "pyproc.actionConvergence"
    version: int = 1

    @classmethod
    def fromMapping(cls, value: Mapping[str, Any]) -> "ActionConvergenceReceipt":
        if not isinstance(value, Mapping):
            raise TypeError("action convergence receipt must be a mapping")
        if value.get("protocol") != "pyproc.actionConvergence" or type(value.get("version")) is not int \
                or value.get("version") != 1:
            raise ValueError("action convergence receipt protocol is invalid")
        def integer(key: str) -> int:
            entry = value.get(key)
            if type(entry) is not int:
                raise ValueError(f"action convergence {key} is invalid")
            return entry

        state = str(value.get("state") or "")
        reason = str(value.get("reason") or "")
        effectOutcome = str(value.get("effectOutcome") or "")
        attempts = integer("attempts")
        maxAttempts = integer("maxAttempts")
        reobservations = integer("reobservations")
        maxReobservations = integer("maxReobservations")
        effectAttempts = integer("effectAttempts")
        effectRetries = integer("effectRetries")
        maxPreEffectDurationMs = integer("maxPreEffectDurationMs")
        preEffectDurationMs = integer("preEffectDurationMs")
        durationMs = integer("durationMs")
        actionabilityPolls = integer("actionabilityPolls")
        reasons = value.get("actionabilityReasonsSeen")
        if state not in {"converged", "refused", "unknown", "effectObserved"} \
                or reason not in {"ready", "staleTarget", "documentReplacement", "occlusionCleared",
                                  "ambiguousTarget", "targetUnavailable", "authorityChanged",
                                  "actionabilityTimeout", "convergenceTimeout", "cancelled", "providerRejected"} \
                or effectOutcome not in {"notSent", "rejected", "applied", "outcomeUnknown"} \
                or attempts not in {1, 2} or maxAttempts != 2 \
                or reobservations not in {0, 1} or maxReobservations != 1 \
                or effectAttempts not in {0, 1} or effectRetries != 0 \
                or maxPreEffectDurationMs != 30000 \
                or not 0 <= preEffectDurationMs <= maxPreEffectDurationMs \
                or durationMs < preEffectDurationMs or actionabilityPolls < 0 \
                or not isinstance(reasons, (list, tuple)):
            raise ValueError("action convergence receipt bounds are invalid")
        return cls(
            state=state,
            reason=reason,
            attempts=attempts,
            maxAttempts=maxAttempts,
            reobservations=reobservations,
            maxReobservations=maxReobservations,
            effectAttempts=effectAttempts,
            effectRetries=effectRetries,
            effectOutcome=effectOutcome,
            maxPreEffectDurationMs=maxPreEffectDurationMs,
            preEffectDurationMs=preEffectDurationMs,
            durationMs=durationMs,
            actionabilityPolls=actionabilityPolls,
            actionabilityReasonsSeen=tuple(map(str, reasons)),
            fromSituationRef=(str(value["fromSituationRef"]) if value.get("fromSituationRef") is not None else None),
            toSituationRef=(str(value["toSituationRef"]) if value.get("toSituationRef") is not None else None),
            fromDocumentEpoch=(int(value["fromDocumentEpoch"]) if value.get("fromDocumentEpoch") is not None else None),
            toDocumentEpoch=(int(value["toDocumentEpoch"]) if value.get("toDocumentEpoch") is not None else None),
        )


class ControlError(RuntimeError):
    """A verified request or connection error from the remote product."""

    def __init__(self, payload: dict[str, Any], *, fatal: bool = False) -> None:
        super().__init__(str(payload.get("message") or "control request failed"))
        self.code = str(payload.get("code") or "CONTROL_FAILED")
        self.outcome = str(payload.get("outcome") or "notSent")
        self.retryable = payload.get("retryable") is True
        self.details = payload.get("details")
        if self.outcome == "outcomeUnknown":
            self.terminal = "outcomeUnknown"
        elif isinstance(self.details, dict) and self.details.get("completed"):
            self.terminal = "partial"
        elif self.code == "CONTROL_CANCELLED":
            self.terminal = "cancelled"
        else:
            self.terminal = "rejected"
        self.fatal = fatal
