# Package contract

## Installation and assets

`npm install pyproc` includes the owned CPython/WASI core, standard library, build manifest, SBOM, standard
library inventory, and reproducibility receipt. Serve the package and its relative `src/` graph from one
origin. The runtime verifies engine manifest identity, artifact byte length, and SHA-256 before boot.

```js
import { getPyProcAssetManifest, verifyPyProcAssetIntegrity } from "pyproc/assets";
```

The public asset graph contains the worker entrypoint. Engine binaries are addressed by the signed kernel
engine manifest and are not copied into Machine images.

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
