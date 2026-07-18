# pyproc API reference

The root surface is exactly six exports: two entry verbs (`boot`, `createWebComputer`),
one revival verb (`open`), one diagnostic (`checkEnvironment`), and the error contract
(`PyProcError`, `PYPROC_ERROR_CODES`). Everything else is a verb on the machine handle
those entries return, an escape hatch off that handle, or a subpath. Signatures are
authoritative in [index.d.ts](../../index.d.ts); this page adds the error codes and
boundaries you need to consume each entry without reading source. Status labels and
runnable evidence live in the [capability matrix](../consuming/capabilityMatrix.md). A
structure gate keeps this page in sync: every root export must be anchored here or
`npm test` fails.

Errors: everything pyproc throws is a `PyProcError` with a `code` from
`PYPROC_ERROR_CODES`, a `retryable` flag, and optional `context` (worker Python exceptions
carry `context.pyExcType`). Branch on `error.code`, never on message text. The full code
table is in [Errors](#errors) below.

## Root exports

### `boot(options?)`

Boots one Python machine in this tab and resolves to a `PyprocMachine` handle. Options
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

### `open(source, opts?)`

The one revival verb. The trust contract follows the source; the semantics are
deliberately not flattened into one code path:

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
- **`open({ persistent })`** opens the multi-tab persistent machine: tabs elect one
  leader (Web Locks), followers speak RPC (BroadcastChannel), and when the leader dies a
  follower promotes and revives from the last journal commit. Resolves to a
  `KernelElection` handle, not a `PyprocMachine` (see
  [Multi-tab machine](#multi-tab-machine-open-persistent-) below). Errors:
  `PYPROC_LEADER_UNAVAILABLE` (retryable), `PYPROC_SPLIT_BRAIN`,
  `PYPROC_LEADER_LOCK_FAILED`, `PYPROC_PARTICIPANT_LEFT`, `PYPROC_RPC_ACTION_INVALID`,
  `PYPROC_KERNEL_EXECUTION_ERROR`. In-flight requests during a leader change fail with
  `PYPROC_RPC_OUTCOME_UNKNOWN` and are never auto-replayed.

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

### `checkEnvironment()`

Honest onboarding answer: are `crossOriginIsolated`, `SharedArrayBuffer`, JSPI ready, and
if not, which header or flag fixes it. Never throws; returns `{ ok, issues }`. The basic
surface (`boot`, `machine.run`, `machine.history` volatile verbs) works without the
process-OS preconditions; `machine.proc`, IPC, and blocking sockets need them.

### `PyProcError`

`{ code, retryable, context?, cause? }`. `retryable` is honest: outcome-unknown RPC
failures are never retryable (`PYPROC_RPC_OUTCOME_UNKNOWN` means "do not auto-replay").

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
  (see [Process OS](#process-os-machineproc)). `lanes` sets the pool size,
  `replay` makes the pool fork-symmetric.
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

Durable verbs (all take `{ dir }`, a `FileSystemDirectoryHandle`; the same `dir` shares
one journal instance):

- `commit(opts)` commits the heap delta and `/home/web` into the same HEAD/PREV
  generation (WAL). Crash contract: what you lose is "since the last commit".
- `recover(opts)` revives from the last complete commit (falls back to PREV on a corrupt
  HEAD; `PYPROC_JOURNAL_CORRUPT` when both generations fail,
  `PYPROC_REPLAY_MISMATCH` on engine mismatch).
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
behind `machine.runtime`. Consumers use capability contracts, never engine internals
(`HEAPU8`, `raw.FS`).

### `Runtime`

`run` / `runAsync` / `install` / `loadPackages` / `loadPackagesFromImports` /
`setStdout` / `setStderr` / `freeze` (lock the environment as a pyodide-lock JSON, feed
back via `boot({ lockFileURL })`) / `mountHome` (mount an OPFS directory at `/home/web`),
always-on `memory` (`MemoryCapability`) and `fs` (`FileSystem`), and capability factories
(`enableReactive`, `enableSyscallBridge`, `enableAsgiServer`, `enableTerminal`,
`enableWheelCache`, `enableDeviceFs`, `enableInit`, `enableJournal`). `new Runtime(py)`
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
`commit` / `pack` / `prune` / `recover`, counters). `cfg.onStatus` observes idle-commit
success/failure (`PYPROC_JOURNAL_IO`); `cfg.autoPack` packs past a loose-blob threshold;
`cfg.pruneAfterCommit` trims the checkpoint tree each commit.

### `MachineJail`

Permission jail (cooperative Python chokepoints installed with the runtime, plus a CSP
`connect-src` browser wall the consumer applies): `allows(perm, arg?)`, `connectSrc()`,
`csp()`, `install(rt)`. Honest boundary: the Python tier alone is bypassable via
`import js`; the browser wall requires a jailed context (CSP iframe), and full isolation
(opaque origin) costs SharedArrayBuffer capabilities.

## Process OS (`machine.proc`)

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

## Multi-tab machine (`open({ persistent })`)

### `KernelElection`

The handle returned by `open({ persistent })` (formerly `openPersistentMachine`), and the
underlying election/RPC contract: `join` / `run` / `commit` / `ready` / `status` /
`subscribe` / `role` / `leave`. Tabs elect one leader over Web Locks; only the leader
boots the kernel (deterministic session + journal); followers are RPC views over
BroadcastChannel. When the leader tab dies, the lock releases, a follower promotes and
resumes from the journal. Errors: `PYPROC_LEADER_UNAVAILABLE` (retryable),
`PYPROC_SPLIT_BRAIN`, `PYPROC_LEADER_LOCK_FAILED`, `PYPROC_PARTICIPANT_LEFT`,
`PYPROC_KERNEL_EXECUTION_ERROR`, `PYPROC_RPC_OUTCOME_UNKNOWN` (never auto-replayed).

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

### Retired subpaths

`pyproc/runtime`, `pyproc/reactive`, `pyproc/syscall-bridge`, and `pyproc/process-os` no
longer exist. Their capabilities did not disappear; they moved onto the handle:
`boot` returns the machine, `machine.history` carries the reactive verbs,
`machine.runtime.enableSyscallBridge()` carries the syscalls, and `machine.proc()`
carries the process pool. The migration table lives in the
[CHANGELOG](../../CHANGELOG.md).

## Errors

All 29 codes of `PYPROC_ERROR_CODES`, grouped by lane:

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
| `PYPROC_JOURNAL_IO` | Journal storage IO failure (observable via `onStatus`) |
| `PYPROC_STATE_CORRUPT` | State kernel object or generation failed verify-on-read (PREV fallback axis) |
| `PYPROC_STATE_FENCE_STALE` | Ref update fenced: a superseded owner epoch tried to write (HEAD untouched) |
| `PYPROC_RPC_OUTCOME_UNKNOWN` | Request sent, outcome unknown (leader change or timeout); never retryable, never auto-replayed |
| `PYPROC_LEADER_UNAVAILABLE` | No leader is serving (retryable) |
| `PYPROC_SPLIT_BRAIN` | Two leaders detected for one machine name |
| `PYPROC_LEADER_LOCK_FAILED` | Web Locks acquisition failed |
| `PYPROC_RPC_ACTION_INVALID` | Unknown RPC action reached the leader |
| `PYPROC_PARTICIPANT_LEFT` | The participant left the election mid-request |
| `PYPROC_KERNEL_EXECUTION_ERROR` | Leader-side kernel execution failed |
| `PYPROC_GPU_UNAVAILABLE` | No WebGPU adapter (`pyproc/gpu`) |
| `PYPROC_INTERNAL` | Invariant violation inside pyproc (a bug; please report) |
