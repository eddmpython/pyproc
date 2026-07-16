# pyproc API reference

The complete root surface, one entry per export. Signatures are authoritative in
[index.d.ts](../../index.d.ts); this page adds the error codes and boundaries you need to
consume each entry without reading source. Status labels and runnable evidence live in the
[capability matrix](../consuming/capabilityMatrix.md). A structure gate keeps this page in
sync: every root export must be anchored here or `npm test` fails.

Errors: everything pyproc throws is a `PyProcError` with a `code` from `PYPROC_ERROR_CODES`,
a `retryable` flag, and optional `context` (worker Python exceptions carry
`context.pyExcType`). Branch on `error.code`, never on message text.

## Boot and runtime

### `boot(opts?)`

Boots a Pyodide runtime in this tab and resolves to a `Runtime`. Options: `indexURL`
(engine distribution), `env`, `assetIntegrity` (SRI manifest from the `pyproc-assets` CLI),
`engineScriptIntegrity`, `coreIntegrity`, `coreCacheDir` (OPFS offline cache, fail-closed).
Errors: `PYPROC_BOOT_FAILED` (retryable), `PYPROC_ASSET_INTEGRITY`, `PYPROC_ENV_UNSUPPORTED`.

### `Runtime`

The runtime handle: `run` / `runAsync` / `install` / `loadPackages` /
`loadPackagesFromImports` / `setStdout` / `setStderr` / `freeze` / `mountHome`, always-on
`memory` (`MemoryCapability`) and `fs` (`FileSystem`), and capability factories
(`enableReactive`, `enableSyscallBridge`, `enableAsgiServer`, `enableTerminal`,
`enableWheelCache`, `enableDeviceFs`, `enableInit`, `enableJournal`). `new Runtime(py)`
adopts a Pyodide instance you booted yourself (no second interpreter).
`noteStateMutation()` records a heap mutation that happened outside the run APIs;
`execSeq` is the mutation counter the reactive boundary guard reads.

### `MemoryCapability`

The heap access contract behind reactivity: page hashes, page slices, stack save/restore.
Consumers use `ReactiveController`; this type exists so capabilities never touch `HEAPU8`.

### `FileSystem`

Engine-neutral file IO (`rt.fs`): `writeFile` / `readFile` / `mkdir` / `mkdirTree` /
`readdir` / `stat` / `exists` / `unlink` / `rmdir`. Mutations bump `execSeq`.

### `PAGE_SIZE`

The delta granularity (65536). Checkpoint, journal, and machine images all move in units
of this page size.

### `checkEnvironment()`

Honest onboarding answer: are `crossOriginIsolated`, `SharedArrayBuffer`, JSPI ready, and
if not, which header or flag fixes it. Never throws; returns `{ ok, issues }`.

### `bootEnv(opts?)` / `runScript(rt, code, opts?)`

The uv lane: declared environments with snapshot-warm boots, and PEP 723 inline-dependency
scripts. `bootEnv` boots outside the deterministic-replay contract (no entropy stubbing),
so its states are not revivable machine images; use `bootSession` when you need revival.

## Error contract

### `PyProcError`

`{ code, retryable, context?, cause? }`. `retryable` is honest: outcome-unknown RPC
failures are never retryable (`PYPROC_RPC_OUTCOME_UNKNOWN` means "do not auto-replay").

### `PYPROC_ERROR_CODES`

The frozen catalog (27 codes). The d.ts union, this list, and the structure gate are kept
identical by machine check.

## Deployment assets

### `getPyProcAssetManifest(opts?)`

Which worker/service-worker files a product must ship same-origin, with roles and reasons.

### `verifyPyProcAssetIntegrity(manifest, opts?)`

SRI preflight over the worker import graph, run before any worker spawns. Errors:
`PYPROC_ASSET_INTEGRITY`, `PYPROC_ENV_UNSUPPORTED`.

### `registerPyProcServiceWorker(manifest, opts?)`

Verifies the service-worker graph, then registers `pyprocSw.js` from the same manifest URL
(cache-first engine assets, ASGI virtual origin, COOP/COEP injection - by query flags).

### `PYPROC_ASSET_MANIFEST_VERSION`

Manifest format version (currently 1).

## Reactivity (the core mechanism)

### `ReactiveController`

Obtained via `rt.enableReactive()`; memoized to one controller per runtime. Methods:

- `checkpoint()` returns a handle `{ index, sp, kind, changedPages, deltaBytes, restore() }`.
  `cp.restore()` is the canonical one-call restore (no stack-pointer carrying).
