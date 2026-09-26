"""Proof-carrying Motor from Python: task sessions, typed intents, and the canonical actuation digest.

`MotorTaskSession` is the Python side of the JavaScript `openMotorTask()` lifecycle and keeps its meaning exactly: one
task binds a target, an attached session, the Situations it observed, the artifacts they produced, and their cleanup.
It executes only a SituationCapsule it observed itself whose requirement settled on one complete target, and closing
it detaches the session, deletes the artifacts it did not retain, and closes a target it opened, without retrying any
effect. Receipt digests use the same canonical JSON as the Control host, so a receipt can be checked locally.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal, Mapping, Sequence

from .models import ControlError, ControlResult
from .perception import SituationResult, plainMapping

ActuationIntentKind = Literal["activate", "focus", "setValue", "setSelected", "setExpanded", "scrollTo", "dragTo"]
ActuatorKind = Literal["cooperative", "browserInput", "accessibility", "osInput", "replay"]

_MAX_DEPTH = 40
_MAX_CANONICAL_BYTES = 4 * 1024 * 1024
_STRING_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
_REFINEMENT = (
    {"predicate": "semantic.name", "operator": "exact"},
    {"predicate": "semantic.state", "operator": "equals"},
    {"predicate": "interaction.actionable", "operator": "equals"},
    {"predicate": "kind", "operator": "equals"},
)


def canonicalActuationJson(value: Any) -> str:
    """The canonical JSON the Control host digests: keys sorted by UTF-16 code unit, no whitespace, numbers and
    strings written as JavaScript `JSON.stringify` writes them. Only finite plain JSON is accepted."""

    return _canonical(value, 0)


def actuationDigest(value: Any) -> str:
    """SHA-256 hex digest of `canonicalActuationJson(value)`, the digest of intents, plans, and receipts."""

    canonical = _canonical(value, 0).encode("utf-8")
    if len(canonical) > _MAX_CANONICAL_BYTES:
        raise ValueError("actuation value exceeds the byte limit")
    return hashlib.sha256(canonical).hexdigest()


def _canonical(value: Any, depth: int) -> str:
    if depth > _MAX_DEPTH:
        raise ValueError("actuation value exceeds the depth limit")
    if value is None:
        return "null"
    if value is True or value is False:
        return "true" if value else "false"
    if isinstance(value, str):
        return _jsString(value)
    if isinstance(value, (int, float)):
        return _jsNumber(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical(entry, depth + 1) for entry in value) + "]"
    if isinstance(value, Mapping):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("actuation object keys must be strings")
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(f"{_jsString(key)}:{_canonical(value[key], depth + 1)}" for key in keys) + "}"
    raise TypeError("actuation values must be finite plain JSON")


def _jsString(value: str) -> str:
    out = ['"']
    for character in value:
        code = ord(character)
        if character in _STRING_ESCAPES:
            out.append(_STRING_ESCAPES[character])
        elif code < 0x20 or 0xD800 <= code <= 0xDFFF:
            out.append(f"\\u{code:04x}")
        else:
            out.append(character)
    out.append('"')
    return "".join(out)


def _jsNumber(value: int | float) -> str:
    """ECMAScript Number::toString of the double nearest `value`."""

    number = float(value)
    if not math.isfinite(number):
        raise ValueError("actuation values must be finite plain JSON")
    if number == 0:
        return "0"
    _, digitTuple, exponent = Decimal(repr(abs(number))).as_tuple()
    assert isinstance(exponent, int)
    digits = "".join(str(digit) for digit in digitTuple).lstrip("0")
    stripped = digits.rstrip("0")
    exponent += len(digits) - len(stripped)
    digits, k = stripped, len(stripped)
    n = exponent + k
    sign = "-" if number < 0 else ""
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * -n + digits
    power = n - 1
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{sign}{mantissa}e{'+' if power >= 0 else '-'}{abs(power)}"


@dataclass(frozen=True, slots=True)
class MotorTarget:
    """The observed entity an intent acts on, in the space and world epoch it was observed in."""

    spaceRef: str
    entityRef: str
    worldRef: str
    surfaceEpoch: str


@dataclass(frozen=True, slots=True)
class MotorAuthority:
    """The capability an observed affordance granted, and the grants and leases the effect runs under."""

    actionCapabilityRef: str
    approvalGrantRef: str | None = None
    commitLeaseRef: str | None = None
    controlLeaseRef: str | None = None


@dataclass(frozen=True, slots=True)
class MotorPolicy:
    """Which actuators may carry the effect, and whether a pre-contact fallback is allowed."""

    allowedActuatorKinds: tuple[ActuatorKind, ...]
    allowPreContactFallback: bool = False


@dataclass(frozen=True, slots=True)
class ActuationIntent:
    """One absolute Motor intent: what should be true of one observed entity afterwards, never how to click it."""

    intent: ActuationIntentKind
    target: MotorTarget
    desired: Mapping[str, Any]
    authority: MotorAuthority
    policy: MotorPolicy
    preconditions: tuple[Mapping[str, Any], ...] = ()
    expectedTransition: Mapping[str, Any] = field(default_factory=dict)

    def toMapping(self) -> dict[str, Any]:
        """The intent as the Control Protocol carries it."""

        return {
            "intent": self.intent,
            "target": {
                "spaceRef": self.target.spaceRef,
                "entityRef": self.target.entityRef,
                "worldRef": self.target.worldRef,
                "surfaceEpoch": self.target.surfaceEpoch,
            },
            "desired": dict(self.desired),
            "preconditions": [dict(entry) for entry in self.preconditions],
            "expectedTransition": dict(self.expectedTransition),
            "authority": {
                "actionCapabilityRef": self.authority.actionCapabilityRef,
                "approvalGrantRef": self.authority.approvalGrantRef,
                "commitLeaseRef": self.authority.commitLeaseRef,
                "controlLeaseRef": self.authority.controlLeaseRef,
            },
            "policy": {
                "allowedActuatorKinds": list(self.policy.allowedActuatorKinds),
                "allowPreContactFallback": self.policy.allowPreContactFallback,
            },
        }


@dataclass(frozen=True, slots=True)
class MotorAmbiguityDiagnostic:
    """Whether a requirement settled on one complete target, and the caller-owned predicates that would refine it."""

    requirementRef: str
    state: Literal["unique", "ambiguous", "incomplete"]
    matched: int
    canExecute: bool
    requiredCallerRefinement: tuple[Mapping[str, str], ...]
    protocol: str = "pyproc.motorAmbiguityDiagnostic"
    version: int = 1

    def toMapping(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol,
            "version": self.version,
            "requirementRef": self.requirementRef,
            "state": self.state,
            "matched": self.matched,
            "canExecute": self.canExecute,
            "requiredCallerRefinement": [dict(entry) for entry in self.requiredCallerRefinement],
        }


@dataclass(frozen=True, slots=True)
class MotorCleanupFailure:
    """One cleanup phase that failed, with the error code it failed with."""

    phase: Literal["sessionDetach", "artifactDelete", "targetClose"]
    code: str


@dataclass(frozen=True, slots=True)
class MotorTaskCleanup:
    """What closing a Motor task did. It never retries an effect."""

    state: Literal["complete", "incomplete"]
    targetOwnership: Literal["owned", "borrowed"]
    artifactsRetained: int
    failures: tuple[MotorCleanupFailure, ...]
    effectRetried: bool = False
    protocol: str = "pyproc.motorTaskCleanup"
    version: int = 1

    def toMapping(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol,
            "version": self.version,
            "state": self.state,
            "effectRetried": self.effectRetried,
            "targetOwnership": self.targetOwnership,
            "artifactsRetained": self.artifactsRetained,
            "failures": [{"phase": failure.phase, "code": failure.code} for failure in self.failures],
        }


class MotorTaskSession:
    """One Motor task: its target, attached session, observed Situations, artifacts, and cleanup."""

    def __init__(self, client: Any, *, targetRef: str, sessionRef: Mapping[str, Any], ownedTarget: bool,
                 retainArtifacts: bool) -> None:
        self.client = client
        self.targetRef = targetRef
        self.sessionRef = dict(sessionRef)
        self.ownedTarget = ownedTarget
        self.retainArtifacts = retainArtifacts
        self._artifacts: set[str] = set()
        self._retained: set[str] = set()
        self._situations: set[str] = set()
        self._closed = False
        self._cleanup: MotorTaskCleanup | None = None

    @classmethod
    def open(cls, client: Any, *, url: str | None = None, targetRef: str | None = None,
             expectedRisk: str = "externalEffect", waitUntil: str = "commit", retainArtifacts: bool = False,
             timeout: float | None = None) -> "MotorTaskSession":
        """Open a target at `url` (owned, closed with the task) or borrow `targetRef`, and attach a session to it."""

        hasUrl = isinstance(url, str) and len(url) > 0
        hasTarget = isinstance(targetRef, str) and len(targetRef) > 0
        if hasUrl == hasTarget:
            raise TypeError("Motor task requires exactly one url or targetRef")
        ownedTarget = False
        if hasUrl:
            try:
                opened = client.openTarget(url, expectedRisk=expectedRisk, waitUntil=waitUntil, timeout=timeout)
            except ControlError as error:
                # The site sent the new tab outside the permission: the task cannot start there, so its tab is closed.
                held = error.details.get("targetRef") if isinstance(error.details, dict) else None
                if error.code == "BROWSER_CONTROL_SURFACE_HELD" and held:
                    try:
                        client.closeTarget(str(held), timeout=timeout)
                    except ControlError:
                        pass
                raise
            targetRef = str(opened.output["targetRef"])
            ownedTarget = True
        assert targetRef is not None
        try:
            attached = client.attachSession(targetRef, timeout=timeout)
        except BaseException:
            if ownedTarget:
                try:
                    client.closeTarget(targetRef, timeout=timeout)
                except Exception:  # noqa: BLE001 - the attach failure is the error the caller must see
                    pass
            raise
        return cls(client, targetRef=targetRef, sessionRef=attached.output, ownedTarget=ownedTarget,
                   retainArtifacts=retainArtifacts is True)

    def __enter__(self) -> "MotorTaskSession":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _open(self) -> None:
        if self._closed:
            raise RuntimeError("Motor task session is closed")

    def situate(self, focus: Mapping[str, Any], *, channels: Sequence[str] | None = None,
                visual: Mapping[str, Any] | None = None, budget: Mapping[str, Any] | None = None,
                profile: Sequence[str] | None = None, timeout: float | None = None) -> SituationResult:
        """Observe a Situation in this task's session; only Situations observed here can be executed."""

        self._open()
        result = self.client.perception(self.sessionRef).situate(focus, channels=channels, visual=visual,
                                                                 budget=budget, profile=profile, timeout=timeout)
        situation = result.situation
        for probe in situation.get("visualProbes") or []:
            artifact = probe.get("artifact") if isinstance(probe, Mapping) else None
            artifactRef = artifact.get("artifactRef") if isinstance(artifact, Mapping) else None
            if isinstance(artifactRef, str):
                self._artifacts.add(artifactRef)
        self._situations.add(str(situation["integrity"]["canonicalSha256"]))
        return result

    def diagnoseAmbiguity(self, situation: SituationResult | Mapping[str, Any],
                          requirementRef: str) -> MotorAmbiguityDiagnostic:
        """Whether a requirement settled on one complete target; when not, the predicates a caller must add."""

        self._open()
        capsule = _capsule(situation)
        requirement = _requirementOf(capsule, requirementRef)
        executable = _settled(capsule, requirement, requirementRef) and len(requirement.get("entityRefs") or []) == 1
        matched = int(requirement.get("matched") or 0)
        return MotorAmbiguityDiagnostic(
            requirementRef=requirementRef,
            state="unique" if executable else "ambiguous" if matched > 1 else "incomplete",
            matched=matched,
            canExecute=executable,
            requiredCallerRefinement=() if executable else _REFINEMENT,
        )

    def execute(self, situation: SituationResult | Mapping[str, Any], requirementRef: str,
                intent: ActuationIntent | Mapping[str, Any], *, destinationRequirementRef: str | None = None,
                applicationId: str | None = None, nativePostcondition: Mapping[str, str] | None = None,
                timeout: float | None = None) -> ControlResult:
        """Execute one absolute intent against a requirement of a Situation this task observed, once."""

        self._open()
        capsule = _capsule(situation)
        if str((capsule.get("integrity") or {}).get("canonicalSha256")) not in self._situations:
            raise TypeError("Motor task can execute only a SituationCapsule observed by this session")
        requirement = _requirementOf(capsule, requirementRef)
        if not _settled(capsule, requirement, requirementRef):
            raise TypeError("Motor task requires explicit refinement to one complete target before execution")
        operation: dict[str, Any] = {
            "situation": dict(capsule),
            "requirementRef": requirementRef,
            "intent": intent.toMapping() if isinstance(intent, ActuationIntent) else plainMapping(intent, "intent"),
            "sessionRef": self.sessionRef,
        }
        if destinationRequirementRef is not None:
            operation["destinationRequirementRef"] = destinationRequirementRef
        if applicationId is not None:
            operation["applicationId"] = applicationId
        if nativePostcondition is not None:
            operation["nativePostcondition"] = plainMapping(nativePostcondition, "nativePostcondition")
        return self.client.executeMotor(operation, timeout=timeout)

    def retainArtifact(self, artifactRef: str) -> dict[str, Any]:
        """Keep an artifact this task produced when the task closes."""

        self._open()
        if artifactRef not in self._artifacts:
            raise TypeError("Motor task artifact is not owned by this session")
        self._retained.add(artifactRef)
        return {"artifactRef": artifactRef, "retained": True}

    def close(self, *, timeout: float | None = None) -> MotorTaskCleanup:
        """Detach the session, delete unretained artifacts, and close an owned target; closing again returns the same
        cleanup."""

        if self._cleanup is not None:
            return self._cleanup
        self._closed = True
        failures: list[MotorCleanupFailure] = []
        try:
            self.client.detachSession(self.sessionRef, timeout=timeout)
        except Exception as error:  # noqa: BLE001 - every cleanup phase runs and reports its own failure
            failures.append(_failure("sessionDetach", error))
        if not self.retainArtifacts:
            for artifactRef in sorted(self._artifacts - self._retained):
                try:
                    self.client.deleteArtifact(artifactRef, timeout=timeout)
                except Exception as error:  # noqa: BLE001
                    failures.append(_failure("artifactDelete", error))
        if self.ownedTarget:
            try:
                self.client.closeTarget(self.targetRef, timeout=timeout)
            except Exception as error:  # noqa: BLE001
                failures.append(_failure("targetClose", error))
        self._cleanup = MotorTaskCleanup(
            state="incomplete" if failures else "complete",
            targetOwnership="owned" if self.ownedTarget else "borrowed",
            artifactsRetained=len(self._retained),
            failures=tuple(failures),
        )
        return self._cleanup


