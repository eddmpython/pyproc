"""Installed Python SDK journey against the packed npm Control Protocol product."""

import hashlib
import json
import sys
import time

from pyprocControl import ControlError, PyProcClient


configPath, targetUrl = sys.argv[1:3]
report = PyProcClient.check(configPath)
assert report["ok"] is True and report["automation"]["enabled"] is True

with PyProcClient.start(configPath, startupTimeout=60.0) as client:
    assert len(client.operations) == 14
    client.runPython("prepared = [10, 20, 30]", timeout=60.0)
    checkpoint = client.saveCheckpoint(timeout=60.0)
    client.runPython("prepared.append(999)\nleak = 'dirty'", timeout=60.0)
    client.restoreCheckpoint(checkpoint.output["index"], timeout=60.0)
    restored = client.runPython("(len(prepared), 'leak' in globals())", timeout=60.0)
    assert restored.output["value"] == "(3, False)"

    cancelRequest = client.requestAsync("machine.run", {
        "code": "import time\npythonEffect = 'applied'\ntime.sleep(1.0)"
    }, requestId="python:cancel")
    time.sleep(0.1)
    assert cancelRequest.cancel("Python SDK product cancellation") is True
    cancelError = None
    try:
        cancelRequest.result(10.0)
    except ControlError as error:
        cancelError = error
    assert cancelError is not None and cancelError.code == "CONTROL_CANCELLED"
    assert cancelError.outcome == "outcomeUnknown" and cancelError.retryable is False
    time.sleep(1.1)
    assert client.runPython("pythonEffect", timeout=60.0).output["value"] == "'applied'"

    permissionError = None
    try:
        client.request("automation.target.open", {"url": targetUrl}, timeout=30.0)
    except ControlError as error:
        permissionError = error
    assert permissionError is not None and permissionError.code == "BROWSER_CONTROL_PERMISSION_DENIED"
    assert permissionError.outcome == "notSent"

    opened = client.openTarget(targetUrl, expectedRisk="externalEffect", waitUntil="load", timeout=60.0)
    attached = client.attachSession(opened.output["targetRef"], timeout=30.0)
    captured = client.act(attached.output, [
        {"kind": "screenshot", "format": "png", "expectedRisk": "read"}
    ], timeout=60.0)
    assert captured.outcome == "observed" and len(captured.attachments) == 1
    attachment = captured.attachments[0]
    assert attachment.mimeType == "image/png"
    assert attachment.bytes[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10])
    assert hashlib.sha256(attachment.bytes).hexdigest() == attachment.sha256
    assert "dataBase64" not in json.dumps(captured.output)
    artifactRef = captured.output["actions"][0]["result"]["artifactRef"]
    assert client.deleteArtifact(artifactRef, timeout=30.0).output["deleted"] is True
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

print(json.dumps({"ok": True, "operations": 14, "checkpoint": checkpoint.output["index"],
                  "attachmentBytes": attachment.byteLength, "cancelOutcome": cancelError.outcome}))
