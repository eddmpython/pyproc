# Python SDK

The official `pyproc-control` Python package starts and controls the installed npm product without
JavaScript application code. The SDK has no runtime dependency and supports Python 3.10 or newer.

The two packages have separate jobs:

- npm `pyproc` ships the browser runtime, `pyproc-control` command, policy manifest, and engine tooling.
- Python `pyproc-control` ships the strict protocol client, typed values, cancellation, and attachment
  verification.

Pin both packages to the same version. A normal release uses `0.0.15` for each.

## Install

```sh
npm install --save-exact pyproc@0.0.15
npx pyproc-engine --out /absolute/path/to/pyodide
python -m pip install pyproc-control==0.0.15
```

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
- real browser open, attach, PNG capture, SHA-256 verification, artifact deletion, and detach.

Chrome on Ubuntu and Edge on Windows run the same gate in CI.
