# pyproc-control

Official Python client for the pyproc Control Protocol. It starts the installed `pyproc-control` command,
verifies every protocol frame and binary attachment, and exposes persistent Python plus optional browser
automation without requiring JavaScript application code.

```python
from pyprocControl import PyProcClient

with PyProcClient.start("pyproc-mcp.json") as client:
    result = client.runPython("40 + 2")
    print(result.output["value"])
```

The npm `pyproc` package and its engine assets are separate installation prerequisites. See the repository
[Python SDK guide](https://github.com/eddmpython/pyproc/blob/main/docs/usage/pythonSdk.md) for setup,
automation, cancellation, and recovery examples.
