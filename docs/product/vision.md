# pyproc product direction - what, for whom, and why

The canonical statement of pyproc's overall direction and product policy. Persistent decisions live in docs, current implementation and evidence live in `src/` and `tests/`, and completed decision history remains in git.

## What the North Star commits to

The one-line statement and the current score of every axis live in the [root README](../../README.md#north-star). This section says what that statement commits to.

**Make the browser into a computer.** Precisely: take Chromium as the hardware and security boundary, and bind virtual CPU, memory, disk, display, network, devices, permissions, boot, and recovery into one Web Machine contract so that different guest OSes can run on it.

The goal is not to draw a Windows- or macOS-shaped UI in the browser. It is to build a thin host contract an operating system can believe there is a computer beneath, and to make the pyproc Python OS and a separate Linux guest consume the same boot, device, snapshot, and restore lifecycle.

## North Star axes

An axis is a facility the computer has to provide: execution, rewindable state, processes, a durable disk, survival past its tab, a portable image, guests, engine independence, network, package reach, a consumable surface, and a verifiable supply chain. Each carries a score out of 10, where it stands today, and where it has to land. The rules that keep those scores honest:

- **The ledger is executable, and the document is its projection.** [`tests/northStar.mjs`](../../tests/northStar.mjs) holds every axis together with the artifacts standing behind it. The README table is rendered from that file and compared to it by the structure gate, so a score cannot be raised by editing prose. Moving a score means editing the ledger, and that diff is the review.
- **Only gates that run in CI count.** A capability with no automated gate scores nothing, however complete the implementation. Every registered artifact must exist, must be opened by some runner, and its lane must appear in the CI workflow. Registering a local-only lane as CI evidence fails the gate.
- **Manual evidence caps an axis below 9.** Where a headless gate is impossible (no WebGPU adapter, a relay this package does not ship, x86 assets that cannot be committed), the probe is registered as manual with its reason. A near-complete claim may not rest on evidence that lives in someone's memory.
- **Every axis needs at least one browser gate.** Real validation of a WASM runtime happens only in a browser, so an axis proven by Node structure checks alone is not proven.
- **A 10 is finished, not shipped.** It means the axis is repeatedly verified in a real browser with nothing left for a consumer to work around. Everything below 10 states the gap in the same row.

New work names the axis it moves. Work that moves no axis, weakens a guardrail in [contract reality](../operations/contractReality.md), or trades an axis for a number on a benchmark is not a priority here.

## Where pyproc sits today

pyproc is the first Python guest OS of the Web Machine platform. The public npm package stays a reusable kernel that provides Python execution, processes, files, permissions, network virtualization, and restore-based reactivity in the browser with no server. The `src/machine/` layer and the `apps/webComputer/` product assemble pyproc and Linux under the same lifecycle, device, and signed-image contracts. dartlab and xlpod consume the exact 0.0.10 root machine surface; codaro consumes an older immutable root contract and still needs migration away from two package-internal audit/build reads. The Web Computer product consumes the higher platform from a separate composition root.

Even as the higher goal grows, present-tense claims do not widen with it. The general host, shared `.webmachine` image, and Linux dual-boot are represented by the shipped `src/machine/` contract and the browser evidence registered in [`tests/northStar.mjs`](../../tests/northStar.mjs). The host ships through the single `createWebComputer` entry point and the `pyproc/machine` subpath. The reproducible Buildroot Linux guest also ships, separately from npm, as the hash-pinned `buildroot-pyproc-i686-v2` project release with exact source, complete legal material, SBOM, configuration, and independent-build receipt. The x86 emulator and remaining firmware are external consumer-supplied assets; pyproc does not redistribute them or claim their provenance as its own.

## The founding design principle

Do not unify the syscalls and internal state of every OS. What the Web Machine makes common is only boot, pause, resume, shutdown, virtual devices, resource permissions, the snapshot envelope, and failure recovery. Engine-specific state stays an opaque payload that an adapter translates. If adding a new guest grows an OS-name branch in the host core, the design has failed.

## The problem

The pieces for running real Python in a browser already exist: Pyodide, JSPI, File System Access, SharedArrayBuffer. What does not exist is the layer that binds them into something behaving like a real local runtime - so every product writes that layer again. The result:

- codaro, dartlab, and xlpod all need the same browser Python runtime, and copy-pasting it gives three divergent copies. Fixing a bug in one leaves the others broken.
- Pyodide is one single interpreter. The physical properties of a runtime - parallelism, processes, state restore - are not provided, so they get reinvented every time.
- Each product fills the browser's missing capabilities (sockets, subprocess, blocking input) its own way, so none of it is reusable.

pyproc builds that layer **once, properly, and shares it under a version pin**. Improvements collect in one place, and because products actually import it, it becomes an SSOT automatically. Being open source, it is open to external users under the same contract.

## What it is and what it is not

**pyproc is:**
- A framework-agnostic ESM library. No build step (native `.js` plus a hand-maintained `.d.ts`).
- OS kernel primitives at the browser tier: runtime boot, restore-based reactivity, the process OS, the file world, the permission jail, network virtualization, capability contracts.
- A clean consumption surface that encapsulates the cross-cutting concerns - WASM heap access, stack pointers, monkeypatching - behind capability contracts.

**pyproc is not:**
- A general-purpose Linux clone. Native binaries, inbound ports, and direct local driver access are things the browser blocks, and it does not build them without an external piece.
- A general x86 emulator engine or a bundled Linux distribution. The host contract ships over npm and the project publishes its reproducible Buildroot guest separately; the emulator and remaining firmware are injected by the consumer, with their compliance and provenance kept as a separate boundary.
- Product UI or domain logic (curriculum, automation, sheet editing). Consuming products layer that on top.
- Placement policy (deciding which tier a workload runs on). That differs per product, so the product owns it.
- A local engine or a GitHub Actions engine. pyproc provides browser-tier primitives only.
- Firefox/Safari support. Out of scope (see "Support boundary" below).

### What it deliberately will not build (rejected after review, with the reasoning preserved)

Tempting things that are wrong for us. Each was rejected after review. This list is the persistent decision record; the implementations and negative probes named below are the executable evidence, and git history preserves the review that produced it.

1. **Promoting a SharedWorker to be the kernel.** `COI=false` is a platform wall, and a kernel inside it loses SAB, interrupts, fork, and shm entirely. Instead, Web Locks plus BroadcastChannel election (`KernelElection`) keeps SAB while surviving a tab death.
2. **Preemptive time slicing in the main kernel** (a settrace bytecode budget). The settrace slowdown is large. The unit of preemption is a process (a worker), and the main kernel is for interaction only.
3. **A user or account system.** The browser profile is already the user. What is needed is not identity but per-machine capability (the permission jail).
4. **Promising zero-copy numpy over a SAB.** Impossible against the single-linear-memory wall. "One memcpy" stays the public contract.
5. **VT100/xterm.js emulation plus a shell pipe mini-language (`|`, `>`).** That re-imports the constraints of 1978 and stacks a second syntax on top of Python. The shell language is Python itself, and the essence of a pipe - lazy composition - is already in generators.
6. **Split panes and a window manager.** Product UI belongs to the consuming product. The answer to "one machine on several screens" is `KernelElection`.
7. **Maintaining a custom Pyodide build (pthread/nogil) permanently.** A custom engine build is conditional insurance, taken only when upstream threading or engine compatibility requires it. The current engine pin and re-verification triggers are in [contract reality](../operations/contractReality.md).
8. **A WebRTC distributed machine.** Depending on a signaling server violates zero-dep. Moving between devices is the job of the `.pymachine` file.

## Success and failure criteria

- **Present-product success**: consuming products actually import pyproc and layer their own surfaces on it, and improvements to the browser Python OS collect in pyproc alone. Consumers use restore-based reactivity, process parallelism, the file world, permissions, and virtual origins through capability contracts without touching engine internals.
- **Higher-platform success**: the same Web Machine host boots pyproc and a Linux guest under common lifecycle, device, and image contracts, and both machines recover after a tab failure and a cold reopen.
- **Failure**: products copy-paste the runtime and diverge; pyproc absorbs product UI and x86-specific logic; or the host core grows per-OS branches every time a guest is added.

## The four states of a Python guest capability (the goal is unbounded; present-tense claims go only as far as the proof)

Under the higher Web Machine North Star, the compatibility direction for the pyproc guest is "everything that works in local Python, in the browser". Each capability sits in one of the four states below, and pyproc's job is to push capabilities up a row and to be the structure that absorbs a wall the moment upstream opens it. "Impossible" is a verdict about current conditions, not surrender. The canonical coordinates are the executable axis ledger in [`tests/northStar.mjs`](../../tests/northStar.mjs), the capability matrix, and the browser gates they register.

1. **Achieved today (measured in a browser today)**: pure Python plus **native C-extension packages** (numpy, pandas, scipy, scikit-learn, matplotlib and more - the Pyodide distribution's 158 pyemscripten (PEP 783) wheels load through dlopen and already work); multi-core processes, snapshot-fork, and map; checkpoint and time travel; session persistence and revival; the terminal; the in-kernel ASGI server; a persistent FS (OPFS); input, HTTP, and subprocess; the process OS broadly (pipes, shm, locks, job control, kernel election, machine containers, the permission jail, fsWorld); and booting non-Pyodide WASI CPython 3.14.6 with pure-Python wheel installation. **Pyodide does dlopen dynamic C-extension `.so` files** - "no dynamic C extensions" was only ever true of the WASI lane.
2. **Available through a workaround (virtualized the browser way, measured)**: outbound sockets (`SocketBridge`), servers (`AsgiServer`/`VirtualOrigin`), processes (worker kernels). **GPU numerical acceleration** (WebGPU compute, reached from a worker and driven synchronously through JSPI; the precursor WgPy demonstrated matmul acceleration on Pyodide). It works today in the narrow class of large f32 linear algebra - not transparent numpy acceleration but a separate array API. Building numpy as a WASI static fat binary is also a settled path, but it brings **no speed gain and is in fact slower** (reference BLAS, no SIMD, and a JSON-only WASI value bridge), so it is a coverage experiment rather than a speed path.
3. **Waiting on upstream (blocked now, reopened by platform progress)**: **installing an arbitrary C extension on demand** (Pyodide's dlopen works, but that package's pyemscripten wheel has to be published - PEP 783 ecosystem adoption is around 28 packages, in ABI lockstep, and most of the long tail is unpublished); WASI dynamic linking (cpython#142234); a **SIMD numpy build** (Pyodide does not build with SIMD yet, so the gain is pending); and real threading with nogil (WASM threads plus shared memory, PR #6285 draft).
4. **A permanent wall for web security reasons (impossible without an external piece)**: inbound servers, executing arbitrary native binaries, direct local drivers (CUDA), and desktop automation. That share is carried by the consuming product's local or Actions tier.

Corrections (honest, from the 2026-07-13 research synthesis): (1) **availability** of native numerical packages is already solved (numpy and others load through dlopen from 158 wheels). (2) "No dynamic C extensions" was WASI-only; Pyodide does dlopen. (3) The wall that actually remains is **speed** in large numpy arithmetic. The active paths are horizontal sharding through `machine.proc()` and the opt-in GPU-resident lane described by the [capability matrix](../consuming/capabilityMatrix.md); arbitrary package coverage still depends on pyemscripten wheel ecosystem adoption. (4) GPU is corrected to state 2 (it works as a library today; the previous edition's state 3 was stale).

## Where the ceiling moves next

The four states above are verdicts about today. This section fixes the direction for moving them (from the 2026-07-31 ceiling review), so a later session can pick up the frontier without re-deriving it. The remaining distance is two walls with different fates, and the work orders itself around that difference. Every rung below is registered in the [axis ledger](../../tests/northStar.mjs) against the axis it moves, so a rung cannot drift away from the score it claims to move, and the structure gate holds that list and this one to the same count.

**The transport wall opens.** A tab cannot accept an inbound connection today, but every piece of that limitation is in motion. The rungs are ordered by leverage, and the fifth is filed here because it is the same class of upstream adoption, not because it carries packets:

1. **TLS terminated inside the tab.** The socket relay currently terminates TLS and sees plaintext, so it has to be trusted. In-tab TLS (already recorded as the socket lane's v2) turns any relay into untrusted infrastructure: the requirement drops from "a relay you trust" to "any relay at all". It comes first because every later rung inherits its trust model.
2. **Relay multiplexing** (Wisp class): one WebSocket carrying many sockets. Already on the ledger as relay hardening.
3. **Browser-to-browser transport** (WebRTC DataChannel): a direct peer link between tabs on different machines, NAT traversal included. The rejected-ideas list turns down a WebRTC distributed machine, and that rejection stands; a transport subpath is a different object, and the `pyproc/socket` precedent (an opt-in subpath may depend on an external piece it does not ship) already covers it. First pairing can exchange the offer manually (a QR code), which shrinks the signaling dependency to reconnects. Subject to the Experimental surface freeze: no new subpath until the freeze condition clears.
4. **An Isolated Web App lane.** The platform already ships a true inbound listen (Direct Sockets `TCPServerSocket`) for installed IWAs, today gated to managed distribution. The move is to keep a packaging lane ready, so the day the gate opens to consumer desktops the Web Computer walks through it first.
5. **memory64 adoption**: engines have shipped it, and adopting it lifts the per-module heap ceiling that a large guest hits first. It moves the guest axis, not the network one, which is why the ledger files it under the computer that boots guests.

**The native wall does not open.** No web standard proposes letting web content spawn a native process, and none will; that would contradict the browser's definitional security boundary. The platform's actual trajectory points the other way: compile the world into the sandbox. So "run what only local machines run" is never answered by a bridge outward. It is answered by moving the work inward:

6. **A wasm tool layer**: the tools a working machine assumes (git and ripgrep class) as wasm builds inside the machine.
7. **A Node guest** (long horizon): Node.js as a third guest beside Python and Linux. Node in a browser has been demonstrated elsewhere; a Node guest would make JavaScript CLI tools browser residents, on the same multi-guest contract as everything else.
8. **The local-agent contract**: the share the four states assign to a consuming product's local tier stays outside by design. What pyproc can still own is the contract: specify that boundary once (pairing, authorization, capability list), so any local agent can implement it and consumers stop reinventing it.

Two external triggers reorder these priorities when they fire: Direct Sockets reaching consumer desktop distribution, and an open Node-in-browser implementation maturing enough to vendor. Until then the ladder above is the order.

## Support boundary (Chromium/Edge only)

JSPI (JavaScript Promise Integration), SharedArrayBuffer, and `crossOriginIsolated` are required. No Firefox or Safari support is a scope choice, not a defect. SharedArrayBuffer needs the page to be in a crossOriginIsolated state through these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Related documents

- The executable North Star and its registered evidence: [`tests/northStar.mjs`](../../tests/northStar.mjs)
- The shipped Web Machine implementation and browser probes: [`src/machine/`](../../src/machine/) and [`tests/webMachine/`](../../tests/webMachine/)
- The consumption contract (install, public surface, version consistency): [docs/consuming/contract.md](../consuming/contract.md)
- The operating model (lifecycle, development principles): [docs/operations/operatingModel.md](../operations/operatingModel.md)
- Current gaps and re-verification triggers: [docs/operations/contractReality.md](../operations/contractReality.md); completed decision history: git history
