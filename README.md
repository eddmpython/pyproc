# pyproc

pyproc is a browser computer built around an owned, worker-hosted CPython 3.14 WASI kernel. The npm
package includes the verified engine and standard library, so the default runtime does not require a
separate engine download or a remote execution service.

## Install

```sh
npm install pyproc
```

Serve the installed package from the same origin as your application. The supported production browser
boundary is current Chromium and Edge with `SharedArrayBuffer` and cross-origin isolation enabled.

## Run Python

```js
import { boot } from "pyproc";

const machine = await boot();
const receipt = await machine.run.python("print(sum(range(100)))");

console.log(receipt.output); // 4950
await machine.close();
```

Every execution returns a structured receipt. Python exceptions produce a stable `PyProcError` with
`code === "PYPROC_KERNEL_EXECUTION_ERROR"`. Values cross the worker boundary through versioned value
envelopes:

```js
await machine.run.set("settings", { locale: "ko-KR", retries: 3 });
const settings = await machine.run.get("settings");
```

## Checkpoints and Machine images

```js
import { boot, open } from "pyproc";

const machine = await boot({ deterministic: true });
await machine.run.python("counter = 41");

const checkpoint = await machine.history.checkpoint();
await machine.run.python("counter = 99");
await machine.history.restore(checkpoint);

const image = await machine.history.export();
await machine.close();

const restored = await open(image);
console.log(await restored.run.get("counter")); // 41
await restored.close();
```

A Machine image contains a verified engine reference and content-addressed checkpoint objects. It does not
duplicate the engine binary. A wrong engine identity, corrupt checkpoint, missing parent, or digest mismatch
fails before the restored worker becomes active.

## Processes

```js
const parent = await boot();
await parent.run.python("value = 21");

const { process } = await parent.proc.clone();
const result = await process.execute("print(value * 2)");
console.log(result.output); // 42

await process.close();
await parent.close();
```

Each process owns a separate worker and kernel. Clone starts from a verified checkpoint, never from a live
heap view.

## Resident WASM tools

The Machine includes source-pinned ripgrep 15.1.0 and a libgit2 1.9.7 Git command as real WASI programs. Each
accepts an argument vector, never a shell string, and runs in a fresh worker with file, byte, output, and time
limits. Ripgrep reads a bounded snapshot. Git applies a bounded local repository transaction to the attached
`KernelVfs` only after its input root still matches.

```js
const result = await machine.tools.run("rg", ["-n", "TODO", "/home"], {
  files: {
    "/home/notes.txt": "done\nTODO verify the browser gate\n",
  },
});

console.log(result.exitCode, result.stdout, result.input.sha256);
```

With a `KernelVfs` attached at boot, local Git can initialize a repository, read and write config, add exact paths,
commit, inspect status and log, and read local refs through the same receipt contract:

```js
await machine.tools.run("git", ["init", "/home/project"]);
const status = await machine.tools.run("git", ["--git-dir=/home/project/.git", "status"]);
```

Python kernels owned by the Machine reach the identical catalog without claiming operating-system process support:

```js
const python = await machine.run.python(`
import pyprocTools
receipt = pyprocTools.run("git", ["--version"])
print(receipt["stdout"])
`);
```

A nonzero command exit is a normal receipt. Unsupported commands, cancellation, limit failures, and asset
mismatch use structured `PyProcError` codes. Shell grammar, pipes, remote Git transports, arbitrary Git CLI
coverage, and Python standard-library `subprocess` remain outside the contract.

## Packages and terminal

`machine.createPackageEnvironment()` installs pure Python wheels selected from standard Simple API metadata,
with hash, tag, `Requires-Python`, marker, and yanked-policy checks. Curated native modules are bound to an
exact engine profile. Unsupported binary wheels fail before installation with
`PYPROC_PACKAGE_ABI_UNSUPPORTED`.

The default source-built host module is available through a package-owned, network-free catalog:

```js
import { createOwnedPackageResolver } from "pyproc/wasi";

const resolver = await createOwnedPackageResolver();
const packages = machine.createPackageEnvironment({ resolver });
await packages.install({ requirements: ["pyproc-native-host==1.0.0"] });
await machine.run("import pyproc_native_host; print(pyproc_native_host.ABI_VERSION)");
```

