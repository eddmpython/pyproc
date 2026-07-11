# pyproc PRD - Product Direction and Policy

Language: English | [한국어](PRD.ko.md)

Status: v0.1 (2026-07-11). This document is the single source of truth for what pyproc aims to be, what it deliberately is not, and the contract by which consumers (codaro / dartlab / xlpod) depend on it. When the code changes, this document is updated in the same change.

---

## 0. One line (North Star)

**Run Python in a browser tab, with no server, not as "one notebook cell" but like an operating system. Bundle processes, parallelism, and restore-based reactivity into one reusable runtime so it becomes the single source of truth for the web Python runtime shared by codaro / dartlab / xlpod.**

## 1. Problem

The pieces to run real Python in a browser (Pyodide, JSPI, File System Access, SharedArrayBuffer) already exist. But the layer that weaves them into "a real local runtime" is rewritten by every product. As a result:

- codaro, dartlab, and xlpod all need the same browser Python runtime. If each copy-pastes it, it splits into three versions. Fixing a bug in one does not fix the others.
- Pyodide is a single interpreter. Runtime properties like parallelism, processes, and state restore are not provided out of the box, so they get reinvented every time.
- The absent browser capabilities (socket / subprocess / blocking input) are patched differently in each product, so nothing is reusable.

pyproc builds this layer **once, properly, and shares it version-pinned**. Growing the repo concentrates improvements in one place, and once the three products actually import it, it becomes the SSOT automatically.

## 2. What it is / is not

**pyproc is:**
- A framework-agnostic ESM library. No build step (native `.js` plus a hand-maintained `.d.ts`).
- Browser-tier runtime primitives: runtime boot, restore-based reactivity, a process OS, and capability contracts.
- A clean consumption surface that encapsulates cross-cutting concerns (WASM heap access, stack pointer, monkey-patching) behind capability contracts.

