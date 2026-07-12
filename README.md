<p align="center"><img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="88" alt="pyproc logo"></p>

# pyproc

**Real runtime Python in a browser tab, with no server.** Real processes and multi-core parallelism, checkpoint / time-travel, an in-kernel ASGI server, a terminal, and portable machine images (a running Python computer as a single file), packaged as one reusable runtime on [Pyodide](https://pyodide.org) / WebAssembly. The single source of truth for the web Python runtime shared by codaro / dartlab / xlpod.

**Live demo**: [eddmpython.github.io/pyproc](https://eddmpython.github.io/pyproc/) - the Python machine, terminal, and process OS in your browser (Chromium/Edge).

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

**4. Portable machine image (a running computer as a single file).** Because a deterministic boot (fixed hash seed plus stubbed entropy and time) reproduces a byte-identical heap, the base never has to travel: `Session` stores only your work (the pages that differ from the replay boundary, about 10MB), and `exportImage()` packs that delta into one `.pymachine` file. Reopening replays the same base and applies the delta (about 1.5ms), and your Python state is alive again. A VM image is gigabytes; this is a live machine as a few-MB file. Proven today when reopened on the same machine; cross-machine determinism (the "email it to someone" claim) is the open probe under [local-parity](mainPlan/local-parity/README.md).

## Supported environment

**Chromium / Edge only.** pyproc needs JSPI (JavaScript Promise Integration), SharedArrayBuffer, and `crossOriginIsolated`. Lack of Firefox / Safari support is a deliberate scope choice, not a defect.

To use SharedArrayBuffer, the page must be crossOriginIsolated, which requires these response headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Install

From the npm registry ([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)):

```sh
npm install pyproc
```

Products consuming pyproc as their runtime SSOT should keep pinning a commit SHA (floating on the default branch is not allowed):

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

**Execution boundary contract (machine-enforced)**: when the boundary holds (no execution since the last `checkpoint()`/restore), `restoreLive` compares stored hashes only and restores instantly (zero re-hashing, ~1ms measured). A boundary violation (execution, exception, global mutation) is auto-detected in O(1) via a state-mutation counter and the restore upgrades to the re-hash path, so **a silently wrong restore cannot happen** (~27ms measured). The returned `rehashed` flag tells you which path ran.

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

### In-kernel ASGI server, with a real URL

A "local server" is not a TCP socket, it is an ASGI interface. `AsgiServer` dispatches a FastAPI / Starlette app inside the kernel with zero sockets (about 3.4ms per request). Endpoints must be `async def`.

```js
rt.run("from fastapi import FastAPI\napp = FastAPI()\n@app.get('/ping')\nasync def ping(): return {'ok': True}");
const server = rt.enableAsgiServer();          // reads the `app` global
await server.install();
await server.serve("GET", "/ping");            // { status: 200, headers, body: '{"ok":true}' }
```

With the bundled Service Worker asset (`src/capabilities/pyprocSw.js`) the Python server also answers on a **real URL**: register the SW with `?asgi=/pyproc/`, call `new VirtualOrigin(server).bind()`, and any `fetch("/pyproc/api/...")` from your page (or an iframe) hits FastAPI. Measured round trip: 3.4ms, identical to direct dispatch. The same asset with `?cache=1` serves every Pyodide CDN asset cache-first, including the script paths that `coreCacheDir` cannot reach, so the second boot makes zero CDN requests (airplane-mode boot).

### Serverless terminal

The tab becomes a real Python REPL. `Terminal` stands up CPython's own `code.InteractiveConsole` inside the kernel; combined with the syscall bridge's JSPI path, `input()` blocks for real.

```js
const term = rt.enableTerminal();
await term.install();
await term.push("x = 40");
await term.push("x + 2");                       // { more: false, out: "42\n" }
```

### Session revival and portable machine images

Deterministic replay plus a user delta makes the interpreter immortal and movable. Boot from a manifest (the environment declaration), work, then persist only your delta to OPFS, or export the whole computer as one `.pymachine` file.

```js
import { bootSession, openMachine } from "pyproc";

const s = await bootSession({ packages: ["numpy"], setup: "import numpy as np" });
s.rt.run("data = np.arange(1_000_000)");        // do work
const file = await s.exportImage();             // a running computer as a single Blob (.pymachine)

// later, in a fresh tab: replay the base, apply the delta, resume
const revived = await openMachine(file, { trust: true });
revived.rt.run("int(data.sum())");              // state is alive again
```

A machine file is live state, so it carries the same risk as an executable: `openMachine` verifies a SHA-256 integrity hash and refuses to open without an explicit `{ trust: true }`.

### Wheel cache (offline, zero-redownload packages)

`WheelCache` stores installed `.whl` bytes in OPFS and serves them from cache on the next install, so package loads go offline and re-download nothing. It wraps only the `install` / `loadPackages` window rather than polluting global `fetch`.

### The uv lane: instant environments, reproducible locks, self-sufficient scripts

`bootEnv` turns the second boot of an environment from an install into a restore: a bare heap snapshot (boots in ~227ms instead of ~3.6s) plus OPFS-cached wheels. Measured: numpy environment cold 5109ms, warm **1229ms** (4.2x). `Runtime.freeze()` pins the whole environment as a pyodide-lock JSON you can feed back through `boot({ lockFileURL })` for zero-resolution reproduction, and `runScript` runs PEP 723 scripts (`# /// script` with inline `dependencies`) by auto-installing what they declare, like `uv run` in the browser.

```js
import { bootEnv, runScript } from "pyproc";

const dirs = { snapshots: snapDir, wheels: wheelDir };            // OPFS handles you own
const rt = await bootEnv({ packages: ["numpy"], setup: "import numpy" }, dirs);
rt.envBoot;                                                       // { lane: "snapshot", totalMs: 1229, ... }
await runScript(rt, "# /// script\n# dependencies = [\"six\"]\n# ///\nimport six\nsix.__version__");
```

### A kernel that outlives the tab

`SharedKernel` hosts the interpreter in a SharedWorker: every tab that connects sees the same Python state, and the kernel keeps running as long as any connection is alive. Calls are Promise-based (the kernel is remote). Platform limit, measured honestly: SharedWorkers are not crossOriginIsolated today, so SharedArrayBuffer features (interrupt, snapshot-fork) stay on the per-tab `PyProc` until the platform catches up.

## Public surface

| Export | What |
| --- | --- |
| `boot(opts)` | Boot a Pyodide runtime, returns `Runtime` (`lockFileURL` for lock reproduction, `coreCacheDir` for offline core) |
| `bootEnv(manifest, dirs)` | The uv lane: bare-snapshot + wheel-cache warm boot (second boot 1229ms vs 5109ms cold) |
| `runScript(rt, src, opts)` | `uv run` in the browser: auto-install PEP 723 inline dependencies, then run |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` / `freeze` / `mountHome` plus capability registration |
| `MemoryCapability` | Capability contract that encapsulates WASM heap access |
| `ReactiveController` | Restore-based reactivity (checkpoint / time travel) |
| `SyscallBridge` | socket/subprocess/input capability contract |
| `AsgiServer` | In-kernel ASGI server (FastAPI with zero sockets, 3.4ms dispatch) |
| `VirtualOrigin` | The Python server on a real URL, paired with the `pyprocSw.js` Service Worker asset |
| `Terminal` | Serverless Python terminal (REPL, blocking input, `%pip` / `%undo`) |
| `DeviceFs` | Everything is a file: browser capabilities as Python `open()` (`/dev/clipboard`, `/proc`) |
| `Init` | OS init: `/home/web/boot.py` autorun plus `cron.py` ticks, all file-driven |
| `bootSession` / `Session` / `openMachine` | Session revival (immortal kernel) and portable `.pymachine` machine images: deterministic replay plus user delta, persisted to OPFS (`save`/`load`) or exported as one file (`exportImage`/`openMachine`) |
| `WheelCache` | Wheel / OPFS cache for offline, zero-redownload package installs |
| `PyProc` | Process OS kernel: snapshot-fork spawn, `map` / `mapArray` (SharedArrayBuffer typed-array) parallelism, lifecycle (`kill` / `interrupt` / respawn) |
| `SharedKernel` | A kernel that outlives the tab (SharedWorker): many tabs, one Python state |
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

True shared-memory threads (nogil) and cross-process zero-copy numpy remain blocked by one unsolved problem: **WASM dlopen** plus cross-instance/thread memory sharing (Pyodide threading issue #237, open since 2018). pyproc avoids it by giving each worker its own wasmTable / heap / glue. warm-fork (cloning after packages load) used to sit behind the same wall, but pyproc now has a **practical bypass via deterministic replay plus user delta** (`Session`; measured: replay boots reproduce a byte-identical heap, delta applies in 1.5ms). Pyodide's snapshot hiwire limitation (no imaging after package load, upstream #5195) still stands; the wall was routed around, not broken.

## Architecture

```text
Layer 2  process-os   PyProc kernel: snapshot-fork spawn, map/mapArray parallelism, lifecycle; worker = a process
Layer 1  reactive     restore-based reactivity (checkpoint / time-travel)
         syscall      socket / subprocess / input bridge
         asgi         in-kernel ASGI dispatch
         terminal     serverless Python REPL
         session      session revival + .pymachine machine image
         wheelcache   wheel / OPFS package cache
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
