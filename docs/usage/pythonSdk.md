# Python SDK

The official `pyproc-control` Python package starts and controls the installed npm product without
JavaScript application code. The SDK has no runtime dependency and supports Python 3.10 or newer.

The two packages have separate jobs:

- npm `pyproc` ships the browser runtime, `pyproc-control` command, policy manifest, and engine tooling.
- Python `pyproc-control` ships the strict protocol client, typed values, cancellation, and attachment
  verification.

Pin both packages to the same version. This release uses `0.0.21` for each.

## Install

```sh
npm install --save-exact pyproc@0.0.21
npx pyproc-engine --out /absolute/path/to/pyodide
python -m pip install \
  "https://github.com/eddmpython/pyproc/releases/download/v0.0.21/pyproc_control-0.0.21-py3-none-any.whl"
```

The Python distribution is currently published as wheel and source distribution assets on the matching
GitHub Release. PyPI is not an installation source yet. Use the exact-version asset URL because floating
release URLs are outside the reproducible installation contract.

Create the version 1 manifest with [Machine Entrance](machineEntrance.md). A Python-only recipe expands to
`"browser": { "enabled": false }`. Run the complete doctor before use:

```sh
npx pyproc-mcp init --recipe pythonOnly --engine-root /absolute/path/to/pyodide
npx pyproc-control doctor --config ./.pyproc/manifest.json
```

```python
from pyprocControl import PyProcClient

report = PyProcClient.check(".pyproc/manifest.json")
print(report["engine"])
```

The npm bin directory must be on `PATH`. An embedded application can instead pass an explicit command list
such as `command=[nodePath, controlScriptPath]`.

## Persistent Python and checkpoint recovery

```python
from pyprocControl import PyProcClient

with PyProcClient.start(".pyproc/manifest.json") as client:
    client.runPython("prepared = [10, 20, 30]")
    checkpoint = client.saveCheckpoint()

    try:
        client.runPython("prepared.append(999)\nraise ValueError('failed attempt')")
    except Exception:
        client.restoreCheckpoint(checkpoint.output["index"])

    result = client.runPython("prepared")
    print(result.output["value"])
```

`ControlResult` contains `terminal="completed"`, `output`, `outcome`, and an ordered tuple of verified
`attachments`. `ControlError.terminal` is `rejected`, `partial`, `outcomeUnknown`, or `cancelled` while preserving
the protocol `code`, `outcome`, and retryability. Machine state persists for the life of the client. `reset()`
restores the prepared boot checkpoint.

## Execution Memory

Add `--execution-memory-root /absolute/private/pyproc-memory` to `pyproc-mcp init`. The Python client then uses
the same immutable revisions as JavaScript and MCP:

```python
project = {
    "workspaceId": "workspace:forecast",
    "commit": "exact-commit",
    "treeSha256": "sha256:...",
    "diffSha256": "sha256:...",
    "untracked": False,
}
created = client.createExecutionSession("session:forecast", project)
opened = client.openExecutionSession("session:forecast")
assert created.output["contentSha256"] == opened.output["contentSha256"]
```

`checkpointExecutionSession`, `completeExecutionSession`, `listExecutionSessions`,
`inspectExecutionSession`, `exportExecutionHandoff`, and `importExecutionHandoff` map directly to the Control
operations. The registry persists state, not the client object. See [Execution Memory](executionMemory.md).

## Rehearse-Commit transactions

An effect-enabled profile exposes the same transaction lifecycle as JavaScript and MCP:

```python
prepared = client.prepareEffectTransaction(intentInput)
rehearsed = client.rehearseEffectTransaction(
    intentInput["transactionId"],
    prepared.output["transaction"]["contentSha256"],
    {"mode": "computed", "code": "6 * 7", "expectedValue": "42"},
)
approved = client.approveEffectTransaction(
    intentInput["transactionId"], rehearsed.output["contentSha256"], signedGrant)
terminal = client.commitEffectTransaction(
    intentInput["transactionId"], approved.output["contentSha256"])
sealed = client.sealEffectTransaction(
    intentInput["transactionId"], terminal.output["contentSha256"], evidencePackDir)
```

`inspectEffectTransaction` and `listEffectTransactions` are read-only lifecycle queries. The Python package
does not mint approval authority; pass a canonical grant produced by the separately trusted issuer. Recovery
from a durable `sending` state never repeats the provider call. See [Rehearse-Commit](rehearseCommit.md).