def _capsule(situation: SituationResult | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(situation, SituationResult):
        return situation.situation
    if not isinstance(situation, Mapping):
        raise TypeError("SituationCapsule must be an object")
    inner = situation.get("situation")
    return inner if isinstance(inner, Mapping) else situation


def _requirementOf(capsule: Mapping[str, Any], requirementRef: str) -> Mapping[str, Any]:
    matches = [entry for entry in capsule.get("requirements") or []
               if isinstance(entry, Mapping) and entry.get("requirementRef") == requirementRef]
    if len(matches) != 1:
        raise TypeError("Motor task requirement must be unique")
    return matches[0]


def _settled(capsule: Mapping[str, Any], requirement: Mapping[str, Any], requirementRef: str) -> bool:
    unknown = any(isinstance(entry, Mapping) and entry.get("requirementRef") == requirementRef
                  for entry in capsule.get("unknowns") or [])
    return (requirement.get("state") == "satisfied" and requirement.get("cardinality") == "one"
            and requirement.get("matched") == 1 and not unknown)


def _failure(phase: Literal["sessionDetach", "artifactDelete", "targetClose"],
             error: BaseException) -> MotorCleanupFailure:
    return MotorCleanupFailure(phase=phase, code=str(getattr(error, "code", "") or "MOTOR_TASK_CLEANUP_FAILED"))


__all__ = [
    "ActuationIntent",
    "ActuationIntentKind",
    "ActuatorKind",
    "MotorAmbiguityDiagnostic",
    "MotorAuthority",
    "MotorCleanupFailure",
    "MotorPolicy",
    "MotorTarget",
    "MotorTaskCleanup",
    "MotorTaskSession",
    "actuationDigest",
    "canonicalActuationJson",
]
