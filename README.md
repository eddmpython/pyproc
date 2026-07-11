# pyproc

**Real runtime Python in a browser tab, with no server.** Processes, parallelism, and restore-based reactivity, packaged as one reusable runtime. The single source of truth for the web Python runtime shared by codaro / dartlab / xlpod.

Language: English | [한국어](README.ko.md)

---

## One goal

**Make Python in the browser behave like local Python.** Local-grade execution speed, real processes and parallelism, a terminal, package installation, and eventually embedded-Python / uv-grade environment management - all inside a tab, with no server. Whatever works locally should work in the browser; that is this repository's only goal, and every claim counts only when measured in a real browser. The gap map and progress live in [local-parity](mainPlan/local-parity/README.md).

## What is this?

pyproc treats browser Python not as "one notebook cell" but as an **operating system**.

- A Web Worker becomes a **process**.
- A heap snapshot becomes a **process image**.
- Injecting that snapshot into a worker becomes a **fork**.
- N independent interpreters mean N independent GILs, which mean **N-core physical parallelism**.

Under the hood it runs [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly), but it adds the runtime properties Pyodide does not give you on its own: spawning processes cheaply, running them in parallel, and restoring interpreter state without re-running your code. It is a plain ESM library with no build step, meant to be imported by real products.

## Why does it exist?

The pieces to run Python in a browser already exist. What did not exist is a **shared layer** that turns them into a real runtime. codaro, dartlab, and xlpod all need the same thing. If each copy-pastes it, the runtime splits into three versions that drift apart. pyproc is that layer, built once and shared version-pinned, so improvements land in one place. See [docs/product/vision.md](docs/product/vision.md) for the full direction and policy.

## Core concepts, in plain terms

**1. Snapshot-fork (fast process spawn).** Booting a fresh Pyodide interpreter takes about 2.8 seconds. pyproc boots one parent, takes a memory snapshot (the "process image"), and starts workers from that snapshot in about 184ms. That is a 15.4x faster spawn, and each child is an isolated process.

**2. Process OS (real parallelism).** Because each worker is an independent interpreter with its own GIL, running the same function across workers gives you real multi-core execution, not concurrency on one thread. `PyProc.map()` drains a task queue across workers at the same time.

**3. Restore-based reactivity (time travel without re-running).** A reactive notebook normally re-runs cells when something upstream changes. WebAssembly has no OS dirty-page tracking, so pyproc reconstructs it by hashing the heap completely at each execution boundary and storing only the changed pages. Restoring to an earlier state then writes back only the differing pages (about 2.4ms), instead of re-running. The complete hash is what makes this sound; sampling would miss changes and corrupt the restore.

## Supported environment

**Chromium / Edge only.** pyproc needs JSPI (JavaScript Promise Integration), SharedArrayBuffer, and `crossOriginIsolated`. Lack of Firefox / Safari support is a deliberate scope choice, not a defect.

To use SharedArrayBuffer, the page must be crossOriginIsolated, which requires these response headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Install

Install by pinning a commit SHA (publishing to the npm registry is in preparation; floating on the default branch is not allowed):

```jsonc
// package.json
"dependencies": {
  "pyproc": "github:eddmpython/pyproc#<commit-sha>"
}
```

There is no build step (native ESM). You can also import straight from a CDN with no install:

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/gh/eddmpython/pyproc@<commit-sha>/index.js";
</script>
```

Direct CDN import supports the single-runtime path (`boot`/`Runtime`/reactivity) only. The process OS (`PyProc`) needs its worker file to be same-origin with your page (browsers block cross-origin workers), so use the npm install or vendor the files.

## Quick start

```js
import { boot, PyProc } from "pyproc";

// 1) Single runtime: run Python
const rt = await boot();
console.log(rt.run("sum(range(100))"));      // 4950
await rt.loadPackages(["numpy"]);
console.log(rt.run("import numpy as np; int(np.arange(10).sum())"));  // 45

