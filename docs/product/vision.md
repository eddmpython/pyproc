# pyproc product direction - what, for whom, and why

The canonical statement of pyproc's overall direction and product policy. Persistent decisions live in docs, current implementation and evidence live in `src/` and `tests/`, and completed decision history remains in git.

## What the North Star commits to

The one-line statement and the current score of every axis live in the [root README](../../README.md#north-star). This section says what that statement commits to.

**Make the browser a persistent computer, with Python as the default Machine.** Precisely: take
Chromium as the hardware and security boundary, and bind virtual CPU, memory, disk, display, network,
devices, permissions, boot, and recovery into one Machine contract. Python is the product path; other
guests prove that the contract is a computer rather than an interpreter wrapper.

The installed browser-control command extends that direction without adding a JavaScript package export:

> Persistent Python state, reliable browser actions, explicit external effects, and one inspectable trace.

When this external capability is enabled, the Machine is a recoverable and auditable browser agent computer.
Python state can be rewound, browser effects cannot be pretended away, and every transition must be explained
by a bounded outcome trace. CDP remains a broker-owned capability outside the browser sandbox rather than a
new runtime layer or a handle placed inside Python.

The goal is not to draw a Windows- or macOS-shaped UI in the browser. It is to make one Python
Machine people can open, work in, commit, rewind, and carry. The thin multi-guest host underneath
keeps that lifecycle coherent and lets a Linux guest use the same boot, device, snapshot, and restore
contract without splitting pyproc into a second product.

## North Star axes

An axis is a facility the computer itself has to provide: execution, rewindable state, processes, a durable disk, survival past its tab, a portable image, guests, engine independence, network, package reach, one gathered product entrance, and a verifiable byte chain. Each carries a score out of 10, where it stands today, and where it has to land. The rules that keep those scores honest:

- **The ledger is executable, and the document is its projection.** [`tests/northStar.mjs`](../../tests/northStar.mjs) holds every axis together with the artifacts standing behind it. The README table is rendered from that file and compared to it by the structure gate, so a score cannot be raised by editing prose. Moving a score means editing the ledger, and that diff is the review.
- **Only gates that run in CI count.** A capability with no automated gate scores nothing, however complete the implementation. Every registered artifact must exist, must be opened by some runner, and its lane must appear in the CI workflow. Registering a local-only lane as CI evidence fails the gate.
- **Manual evidence caps an axis below 9.** Where a headless gate is impossible (no WebGPU adapter, a relay this package does not ship, x86 assets that cannot be committed), the probe is registered as manual with its reason. A near-complete claim may not rest on evidence that lives in someone's memory.
- **Every axis needs at least one browser gate.** Real validation of a WASM runtime happens only in a browser, so an axis proven by Node structure checks alone is not proven.
- **Value is intrinsic.** Adoption, user counts, release age, other repositories, market response, and retired surfaces never move a score. pyproc proves value by what its own Machine can do and by how directly a user can enter that ability.
- **Evidence is a gauge, not the North Star.** Tests and failure injection prove an invariant; they are not a substitute for it and never become a popularity or release-readiness score.
- **A 10 is complete, not popular.** It means the capability is repeatedly verified in a real browser with no workaround left outside the public surface. Everything below 10 states the intrinsic gap in the same row.

New work names the axis it moves. Work that moves no axis, weakens a guardrail in [contract reality](../operations/contractReality.md), or trades an axis for a number on a benchmark is not a priority here.

## Ordered agent-experience initiatives

Agent-computer work follows nine ordered initiatives. The detailed plan, research baseline, failure conditions,
and graduation gates live in [agent experience initiatives](../operations/agentExperienceInitiatives.md).

0. **Finish the Machine Entrance.** An exact package install must reach a useful Python result and an optional,
   explicitly authorized browser observation without deep imports, protocol assembly, or permission guesswork.
1. **Then build the Perception Computer.** A persistent provider-neutral world model produces a goal-conditioned
   `SituationCapsule` containing the minimum sufficient facts, affordances, changes, unknowns, and evidence.
   Pixels remain bounded evidence for unresolved claims rather than the default representation of the page.
2. **Then close the Verified Change Loop.** A repository-scoped Experience Contract drives real browser scenarios,
   exact reference comparison, and a canonical Evidence Pack whose deterministic verdict can be replayed without
   sending browser effects again. The runtime audits and verifies; source repair remains the caller's responsibility.
3. **Hibernate a bounded Machine fleet.** Only leased hot Machines retain execution owners. A safe suspend drains
   work, commits an exact generation, terminates the owned Worker and devices, and later wakes in a new owner.
4. **Make execution state the memory.** Immutable session revisions link Machine generations, branches,
   environments, situations, replay cursors, permissions, and evidence without turning transcripts into state truth.
5. **Rehearse, approve, and commit one effect.** Effect-free rehearsal states its coverage, an approval binds the
   exact intent, and a durable one-shot lease prevents automatic resend after the live send boundary.
6. **Make cooperative application state transactional.** An opt-in application exports versioned logical state and
   an effect outbox so the application and Python Machine can branch and adopt as one paired generation.
7. **Build verified replay worlds.** Content-addressed state nodes and exact action edges allow effect-free traversal
   and deterministic evaluation. Missing graph edges remain missing and are never synthesized.
8. **Carry one intent across actuator planes.** A deterministic broker preserves absolute target bindings,
   authority, effect windows, user precedence, and one receipt across cooperative app, browser input, and native
   accessibility providers without making any provider mandatory for the browser-only installation path.

The Machine Entrance is delivered through the installed initializer, doctor, and client parity gates. The
Perception Computer is delivered through `apx.situation`, the JavaScript and Python `situate()` facades, and the
Chrome and Edge `test:perception-computer` gate. It does not claim general superiority over Playwright. The narrow
LLM perception contract preserves the pinned baseline's action reach while adding smaller task-conditioned state,
explicit uncertainty, broker authority, transition truth, and effect-free replay. Verified Change Loop is delivered
through strict Experience Contracts, canonical Evidence Packs, exact comparison, effect-free pack replay, and the
installed `test:experience-verification` gate. The next active campaign is
[`hibernatingMachineFleet`](../../tests/attempts/hibernatingMachineFleet/README.md). Later initiatives remain locked
behind their immediate predecessor. No initiative changes a North Star score before its browser evidence is registered
in the ledger.

This portfolio does not duplicate the separate ceiling ladder. Serverless local applications, portable Machine
images, Native CDP, FrameSpace, and ReplaySpace are shipped foundations. The wasm tool layer and Node guest remain
the ladder's sixth and seventh rungs, behind their existing prerequisites. A fully virtual Chromium, zero host RAM,
and suspension of native editor processes are not product claims.

## Where pyproc sits today

pyproc is a persistent Python computer delivered as an exact-version native ESM package. Its public
root is one Machine handle that owns Python execution, processes, files, permissions, network
virtualization, and rewindable history in the browser with no application server. The
`src/machine/` layer and `apps/webComputer/` extend that same lifecycle to Python and Linux under
shared device and signed-image contracts. Package-internal reads are forbidden.

Even as the higher goal grows, present-tense claims do not widen with it. The general host, shared `.webmachine` image, and Linux dual-boot are represented by the shipped `src/machine/` contract and the browser evidence registered in [`tests/northStar.mjs`](../../tests/northStar.mjs). The host ships through the single `createWebComputer` entry point and the `pyproc/machine` subpath. The reproducible Buildroot Linux guest also ships, separately from npm, as the hash-pinned `buildroot-pyproc-i686-v2` project release with exact source, complete legal material, SBOM, configuration, and independent-build receipt. The x86 emulator and remaining firmware are externally supplied assets; pyproc does not redistribute them or claim their provenance as its own.

## The founding design principle

Do not unify the syscalls and internal state of every OS. What the Web Machine makes common is only boot, pause, resume, shutdown, virtual devices, resource permissions, the snapshot envelope, and failure recovery. Engine-specific state stays an opaque payload that an adapter translates. If adding a new guest grows an OS-name branch in the host core, the design has failed.

## The problem

The pieces for running real Python in a browser already exist: Pyodide, JSPI, File System Access,
and SharedArrayBuffer. What is missing is a single object that binds them into a computer whose work
survives. Without that object, browser Python starts as a disposable interpreter and each capability
creates another competing entry point. The result:

- Execution, files, process control, and persistence drift into separate runtime layers.
- Pyodide is one single interpreter. The physical properties of a runtime - parallelism, processes, state restore - are not provided, so they get reinvented every time.
- Browser projects fill missing capabilities (sockets, subprocess, blocking input) in incompatible ways, so the work is not reusable.

pyproc builds that Machine **once, properly**. Improvements collect behind the root `pyproc` entrance,
and the executable package contract remains the SSOT.

## What it is and what it is not

**pyproc is:**
- A persistent browser-native Python computer delivered as a framework-agnostic ESM package. No
  build step (native `.js` plus a hand-maintained `.d.ts`).
- OS kernel primitives at the browser tier: runtime boot, restore-based reactivity, the process OS, the file world, the permission jail, network virtualization, capability contracts.
- A clean public surface that encapsulates the cross-cutting concerns - WASM heap access, stack pointers, monkeypatching - behind capability contracts.

**pyproc is not:**
- A general-purpose Linux clone. Native binaries, inbound ports, and direct local driver access are things the browser blocks, and it does not build them without an external piece.
- A general x86 emulator engine or a bundled Linux distribution. The host contract ships over npm and the project publishes its reproducible Buildroot guest separately; the emulator and remaining firmware are injected externally, with their compliance and provenance kept as a separate boundary.
- UI or domain logic (curriculum, automation, sheet editing).
- Placement policy (deciding which tier a workload runs on). That belongs outside the kernel.
- A local engine or a GitHub Actions engine. pyproc provides browser-tier primitives only.
- Firefox/Safari support. Out of scope (see "Support boundary" below).

### What it deliberately will not build (rejected after review, with the reasoning preserved)

Tempting things that are wrong for us. Each was rejected after review. This list is the persistent decision record; the implementations and negative probes named below are the executable evidence, and git history preserves the review that produced it.

1. **Promoting a SharedWorker to be the kernel.** `COI=false` is a platform wall, and a kernel inside it loses SAB, interrupts, fork, and shm entirely. Instead, Web Locks plus BroadcastChannel election (`KernelElection`) keeps SAB while surviving a tab death.
2. **Preemptive time slicing in the main kernel** (a settrace bytecode budget). The settrace slowdown is large. The unit of preemption is a process (a worker), and the main kernel is for interaction only.
3. **A user or account system.** The browser profile is already the user. What is needed is not identity but per-machine capability (the permission jail).
4. **Promising zero-copy numpy over a SAB.** Impossible against the single-linear-memory wall. "One memcpy" stays the public contract.
5. **VT100/xterm.js emulation plus a shell pipe mini-language (`|`, `>`).** That re-imports the constraints of 1978 and stacks a second syntax on top of Python. The shell language is Python itself, and the essence of a pipe - lazy composition - is already in generators.
6. **Split panes and a window manager.** UI belongs outside the kernel. The answer to "one machine on several screens" is `KernelElection`.
7. **Maintaining a custom Pyodide build (pthread/nogil) permanently.** A custom engine build is conditional insurance, taken only when the pinned engine contract cannot provide a required primitive. The current engine pin and re-verification triggers are in [contract reality](../operations/contractReality.md).
8. **A WebRTC distributed machine.** Depending on a signaling service violates the local-first
   default. Moving between devices is the job of the `.pymachine` file.

## Success and failure criteria

- **Product success**: one exact-version Machine opens a durable Python workspace, reproduces its
  environment, runs and forks processes, commits and rewinds history, and moves through a signed
  image without leaking engine internals.
- **Architecture success**: the same host boots Python and a Linux guest under common lifecycle,
  device, and image contracts, while Python remains the default product path.
- **Failure**: public identity fragments into capability products; runtime layers are copied;
  pyproc absorbs UI or x86-specific logic; or the host core grows per-OS branches for each guest.

## The four states of a Python guest capability (the goal is unbounded; present-tense claims go only as far as the proof)

Under the higher Web Machine North Star, the capability direction for the Python guest is "everything local Python can do, in the browser". Each capability sits in one of the four states below, and pyproc's job is to push capabilities up a row when its own executable acceptance condition can pass. "Impossible" is a verdict about current platform conditions, not surrender. The canonical coordinates are the executable axis ledger in [`tests/northStar.mjs`](../../tests/northStar.mjs), the capability matrix, and the browser gates they register.

1. **Achieved today (measured in a browser today)**: pure Python plus **native C-extension packages** (numpy, pandas, scipy, scikit-learn, matplotlib and more - the Pyodide distribution's 158 pyemscripten (PEP 783) wheels load through dlopen and already work); multi-core processes, snapshot-fork, and map; checkpoint and time travel; session persistence and revival; the terminal; the in-kernel ASGI server; a persistent FS (OPFS); input, HTTP, and subprocess; the process OS broadly (pipes, shm, locks, job control, kernel election, machine containers, the permission jail, fsWorld); and booting non-Pyodide WASI CPython 3.14.6 with pure-Python wheel installation. **Pyodide does dlopen dynamic C-extension `.so` files** - "no dynamic C extensions" was only ever true of the WASI lane.
2. **Available through a workaround (virtualized the browser way, measured)**: outbound sockets (`SocketBridge`), servers (`AsgiServer`/`VirtualOrigin`), processes (worker kernels). **GPU numerical acceleration** (WebGPU compute, reached from a worker and driven synchronously through JSPI; the precursor WgPy demonstrated matmul acceleration on Pyodide). It works today in the narrow class of large f32 linear algebra - not transparent numpy acceleration but a separate array API. Building numpy as a WASI static fat binary is also a settled path, but it brings **no speed gain and is in fact slower** (reference BLAS, no SIMD, and a JSON-only WASI value bridge), so it is a coverage experiment rather than a speed path.
3. **Waiting on a technical prerequisite**: **installing an arbitrary C extension on demand** needs a matching pyemscripten wheel in the pinned package corpus; WASI dynamic linking needs the engine contract implemented; a **SIMD numpy build** needs a verified SIMD-enabled artifact; and real threading needs nogil plus WASM shared-memory support. These conditions change only when pyproc's corresponding install, execution, and failure gates can pass.
4. **A permanent wall for web security reasons (impossible without an external piece)**: inbound servers, executing arbitrary native binaries, direct local drivers (CUDA), and desktop automation. Those capabilities require a local or remote execution tier outside the browser page.

Desktop automation now has one measured external-piece product without changing that verdict. The installed `pyproc-mcp` bin can opt into a Node-owned CDP broker for a temporary automation profile. It combines persistent Python state with semantic browser observation, ordered PNG/JPEG/WebP screenshots, chunked artifact retrieval, strict actionability, trusted input, explicit load states, allowed frame chains, popup and dialog lifecycle, guarded files, downloads, cookie and storage actions, and one effect-aware trace. Exact target, action, raw-method, event, file, destination, artifact, and fixed-risk manifests remain separate. Operator acknowledgement, purpose declaration, partial-completion reporting, redirect re-authorization, artifact cleanup, and the no-retry `outcomeUnknown` law are installed-package gated in Chrome and Edge. The CDP endpoint never enters the Python heap, the default four-tool MCP surface stays closed, and no `pyproc/browser` npm surface is created. A user-tab extension remains a different consent path: `chrome.debugger` was measured on Edge, but no extension is shipped, and official branded Chrome no longer accepts command-line unpacked extension loading as an automated installation proof.

Corrections fixed by executable checks: (1) native numerical packages in the pinned Pyodide corpus load through dlopen. (2) "No dynamic C extensions" was WASI-only; Pyodide does dlopen. (3) The remaining numerical wall is large-array execution, addressed by horizontal sharding through `machine.proc()` and the opt-in GPU-resident lane in the [capability matrix](../usage/capabilityMatrix.md). Package reach is measured against the corpus pyproc pins and runs, never by ecosystem size. (4) GPU is state 2 because the library path works; its missing headless adapter remains an explicit evidence boundary.

## Where the ceiling moves next

The four states above are verdicts about today. This section fixes the direction for moving them (from the 2026-07-31 ceiling review), so a later session can pick up the frontier without re-deriving it. The remaining distance is two walls with different fates, and the work orders itself around that difference. Every rung below is registered in the [axis ledger](../../tests/northStar.mjs) against the axis it moves, so a rung cannot drift away from the score it claims to move, and the structure gate holds that list and this one to the same count.

**The transport wall can open only through executable acceptance conditions.** A tab cannot accept an inbound connection on the default web path today. The rungs are ordered by what they add to the Machine, and the fifth is filed here because it changes the guest memory contract rather than the network contract:

1. **TLS terminated inside the tab.** The socket relay currently terminates TLS and sees plaintext, so it has to be trusted. In-tab TLS (already recorded as the socket lane's v2) turns any relay into untrusted infrastructure: the requirement drops from "a relay you trust" to "any relay at all". It comes first because every later rung inherits its trust model.
2. **Relay multiplexing** (Wisp class): one WebSocket carrying many sockets. Already on the ledger as relay hardening.
3. **Browser-to-browser transport** (WebRTC DataChannel): a direct peer link between tabs on different machines, NAT traversal included. The rejected-ideas list turns down a WebRTC distributed machine, and that rejection stands; a transport subpath is a different object, and the `pyproc/socket` precedent (an opt-in subpath may depend on an external piece it does not ship) already covers it. First pairing can exchange the offer manually (a QR code), which shrinks the signaling dependency to reconnects. Subject to the Experimental surface freeze: no new subpath until the freeze condition clears.
4. **An Isolated Web App lane.** It lands when a `TCPServerSocket` capability probe, permission boundary, encrypted transport path, and failure gate all pass in the environment pyproc itself can package and run.
5. **memory64 enablement**: it lands when the pinned engine, snapshot format, process fork, and image round trip all pass with memory64 enabled. It moves the guest axis, not the network one.

**The native wall does not open.** No web standard proposes letting web content spawn a native process, and none will; that would contradict the browser's definitional security boundary. The platform's actual trajectory points the other way: compile the world into the sandbox. So "run what only local machines run" is never answered by a bridge outward. It is answered by moving the work inward:

6. **A wasm tool layer**: the tools a working machine assumes (git and ripgrep class) as wasm builds inside the machine.
7. **A Node guest** (long horizon): Node.js as a third guest beside Python and Linux. It lands only when its `MachineGuest` adapter, offline boot, lifecycle, signed-image round trip, byte provenance, and browser gate all pass inside this repository.

Nothing outside the repository reorders these priorities. A rung moves only when its stated pyproc acceptance condition becomes executable and passes without weakening an existing Machine invariant.

## Support boundary (Chromium/Edge only)

JSPI (JavaScript Promise Integration), SharedArrayBuffer, and `crossOriginIsolated` are required. No Firefox or Safari support is a scope choice, not a defect. SharedArrayBuffer needs the page to be in a crossOriginIsolated state through these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Related documents

- The executable North Star and its registered evidence: [`tests/northStar.mjs`](../../tests/northStar.mjs)
- The shipped Web Machine implementation and browser probes: [`src/machine/`](../../src/machine/) and [`tests/webMachine/`](../../tests/webMachine/)
- The package contract (install, public surface, version consistency): [docs/usage/contract.md](../usage/contract.md)
- The operating model (lifecycle, development principles): [docs/operations/operatingModel.md](../operations/operatingModel.md)
- Current gaps and re-verification triggers: [docs/operations/contractReality.md](../operations/contractReality.md); completed decision history: git history
