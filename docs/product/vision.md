# pyproc product direction - what, for whom, and why

The canonical statement of pyproc's overall direction and product policy. It lives in docs because it is a persistent document; development plans and progress belong to [mainPlan/](../../mainPlan/README.md) and move to `_done` when they finish.

## The higher North Star

**Make the browser into a computer.** Precisely: take Chromium as the hardware and security boundary, and bind virtual CPU, memory, disk, display, network, devices, permissions, boot, and recovery into one Web Machine contract so that different guest OSes can run on it.

The goal is not to draw a Windows- or macOS-shaped UI in the browser. It is to build a thin host contract an operating system can believe there is a computer beneath, and to make the pyproc Python OS and a separate Linux guest consume the same boot, device, snapshot, and restore lifecycle.

## Where pyproc sits today

pyproc is the first Python guest OS of the Web Machine platform. The public npm package stays a reusable kernel that provides Python execution, processes, files, permissions, network virtualization, and restore-based reactivity in the browser with no server. The `src/machine/` layer and the `apps/webComputer/` product assemble pyproc and Linux under the same lifecycle, device, and signed-image contracts. codaro, dartlab, and xlpod consume the pyproc public surface, while the Web Computer product consumes the higher platform from a separate composition root.

Even as the higher goal grows, present-tense claims do not widen with it. A general host, a shared `.webmachine` image, and Linux dual-boot were proven in [the completed web-machine-platform](../../mainPlan/_done/web-machine-platform/README.md); the host lives inside pyproc as the `src/machine/` layer and ships alongside it through the single `createWebComputer` entry point and the `pyproc/machine` subpath. What is not shipped is a redistributable Linux image and an x86 emulator engine.

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
- A general x86 emulator engine or a redistributable Linux image. The host contract ships over npm, but the guest engine and image are injected by the consumer (engine and image compliance is a separate boundary).
- Product UI or domain logic (curriculum, automation, sheet editing). Consuming products layer that on top.
- Placement policy (deciding which tier a workload runs on). That differs per product, so the product owns it.
- A local engine or a GitHub Actions engine. pyproc provides browser-tier primitives only.
- Firefox/Safari support. Out of scope (see "Support boundary" below).

### What it deliberately will not build (rejected after review, with the reasoning preserved)

Tempting things that are wrong for us. Each was rejected after review, and the reasoning is preserved (the detailed argument is in the anti-recommendation section of [mainPlan/_done/browser-os/01-os-primitives.md](../../mainPlan/_done/browser-os/01-os-primitives.md)).

1. **Promoting a SharedWorker to be the kernel.** `COI=false` is a platform wall, and a kernel inside it loses SAB, interrupts, fork, and shm entirely. Instead, Web Locks plus BroadcastChannel election (`KernelElection`) keeps SAB while surviving a tab death.
2. **Preemptive time slicing in the main kernel** (a settrace bytecode budget). The settrace slowdown is large. The unit of preemption is a process (a worker), and the main kernel is for interaction only.
3. **A user or account system.** The browser profile is already the user. What is needed is not identity but per-machine capability (the permission jail).
4. **Promising zero-copy numpy over a SAB.** Impossible against the single-linear-memory wall. "One memcpy" stays the public contract.
5. **VT100/xterm.js emulation plus a shell pipe mini-language (`|`, `>`).** That re-imports the constraints of 1978 and stacks a second syntax on top of Python. The shell language is Python itself, and the essence of a pipe - lazy composition - is already in generators.
6. **Split panes and a window manager.** Product UI belongs to the consuming product. The answer to "one machine on several screens" is `KernelElection`.
7. **Maintaining a custom Pyodide build (pthread/nogil) permanently.** A custom engine build is conditional insurance, taken only when its trigger fires: [mainPlan/_done/engine-independence/README.md](../../mainPlan/_done/engine-independence/README.md) P4.
8. **A WebRTC distributed machine.** Depending on a signaling server violates zero-dep. Moving between devices is the job of the `.pymachine` file.

## Success and failure criteria

- **Present-product success**: consuming products actually import pyproc and layer their own surfaces on it, and improvements to the browser Python OS collect in pyproc alone. Consumers use restore-based reactivity, process parallelism, the file world, permissions, and virtual origins through capability contracts without touching engine internals.
- **Higher-platform success**: the same Web Machine host boots pyproc and a Linux guest under common lifecycle, device, and image contracts, and both machines recover after a tab failure and a cold reopen.
- **Failure**: products copy-paste the runtime and diverge; pyproc absorbs product UI and x86-specific logic; or the host core grows per-OS branches every time a guest is added.

