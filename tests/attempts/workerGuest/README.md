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
| `engineEntryCp0Probe.html` | Whether the engine entry file or the host context decides cp0 | measured: the context decides |
| `revivedSurfaceProbe.html` | Ten bisected cases isolating what makes a revived kernel trap on a JS proxy | root cause found |
| `workerHostedProbe.html` | The same assertions with each guest's kernel in its own worker, plus the bridged device, the portable image, and the in-process controls that tell a worker limitation apart from a shipped defect | 14/17, and all three failures are one defect that is not worker-specific |

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

### Second candidate result (2026-07-31): devices and images crossed, and a shipped defect surfaced

Both defects below were fixed in `src` with their own gates, which unblocked the two graduation items
the first candidate had honestly withheld. The adapter now hosts a deterministic-replay session (not
a bare runtime), bridges its packet device to the switch that cannot leave the host thread, and
declares `snapshotScope: "portable"` because it now delivers one.

```
GRADUATION 2  idle 9ms   blocked 1ms   loop 1596ms          (baseline: idle 1ms, blocked 917ms)
GRADUATION 3  frame round-trip 7ms, *while guest A is still inside its loop*
GRADUATION 4  portable image 10,184,007 bytes, snapshot 103ms, cold revive in a fresh worker 2548ms
GRADUATION 5  per-request hop ~9ms, worker boot 2840ms for two guests
```

Graduation 3 is the reading the campaign was opened for. The baseline recorded frames seen mid-turn
**0**; here a frame leaves Python, crosses the bridge, is answered by a peer on the switch, and comes
back into Python **7ms** later while the other guest is still burning its 1596ms loop. The assertion
is not a timing story: the probe holds a `busySettled` flag and requires it to still be false.

Graduation 3 also names one contract that **changed shape** in the crossing, recorded rather than
hidden (`portBridgedDevice.js` carries the same note): the switch throws synchronously from
`connect()` on a duplicate endpoint, and across a message boundary that answer cannot be back before
`connect()` returns. The bridge preserves the error *code* and carries it to the first `send()`. A
consumer that relies on the synchronous throw has to move that expectation one call later.

### The blocker, root-caused (2026-07-31): a heap image cannot carry JS proxy handles

`revivedSurfaceProbe.html` bisects it in ten cases, each one step from its neighbour. The pattern is
not about devices, workers, or portability at all:

| Case | Seed created a JS proxy | Revived kernel | Result |
|---|---|---|---|
| A | no | installs a surface, calls it | **works** |
| J | no | installs twice, calls both | **works** |
| F | yes, then removed | plain Python only | **works** |
| G | yes, then removed | re-installs, plain Python only | **works** |
| B | yes, then removed | re-installs, calls it | traps |
| C | yes, kept | re-installs, calls it | traps |
| D | yes, never called, removed | re-installs, calls it | traps |
| I | yes, kept | does not re-install, calls the image's own surface | traps |
| E | a bare `setGlobal` function | sets it again, calls a pre-image wrapper | traps |
| H | same as E, wrapper recompiled after the restore | same | traps |

Read together: **if the exporting kernel created any JS proxy after cp0, every proxy path in a kernel
revived from that image traps** (`table index is out of bounds`). Removing the surface before the
export does not help (B, D), keeping it does not help (C, I), recompiling the caller does not help
(H), and re-installing does not help (B). A kernel whose seed created no proxy is completely fine
(A, J), and plain Python is unaffected either way (F, G). The trap fires at the moment the image's
proxy handle is overwritten, which is why the failure often surfaced far from its cause.

The reading: a JS proxy's handle is interpreter-local bookkeeping that lives partly in the WASM heap
and partly on the JS side. An image carries the heap half. A fresh interpreter has a fresh JS half,
so the two halves disagree the moment either is touched. Nothing at the Python level can repair that,
which is exactly why `removePythonSurface` - a Python-level fix for a JS-level problem - never could.

Three more cases (2026-08-01) settled both the cost of the repair and its shape:

| Case | Setup | Result |
|---|---|---|
| M | image holds a proxy; the revived kernel never touches it and uses a **different** name | traps (`hiwire_get is falsy`) |
| N | the revived kernel deletes the image's proxy name (so it is destroyed) | traps (`table index is out of bounds`) |
| O | **no proxy anywhere**: a pure-Python surface, bytes crossing as `run()` arguments and return values | **works** |

M is the one that decides the price. A fresh proxy under a fresh name still fails, so there is no
cheap discipline like "never touch what the image brought": the image carries Pyodide's own handle
allocator state, so every handle the revived kernel mints lands outside its own table. The proxy
machinery as a whole is poisoned, not just the objects that travelled.

