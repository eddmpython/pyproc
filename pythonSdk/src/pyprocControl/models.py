"""Immutable public values returned by the pyproc Control Protocol client."""

from dataclasses import dataclass
from typing import Any


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