**pyproc is not:**
- Product UI or domain logic (curriculum, automation, sheet editing). The consuming product layers that on top.
- Execution-placement policy (the capability router's tier decision). That differs per product, so the product owns it.
- The local engine or the GitHub Actions engine. codaro's `ExecutionEngine` three-tier ladder is owned by codaro; pyproc only provides the browser tier's primitives.
- Firefox / Safari support. Out of scope (see section 10).

## 3. Invention lineage (validated pieces + measurements)

pyproc's core is not new theory. It is the promotion of pieces that were broken through by measurement in the browser.

| Piece | What it broke through | Measured |
| --- | --- | --- |
| Snapshot = fork primitive | Injecting a heap snapshot into a worker = process fork. Process creation moves from "boot" to "image load" | bare fork child boot 184ms vs cold 2839ms = **15.4x**, isolated process |
| Process OS parallelism | N independent interpreters = N independent GILs = N-core physical concurrency | 4-worker `map` **2.67x**, results correct |
| Restore-based reactivity | Reconstruct WASM's missing dirty-page tracking via execution-boundary complete hashing. Restore then run only downstream, instead of re-running | live-diff restore **2.4ms** (12x vs memcpy), reactive edit **9.1x** faster, zero crashes |
| Capability contract | Isolate HEAPU8 / stack access behind a contract. Consumer uses only a clean API | consumer uses restore reactivity with zero direct engine-internal access |

Speed correction: pure Python logic is at parity with or faster than local (Pyodide's CPython 3.14 > local 3.12). Only large numpy arithmetic is about 86x slower (WASM single-thread, no-AVX BLAS). Server / automation / logic workloads are runtime-grade; only large numeric / ML work belongs on local.

## 4. Architecture (layers)

```text
Layer 2  processOS.js  PyProc process OS kernel (snapshot-fork spawn + map parallelism)
                         worker.js = a "process" (Pyodide inside a Web Worker)
Layer 1  reactive.js   restore reactivity (capability)
         syscallBridge  socket/subprocess/input bridge (capability, contract)
Layer 0  runtime.js    Pyodide wrapper (boot/Runtime) + MemoryCapability contract
         index.js      public surface / index.d.ts type contract
```

Capabilities (Layer 1) are opt-in. Turn on only what you need from the runtime (`enableReactive()`, etc.). A capability hides engine internals behind a contract like `MemoryCapability`, and the consumer touches only that contract.

## 5. Capabilities

- **Restore reactivity** - checkpoint the heap at each execution boundary using a complete hash (Uint32 words). The complete hash is the key to soundness; sampling produces incomplete deltas that break restore. Live-diff restore makes adjacent time travel effectively instant.
- **Process OS** - main thread = kernel. Process table (pid / state / parentPid), snapshot-fork spawn, `map` / `mapSerial` scheduler, `ps()`, `terminate()`.
- **Borrowed syscall bridge (contract)** - a contract that borrows the browser's absent socket / subprocess / input via a proxy, a child worker, and JSPI respectively. The library exposes "what gets wired", and the consuming product fills in the real endpoints.

## 6. Frontier (the honest wall = WASM dlopen)

We do not hide why pyproc is "the achievable state of the art today" and what wall sits above it.

- warm-fork (cloning after packages are loaded with zero re-import), true shared-memory threads (nogil), and cross-process zero-copy numpy - **all three are blocked by one unsolved problem (WASM dlopen plus cross-instance/thread memory sharing).** Pyodide threading issue #237 has been open since 2018. This is not "a few weeks of building", it is an upstream research problem.
- pyproc (independent interpreter workers plus message passing) avoids exactly this problem. Each worker owns its own wasmTable / heap / glue, so there is no dlopen mismatch. That is why it is the achievable ceiling today, and the frontier is a wall, not a stepping stone.
- This wall is where the pyproc repo keeps digging (hiwire/emval shadow, nogil-WASM custom build, WebGPU arithmetic).

## 7. Consumption policy (contract)

- **Consume by commit SHA pin.** A consuming product pins a commit SHA, like `"pyproc": "github:eddmpython/pyproc#<sha>"`, and installs via npm. No floating (tracking main). **No tags are created until an actual release** - do not tag on every scaffold or wiring change.
- **Depend on the public contract only.** Use only the surface exported by `index.js` (`boot` / `Runtime` / `PyProc`, etc.) and the `index.d.ts` types. Do not touch engine internals (HEAPU8, etc.). That way internal changes do not break consumers.
- **One-directional.** The dependency is products -> pyproc only. pyproc never imports any consuming product. No cycles.
- **What ships in the package.** `files` = `index.js`, `index.d.ts`, `src`, README. Internal agent/development rule docs, hooks, tests, and this PRD are not shipped in the consumed package.
- **SSOT only holds by real import.** Reference alone is not SSOT. codaro is the first consumer (import verified 2026-07-11: npm resolution, tsc types, Vite worker emit, all three green). dartlab / xlpod migrate incrementally via the same SHA-pin approach.

## 8. Roadmap (horizons)

Promoted now: runtime, restore reactivity, process OS, capability contracts (four core modules).

Next promotion candidates (validated in codaro experiments but not yet moved into modules):

1. **Browser-as-Server** - run WSGI/ASGI (Flask/FastAPI) with zero sockets, with a Service Worker connecting page fetches. Measured: GET 200 / POST 201 / 422 pydantic validation PASS.
2. **Serverless terminal** - shell = a Python program, with JSPI making `input()` truly block and resume.
3. **Warm worker pool + diff reset** - warm up workers to the package level at page load, and return to pristine via live-diff so tasks run immediately with no re-import.
4. **SAB IPC fast channel** - SharedArrayBuffer plus Atomics for byte transfer faster than postMessage (zero-copy remains a frontier).
5. **File System Access mount** - mount a real local folder into the runtime (Chromium/Edge).

## 9. Success / failure criteria

- **Success**: the three products actually import pyproc and layer their own surfaces on it, and browser-Python-runtime improvements concentrate in pyproc alone. Consumers use restore reactivity and process parallelism through capability contracts only, without touching engine internals.
- **Failure**: products still copy-paste and the runtime splits apart. Or pyproc absorbs product UI / domain and loses its generality. Or the contract breaks so often that consumers must chase every change.

## 10. Support boundary (Chromium/Edge only)

Requires JSPI (JavaScript Promise Integration), SharedArrayBuffer, and `crossOriginIsolated`. Lack of Firefox / Safari support is scope, not a defect. To use SharedArrayBuffer the page must be crossOriginIsolated via these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Permanent browser-tier ceiling (stated honestly): native wheels (torch, etc.), desktop control (xlwings/pyautogui), and resident scheduling are forever impossible in a browser. This is the web security model, not technical debt. That burden falls on the consuming product's local / Actions tiers.

## 11. Governance

- **Main-only.** No local branch creation/push. `.githooks` (`reference-transaction` / `pre-push`) block non-main refs.
- **No-build ESM.** No bundler / transpiler. Type declarations are hand-maintained (`.d.ts`).
- **Through capability contracts.** Engine-internal access is isolated behind a capability. `camelCase` files/functions, `PascalCase` classes.
- **Version `0.0.x` line.** Bump only the last digit at release, and only then create a tag.
- **Test gate.** `npm test` (Node, zero dependencies) checks public surface, type coverage, and doc hygiene. Green before commit.
- Detailed development rules live in the local rule docs (git-untracked) as their SSOT. This PRD holds the public-facing product direction and consumption policy.
