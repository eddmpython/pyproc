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


## 졸업 게이트

Move to `src/` only when all of these hold, measured in a real browser:

1. **The host core is unchanged.** `WebMachineHost`, `MachineHandle`, and `commandQueue` take zero new branches for a worker-hosted guest. If the host has to learn the difference, the adapter contract was not the right seam and this campaign failed.
2. **Head-of-line blocking is gone, with the same assertion as the baseline.** While one guest runs a CPU-bound loop, the other guest's `request` stays bounded and a frame round-trips *during* that loop - the thing that cannot happen today.
3. **The device contracts survive the crossing.** Packet, block, display, and input ports keep their current contracts through the bridge, proven by the existing device probes passing against a worker-hosted guest.
4. **Snapshot portability is preserved.** A worker-hosted guest still produces an image that revives in a fresh process, so `snapshotScope: "portable"` stays true (the live-JS-proxy conflict that the packet port hit is the warning here).
5. **The cost is stated.** Worker hosting adds a message hop to every request. The probe records that hop's cost, and if it is large enough to matter for interactive use, that is written down rather than hidden.

Closing the campaign deletes this folder; the record lives in the ledger and in git history.
