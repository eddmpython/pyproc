<p align="center">
  <img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="132" alt="pyproc">
</p>

<h1 align="center">pyproc</h1>

<p align="center"><b>Real Python in your browser tab. No server.</b></p>

<p align="center">
  A stateful, browser-native Python runtime for AI agents: keep the runtime state alive,<br>
  branch it into isolated paths, restore it in milliseconds. No fresh container per run.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pyproc"><img src="https://img.shields.io/npm/v/pyproc?label=npm&color=5b8cff&labelColor=0a0f1c" alt="npm"></a>
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

## The problem it solves

AI agents don't run Python once. They generate code, run it, read the failure, fix it, and run again. They try several approaches in parallel, or roll back to a known-good state before the last mess.

The usual answer is a server container or a fresh Python environment per attempt: slow to start, costly to keep, and thrown away between tries. pyproc keeps a prepared Python state alive **in the user's browser**, and lets you **checkpoint, branch, and restore** it, so the retry loop costs milliseconds instead of a cold boot - and the user's data never has to leave the tab. For a product, the per-session sandbox you would otherwise run server-side moves into the user's browser: sandboxed execution you don't provision or pay for, on a boundary (Chrome + WASM) already hardened against the whole web.

## In one example

```js
import { boot } from "pyproc";

const rt = await boot();
rt.run("values = [10, 20, 30]");
console.log(rt.run("sum(values)"));   // 60
```

