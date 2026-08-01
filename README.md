<p align="center">
  <img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="132" alt="pyproc">
</p>

<h1 align="center">pyproc</h1>

<p align="center"><b>Real Python in your browser tab. No server.</b></p>

<p align="center">
  A stateful, browser-native Python runtime for AI agents: keep the runtime state alive,<br>
  share it across tabs, survive a closed leader, branch and restore it. No fresh container per run.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pyproc"><img src="https://img.shields.io/npm/v/pyproc?label=npm&color=5b8cff&labelColor=0a0f1c" alt="npm"></a>
  <a href="https://github.com/eddmpython/pyproc/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eddmpython/pyproc/ci.yml?branch=main&label=ci&labelColor=0a0f1c" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-7c4dff?labelColor=0a0f1c" alt="license MPL-2.0"></a>
  <img src="https://img.shields.io/badge/dependencies-0-00d4c8?labelColor=0a0f1c" alt="zero dependencies">
  <img src="https://img.shields.io/badge/CPython-3.14%20on%20WebAssembly-5b8cff?labelColor=0a0f1c" alt="CPython 3.14 on WebAssembly">
</p>

<p align="center">
  <a href="https://eddmpython.github.io/pyproc/"><b>Live demo</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#using-it-from-an-ai-agent">AI-agent patterns</a> ·
  <a href="#feature-status">Status</a> ·
  <a href="README.ko.md">한국어</a>
</p>

---

<details>
<summary><b>Contents</b></summary>