- `restore(j, savedSP?)` full restore; `restoreLive(j, savedSP?, opts?)` live-diff restore.
  A violated execution boundary auto-upgrades to the rehash path (slow, never silently
  corrupt); `opts.rehash` forces it. After calling Python through a live PyProxy, report
  with `markDirty()` (that mutation is invisible to `execSeq`).
- `collectDelta(fromIdx?, toIdx?, opts?)` the shared save/commit/export primitive.
- `pruneTo(j)` / `dispose()` memory valves for the checkpoint tree. Restoring a pruned
  node throws `PYPROC_CHECKPOINT_PRUNED`.
- `tree()`, `storageMB()`, `stackSave()`, `saveBase` / `loadBase` (backup and move of the
  base heap copy; RAM is not reduced - the valves above are the memory story).

## Machines (save, sign, revive)

### `bootSession(manifest?)`

Deterministic replay boot: `PYTHONHASHSEED=0` plus a stubbed entropy window make the same
manifest reproduce byte-identical memory (cp0). Returns a `Session`. This determinism is
the foundation under delta save, journal revival, machine images, and worker `fork`.

### `Session`

`{ rt, reactive }` plus `save(dir, name)` / `load(dir, name)` (OPFS delta persistence),
`exportImage(opts?)` (a signed portable `.pymachine`). Errors: `PYPROC_REPLAY_MISMATCH`
(cp0 fingerprint differs - engine or manifest changed), `PYPROC_HEAP_GROW_FAILED`,
`PYPROC_MACHINE_FORMAT_INVALID`.

### `openMachine(blob, opts?)`

Opens a `.pymachine` after envelope integrity and signature checks. A machine file is
live state = as dangerous as an executable: without a verified trusted signer
(`trustedPublicKeys`) or explicit `trust: true`, it refuses with
`PYPROC_MACHINE_UNTRUSTED`. Integrity failures are `PYPROC_MACHINE_INTEGRITY`.

### `createMachineKeyPair()` / `exportMachinePublicKey(key)` / `fingerprintMachinePublicKey(key)`

The WebCrypto ECDSA P-256 signing chain for machine images, and the stable
`sha256:<hex>` fingerprint for approval UIs.

### `MachineJournal`

WAL durability: commits heap delta + `/home/web` into HEAD/PREV generations on idle;
`recover()` revives from the last complete commit (falls back to PREV on corruption,
`PYPROC_JOURNAL_CORRUPT` when both fail, `PYPROC_REPLAY_MISMATCH` on engine mismatch).
`cfg.onStatus` observes idle-commit success/failure (`PYPROC_JOURNAL_IO`);
`cfg.pruneAfterCommit` trims the checkpoint tree each commit.

### `MachineJail`

Permission jail (cooperative Python chokepoints + a CSP `connect-src` browser wall the
consumer applies). Honest boundary: the Python tier alone is bypassable via `import js`.

### `Init`

`/home/web/boot.py` autostart, `cron.py` ticks, and `resume(reason)` running
`/home/web/resume.py` so revived machines reopen fds, sockets, and DB connections.

### `WheelCache`

OPFS wheel cache for `install` / `loadPackages`: second boots download nothing.

## Process OS

### `PyProc`

Worker process kernel: `boot(n)` (snapshot fast-fork spawn), `map` / `mapArray` / `matmul`
(true multi-core parallelism, N independent GILs), `exec` / `repl`, `pipe` / `lock` /
`semaphore` / `shm` (SAB IPC), `signal(pid, signum)` (real CPython signal delivery),
`kill`, `respawn(pid)` (forced lane replacement that keeps fork symmetry), `ps`,
`terminate`. With `new PyProc({ replay })` the pool boots deterministically and
`fork(srcPid, dstPid)` clones a *live* interpreter (dirty-page harvest + drift cleanse) -
workers only; the main-thread kernel replays to different bytes, so this is a worker-pool
capability by physics, not by policy.
`forkMany(srcPid, dstPids)` is the speculative-exploration primitive: it harvests the
parent delta **once** and broadcasts it to N lanes over a SharedArrayBuffer, so a fan-out
costs `O(heap + N x delta)` instead of `O(N x heap)` (measured: 316ms -> 78ms for a 21.4MB
delta across 4 lanes; 4 candidates then explore in parallel 5.2x faster than a serial retry
loop). `fork` is a 1:1 delegation to it. The returned `harvestMs` is the once-per-fan-out
cost; per-lane cost and drift-cleanse evidence are in `lanes[]`. An agent loop is three
calls: `forkMany` to fan out, run candidates in parallel, `fork(winner, main)` to adopt. `map` never leaves silent holes: when every lane
dies, unrun tasks resolve to `{ error: "pool exhausted: ..." }` values.
Errors: `PYPROC_PROCESS_UNAVAILABLE`, `PYPROC_WORKER_CRASHED` (retryable),
`PYPROC_WORKER_TASK_ERROR` (with `context.pyExcType`), `PYPROC_FORK_UNAVAILABLE`,
`PYPROC_POOL_EXHAUSTED`.

