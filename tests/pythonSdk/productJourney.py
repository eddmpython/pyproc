"""Installed Python SDK journey against the packed npm Control Protocol product."""

import hashlib
import json
import sys
import time
import urllib.request

from pyprocControl import ControlError, PyProcClient


configPath, targetUrl, approvalUrl, effectEvidenceUrl = sys.argv[1:5]
report = PyProcClient.check(configPath)
assert report["ok"] is True and report["automation"]["enabled"] is True

with PyProcClient.start(configPath, startupTimeout=60.0) as client:
    assert len(client.operations) == 34
    prepared = client.runPython("prepared = [10, 20, 30]", timeout=60.0)
    assert prepared.terminal == "completed"
    checkpoint = client.saveCheckpoint(timeout=60.0)
    assert checkpoint.terminal == "completed"
    client.runPython("prepared.append(999)\nleak = 'dirty'", timeout=60.0)
    client.restoreCheckpoint(checkpoint.output["index"], timeout=60.0)
    restored = client.runPython("(len(prepared), 'leak' in globals())", timeout=60.0)
    assert restored.output["value"] == "(3, False)"

    projectIdentity = {"workspaceId": "installed:python", "commit": "fixture",
                       "treeSha256": "sha256:" + "1" * 64,
                       "diffSha256": "sha256:" + "2" * 64, "untracked": False}
    memoryCreated = client.createExecutionSession(
        "session:installed-python", projectIdentity, timeout=60.0)
    memoryOpened = client.openExecutionSession("session:installed-python", timeout=30.0)
    memoryListed = client.listExecutionSessions(timeout=30.0)
    assert memoryCreated.output["contentSha256"] == memoryOpened.output["contentSha256"]
    assert len(memoryOpened.output["machine"]["imageSha256"]) == 64
    assert memoryOpened.output["machine"]["generation"]
    assert any(entry["executionSessionId"] == "session:installed-python"
               for entry in memoryListed.output)

    cancelRequest = client.requestAsync("machine.run", {
        "code": "pythonEffect = 'applied'\nsum(i * i for i in range(5000000))"
    }, requestId="python:cancel")
    time.sleep(0.1)
    assert cancelRequest.cancel("Python SDK product cancellation") is True
    cancelError = None
    try:
        cancelRequest.result(10.0)
    except ControlError as error:
        cancelError = error
    assert cancelError is not None and cancelError.code == "CONTROL_CANCELLED"
    assert cancelError.terminal == "outcomeUnknown"
    assert cancelError.outcome == "outcomeUnknown" and cancelError.retryable is False
    time.sleep(1.1)
    assert client.runPython("pythonEffect", timeout=60.0).output["value"] == "'applied'"

    timeoutError = None
    try:
        client.runPython(
            "timeoutEffect = 'applied'\nsum(i * i for i in range(5000000))", timeout=0.1)
    except ControlError as error:
        timeoutError = error
    assert timeoutError is not None and timeoutError.code == "CONTROL_CANCELLED"
    assert timeoutError.terminal == "outcomeUnknown"
    assert timeoutError.outcome == "outcomeUnknown" and timeoutError.retryable is False
    time.sleep(1.1)
    assert client.runPython("timeoutEffect", timeout=30.0).output["value"] == "'applied'"

    permissionError = None
    try:
        client.request("automation.target.open", {"url": targetUrl}, timeout=30.0)
    except ControlError as error:
        permissionError = error
    assert permissionError is not None and permissionError.code == "BROWSER_CONTROL_PERMISSION_DENIED"
    assert permissionError.terminal == "rejected" and permissionError.outcome == "notSent"

    opened = client.openTarget(targetUrl, expectedRisk="externalEffect", waitUntil="load", timeout=60.0)
    attached = client.attachSession(opened.output["targetRef"], timeout=30.0)
    eyes = client.perception(attached.output)
    heading = eyes.query(
        role="heading", name="python-sdk-ready", timeout=30.0).one()
    assert heading.entityRef.startswith("entity:") and heading.name == "python-sdk-ready"
    situation = eyes.situate({"requirements": [{"requirementRef": "requirement:heading",
                              "select": {"role": "heading", "name": "python-sdk-ready"},
                              "need": ["fact"], "cardinality": "one"}]}, timeout=30.0)
    assert situation.requirement("requirement:heading").state == "satisfied"
    captured = client.act(attached.output, [
        {"kind": "screenshot", "format": "png", "expectedRisk": "read"}
    ], timeout=60.0)
    assert captured.terminal == "completed"
    assert captured.outcome == "observed" and len(captured.attachments) == 1
    attachment = captured.attachments[0]
    assert attachment.mimeType == "image/png"
    assert attachment.bytes[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10])
    assert hashlib.sha256(attachment.bytes).hexdigest() == attachment.sha256
    assert "dataBase64" not in json.dumps(captured.output)
    artifactRef = captured.output["actions"][0]["result"]["artifactRef"]
    assert client.deleteArtifact(artifactRef, timeout=30.0).output["deleted"] is True

    effectTransition = {"all": [
        {"entityAppeared": {"role": "status", "nameContains": "effect committed"}},
        {"networkResponse": {"method": "POST", "urlPath": "/effect", "status": 201}},
    ], "withinMs": 5000}
    effectPrepared = client.prepareEffectTransaction({
        "transactionId": "effect:python-product", "intentId": "intent:python-product",
        "executionSessionId": "session:installed-python",
        "expectedSessionRevisionSha256": memoryCreated.output["contentSha256"],
        "destination": {"origin": targetUrl.rsplit("/", 1)[0],
                        "subjectSha256": hashlib.sha256(b"python-product").hexdigest(),
                        "purpose": "Commit the exact installed Python fixture"},
        "effectTemplate": {"sessionRef": attached.output, "focus": {"requirements": [{
            "requirementRef": "requirement:commit",
            "select": {"role": "button", "name": "Commit", "actionable": True},
            "need": ["fact", "affordance"], "cardinality": "one",
        }]}, "actions": [{"kind": "click", "requirementRef": "requirement:commit",
                            "expectedRisk": "externalEffect", "verify": effectTransition}]},
        "expectedTransition": effectTransition,
    }, timeout=60.0)
    effectRehearsed = client.rehearseEffectTransaction(
        "effect:python-product", effectPrepared.output["transaction"]["contentSha256"],
        {"mode": "computed", "code": "6 * 7", "expectedValue": "42"}, timeout=60.0)
    approvalRequest = urllib.request.Request(approvalUrl, data=json.dumps({
        "intent": effectRehearsed.output["intent"],
        "trustDomainSha256": effectPrepared.output["trustDomain"]["trustDomainSha256"],
    }).encode("utf8"), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(approvalRequest, timeout=30.0) as approvalResponse:
        effectGrant = json.load(approvalResponse)
    effectApproved = client.approveEffectTransaction(
        "effect:python-product", effectRehearsed.output["contentSha256"], effectGrant, timeout=60.0)
    effectTerminal = client.commitEffectTransaction(
        "effect:python-product", effectApproved.output["contentSha256"], timeout=60.0)
    effectRetried = client.commitEffectTransaction(
        "effect:python-product", effectTerminal.output["contentSha256"], timeout=30.0)
    effectListed = client.listEffectTransactions(timeout=30.0)
    effectInspected = client.inspectEffectTransaction("effect:python-product", timeout=30.0)
    assert effectTerminal.output["state"] == "terminal"
    assert effectTerminal.output["effectResult"]["terminal"] == "confirmed"
    assert effectRetried.output["contentSha256"] == effectTerminal.output["contentSha256"]
    assert any(entry["transactionId"] == "effect:python-product" for entry in effectListed.output)
    assert effectInspected.output["transaction"]["contentSha256"] == effectTerminal.output["contentSha256"]
    evidenceRequest = urllib.request.Request(effectEvidenceUrl,
        data=json.dumps(effectTerminal.output).encode("utf8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(evidenceRequest, timeout=30.0) as evidenceResponse:
        effectEvidenceDir = json.load(evidenceResponse)["outputDir"]
    effectSealed = client.sealEffectTransaction(
        "effect:python-product", effectTerminal.output["contentSha256"], effectEvidenceDir, timeout=30.0)
    assert effectSealed.output["state"] == "sealed"
    assert effectSealed.output["receipt"]["evidencePackSha256"]
    client.detachSession(attached.output, timeout=30.0)

    first = client.request("machine.run", {"code": "6 * 7"}, requestId="python:single-use", timeout=30.0)
    duplicate = None
    try:
        client.request("machine.run", {"code": "duplicateEffect = True"},
                       requestId="python:single-use", timeout=30.0)
    except ControlError as error:
        duplicate = error
    assert first.output["value"] == "42" and duplicate is not None
    assert duplicate.code == "CONTROL_REQUEST_DUPLICATE"
    assert client.runPython("'duplicateEffect' in globals()", timeout=30.0).output["value"] == "False"

print(json.dumps({"ok": True, "operations": len(client.operations), "checkpoint": checkpoint.output["index"],
                  "attachmentBytes": attachment.byteLength, "cancelOutcome": cancelError.outcome,
                  "cancelTerminal": cancelError.terminal, "timeoutOutcome": timeoutError.outcome,
                  "timeoutTerminal": timeoutError.terminal, "permissionTerminal": permissionError.terminal,
                  "successTerminal": captured.terminal, "perceptionEntityRef": heading.entityRef,
                  "situationRef": situation.situationRef, "executionMemory": True,
                  "effectTerminal": effectTerminal.output["effectResult"]["terminal"],
                  "effectSealed": effectSealed.output["state"] == "sealed"}))
