# pyproc API reference

The root surface gathers the complete product choice through `Machine` (unified Builder/Fluent/Preset),
`open` for the durable Python Machine and source-specific revival, `boot` for an explicit transient Machine,
`createWebComputer` for the multi-guest host, `checkEnvironment` for preflight, and the shared error
contract (`PyProcError`, `PYPROC_ERROR_CODES`). Everything else is a verb on a returned handle, an
advanced escape hatch, or a plumbing subpath. Signatures are
authoritative in [index.d.ts](../../index.d.ts); this page adds the error codes and
boundaries needed to use each entry without reading source. Contract states and
runnable evidence live in the [capability matrix](../usage/capabilityMatrix.md). A
structure gate keeps this page in sync: every root export must be anchored here or
`npm test` fails.

Errors: everything pyproc throws is a `PyProcError` with a `code` from
`PYPROC_ERROR_CODES`, a `retryable` flag, and optional `context` (worker Python exceptions
carry `context.pyExcType`). Branch on `error.code`, never on message text. The full code
table is in [Errors](#errors) below.

## Root exports

| Need | Root entry | Return |
|---|---|---|
| Durable Python work that survives tabs | `open()` / `open({ name })` | `KernelElection` |
| Transient Python, rewind, processes, or portable state | `boot()` / source-bearing `open(...)` | `PyprocMachine` |
| Multiple guest operating systems under one lifecycle | `createWebComputer()` | `WebComputer` |
| Capability preflight | `checkEnvironment()` | `EnvReport` |
| Failure branching | `PyProcError`, `PYPROC_ERROR_CODES` | shared error contract |

### `boot(options?)`

Boots one explicit transient Python kernel in this tab and resolves to a `PyprocMachine` handle. Use
`open()` for the default durable Machine. Options
are the engine boot options (`indexURL`, `packages`, `env`, `stdout` / `stderr`,
`coreCacheDir` for OPFS offline caching, `engineScriptIntegrity`, `coreIntegrity`,
`assetIntegrity` from the `pyproc-assets` CLI, `lockFileURL` from a previous `freeze()`)
plus the deterministic manifest (`deterministic`, `setup`, `wheelDir`).

`boot({ deterministic: true, ...manifest })` opts into deterministic replay boot:
`PYTHONHASHSEED=0` plus a stubbed entropy window make the same manifest reproduce
byte-identical memory at the replay boundary (cp0). This is opt-in because it changes
guest-visible semantics; the choice is recorded in the environment fingerprint of every
durable commit, and it is the precondition for `history.export` and `history.save`
(see [Deterministic boot contract](#deterministic-boot-contract)).

Errors: `PYPROC_BOOT_FAILED` (retryable), `PYPROC_ASSET_INTEGRITY`,
`PYPROC_ENV_UNSUPPORTED`, `PYPROC_INPUT_INVALID`.

### `open(source?, opts?)`

The default Machine and the one revival verb. The trust contract follows the source; semantics are
deliberately not flattened into one code path:

- **`open()` / `open({ name?, ...machineOptions })`** opens an OPFS-backed Machine. Same-origin tabs
  elect one leader, followers use BroadcastChannel RPC, and each completed command auto-commits its
  heap, `/home/web`, and any forwarded outcome before settling. It resolves to `KernelElection`.
  `commit()` remains an explicit force boundary; `autoCommit: false` opts into manual/idle behavior.
  Errors: `PYPROC_LEADER_UNAVAILABLE` (retryable), `PYPROC_SPLIT_BRAIN`,
  `PYPROC_LEADER_LOCK_FAILED`, `PYPROC_PARTICIPANT_LEFT`, `PYPROC_RPC_ACTION_INVALID`, and
  `PYPROC_KERNEL_EXECUTION_ERROR`. A sent request follows the
  [normative durable RPC state table](../usage/contract.md#durable-rpc-state-table-normative).
- **`open(blob | bytes, trustOpts?)`** revives a portable bundle from outside. Envelope
  integrity and signature are verified before any byte reaches the heap. A machine file
  is live state, as dangerous as an executable: without a verified trusted signer
  (`trustedPublicKey` / `trustedPublicKeys`) or explicit `trust: true` it refuses with
  `PYPROC_MACHINE_UNTRUSTED`. Format violations are `PYPROC_MACHINE_FORMAT_INVALID`,
  digest mismatches `PYPROC_MACHINE_INTEGRITY`, engine or manifest drift at replay
  `PYPROC_REPLAY_MISMATCH`. Resolves to a `PyprocMachine`. The envelope layout
  (`PYBUNDLE1`) is authoritative in [bundleFormat.md](bundleFormat.md).
- **`open({ dir, name }, { manifest? })`** revives your own OPFS session save: replays
  the manifest, checks the cp0 fingerprint (h0), then applies the saved delta. Errors:
  `PYPROC_REPLAY_MISMATCH` (engine or manifest changed since `history.save`),
  `PYPROC_HEAP_GROW_FAILED`. Resolves to a `PyprocMachine`.

Any other source shape is `PYPROC_INPUT_INVALID`.

### `createWebComputer(options?)`

Assembles one browser computer: host, devices (console, block disks, text display,
scan-code input), a Python guest wired to the same deterministic session and bundle
machinery as `boot` / `open`, and an optional x86 Linux guest when a `V86` constructor is
injected (`options.linux`). Returns the host, devices, machine handles, and lifecycle
controls (`bootAll`, `pauseRunning`, `resumeAll`, `shutdownAll`, ownership fan-out).
`createMachines: false` assembles hardware only, for restore paths where a signed
`.webmachine` image creates the machines. The full machine surface (devices, stores,
image envelope, trust) lives under the `pyproc/machine` subpath.

With `options.durability = { groupId, store, ... }`, the returned `WebComputer` owns the complete
durable lifecycle. `initialize()` acquires ownership and either restores the fenced HEAD or boots a
new set. `save()` pauses running guests, flushes devices, publishes one generation, and resumes.
`exportImage()` signs all guest snapshots and devices as one `.webmachine`; `importImage()` verifies
trust and permissions in an isolated candidate before atomically replacing the active set.
`inspect()` exposes `startupMode` and `durabilityState`; `dispose()` releases ownership and guests.
If a save fails, the computer remains explicitly `unsaved` rather than presenting the old generation
as current.

### `checkEnvironment()`

Honest onboarding answer: are `crossOriginIsolated`, `SharedArrayBuffer`, JSPI ready, and
if not, which header or flag fixes it. Never throws; returns `{ ok, issues }`. The basic
surface (`boot`, `machine.run`, `machine.history` volatile verbs) works without the
process-OS preconditions; `machine.proc`, IPC, and blocking sockets need them.

### `PyProcError`

`{ code, retryable, context?, cause? }`. `retryable` is honest: outcome-unknown RPC
failures are never retryable. The code means that this caller cannot prove an outcome; it
does not prove that no record or effect exists.

### `PYPROC_ERROR_CODES`

The frozen catalog (29 codes). The d.ts union, this list, and the structure gate are kept
identical by machine check. The full table is in [Errors](#errors).

## The machine handle

`boot` and the bundle/session forms of `open` resolve to `PyprocMachine`. The handle's
namespaces are the model's vocabulary:

- `machine.run(code)` / `machine.runAsync(code)` - execute Python (sync, or JSPI async
  with top-level `await`).
- `machine.fs` - engine-neutral file IO (`FileSystem`): `writeFile` / `readFile` /
  `mkdir` / `mkdirTree` / `readdir` / `stat` / `exists` / `unlink` / `rmdir`.
- `machine.term(cfg?)` - serverless REPL (`Terminal`); with `timeTravel: true`, `%undo`
  is statement-level time travel over the machine's history.
- `machine.proc(opts?)` - boots a worker process pool and resolves to `PyProc`
  (see [Process OS](#process-os-machineproc)). `lanes` sets the pool size (default 2),
  `replay` makes the pool fork-symmetric. **Memoized per option set**: calling it again with the
  same options resolves to the same pool, so a remount does not stack workers; different options
  (for example a plain pool and a `replay` pool for `fork`) get their own pool. `machine.dispose()`
  terminates every pool the machine created.
- `machine.loadPackages(packages)` - loads packages into this machine, so installing numpy is part
  of the handle's own vocabulary rather than a reason to reach for the escape hatch.
- `machine.markDirty()` - declares a heap mutation the run APIs did not see (a call through a live
  proxy handle, for instance), so the next restore takes the rehash path instead of the fast one.
- `machine.jobs(opts?)` - shell job control (`JobControl`). `expr &` forks the live interactive
  namespace and runs it on another core, so the prompt returns immediately, and `%jobs` / `%fg` /
  `%kill` drive the jobs. It stands up its own worker pool (one interactive lane plus N-1 job
  slots, `workers` defaults to 3), so it is separate from the pool `proc()` returns. Memoized one
  per machine.
- `machine.containers(cfg?)` - a machine inside the machine (`MachineContainer`). Python calls
  `pyprocMachine.spawn()` to start a child kernel with its own package set, and nesting works.
  Memoized one per machine.
- `machine.dispose()` - terminates the workers of every pool this machine created (`proc`, `jobs`,
  and `containers` alike) and releases the reactive retention. Call it before dropping a machine;
  a lost pool handle cannot be reclaimed otherwise.
- `machine.deterministic` - whether this machine was booted under the deterministic
  replay contract.
- `machine.history` - the two-region history (below).
- `machine.runtime` - the escape hatch to the assembled `Runtime`
  (see [Runtime escape hatch](#runtime-escape-hatch-machineruntime)).

### `machine.history`

State (heap, files, devices) lives in one history store with two regions. The volatile
region is the RAM checkpoint tree (time travel, branching, `%undo`, fork foundations);
the durable region is the content-addressed commit store (crash revival, portable
bundles). Promotion to sha256 addresses happens only in the durable region.

Volatile verbs:

- `checkpoint()` closes an execution boundary and returns a `CheckpointInfo` handle.
  `cp.restore()` is the canonical one-call restore (the stack pointer is stored on the
  node; nothing to carry).
- `restore(target, opts?)` restores to a checkpoint handle or index via the live-diff
  path. A violated execution boundary auto-upgrades to the rehash path (slower, never
  silently corrupt); `opts.rehash` forces it. Restoring to a past node and then
  checkpointing creates a branch (the machine's git).
- `tree()` returns the checkpoint tree (each node's parent/children).
- `prune(target)` frees deltas and hashes outside the root-to-target chain (the RAM
  valve). Restoring a pruned node throws `PYPROC_CHECKPOINT_PRUNED`.
- `stats()` reports exact controller-owned base/delta/hash bytes, node/branch counts,
  live depth, and the last pressure event.
- `setRetentionPolicy(policy)` sets observable budgets (`maxNodes`, `maxDeltaBytes`,
  `maxTotalBytes`). `pruneBranches: true` may remove only off-live-path branches;
  the live path is never silently dropped or rebased.

Durable verbs (all take `{ dir }`, a `FileSystemDirectoryHandle`; the same `dir` shares
one journal instance):

- `commit(opts)` commits the heap delta and `/home/web` into the same HEAD/PREV
  generation (WAL). Crash contract: what you lose is "since the last commit".
- `delete(opts)` removes the journal generations and writes a `deleted` tombstone last.
- `recover(opts)` revives from the last complete commit (falls back to PREV on a corrupt
  HEAD; `PYPROC_JOURNAL_CORRUPT` when both generations fail,
  `PYPROC_JOURNAL_EVICTED` when a committed marker survives but both refs are missing,
  `PYPROC_REPLAY_MISMATCH` on engine mismatch). It returns `null` only for a
  never-committed directory or an explicit delete.
- `watch(opts)` starts the idle watcher (commits when the machine goes idle; never
  interrupts execution). Durable-claim failures are observable via `onStatus`
  (`PYPROC_JOURNAL_IO`), never silently swallowed.
- `pack(opts)` compacts live blobs into one pack file and drops loose/stale files.
- `export(opts?)` exports a signed portable bundle (`PYBUNDLE1`). Deterministic boots
  only.
- `save(dir, name)` saves the session delta to OPFS; revival is
  `open({ dir, name })` = same-manifest replay + delta. Deterministic boots only.

### Deterministic boot contract

`history.export` and `history.save` exist only on machines booted with
`boot({ deterministic: true })`. A non-deterministic machine has no replay guarantee, so
exporting it would silently drop the revival promise; both verbs refuse with
`PYPROC_INPUT_INVALID` instead. The deterministic choice is stamped into the environment
fingerprint (`deterministic`) of every durable commit, so a reader can tell which
guarantee a commit carries.

### Cost receipts

Every state verb returns its cost; nothing is free and nothing hides:

- `checkpoint()` returns `{ index, kind, changedPages, deltaBytes, sp, parent?, restore() }`
  (`kind` is `"base"` or `"delta"`).
- `restore(...)` returns `{ pagesWritten, mbWritten, rehashed }` (`rehashed` reports
  whether the boundary-violation rehash path ran).
- `commit(...)` returns `{ pages, wrote, mb, committedAt, home?, autoPack?, pruned? }`
  (`wrote` is after content-address dedupe; `home` reports the file-tree generation).
- `pack(...)` returns `{ liveKeys, packed, bytes, mb, looseRemoved, packsRemoved }`.
- `prune(target)` returns `{ freedNodes, freedMB, keptNodes }`.

## Runtime escape hatch (`machine.runtime`)

Porcelain is a summary, not a jail: capability detail rides on the assembled `Runtime`
behind `machine.runtime`. Callers use capability contracts, never engine internals
(`HEAPU8`, `raw.FS`).

### `Runtime`

`run` / `runAsync` / `install` / `loadPackages` / `loadPackagesFromImports` /
`setStdout` / `setStderr` / `freeze` (lock the environment as a pyodide-lock JSON, feed
back via `boot({ lockFileURL })`) / `mountHome` (mount an OPFS directory at `/home/web`),
always-on `memory` (`MemoryCapability`) and `fs` (`FileSystem`), and capability factories
(`enableReactive`, `enableSyscallBridge`, `enableAsgiServer`, `enableVirtualOrigin`,
`enableTerminal`, `enableJail`, `enableWheelCache`, `enableDeviceFs`, `enableInit`,
`enableJournal` - that list is the complete registry). `new Runtime(py)`
adopts a Pyodide instance you booted yourself (no second interpreter).
`noteStateMutation()` records a heap mutation that happened outside the run APIs;
`execSeq` is the mutation counter the reactive boundary guard reads.

### `MemoryCapability`

The heap access contract behind reactivity: page hashes, page slices, stack
save/restore. This type exists so capabilities never touch `HEAPU8`.

### `ReactiveController`

The engine room under `machine.history`'s volatile verbs, obtained via
`machine.runtime.enableReactive()`; memoized to one controller per runtime (two
controllers could silently corrupt each other's live-diff restores). Adds to the handle
verbs: `restoreLive(j, savedSP?, opts?)`, `collectDelta(fromIdx?, toIdx?, opts?)` (the
shared save/commit/export primitive), `markDirty()` (report mutations invisible to
`execSeq`, e.g. calls through a live PyProxy), `pruneTo(j)` / `dispose()`,
`storageMB()`, `stackSave()`, and `saveBase` / `loadBase` (backup and move of the base
heap copy; RAM is not reduced - the prune valves are the memory story).

### `SyscallBridge`

Borrowed syscalls v1 via `machine.runtime.enableSyscallBridge(cfg?)`: blocking `input()`
(sync handler or JSPI async), `urllib` (sync XHR, optional `proxyUrl`), `requests`
wiring, and `subprocess` child workers (inheriting `assetIntegrity`).

### `AsgiServer` / `VirtualOrigin`

In-kernel ASGI dispatch via `machine.runtime.enableAsgiServer(cfg?)`: FastAPI/Starlette
with zero sockets, hot-swap by reassigning the app global. `VirtualOrigin` binds it to
real URLs through the bundled service worker, registered via
`registerPyProcServiceWorker` from `pyproc/assets` (`fetch()` reaches Python without
leaving the tab). Honest walls: no `Set-Cookie` persistence, no WebSocket upgrade, SSE is
buffered, endpoints must be `async def`.

### `Terminal`

`code.InteractiveConsole` REPL behind `machine.term(cfg?)` (equivalently
`machine.runtime.enableTerminal`): `%pip`, and with `timeTravel: true`, `%undo` over the
shared history.

### `DeviceFs`

Everything is a file, via `machine.runtime.enableDeviceFs(cfg?)`: browser capabilities
exposed to Python `open()` under `/dev` and `/proc` (`/proc/meminfo` is the real heap,
`/dev/clipboard`, `/dev/random`, `/dev/fb0` framebuffer, `/proc/<pid>/ctl` signals via
`track(pid)`). Device reads are synchronous by contract; async sources are honest caches.

### `Init`

Via `machine.runtime.enableInit(cfg?)`: `/home/web/boot.py` autostart, `cron.py` ticks,
and `resume(reason)` running `/home/web/resume.py` so revived machines reopen fds,
sockets, and DB connections.

### `WheelCache`

Via `machine.runtime.enableWheelCache({ dir })`: OPFS wheel cache for
`install` / `loadPackages`; second boots download nothing. The declared-environment lane
(formerly `bootEnv` / `runScript` at the root) is folded into the `boot` manifest:
`packages`, `env`, `setup`, and `wheelDir` are boot options.

### `MachineJournal`

The WAL engine under `machine.history`'s durable verbs, constructed via
`machine.runtime.enableJournal(cfg)` when you need the raw surface (`start` / `stop` /
`commit` / `delete` / `pack` / `prune` / `recover`, counters). `cfg.onStatus` observes idle-commit
success/failure (`PYPROC_JOURNAL_IO`); `cfg.autoPack` packs past a loose-blob threshold;
`cfg.pruneAfterCommit` trims the checkpoint tree each commit.

A successful commit writes `journalMarker.json` only after HEAD is complete. If that committed
marker remains while HEAD and PREV are both absent, `recover()` raises
`PYPROC_JOURNAL_EVICTED` instead of impersonating a fresh machine. `delete()` removes the backing
generations first and writes a `deleted` tombstone last, for which `recover()` returns `null`.
This sentinel detects partial loss, not origin-wide eviction: a browser may evict the marker and
the backing store together, which is indistinguishable from a never-created journal. Keep an
exported image outside the origin when recovery from that event is required.

### `enableJail(permissions?)` and `MachineJail`

`machine.runtime.enableJail(permissions)` installs the permission jail and returns
`{ jail, permissions, connectSrc }`. That is the reachable entry point: the `MachineJail` class
itself is not exported, so reach it through the returned `jail` handle when you need
`allows(perm, arg?)`, `connectSrc()`, or `csp()`.

Two tiers of enforcement. The cooperative tier plants Python chokepoints (the `pyprocJail`
module), and the browser tier is the CSP `connect-src` of the jailed context, which the caller
applies. Honest boundary: the Python tier alone is bypassable via `import js`, which is exactly
why the browser wall exists; that wall requires a jailed context (a CSP iframe), and full
isolation (an opaque origin) costs the SharedArrayBuffer capabilities.

```js
const { jail, connectSrc } = machine.runtime.enableJail({ net: ["api.example.com"], home: true });
// connectSrc === "'self' api.example.com" - put jail.csp() on the jailed iframe
```

## Process OS (`machine.proc`)

**The `_fn` contract.** `map`, `exec`, and `mapArray` take Python *source* that defines a
function named `_fn`; the worker calls `_fn(arg)`. Any other name raises `NameError` inside the
worker and surfaces as `PYPROC_WORKER_TASK_ERROR`:

```js
const pool = await machine.proc({ lanes: 4 });
const fn = "def _fn(n):\n    return sum(i * i for i in range(n))";
const results = await pool.map(fn, [10000, 20000, 30000, 40000]); // order preserved
```


### `PyProc`

Worker process kernel, obtained via `machine.proc(opts?)`: `boot(n)` (snapshot fast-fork
spawn), `map` / `mapArray` / `matmul` (true multi-core parallelism, N independent GILs),
`exec`, `pipe` / `lock` / `semaphore` / `shm` (SAB IPC), `signal(pid, signum)` (real
CPython signal delivery), `kill`, `respawn(pid)` (forced lane replacement that keeps fork
symmetry), `ps`, `terminate`. With a `replay` manifest the pool boots deterministically
and `fork(srcPid, dstPid)` clones a *live* interpreter (dirty-page harvest + drift
cleanse) - workers only; the main-thread kernel replays to different bytes, so this is a
worker-pool capability by physics, not by policy.
`forkMany(srcPid, dstPids)` is the speculative-exploration primitive: it harvests the
parent delta **once** and broadcasts it to N lanes over a SharedArrayBuffer, so a fan-out
costs `O(heap + N x delta)` instead of `O(N x heap)`, and lanes stay isolated while
candidate results remain byte-identical to a serial run. `fork` is a 1:1 delegation to
it. Measure the envelope on your own machine with Speed Lab; this page does not carry
benchmark headlines. The returned `harvestMs` is the once-per-fan-out cost; per-lane cost
and drift-cleanse evidence are in `lanes[]`. An agent loop is three calls: `forkMany` to
fan out, run candidates in parallel, `fork(winner, main)` to adopt. `map` never leaves
silent holes: when every lane dies, unrun tasks resolve to
`{ error: "pool exhausted: ..." }` values.
Errors: `PYPROC_PROCESS_UNAVAILABLE`, `PYPROC_WORKER_CRASHED` (retryable),
`PYPROC_WORKER_TASK_ERROR` (with `context.pyExcType`), `PYPROC_TASK_TIMEOUT`,
`PYPROC_FORK_UNAVAILABLE`, `PYPROC_POOL_EXHAUSTED`.

### `SIGNAL`

POSIX signal numbers (`INT` 2, `USR1` 10, `USR2` 12, `TERM` 15) for
`signal(pid, signum)`, available as `PyProc.SIGNAL`.

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

## Default durable machine

### `KernelElection`

The handle returned by `open()` or `open({ name })`, and the
underlying election/RPC contract: `join` / `run` / `commit` / `ready` / `status` /
`subscribe` / `role` / `leave`. Tabs elect one leader over Web Locks; only the leader
boots the kernel (deterministic session + journal); followers are RPC views over
BroadcastChannel. When the leader tab dies, the lock releases, a follower promotes and
resumes from the journal. Errors: `PYPROC_LEADER_UNAVAILABLE` (retryable),
`PYPROC_SPLIT_BRAIN`, `PYPROC_LEADER_LOCK_FAILED`, `PYPROC_PARTICIPANT_LEFT`,
`PYPROC_KERNEL_EXECUTION_ERROR`, `PYPROC_RPC_OUTCOME_UNKNOWN` (never retryable). With the default
`autoCommit: true`, command execution and generation commit are serialized; the Promise settles only
after commit. A commit failure after execution is outcome-unknown because retrying could duplicate an
effect. `status().autoCommit` exposes the mode. The
[durable RPC state table](../usage/contract.md#durable-rpc-state-table-normative) owns
the exact resend boundary; `status().rpcSemantics` is its compact runtime projection.

## Python-side surface (inside the interpreter)

These globals appear inside Python after the corresponding capability installs. They are
part of the public contract:

- `pyprocIpc` (module): pipes/locks/semaphores/shared memory bound by `PyProc` IPC
  factories; blocking reads park in bounded slices so signals can interleave.
- `pyprocMachine` (module): `spawn(manifest)` returns container values with
  `run` / `spawn` / `heapLen` / `kill` (nested containers included).
- `pyprocJail` (module): cooperative permission chokepoints installed by `MachineJail`.
- `pyprocGpu` (module): numpy-to-GPU matmul bridge installed by the `pyproc/gpu`
  subpath's `GpuBridge`.
- `pyprocResumeReason` (str): why this machine was revived (`"journal"`, `"session"`,
  `"machine"`), set for `/home/web/resume.py` runs via `Init.resume(reason)`.

## Subpaths

### `pyproc/history`

The state kernel: the durable region's contract surface, typed in
`src/state/index.d.ts`. `PAGE_SIZE` (65536, the delta granularity every checkpoint,
journal, and bundle moves in), the sha256 address law (`sha256Address`,
`parseSha256Address`, `verifySha256`), the object model (`canonicalStateJson`, page-table
and payload trees, commits with environment fingerprints and fences), the `StateStore`
contract with `MemoryStateStore` and `OpfsStateStore`, the commit/revival protocol
(`commitState` / `openState`, HEAD/PREV generations, verify-on-read), signed tags
(`createStateKeyPair` / `exportStatePublicKey` / `fingerprintStatePublicKey` /
`signStateTag` / `verifyStateTag` - the signing chain formerly exported from the root as
`createMachineKeyPair` / `exportMachinePublicKey` / `fingerprintMachinePublicKey`), and
the portable bundle codec (`encodeStateBundle` / `decodeStateBundle`, magic
`PYBUNDLE1`). The byte layout is authoritative in [bundleFormat.md](bundleFormat.md).
Errors: `PYPROC_STATE_CORRUPT`, `PYPROC_STATE_FENCE_STALE`.

### `pyproc/machine`

The browser-computer detail surface behind `createWebComputer`: `WebMachineHost`,
machine handles, devices (clock, entropy, block, display, input, ethernet), stores
(`IndexedDbMachineStore`, `MemoryMachineStore`), commit/owner coordination, the
`.webmachine` image envelope and trust chain, and guest factories
(`createPyprocGuestFactory`, `createV86GuestFactory`). New: `createMachineCryptoProvider`
bundles the state kernel's crypto law (digest, ECDSA sign/verify, key generation) into
the provider that persistence and image constructors now require - they no longer accept
a bare `Crypto` object. Errors here are `WebMachineError` (with `code`) or `TypeError`
(argument contract).

**Guests on one wire.** `createWebComputer` attaches a built-in L2 switch (`network`, on by
default; pass `network: false` to disable) and binds a packet port to *both* guests, so two
guests on one computer can exchange actual Ethernet frames rather than merely coexisting.
Inside the Python guest the port installs a `pyprocNet` module:

| Call | Contract |
|---|---|
| `pyprocNet.send(frame)` | Puts one Ethernet frame on the wire; returns the byte count |
| `pyprocNet.recv()` | Next queued frame as `bytes`, or `None` when the queue is empty |
| `pyprocNet.pending()` | Frames waiting to be read |
| `pyprocNet.address()` | `{ mac, ipv4, endpointId }` for this guest |

The port answers ARP requests and ICMP echo for its own address, so a peer guest reaches it
without any Python code running. Anything above the frame boundary (TCP, UDP, DNS) is the
guest's own business - the library hands over frames, not a stack. The port's Python surface
is removed around `snapshot()` and reinstalled afterwards, because an image that carries live
JS proxies cannot be revived in another process.

**Device and machine lifecycle.** A computer that can only add hardware is not a computer,
so the host exposes the removal side too:

| Verb | Contract |
|---|---|
| `host.listDevices()` | Names of every attached virtual device, in deterministic order |
| `host.detachDevice(name)` | Removes a device. Refuses with `WEB_MACHINE_DEVICE_IN_USE` while any machine's permissions still require it |
| `host.destroyMachine(machineId)` | Drops a machine from the registry. Refuses with `WEB_MACHINE_MACHINE_IN_USE` unless it is stopped or failed |
| `machineHandle.usesDevice(name)` | Whether this machine requires that device; this is what `detachDevice` asks each machine |

Detach and destroy are the same shape on purpose: removal is refused while something still
depends on the thing being removed, rather than succeeding and leaving a dangling reference.

### Engine assets

The npm tarball does not embed the Pyodide distribution. Prepare the pinned release with
`npx pyproc-engine --out <static-root>/vendor/pyodide`; default boot reads the verified same-origin
`/vendor/pyodide/` path. The CLI verifies catalog-pinned core anchors and every package file named by
the trusted lock. Runtime boot pins the engine script SRI and re-verifies fetched core bytes. Control
caching with `coreCacheDir`; use `indexURL` only to select another explicit distribution point. A boot
that cannot reach the distribution fails with `PYPROC_BOOT_FAILED` naming the URL it tried.

### `pyproc/assets`

Deployment asset integrity, typed in `src/runtime/assets.d.ts`:

- `getPyProcAssetManifest(opts?)` - which worker/service-worker files a product must
  ship same-origin, with roles and reasons.
- `verifyPyProcAssetIntegrity(manifest, opts?)` - SRI preflight over the worker import
  graph, run before any worker spawns. Errors: `PYPROC_ASSET_INTEGRITY`,
  `PYPROC_ENV_UNSUPPORTED`.
- `registerPyProcServiceWorker(manifest, opts?)` - verifies the service-worker graph,
  then registers `pyprocSw.js` from the same manifest URL (cache-first engine assets,
  ASGI virtual origin, COOP/COEP injection - by query flags).
- `PYPROC_ASSET_MANIFEST_VERSION` - manifest format version (currently 1).

### `pyproc/worker`

The worker asset entry (`src/processOs/worker.js`). Not an API to call: it exists so
bundlers and the asset manifest can address the process-worker graph.

### Demoted subpaths

Deliberately off the root: `pyproc/gpu` (`GpuCompute`, `GpuArray`, `GpuBridge` -
headless CI cannot see a GPU adapter; `PYPROC_GPU_UNAVAILABLE`), `pyproc/socket`
(`SocketBridge` - needs an external WS-to-TCP relay), `pyproc/wasi` (`bootWasi`,
`WasiSession` - research preview proving the engine-independent core; the production
lane is Pyodide).

### `pyproc/runtime`

Available from 0.0.11.
The adoption seam for a Pyodide instance you booted yourself: `new Runtime(py)`,
`bootRuntime(opts)` (resolves to a `Runtime`, not a machine), `MemoryCapability`,
`FileSystem`, `checkEnvironment`, and the Engine/Runtime contract assertions
(`assertEngineContract`, `requireEngineCapability`, `assertRuntimeContract`). Reach for it
only when pyproc must not own the engine boot; otherwise `boot()` plus `machine.runtime` is
the same object with the machine verbs attached.

### Retired subpaths

`pyproc/reactive`, `pyproc/syscall-bridge`, and `pyproc/process-os` no
longer exist. Their capabilities did not disappear; they moved onto the handle:
`boot` returns the machine, `machine.history` carries the reactive verbs,
`machine.runtime.enableSyscallBridge()` carries the syscalls, and `machine.proc()`
carries the process pool. The migration table lives in the
[CHANGELOG](../../CHANGELOG.md).

## Errors

All codes in `PYPROC_ERROR_CODES`, grouped by lane:

| Code | Meaning |
|---|---|
| `PYPROC_ENV_UNSUPPORTED` | A platform capability is missing (crossOriginIsolated, SharedArrayBuffer, JSPI); `checkEnvironment()` explains the fix |
| `PYPROC_INPUT_INVALID` | Argument contract violation, including durable verbs (`history.export` / `history.save`) on a non-deterministic machine |
| `PYPROC_BOOT_FAILED` | Engine boot failure (retryable) |
| `PYPROC_ASSET_INTEGRITY` | SRI verification failed for an engine or worker asset |
| `PYPROC_MACHINE_FORMAT_INVALID` | Bundle envelope violates the format contract |
| `PYPROC_MACHINE_INTEGRITY` | Bundle digest mismatch (corrupt or tampered) |
| `PYPROC_MACHINE_UNTRUSTED` | Unsigned or untrusted bundle without an explicit trust decision |
| `PYPROC_REPLAY_MISMATCH` | Deterministic replay produced a different fingerprint (engine or manifest changed) |
| `PYPROC_HEAP_GROW_FAILED` | Could not grow the heap to the saved length |
| `PYPROC_CHECKPOINT_PRUNED` | Restore target was pruned from the checkpoint tree |
| `PYPROC_PROCESS_UNAVAILABLE` | Process id not alive in the pool table |
| `PYPROC_FORK_UNAVAILABLE` | Pool lacks fork symmetry (no replay manifest) |
| `PYPROC_WORKER_CRASHED` | Worker died (retryable) |
| `PYPROC_WORKER_TASK_ERROR` | Python exception inside a task (`context.pyExcType`) |
| `PYPROC_TASK_TIMEOUT` | Task exceeded `taskTimeoutMs`; the lane is killed and respawned |
| `PYPROC_POOL_EXHAUSTED` | Every lane died; unrun `map` tasks resolve to error values |
| `PYPROC_JOURNAL_CORRUPT` | Both journal generations (HEAD and PREV) failed to recover |
| `PYPROC_JOURNAL_EVICTED` | A committed journal marker survived but HEAD and PREV are both missing; do not create a fresh machine over it |
| `PYPROC_JOURNAL_IO` | Journal storage IO failure (observable via `onStatus`) |
| `PYPROC_STATE_CORRUPT` | State kernel object or generation failed verify-on-read (PREV fallback axis) |
| `PYPROC_STATE_FENCE_STALE` | Ref update fenced: a superseded owner epoch tried to write (HEAD untouched) |
| `PYPROC_RPC_OUTCOME_UNKNOWN` | This caller cannot establish the result of a sent request; never retryable. See the durable RPC state table before deciding whether a product-level retry is safe |
| `PYPROC_LEADER_UNAVAILABLE` | No leader is serving (retryable) |
| `PYPROC_SPLIT_BRAIN` | Two leaders detected for one machine name |
| `PYPROC_LEADER_LOCK_FAILED` | Web Locks acquisition failed |
| `PYPROC_RPC_ACTION_INVALID` | Unknown RPC action reached the leader |
| `PYPROC_PARTICIPANT_LEFT` | The participant left while waiting for leader readiness. An already-sent request uses `PYPROC_RPC_OUTCOME_UNKNOWN` |
| `PYPROC_KERNEL_EXECUTION_ERROR` | Leader-side kernel execution failed |
| `PYPROC_GPU_UNAVAILABLE` | No WebGPU adapter (`pyproc/gpu`) |
| `PYPROC_INTERNAL` | Invariant violation inside pyproc (a bug; please report) |
