"""Run the installed Motor task journey through the public Python client and print what each step returned.

The Node gate runs the same journey through the JavaScript client first and compares: terminals, provider calls,
ambiguity diagnostics, cleanup, the closed-task error, and every receipt digest recomputed here from the receipt body.
"""

from __future__ import annotations

import json
import os
import sys

from pyprocControl import (
    ActuationIntent,
    MotorAuthority,
    MotorPolicy,
    MotorTarget,
    PyProcClient,
    actuationDigest,
    canonicalActuationJson,
)

TIMEOUT = 300.0


def main() -> None:
    configPath, nodePath, controlScript, origin, corpusPath = sys.argv[1:6]
    with open(corpusPath, encoding="utf-8") as corpusFile:
        corpus = json.load(corpusFile)
    client = PyProcClient.start(configPath, command=[nodePath, controlScript], startupTimeout=TIMEOUT,
                                environment=dict(os.environ))
    try:
        spaceRef = client.inspectSpace(timeout=TIMEOUT).output["space"]["spaceId"]
        task = client.openMotorTask(url=f"{origin}/fixture", expectedRisk="externalEffect", timeout=TIMEOUT)

        def observe(requirementRef: str, role: str, name: str, **select: object):
            return task.situate({"requirements": [{"requirementRef": requirementRef,
                                                   "select": {"role": role, "name": name, **select},
                                                   "need": ["fact", "affordance"], "cardinality": "one"}]},
                                visual={"mode": "off"},
                                budget={"maxEntities": 100, "maxRelations": 200, "maxBytes": 131072},
                                timeout=TIMEOUT)

        def intentFor(situation, kind: str, action: str, desired: dict, expectedTransition: dict) -> ActuationIntent:
            capsule = situation.situation
            affordance = next(entry for entry in capsule["affordances"]
                              if entry["kind"] == "authorized" and entry["action"] == action)
            return ActuationIntent(
                intent=kind,  # type: ignore[arg-type]
                target=MotorTarget(spaceRef=spaceRef, entityRef=capsule["requirements"][0]["entityRefs"][0],
                                   worldRef=capsule["worldRef"], surfaceEpoch=f"document:{capsule['documentEpoch']}"),
                desired=desired,
                authority=MotorAuthority(actionCapabilityRef=affordance["capabilityRef"]),
                policy=MotorPolicy(allowedActuatorKinds=("browserInput",)),
                expectedTransition=expectedTransition,
            )

        save = observe("requirement:save", "button", "Save")
        saved = task.execute(save, "requirement:save", intentFor(save, "activate", "click", {"activated": True}, {
            "all": [{"entityAppeared": {"role": "status", "name": "saved"}},
                    {"networkResponse": {"method": "POST", "urlPath": "/save", "status": 201}}],
            "withinMs": 5000}), timeout=TIMEOUT)
        keep = observe("requirement:keep", "checkbox", "Keep")
        kept = task.execute(keep, "requirement:keep", intentFor(keep, "setSelected", "check", {"selected": True}, {}),
                            timeout=TIMEOUT)
        duplicate = observe("requirement:duplicate", "button", "Duplicate")
        diagnostic = task.diagnoseAmbiguity(duplicate, "requirement:duplicate")
        try:
            task.execute(duplicate, "requirement:duplicate",
                         intentFor(save, "activate", "click", {"activated": True}, {}), timeout=TIMEOUT)
            ambiguousError = ""
        except TypeError as error:
            ambiguousError = str(error)
        refined = observe("requirement:duplicate-actionable", "button", "Duplicate", actionable=True)
        refinedDiagnostic = task.diagnoseAmbiguity(refined, "requirement:duplicate-actionable")
        targetRef = task.targetRef
        cleanup = task.close(timeout=TIMEOUT)
        try:
            task.situate({"requirements": []}, timeout=TIMEOUT)
            closedError = ""
        except RuntimeError as error:
            closedError = str(error)
        remaining = [entry["targetRef"] for entry in client.listTargets(timeout=TIMEOUT).output]

        def receiptView(result) -> dict:
            receipt = dict(result.output["receipt"])
            server = receipt.pop("receiptSha256")
            return {"terminal": result.output["terminal"], "providerCalls": receipt["effectWindow"]["providerCalls"],
                    "server": server, "local": actuationDigest(receipt)}

        print(json.dumps({
            "receipts": [receiptView(saved), receiptView(kept)],
            "diagnostic": diagnostic.toMapping(),
            "ambiguousError": ambiguousError,
            "refinedDiagnostic": refinedDiagnostic.toMapping(),
            "cleanup": cleanup.toMapping(),
            "closedAgain": task.close(timeout=TIMEOUT) is cleanup,
            "closedError": closedError,
            "targetClosed": targetRef not in remaining,
            "canonical": [canonicalActuationJson(value) for value in corpus],
        }, separators=(",", ":")))
    finally:
        client.close()


if __name__ == "__main__":
    main()