### `SIGNAL`

POSIX signal numbers (`INT` 2, `USR1` 10, `USR2` 12, `TERM` 15) for `signal(pid, signum)`.

### `JobControl`

Shell job control over a replay pool: `push("expr &")` forks the live interactive
namespace onto a job lane, `jobs()` / `fg()` / `kill(jobId, signum)` manage it, and
`killHard(jobId)` is the last resort for jobs that swallow signals (terminates the worker
and reboots the lane with the same replay manifest). Job termination is classified by the
Python exception type crossing the worker boundary, not by message matching.

### `MachineContainer`

Machines inside the machine: boots container kernels (own manifest, own packages) in
workers, exposes them to Python as `pyprocMachine` values, and routes nested containers
(`"m1/c2/c1"`) through an explicit path router at any depth. A dead container rejects
calls immediately (`PYPROC_PROCESS_UNAVAILABLE`) instead of hanging.

## Multi-tab machine

### `openPersistentMachine(opts?)`

The product entry point for "several tabs, one living Python machine": assembles
`KernelElection` + `MachineJournal` + a durable epoch. Tabs elect one leader (Web Locks);
followers talk RPC; when the leader dies, a follower promotes and revives from the last
commit. In-flight requests during a leader change fail with
`PYPROC_RPC_OUTCOME_UNKNOWN` and are never auto-replayed.

### `KernelElection`

The underlying election/RPC contract (`join` / `run` / `commit` / `ready` / `status` /
`subscribe` / `role` / `leave`). Errors: `PYPROC_LEADER_UNAVAILABLE` (retryable),
`PYPROC_SPLIT_BRAIN`, `PYPROC_LEADER_LOCK_FAILED`, `PYPROC_PARTICIPANT_LEFT`,
`PYPROC_KERNEL_EXECUTION_ERROR`.

## Supporting surfaces

### `SyscallBridge`

Borrowed syscalls v1: synchronous `input()` (JSPI), `urllib` (sync XHR), `subprocess`
(child worker inheriting `assetIntegrity`).

### `AsgiServer` / `VirtualOrigin`

In-kernel ASGI dispatch (FastAPI/Starlette with zero sockets), and real URLs for it via
the bundled service worker (`fetch()` to Python in ~3.4ms). Honest walls: no `Set-Cookie`
persistence, no WebSocket upgrade, SSE is buffered, endpoints must be `async def`.

### `Terminal`

`code.InteractiveConsole` REPL with `%pip` and, with `timeTravel: true`, `%undo` -
statement-level time travel over the shared reactive controller.

### `DeviceFs`

Everything is a file: browser capabilities exposed to Python `open()` under `/dev` and
`/proc` (e.g. `/proc/meminfo` is the real heap).

## Python-side surface (inside the interpreter)

These globals appear inside Python after the corresponding capability installs. They are
part of the public contract:

- `pyprocIpc` (module): pipes/locks/semaphores/shared memory bound by `PyProc` IPC
  factories; blocking reads park in bounded slices so signals can interleave.
- `pyprocMachine` (module): `spawn(manifest)` returns container values with
  `run` / `spawn` / `heapLen` / `kill` (nested containers included).
- `pyprocJail` (module): cooperative permission chokepoints installed by `MachineJail`.
- `pyprocGpu` (module): numpy-to-GPU matmul bridge installed by the `pyproc/gpu` subpath's
  `GpuBridge`.
- `pyprocResumeReason` (str): why this machine was revived (`"journal"`, `"session"`,
  `"machine"`), set for `/home/web/resume.py` runs via `Init.resume(reason)`.

## Subpath surfaces

Stable subpaths: `pyproc/runtime`, `pyproc/reactive`, `pyproc/syscall-bridge`,
`pyproc/process-os`, `pyproc/assets`, `pyproc/worker` (asset entry). Demoted surfaces live
on their own subpaths, deliberately off the root: `pyproc/gpu` (`GpuCompute`, `GpuArray`,
`GpuBridge` - headless CI cannot see a GPU adapter), `pyproc/socket` (`SocketBridge` -
needs an external WS-to-TCP relay), `pyproc/wasi` (`bootWasi`, `WasiSession` - research
preview proving the engine-independent core; the production lane is Pyodide).