The separate data profile is selected explicitly and remains isolated from the default core engine:

```js
import { boot } from "pyproc";
import { createOwnedPackageResolver, getDataKernelEngineManifest } from "pyproc/wasi";

const dataMachine = await boot({ engineManifest: await getDataKernelEngineManifest() });
const dataResolver = await createOwnedPackageResolver({ profile: "data" });
const dataPackages = dataMachine.createPackageEnvironment({ resolver: dataResolver });
await dataPackages.install({ requirements: [
  "pyproc-native-data==1.0.0",
  "numpy==2.5.1",
] });
await dataMachine.run(`
import numpy as np
import pyproc_native_data
print(pyproc_native_data.inspect())
print(np.linalg.solve(np.array([[3., 1.], [1., 2.]]), np.array([9., 8.])))
`);
```

This facade reports `pyproc.data/2` and runs float64 buffer addition and dot products through
`wasm-simd128`. The same catalog includes the NumPy 2.5.1 Python layer while the exact data engine embeds its
13 native modules. Both wheels install from package bytes without a runtime network request. SciPy, pandas,
Polars, and arbitrary native wheels remain unsupported.

The NumPy build uses a source-pinned sdist and exact Cython, Ninja, WASI SDK, and CPython inputs. The current
WASI C++ runtime has no exception implementation, so allocation failure or an internal pocketfft invariant may
abort the process. Normal input errors such as an empty FFT remain Python exceptions.

The catalog seals both wheels, scientific source and build receipts, native source digests, ABI, engine ID, and
profile. A mismatch fails before
the install command reaches the kernel. Verified package layers also travel with process clones and Machine
images. Image import rechecks every embedded wheel digest before a fresh worker sees it.

`machine.terminal()` exposes the version 2 terminal contract. Its `%pip install` command routes through the
same package environment and does not bypass package policy.

## Host capabilities

The `pyproc/wasi` subpath exports `HostCapabilityBroker` and `ProductHostCapabilityPort`. HTTP, socket relay,
ASGI, process, GPU, clipboard, framebuffer, and artifact effects require explicit authority and cross the
versioned hostcall ABI. Browser objects and live Python objects are not durable state.

```js
import {
  HostCapabilityBroker,
  ProductHostCapabilityPort,
  createFetchHostAdapter,
} from "pyproc/wasi";

const broker = new HostCapabilityBroker({
  authorize: ({ capability }) => capability === "http.fetch",
});
const port = new ProductHostCapabilityPort({
  http: createFetchHostAdapter(fetch.bind(globalThis)),
});
port.install(broker);
```

Hardware WebGPU stays behind the same request-scoped boundary. `pyproc/gpu` exposes only registered
operations and returns a versioned result receipt instead of exposing a device to the guest.

```js
import { createWebGpuHostAdapter, runHardwareVisualOracle } from "pyproc/gpu";

const gpu = await createWebGpuHostAdapter({ requireHardware: true });
try {
  const receipt = await runHardwareVisualOracle(gpu);
  console.log(receipt.state, receipt.adapter.class);
} finally {
  gpu.close();
}
```

## WebComputer

`createWebComputer()` composes the owned kernel guest with WebMachine devices, signed images, ownership,
and optional durable storage. The default Python guest uses the same `KernelMachine` and Machine image
contract as root `boot()` and `open()`.

Optional Linux and Node guests join that same lifecycle when a V86 constructor and guest manifest are supplied.
A Node manifest must name the exact runtime version, source revision, source URL, and source SHA-256, and must
describe its boot image with byte length and SHA-256. pyproc fetches and verifies those bytes before constructing the emulator, reports the
verified asset through `inspect()`, and rejects a changed image with `WEB_MACHINE_ASSET_INTEGRITY` before an
imported Machine can replace the active one. Linux and Node manifests can declare the BIOS, kernel image, and
VGA BIOS through the same verified descriptor path.
Each guest receives its own block device while the signed
`.webmachine` envelope carries all configured guests together. V86, firmware, and optional guest images are not
bundled into the npm package. `bootAll()` is all-or-clean: if any configured guest fails, it waits for every boot
attempt and shuts down every partial guest before rejecting.

