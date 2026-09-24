"""The pyproc host carried by a platform wheel: a pinned Node runtime and the matching npm package tree.

The pure wheel and the source distribution carry no host, so ``bundledCommand`` returns ``None`` there and the
client falls back to a ``pyproc-control`` command on ``PATH``. A platform wheel always prefers its own host because
that host is the exact pyproc release this client was built with.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from pathlib import Path

HOST_ROOT = Path(__file__).resolve().parent / "host"


def bundledCommand(name: str) -> list[str] | None:
    try:
        descriptor = json.loads((HOST_ROOT / "host.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, NotADirectoryError):
        return None
    script = descriptor["commands"].get(name)
    if script is None:
        raise ValueError(f"the bundled pyproc host has no {name} command")
    return [str(HOST_ROOT / descriptor["node"]["path"]), str(HOST_ROOT / script)]


def runBundled(name: str) -> int:
    command = bundledCommand(name)
    if command is None:
        print(f"{name}: this pyproc-control distribution carries no host; install a platform wheel", file=sys.stderr)
        return 2
    arguments = [*command, *sys.argv[1:]]
    if os.name != "nt":
        os.execv(arguments[0], arguments)
    # Windows has no exec: the console command waits for the host and leaves Ctrl+C to it.
    previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
    try:
        return subprocess.call(arguments)
    finally:
        signal.signal(signal.SIGINT, previous)


def controlMain() -> int:
    return runBundled("pyproc-control")


def mcpMain() -> int:
    return runBundled("pyproc-mcp")
