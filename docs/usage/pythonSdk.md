# Python SDK

The official `pyproc-control` Python package starts and controls the installed npm product without
JavaScript application code. The SDK has no runtime dependency and supports Python 3.10 or newer.

The two packages have separate jobs:

- npm `pyproc` ships the browser runtime, `pyproc-control` command, policy manifest, and engine tooling.
- Python `pyproc-control` ships the strict protocol client, typed values, cancellation, and attachment
  verification.

Pin both packages to the same version. A normal release uses `0.0.20` for each.

## Install

```sh
npm install --save-exact pyproc@0.0.20
npx pyproc-engine --out /absolute/path/to/pyodide
python -m pip install \
  "https://github.com/eddmpython/pyproc/releases/download/v0.0.20/pyproc_control-0.0.20-py3-none-any.whl"
```

The Python distribution is currently published as wheel and source distribution assets on the matching
GitHub Release. PyPI is not an installation source yet. Use the exact-version asset URL because floating
release URLs are outside the reproducible installation contract.

Create the version 1 manifest from the [browser automation guide](browserAutomation.md). A Python-only
machine uses `"browser": { "enabled": false }`. Validate the complete local product before use:

```python
from pyprocControl import PyProcClient

report = PyProcClient.check("pyproc-mcp.json")
print(report["engine"])
```

The npm bin directory must be on `PATH`. An embedded application can instead pass an explicit command list
such as `command=[nodePath, controlScriptPath]`.

## Persistent Python and checkpoint recovery

```python
from pyprocControl import PyProcClient

with PyProcClient.start("pyproc-mcp.json") as client:
    client.runPython("prepared = [10, 20, 30]")
    checkpoint = client.saveCheckpoint()

    try:
        client.runPython("prepared.append(999)\nraise ValueError('failed attempt')")
    except Exception:
        client.restoreCheckpoint(checkpoint.output["index"])

    result = client.runPython("prepared")
    print(result.output["value"])
```

`ControlResult` contains `output`, `outcome`, and an ordered tuple of verified `attachments`. Machine state
persists for the life of the client. `reset()` restores the prepared boot checkpoint.

## Browser automation and screenshots

Browser operations appear only when the manifest grants automation authority. Risk is fixed by the product
catalog and must be acknowledged on each effect:

```python
with PyProcClient.start("pyproc-mcp.json") as client:
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

`client.perception(sessionRef)` binds the provider-neutral APX graph to one attached session. It uses the same
`automation.observe` and `automation.act` operations as MCP and native JavaScript clients, so Python does not
gain a second automation meaning or a raw CDP entrance.

```python
with PyProcClient.start("pyproc-mcp.json") as client:
    opened = client.openTarget(
        "https://example.test",
        expectedRisk="externalEffect",
        waitUntil="load",
    )
    attached = client.attachSession(opened.output["targetRef"])
    eyes = client.perception(attached.output)

    save = eyes.query(role="button", name="Save", actionable=True).one()
    result = eyes.act(
        "click",
        save.locatorRef,
        verify={"entityAppeared": {"role": "status", "nameContains": "Saved"}},
    )
    assert result.output["actions"][0]["result"]["evidence"]["verification"]["state"] == "confirmed"
```

`PerceptionEntity` exposes `entityRef`, `locatorRef`, `kind`, `role`, `name`, and `actionable` properties.
`query(...).one()` rejects zero or multiple matches instead of guessing. `whatChanged(observationRef)` requests
a delta, while `explainActionability(entityRef)` narrows the graph to semantic, geometry, and interaction
facts. Observation identity never grants action authority, and locator capability remains short-lived.

Native CDP supports verified pixel-on-demand attachments. FrameSpace supports APX through temporal level L3
but rejects visual inference. See the [APX 1.0 Working Draft](../specs/apx/README.md) for the graph and evidence
contract.

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

Chrome on Ubuntu and Edge on Windows run the same gate in CI.
