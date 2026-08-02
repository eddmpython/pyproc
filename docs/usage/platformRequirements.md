# Platform requirements and preflight

This table states the technical conditions each pyproc capability needs. It is neither backward-support policy nor a value score. The runtime verdict comes from `checkEnvironment()`; per-capability value, contract state, and boundaries are canonical in [capabilityMatrix.md](capabilityMatrix.md).

## Supported browsers

**Chromium / Edge only.** No Firefox or Safari support is a scope choice, not a defect: some capabilities require JSPI, SharedArrayBuffer, and `crossOriginIsolated` all three, and that combination holds only on Chromium-family browsers.

| Item | Requirement | Without it |
|---|---|---|
| Base execution (`boot`/`run`/`loadPackages`/`checkEnvironment`/reactive) | A Chromium-family browser. No headers needed | Unsupported on Firefox/Safari |
| JSPI (`WebAssembly.Suspending`) | Chrome/Edge 137+ (enabled by default from 137) | Terminal blocking input, subprocess, the syscall bridge, and the synchronous ASGI path do not come up (`checkEnvironment().jspi === false`, code `no-jspi`) |
| SharedArrayBuffer + `crossOriginIsolated` | `COOP: same-origin` and `COEP: require-corp` headers on the page | The process OS (`machine.proc`), fork/map, sockets, and interrupts do not come up (`checkEnvironment().sharedArrayBuffer === false`, code `no-cross-origin-isolation`) |
| Same-origin worker assets | Keep the worker graph on your own origin and verify it with SRI (`pyproc/assets`) | Opening a worker from CDN URLs alone is blocked by the browser's same-origin policy |

`checkEnvironment()` returns `{ ok, crossOriginIsolated, sharedArrayBuffer, jspi, issues }`. Each entry in `issues[]` is `{ code, need, why, fix }`. Handle this result before turning a capability on.

## Prerequisites by capability group

| Capability group | Chromium | JSPI | COOP/COEP (SAB) | Note |
|---|:---:|:---:|:---:|---|
| Python execution, packages, file IO, checkpoint/restore/time travel | required | - | - | Needs the exact package plus `pyproc-engine` prepared at the same-origin engine path; no headers |
| Terminal, borrowed syscalls, subprocess, in-kernel ASGI server | required | required | - | The synchronous blocking paths depend on JSPI |
| Process OS (fork/forkMany/map/mapArray/matmul), sockets, interrupts, multi-tab persistence using SAB capabilities | required | required | required | Only under `crossOriginIsolated` |

## Engine

- **Pyodide v314.0.2 (CPython 3.14).** Loaded from the verified same-origin `/vendor/pyodide/` distribution by default. `indexURL` is an explicit distribution override. Changing the version requires the full runtime-consistency gate (detail: the runtime-consistency section of [contract.md](contract.md)).
- The WASI engine (`pyproc/wasi`) is a separate async surface for proving engine independence. Pyodide is the production canon.

## Resource characteristics (for sizing your heap)

- **A checkpoint boundary costs O(heap).** WASM has no mprotect and no dirty-page tracking, so at every execution boundary the full heap is hashed page by page to reconstruct the delta - and that completeness is the condition for restore soundness. So one boundary's hashing cost is proportional to heap size. What dominates this cost is not heap size itself but **commit frequency** (the churnProbe law): commit per statement and you walk the whole heap every time.
- **Peak memory is the resident base plus accumulated deltas.** Restore-based reactivity keeps a base - a full copy of the heap - resident in RAM, and checkpoint deltas accumulate on top. The relief valves are `history.prune` (`pruneTo`) and `dispose`; `saveBase` offloads the base to OPFS but does not reduce RAM, because the restore path assumes the base stays resident.
- **In the process OS each worker is an independent interpreter with an independent heap.** N workers means N independent Python heaps consuming real memory - and in exchange, N independent GILs, which is physical parallelism. Snapshot-fork shares the initial state through a SAB to avoid a full copy per worker, but once workers diverge each owns its own state.
- Measurements for large heaps (hundreds of MB and up) and for low-end or mobile devices are not posted on public surfaces. Measure them on your own machine with the [Speed Lab](../../examples/speedLab.html). Development measurements live in [benchmarking.md](../operations/benchmarking.md), the ledgers, and the artifacts.

