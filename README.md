<p align="center">
  <img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="132" alt="pyproc">
</p>

<h1 align="center">pyproc</h1>

<p align="center"><b>A persistent Python computer in your browser.</b></p>

<p align="center">
  Open one Machine. Keep its workspace, environment, processes, and history; rewind it when work<br>
  goes wrong; carry it as a signed image. Real CPython, no application server required.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pyproc"><img src="https://img.shields.io/npm/v/pyproc?label=npm&color=5b8cff&labelColor=0a0f1c" alt="npm"></a>
  <a href="https://github.com/eddmpython/pyproc/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eddmpython/pyproc/ci.yml?branch=main&label=ci&labelColor=0a0f1c" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-7c4dff?labelColor=0a0f1c" alt="license MPL-2.0"></a>
  <img src="https://img.shields.io/badge/runtime_npm_dependencies-0-00d4c8?labelColor=0a0f1c" alt="zero runtime npm dependencies">
  <img src="https://img.shields.io/badge/CPython-3.14%20on%20WebAssembly-5b8cff?labelColor=0a0f1c" alt="CPython 3.14 on WebAssembly">
</p>

<p align="center">
  <a href="https://eddmpython.github.io/pyproc/"><b>Live demo</b></a> ·
  <a href="#product-model">Product model</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#using-it-from-an-ai-agent">AI-agent patterns</a> ·
  <a href="#feature-status">Status</a> ·
  <a href="README.ko.md">한국어</a>
</p>

---

<details>
<summary><b>Contents</b></summary>