The versioned external-asset SSOT is [`scripts/assetCatalog.json`](scripts/assetCatalog.json). The exact packed
reference journey is [the Node guest product gate](https://github.com/eddmpython/pyproc/blob/main/tests/browser/nodeGuestProduct.mjs), and the complete
manifest, source identity, permission, and inspection contract is documented under `createWebComputer` in the
[API reference](skills/reference-pyproc-api/references/api.md).

## Package subpaths

| Subpath | Contract |
|---|---|
| `pyproc/runtime` | Kernel runtime, session, process, package, and Machine composition |
| `pyproc/history` | Content-addressed state objects, stores, bundles, and signed tags |
| `pyproc/machine` | WebMachine host, devices, images, fleet, and kernel guest |
| `pyproc/assets` | Same-origin worker asset manifest and integrity verification |
| `pyproc/wasi` | Low-level session, kernel, hostcall, package, and factory contracts |
| `pyproc/gpu` | Closed WebGPU host adapter and versioned hardware result oracle |
| `pyproc/socket` | Socket relay host adapter |
| `pyproc/control` | Local control protocol client and registries |

## Control and browser automation

Use `PyProcControlClient` from `pyproc/control` for a supported JavaScript client, or the installed
`pyproc-control` command for a language-neutral NDJSON connection. Both use the same strict manifest,
operation catalog, cancellation rules, and verified attachment framing.
The effect-free doctor also returns one structured first-result action mapped to shell, JavaScript, Python, and
MCP, with `machine.run` as the canonical meaning.

Legacy semantic observation keeps each response at 1,000 nodes or fewer. A result with `continuationRef` can be
continued with a continuation-only `automation.observe` call. Every page carries the same document epoch,
snapshot receipt, complete-inventory digest, and observation evidence binding. A document replacement rejects
the old continuation instead of treating a partial prefix as complete.

Proof-carrying browser actions expose one provider-neutral `pyproc.actionConvergence` version 1 receipt. Native
CDP and FrameSpace inspect at most two candidates, reobserve the original typed focus at most once, never retry a
sent effect, and bound the first-effect search to 30000 ms. A unique same-document stale target or replaced
document can converge; ambiguity and persistent occlusion return the same receipt with zero effect attempts.
Successful Control output carries it on the action terminal, while a safe refusal carries it in error details.

`automation.space.inspect` also returns one provider-neutral `resources` snapshot. After deleting owned
artifacts, detaching sessions, and closing owned targets, every counter returns to the starting baseline. A new
isolated profile therefore returns zero for targets, sessions, locators, continuations, watchers, artifacts,
perception ledgers, transport sessions, pending commands, and listeners.

Start with [Machine Entrance](skills/use-pyproc-machine/references/machine-entrance.md), then use the
[JavaScript Control SDK](skills/control-pyproc/references/javascript-control.md), the
[Python SDK](skills/control-pyproc/references/python-sdk.md), or the complete
[Control Protocol](skills/control-pyproc/references/control-protocol.md). These files are included in the npm
package, and the package gate verifies every relative README link against the packed install.

## Verification

```sh
npm test
npm run test:types
npm run test:package
npm run test:installed
npm run test:wasm-tools
```

The installed product gates pack and install the real tarball, boot the included engine in Chrome and Edge, check
package installation, checkpoint restore, offline image reopen, process clone, terminal behavior, resident WASI
search, local Git transactions, the Python tool bridge, and verify that clean boot makes no undeclared external
engine request.

See [API reference](skills/reference-pyproc-api/references/api.md), [platform requirements](skills/use-pyproc-runtime/references/platform-requirements.md),
and [kernel factory contract](skills/use-pyproc-runtime/references/kernel-contracts.md).

## Maintained knowledge

Start with [the PyProc skill router](skills/start-pyproc/SKILL.md). It selects the relevant maintained skill and the
required verification gates without loading the full knowledge tree. The npm package includes the same digest-bound
skill catalog used by the read-only `skills.search` and `skills.read` MCP tools.

## License

[Mozilla Public License 2.0](LICENSE). Copyright 2026 eddmpython.