- [North Star](#north-star)
- [The problem it solves](#the-problem-it-solves)
- [In one example](#in-one-example)
- [Where a browser Python sandbox helps](#where-a-browser-python-sandbox-helps)
- [What you get (results, not internals)](#what-you-get-results-not-internals)
- [Quick start](#quick-start)
- [Choosing your entry point](#choosing-your-entry-point)
- [Using it from an AI agent](#using-it-from-an-ai-agent)
- [Plug it into an AI agent (MCP)](#plug-it-into-an-ai-agent-mcp)
- [Feature status](#feature-status)
- [What it guarantees, and what it doesn't](#what-it-guarantees-and-what-it-doesnt)
- [Scope and platform direction](#scope-and-platform-direction)
- [Security model](#security-model)
- [How it works (one page)](#how-it-works-one-page)
- [Where the shape pays off](#where-the-shape-pays-off)
- [Run the Web Computer](#run-the-web-computer)
- [Public surface](#public-surface)
- [Setup](#setup)
- [Install and pinning](#install-and-pinning)
- [Who uses it](#who-uses-it)
- [Development](#development)
- [License](#license)

</details>

## North Star

**Make the browser a computer that boots more than one guest operating system - and make that computer pyproc itself.**

Scores are anchored to gates that actually run in CI. A path no automated gate runs does not score, however complete the implementation is, and an axis whose evidence includes a manual-only probe is held below 9. A 10 means the axis is finished: repeatedly verified in a real browser, with nothing left for a consumer to work around.

Today that is **98.5 / 120, average 8.2 / 10**.

| Axis | Score | Where it stands today | Where it has to land | Next move |
|---|---:|---|---|---|
| Real Python in the tab | 9.5 | `boot` / `run` / `loadPackages` drive CPython on WebAssembly from one handle, with a terminal REPL, PEP 723 scripts, a wheel cache, and a declared-environment lane. The browser gate, the installed-package consumer gate, the demo gate, and the agent (MCP) gate all run it. Engine assets come from a CDN unless you self-host, and the platform is Chromium and Edge only. | The Python a local interpreter runs, running in a tab, with no server and no setup ritual. | Make the verified self-hosted asset lane the default path, so a first boot depends on no CDN |
| State you can rewind | 9.0 | Checkpoint, restore, branch, and prune run at execution boundaries over complete heap hashing: a full-heap byte-equality round trip, sibling-delta isolation across a branch tree, and a violated boundary that falls back to a full rehash instead of restoring something corrupt. Node property and fuzz gates cover delta soundness and tree integrity. An arbitrary instant is still not capturable, because in-flight promises and network requests live outside the boundary. | Any past state comes back instantly, including the work that was in flight when it was left. | Capture an arbitrary instant rather than an execution boundary, by pulling in-flight promises and requests inside the boundary |
| Processes and real parallelism | 8.5 | Workers are processes: snapshot-fork spawn, `map`, `forkMany`, a signal table, kill, job control, nested containers, pool exhaustion, and mid-flight worker death all converge under the browser gate. N interpreters are N GILs, so the parallelism is structural rather than scheduled. There is no shared-memory threading and no arbitrary POSIX process tree. | A process model with the vocabulary of a real operating system, threads included once the platform allows them. | Take shared-memory threading the moment nogil and WASM threads land upstream, without changing the process vocabulary |
| A disk that survives | 8.0 | The state kernel commits content-addressed generations into OPFS under a write-order law: a tampered blob is caught, a broken HEAD falls back to PREV instead of impersonating a first boot, journals pack, an unchanged re-commit writes zero bytes, and the durable generation is what the browser computer restores after its process restarts. Readers for the old envelope are still carried, and their sunset waits for the next breaking release. | Durability with the guarantees of a real filesystem: no torn commit, no silent loss, exactly one format. | Sunset the old envelope readers at the next breaking release, leaving exactly one format on disk |
| A machine that outlives its tab | 8.0 | One logical machine spans same-origin tabs through leader election: a forcibly removed leader is taken over, followers commit through the leader, and the committed heap and `/home/web` cold-reopen after every participant closes, all of it exercised on the installed package. An interrupted command reports `PYPROC_RPC_OUTCOME_UNKNOWN` and is never replayed, so exactly-once resolution is declared rather than delivered. | The machine keeps running while any tab is open, and every command it accepted resolves exactly once. | Deliver exactly-once resolution instead of declaring it: an idempotency token and a result journal that survive an interrupted command |
| A machine you can carry | 8.5 | `.pymachine` and `.webmachine` files are signed content-addressed envelopes: signature and trusted-key verification, byte-tamper rejection, layout-independent reparse, worker-to-worker revival, and a cross-context transport refused on an `h0` mismatch instead of opened silently. The product gate exports a signed image and imports it into a fresh browser profile behind an explicit signer trust screen. Portability still assumes the same engine and manifest. A JS proxy handle cannot cross an image at all, so a surface that installs one poisons every proxy path in the revived kernel; the packet device was moved to a value boundary and now survives a revival in CI, while the socket and GPU surfaces still carry that limit. | A machine file opens on any compatible profile from a verified signer, across engine versions. | Move the socket and GPU surfaces to the same value boundary the packet port now uses, so no shipped surface poisons an image; Open an image across engine versions by negotiating the manifest instead of demanding an exact match |
| A computer that boots guests | 8.0 | The Web Machine host ships inside this package behind `createWebComputer`, and a Python guest and an x86 Linux guest consume the same lifecycle, device, generation, and envelope contracts. Host contract, dual-engine, owner succession, durable generation, and guest-network probes run in CI, and the product gate boots both guests, survives a browser-process restart, and moves the pair as one signed image. The display, framebuffer, packet-network, and dual-boot probes need x86 assets and run only in a local lane, and the Linux engine and image stay a hash-pinned development channel that cannot be redistributed. | Any guest with an adapter boots on the browser computer, and its image ships as freely as the host does. | Finish the self-built Linux image, so a guest ships as freely as the host and its lane can run in CI; rung 5: Adopt memory64 to lift the per-module heap ceiling that a large guest hits first; rung 7: Boot a Node guest beside Python and Linux, making JavaScript CLI tools residents of the computer |
| Primitives that outlive the engine | 7.0 | A non-Pyodide lane boots CPython 3.14.6 on WASI in the browser and takes checkpoint, time travel, repeated branching, and pure-Python wheel installation through the same contracts, which is what proves the primitives are not Pyodide internals. That lane has no `dlopen`, so it carries no dynamic C extensions, and its value bridge is JSON only. | Every primitive runs on any CPython-on-WebAssembly engine, with the same package reach on each. | Close the WASI gap: dynamic linking (cpython#142234) for C extensions, and a value bridge that is not JSON only |
| Network, the browser way | 7.5 | An in-kernel ASGI server answers `fetch` from Python with concurrent requests kept apart, a virtual origin serves it from the installed package, `urllib` performs real HTTP through the syscall bridge, the permission jail decides `connectSrc` per host, and two guests exchange IPv4 frames on one switch. Outbound raw sockets need a WS-to-TCP relay this package does not ship, so that subpath has no headless gate at all. | Python network code runs unmodified, and the relay boundary is the only thing a reader has to know. | rung 1: Terminate TLS inside the tab, so a relay carries ciphertext it cannot read and needs no trust; rung 2: Carry many sockets over one WebSocket, the Wisp class of relay hardening; rung 3: Open a direct tab-to-tab transport over WebRTC as an opt-in subpath, once the surface freeze clears; rung 4: Keep an Isolated Web App packaging lane ready for the day Direct Sockets opens a real inbound listen |
| Everything local Python does | 7.0 | Pyodide's `dlopen` already loads native C-extension wheels (numpy, pandas, scipy and more), packages install from a cache, `%pip` and `freeze` work inside the machine, and the WASI lane installs pure-Python wheels. The long tail is what is missing: an arbitrary package needs a published pyemscripten wheel, numpy has no SIMD build, threading is upstream-pending, and the GPU lane has no headless adapter, so its only evidence is a manual probe. | Whatever runs in a local interpreter runs in the tab, at a speed that needs no apology. | Widen package reach where it is thin: a pyemscripten wheel for the long tail, and a SIMD numpy build; rung 6: Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real |
| One kernel that products import | 9.0 | The public surface is one noun and its verbs, fixed by the structure gate, the public-surface and module-boundary contracts, a typechecked `index.d.ts`, an installed-package gate, and a browser product gate that imports the packed tarball by public specifier. dartlab runs it in production, codaro and xlpod consume the same seam. `pyproc/runtime` is unreleased and needs a SHA pin until the next release, and a breaking change is queued in the changelog. | Every consumer builds on the public surface and the shipped types, pinned to an exact version, with no deep path. | Release the queued breaking change, so `pyproc/runtime` is consumable by an exact version pin instead of a SHA; rung 8: Specify the local-agent boundary once (pairing, authorization, capability list), so consumers stop reinventing the share that stays outside |
| A supply chain you can verify | 8.5 | The asset CLI emits SRI over the worker and Service Worker import graph, `verifyPyProcAssetIntegrity` refuses a spawn on a bad hash, engine boot supports fail-closed SRI with a re-verifying offline cache, npm releases publish through OIDC trusted publishing with provenance and manual publishes disabled, and the browser computer verifies a signer before importing an image. The provenance of the Linux development channel is not reproducible yet. | Every byte that executes traces back to a source somebody else can rebuild and verify. | Make the Linux development channel reproducible, so its provenance is rebuildable like every other byte |

The axis ledger is [tests/northStar.mjs](tests/northStar.mjs): each axis registers the executable artifacts standing behind it, and the structure gate turns red when a registered gate is missing, is opened by no runner, or does not run in CI. This table is rendered from that ledger, so no score moves by editing prose. What each axis means, and what would move it, is in the [product direction](docs/product/vision.md#north-star-axes).

### Where the ceiling moves next

The distance that remains is two walls with different fates. The transport wall (a tab accepting an inbound connection) is opening, so it gets climbed in order. The native wall (web content spawning a native process) never opens, by the design of the web itself, so what only local machines run moves inward instead. Every rung names the axis it moves:

1. Terminate TLS inside the tab, so a relay carries ciphertext it cannot read and needs no trust (moves: Network, the browser way)
2. Carry many sockets over one WebSocket, the Wisp class of relay hardening (moves: Network, the browser way)
3. Open a direct tab-to-tab transport over WebRTC as an opt-in subpath, once the surface freeze clears (moves: Network, the browser way)
4. Keep an Isolated Web App packaging lane ready for the day Direct Sockets opens a real inbound listen (moves: Network, the browser way)
5. Adopt memory64 to lift the per-module heap ceiling that a large guest hits first (moves: A computer that boots guests)
6. Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real (moves: Everything local Python does)
7. Boot a Node guest beside Python and Linux, making JavaScript CLI tools residents of the computer (moves: A computer that boots guests)
8. Specify the local-agent boundary once (pairing, authorization, capability list), so consumers stop reinventing the share that stays outside (moves: One kernel that products import)

Why the order is what it is, and the external triggers that would reorder it, are in the [product direction](docs/product/vision.md#where-the-ceiling-moves-next). The rungs are registered in the axis ledger, so a rung cannot drift away from the score it claims to move.

## The problem it solves

AI agents don't run Python once. They generate code, run it, read the failure, fix it, and run again. They try several approaches in parallel, or roll back to a known-good state before the last mess.

The usual answer is a server container or a fresh Python environment per attempt: slow to start, costly to keep, and thrown away between tries. pyproc keeps a prepared Python state alive **in the user's browser**, and lets you **checkpoint, branch, and restore** it, so the retry loop costs milliseconds instead of a cold boot - and the user's data never has to leave the tab. For a product, the per-session sandbox you would otherwise run server-side moves into the user's browser: sandboxed execution you don't provision or pay for, on a boundary (Chrome + WASM) already hardened against the whole web.

## In one example

The retry loop is the product. Prepare once, checkpoint, let the agent try, restore in
milliseconds when it fails:

```js
import { boot } from "pyproc";

const machine = await boot();
await machine.loadPackages(["numpy"]); // prepare once (packages, data)
const cp = machine.history.checkpoint();       // save the prepared state

try {
  machine.run(codeFromTheAgent);               // attempt N
} catch (err) {
  machine.history.restore(cp);                 // prepared state is back - no re-boot, no re-install
  machine.run(fixedCode);                      // attempt N+1 from clean
}
```

Real CPython (via [Pyodide](https://pyodide.org) / WebAssembly), running in the tab, returning
real values - with a state you can save, branch, and get back.

## Where a browser Python sandbox helps

| Use case | How it's used | What pyproc gives |
|---|---|---|
| AI data analysis | Run AI-written pandas / NumPy on the user's file | Analyze without shipping the raw file to a server |
| AI coding tools | Checkpoint before running AI code; restore on failure | Cheap trial-and-error, no environment reset |
| Multi-agent analysis | Branch many runs from one prepared state | Compare independent approaches in isolation |
| Browser notebooks | Keep packages and data loaded across runs | No re-boot, no re-install |
| Coding education | Save the student state; test AI fixes on a branch | Feedback without touching their work |
| Internal analytics | Process sensitive CSV / Excel in the local tab | Minimize sending data off-device |
| Offline tools | Cache the runtime and packages | Runs where the network is limited |

The through-line: **an AI agent needs a Python environment it can prepare once, then save, branch, and restore** - and a browser sandbox keeps the user's data local while doing it.

## What you get (results, not internals)

- **Runs in the user's browser - no server sandbox to run or pay for.** Python executes in the tab, inside Chrome's renderer sandbox plus WASM isolation, a boundary hardened against the whole web. You move sandboxed code execution off your own infrastructure and the user's data stays local. (You still set resource and network limits yourself; the browser isolates escape, not resource exhaustion - see [Security model](#security-model). It protects the user from the code, not your secrets from the user.)
- **Restore without rebuilding.** Checkpoint a state with packages and data already loaded, then roll back to it - no re-run, no re-install.
- **Close the tab; keep the machine** (Experimental - `open({ persistent })`). Tabs share one logical Python state. If the leader closes, another tab recovers the last committed memory and `/home/web` files from OPFS and continues locally.
- **Branch from one state** (Beta - `machine.history` + `machine.proc()`). An agent runs several code candidates from the same prepared state, independently, and compares results.
- **Data stays local.** Process CSV / Excel / enterprise data in the tab and send only the summarized result onward.
- **Isolated execution.** Python runs off the main UI thread, across multiple workers you manage.

## Quick start

```sh
npm install pyproc
```

```js
import { boot } from "pyproc";

const machine = await boot();
await machine.loadPackages(["numpy"]);
console.log(machine.run("import numpy as np; int(np.arange(1_000_000).sum())"));  // 499999500000
```

Open one persistent machine from any number of same-origin tabs:

```js
import { open } from "pyproc";

const machine = await open({ persistent: { name: "workspace" } });
await machine.run("counter = globals().get('counter', 40) + 1");
await machine.commit();
console.log(await machine.run("counter")); // 41, including after leader takeover
```

Try the full lifecycle in the [Immortal Python Machine demo](examples/immortal.html): shared state, leader identity, durable epoch, forced takeover, and local recovery with no backend.

Checkpoint and restore. The handle's `history` speaks both zones: the closing `checkpoint()` marks the execution boundary that makes the restore sound:

```js
machine.run("values = [10, 20, 30]");
const cp = machine.history.checkpoint();      // save this state
machine.run("values.append(999)");
machine.history.checkpoint();                 // close the execution boundary -> instant restore path
machine.history.restore(cp);                  // back to the checkpoint - writes only changed pages
console.log(machine.run("len(values)"));      // 3
```

If the boundary was not closed (an exception mid-run, a stray mutation), `cp.restore()` detects
it and falls back to a full rehash automatically - slower, never silently corrupt. After calling
Python through a live proxy handle, report it with `machine.markDirty()`.

> The basics above need only a Chromium browser. `PyProc` (process OS) and sockets also need `crossOriginIsolated` (`COOP: same-origin`, `COEP: require-corp`) and same-origin workers - see [Setup](#setup). Run `checkEnvironment()` to check.

## Choosing your entry point

One question at a time, one obvious door:

| You need | Entry point | You get |
|---|---|---|
| Run Python in this tab, no revival | `boot()` | machine handle (`run`/`fs`/`history`/`proc`, `runtime` escape hatch) |
| A state that saves, exports, and revives | `boot({ deterministic: true, ...manifest })` | same handle; `history.export`/`history.save` become legal |
| Open a portable machine file | `open(blob, { trustedPublicKeys })` | machine handle, after integrity + trust checks |
| Revive a saved session | `open({ dir, name })` | machine handle (same-manifest replay + delta) |
| One living machine across tabs | `open({ persistent: { name } })` | multi-tab election handle (run/commit/status) |
| Real parallelism / live fork | `await machine.proc({ lanes, replay })` | worker process pool (`map`/`fork`/`signal`) |

Deterministic replay is the shared foundation: `boot({ deterministic: true })` fixes the boot
entropy so the same manifest reproduces byte-identical memory at the replay boundary (cp0), which is what makes delta save,
journal revival, and worker-to-worker `fork` sound. That choice is recorded in every durable
commit's environment fingerprint - a non-deterministic machine refuses `history.export` instead
of silently losing the replay guarantee.

## Using it from an AI agent

**Pattern 1 - restore on failure.** Prepare the environment, checkpoint, run AI-generated code; if it throws or dirties the interpreter, restore the boundary and run the fix. The AI can't corrupt state you can't get back to.

```text
prepare env  ->  checkpoint  ->  run AI code  ->  (fails)  ->  restore  ->  run fixed code
```

**Pattern 2 - branch candidates.** Load shared data and packages once, then run several approaches from the same prepared state, each isolated - via `PyProc` workers, or by repeated restore from one checkpoint.

```text
load data + packages
        |-- pandas approach
        |-- SQL approach
        \-- NumPy approach
```

**Pattern 3 - local-first data.** The user's file is analyzed in the tab; only the summary leaves. The raw data never reaches the model server.

```text
user file  ->  browser Python  ->  summary only  ->  AI model
```

## Plug it into an AI agent (MCP)

The repo ships a zero-dependency MCP server that exposes a persistent pyproc machine as
four agent tools: `pythonRun`, `checkpointSave`, `checkpointRestore`, `sandboxReset`.
It boots a headless Chromium machine page behind a COOP/COEP server and speaks MCP over
stdio, so the retry loop above becomes tool calls:

```sh
git clone https://github.com/eddmpython/pyproc && cd pyproc
# register with your MCP client (claude CLI shown):
claude mcp add pyproc-sandbox -- node scripts/mcpSandboxServer.mjs
# or run it directly and speak newline-delimited JSON-RPC on stdio:
npm run mcp:sandbox
```

The agent prepares state once (`pythonRun`), saves a handle (`checkpointSave`), lets a
risky attempt run, and rolls back in milliseconds (`checkpointRestore`) instead of
rebuilding the environment. `npm run test:mcp` verifies the full round trip in CI.

## Feature status

Honest maturity by browser-gate coverage. Everything below has a runtime gate; the label is how much to stake on it today.

| Area | Status |
|---|---|
| Python execution (`boot` / `run` / `loadPackages`) | Stable |
| Process OS: snapshot-fork spawn, `map` parallelism (`PyProc`) | Beta |
| Restore-based reactivity (`enableReactive`: checkpoint / time-travel) | Beta |
| In-kernel ASGI (`AsgiServer` - in dartlab production today) | Beta |
| Declared-environment lane (`boot` manifest: `packages` / `env` / `setup` / `wheelDir`), wheel cache, terminal, syscall bridge | Beta |
| Session revival + `.pymachine` images, machine journal (WAL) | Experimental |
| Live process fork, device FS, init / cron / resume hooks, virtual-origin URL | Experimental |
| Persistent multi-tab machine (`open({ persistent })` -> `KernelElection`) | Experimental |
| non-Pyodide CPython 3.14 (`bootWasi` / `WasiSession`) | Research preview |

## What it guarantees, and what it doesn't

**Guaranteed (browser-measured):**

- Pyodide-based Python on supported browsers.
- WASM heap state saved at declared execution boundaries.
- State restore under compatible runtime conditions.
- Worker-based execution isolation.

**Not (yet) guaranteed:**

- Full process capture at an arbitrary instant - in-flight network requests and Promises are not restored.
- Silent replay of an interrupted command. If a leader disappears after an RPC was sent, the caller receives `PYPROC_RPC_OUTCOME_UNKNOWN`; the command is never automatically re-executed.
- Every Python package - native C-extension wheels need a static build; pure-Python and Pyodide-built packages work.
- Snapshot compatibility across Pyodide versions. `.pymachine` portability assumes the same engine/manifest and either an explicit trusted source or a verified signer.
- GPU / native Linux packages, full POSIX `fork`, arbitrary native binaries.

## Scope and platform direction

pyproc is the first Python guest OS of the computer described in the [North Star](#north-star) above. The Web Machine host ships inside this package (`src/machine`, entered through `createWebComputer`), and it plus the local Web Computer product boot pyproc and Linux through one lifecycle, save their memory and disks together, recover them after a browser-process restart, and import a signed image in a fresh browser profile. This does not turn the public `pyproc` package into a general-purpose hypervisor, and it does not make the development Linux image redistributable.

Within that larger goal, pyproc's compatibility direction remains: whatever Python runs locally should eventually run in the browser, with no server. Everything local sorts into four states, and pyproc's job is to push things up the list and absorb a wall when the platform reopens it:

- **Delivered** (browser-gated in CI today): pure-Python + Pyodide packages, multi-core processes, checkpoint / restore, in-kernel ASGI, terminal, persistent FS, portable `.pymachine` and `.webmachine` images.
- **Shipped without a headless CI gate**: `pyproc/socket` (outbound Python sockets need a WS-to-TCP relay this package does not ship) and `pyproc/gpu` (needs a real WebGPU adapter, which headless CI does not have). Both are opt-in subpaths you must verify inside your own product; the standing gap is tracked in [contract reality](docs/operations/contractReality.md).
- **Virtualized** (the browser way): a TCP `listen()` becomes an ASGI app, `os.fork` becomes worker kernels, outbound sockets ride a thin relay.
- **Upstream-pending** (walled now, reopenable): native C-extension wheels (Emscripten static builds / the WebAssembly component model), real threading.
- **Permanent web-security wall**: inbound connections and arbitrary native binaries need an external relay or agent.

The Python gap map lives in [local-parity](mainPlan/_done/local-parity/README.md). The completed host architecture and Dual-Boot record lives in [web-machine-platform](mainPlan/_done/web-machine-platform/README.md).

## Security model

pyproc runs Python inside the browser's WebAssembly and Web Worker isolation boundaries. That is not a claim of safety for arbitrary untrusted code: an application running untrusted code is still responsible for its own network, storage, package, memory, and execution-time policies appropriate to its threat model. A `.pymachine` file is live state and carries the same risk as an executable - `open(blob, trustOpts)` verifies a SHA-256 envelope and refuses to open without either explicit `{ trust: true }` or a signature verified by `trustedPublicKeys`.

**Supply chain**: npm releases use Trusted Publishing (OIDC) with provenance (manual publishes disabled); the `pyproc-assets` CLI emits an SRI manifest over the worker/service-worker import graph and `verifyPyProcAssetIntegrity` enforces it before any worker spawns; engine boot supports fail-closed SRI (`engineScriptIntegrity` / `coreIntegrity`) with a re-verifying OPFS offline cache. Threat model details: [SECURITY.md](SECURITY.md).

## How it works (one page)

pyproc treats browser Python not as "one notebook cell" but with an **OS-like process model**: a Web Worker is a process, a heap snapshot is a process image, injecting that snapshot is a fork, and N interpreters mean N GILs = N-core parallelism. It runs [Pyodide](https://pyodide.org) (CPython on WebAssembly) and adds what Pyodide doesn't give you alone: cheap process spawn, real parallelism, and interpreter-state restore without re-running your code.

```text
Application / AI agent
        |
     pyproc API
   +----+----------+
Runtime  Process OS  Capabilities
   |        |        (reactive / syscall / socket / asgi / terminal / session / ...)
Pyodide  Workers
        |
 Snapshot / Journal / Restore
```

Four primitives make it sound: complete heap hashing at each execution boundary (sampling would miss changes and corrupt a restore); deterministic boot (a byte-identical base, so only your delta has to travel); snapshot-fork; and an engine seam (the same primitives also run on non-Pyodide CPython 3.14, proving they don't depend on Pyodide internals). Deep design lives in [mainPlan](mainPlan/README.md); the axis-by-axis gap map in [local-parity](mainPlan/_done/local-parity/README.md).

## Where the shape pays off

pyproc is not "Python, but faster." It is Python with a process model, and the wins come from
the contract rather than from arithmetic: prepare state once and branch it, restore instead of
re-running, shard work across independent interpreters (N interpreters = N GILs = real
parallelism), serve from inside the tab, and move a live machine as a signed image.
Single-kernel NumPy is ordinary WebAssembly BLAS, and pyproc does not pretend otherwise.

Measure the envelope on your own hardware: run [Speed Lab](examples/speedLab.html) with
`npm run serve`. The measurement contract is in [benchmarking.md](docs/operations/benchmarking.md).

## Run the Web Computer

The Web Computer product boots Python OS and Linux in one browser workspace. Both guests have real memory and block-backed files, save into one durable IndexedDB generation, recover after the browser process closes, and move together in a signed `.webmachine` file.

```sh
npm run assets:web-computer
npm run serve
```

Open `http://localhost:8788/apps/webComputer/` in Edge or Chromium. The product includes Python execution, a Linux VGA display and terminal, pause/resume/shutdown controls, automatic durable saves after commands, manual save, signed export, and an explicit signer trust screen for import.

The current Linux execution catalog is a hash-pinned development channel. Its engine and image binaries are prepared locally and excluded from git and npm packages; public redistribution remains disabled until the complete source and license inventory is reproducible.

## Public surface

Capabilities are opt-in. Turn on only what you need, and consume the capability contract rather than engine internals (`HEAPU8` and friends). This README names the public surface; the full product decision table lives in the [capability matrix](docs/consuming/capabilityMatrix.md).

The root surface is one noun and its verbs: a **machine with history**. Two entry verbs return a machine handle, one verb revives machines from anywhere, and everything else is vocabulary on the handle.

| Need | Public exports | Runnable proof |
| --- | --- | --- |
| Boot a Python machine and run code | `boot` (returns a machine handle: `machine.run`, `machine.runAsync`, `machine.fs`, `machine.term`, `machine.runtime` escape hatch) | [basic example](examples/basic.html), [browser gate](tests/browser/gate.html) |
| Time-travel, branch, and durably commit state | `boot` handle's `machine.history` (`checkpoint`/`restore`/`tree` are volatile; `commit`/`recover`/`watch`/`export`/`save` are durable, content-addressed) | [browser gate](tests/browser/gate.html), [machine demo](examples/machine.html) |
| Use browser workers as processes (independent GILs) | `boot` handle's `machine.proc` (pool verbs: `map`, `fork`, `forkMany`, `mapArray`, `matmul`; signal table on the pool class) | [process demo](examples/processOs.html), [speed lab](examples/speedLab.html) |
| Revive a machine from a file, saved session, or other tabs | `open` (signed bundle blob, `{ dir, name }` session, `{ persistent }` multi-tab machine) | [immortal demo](examples/immortal.html), [machine demo](examples/machine.html) |
| Assemble the browser computer (multi-guest OS host) | `createWebComputer` | [web computer app](apps/webComputer/index.html), [web computer gate](tests/browser/webComputerProduct.mjs) |
| Check platform readiness before booting | `checkEnvironment` | [browser gate](tests/browser/gate.html) |
| Branch on failures programmatically | `PyProcError`, `PYPROC_ERROR_CODES` | [structure gate](tests/run.mjs), [browser gate](tests/browser/gate.html) |

Plumbing subpaths carry the contracts underneath the handle:

```js
// The adoption seam when you boot Pyodide yourself and hand the instance to pyproc.
// Unreleased: this subpath returns in the next release; until then it needs a SHA pin.
import { Runtime, bootRuntime, checkEnvironment } from "pyproc/runtime";
// The durable-state kernel: object model, commit/open protocol, stores, signed bundles.
import { commitState, openState, OpfsStateStore, decodeStateBundle } from "pyproc/history";
// The browser-computer internals (hosts, devices, guest adapters, machine stores).
import { createMachineCryptoProvider, MachineCommitCoordinator } from "pyproc/machine";
// Deployment assets: manifest, SRI verification, Service Worker registration.
import { getPyProcAssetManifest, verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "pyproc/assets";
// Demoted (no headless CI gate, or research preview) - deliberately off the root surface:
import { GpuCompute } from "pyproc/gpu";
import { SocketBridge } from "pyproc/socket";
import { bootWasi } from "pyproc/wasi";
```

The function-level reference is [docs/reference/api.md](docs/reference/api.md) (English); this README stays the map. [docs/consuming/](docs/consuming/contract.md), [docs/reference/](docs/reference/api.md), and [docs/product/](docs/product/vision.md) are English; `docs/operations/` is the internal operating tree and stays Korean. For product decisions by capability, use the [capability matrix](docs/consuming/capabilityMatrix.md): it maps each public export to value, status, setup, runnable surfaces, gates, and boundaries.

Deployment asset manifest:

```bash
npx pyproc-assets --baseURL /vendor/pyproc/ --out public/vendor/pyproc-assets.json --copy-to public/vendor/pyproc
```

The CLI follows the Worker / SharedWorker / Service Worker import graph, copies the required files when `--copy-to` is set, and emits `sha256-...` integrity for every file. Load that JSON as `assetIntegrity` before worker-backed capabilities spawn, and register `pyprocSw.js` through `registerPyProcServiceWorker(...)` so the Service Worker path is verified too.

## Setup

**Chromium / Edge only.** pyproc needs JSPI (JavaScript Promise Integration, default since Chrome 137), SharedArrayBuffer, and `crossOriginIsolated`. Lack of Firefox / Safari support is a deliberate scope choice, not a defect. Full environment matrix (per-capability requirements, engine version, resource characteristics): [docs/consuming/compatibility.md](docs/consuming/compatibility.md).

There are two tiers of setup, so "just install and import" is true for the basics but not for everything:

| You want | You need | Engine assets |
|---|---|---|
| `boot` / `run` / packages, `machine.history` (checkpoint, time-travel) | `npm install` plus a Chromium browser. No headers. | Fetched at runtime from `cdn.jsdelivr.net/pyodide/v314.0.2/full/` unless you pass `indexURL` |
| `machine.proc()` (fork, `map`, interrupt), IPC, blocking sockets | The two headers below, plus **same-origin worker files** (so npm install / vendoring, not CDN import) | Same, and the worker file must be same-origin |

**Engine assets are not in this package.** The default `indexURL` points at jsDelivr, so the first
boot downloads the Pyodide distribution (wasm + stdlib + lock). Three ways to control that:

```js
// 1. Self-host: copy a Pyodide release into your static assets and point at it.
await boot({ indexURL: "/vendor/pyodide/" });
// 2. Cache the core in OPFS so later boots do no network at the fetch layer.
await boot({ coreCacheDir: await navigator.storage.getDirectory() });
// 3. Verify what you fetch (fail-closed SRI over the engine graph).
await boot({ engineScriptIntegrity: "sha256-...", coreIntegrity: { /* per-file SRI */ } });
```

For (1) this repository vendors a release with `npm run fetch:engine` (a development script, not
part of the published package); in your own product, copy `node_modules/pyodide` or a release
tarball into the path you serve. The pinned version is the consuming contract:
[docs/consuming/contract.md](docs/consuming/contract.md).

Serve the page that hosts pyproc with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`checkEnvironment()` tells you exactly where you stand and how to fix any gap - call it once before you rely on the process OS:

```js
import { checkEnvironment } from "pyproc";

const env = checkEnvironment();
if (!env.ok) console.warn(env.issues);   // each issue has { code, need, why, fix }
// env.ok true  -> everything works, process OS included
// env.ok false -> basics still work; issues list what unlocks PyProc / sockets
```

Skip the headers and reach for `PyProc` anyway and you get an actionable error (which headers to add), not a cryptic `SharedArrayBuffer is not defined`.

Common ways to send the headers:

```js
// Vite (vite.config.js)
export default { server: { headers: {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
} } };
```

```text
# Static hosts that read a _headers file (Netlify, Cloudflare Pages)
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

Can't set headers at all (e.g. GitHub Pages)? Register `pyprocSw.js?coi=1` and reload once - the service worker injects the headers (virtual COI).

## Install and pinning

From npm ([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)): `npm install pyproc`. There is no build step (native ESM). Pin the exact version - floating ranges (`^`, `~`, `latest`) are not supported, because a state kernel's replay guarantee is version-bound:

```jsonc
// package.json
"dependencies": { "pyproc": "0.0.10" }
```

Surfaces marked **unreleased** below (currently `pyproc/runtime` and the per-subpath `types` entries) are not in 0.0.10; until the next release they need a SHA pin (`github:eddmpython/pyproc#<commit-sha>`), which is also the documented fallback for consuming any commit before it ships. Full policy: [docs/consuming/contract.md](docs/consuming/contract.md).

You can also import straight from a CDN with no install (single-runtime path only; the process OS needs its worker file same-origin with your page):

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/npm/pyproc@0.0.10/index.js";
</script>
```

## Who uses it

- **dartlab** (live): financial-disclosure notebooks over DART and SEC filings. A notebook worker boots its own Pyodide and adopts pyproc with `new Runtime(py)`, running the in-kernel `AsgiServer` as its browser-as-server backend (`fetch("/pyapi/...")` answered by a Python app, no socket) in production today.
- **codaro**: first consumer, pinned by commit SHA, wiring the `Runtime` and `PyProc` seam.
- **xlpod** (adopting): a browser spreadsheet that runs real Python inside cell formulas (`=PYUDF`), via `Runtime`, `setInterruptBuffer`, and the PyProxy value bridge.

pyproc becomes an SSOT only through **real imports**, not references: consumers pin a SHA, depend on the public surface plus the shipped `index.d.ts`, and never import in reverse. Full policy: [docs/consuming/contract.md](docs/consuming/contract.md).

## Development

```bash
npm test              # Node structure / lint gate (zero dependencies)
npm run test:consumer # installed package browser consumer gate
npm run test:browser  # headless Chromium runtime gate: boot / reactive / fork / map (zero dependencies)
npm run serve         # COOP/COEP static server for manual validation and benchmarks
```

Because this is a WASM runtime, real validation only happens in a browser: `test:browser` verifies the repo public surface, and `test:consumer` verifies an installed npm package inside a temporary browser app, including the Service Worker + `VirtualOrigin` URL path. Both run in CI. Operating docs live in [docs/](docs/README.md), design and decision records in [mainPlan/](mainPlan/README.md), contribution rules in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Mozilla Public License 2.0](LICENSE), the same license as Pyodide, the engine underneath. Copyright 2026 eddmpython.

MPL-2.0 is file-level copyleft, so the practical terms are: **embedding is free** (import pyproc into a closed-source app, ship it, sell it; your own code stays yours); **forks of pyproc itself stay open** (modify a covered file and you publish that file's source under MPL-2.0); **patents are granted** by every contributor for their contributions (Section 2.1(b)). Contributions are accepted under the same license without a separate CLA (inbound = outbound). See [CONTRIBUTING.md](CONTRIBUTING.md).
