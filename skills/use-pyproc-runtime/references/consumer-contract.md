# Package contract

## Contents

- Installation and assets
- Runtime contract
- Resident tool contract
- State contract
- Browser storage durability contract
- Package contract
- Host capability contract
- Public subpaths
- Browser boundary

## Installation and assets

`npm install pyproc` includes the owned CPython/WASI core, standard library, source-pinned ripgrep and libgit2 Git
WASI binaries, build manifests, patches, licenses, SBOM, standard library inventory, and reproducibility receipts.
Serve the package and its relative `src/` graph from one origin. The runtime verifies engine manifest identity,
artifact byte length, and SHA-256 before boot.

```js
import { getPyProcAssetManifest, verifyPyProcAssetIntegrity } from "pyproc/assets";
```

The public asset graph contains the kernel worker, resident tool worker, and resident WASM binary entrypoints.
Engine binaries are addressed by the signed kernel engine manifest and are not copied into Machine images.

## Runtime contract

```js
import { boot, open } from "pyproc";

const machine = await boot();
const { threading } = (await machine.inspect()).kernel;
const result = await machine.run.python("print(40 + 2)");
const image = await machine.history.export();
await machine.close();

const restored = await open(image);
```

Commands are Promise-first and ordered. Receipts carry explicit terminal states. Values use structured,
versioned envelopes. Browser handles, worker objects, WebAssembly memory views, and live interpreter objects
do not enter durable state.

Check `threading.pythonThreadCreation` before choosing a Python thread algorithm. The installed engines currently
report `mode: "worker-processes"`; use `machine.proc` for independent-interpreter parallelism. A browser having
`SharedArrayBuffer` does not mean the Python WASM memory is shared.

## Resident tool contract

`machine.tools.run("rg", args, options)` executes source-pinned ripgrep 15.1.0 in a fresh WASI worker. It accepts
only an argument vector. With no explicit `files`, it snapshots committed `/home` entries from the attached
`KernelVfs`; otherwise it accepts a bounded absolute-path file object. The snapshot is read-only and the worker
has no network capability.

`machine.tools.run("git", args, options)` executes the source-pinned libgit2 1.9.7 example frontend without its
network transports. It requires an attached `KernelVfs`, rejects an explicit `files` object, runs against a bounded
snapshot, and commits its local repository delta only when the input root still matches. The supported product
surface is init, config, exact-path add, commit, status, log, and local refs.

The version 1 receipt binds tool version and source revision, argv, exit code, stdout, stderr, timing, file count,
byte length, and input SHA-256. A mutating receipt also binds the output digest, committed root, file counts, and
write and removal counts. Nonzero command exit is a normal receipt. Input, output, time, cancellation, worker, and
asset failures remain distinguishable. The Machine's main and cloned Python kernels can import `pyprocTools`
to inspect or call the identical argv-only catalog. This does not make Python standard-library `subprocess`, shell grammar, pipes, remote Git
transports, or arbitrary Git CLI commands work.

## State contract

Checkpoints are bound to exact engine and environment identities. Chains are acyclic and bounded. A Machine
image includes the verified engine manifest, checkpoint descriptors, and content-addressed checkpoint
objects. Corruption, substitution, a missing parent, or wrong identity fails before activation.

VFS state and kernel memory share a coordinated commit boundary. An active transaction, accepted hostcall,
or forbidden open resource blocks checkpoint.

## Browser storage durability contract

`BrowserStorageDurability` is exported from `pyproc/history`. `inspect()` is read-only and reports whether
the origin bucket is persistent or best-effort. Its usage and quota values are rough observations, never a
reservation or permission to start a write. `requestPersistence()` is the only operation that asks the browser
for persistent treatment and is never called automatically.

A rejected browser write ends as `PYPROC_STORAGE_QUOTA_EXCEEDED` without an automatic retry. OPFS state and
kernel stores preserve prior data and remove a new empty file handle created before the failed write.

`createWitness()` returns a small receipt that the caller must retain outside the origin. On a later cold
start, `verifyWitness(receipt)` turns a missing local witness into `PYPROC_STORAGE_EVICTED`. Data deleted with
the bucket cannot be reconstructed from that bucket. Recovery requires an external Machine bundle copy bound
to the witness.

## Package contract

The resolver consumes standard Simple API JSON metadata. Selection checks normalized name, version,
`Requires-Python`, environment markers, yanked policy, wheel tags, and hash. The installer accepts pure Python
wheels after archive traversal, link, duplicate path, case collision, and expansion-limit checks.

Curated native artifacts must match the exact engine profile. Arbitrary binary wheels are rejected before
installation.

## Host capability contract

Host effects cross Hostcall ABI version 1 through `HostCapabilityBroker`. Authority is checked per request.
Streaming uses bounded credit. Exactly-once effect receipts distinguish completed, failed, denied,
interrupted, and outcome-unknown terminals.

## Public subpaths

| Subpath | Purpose |
|---|---|
| `pyproc/runtime` | Kernel, session, process, package, and Machine composition |
| `pyproc/history` | Content-addressed durable state contracts |
| `pyproc/machine` | WebMachine host, device, image, and fleet contracts |
| `pyproc/assets` | Worker graph and integrity verification |
| `pyproc/wasi` | Low-level kernel, hostcall, VFS, package, and owned distribution contracts |
| `pyproc/gpu` | Closed WebGPU host adapter and versioned hardware result oracle |
| `pyproc/socket` | Socket relay host adapter |
| `pyproc/control` | Local control protocol |

Deep imports are unsupported.

## Browser boundary

The supported production boundary is current Chromium and Edge with cross-origin isolation,
`SharedArrayBuffer`, module workers, WebAssembly, and JSPI. Firefox and Safari are not currently supported.