## Transactional AppSpace

An AppSpace-enabled FrameSpace profile exposes `attachApp`, `checkpointApp`, `branchApp`, `restoreApp`,
`adoptApp`, `inspectApp`, `listAppPairs`, `stageAppEffect`, and `finalizeAppEffect`. These methods send the same
canonical `app.*` operations as JavaScript and MCP. The installed AppSpace gate reopens the durable list through
all three clients and requires the same active pair digest.

The Python client does not implement an independent app state machine. Live pair restore still requires the
originating control process and its in-process Machine checkpoints. See [Transactional AppSpace](appSpace.md).

## ReplayGraph Worlds

A ReplayGraph-enabled profile exposes `importReplayGraphRecording`, `createReplayGraphAppWorld`,
`captureReplayGraphAppBranch`, `openReplayWorld`, `inspectReplayWorld`, `listReplayWorldEdges`,
`traverseReplayWorld`, `checkpointReplayWorld`, `restoreReplayWorld`, `evaluateReplayWorld`,
`inspectReplayWorldCoverage`, and `listReplayGraphs`. These methods send the same canonical `world.*`
operations as JavaScript and MCP.

The Python client owns no independent graph state. Durable revisions live under the shared Execution Memory root;
open cursor references and checkpoints remain in the originating Control process. The installed product gate
imports and reopens the same root through Python, JavaScript, and MCP without calling a live provider. See
[ReplayGraph Worlds](replayGraph.md).

## Browser automation and screenshots

Browser operations appear only when the manifest grants automation authority. Risk is fixed by the product
catalog and must be acknowledged on each effect:

```python
with PyProcClient.start(".pyproc/manifest.json") as client:
    opened = client.openTarget(
        "https://example.test",
        expectedRisk="externalEffect",
        waitUntil="load",
    )
    attached = client.attachSession(opened.output["targetRef"])
    captured = client.act(attached.output, [
        {"kind": "screenshot", "format": "png", "expectedRisk": "read"}
    ])

    png = captured.attachments[0]
    assert png.mimeType == "image/png"
    with open("capture.png", "wb") as file:
        file.write(png.bytes)

    client.detachSession(attached.output)
```

The client does not expose attachment bytes until chunk order, byte length, MIME type, and SHA-256 match the
terminal descriptor. The JSON output retains the opaque artifact reference for bounded reads and deletion.

## PyProc Eyes from Python

`client.perception(sessionRef)` binds provider-neutral APX graph and situation representations to one attached
session. It uses the same
`automation.observe` and `automation.act` operations as MCP and native JavaScript clients, so Python does not
gain a second automation meaning or a raw CDP entrance.

```python
with PyProcClient.start(".pyproc/manifest.json") as client:
    opened = client.openTarget(
        "https://example.test",
        expectedRisk="externalEffect",
        waitUntil="load",
    )
    attached = client.attachSession(opened.output["targetRef"])
    eyes = client.perception(attached.output)

    situation = eyes.situate({"requirements": [{
        "requirementRef": "requirement:save",
        "select": {"role": "button", "name": "Save", "actionable": True},
        "need": ["fact", "affordance"],
        "cardinality": "one",
    }]})
    save = situation.requirement("requirement:save").oneAffordance("click")
    result = eyes.actAffordance(
        save,
        intent="Save the document",
        verify={"entityAppeared": {"role": "status", "nameContains": "Saved"}},
    )
    assert result.output["actions"][0]["result"]["evidence"]["verification"]["state"] == "confirmed"
```

`SituationResult` exposes immutable requirements, facts, affordances, and unknowns. Only an authorized
`SituationAffordance` can be passed to `actAffordance`; page-reported affordances remain content. The older
`PerceptionEntity` exposes `entityRef`, `locatorRef`, `kind`, `role`, `name`, and `actionable` properties.
`query(...).one()` checks APX `query.matched` and rejects zero or multiple matches even when the byte budget
returns only one candidate. `whatChanged(observationRef)` requests
a delta, while `explainActionability(entityRef)` narrows the graph to semantic, geometry, and interaction
facts. Observation identity never grants action authority, and locator capability remains short-lived.

Native CDP supports verified pixel-on-demand attachments. FrameSpace supports APX through temporal level L3
but rejects visual inference. See the [APX 1.0 product contract](../specs/apx/README.md) for the graph and evidence
contract.