## The four states of a Python guest capability (the goal is unbounded; present-tense claims go only as far as the proof)

Under the higher Web Machine North Star, the compatibility direction for the pyproc guest is "everything that works in local Python, in the browser". Each capability sits in one of the four states below, and pyproc's job is to push capabilities up a row and to be the structure that absorbs a wall the moment upstream opens it. "Impossible" is a verdict about current conditions, not surrender. The canonical coordinates for each axis live in the measurement ledger of the relevant initiative.

1. **Achieved today (measured in a browser today)**: pure Python plus **native C-extension packages** (numpy, pandas, scipy, scikit-learn, matplotlib and more - the Pyodide distribution's 158 pyemscripten (PEP 783) wheels load through dlopen and already work); multi-core processes, snapshot-fork, and map; checkpoint and time travel; session persistence and revival; the terminal; the in-kernel ASGI server; a persistent FS (OPFS); input, HTTP, and subprocess; the process OS broadly (pipes, shm, locks, job control, kernel election, machine containers, the permission jail, fsWorld); and booting non-Pyodide WASI CPython 3.14.6 with pure-Python wheel installation. **Pyodide does dlopen dynamic C-extension `.so` files** - "no dynamic C extensions" was only ever true of the WASI lane.
2. **Available through a workaround (virtualized the browser way, measured)**: outbound sockets (`SocketBridge`), servers (`AsgiServer`/`VirtualOrigin`), processes (worker kernels). **GPU numerical acceleration** (WebGPU compute, reached from a worker and driven synchronously through JSPI; the precursor WgPy demonstrated matmul acceleration on Pyodide). It works today in the narrow class of large f32 linear algebra - not transparent numpy acceleration but a separate array API. Building numpy as a WASI static fat binary is also a settled path, but it brings **no speed gain and is in fact slower** (reference BLAS, no SIMD, and a JSON-only WASI value bridge), so it is a coverage experiment rather than a speed path.
3. **Waiting on upstream (blocked now, reopened by platform progress)**: **installing an arbitrary C extension on demand** (Pyodide's dlopen works, but that package's pyemscripten wheel has to be published - PEP 783 ecosystem adoption is around 28 packages, in ABI lockstep, and most of the long tail is unpublished); WASI dynamic linking (cpython#142234); a **SIMD numpy build** (Pyodide does not build with SIMD yet, so the gain is pending); and real threading with nogil (WASM threads plus shared memory, PR #6285 draft).
4. **A permanent wall for web security reasons (impossible without an external piece)**: inbound servers, executing arbitrary native binaries, direct local drivers (CUDA), and desktop automation. That share is carried by the consuming product's local or Actions tier.

Corrections (honest, from the 2026-07-13 research synthesis): (1) **availability** of native numerical packages is already solved (numpy and others load through dlopen from 158 wheels). (2) "No dynamic C extensions" was WASI-only; Pyodide does dlopen. (3) The wall that actually remains is **speed** - the gap in large numpy arithmetic is the next leap, and its coordinates live only in the ledger. The path is [mainPlan numerical-acceleration](../../mainPlan/_done/numerical-acceleration/README.md): horizontal sharding plus a GPU-resident lane. And **arbitrary package coverage** (pyemscripten wheel ecosystem adoption). (4) GPU is corrected to state 2 (it works as a library today; the previous edition's state 3 was stale).

## Support boundary (Chromium/Edge only)

JSPI (JavaScript Promise Integration), SharedArrayBuffer, and `crossOriginIsolated` are required. No Firefox or Safari support is a scope choice, not a defect. SharedArrayBuffer needs the page to be in a crossOriginIsolated state through these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Related documents

- The higher Web Machine vision and the dual-boot completion record: [mainPlan/_done/web-machine-platform](../../mainPlan/_done/web-machine-platform/README.md)
- The completion record for the first Python guest OS reaching maturity: [mainPlan/_done/browser-os-north-star](../../mainPlan/_done/browser-os-north-star/README.md)
- The consumption contract (install, public surface, version consistency): [docs/consuming/contract.md](../consuming/contract.md)
- The operating model (lifecycle, development principles): [docs/operations/operatingModel.md](../operations/operatingModel.md)
- Current development plans and decision records: [mainPlan/](../../mainPlan/README.md) (initiatives move to `_done` when they complete)
