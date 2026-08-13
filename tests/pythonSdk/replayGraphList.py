"""Read durable ReplayGraph revisions through the public Python client."""

from __future__ import annotations

import json
import os
import sys

from pyprocControl import PyProcClient


def main() -> None:
    config_path, node_path, control_script = sys.argv[1:4]
    client = PyProcClient.start(
        config_path,
        command=[node_path, control_script],
        startupTimeout=300.0,
        environment=dict(os.environ),
    )
    try:
        print(json.dumps(client.listReplayGraphs(timeout=300.0).output, separators=(",", ":")))
    finally:
        client.close()


if __name__ == "__main__":
    main()
