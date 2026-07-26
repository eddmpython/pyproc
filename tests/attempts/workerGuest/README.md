# workerGuest - guests that do not share one JS thread

One campaign, one question.

## Question

**Can a guest be hosted in a worker behind the existing 8-method adapter contract, without the host core learning anything new?**

Today `src/machine/` creates no worker: `grep "new Worker" src/machine/` returns zero. Both guest OSes and the host all run on the main JS thread. Three consequences, and the third is the one that matters:

1. A CPU-bound loop in one guest stalls the other guest and the host.
2. `pause` cannot preempt: it drains a queue, it does not stop execution.
3. **The switch's `queueMicrotask` pump cannot run while Python is on the stack**, so `pyprocNet.recv()` only ever sees frames that arrived *between* `run()` calls. That is why `guestNetworkProbe` needs a `settle()` loop, and it is why the frame contract's own invitation - "TCP, UDP, and DNS are the guest's own business" - is not reachable: no handshake can wait for a reply inside one turn.

So the packet port shipped a real byte path and simultaneously exposed a ceiling. The frame law is correct; the execution model underneath it is not yet able to carry a protocol.

## Hypothesis

The adapter contract (`boot`/`pause`/`resume`/`snapshot`/`restore`/`shutdown`/`request`/`inspect`) is already an async, message-shaped interface. If that is true, an adapter-side proxy can satisfy it over a `MessagePort` while the real guest lives in a worker, and `WebMachineHost` needs no change at all. The device ports (packet, block, display, input) are the hard part: they are called synchronously today, so they need a bridge that preserves their contracts across the boundary.

If the hypothesis is false, the failure will be specific and worth recording: it will name which contract cannot cross a worker boundary without changing its shape.

## Probes

| Probe | What it measures | Status |
|---|---|---|
| `headOfLineProbe.html` | The current cost, on the main thread: while guest A runs a CPU-bound loop, how long guest B's `request` takes and whether a frame can round-trip at all | baseline measured |
| `workerHostedProbe.html` | The same assertions with each guest's kernel in its own worker, driven through the ordinary host surface | candidate GREEN 6/6 |

The baseline exists first on purpose. "A worker fixes it" is not a measurement; "the same assertion fails now and passes then" is. The probe is therefore RED by design and stays in this campaign - it is not a gate.

### Measured baseline (2026-07-27, Edge headless, COOP+COEP)

```
idleRequestMs 1, blockedRequestMs 917, busyLoopMs 917
frames seen mid-turn 0, frames seen after the turn 1
```

Three readings, and the middle one is the finding:

1. Guest B's request costs **1ms** when nothing else runs.
2. The same request costs **917ms** while guest A loops - and A's loop is **917ms**. B does not merely
   slow down, it waits out the *entire* loop. Blocking is total, not partial.
3. Frames sent by A land in B's Python **0 times during A's turn** and **1 time after it**. So the
   frame path is correct and the thread is the ceiling. That separation is why this campaign is about
   the execution model and not about the wire.

Reading (2) also says what "bounded" has to mean at graduation: B's request must stay near its idle
cost while A loops, not merely finish sooner than A does.


### Candidate result (2026-07-27, same browser and iteration count)

```
baseline   idle  1ms   blocked 917ms   loop  917ms
candidate  idle 14ms   blocked   1ms   loop 1053ms
workerBootMs 3542, messageHopMs 14
```

The assertion flipped. On one thread guest B waited out A's entire loop (917 of 917ms); with each
kernel in its own worker B answered in **1ms** while A's loop ran **1053ms**. That is not a partial
improvement, it is the blocking gone.

Two costs are real and recorded rather than hidden (graduation item 5):

- **The per-request hop is ~14ms**, against ~1ms in-process. Every request now crosses postMessage.
  For interactive use that is the number a consumer has to know.
- **Booting two worker-hosted guests took 3542ms**, because each worker imports and boots its own
  engine. Snapshot-fork is what would collapse that, and it is not wired here.

Graduation item 1 held: the probe registers the adapter through the ordinary `registerAdapter` and
drives it through `createMachine`/`boot`/`request`. `WebMachineHost`, `MachineHandle`, and
`commandQueue` took no new branch, so the adapter contract was the right seam.

### Two defects the campaign found in `src` (both belong in the graduation commit)

1. **`bootSession` does not forward `loadPyodide`.** A worker has no `document`, so the engine script
   cannot be injected as a tag; `bootRuntime` already accepts a `loadPyodide` the worker supplies
   after importing pyodide.mjs itself, but `bootSession` never passes that option through from its
   manifest. So the deterministic-replay boot - and therefore history, save, and export - cannot be
   worker-hosted at all today. One forwarded option fixes it.
2. **`pyproc/runtime` yields a `Runtime` with no capability factories.** `rt.enableReactive is not a
   function`, reproduced live by this campaign's first candidate run. The bindings are installed at
   import time by `src/composition/runtimeApi.js`, whose own header states that both `index.js` and
   `pyproc/runtime` consume it - but `package.json` points `./runtime` at the rank-0 barrel
   `src/runtime/index.js` instead. The wiring contradicts the stated intent, and the documented
   adoption pattern (`new Runtime(py)` then `rt.enableAsgiServer(...)`, which contract.md shows and
   README names as dartlab's live pattern) therefore fails from that subpath alone. The subpath is
   still unreleased, so this is fixable before it ships.

Neither is smuggled in from a probe: a campaign finds defects, and the fix lands where the contract
lives with its own gate.

## 졸업 게이트

Move to `src/` only when all of these hold, measured in a real browser:

1. **The host core is unchanged.** `WebMachineHost`, `MachineHandle`, and `commandQueue` take zero new branches for a worker-hosted guest. If the host has to learn the difference, the adapter contract was not the right seam and this campaign failed.
2. **Head-of-line blocking is gone, with the same assertion as the baseline.** While one guest runs a CPU-bound loop, the other guest's `request` stays bounded and a frame round-trips *during* that loop - the thing that cannot happen today.
3. **The device contracts survive the crossing.** Packet, block, display, and input ports keep their current contracts through the bridge, proven by the existing device probes passing against a worker-hosted guest.
4. **Snapshot portability is preserved.** A worker-hosted guest still produces an image that revives in a fresh process, so `snapshotScope: "portable"` stays true (the live-JS-proxy conflict that the packet port hit is the warning here).
5. **The cost is stated.** Worker hosting adds a message hop to every request. The probe records that hop's cost, and if it is large enough to matter for interactive use, that is written down rather than hidden.

Closing the campaign deletes this folder; the record lives in the ledger and in git history.