## Proof-Carrying Motor from Python

The Python facade shares the same durable Motor records and receipt digests as JavaScript and MCP:

```python
motor = client.executeMotor({
    "sessionRef": attached.output,
    "situation": situation.output,
    "requirementRef": "requirement:save",
    "intent": absolute_intent,
})
assert motor.output["terminal"] in {"confirmed", "alreadySatisfied"}

records = client.listMotorRecords()
assert any(row["receiptSha256"] == motor.output["receipt"]["receiptSha256"]
           for row in records.output)
```

`absolute_intent` must carry the exact Situation world, entity, surface epoch, action capability, desired final
state, expected transition, and actuator allowlist. Python does not receive raw coordinates or provider handles.
Windows physical input additionally requires `acquireMotorControl()` and a one-shot control lease. Use
`revokeMotorControl()` before execution when the surrounding product cancels the task. See
[the Motor guide](actuation.md).

## Cancellation and errors

`requestAsync` returns a `ControlRequest`:

```python
from pyprocControl import ControlError

request = client.requestAsync("machine.run", {
    "code": "import time\ntime.sleep(30)"
})
request.cancel("deadline reached")

try:
    request.result()
except ControlError as error:
    print(error.code, error.outcome, error.retryable)
```

Every synchronous `timeout=` is an effect-safe request deadline. When the local wait expires, the client sends
one protocol cancel and waits for the canonical terminal. A queued request ends as `notSent`; a delivered effect
normally ends as non-retryable `outcomeUnknown`. If the server does not settle after cancellation, the client
closes the connection and raises non-retryable `CONTROL_TIMEOUT` with `outcomeUnknown`.

If the transport ends while a request is pending, or a request frame write cannot prove full delivery, the
SDK raises non-retryable `CONTROL_CONNECTION_LOST` with `outcomeUnknown`. A request rejected before writing
because the connection is already known to be unavailable is `notSent`. Raw pipe and EOF errors do not escape
through the request surface.

Cancellation before delivery is `notSent`. After delivery, the product returns `outcomeUnknown` unless the
provider proves a narrower boundary. Never retry an `applied` or `outcomeUnknown` effect automatically.
Python restore does not undo browser, storage, network, download, popup, or other external effects.

`ControlError` exposes stable `code`, `outcome`, `retryable`, `details`, and `fatal` fields. Protocol framing
or digest violations fail the whole client and reject every outstanding request.

## Distribution verification

`npm run test:python-sdk` builds both the wheel and source distribution with pinned build tools, installs
each into a separate clean virtual environment, and runs these installed-package checks:

- strict codec positive and negative fixtures;
- PATH-based product preflight and handshake;
- persistent Python and checkpoint restore;
- post-send cancellation and request ID single-use;
- permission denial before browser effect;
- APX query through both Native CDP and FrameSpace;
- real browser open, attach, PNG capture, SHA-256 verification, artifact deletion, and detach.
- real Machine image capture, immutable Execution Memory publication, reopen, and list through the installed
  Python wheel.
- signed exact-intent approval, one live HTTP effect, no resend, and verified EffectReceipt sealing through the
  installed Python wheel.

Chrome on Ubuntu and Edge on Windows run the same gate in CI.
## Repository experience verification

The Python facade uses the same three Control operations as JavaScript and MCP:

```python
repository = {
    "commit": "exact-commit-id",
    "treeSha256": "sha256:...",
    "diffSha256": "sha256:...",
    "untracked": False,
}

audited = client.auditExperience(
    "qa/eyes",
    repositoryRoot=".",
    outputDir=".pyproc/evidence/current",
    environmentId="desktop",
    repository=repository,
    motorJourneys=[{
        "receiptSha256": receipt_sha256,
        "scenarioId": "save-document",
        "checkpointId": "post-save",
    }],
)
client.replayEvidencePack(".pyproc/evidence/current")
client.verifyExperience(".pyproc/evidence/reference", ".pyproc/evidence/current")
```

All filesystem inputs are resolved to absolute paths by the client except `outputDir`, which deliberately remains
relative to `repositoryRoot`. `auditExperience` requires browser authority. Verify and replay are effect-free and
remain available in browser-disabled profiles. See [experience verification](experienceVerification.md) for the
repository contract and Evidence Pack format.