### Easing reactive memory pressure (by workload)

This guide assumes the current operating constraints. The core of a memory spike is not the cost of `checkpoint()` so much as **commit frequency**. A checkpoint hashes the whole heap (O(heap)), so aiming for one per statement spikes both committing and execution.

#### 1) Shared rules

1. Call `history.commit()` on meaningful intervals rather than per statement (or tune `cfg.idleMs` on the idle watcher).
2. Managing rollback candidates with `history.prune()` is the first valve. Called with no argument it clears nodes off the live path.
3. Control OPFS object spam with `MachineJournal`'s `pack()` or `cfg.autoPack`. Packing does not reduce RAM immediately, but it reduces the object count.
4. The reactive controller's `saveBase()` moves the base-heap copy to OPFS for restore continuity and portability. It is not a RAM-relief device.
5. Use `dispose()` only as a last resort when you want a hard path cleanup - and check every caller sharing the same reactive controller.

#### 2) Interactive REPL and teaching demos

1. Perceived responsiveness matters here, so you need to keep plenty of rollback context. Observe the pressure first with `history.setRetentionPolicy({ maxNodes, onPressure })` and call `history.prune()` when it fires.
2. Start the journal on its defaults and leave `cfg.autoPack` and `cfg.pruneAfterCommit` off. If a session runs long, prune more often to keep the resident heap from running away.
3. Run `pack()` periodically, but only as cleanup around `save` and `export`.

#### 3) Long computations and batch workloads

1. The first knob is commit frequency. Widen the idle window (`cfg.idleMs`) or slow down your own `history.commit()` cadence to lower commits per unit time.
2. If frequent commits are unavoidable, set `cfg.pruneAfterCommit = true` to keep the checkpoint tree to the live path and avoid paying for rehashes.
3. Then turn on `cfg.autoPack` to control object growth. Start at `true` (128 loose blobs, 8MB) or `{ looseBlobs: 128, looseMB: 16 }`.
4. Run `pack()` as part of recovery drills and pre-deployment verification, and tune the thresholds by watching `looseRemoved` and `packsRemoved` in the result.

#### 4) Long-lived always-on sessions and replay pipelines

1. In long-lived operation, observe rollback candidates through the retention budget and clean the path with `history.prune()` and `history.watch({ pruneAfterCommit: true })`.
2. Use the reactive controller's `saveBase()` once, just before a deliberate hard transition or a hibernation, not on every loop.
3. If restarts bring frequent bulk restores or relocations, clear path contamination with `dispose()` and then re-establish the `restore` flow.

#### Suggested sample (for reference)

```js
machine.history.setRetentionPolicy({
  maxNodes: 256,
  maxDeltaBytes: 128 * 1024 * 1024,
  pruneBranches: true,
  onPressure: (event) => { /* UI warning and telemetry */ },
});

const journal = machine.history.watch({
  dir: opfsDir,
  idleMs: 5000,               // driven by idle intervals, not statements
  pruneAfterCommit: true,      // shrink the rollback path to the live path right after a commit
  autoPack: { looseBlobs: 128, looseMB: 16 },
  onStatus: (evt) => { /* commit and IO failure notifications */ },
});

console.log(machine.history.stats());
```

The operating order is fixed: control commit frequency, then `history.prune()` / `cfg.pruneAfterCommit`, then `autoPack` / `pack()`, then the reactive controller's `saveBase()`.

Related debts and tradeoffs are tracked continuously in [contractReality.md](../operations/contractReality.md).
