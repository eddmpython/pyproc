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
`deterministic`, `kernelRef`, `hostBroker`, `checkpointCoordinator`, and `kernelVfs`. Unknown options fail
with `PYPROC_INPUT_INVALID`.

### `open(image?, options?)`

With no image, boots a fresh `KernelMachine`. With a `pyproc.kernel-machine-image` version 1 object, verifies
and restores that image. Other inputs fail with `PYPROC_INPUT_INVALID`.

### `KernelMachine`

- `run.python(code, options?)` returns an execution receipt.
- `run.get(name)` reads a value through a value envelope.
- `run.set(name, value)` writes a value through a value envelope.
- `history.checkpoint(request?)` seals a checkpoint.
- `history.restore(checkpoint)` restores an exact checkpoint.
- `history.export(options?)` creates a portable Machine image.
- `proc.spawn(manifest, options?)` starts a worker process.
- `proc.clone(options?)` starts a worker process from the current state.
- `createPackageEnvironment(options?)` creates the package policy boundary.
- `terminal(options?)` creates a version 2 kernel terminal.
- `inspect()` returns engine, process, and worker ownership facts.
- `close()` closes child processes and the kernel worker.

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
selected graph files and checks SHA-256 SRI before worker creation.

## `pyproc/history`

Exports content-addressed state objects, memory and OPFS stores, commit/open protocols, signed tags, and
the state bundle format. These are storage contracts, not a second Python runtime.

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