// 2) Process OS: real parallelism (N independent GILs)
const os = new PyProc();
await os.boot(4);                             // spawn 4 workers via snapshot-fork
const fn = "def _fn(n):\n    return sum(i*i for i in range(n))";
const out = await os.map(fn, [100000, 100000, 100000, 100000]);
console.log(out);                             // 4 tasks run across 4 cores
os.terminate();
```

## Capabilities

Capabilities are opt-in. Turn on only what you need from the runtime. The consumer uses the capability contract and never touches engine internals (`HEAPU8` and friends).

### Restore-based reactivity

```js
const rt = await boot();
const reactive = rt.enableReactive();
const sp0 = reactive.stackSave();
rt.run("x = 1");
const cp = reactive.checkpoint();             // save state
rt.run("x = 999");
reactive.checkpoint();                        // close the execution boundary (the contract)
reactive.restoreLive(cp.index, sp0);          // live-diff restore (writes only changed pages)
console.log(rt.run("x"));                      // 1
```

**Execution boundary contract**: `restoreLive` compares stored hashes only (zero re-hashing is what makes it instant). So if you ran Python, you must close that boundary with `checkpoint()` before restoring. If you cannot guarantee the boundary, use `restore()` (full restore, the safe baseline).

### Borrowed syscall bridge

A browser has no socket / subprocess / blocking input. This capability borrows those, via a proxy, a child worker, and JSPI respectively, so Python code runs unchanged. The library exposes the contract (what gets wired); the consuming product fills in the real endpoints.

**v1 scope (honestly)**: `input()` (sync plus JSPI `run_sync` blocking), `urllib.request.urlopen` (sync XHR, GET/POST, binary-safe), and `subprocess.run(["python","-c",code])` (an independent child-worker interpreter, runAsync path). All of it is verified by the browser gate. The requests library and raw sockets are in-progress items under [local-parity](mainPlan/local-parity/README.md).

```js
const bridge = rt.enableSyscallBridge({
  input: (p) => window.prompt(p),               // sync source for input()
  inputAsync: async (p) => await myUi.ask(p),   // for terminals: true blocking under runAsync (JSPI)
  proxyUrl: "/proxy",                           // optional: route HTTP through your product's proxy
});
await bridge.install();
rt.run('name = input("who? ")');                // real blocking input
rt.run('import urllib.request; body = urllib.request.urlopen(url).read()');  // real sync HTTP GET
await rt.runAsync('import subprocess; subprocess.run(["python","-c","print(42)"], capture_output=True).stdout');
```

## Public surface

| Export | What |
| --- | --- |
| `boot(opts)` | Boot a Pyodide runtime, returns `Runtime` |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` plus capability registration |
| `MemoryCapability` | Capability contract that encapsulates WASM heap access |
| `ReactiveController` | Restore-based reactivity (checkpoint / time travel) |
| `SyscallBridge` | socket/subprocess/input capability contract |
| `PyProc` | Process OS kernel (snapshot-fork spawn + `map` parallelism) |
| `PAGE_SIZE` | WASM page size constant (65536) |

Subpath imports are also supported:

```js
import { boot } from "pyproc/runtime";
import { ReactiveController } from "pyproc/reactive";
import { PyProc } from "pyproc/process-os";
```

## Measured results

- **Snapshot-fork**: child boot 184ms (vs cold 2839ms), a 15.4x faster spawn, isolated process.
- **Real N-core parallelism**: measured speedup on embarrassingly-parallel work across independent-interpreter workers.
- **Restore reactivity**: complete hashing handles heap growth automatically, live-diff restore in about 2.4ms (12x vs memcpy), reactive edit about 9.1x faster, zero crashes.
- **Speed reality**: pure Python logic is at parity with or faster than local (CPython 3.14 > 3.12). Only large numpy arithmetic is about 86x slower (WASM single-thread, no-AVX BLAS). Server / automation / logic workloads are runtime-grade.

## Frontier (stated honestly)

warm-fork (cloning after packages load), true shared-memory threads (nogil), and cross-process zero-copy numpy are all blocked by one unsolved problem: **WASM dlopen** plus cross-instance/thread memory sharing. Pyodide threading issue #237 has been open since 2018. pyproc avoids this problem by giving each worker its own wasmTable / heap / glue, which is why it is the achievable ceiling today. The frontier is a wall, not a stepping stone.

## Architecture

```text
Layer 2  process-os   PyProc kernel (snapshot-fork spawn + map parallelism), worker = a process
Layer 1  reactive     restore reactivity (capability)
         syscall      socket/subprocess/input bridge (capability contract)
Layer 0  runtime      Pyodide wrapper (boot/Runtime) + MemoryCapability contract
         index.js     public surface / index.d.ts type contract
```

## How products consume it

pyproc becomes an SSOT only through **real imports**, not references. Consumers pin a commit SHA, depend on the public contract plus the shipped `index.d.ts` types, and never import in reverse. Full policy: [docs/consuming/contract.md](docs/consuming/contract.md).

## Development

```bash
npm test              # Node structure/lint gate (zero dependencies)
npm run test:browser  # headless Chromium runtime gate: boot / reactive contract / fork / map (zero dependencies)
npm run serve         # COOP/COEP static server for manual validation (zero dependencies)
```

Because this is a WASM runtime, real validation only happens in a browser: `test:browser` launches your local Edge/Chrome headless and verifies the public surface actually works (the same gate runs in CI). For manual checks and benchmarks, serve `examples/` via `npm run serve`. Procedure: [docs/operations/testing.md](docs/operations/testing.md).

Operating docs (operating model, testing, releases, consumption contract) live in [docs/](docs/README.md), design/roadmap/decision records in [mainPlan/](mainPlan/README.md), and contribution rules in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). It comes with an explicit patent grant (Section 3), and contributions are accepted under the same terms (Section 5, inbound = outbound); see [CONTRIBUTING.md](CONTRIBUTING.md).
