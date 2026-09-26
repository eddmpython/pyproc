"""Platform wheel journey: the wheel alone starts its bundled host with no Node on PATH."""

import json
import os
import shutil
import subprocess
import sys
import sysconfig
from pathlib import Path

from pyprocControl import PyProcClient
from pyprocControl.bundledHost import HOST_ROOT
from pyprocControl.client import resolvedCommand


projectRoot, targetOrigin, version = sys.argv[1:4]
browser = sys.argv[4] if len(sys.argv) > 4 else None
scripts = Path(sysconfig.get_path("scripts"))
suffix = ".exe" if os.name == "nt" else ""
assert shutil.which("node") is None, "the journey PATH must not contain Node"
Path(projectRoot).mkdir(parents=True, exist_ok=True)

command = resolvedCommand(None)
descriptor = json.loads((HOST_ROOT / "host.json").read_text(encoding="utf-8"))
assert command == [str(HOST_ROOT / descriptor["node"]["path"]), str(HOST_ROOT / descriptor["commands"]["pyproc-control"])]
assert descriptor["package"]["version"] == version

printed = subprocess.run([str(scripts / f"pyproc-control{suffix}"), "--version"], capture_output=True, text=True,
                         encoding="utf-8", check=True).stdout.strip()
assert printed == version, printed
initialized = subprocess.run([str(scripts / f"pyproc-mcp{suffix}"), "init", "--recipe", "authorizedBrowser",
                              "--project-root", projectRoot, "--out", "hostProfile", "--origin", targetOrigin,
                              "--max-risk", "externalEffect", "--acknowledge-effects",
                              "--purpose", "Python-SDK-platform-wheel-gate", "--action", "snapshot",
                              *(["--browser", browser] if browser else [])],
                             capture_output=True, text=True, encoding="utf-8")
assert initialized.returncode == 0, initialized.stderr[-800:]
machineConfig = Path(projectRoot) / "hostProfile" / "manifest.json"
manifest = json.loads(machineConfig.read_text(encoding="utf-8"))
assert Path(manifest["engine"]["root"]).is_relative_to(HOST_ROOT), manifest["engine"]
browserOnlyConfig = Path(projectRoot) / "hostProfile" / "browserOnly.json"
browserOnlyConfig.write_text(json.dumps({**manifest, "engine": {"enabled": False}}), encoding="utf-8")
# On Windows the wheel carries the browser desktop helper: a headed browser on a private desktop needs nothing else.
privateDesktopConfig = Path(projectRoot) / "hostProfile" / "privateDesktop.json"
privateDesktopConfig.write_text(json.dumps({**manifest, "engine": {"enabled": False},
                                            "browser": {**manifest["browser"], "headed": True, "desktop": "private"}}),
                                encoding="utf-8")
os.environ.pop("PYPROC_BROWSER_DESKTOP_HELPER", None)


def pageJourney(client: PyProcClient) -> bool:
    target = client.openTarget(targetOrigin + "/host", expectedRisk="externalEffect", waitUntil="load",
                               timeout=60.0).output["targetRef"]
    session = client.attachSession(target, timeout=30.0).output
    seen = client.observe(session, {"expectedRisk": "read"}, timeout=60.0).output
    client.detachSession(session, timeout=30.0)
    client.closeTarget(target, expectedRisk="externalEffect", timeout=30.0)
    resources = client.inspectSpace(timeout=30.0).output["resources"]
    assert resources["targets"] == 0 and resources["sessions"] == 0, resources
    return "python-sdk-ready" in json.dumps(seen)


report = {"ok": False, "version": printed}
assert PyProcClient.doctor(machineConfig)["ok"] is True
with PyProcClient.start(machineConfig, startupTimeout=90.0) as client:
    try:
        report["machineValue"] = client.runPython("40 + 2", timeout=120.0).output["value"]
        report["machineObserved"] = pageJourney(client)
    except BaseException:
        print(client.diagnostics[-6000:], file=sys.stderr)
        raise
with PyProcClient.start(browserOnlyConfig, startupTimeout=90.0) as client:
    try:
        report["browserOnlyMachineOperations"] = sorted(op for op in client.operations if op.startswith("machine."))
        report["browserOnlyObserved"] = pageJourney(client)
    except BaseException:
        print(client.diagnostics[-6000:], file=sys.stderr)
        raise
if os.name == "nt":
    helper = HOST_ROOT / descriptor["browserDesktop"]["path"]
    assert helper.is_file() and helper.name == "pyproc-browser-desktop.exe", descriptor.get("browserDesktop")
    with PyProcClient.start(privateDesktopConfig, startupTimeout=90.0) as client:
        try:
            report["privateDesktopObserved"] = pageJourney(client)
        except BaseException:
            print(client.diagnostics[-6000:], file=sys.stderr)
            raise
report["ok"] = True
print(json.dumps(report))
