# pyproc-control

Official Python client for the pyproc Control Protocol. It starts the installed `pyproc-control` command,
verifies every protocol frame and binary attachment, and exposes persistent Python plus optional browser
automation without requiring JavaScript application code.

Install the exact wheel from the matching GitHub Release:

```sh
python -m pip install \
  "https://github.com/eddmpython/pyproc/releases/download/v0.0.19/pyproc_control-0.0.19-py3-none-any.whl"
```

PyPI is not an installation source yet. The versioned GitHub Release also contains the source distribution.

Synchronous `timeout=` values cancel the protocol request and wait for its canonical terminal. A delivered
effect that cannot be proven absent returns non-retryable `outcomeUnknown`; it is never silently retried.
Pending EOF and partial request-write failures are likewise exposed as non-retryable
`CONTROL_CONNECTION_LOST` with `outcomeUnknown`, never as raw pipe exceptions.

```python
from pyprocControl import PyProcClient

with PyProcClient.start("pyproc-mcp.json") as client:
    result = client.runPython("40 + 2")
    print(result.output["value"])
```

An automation-enabled manifest also exposes PyProc Eyes through
`client.perception(sessionRef)`: bounded APX semantic, spatial, and temporal queries plus evidence-backed
actions, without a JavaScript application layer or a raw CDP handle.

The npm `pyproc` package and its engine assets are separate installation prerequisites. See the repository
[Python SDK guide](https://github.com/eddmpython/pyproc/blob/main/docs/usage/pythonSdk.md) for setup,
automation, perception, cancellation, and recovery examples.