- [The product](#the-product)
- [Product model](#product-model)
- [One machine lifecycle](#one-machine-lifecycle)
- [Where the Machine pays off](#where-the-machine-pays-off)
- [What the Machine delivers](#what-the-machine-delivers)
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
- [Dependency boundary](#dependency-boundary)
- [Setup](#setup)
- [Install and pinning](#install-and-pinning)
- [North Star](#north-star)
- [Development](#development)
- [License](#license)

</details>

## The product

pyproc is one product: **a persistent, browser-native Python computer**. It is not a bag of unrelated
runtime helpers. The public noun is `Machine`; execution, files, processes, durable history, images,
and permissions are parts of that machine.

The promise is simple: prepare Python once, keep the live state, branch or rewind it, survive a tab
closing, and move the machine as a verified file. The default product path is the Python Machine.
Linux, WASI, GPU, sockets, and MCP are optional guests or capabilities around the same contract, not
separate identities.

## Product model

| Product concept | Current contract | What it owns |
|---|---|---|
| **Machine** | `boot()` / `open()` | The single root handle and lifecycle |
| **Workspace** | named persistent machine + `/home/web` | Files and live work that survive reopening |
| **Environment** | deterministic manifest + exact engine version | Packages, setup, and replay boundary |
| **Processes** | `machine.proc()` | Independent worker interpreters, forks, signals, and parallel work |
| **History** | `machine.history` + persistent `machine.commit()` | Checkpoints, branches, restore, journal, and recovery |
| **Image** | signed `.pymachine` / `.webmachine` | Portable state with integrity and an explicit trust gate |
| **Permissions** | capability contracts + permission jail | Network, storage, devices, memory, and execution policy |

These are product concepts, not seven competing top-level APIs. A Machine remains the root, and its
verbs reveal only the capability being used. Internal engine objects stay behind that boundary.

## One machine lifecycle

```text
create / open  ->  work  ->  checkpoint / commit  ->  branch / restore  ->  export / reopen
      Machine      Workspace + Environment     History + Processes           Image + Trust
```

The library makes durable commits explicit. The first-party Web Computer automatically commits after
commands and also exposes manual Save, so automatic durability never hides the recovery boundary.
This is the default lifecycle every surface should reinforce.

```js
import { boot } from "pyproc";

const machine = await boot();
await machine.loadPackages(["numpy"]);   // prepare once (packages, data)
const cp = machine.history.checkpoint(); // save the prepared state

const attempts = [
  "import numpy as np; float(np.arange(10).men())",
  "import numpy as np; float(np.arange(10).mean())",
];

for (const code of attempts) {
  try {
    console.log(machine.run(code));      // 4.5 on the successful attempt
    break;
  } catch (error) {
    machine.history.restore(cp);         // prepared state is back
  }
}
```

`checkpoint` and `restore` move the interpreter state, not a serialized copy of selected variables.
The prepared environment returns without re-importing or reinstalling it.

## Where the Machine pays off

| Work | What happens | Why the Machine helps |
|---|---|---|
| AI data analysis | Run AI-written pandas / NumPy on the user's file | Analyze without shipping the raw file to a server |
| AI coding tools | Checkpoint before running AI code; restore on failure | Cheap trial-and-error, no environment reset |
| Multi-agent analysis | Branch many runs from one prepared state | Compare independent approaches in isolation |
| Browser notebooks | Keep packages and data loaded across runs | No re-boot, no re-install |
| Coding education | Save the student state; test AI fixes on a branch | Feedback without touching their work |
| Internal analytics | Process sensitive CSV / Excel in the local tab | Minimize sending data off-device |
| Offline tools | Cache the runtime and packages | Runs where the network is limited |

The common thread is one long-lived Python Machine that can be prepared once, saved, branched, and
restored. A fail-closed network policy can also keep selected data local while code runs.

## What the Machine delivers

- **Runs in the browser - no application server is required.** Python executes in the tab inside the
  Chromium renderer sandbox and WebAssembly boundary. Resource and network policy remain explicit;
  see [Security model](#security-model).
- **Restore without rebuilding.** Checkpoint a state with packages and data already loaded, then roll back to it - no re-run, no re-install.
- **Close the tab; keep the machine** (Experimental - `open({ persistent })`). Tabs share one logical Python state. If the leader closes, another tab recovers the last committed memory and `/home/web` files from OPFS and continues locally.
- **Branch from one state** (Beta - `machine.history` + `machine.proc()`). An agent runs several code candidates from the same prepared state, independently, and compares results.
- **Data can stay local under a fail-closed policy.** Process data in the tab and export only selected
  results. Local execution alone is not a no-exfiltration boundary.
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

const persistentMachine = await open({ persistent: { name: "workspace" } });
await persistentMachine.run("counter = globals().get('counter', 40) + 1");
await persistentMachine.commit();
console.log(await persistentMachine.run("counter")); // 41, including after leader takeover
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

**Pattern 3 - local-first data.** The user's file is analyzed in the tab; only the summary leaves. Apply a fail-closed CSP before agent code runs so it cannot open an external endpoint, and constrain what the trusted agent control channel returns.

```text
user file  ->  browser Python  ->  summary only  ->  AI model
```

## Plug it into an AI agent (MCP)

The repo ships an MCP server with no additional runtime npm packages. It exposes a persistent
pyproc Machine as
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
rebuilding the environment. Trusted engine boot finishes first; agent code then runs under a
fail-closed external-network CSP while same-origin MCP control traffic stays open. Self-host the
engine if boot itself must make no CDN request. Tool results intentionally cross the MCP channel, so
the calling application still owns output review and authorization. `npm run test:mcp` verifies the
full round trip and an `import js` / `fetch` exfiltration attempt against a controlled receiver in CI.

## Feature status

Honest maturity by browser-gate coverage. Everything below has a runtime gate; the label is how much to stake on it today.

| Area | Status |
|---|---|
| Python execution (`boot` / `run` / `loadPackages`) | Stable |
| Process OS: snapshot-fork spawn, `map` parallelism (`PyProc`) | Beta |
| Restore-based reactivity (`enableReactive`: checkpoint / time-travel) | Beta |
| In-kernel ASGI (`AsgiServer`) | Beta |
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
- Silent replay whose effect cannot be checked. A normal follower cannot inspect the leader's heap, so a sent call cut off by failover returns `PYPROC_RPC_OUTCOME_UNKNOWN` and is not resent. The narrow exception is a durable caller controller that can prove its own session is proxy-free: it parks the same request ID and asks the successor once, which answers from the recovered outcome record or runs against the recovered generation. Live-leader timeout and caller loss are never resent. See the [durable RPC state table](docs/consuming/contract.md#durable-rpc-state-table-normative).
- Every Python package - native C-extension wheels need a static build; pure-Python and Pyodide-built packages work.
- Snapshot compatibility across Pyodide versions. `.pymachine` portability assumes the same engine/manifest and either an explicit trusted source or a verified signer.
- GPU / native Linux packages, full POSIX `fork`, arbitrary native binaries.

## Scope and platform direction

pyproc is the persistent Python computer described in the [North Star](#north-star) above. Python is
the default Machine. The Web Machine host ships inside the package (`src/machine`, entered through
`createWebComputer`) and extends the same lifecycle to Linux: both guests can save memory and disks
together, recover after a browser-process restart, and open a signed image in a fresh browser profile.
The reproducible Buildroot Linux guest ships separately as a hash-pinned project release with source,
legal material, SBOM, configuration, and independent-build evidence. The x86 emulator and remaining
firmware stay externally supplied assets and are not part of npm.

Within that larger goal, Python reach remains unbounded: whatever Python runs locally should
eventually run in the browser without an application server. Everything local sorts into four
states, and pyproc's job is to push things up the list and absorb a wall when the platform reopens it:

- **Delivered** (browser-gated in CI today): pure-Python + Pyodide packages, multi-core processes, checkpoint / restore, in-kernel ASGI, terminal, persistent FS, portable `.pymachine` and `.webmachine` images.
- **Shipped without a headless CI gate**: `pyproc/socket` (outbound Python sockets need a WS-to-TCP relay this package does not ship) and `pyproc/gpu` (needs a real WebGPU adapter, which headless CI does not have). Both are opt-in subpaths you must verify inside your own product; the standing gap is tracked in [contract reality](docs/operations/contractReality.md).
- **Virtualized** (the browser way): a TCP `listen()` becomes an ASGI app, `os.fork` becomes worker kernels, outbound sockets ride a thin relay.
- **Upstream-pending** (walled now, reopenable): native C-extension wheels (Emscripten static builds / the WebAssembly component model), real threading.
- **Permanent web-security wall**: inbound connections and arbitrary native binaries need an external relay or agent.

The current gap map is the [capability matrix](docs/consuming/capabilityMatrix.md). The host architecture is the shipped [`src/machine`](src/machine/) contract, and its Dual-Boot evidence is registered in the executable [North Star ledger](tests/northStar.mjs) and the [Web Machine browser gates](tests/webMachine/).

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

Four primitives make it sound: complete heap hashing at each execution boundary (sampling would miss changes and corrupt a restore); deterministic boot (a byte-identical base, so only your delta has to travel); snapshot-fork; and an engine seam (the same primitives also run on non-Pyodide CPython 3.14, proving they don't depend on Pyodide internals). The persistent design lives in the [product direction](docs/product/vision.md) and [module boundaries](docs/operations/moduleBoundaries.md); the executable axis-by-axis gap map is [`tests/northStar.mjs`](tests/northStar.mjs).

## Where the shape pays off

pyproc is not "Python, but faster." It is Python with a process model, and the wins come from
the contract rather than from arithmetic: prepare state once and branch it, restore instead of
re-running, shard work across independent interpreters (N interpreters = N GILs = real
parallelism), serve from inside the tab, and move a live machine as a signed image.
Single-kernel NumPy is ordinary WebAssembly BLAS, and pyproc does not pretend otherwise.

Measure the envelope on your own hardware: run [Speed Lab](examples/speedLab.html) with
`npm run serve`. The measurement contract is in [benchmarking.md](docs/operations/benchmarking.md).

## Run the Web Computer

The multi-guest Web Computer surface extends the same Machine lifecycle to Python and Linux in one
browser workspace. Both guests have real memory and block-backed files, save into one durable
IndexedDB generation, recover after the browser process closes, and move together in a signed
`.webmachine` file. It proves that the Machine contract can host more than Python; it does not replace
the persistent Python Machine as pyproc's default product path.

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

## Dependency boundary

**Zero runtime npm dependencies is an exact package fact, not a claim that computers have no
dependencies.** pyproc owns the JavaScript runtime graph it publishes. A working Machine still rests
on an engine, browser primitives, and any explicitly enabled external capability.

| Layer | Current boundary | Can it be removed? |
|---|---|---|
| Runtime npm graph | No packages under `dependencies`; native ESM ships as source | Already zero |
| Python engine assets | Pyodide v314.0.2; CDN by default, self-hostable with SRI | The CDN dependency can be removed; the engine cannot be removed without replacing CPython |
| Browser platform | Chromium/Edge, WebAssembly, Workers, OPFS; JSPI and COOP/COEP for blocking/process paths | No; this is the hardware and security boundary |
| Optional capabilities | Relay for raw outbound sockets; WebGPU hardware; injected x86 emulator, firmware, and Linux image | Yes; omit the capability and the Python Machine remains complete |

The strongest deployment is therefore not an imaginary dependency-free computer. It is an
**owned and verified dependency chain**: pin the exact pyproc version, self-host the pinned engine,
emit and verify the asset SRI manifest, and cache verified assets in OPFS. The CDN route remains a
convenient evaluation path, not the production default.

## Setup

**Chromium / Edge only**, and the requirements are per capability rather than per package. Booting, running code, installing packages, and the whole of `machine.history` need nothing but the browser: no headers, no bundler configuration. JSPI (default since Chrome 137) is what the blocking paths need, and SharedArrayBuffer through COOP/COEP is what the process OS needs. `checkEnvironment()` reports exactly where a page stands, and each capability raises an actionable error rather than failing obscurely. Lack of Firefox / Safari support is a deliberate scope choice, not a defect. Full environment matrix (per-capability requirements, engine version, resource characteristics): [docs/consuming/compatibility.md](docs/consuming/compatibility.md).

There are two tiers of setup, so "just install and import" is true for the basics but not for everything:

| You want | You need | Engine assets |
|---|---|---|
| `boot` / `run` / packages, `machine.history` (checkpoint, time-travel) | `npm install` plus a Chromium browser. No headers. | Self-host the pinned Pyodide release for deployment; the default fetches `cdn.jsdelivr.net/pyodide/v314.0.2/full/` |
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
part of the published package); copy `node_modules/pyodide` or a release tarball into the path being
served. The pinned version is the package contract:
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
"dependencies": { "pyproc": "0.0.11" }
```

`pyproc/runtime` and the typed API subpath entries ship in 0.0.11. A SHA pin
(`github:eddmpython/pyproc#<commit-sha>`) remains the documented way to consume a commit that has
not been released. Full policy: [docs/consuming/contract.md](docs/consuming/contract.md).

You can also import straight from a CDN with no install (single-runtime path only; the process OS needs its worker file same-origin with your page):

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/npm/pyproc@0.0.11/index.js";
</script>
```

## North Star

**Make the browser a persistent computer, make Python its default Machine, and make that computer pyproc itself.**

Scores are anchored to gates that actually run in CI. A path no automated gate runs does not score, however complete the implementation is, and an axis whose evidence includes a manual-only probe is held below 9. A 10 means the axis is finished: repeatedly verified in a real browser, with no workaround left in the public surface.

Today that is **103.0 / 120, average 8.6 / 10**.

| Axis | Score | Where it stands today | Where it has to land | Next move |
|---|---:|---|---|---|
| Real Python in the tab | 9.5 | `boot` / `run` / `loadPackages` drive CPython on WebAssembly from one handle, with a terminal REPL, PEP 723 scripts, a wheel cache, and a declared-environment lane. The browser gate, the installed-package gate, the demo gate, and the agent (MCP) gate all run it. Engine assets come from a CDN unless you self-host, and the platform is Chromium and Edge only. | The Python a local interpreter runs, running in a tab, with no server and no setup ritual. | Make the verified self-hosted asset lane the default path, so a first boot depends on no CDN |
| State you can rewind | 9.0 | Checkpoint, restore, branch, and prune run at execution boundaries over complete heap hashing: a full-heap byte-equality round trip, sibling-delta isolation across a branch tree, and a violated boundary that falls back to a full rehash instead of restoring something corrupt. Node property and fuzz gates cover delta soundness and tree integrity. An arbitrary instant is still not capturable, because in-flight promises and network requests live outside the boundary. | Any past state comes back instantly, including the work that was in flight when it was left. | Capture an arbitrary instant rather than an execution boundary, by pulling in-flight promises and requests inside the boundary |
| Processes and real parallelism | 8.5 | Workers are processes: snapshot-fork spawn, `map`, `forkMany`, a signal table, kill, job control, nested containers, pool exhaustion, and mid-flight worker death all converge under the browser gate. N interpreters are N GILs, so the parallelism is structural rather than scheduled. There is no shared-memory threading and no arbitrary POSIX process tree. | A process model with the vocabulary of a real operating system, threads included once the platform allows them. | Take shared-memory threading the moment nogil and WASM threads land upstream, without changing the process vocabulary |
| A disk that survives | 9.0 | The state kernel commits content-addressed generations into OPFS under a write-order law: a tampered blob is caught, a broken HEAD falls back to PREV instead of impersonating a first boot, journals pack, an unchanged re-commit writes zero bytes, and the durable generation is what the browser computer restores after its process restarts. There is exactly one format on disk now: the legacy envelope reader was retired, and a file written by an older version is refused with what to do about it rather than half-read. | Durability with the guarantees of a real filesystem: no torn commit, no silent loss, exactly one format. | Survive an OPFS quota eviction as explicitly as a torn commit: today persistence is requested best-effort and a denial is a browser heuristic |
| A machine that outlives its tab | 9.5 | One logical machine spans same-origin tabs through leader election: a forcibly removed leader is taken over, followers commit through the leader, and the committed heap and `/home/web` cold-reopen after every participant closes, all of it exercised on the installed package. The leader records command outcomes in the same durable generation as the heap, so a repeated request ID is answered from the record instead of run twice, and a durable caller controller that can prove its session proxy-free parks and asks the successor once. The installed-package path also fixes the honest boundary: a normal follower cannot inspect the leader session, so its in-flight call ends as `PYPROC_RPC_OUTCOME_UNKNOWN` on failover and is not resent. Live-leader timeout, non-durable state, caller loss, and a known proxy heap are never resent. The complete rule is the [durable RPC state table](docs/consuming/contract.md#durable-rpc-state-table-normative). | The machine keeps running while any tab is open, and every command it accepted resolves exactly once. | Carry a fenced portability fact to ordinary followers so they can safely use the outcome-record path; a proxy-bearing heap remains outcome-unknown |
| A machine you can carry | 9.0 | `.pymachine` and `.webmachine` files are signed content-addressed envelopes: signature and trusted-key verification, byte-tamper rejection, layout-independent reparse, worker-to-worker revival, and a cross-context transport refused on an `h0` mismatch instead of opened silently. The product gate exports a signed image and imports it into a fresh browser profile behind an explicit signer trust screen. Portability still assumes the same engine and manifest. A JS proxy handle cannot cross an image at all, so a surface that installs one poisons every proxy path in the revived kernel; the packet device and the permission jail were moved to value boundaries and survive a revival in CI, while a blocking surface (the syscall bridge behind input(), sockets, GPU) cannot move and is refused at export unless the caller acknowledges it. | A machine file opens on any compatible profile from a verified signer, across engine versions. | Rebind JS handles after materialisation, or find a blocking mechanism that needs none, so a machine that used input() can still ship a portable image; Open an image across engine versions by negotiating the manifest instead of demanding an exact match |
| A computer that boots guests | 9.0 | The Web Machine host ships inside this package behind `createWebComputer`, and a Python guest and an x86 Linux guest consume the same lifecycle, device, generation, and envelope contracts. Host contract, dual-engine, owner succession, durable generation, and guest-network probes run in CI, and the product gate boots both guests, survives a browser-process restart, and moves the pair as one signed image. The x86 lane puts the real Python and Linux guests on one switch: Linux pings Python, a Python-sent Ethernet frame increments Linux's NIC receive counter, and both directions survive one generation commit and a process cold restore. A guest can also be hosted in its own worker (`pyproc-worker`), so a CPU-bound guest no longer stalls the others. Presenting a frame onto a canvas is gated in CI as well (`CanvasRgbaFrameSink`). The default Linux image is the reproducible project build, hash-pinned to a release that carries its exact source, complete legal material, SBOM, config, and independent-build receipt. | Any guest with an adapter boots on the browser computer, and its image ships as freely as the host does. | rung 5: Adopt memory64 to lift the per-module heap ceiling that a large guest hits first; rung 7: Boot a Node guest beside Python and Linux, making JavaScript CLI tools residents of the computer |
| Primitives that outlive the engine | 7.0 | A non-Pyodide lane boots CPython 3.14.6 on WASI in the browser and takes checkpoint, time travel, repeated branching, and pure-Python wheel installation through the same contracts, which is what proves the primitives are not Pyodide internals. That lane has no `dlopen`, so it carries no dynamic C extensions, and its value bridge is JSON only. | Every primitive runs on any CPython-on-WebAssembly engine, with the same package reach on each. | Close the WASI gap: dynamic linking (cpython#142234) for C extensions, and a value bridge that is not JSON only |
| Network, the browser way | 8.0 | An in-kernel ASGI server answers `fetch` from Python with concurrent requests kept apart, a virtual origin serves it from the installed package, `urllib` performs real HTTP through the syscall bridge, and the permission jail decides `connectSrc` per host. Python-to-Python traffic is gated without assets, while the x86 lane proves the real cross-engine path: Linux pings Python and a Python-sent Ethernet frame arrives at the Linux NIC before and after process cold restore. Outbound raw sockets still need a WS-to-TCP relay this package does not ship, but a hermetic lane starts the in-repo relay and a local TCP origin and reads bytes back through Python `urllib`. | Python network code runs unmodified, and the relay boundary is the only thing a reader has to know. | rung 1: Terminate TLS inside the tab, so a relay carries ciphertext it cannot read and needs no trust; rung 2: Carry many sockets over one WebSocket, the Wisp class of relay hardening; rung 3: Open a direct tab-to-tab transport over WebRTC as an opt-in subpath, once the surface freeze clears; rung 4: Keep an Isolated Web App packaging lane ready for the day Direct Sockets opens a real inbound listen |
| Everything local Python does | 7.5 | Pyodide's `dlopen` already loads native C-extension wheels (numpy, pandas, scipy and more), packages install from a cache, `%pip` and `freeze` work inside the machine, and the WASI lane installs pure-Python wheels. The long tail is what is missing: an arbitrary package needs a published pyemscripten wheel, numpy has no SIMD build, threading is upstream-pending, and the GPU lane has no headless adapter, so what CI holds is the byte identity of the WGSL each integration path compiles, not its result on a GPU. | Whatever runs in a local interpreter runs in the tab, at a speed that needs no apology. | Widen package reach where it is thin: a pyemscripten wheel for the long tail, and a SIMD numpy build; rung 6: Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real |
| One stable kernel surface | 8.5 | The public surface is one noun and its verbs, fixed by structure, types, installed-package gates, and real browser execution. The packed artifact proves root and subpath imports, shipped declarations, worker emission, and runtime assets without any package-internal path. | One exact-version public surface and shipped type contract, with every supported import pattern gated and no deep path. | Put every supported public import pattern under installed-package and browser gates; rung 8: Specify the local-agent boundary once (pairing, authorization, capability list) for the share that stays outside the browser |
| A supply chain you can verify | 8.5 | The asset CLI emits SRI over the worker and Service Worker import graph, `verifyPyProcAssetIntegrity` refuses a spawn on a bad hash, engine boot supports fail-closed SRI with a re-verifying offline cache, npm releases publish through OIDC trusted publishing with provenance and manual publishes disabled, and the browser computer verifies a signer before importing an image. The default Linux guest comes from two byte-identical independent builds, passes real Python-Linux traffic plus process cold restore, and is published with exact source, complete legal material, SBOM, config, and manifests at a stable hash-pinned project release. | Every byte that executes traces back to a source somebody else can rebuild and verify. | Reproduce the remaining firmware and emulator assets under the same project-controlled release discipline |

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
8. Specify the local-agent boundary once (pairing, authorization, capability list) for the share that stays outside the browser (moves: One stable kernel surface)

Why the order is what it is, and the external triggers that would reorder it, are in the [product direction](docs/product/vision.md#where-the-ceiling-moves-next). The rungs are registered in the axis ledger, so a rung cannot drift away from the score it claims to move.

## Development

```bash
npm test              # Node structure / lint gate (no runtime npm dependencies)
npm run test:installed # installed package browser gate
npm run test:browser  # headless Chromium runtime gate: boot / reactive / fork / map (no runtime npm dependencies)
npm run serve         # COOP/COEP static server for manual validation and benchmarks
```

Because this is a WASM runtime, real validation only happens in a browser: `test:browser` verifies the repo public surface, and `test:installed` verifies an installed npm package inside an isolated browser fixture, including the Service Worker + `VirtualOrigin` URL path. Both run in CI. Persistent product and operating decisions live in [docs/](docs/README.md), executable truth lives in `src/` and `tests/`, historical decisions remain in git history, and contribution rules live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Mozilla Public License 2.0](LICENSE), the same license as Pyodide, the engine underneath. Copyright 2026 eddmpython.

MPL-2.0 is file-level copyleft, so the practical terms are: **embedding is free** (import pyproc into a closed-source app, ship it, sell it; your own code stays yours); **forks of pyproc itself stay open** (modify a covered file and you publish that file's source under MPL-2.0); **patents are granted** by every contributor for their contributions (Section 2.1(b)). Contributions are accepted under the same license without a separate CLA (inbound = outbound). See [CONTRIBUTING.md](CONTRIBUTING.md).