O is the way out, and it is measured rather than argued: the seed's queued frame survived the round
trip, a frame ingested after the restore was read back, and the outbox drained - all with zero
handles on either side. **A device surface has to be a value boundary, not a proxy boundary.** Python
keeps plain lists; bytes cross as `run()` arguments and return values; JS drives ingest and drain at
turn boundaries. That is also the shape the worker-hosted guest needs anyway, because its device
bridge already crosses `postMessage` at turn boundaries.

**One fix was tried and rejected by measurement (2026-07-31).** The most attractive reading of the
map said: establish the surface inside the deterministic boot window, before cp0, so both kernels
agree on the bookkeeping. A temporary `installers` hook in `bootSession` tested it. The boot half
worked exactly as predicted - both kernels reached the same cp0 with the surface installed, the h0
comparison passed, and a kernel that forgot the installers was refused with PYPROC_REPLAY_MISMATCH
rather than opened onto mismatched state. But the proxy call still trapped once the image was
applied. So agreeing bookkeeping is not sufficient: what the image carries is the heap representation
of the proxy objects, and that disagrees with the reviving interpreter JS half all over again. The
hook did not deliver what it was added for, so it was reverted rather than left as surface.

The direction still follows from pyproc's own determinism law rather than from more cleanup: **a proxy-backed
surface has to be established inside the deterministic boot window, before cp0.** Two kernels booted
from the same manifest reach byte-identical cp0, so their proxy bookkeeping agrees by construction,
and an image taken after that boundary stays meaningful. That is a change to the boot contract
(`bootSession` has `setup` for Python source but no hook for a JS-side install), so it belongs in a
plan rather than in this campaign. Until then the limit is pinned by a browser gate and written into
[contract reality](../../../docs/operations/contractReality.md).

### How it looked before it was root-caused

A guest that has a packet device cannot use that device after restoring its own portable image. The
first call into the surface traps with `table index is out of bounds` or `Argument to hiwire_get is
falsy`, which kills the interpreter. It reproduces **on the main thread with the shipped
`createPyprocGuestFactory`**, both for a guest that used the surface before the image and for one
that never touched it. So it is a defect in `src`, not a limit of worker hosting, and the campaign
found it only because the candidate needed the same path.

Four explanations were tested below the machine layer and all four are dead: across a materialized
image, a session carries a plain global, a callable JS function, `pyodide.ffi`, and a `to_py()`
conversion without a scratch (`MINIMAL` checks in the probe). The session layer is healthy, so the
cause sits above it, in what the machine layer does around `removePythonSurface` /
`installPythonSurface`. Root-causing that is the next step, and it belongs in `src` with a gate,
because `snapshotScope: "portable"` is a claim the shipped in-process adapter makes today.

One neighbouring defect on the same path is already understood and fixed in the working tree:
`PyprocGuestAdapter._attachPacketPort` re-attached without detaching, so a warm restore of a
networked guest died with `WEB_MACHINE_NETWORK_ENDPOINT_DUPLICATE` before it could reach the trap
above. No gate covered a networked guest's restore at all; that fix ships with the root-cause fix and
its gate rather than alone, because half of this path being fixed still leaves the path broken.

### Two defects the campaign found in `src` (both fixed, each with its own gate)

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
lives with its own gate. Both landed that way. (1) is the `bootSession` passthrough with a Node gate
that observes the caller's loader through a sentinel plus three browser-gate checks for a
worker-hosted deterministic session. (2) is the `pyproc/runtime` assembly point, fixed so the subpath
yields a complete `Runtime`; this worker no longer needs to reach past it.

## 졸업 게이트

Status after the second candidate run (2026-07-31): **1, 2, 3, 5 hold; 4 holds for the image and is
blocked for the device by the shipped defect above.** The campaign stays open until that defect is
root-caused, because closing it now would move a candidate into `src` while the path it depends on is
known to be broken there.

Move to `src/` only when all of these hold, measured in a real browser:

1. **The host core is unchanged.** `WebMachineHost`, `MachineHandle`, and `commandQueue` take zero new branches for a worker-hosted guest. If the host has to learn the difference, the adapter contract was not the right seam and this campaign failed.
2. **Head-of-line blocking is gone, with the same assertion as the baseline.** While one guest runs a CPU-bound loop, the other guest's `request` stays bounded and a frame round-trips *during* that loop - the thing that cannot happen today.
3. **The device contracts survive the crossing.** Packet, block, display, and input ports keep their current contracts through the bridge, proven by the existing device probes passing against a worker-hosted guest.
4. **Snapshot portability is preserved.** A worker-hosted guest still produces an image that revives in a fresh process, so `snapshotScope: "portable"` stays true (the live-JS-proxy conflict that the packet port hit is the warning here).
5. **The cost is stated.** Worker hosting adds a message hop to every request. The probe records that hop's cost, and if it is large enough to matter for interactive use, that is written down rather than hidden.

Closing the campaign deletes this folder; the record lives in the ledger and in git history.
