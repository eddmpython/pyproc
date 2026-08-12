"""Ergonomic APX perception facade over the stable Control Protocol operations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .models import ControlResult


def plainMapping(value: Mapping[str, Any] | None, label: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise TypeError(f"{label} must be a mapping")
    return dict(value)


@dataclass(frozen=True, slots=True)
class PerceptionEntity:
    """One immutable entity returned by an APX attention query."""

    value: Mapping[str, Any]

    @property
    def entityRef(self) -> str:
        return str(self.value.get("entityRef") or "")

    @property
    def locatorRef(self) -> str | None:
        value = self.value.get("locatorRef")
        return str(value) if value is not None else None

    @property
    def kind(self) -> str:
        return str(self.value.get("kind") or "")

    @property
    def role(self) -> str:
        semantic = self.value.get("semantic")
        return str(semantic.get("role") or "") if isinstance(semantic, Mapping) else ""

    @property
    def name(self) -> str:
        semantic = self.value.get("semantic")
        return str(semantic.get("name") or "") if isinstance(semantic, Mapping) else ""

    @property
    def actionable(self) -> bool:
        interaction = self.value.get("interaction")
        return bool(interaction.get("actionable")) if isinstance(interaction, Mapping) else False


@dataclass(frozen=True, slots=True)
class PerceptionQueryResult:
    """Bounded APX observation plus convenient typed query matches."""

    result: ControlResult

    @property
    def observation(self) -> Mapping[str, Any]:
        if not isinstance(self.result.output, Mapping):
            raise TypeError("APX observation output must be a mapping")
        return self.result.output

    @property
    def matches(self) -> tuple[PerceptionEntity, ...]:
        entities = self.observation.get("entities")
        if not isinstance(entities, list):
            raise TypeError("APX observation entities must be a list")
        return tuple(PerceptionEntity(value) for value in entities if isinstance(value, Mapping))

    def one(self) -> PerceptionEntity:
        matches = self.matches
        query = self.observation.get("query")
        matched = query.get("matched") if isinstance(query, Mapping) else None
        count = matched if isinstance(matched, int) and not isinstance(matched, bool) else len(matches)
        if count != 1 or len(matches) != 1:
            received = len(matches) if count == 1 else count
            raise LookupError(f"APX query expected one entity, received {received}")
        return matches[0]


class PerceptionClient:
    """Session-bound APX observe, query, and evidence-backed action facade."""

    def __init__(self, client: Any, sessionRef: Mapping[str, Any] | None = None) -> None:
        self.client = client
        self.sessionRef = dict(sessionRef) if sessionRef is not None else None

    def bind(self, sessionRef: Mapping[str, Any]) -> "PerceptionClient":
        return PerceptionClient(self.client, plainMapping(sessionRef, "sessionRef"))

    def _session(self, sessionRef: Mapping[str, Any] | None) -> dict[str, Any]:
        selected = sessionRef if sessionRef is not None else self.sessionRef
        if selected is None:
            raise ValueError("APX perception requires an attached sessionRef")
        return plainMapping(selected, "sessionRef")

    def observe(self, *, sessionRef: Mapping[str, Any] | None = None,
                since: str | None = None, channels: Sequence[str] | None = None,
                visual: Mapping[str, Any] | None = None, budget: Mapping[str, Any] | None = None,
                query: Mapping[str, Any] | None = None, profile: Sequence[str] | None = None,
                timeout: float | None = None) -> ControlResult:
        options: dict[str, Any] = {"expectedRisk": "read", "representation": "apx.graph"}
        if since is not None:
            options["since"] = since
        if channels is not None:
            options["channels"] = list(channels)
        if visual is not None:
            options["visual"] = plainMapping(visual, "visual")
        if budget is not None:
            options["budget"] = plainMapping(budget, "budget")
        if query is not None:
            options["query"] = plainMapping(query, "query")
        if profile is not None:
            options["profile"] = list(profile)
        return self.client.observe(self._session(sessionRef), options, timeout=timeout)

    def query(self, *, sessionRef: Mapping[str, Any] | None = None,
              entityRef: str | None = None, kind: str | None = None,
              role: str | None = None, name: str | Mapping[str, str] | None = None,
              state: Mapping[str, Any] | None = None, actionable: bool | None = None,
              changedSince: str | None = None, since: str | None = None,
              channels: Sequence[str] | None = None, budget: Mapping[str, Any] | None = None,
              timeout: float | None = None) -> PerceptionQueryResult:
        query = {key: value for key, value in {
            "entityRef": entityRef, "kind": kind, "role": role, "name": name,
            "state": dict(state) if state is not None else None, "actionable": actionable,
            "changedSince": changedSince,
        }.items() if value is not None}
        result = self.observe(sessionRef=sessionRef, since=since, channels=channels,
                              budget=budget, query=query, timeout=timeout)
        return PerceptionQueryResult(result)

    def act(self, kind: str, locatorRef: str, *, sessionRef: Mapping[str, Any] | None = None,
            expectedRisk: str = "externalEffect", verify: Mapping[str, Any] | None = None,
            timeout: float | None = None, **options: Any) -> ControlResult:
        action = {"kind": kind, "locatorRef": locatorRef, "expectedRisk": expectedRisk, **options}
        if verify is not None:
            action["verify"] = plainMapping(verify, "verify")
        return self.client.act(self._session(sessionRef), [action], timeout=timeout)

    def explainActionability(self, entityRef: str, *, sessionRef: Mapping[str, Any] | None = None,
                             timeout: float | None = None) -> PerceptionEntity:
        return self.query(sessionRef=sessionRef, entityRef=entityRef,
                          channels=["semantic", "geometry", "interaction"], timeout=timeout).one()

    def whatChanged(self, since: str, *, sessionRef: Mapping[str, Any] | None = None,
                    timeout: float | None = None) -> ControlResult:
        return self.observe(sessionRef=sessionRef, since=since, timeout=timeout)
