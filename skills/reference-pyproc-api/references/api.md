# api

## Contents

- API reference
- Root module
- `boot(options?)`
- `open(image?, options?)`
- `KernelMachine`
- `createWebComputer(options?)`
- `checkEnvironment()`
- `pyproc/runtime`
- `pyproc/wasi`
- `pyproc/assets`
- `pyproc/history`
- `pyproc/machine`
- `pyproc/gpu` and `pyproc/socket`
- Errors

# API reference

## Root module

```js
import { boot, open, createWebComputer, checkEnvironment, PyProcError } from "pyproc";
```

The root has exactly six value exports: `boot`, `open`, `createWebComputer`, `checkEnvironment`,
`PyProcError`, and `PYPROC_ERROR_CODES`.

### `boot(options?)`

Boots the installed owned CPython/WASI engine in a dedicated worker and returns a `KernelMachine`.

Accepted options are `engineManifest`, `kernelFactory`, `assetStore`, `checkpointStore`, `fetchImpl`,
`deterministic`, `kernelRef`, `hostBroker`, `assetIntegrity`, `checkpointCoordinator`, and `kernelVfs`. Unknown options fail
with `PYPROC_INPUT_INVALID`.

### `open(image?, options?)`

With no image, boots a fresh `KernelMachine`. With a `pyproc.kernel-machine-image` version 1 object, verifies
and restores that image, including any digest-sealed package environment. Other inputs fail with
`PYPROC_INPUT_INVALID`.

### `KernelMachine`

- `run.python(code, options?)` returns an execution receipt.
- `run.get(name)` reads a value through a value envelope.
- `run.set(name, value)` writes a value through a value envelope.
- `history.checkpoint(request?)` seals a checkpoint.
- `history.restore(checkpoint)` restores an exact checkpoint.
- `history.export(options?)` creates a portable Machine image.
- `proc.spawn(manifest, options?)` starts a worker process.
- `proc.clone(options?)` starts a worker process from the current state.
- `tools.run("rg" | "git", args?, options?)` runs a source-pinned resident command in an isolated WASI worker.
- `tools.inspect()` returns the versioned command catalog, confinement, limits, source revision, and digest.
- `createPackageEnvironment(options?)` creates the package policy boundary.
- `terminal(options?)` creates a version 2 kernel terminal.
- `inspect()` returns engine, process, tool, and worker ownership facts.
- `close()` closes child processes and the kernel worker.

`pyproc/wasi.createOwnedPackageResolver()` creates the exact engine and profile fenced resolver for package-owned
source-built native facades. The default catalog provides `pyproc-native-host==1.0.0` without a third-party
package fetch. `{ profile: "data" }` selects `pyproc-native-data==1.0.0` for the separate manifest returned by
`getDataKernelEngineManifest()`. The data facade reports `pyproc.data/2` and `wasm-simd128`; it is not a claim of
general scientific package compatibility.

### `createWebComputer(options?)`

Creates a WebMachine host with an owned CPython/WASI guest, browser devices, signed image support, and
optional durable storage. The Python guest uses adapter ID `cpython-wasi` and a portable Kernel Machine
image.

### `checkEnvironment()`

Reports cross-origin isolation, `SharedArrayBuffer`, JSPI, and actionable issues. It does not mutate the
page.

## `pyproc/runtime`

Exports the worker kernel, `KernelSession`, `KernelProcess`, package contracts, `KernelFactory`, and
`KernelMachine` composition. This subpath has no import-time side effects.

## `pyproc/wasi`

Exports the low-level `bootWasi` session, KernelRuntimeContract version 2, ValueEnvelope, Hostcall ABI,
KernelVfs, package resolver and installer, `KernelFactory`, the owned engine manifest, and product host
adapters.

```js
import {
  HostCapabilityBroker,
  ProductHostCapabilityPort,
  createFetchHostAdapter,
  createSocketRelayHostAdapter,
} from "pyproc/wasi";
```

Capabilities require explicit authorization. Open network or process resources block checkpoint until
they are drained or closed.

## `pyproc/assets`

```js
import { getPyProcAssetManifest, verifyPyProcAssetIntegrity } from "pyproc/assets";
```

The manifest contains the same-origin `wasiWorker` module entrypoint. Integrity verification fetches the
selected graph files and checks SHA-256 SRI before worker creation. It also lists `wasmToolWorker` and
`wasmToolBinary`. Passing the generated manifest as `boot({ assetIntegrity })` verifies both worker graphs and
the resident binary. The binary has a second compiled-in length and SHA-256 check before execution.

### Resident tool receipt

`machine.tools.run(command, args, options)` never parses a shell string. Options may provide an explicit
absolute-path `files` object, `stdin`, `timeoutMs`, `maxOutputBytes`, and an `AbortSignal`. Without `files`, the
Machine snapshots committed `/home` files from its attached `KernelVfs`. The version 1 receipt contains exact
tool version and revision, argv, exit code, stdout, stderr, timing, an input content digest, and any committed
output root. Ripgrep 15.1.0 uses a read-only snapshot. The libgit2 1.9.7 Git command requires an attached
`KernelVfs`, then applies a compare-and-swap local repository transaction. Its tested surface is init, config,
exact-path add, commit, status, log, and local refs. Exit codes such as ripgrep's no-match `1` remain normal
receipts.

Every `KernelMachine` boot and its cloned process path install a pure Python `pyprocTools` module with `inspect()` and
`run(command, args, stdin="", timeoutMs=15000, maxOutputBytes=262144)`. It crosses the hostcall boundary into the
same catalog and returns the same receipt. It is not Python standard-library `subprocess`; shell grammar, pipes,
remote Git transports, and arbitrary Git CLI coverage remain unsupported.

## `pyproc/history`

Exports content-addressed state objects, memory and OPFS stores, commit/open protocols, signed tags, and
the state bundle format. These are storage contracts, not a second Python runtime.

`BrowserStorageDurability.open({ root, namespace?, storageManager? })` opens the version 1 browser-storage
contract over an owned OPFS directory.

- `inspect()` reports persistent or best-effort mode, rough usage and quota, and the eviction boundary.
- `requestPersistence()` explicitly asks the browser for persistent treatment.
- `createWitness({ witnessId })` writes a local witness and returns its portable receipt.
- `verifyWitness(receipt)` confirms the local witness or throws `PYPROC_STORAGE_EVICTED`.
- `runWrite(operation, context?)` normalizes a browser quota rejection to
  `PYPROC_STORAGE_QUOTA_EXCEEDED` without retrying it.

The witness detects loss but does not contain a copy of deleted Machine bytes.

## `pyproc/machine`

Exports WebMachine contracts, devices, stores, signed archives, fleet composition, the owned kernel guest,
and `KernelMachine`.

## `pyproc/gpu` and `pyproc/socket`

These subpaths export product host adapter factories. They do not grant authority or create a kernel by
themselves.

`pyproc/gpu` exports `createWebGpuHostAdapter`, `runHardwareVisualOracle`,
`GPU_ORACLE_PROTOCOL`, and `GPU_ORACLE_VERSION`. The adapter accepts the closed `vectorAdd` and
`solidRgba8` operation set. The oracle rejects software or unknown adapters by default and returns a receipt
that binds adapter classification, expected and actual result digests, and bounded numeric error. The legacy
`createGpuComputeHostAdapter` remains available for an already supplied GPU provider.

## Errors

Branch on `error.code`, not message text. Integrity and identity errors are fail-closed. A terminated worker
does not report an execution as completed, and an unknown external-effect outcome is never retried
automatically.
