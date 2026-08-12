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


class ControlError(RuntimeError):
    """A verified request or connection error from the remote product."""

    def __init__(self, payload: dict[str, Any], *, fatal: bool = False) -> None:
        super().__init__(str(payload.get("message") or "control request failed"))
        self.code = str(payload.get("code") or "CONTROL_FAILED")
        self.outcome = str(payload.get("outcome") or "notSent")
        self.retryable = payload.get("retryable") is True
        self.details = payload.get("details")
        self.fatal = fatal
