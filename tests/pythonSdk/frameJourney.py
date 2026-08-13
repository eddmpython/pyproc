"""Installed Python SDK journey against the packed FrameSpace provider."""

import hashlib
import json
import sys

from pyprocControl import PyProcClient


configPath, targetUrl = sys.argv[1:3]
report = PyProcClient.check(configPath)
assert report["ok"] is True and report["automation"]["provider"] == "frame"

with PyProcClient.start(configPath, startupTimeout=60.0) as client:
    assert len(client.operations) == 16 and "automation.command" not in client.operations
    assert client.runPython("frame_python = 40", timeout=60.0).output.get("value") is None
    assert client.runPython("frame_python + 2", timeout=60.0).output["value"] == "42"
    inspected = client.inspectSpace(timeout=30.0)
    assert inspected.output["space"]["providerKind"] == "frame"
    opened = client.openTarget(targetUrl, expectedRisk="externalEffect", waitUntil="load", timeout=60.0)
    assert opened.output["parentAccessible"] is False
    attached = client.attachSession(opened.output["targetRef"], timeout=30.0)
    observed = client.observe(attached.output, {"expectedRisk": "read"}, timeout=30.0)
    assert observed.output["parentAccessible"] is False
    eyes = client.perception(attached.output)
    heading = eyes.query(
        role="heading", name="python-sdk-ready", timeout=30.0).one()
    assert heading.entityRef.startswith("entity:") and heading.name == "python-sdk-ready"
    situation = eyes.situate({"requirements": [{"requirementRef": "requirement:heading",
                              "select": {"role": "heading", "name": "python-sdk-ready"},
                              "need": ["fact"], "cardinality": "one"}]}, timeout=30.0)
    assert situation.requirement("requirement:heading").state == "satisfied"
    captured = client.act(attached.output, [
        {"kind": "screenshot", "expectedRisk": "read"}
    ], timeout=60.0)
    assert captured.outcome == "observed" and len(captured.attachments) == 1
    attachment = captured.attachments[0]
    assert attachment.bytes[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10])
    assert hashlib.sha256(attachment.bytes).hexdigest() == attachment.sha256
    artifactRef = captured.output["results"][0]["artifactRef"]
    assert client.deleteArtifact(artifactRef, timeout=30.0).output["deleted"] is True
    client.detachSession(attached.output, timeout=30.0)

print(json.dumps({"ok": True, "operations": len(client.operations), "attachmentBytes": attachment.byteLength,
                  "perceptionEntityRef": heading.entityRef, "situationRef": situation.situationRef}))
