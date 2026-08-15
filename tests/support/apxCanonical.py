"""APX custom canonical JSON의 독립 Python parity fixture."""

from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal


def numberText(value: int | float) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("APX number must be numeric")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise TypeError("APX number must be finite")
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


def canonicalApxJson(value: object, depth: int = 0) -> str:
    if depth > 40:
        raise TypeError("APX value exceeds the canonical depth limit")
    if value is None or isinstance(value, bool):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        return numberText(value)
    if isinstance(value, list):
        return "[" + ",".join(canonicalApxJson(entry, depth + 1) for entry in value) + "]"
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        entries = (json.dumps(key, ensure_ascii=False) + ":" + canonicalApxJson(value[key], depth + 1)
                   for key in sorted(value))
        return "{" + ",".join(entries) + "}"
    raise TypeError("APX value must be finite plain JSON")


def main() -> None:
    vectors = [
        {"b": 1, "a": 2},
        {"rect": {"height": 4, "width": 3, "y": 2, "x": 1}, "items": [True, None, -0.0]},
        {"fraction": 1.25, "smallFixed": 0.000001, "smallExponent": 1e-7,
         "largeFixed": 1e20, "largeExponent": 1e21},
        {"한글": "값", "combining": "e\u0301", "control": "line\nbreak\tend"},
    ]
    output = [{"canonical": canonicalApxJson(vector),
               "sha256": hashlib.sha256(canonicalApxJson(vector).encode("utf-8")).hexdigest()}
              for vector in vectors]
    rejected = 0
    for invalid in [float("nan"), float("inf"), {"bad": object()}]:
        try:
            canonicalApxJson(invalid)
        except TypeError:
            rejected += 1
    print(json.dumps({"vectors": vectors, "output": output, "rejected": rejected},
                     ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
