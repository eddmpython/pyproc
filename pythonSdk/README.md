# pyproc-control

Official Python client for the pyproc Control Protocol. It starts the installed `pyproc-control` command,
verifies every protocol frame and binary attachment, and exposes persistent Python plus optional browser
automation without requiring JavaScript application code.

Install the exact wheel from the matching GitHub Release:

```sh
python -m pip install \
  "https://github.com/eddmpython/pyproc/releases/download/v0.0.23/pyproc_control-0.0.23-py3-none-any.whl"
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

An automation-enabled manifest also exposes PyProc Eyes through `client.perception(sessionRef)`: bounded APX
graph queries, goal-specific `situate(...)`, broker-bound `actAffordance(...)`, and evidence-backed actions,
without a JavaScript application layer or a raw CDP handle.
Legacy `client.observe(...)` results also support single-use, document-epoch-bound `continuationRef` values for
complete semantic inventories larger than one 1,000-node page. Continue with no repeated first-page options and
accept completeness only when the final `inventory.complete` and full digest agree.
After artifact deletion, session detach, and `closeTarget(...)`, use `inspectSpace().output["resources"]` as the
provider-neutral cleanup receipt. A new isolated profile returns zero for every top-level, transport, and
perception resource counter.

Repository experience verification uses `auditExperience`, `verifyExperience`, and `replayEvidencePack` over the
same Control Protocol. The repository
[experience verification guide](https://github.com/eddmpython/pyproc/blob/main/skills/verify-browser-experience/references/verification.md)
defines the strict `qa/eyes` contract and canonical Evidence Pack.

An Execution Memory-enabled manifest adds `createExecutionSession`, `checkpointExecutionSession`,
`completeExecutionSession`, `openExecutionSession`, `listExecutionSessions`, `inspectExecutionSession`,
`exportExecutionHandoff`, and `importExecutionHandoff`. These methods publish and verify immutable session
revisions over the current Machine image. The
[Execution Memory guide](https://github.com/eddmpython/pyproc/blob/main/skills/use-pyproc-machine/references/execution-memory.md) defines
repository identity, compare-and-swap updates, completion evidence, handoff trust, and storage boundaries.

The npm `pyproc` package and its engine assets are separate installation prerequisites. See the repository
[Python SDK guide](https://github.com/eddmpython/pyproc/blob/main/skills/control-pyproc/references/python-sdk.md) for setup,
automation, perception, cancellation, and recovery examples.
