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
  <a href="#product-entrances">Entrances</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://eddmpython.github.io/pyproc/"><img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/demoReel.svg" width="760" alt="pyproc demo reel: a Python machine keeps its state after its tab is killed, and rewinds its history with checkpoint and restore"></a>
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
- [Product entrances](#product-entrances)
- [Using it from an AI agent](#using-it-from-an-ai-agent)
- [Plug it into an agent (MCP)](#plug-it-into-an-agent-mcp)
- [Capability contract](#capability-contract)
- [What it guarantees, and what it doesn't](#what-it-guarantees-and-what-it-doesnt)
- [Scope and platform direction](#scope-and-platform-direction)
- [Security model](#security-model)
- [How it works (one page)](#how-it-works-one-page)
- [Where the shape pays off](#where-the-shape-pays-off)
- [Run the Web Computer](#run-the-web-computer)
- [Capability paths](#capability-paths)
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
| **Machine** | `open()` by default; `boot()` for an explicit transient kernel | The single durable root and lifecycle |
| **Workspace** | `open({ name })` + `/home/web` | Files and live work that survive reopening |
| **Environment** | deterministic manifest + exact engine version | Packages, setup, and replay boundary |
| **Processes** | `machine.proc()` | Independent worker interpreters, forks, signals, and parallel work |
| **History** | automatic Machine generations + explicit transient checkpoints | Checkpoints, branches, restore, journal, and recovery |
| **Image** | signed `.pymachine` / `.webmachine` | Portable state with integrity and an explicit trust gate |
| **Permissions** | capability contracts + permission jail | Network, storage, devices, memory, and execution policy |

These are product concepts, not seven competing top-level APIs. A Machine remains the root, and its
verbs reveal only the capability being used. Internal engine objects stay behind that boundary.

## One machine lifecycle

```text
create / open  ->  work  ->  checkpoint / commit  ->  branch / restore  ->  export / reopen
      Machine      Workspace + Environment     History + Processes           Image + Trust
```

The default Machine commits each completed command before its Promise settles. `commit()` remains a
force-boundary verb, while `boot()` is the explicit transient workbench for checkpoint and branching
experiments. A commit failure is outcome-unknown and never invites an automatic retry.

For an explicit transient rewind session:

```js
import { boot } from "pyproc";

const machine = await boot();
await machine.loadPackages(["numpy"]);   // prepare once (packages, data)
const cp = machine.history.checkpoint(); // save the prepared state

const attempts = [
  "import numpy as np; float(np.arange(10).men())", // deliberate failing attempt
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
- **Close the tab; keep the machine** (`open()` / `open({ name })`). Tabs share one logical Python state. Every completed command auto-commits memory, `/home/web`, and forwarded outcomes before returning; if the leader closes, another tab recovers that generation from OPFS and continues locally.
- **Branch from one state** (`machine.history` + `machine.proc()`). An agent runs several code candidates from the same prepared state, independently, and compares results.
- **Data can stay local under a fail-closed policy.** Process data in the tab and export only selected
  results. Local execution alone is not a no-exfiltration boundary.
- **Isolated execution.** Python runs off the main UI thread, across multiple workers you manage.

## Quick start

```sh
npm install pyproc@0.0.16 --save-exact
npx pyproc-engine --out public/vendor/pyodide
```

```js
import { open } from "pyproc";

const machine = await open();
console.log(await machine.run("sum(range(1_000_000))")); // 499999500000
```

Name a Machine to open the same workspace from any number of same-origin tabs:

```js
import { open } from "pyproc";

const persistentMachine = await open({ name: "workspace" });
await persistentMachine.run("counter = globals().get('counter', 40) + 1");
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

Branch and adopt. The durable Machine speaks git's verbs about execution state: commit competing
states to named branches, record why in a provenance note that lives in the commit itself, and adopt
the winner. Heap states cannot be merged, so the consuming verb is `adopt`, not merge:

```js
const m = await open({ name: "lab", milestones: { keep: 7 } });
await m.run("model = trainStep({})");
await m.branch("adamRun", { note: { attempt: "adam", lr: 0.001 } });
await m.run("model = trainStep({'optimizer': 'sgd'})");
await m.branch("sgdRun", { note: { attempt: "sgd" } });
await m.adopt("adamRun", { note: { reason: "validation passed" } }); // its state is now HEAD
await m.adopt("auto-2026-08-05");                                    // or go back to yesterday
```

`branches()` lists every branch with its fork parent and note, so the whole decision - what was
tried, what judged, what won - reads back as history. With `milestones: { keep }`, every day gets an
`auto-<date>` branch pointing at that day's last commit at no extra state cost. On transient
machines, `machine.history.attempts([codes])` races candidates from one base with the heap rewound
in between, so a failing candidate cannot contaminate the next; the
[Machine demo](examples/machine.html) runs that race live.

> The basics above need only a Chromium browser. `PyProc` (process OS) and sockets also need `crossOriginIsolated` (`COOP: same-origin`, `COEP: require-corp`) and same-origin workers - see [Setup](#setup). Run `checkEnvironment()` to check.

## Product entrances

Import from `pyproc`. That root is the complete product entrance; subpaths are advanced plumbing, not competing products.

| You need | Root entry | Returned handle and capability path |
|---|---|---|
| The durable Python Machine | `open()` or `open({ name })` | `KernelElection`: async `run`, automatic durable commit, status, failover, and cold reopen |
| A transient Python Machine | `boot()` | `PyprocMachine`: `run`, `fs`, `history`, `term`, `proc`, and the advanced `runtime` escape hatch |
| A portable or saved transient Machine | `open(blob, trust)` or `open({ dir, name })` | `PyprocMachine` after the source-specific integrity, trust, and replay checks |
| A multi-guest browser computer | `createWebComputer()` | `WebComputer`: guest lifecycle, shared devices, durable generations, and signed computer images |
| Platform readiness | `checkEnvironment()` | Structured capability report with actionable issues |
| Programmatic failure handling | `PyProcError`, `PYPROC_ERROR_CODES` | One error-code contract shared by every root path |

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

**Pattern 2 - compete, verify, adopt.** Load shared data once, then race candidate solutions from
the same prepared state with `history.attempts([...])`: each candidate is checkpointed as a sibling
branch and the heap is rewound in between, so a failing candidate cannot contaminate the next. Judge
each end state with a Python assertion, `adopt` the winner, and commit it to a named durable branch
whose note records what was tried and why it won - the agent's solution path becomes first-class
history, not chat-log archaeology.

```text
load data + packages
        |-- pandas approach   -> judge
        |-- SQL approach      -> judge
        \-- NumPy approach    -> judge  ->  adopt the winner (note: what ran, what judged, what won)
```

**Pattern 3 - local-first data.** The user's file is analyzed in the tab; only the summary leaves. Apply a fail-closed CSP before agent code runs so it cannot open an external endpoint, and constrain what the trusted agent control channel returns.

```text
user file  ->  browser Python  ->  summary only  ->  AI model
```

## Plug it into an agent (MCP)

The npm package ships a stable `pyproc-mcp` command with no runtime dependency. It starts a persistent
Python Machine and, only when the manifest enables it, a separately scoped Chrome, Chromium, or Edge
automation profile.

```sh
npm install pyproc
npx pyproc-engine --out /absolute/path/to/pyodide
```

Create `pyproc-mcp.json`, using exact origins and the smallest action set required:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/pyodide" },
  "browser": {
    "enabled": true,
    "provider": "nativeCdp",
    "allowedOrigins": ["https://example.test"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "screenshot", "waitFor", "hydrateLazy", "navigate", "fill", "click"],
    "methods": [],
    "viewport": { "width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": true, "touch": true },
    "externalEffects": "acknowledged",
    "purpose": "authorized regression testing"
  }
}
```

Validate the engine, browser, limits, and permissions before registering the same command with an MCP
client:

```sh
npx pyproc-mcp --config ./pyproc-mcp.json --check
npx pyproc-mcp --config ./pyproc-mcp.json
```

Native clients use the same manifest and product host through the language-neutral Control Protocol:

```sh
npx pyproc-control --config ./pyproc-mcp.json --check
npx pyproc-control --config ./pyproc-mcp.json
```

This entrance reserves stdout for strict NDJSON. It provides single-use request IDs, one terminal per request,
pre-delivery cancellation, honest post-delivery `outcomeUnknown`, and SHA-256 verified binary attachments.
See the [Control Protocol v1 guide](docs/usage/controlProtocol.md) for the wire and operation contract.

Python applications use the official zero-dependency SDK without writing JavaScript:

```python
from pyprocControl import PyProcClient

with PyProcClient.start("pyproc-mcp.json") as client:
    print(client.runPython("40 + 2").output["value"])
```

The [Python SDK guide](docs/usage/pythonSdk.md) covers installation, checkpoint recovery, cancellation,
browser actions, and verified screenshot bytes.

With `{ "enabled": false }`, the server exposes exactly four Python tools: `pythonRun`, `checkpointSave`,
`checkpointRestore`, and `sandboxReset`. Enabling the browser adds ten tools for lifecycle, compatibility,
semantic observation, ordered actions, separately allowlisted raw commands, and artifact read/delete.

Set `"provider": "frame"` for a cooperative credentialless sandbox that opens no DevTools port. It exposes
nine browser tools when snapshot is allowed, omits raw commands, and requires the target to load the shipped
bridge. See the [FrameSpace guide](docs/usage/frameSpace.md) for its exact isolation and screenshot boundary.

Add `browser.recording` to persist a hash-chained authorized journey, then select `"provider": "replay"` to
return the same verified terminals and content-addressed screenshot sidecars without sending browser effects.
Replay requires independently stored recording identity and final-digest pins; cursor plus prefix digest resumes
a recorded suffix next to a Python checkpoint. See the
[ReplaySpace guide](docs/usage/replaySpace.md).

The 23-action catalog includes semantic readiness waits, explicit bounded lazy hydration, and a first-class
ordered `screenshot` action. `browserOpen` applies the viewport before navigation and returns the redacted
first-navigation trace. Screenshot results that fit the inline bound arrive as native MCP image content at
the viewport, full-page, or clip boundary. Screenshots and downloads enter one broker-owned artifact store
with an opaque ref, SHA-256, byte and count quotas, bounded chunk reads, TTL expiry, explicit deletion, and
shutdown cleanup. Larger images keep the artifact and chunk fallback without forcing base64 into text.

Origins, actions, and raw methods are separate exact allowlists. Risk is fixed by the broker. The caller
cannot label `Runtime.evaluate`, navigation, or click as read-only. The broker owns the CDP endpoint, uses a
new temporary profile, returns only opaque target, session, locator, and artifact references, and opens no
additional proxy listener. It supports Chromium-family major 137 or newer with CDP protocol major 1.

Python restore never rolls back a browser mutation, navigation, storage change, download, popup, or external
request. A command cut off after send is `outcomeUnknown` and is never retried automatically. The product
does not provide default-profile attachment, CAPTCHA bypass, stealth, credential harvesting, or legal
authorization to automate a site. The operator owns site permission and consequential-action approval.

See the [browser automation product guide](docs/usage/browserAutomation.md) for the complete manifest,
artifact, action, security, and recovery contracts. `npm run test:mcp-product` packs and installs the package,
then verifies the bin, Python persistence, ordered PNG/JPEG/WebP capture, chunk reconstruction, digest, and
deletion in a real browser. `npm run test:control-product` verifies the same installed host through native
NDJSON, including cancellation and a binary PNG attachment. Chrome on Ubuntu and Edge on Windows run both
gates in CI.

## Capability contract

These states measure only pyproc's own invariants. They never depend on adoption, user count, another repository, release age, or market response. `Complete` means the declared path, failure, and recovery contract is browser-gated through the installed package; `Bounded` means the listed ability works inside an explicit intrinsic boundary; `Probe` is an opt-in mechanism outside the default entrance.

| Area | Contract state |
|---|---|
| Python execution (`boot` / `run` / `loadPackages`) | Complete |
| Default durable Machine (`open()` / `open({ name })`) | Complete |
| Process OS, restore reactivity, ASGI, declared environments, terminal, machine images, and journal | Bounded |
| Device FS, permission jail, GPU, and sockets | Probe |
| Installed MCP browser automation and artifact product | Bounded |
| non-Pyodide CPython 3.14 (`bootWasi` / `WasiSession`) | Engine proof |

## What it guarantees, and what it doesn't

**Guaranteed (browser-measured):**

- Pyodide-based Python on supported browsers.
- WASM heap state saved at declared execution boundaries.
- State restore under the recorded engine and manifest contract.
- Worker-based execution isolation.

**Not (yet) guaranteed:**

- Full process capture at an arbitrary instant - in-flight network requests and Promises are not restored.
- Silent replay whose effect cannot be checked. A normal follower cannot inspect the leader's heap, so a sent call cut off by failover returns `PYPROC_RPC_OUTCOME_UNKNOWN` and is not resent. The narrow exception is a durable caller controller that can prove its own session is proxy-free: it parks the same request ID and asks the successor once, which answers from the recovered outcome record or runs against the recovered generation. Live-leader timeout and caller loss are never resent. See the [durable RPC state table](docs/usage/contract.md#durable-rpc-state-table-normative).
- Every Python package - native C-extension wheels need a static build; pure-Python and Pyodide-built packages work.
- Cross-version snapshot loading. `.pymachine` portability requires the recorded engine/manifest and either an explicit trust decision or a verified signer; mismatches fail closed.
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

The current gap map is the [capability matrix](docs/usage/capabilityMatrix.md). The host architecture is the shipped [`src/machine`](src/machine/) contract, and its Dual-Boot evidence is registered in the executable [North Star ledger](tests/northStar.mjs) and the [Web Machine browser gates](tests/webMachine/).

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

## Capability paths

Start from the [Product entrances](#product-entrances) table. Capabilities below those handles are opt-in; use their contracts rather than engine internals (`HEAPU8` and friends). The full intrinsic capability table lives in the [capability matrix](docs/usage/capabilityMatrix.md).

Plumbing subpaths carry the contracts underneath the handle:

```js
// The advanced engine seam when you boot Pyodide yourself and hand the instance to pyproc.
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

The function-level reference is [docs/reference/api.md](docs/reference/api.md) (English); this README stays the map. [docs/usage/](docs/usage/contract.md), [docs/reference/](docs/reference/api.md), and [docs/product/](docs/product/vision.md) are English; `docs/operations/` is the internal operating tree and stays Korean. For product decisions by capability, use the [capability matrix](docs/usage/capabilityMatrix.md): it maps each public export to value, status, setup, runnable surfaces, gates, and boundaries.

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
| Python engine assets | Pyodide v314.0.2 at the verified same-origin `/vendor/pyodide/` default | Third-party delivery is absent by default; the engine itself cannot be removed without replacing CPython |
| Browser platform | Chromium/Edge, WebAssembly, Workers, OPFS; JSPI and COOP/COEP for blocking/process paths | No; this is the hardware and security boundary |
| Optional capabilities | Relay for raw outbound sockets; WebGPU hardware; injected x86 emulator, firmware, and Linux image | Yes; omit the capability and the Python Machine remains complete |

The strongest deployment is therefore not an imaginary dependency-free computer. It is an
**owned and verified dependency chain**: pin the exact pyproc version, prepare the pinned engine with
`pyproc-engine`, emit and verify the JavaScript asset SRI manifest, and cache verified assets in
OPFS. An explicit CDN `indexURL` remains an evaluation route, never the default.

## Setup

**Chromium / Edge only**, and the requirements are per capability rather than per package. Booting, running code, installing packages, and the whole of `machine.history` need nothing but the browser: no headers, no bundler configuration. JSPI (default since Chrome 137) is what the blocking paths need, and SharedArrayBuffer through COOP/COEP is what the process OS needs. `checkEnvironment()` reports exactly where a page stands, and each capability raises an actionable error rather than failing obscurely. Lack of Firefox / Safari support is a deliberate scope choice, not a defect. Full environment matrix (per-capability requirements, engine version, resource characteristics): [docs/usage/platformRequirements.md](docs/usage/platformRequirements.md).

There are two tiers of setup, so "just install and import" is true for the basics but not for everything:

| You want | You need | Engine assets |
|---|---|---|
| `open` / `run`, or transient `boot` / packages / `machine.history` | `npm install`, `npx pyproc-engine --out <static-root>/vendor/pyodide`, and Chromium. No headers. | The verified same-origin `/vendor/pyodide/` distribution |
| `machine.proc()` (fork, `map`, interrupt), IPC, blocking sockets | The two headers below, plus **same-origin worker files** (so npm install / vendoring, not CDN import) | Same, and the worker file must be same-origin |

**Engine assets are prepared at deployment, not embedded in the npm tarball.** The published
`pyproc-engine` CLI downloads the exact release, verifies the six boot anchors against pyproc's
catalog, then verifies all package files against the pinned lock before placing them under the
default `/vendor/pyodide/` URL.

```sh
npx pyproc-engine --out public/vendor/pyodide
```

```js
// The default verifies pyodide.js plus fetched core bytes from /vendor/pyodide/.
await boot();
// Optionally cache the verified core in OPFS so later boots do no network at the fetch layer.
await boot({ coreCacheDir: await navigator.storage.getDirectory() });
// Evaluation only: opt into a different distribution point explicitly.
await boot({ indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/" });
```

The default runtime re-verifies core bytes as they are fetched. Custom engine loaders own their own
trust policy. The pinned version and distribution boundary are the package contract:
[docs/usage/contract.md](docs/usage/contract.md).

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

From npm ([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)): `npm install pyproc@0.0.16 --save-exact`. There is no build step (native ESM). Floating ranges (`^`, `~`, `latest`) are not supported because a state kernel's replay guarantee is version-bound:

```jsonc
// package.json
"dependencies": { "pyproc": "0.0.16" }
```

`pyproc/runtime` and the typed API subpath entries ship in 0.0.11. A SHA pin
(`github:eddmpython/pyproc#<commit-sha>`) remains the documented way to consume a commit that has
not been released. Full policy: [docs/usage/contract.md](docs/usage/contract.md).

## North Star

**Make the browser a persistent computer, make Python its default Machine, and make that computer pyproc itself.**

Scores measure only capabilities and invariants pyproc owns. Adoption, user counts, release age, other repositories, and market response never score. A path no automated gate runs does not score, and an axis with manual-only evidence stays below 9. A 10 means the capability is complete: repeatedly verified in a real browser, with no workaround left in the public surface.

Today that is **105.5 / 120, average 8.8 / 10**.

| Axis | Score | Where it stands today | Where it has to land | Next move |
|---|---:|---|---|---|
| Real Python in the tab | 9.7 | `open` is the durable Machine and `boot` is the transient workbench; both drive CPython on WebAssembly. The pinned engine is prepared by the shipped zero-dependency CLI, served from the same origin, checked against catalog and lock hashes, then core-verified again in the browser with zero third-party requests. Browser, installed-package, demo, and agent gates run it. The platform is Chromium and Edge only. | The Python a local interpreter runs, running in a tab, with no server and no setup ritual. | Broaden the browser platform without weakening the Machine contract or hiding unavailable capabilities |
| State you can rewind | 9.3 | Checkpoint, restore, branch, and prune run at execution boundaries over complete heap hashing: a full-heap byte-equality round trip, sibling-delta isolation across a branch tree, and a violated boundary that falls back to a full rehash instead of restoring something corrupt. History is a first-class value beyond the session: named durable branches with provenance notes, adopt as the consuming verb (heap states cannot merge), serial attempts that race candidate solutions without contamination, and daily auto milestones that make going back to yesterday one verb - on the single-controller journal and on the elected durable machine through the same exactly-once command pipeline. Node property and fuzz gates cover delta soundness, tree integrity, and ref-protocol branch laws. An arbitrary instant is still not capturable, because in-flight promises and network requests live outside the boundary. | Any past state comes back instantly, including the work that was in flight when it was left. | Capture an arbitrary instant rather than an execution boundary, by pulling in-flight promises and requests inside the boundary |
| Processes and real parallelism | 8.5 | Workers are processes: snapshot-fork spawn, `map`, `forkMany`, a signal table, kill, job control, nested containers, pool exhaustion, and mid-flight worker death all converge under the browser gate. N interpreters are N GILs, so the parallelism is structural rather than scheduled. There is no shared-memory threading and no arbitrary POSIX process tree. | A process model with the vocabulary of a real operating system, threads included once the platform allows them. | Take shared-memory threading the moment nogil and WASM threads land upstream, without changing the process vocabulary |
| A disk that survives | 9.0 | The state kernel commits content-addressed generations into OPFS under a write-order law: a tampered blob is caught, a broken HEAD falls back to PREV instead of impersonating a first boot, journals pack, an unchanged re-commit writes zero bytes, and the durable generation is what the browser computer restores after its process restarts. There is exactly one format on disk now: the legacy envelope reader was retired, and a file written by an older version is refused with what to do about it rather than half-read. | Durability with the guarantees of a real filesystem: no torn commit, no silent loss, exactly one format. | Survive an OPFS quota eviction as explicitly as a torn commit: today persistence is requested best-effort and a denial is a browser heuristic |
| A machine that outlives its tab | 9.7 | Argument-free `open()` now enters the named OPFS Machine rather than a transient kernel. Commands and commits are serialized, and every completed run reaches a generation carrying heap, `/home/web`, and forwarded outcome before settling; the installed package cold-reopens that state without a manual commit. Leader election spans same-origin tabs, a repeated request ID is answered from its durable record, and commit failure is non-retryable outcome-unknown. A normal follower still cannot prove a cut-off leader heap portable, so failover of an in-flight call remains `PYPROC_RPC_OUTCOME_UNKNOWN`. The complete rule is the [durable RPC state table](docs/usage/contract.md#durable-rpc-state-table-normative). | The machine keeps running while any tab is open, and every command it accepted resolves exactly once. | Carry a fenced portability fact to ordinary followers so they can safely use the outcome-record path; a proxy-bearing heap remains outcome-unknown |
| A machine you can carry | 9.0 | `.pymachine` and `.webmachine` files are signed content-addressed envelopes: signature and trusted-key verification, byte-tamper rejection, layout-independent reparse, worker-to-worker revival, and a cross-context transport refused on an `h0` mismatch instead of opened silently. The product gate exports a signed image and imports it into a fresh browser profile behind an explicit signer trust screen. Portability still assumes the same engine and manifest. A JS proxy handle cannot cross an image at all, so a surface that installs one poisons every proxy path in the revived kernel; the packet device and the permission jail were moved to value boundaries and survive a revival in CI, while a blocking surface (the syscall bridge behind input(), sockets, GPU) cannot move and is refused at export unless the caller acknowledges it. | A machine file verifies and revives offline in a clean profile under one explicit execution contract; every mismatch is rejected with an actionable error. | Rebind JS handles after materialisation, or find a blocking mechanism that needs none, so a machine that used input() can still ship a portable image; Prove offline signed-image revival in a clean browser profile while rejecting every engine or manifest mismatch |
| A computer that boots guests | 9.0 | The Web Machine host lives inside this package behind `createWebComputer`, and Python and x86 Linux guests use the same lifecycle, device, generation, and envelope contracts. Host contract, dual-engine, owner succession, durable generation, and guest-network probes run in CI, and the product gate boots both guests, survives a browser-process restart, and moves the pair as one signed image. The x86 lane puts the real Python and Linux guests on one switch: Linux pings Python, a Python-sent Ethernet frame increments Linux's NIC receive counter, and both directions survive one generation commit and a process cold restore. A guest can also run in its own worker (`pyproc-worker`), so a CPU-bound guest no longer stalls the others. The reproducible Linux build is checked against exact source, legal inventory, SBOM, config, and an independent byte-identical build receipt. | Any guest with an adapter boots on the browser computer, and its image ships as freely as the host does. | rung 5: Enable memory64 once the engine contract can prove it, lifting the per-module heap ceiling a large guest hits first; rung 7: Boot a Node guest beside Python and Linux, making JavaScript CLI tools residents of the computer |
| Primitives that outlive the engine | 7.0 | A non-Pyodide lane boots CPython 3.14.6 on WASI in the browser and takes checkpoint, time travel, repeated branching, and pure-Python wheel installation through the same contracts, which is what proves the primitives are not Pyodide internals. That lane has no `dlopen`, so it carries no dynamic C extensions, and its value bridge is JSON only. | Every primitive runs on any CPython-on-WebAssembly engine, with the same package reach on each. | Close the WASI gap: dynamic linking (cpython#142234) for C extensions, and a value bridge that is not JSON only |
| Network, the browser way | 8.0 | An in-kernel ASGI server answers `fetch` from Python with concurrent requests kept apart, a virtual origin serves it from the installed package, `urllib` performs real HTTP through the syscall bridge, and the permission jail decides `connectSrc` per host. Python-to-Python traffic is gated without assets, while the x86 lane proves the real cross-engine path: Linux pings Python and a Python-sent Ethernet frame arrives at the Linux NIC before and after process cold restore. Outbound raw sockets still need a WS-to-TCP relay this package does not ship, but a hermetic lane starts the in-repo relay and a local TCP origin and reads bytes back through Python `urllib`. | Python network code runs unmodified, and the relay boundary is the only thing a reader has to know. | rung 1: Terminate TLS inside the tab, so a relay carries ciphertext it cannot read and needs no trust; rung 2: Carry many sockets over one WebSocket, the Wisp class of relay hardening; rung 3: Open a direct tab-to-tab transport over WebRTC as an opt-in subpath, once the surface freeze clears; rung 4: Keep an Isolated Web App packaging lane ready for the day Direct Sockets opens a real inbound listen |
| Everything local Python does | 7.5 | Pyodide's `dlopen` already loads native C-extension wheels (numpy, pandas, scipy and more), packages install from a cache, `%pip` and `freeze` work inside the machine, and the WASI lane installs pure-Python wheels. The long tail is what is missing: an arbitrary package needs a published pyemscripten wheel, numpy has no SIMD build, threading is upstream-pending, and the GPU lane has no headless adapter, so what CI holds is the byte identity of the WGSL each integration path compiles, not its result on a GPU. | Whatever runs in a local interpreter runs in the tab, at a speed that needs no apology. | Widen package reach where it is thin: a pyemscripten wheel for the long tail, and a SIMD numpy build; rung 6: Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real |
| One gathered product entrance | 10.0 | The `pyproc` root gathers the complete choice: `open` for the durable Python Machine, `boot` for an explicit transient Machine, `createWebComputer` for the multi-guest host, and `checkEnvironment` for preflight. Errors share one contract, advanced plumbing stays in named subpaths, and installed-package plus browser gates prove every root door without a deep import. | One root import that shows every product door, the handle each door returns, and the capability path beneath it, with no competing top-level identity. |  |
| A supply chain you can verify | 8.8 | The zero-dependency engine CLI verifies catalog-pinned boot anchors and every lock-listed package before same-origin deployment; runtime pins the script SRI, re-verifies fetched core bytes, and the browser gate proves zero third-party requests. The asset CLI seals the worker and Service Worker graph, bad hashes refuse spawn, machine images verify signers before import, and the Linux guest build is checked by byte-identical independent rebuild plus source, legal inventory, SBOM, config, and manifest. | Every byte pyproc executes is either built by a repository recipe or pinned by a digest, and every mismatch fails before execution. | Build the remaining firmware and emulator assets twice from repository recipes and gate every digest in the final execution graph |

The axis ledger is [tests/northStar.mjs](tests/northStar.mjs): each axis registers the executable artifacts standing behind it, and the structure gate turns red when a registered gate is missing, is opened by no runner, or does not run in CI. This table is rendered from that ledger, so no score moves by editing prose. What each axis means, and what would move it, is in the [product direction](docs/product/vision.md#north-star-axes).

### Where the ceiling moves next

The distance that remains is two walls with different fates. The transport wall (a tab accepting an inbound connection) is opening, so it gets climbed in order. The native wall (web content spawning a native process) never opens, by the design of the web itself, so what only local machines run moves inward instead. Every rung names the axis it moves:

1. Terminate TLS inside the tab, so a relay carries ciphertext it cannot read and needs no trust (moves: Network, the browser way)
2. Carry many sockets over one WebSocket, the Wisp class of relay hardening (moves: Network, the browser way)
3. Open a direct tab-to-tab transport over WebRTC as an opt-in subpath, once the surface freeze clears (moves: Network, the browser way)
4. Keep an Isolated Web App packaging lane ready for the day Direct Sockets opens a real inbound listen (moves: Network, the browser way)
5. Enable memory64 once the engine contract can prove it, lifting the per-module heap ceiling a large guest hits first (moves: A computer that boots guests)
6. Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real (moves: Everything local Python does)
7. Boot a Node guest beside Python and Linux, making JavaScript CLI tools residents of the computer (moves: A computer that boots guests)

The repo-local acceptance condition and order of every rung are in the [product direction](docs/product/vision.md#where-the-ceiling-moves-next). The rungs are registered in the axis ledger, so no outside adoption signal can move a score or reorder the work.

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
