"""Read durable Motor receipt summaries through the public Python client."""

from __future__ import annotations

import json
import os
import sys

from pyprocControl import PyProcClient


def main() -> None:
    configPath, nodePath, controlScript = sys.argv[1:4]
    client = PyProcClient.start(
        configPath,
        command=[nodePath, controlScript],
        startupTimeout=300.0,
        environment=dict(os.environ),
    )
    try:
        print(json.dumps(client.listMotorRecords(timeout=300.0).output, separators=(",", ":")))
    finally:
        client.close()


if __name__ == "__main__":
    main()