Real CPython (via [Pyodide](https://pyodide.org) / WebAssembly), running in the tab, returning real values.

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
- **Branch from one state.** An agent runs several code candidates from the same prepared state, independently, and compares results.
- **Data stays local.** Process CSV / Excel / enterprise data in the tab and send only the summarized result onward.
- **Isolated execution.** Python runs off the main UI thread, across multiple workers you manage.

## Quick start

```sh
npm install pyproc
```

```js
import { boot } from "pyproc";

const rt = await boot();
await rt.loadPackages(["numpy"]);
console.log(rt.run("import numpy as np; int(np.arange(1_000_000).sum())"));  // 499999500000
```

Checkpoint and restore. Reactivity is opt-in via `enableReactive`; the closing `checkpoint()` marks the execution boundary that makes the restore sound:

```js
const reactive = rt.enableReactive();
const sp = reactive.stackSave();
rt.run("values = [10, 20, 30]");
const cp = reactive.checkpoint();            // save this state
rt.run("values.append(999)");
reactive.checkpoint();                        // close the execution boundary (the contract)
reactive.restoreLive(cp.index, sp);           // back to the checkpoint - writes only changed pages
console.log(rt.run("len(values)"));           // 3
```

> The basics above need only a Chromium browser. `PyProc` (process OS) and sockets also need `crossOriginIsolated` (`COOP: same-origin`, `COEP: require-corp`) and same-origin workers - see [Setup](#setup). Run `checkEnvironment()` to check.

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

## Feature status

Honest maturity by browser-gate coverage. Everything below has a runtime gate; the label is how much to stake on it today.

| Area | Status |
|---|---|
| Python execution (`boot` / `run` / `loadPackages`) | Stable |
| Process OS: snapshot-fork spawn, `map` parallelism (`PyProc`) | Beta |
| Restore-based reactivity (`enableReactive`: checkpoint / time-travel) | Beta |
| In-kernel ASGI (`AsgiServer` - in dartlab production today) | Beta |
| uv lane (`bootEnv` / `freeze` / `runScript`), wheel cache, terminal, syscall bridge | Beta |
| Session revival + `.pymachine` images, machine journal (WAL) | Experimental |
| Live process fork, device FS, init / cron, virtual-origin URL | Experimental |
| Outbound Python sockets (`SocketBridge`), shared kernel | Experimental |
| non-Pyodide CPython 3.14 (`bootWasi` / `WasiSession`) | Research preview |

## What it guarantees, and what it doesn't

**Guaranteed (browser-measured):**

- Pyodide-based Python on supported browsers.
- WASM heap state saved at declared execution boundaries.
- State restore under compatible runtime conditions.
- Worker-based execution isolation.

**Not (yet) guaranteed:**

- Full process capture at an arbitrary instant - in-flight network requests and Promises are not restored.
- Every Python package - native C-extension wheels need a static build; pure-Python and Pyodide-built packages work.
- Snapshot compatibility across Pyodide versions, or across machines (cross-machine `.pymachine` is an open probe).
- GPU / native Linux packages, full POSIX `fork`, arbitrary native binaries.

Naming these up front is deliberate: a hidden limit reads as a bug later; a stated one reads as a managed boundary.

## The honest scope: aim at infinity, claim what's proven

**North Star: whatever runs locally should eventually run in the browser, with no server.** A *direction*, not a current-compatibility claim (snapshot-fork, time-travel, and portable machine images all came from aiming this high). Everything local sorts into four states, and pyproc's job is to push things up the list and to be the first structure that absorbs a wall the moment the platform reopens it:

- **Delivered** (measured today): pure-Python + Pyodide packages, multi-core processes, checkpoint / restore, in-kernel ASGI, terminal, persistent FS, portable images, outbound Python sockets.
- **Virtualized** (the browser way): a TCP `listen()` becomes an ASGI app, `os.fork` becomes worker kernels, outbound sockets ride a thin relay.
- **Upstream-pending** (walled now, reopenable): native C-extension wheels (Emscripten static builds / the WebAssembly component model), GPU (WebGPU), real threading.
- **Permanent web-security wall**: inbound connections and arbitrary native binaries need an external relay or agent.

The gap map lives in [local-parity](mainPlan/_done/local-parity/README.md).

## Security model

pyproc runs Python inside the browser's WebAssembly and Web Worker isolation boundaries. That is not a claim of safety for arbitrary untrusted code: an application running untrusted code is still responsible for its own network, storage, package, memory, and execution-time policies appropriate to its threat model. A `.pymachine` file is live state and carries the same risk as an executable - `openMachine` verifies a SHA-256 integrity hash and refuses to open without an explicit `{ trust: true }`.

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

## Benchmarks

The numbers below come from one machine and are meant to be **reproduced, not taken on faith** - run `npm run serve`, open `examples/`, and report with conditions (browser, OS, Pyodide version, warm / cold, heap size, sample count). Representative local measurements (Edge, Windows 11, Pyodide v314.0.2, warm cache):

- Snapshot-fork child boot ~184-300ms vs cold ~2.8s.
- Restore-based reactivity: live-diff restore ~1-2.4ms (writes only changed pages, no re-run).
- uv-lane warm environment boot ~1229ms vs ~5109ms cold (numpy).
- non-Pyodide CPython 3.14 (WASI) boot ~70-120ms.

Reality check: pure-Python logic is at or above local speed; large numpy arithmetic is ~86x slower (WASM single-thread, no-AVX BLAS). Logic / analysis / server workloads are runtime-grade; heavy numeric crunching is not the target.

## Public surface

Capabilities are opt-in - turn on only what you need, and consume the capability contract rather than engine internals (`HEAPU8` and friends).

| Export | What |
| --- | --- |
| `checkEnvironment()` | Environment preflight: are `crossOriginIsolated` / SAB / JSPI ready, and if not, what to add (each gap comes with a copy-paste fix) |
| `boot(opts)` | Boot a Pyodide runtime, returns `Runtime` (`lockFileURL` for lock reproduction, `coreCacheDir` for offline core) |
| `bootEnv(manifest, dirs)` | The uv lane: bare-snapshot + wheel-cache warm boot (second boot ~1229ms vs ~5109ms cold) |
| `runScript(rt, src, opts)` | `uv run` in the browser: auto-install PEP 723 inline dependencies, then run |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` / `loadPackagesFromImports` / `setStdout` / `setStderr` / `freeze` / `mountHome` / `fs` plus capability registration; adopt an existing Pyodide with `new Runtime(py)` |
| `MemoryCapability` | Capability contract that encapsulates WASM heap access |
| `FileSystem` (`Runtime.fs`) | Engine-agnostic general file IO so consumers never touch `rt.raw.FS`: `writeFile` / `readFile` (utf8 or binary) / `mkdir` / `mkdirTree` / `readdir` / `stat` / `exists` / `unlink` / `rmdir`. Persistence (OPFS) is `mountHome`; this is the file-op layer over the mounted FS |
| `ReactiveController` | Restore-based reactivity: `checkpoint` / `restoreLive` / `timeTravel`, branch tree |
| `SyscallBridge` | Borrowed syscalls: `input()` (sync / JSPI), `urllib` (sync XHR), `subprocess` (child worker) |
| `SocketBridge` | Real outbound TCP for Python sockets (HTTP + HTTPS) via a thin WS->TCP relay: `socket` / `urllib` / `http.client` reach arbitrary host:port; the relay terminates TLS for `https` (blocking recv over JSPI, `runAsync`). Inbound is a physical wall |
| `AsgiServer` | In-kernel ASGI server (FastAPI with zero sockets, ~3.4ms dispatch) |
| `VirtualOrigin` | The Python server on a real URL, paired with the `pyprocSw.js` Service Worker asset |
| `Terminal` | Serverless Python terminal (REPL, blocking input, `%pip` / `%undo`) |
| `DeviceFs` | Everything is a file: browser capabilities as Python `open()` (`/dev/clipboard`, `/proc`) |
| `Init` | OS init: `/home/web/boot.py` autorun plus `cron.py` ticks, all file-driven |
| `MachineJournal` | Write-ahead log: the machine checkpoints itself while idle, so a crashed tab still boots back into its last commit |
| `MachineJail` | Permission jail: `permissions{net, clipboard, home, workers}` enforced in two tiers, a cooperative Python chokepoint plus the browser's own wall (a `connect-src` CSP on the jail context blocks disallowed hosts even if the jailed code tries `import js`) |
| `GpuCompute` / `GpuArray` / `GpuBridge` | Offload large f32 linear algebra to WebGPU compute: a residency handle (upload once, chain `matmul` / `map` / `binary` / `transpose` / `reduce` on the GPU, download once) with a shared-memory tiled kernel. Full pipelines stay GPU-resident: `matmul -> relu -> sum` (loss) and `x.transpose() @ dy` / residual `(A@B) + C`. `Runtime.enableGpu()` wires it into Python (`pyprocGpu.matmul` on numpy arrays). Measured ~127x vs WASM numpy on a real GPU; f32 only (WGSL has no f64), needs a windowed browser with a GPU |
| `BrowserControl` | Drive the browser from Python inside an MV3 extension offscreen document: `Runtime.enableBrowserControl()` -> `install()` -> `pyprocBrowser.tab(url, mode)`. Playwright-class surface: navigation (`navigate` / `reload` / `back` / `forward`), input (`click` / `doubleClick` / `rightClick` / `hover` / `type` / `fill` / `press` / `select`), query/extract (`text` / `attr` / `value` / `exists` / `count` / `texts` / `boundingBox` / `title` / `url` / `content`), waiting (`waitFor` / `waitForFunction`), capture/emulation (`screenshot` / `pdf` / `setViewport` / `setUserAgent` / `setHeaders` / `emulateMedia` dark mode / `setTimezone` / `setOffline`), cookies (`cookies` / `setCookie` / `clearCookies` / `deleteCookie`), files (`upload`), dialogs (`setDialogHandler` auto-answers alert/confirm/prompt), network (`route` blocks / mocks / modifies / holds requests via CDP Fetch; held requests are decided per-request from Python via `pendingRequests` + `continueRequest` / `fulfillRequest` / `abortRequest`; `waitForResponse` / `requests` / `responseBody` observe responses and capture bodies), frames (`frames` / `frame` drill into a same-origin iframe via an isolated world). Pointer ops auto-scroll the target into view. Two modes: `script` (chrome.scripting, stealth, no `navigator.webdriver`) and `debugger` (chrome.debugger CDP, trusted input `isTrusted=true`, full capture/emulation/dialog/network). Persistent session handle over one tab; a tab closed externally raises `SessionLost`. Process-OS fusion: `routeBrowserWorker` (offscreen relay) + `installBrowserWorker` (worker side) let N Pyodide workers each drive their own session with an independent interpreter (N GILs), the differentiator Playwright cannot match. The service worker half is a separate subpath `pyproc/browser-control-host`. Chromium extension only |
| `bootSession` / `Session` / `openMachine` | Session revival and portable `.pymachine` images: deterministic replay plus user delta, persisted to OPFS (`save` / `load`) or exported as one file (`exportImage` / `openMachine`) |
| `WheelCache` | Wheel / OPFS cache for offline, zero-redownload package installs |
| `PyProc` | Process OS kernel: snapshot-fork spawn, `map` / `mapArray` parallelism, lifecycle (`kill` / `signal` / respawn), `fork(2)` (clone a live process, its variables and arrays travel), and flow IPC (`pipe` / `lock` / `semaphore` / `shm`: SAB ring-buffer pipes with real blocking read and backpressure) |
| `MachineContainer` | Machine inside a machine: boots a container kernel in a worker with its own package set, exposed to Python as a value (`m.run` / `m.spawn` / `m.kill`); nests (containers inside containers) |
| `SIGNAL` | POSIX signal numbers for `PyProc.signal(pid, signum)`: real `SIGTERM` / `SIGUSR1` handlers fire inside Python |
| `JobControl` | Shell job control: `expr &` forks the live interactive namespace onto another core (prompt returns immediately); `%jobs` / `%fg` / `%kill` drive the jobs |
| `KernelElection` | The OS survives tab death: tabs elect a leader via Web Locks, only the leader boots a kernel, the rest are RPC views; when the leader tab dies a follower is promoted and resumes from the journal |
| `SharedKernel` | A kernel that outlives the tab (SharedWorker): many tabs, one Python state |
| `bootWasi` / `WasiSession` | A session on non-Pyodide CPython 3.14 (WASI), proving the primitives are engine-independent: async `run` / `get` / `set`, full time-travel, `installWheel(bytes)` (browser-side pip for pure-Python wheels). Value bridge is JSON-only; C extensions need a static build |
| `PAGE_SIZE` | WASM page size constant (65536) |

Subpath imports are also supported:

```js
import { boot } from "pyproc/runtime";
import { ReactiveController } from "pyproc/reactive";
import { PyProc } from "pyproc/process-os";
```

Deep, example-driven docs for each capability live in [docs/](docs/README.md); this README stays the map.

## Setup

**Chromium / Edge only.** pyproc needs JSPI (JavaScript Promise Integration, default since Chrome 137), SharedArrayBuffer, and `crossOriginIsolated`. Lack of Firefox / Safari support is a deliberate scope choice, not a defect.

There are two tiers of setup, so "just install and import" is true for the basics but not for everything:

| You want | You need |
|---|---|
| `boot` / `run` / `loadPackages`, `enableReactive` (checkpoint, time-travel) | Just `npm install` plus a Chromium browser. No headers. |
| `PyProc` (fork, `map`, interrupt), IPC, blocking sockets | The two headers below, plus **same-origin worker files** (so npm install / vendoring, not CDN import) |

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

From npm ([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)): `npm install pyproc`. There is no build step (native ESM). Products consuming pyproc as their runtime SSOT pin a commit SHA (floating on the default branch is not allowed):

```jsonc
// package.json
"dependencies": { "pyproc": "github:eddmpython/pyproc#<commit-sha>" }
```

You can also import straight from a CDN with no install (single-runtime path only; the process OS needs its worker file same-origin with your page):

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/gh/eddmpython/pyproc@<commit-sha>/index.js";
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
npm run test:browser  # headless Chromium runtime gate: boot / reactive / fork / map (zero dependencies)
npm run serve         # COOP/COEP static server for manual validation and benchmarks
```

Because this is a WASM runtime, real validation only happens in a browser: `test:browser` launches your local Edge / Chrome headless and verifies the public surface actually works (the same gate runs in CI). Operating docs live in [docs/](docs/README.md), design and decision records in [mainPlan/](mainPlan/README.md), contribution rules in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Mozilla Public License 2.0](LICENSE), the same license as Pyodide, the engine underneath. Copyright 2026 eddmpython.

MPL-2.0 is file-level copyleft, so the practical terms are: **embedding is free** (import pyproc into a closed-source app, ship it, sell it; your own code stays yours); **forks of pyproc itself stay open** (modify a covered file and you publish that file's source under MPL-2.0); **patents are granted** by every contributor for their contributions (Section 2.1(b)). Contributions are accepted under the same license without a separate CLA (inbound = outbound). See [CONTRIBUTING.md](CONTRIBUTING.md).
