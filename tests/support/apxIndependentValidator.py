"""Independent APX interaction core validator using only the Python standard library."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from decimal import Decimal
from pathlib import Path


def numberText(value: int | float) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("number must be numeric")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise TypeError("number must be finite")
    if value == 0:
        return "0"
    absolute = abs(value)
    source = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        if value.is_integer():
            return str(int(value))
        return format(Decimal(source), "f")
    if "e" not in source:
        source = format(value, ".15e")
    mantissa, exponent = source.split("e", 1)
    mantissa = mantissa.rstrip("0").rstrip(".")
    exponentValue = int(exponent)
    exponentSign = "+" if exponentValue >= 0 else "-"
    return f"{mantissa}e{exponentSign}{abs(exponentValue)}"


def canonicalJson(value: object, depth: int = 0) -> str:
    if depth > 40:
        raise TypeError("canonical depth exceeded")
    if value is None or isinstance(value, bool):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        return numberText(value)
    if isinstance(value, list):
        return "[" + ",".join(canonicalJson(entry, depth + 1) for entry in value) + "]"
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        entries = (json.dumps(key, ensure_ascii=False) + ":" + canonicalJson(value[key], depth + 1)
                   for key in sorted(value))
        return "{" + ",".join(entries) + "}"
    raise TypeError("value must be plain JSON")


def digest(value: object) -> str:
    return hashlib.sha256(canonicalJson(value).encode("utf-8")).hexdigest()


def candidateState(cardinality: str, enumeration: str, matched: int) -> str:
    if cardinality == "one":
        if matched > 1:
            return "conflicted"
        return "satisfied" if enumeration == "complete" and matched == 1 else "unknown"
    if cardinality == "oneOrMore":
        return "satisfied" if enumeration == "complete" and matched > 0 else "unknown"
    return "satisfied" if enumeration == "complete" else "unknown"


def verificationState(vector: dict[str, object]) -> str:
    if vector.get("directMatch") is True:
        return "confirmed"
    if vector.get("directMismatch") is True and vector.get("windowComplete") is True:
        return "contradicted"
    return "notObserved" if vector.get("windowComplete") is True else "ambiguous"


def envelopeRejected(value: object) -> bool:
    if not isinstance(value, dict):
        return True
    if set(value) != {"schemaVersion", "extensionPolicy"}:
        return True
    return value.get("schemaVersion") != "apx.interop/1" or value.get("extensionPolicy") != "rejectUnknown"


def validate(vectors: dict[str, object]) -> dict[str, object]:
    if set(vectors) != {"schemaVersion", "extensionPolicy", "canonicalVectors", "candidateVectors",
                       "verificationVectors", "negativeEnvelopes"}:
        raise ValueError("golden vector envelope has unknown fields")
    if vectors["schemaVersion"] != "apx.interop/1" or vectors["extensionPolicy"] != "rejectUnknown":
        raise ValueError("golden vector schema is unsupported")
    canonicalDigests = []
    for vector in vectors["canonicalVectors"]:
        canonical = canonicalJson(vector["value"])
        sha256 = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if canonical != vector["canonical"] or sha256 != vector["sha256"]:
            raise ValueError(f"canonical vector failed: {vector['id']}")
        canonicalDigests.append(sha256)
    candidateTerminals = []
    for vector in vectors["candidateVectors"]:
        state = candidateState(vector["cardinality"], vector["enumeration"], vector["matched"])
        authorized = state == "satisfied"
        if state != vector["expectedState"] or authorized != vector["expectedAuthorized"]:
            raise ValueError(f"candidate vector failed: {vector['id']}")
        candidateTerminals.append({"id": vector["id"], "state": state, "authorized": authorized})
    verificationTerminals = []
    for vector in vectors["verificationVectors"]:
        state = verificationState(vector)
        if state != vector["expectedState"]:
            raise ValueError(f"verification vector failed: {vector['id']}")
        verificationTerminals.append({"id": vector["id"], "state": state})
    negativeVerdicts = []
    for vector in vectors["negativeEnvelopes"]:
        rejected = envelopeRejected(vector["value"])
        if rejected != vector["expectedRejected"]:
            raise ValueError(f"negative vector failed: {vector['id']}")
        negativeVerdicts.append({"id": vector["id"], "rejected": rejected})
    core = {"canonicalDigests": canonicalDigests, "candidateTerminals": candidateTerminals,
            "verificationTerminals": verificationTerminals}
    return {"implementation": "independent-python-stdlib", "schemaVersion": vectors["schemaVersion"],
            **core, "negativeVerdicts": negativeVerdicts, "coreDigest": digest(core)}


def main() -> None:
    vectorPath = Path(sys.argv[1])
    vectors = json.loads(vectorPath.read_text(encoding="utf-8"))
    print(json.dumps(validate(vectors), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
