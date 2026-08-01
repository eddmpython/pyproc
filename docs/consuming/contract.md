# Package contract - installation, public surface, and runtime boundaries

This document defines the install, import, type, asset, and runtime boundaries of the published package.

The roles are split.

- This document: install, version pinning, import boundaries, runtime-asset deployment, and runtime consistency.
- [capabilityMatrix.md](capabilityMatrix.md): per-capability product value, status, prerequisites, runnable surface, verification, boundaries.
- [trustPermissions.md](trustPermissions.md): `.pymachine` public keys, signer fingerprints, the permission UI.
- [resumeCatalog.md](resumeCatalog.md): policy for reopening product resources after a revival.

## Install (pin the npm version)

```jsonc
// package.json
"dependencies": {
  "pyproc": "0.0.11"
}
```

- **Take it from the npm registry at an exact version.** No floating ranges (`^`, `~`, `latest`): an exact version plus a lockfile is what guarantees reproducibility. To move up, deliberately re-pin to a new release version. A release is one bundle of version bump, tag, GitHub Release, and npm publish ([release.md](../operations/release.md)).
- There is no build step (native ESM). It works from `<script type="module">` with no bundler.
- **Alternative paths** (optional): to pull a pre-release commit, pin a SHA with `"pyproc": "github:eddmpython/pyproc#<commit-sha>"`; for zero-install, use the CDN at `https://cdn.jsdelivr.net/npm/pyproc@<version>/index.js`. Note that the process OS (`machine.proc`) needs its worker file same-origin with the page - browsers block cross-origin workers - so it requires an npm install or vendoring.

## Public import boundary

Only the public package entry and stable subpaths are supported. The per-capability export list is canonical in [capabilityMatrix.md](capabilityMatrix.md); the type contract is the bundled `index.d.ts`.

| Specifier | Purpose |
| --- | --- |
| `pyproc` | The six root values: `boot`, `open`, `createWebComputer`, `checkEnvironment`, `PyProcError`, `PYPROC_ERROR_CODES` |
| `pyproc/runtime` | For adopting a self-booted Pyodide: the `Runtime` value, `bootRuntime` (which gives a `Runtime`, not a machine), `MemoryCapability`, `FileSystem`, and the EngineContract/RuntimeContract checks. Available from 0.0.11 |
| `pyproc/assets` | Runtime-asset manifest and SRI preflight: `getPyProcAssetManifest`, `verifyPyProcAssetIntegrity`, `registerPyProcServiceWorker` |
| `pyproc/history` | The state kernel plus the store, bundle, and signature contracts |
| `pyproc/machine` | Web Machine host, device, store, and guest assembly detail |
| `pyproc/worker` | Only when a bundler or product build must reference the worker entrypoint explicitly |
| `pyproc/gpu`, `pyproc/socket`, `pyproc/wasi` | Demoted Experimental and Research surfaces. New Experimental subpaths are frozen |

Forbidden boundaries:

- No deep imports from `src/...`. Internal file layout may change between releases.
- Do not consume `Runtime.raw`, `HEAPU8`, or Pyodide's internal FS directly. File IO goes through `Runtime.fs` and heap access stays behind `MemoryCapability`.
- Dependencies flow one way only: products depend on pyproc. pyproc imports no product UI and no domain logic.
- Do not put product UI or domain policy into pyproc. pyproc provides runtime and capabilities only.
- Worker and Service Worker files, which the browser requires to be same-origin, are handled as a deployment-asset contract rather than as public JavaScript imports.

## Runtime-asset deployment contract

### The Service Worker asset (pyprocSw.js)

`pyprocSw.js` is not a module you import; it is a **static asset you register on your own origin** (a Service Worker must be same-origin). Place it on your own deployment path, register it, and turn features on with query parameters (they compose):

```js
import { registerPyProcServiceWorker } from "pyproc/assets";

const assetIntegrity = await fetch("/vendor/pyproc-assets.json").then((r) => r.json());

// Offline core cache and virtual origin (a Python server at a real URL) together
await registerPyProcServiceWorker(assetIntegrity, {
  cache: true,
  asgi: "/pyproc/",
  coreIntegrity: "/vendor/pyodide-integrity.json",
  scope: "/",
});
new VirtualOrigin(asgiServer).bind(); // now fetch("/pyproc/api/...") reaches the kernel

// Opening SAB (the process OS) on hosting that cannot set headers, such as GitHub Pages:
// register, then reload once
await registerPyProcServiceWorker(assetIntegrity, { coi: true, scope: "/" });
```

`asgi` matches on the `pathname` prefix only, never on a substring of the whole URL. At root scope, `asgi: "/pyproc/"` intercepts only `/pyproc/api/...`; under a narrower scope it also supports `pyproc/...` beneath that scope. It never touches package asset paths such as `/node_modules/pyproc/...`. Registering at root scope requires the server to send the `Service-Worker-Allowed: /` header (see examples/serve.mjs).

Keeping this file in the same folder as `virtualOrigin.js` is a path contract. Do not assemble a `navigator.serviceWorker.register()` string yourself: that lets the manifest you verified and the file you actually registered drift apart.

### The same-origin runtime asset manifest

`PyProc`, `MachineContainer`, `WasiSession`, and `VirtualOrigin` each have a Worker, SharedWorker, or Service Worker entrypoint the browser opens directly. Those files fail if they exist only at a cross-origin CDN URL, so a product deploys them on its own origin while preserving the package's `src/` relative import structure.

```js
import { getPyProcAssetManifest } from "pyproc/assets";

const manifest = getPyProcAssetManifest({ baseURL: "/vendor/pyproc/" });
// manifest.assets:
// - processWorker        src/processOs/worker.js
// - machineWorker        src/processOs/machineWorker.js
// - wasiWorker           src/runtime/engines/wasi/wasiWorker.js
// - pyprocServiceWorker  src/capabilities/pyprocSw.js
```

This manifest is canonical for runtime-asset paths. A deployment pipeline uses the list as its copy set, its same-origin check, and the input to an SRI/hash manifest. v1 is a path, role, and policy contract; the actual worker import graph is connected all the way to a runtime preflight through the `pyproc-assets` output and the `assetIntegrity` option below.

In a Node deployment pipeline, the bundled CLI follows the relative import graph beyond the entrypoint and computes a per-file `sha256-...` SRI.

```bash
npx pyproc-assets --baseURL /vendor/pyproc/ --out public/vendor/pyproc-assets.json --copy-to public/vendor/pyproc
```

In the output JSON, `entrypoints[].graph` is the local import graph each Worker or SW actually pulls in, and `files[]` is the copy set with its SRI. `--copy-to` copies those graph files preserving their relative paths.

At runtime, hand that JSON straight in and the role's graph is fetched and SHA-256 verified before any worker is created.

```js
import { boot } from "pyproc";
import { verifyPyProcAssetIntegrity } from "pyproc/assets";

const assetIntegrity = await fetch("/vendor/pyproc-assets.json").then((r) => r.json());
await verifyPyProcAssetIntegrity(assetIntegrity, { roles: ["processWorker"] }); // explicit preflight

const machine = await boot({ assetIntegrity });
const os = await machine.proc({ lanes: 4 });
```

`boot({ assetIntegrity })` stores the manifest on the Runtime, and the `SyscallBridge` and `MachineContainer` created from that Runtime inherit it. Things used without a Runtime - `PyProc`, `JobControl`, `bootWasi` - take `assetIntegrity` in their own options. Because a browser cannot attach SRI attributes to the sub-imports of a module Worker, this verification is a preflight before spawn, and it assumes immutable deployment assets on your own origin. For the Service Worker, `registerPyProcServiceWorker()` verifies the `pyprocServiceWorker` graph first, and `pyprocSw.js?cache=1&coreIntegrity=<manifest>` re-verifies script, module, wasm, and zip fetches at the SW layer.

## The canonical persistent machine

For a product path where several tabs share one Python machine, `open({ persistent })` is canonical.

```js
import { open } from "pyproc";

const kernel = await open({ persistent: {
  name: "workspace",
  manifest: { packages: ["numpy"], setup: "import numpy", assetIntegrity },
} });

await kernel.run("counter = 41");
await kernel.commit();
console.log(kernel.status());
```

Note the variable name: this path returns a `KernelElection` handle, not the `PyprocMachine` that `boot()` and the other `open()` forms give you. Its `run` is asynchronous and it carries `commit`/`status` instead of `fs`/`history`/`proc`.

- `KernelElection` is the lower contract providing one Web Locks leader, BroadcastChannel RPC, a unique participant ID, and a persistent OPFS epoch. The leader kernel lives in its own document, so it keeps `crossOriginIsolated` along with the SAB and JSPI capabilities.
- `MachineJournal` puts the WASM heap delta and a `/home/web` snapshot into one commit. A new leader, and a new participant after every tab has closed, recover only the last completed commit.
- The SharedWorker-based alternative (`SharedKernel`) was removed. A SharedWorker is `crossOriginIsolated=false`, so it could not offer SAB interrupts, snapshot-fork, or persistent epoch recovery; `open({ persistent })` above is the single canonical multi-tab path.
- A request not yet sent can wait for a ready leader and then be sent once. A sent request follows the durable RPC state table below; `durable` alone never authorizes a resend.
- `status()` provides `participantId`, `leaderId`, `epoch`, `role`, `phase`, `recovered`, `lastCommitAt`, `participantCount`, `pendingRequests`, `durable`, and a concise `rpcSemantics` projection. Two leaders in the same epoch fail with `PYPROC_SPLIT_BRAIN`.
- `manifest.packages` and `manifest.setup` are the contract by which a new leader deterministically reproduces the same prepared environment. They are not a promise to revive, as they were, a native package installed mid-run, an open socket, a file descriptor, a DB connection, a Promise, or an arbitrary Python stack. Reopen external resources with `resume.py`.

### Durable RPC state table (normative)

This table is the semantic SSOT for a sent `KernelElection` request. "Portable known" means the caller controller owns a session and can prove that `hostProxySurfaces()` is empty. A normal follower does not own the leader's session, so its value is unknown even when the machine is durable. "Recorded" means the request outcome is in the recovered journal generation, not merely in the former leader's RAM cache.

| Event after send | Durable generation | Portable known | Outcome in recovered generation | Caller alive | Resend | Result and execution bound | Error |
|---|---|---|---|---|---|---|---|
| Response matches leader and epoch | Any | Any | Any | Yes | No | Resolve or reject with that response; one leader delivery | Leader result |
| Same request ID is delivered again to the same leader | Any | Any | RAM cache | Yes | Client does not initiate one | Return the served-cache response; do not execute again | Leader result |
| Leader changes | No | Any | No durable record | Yes | No | The former effect may or may not have run; no durable conclusion | `PYPROC_RPC_OUTCOME_UNKNOWN`, `retryable=false` |
| Leader changes | Yes | No or proxy present | Any | Yes | No | Fail closed because successor usability is not proven | `PYPROC_RPC_OUTCOME_UNKNOWN`, `retryable=false` |
| Leader changes | Yes | Yes | Yes | Yes | Once, with the same request ID | Successor returns the recorded result; no second execution | Recorded result |
| Leader changes | Yes | Yes | No | Yes | Once, with the same request ID | Successor executes against the last committed generation. The former leader may have executed only in discarded, uncommitted state; one effect enters durable history | Successor result |
| Leader stays live and the caller timer expires | Any | Any | Any | Yes | No | A late response is ignored; whether the leader ran is unknown | `PYPROC_RPC_OUTCOME_UNKNOWN`, `retryable=false` |
| Caller leaves or its browsing context disappears | Any | Any | Any | No | No | No participant continues the Promise. The leader may finish the one delivery | `PYPROC_RPC_OUTCOME_UNKNOWN` while `leave()` can still reject; otherwise no observer |

A request still waiting for a ready leader has not crossed the send boundary: `PYPROC_LEADER_UNAVAILABLE` is retryable there. `PYPROC_RPC_OUTCOME_UNKNOWN` is never retryable. A product must not issue a new request ID for the same effect unless it has its own idempotency policy. The installed-package browser gate fixes the normal follower boundary: forced leader loss rejects the in-flight call, does not replay it, and continues from the last commit. The structure gate fixes the conditional portable resend, outcome-record lookup, unsafe-heap refusal, fencing, and ordering branches.

**Virtual origin boundaries (the honest wall)**: these are synthetic SW responses, so they differ from a real origin. `tests/attempts/runtimeParity/virtualOriginBoundaryProbe.html` keeps measuring this boundary in a browser. (1) `Set-Cookie` is not exposed as a response header and is not stored. Do not depend on cookie sessions; use explicit tokens such as an `Authorization` header, a bearer token, or a signed URL. (2) A WebSocket upgrade is not intercepted by the Service Worker fetch event, so it never reaches ASGI dispatch. Design bidirectional streams with a separate relay or the SocketBridge family. (3) For streaming and SSE, `AsgiServer` accumulates the `http.response.body` chunks and returns one `Response`, so a product needing chunk-by-chunk UI updates must not depend on this path. (4) Endpoints must be `async def`; there is no synchronous dispatch.

After a revival - journal, session, or image open - process resources such as file handles and DB connections are not guaranteed by a heap delta alone. A `.pymachine` restores the Python heap and the `/home/web` file bytes, but open file descriptors, sockets, and DB connections must be reopened through `Init.resume(reason)` and `/home/web/resume.py`. The resource policy is canonical in [resumeCatalog.md](resumeCatalog.md). A signature is provenance verification, not a sandbox permission grant, so public-key distribution and the permission UI are managed separately; that policy is canonical in [trustPermissions.md](trustPermissions.md).

## Contract verification

- `npm test` checks that `package.json` exports expose only approved stable specifiers, that the public examples consume only the root API or subpath exports, and that `index.d.ts` covers the public type contract.
- `npm run test:consumer` verifies the installed-package contract from an isolated browser fixture that has no repo-relative imports and exposes only the installed `node_modules/pyproc`.
- That installed-package browser gate exercises `DeviceFs` file devices, the `JobControl` job lifecycle, the `MachineContainer` child-machine lifecycle, `MachineJournal` commit and recover, a force-removed `open({ persistent })` leader across three independent browsing contexts with a cold reopen of heap plus `/home/web` plus prepared environment, the permission-jail manifest, signed `.pymachine` export and open, trusted public key and wrong-key rejection, signer fingerprints, and reopening a SQLite connection from `/home/web/resume.py`.
- `pyproc/runtime` is the public Runtime wrapper from 0.0.11. The internal `runtime.js` core handles only the engine wrapper and `Runtime.fs`; the composition root `src/composition/runtimeApi.js` installs the `runtimeBindings.js` registry to provide opt-in capability factories such as `enableReactive`.
- The `restoreLive` execution boundary is machine-verified. Respect the boundary and restore is immediate with zero rehashing; violate it and the violation is detected automatically and promoted to the rehash path. Check which path ran through the returned `rehashed`.

### Installed-package browser gate coverage

`npm run test:package` and `npm run test:consumer` look only at the installed tarball's public specifiers, never at doc links or repo-relative imports. This table is the public surface actually verified against the installed package. The table data is canonical in [productConsumerCoverage.mjs](../../tests/browser/productConsumerCoverage.mjs).

| Gate | Exposed specifiers | Actual public surface | Contract verified |
| --- | --- | --- | --- |
| package surface | `pyproc`, `pyproc/assets`, `pyproc/history`, `pyproc/machine` | `boot`, `open`, `createWebComputer`, `checkEnvironment`, `getPyProcAssetManifest`, `verifyPyProcAssetIntegrity`, `registerPyProcServiceWorker`, a `commitState`/`openState` kernel round trip, `pyproc-assets` bin | package exports, stable subpath, `index.d.ts`, npm files, CLI graph copy and SRI manifest |
| installed package - asset path | `pyproc`, `pyproc/assets` | `getPyProcAssetManifest`, `verifyPyProcAssetIntegrity`, `registerPyProcServiceWorker` | An asset manifest rooted at `/node_modules/pyproc/`, worker graph SRI, registration of the installed `pyprocSw.js`, and rejection of a bad worker SRI before spawn |
| installed package - runtime/server | `pyproc` | `boot`, the machine runtime's `enableAsgiServer`, ASGI delegation wiring of the installed `pyprocSw.js` | Machine boot from the installed package, a Python ASGI app, a `fetch("/pyproc/...")` virtual-origin round trip, the S3 timing source |
| installed package - device filesystem | `pyproc` | machine runtime `enableDeviceFs` | Reading and writing `/dev/productState` and `/proc/meminfo` through the Python `open()` file contract on an installed-package machine |
| installed package - process OS | `pyproc` | the machine's `proc()` pool | Running pool `map` and `terminate` on the installed worker graph, rejection of a bad worker SRI before spawn, and no collision between the SRI and the ASGI Service Worker prefix |
| installed package - shell jobs | `pyproc` | `fork`/`repl`/`signal` on a `proc({ replay })` pool | Building an interactive namespace on the installed worker graph and running the `expr &`, `fg`, `kill`, `terminate` job lifecycle |
| installed package - machine container | `pyproc` | child kernels of the machine's `proc()` (a `setup` manifest plus `exec`/`kill`) | Spawning, running, measuring heapLen, killing a child machine on the installed worker graph, and rejecting calls after the kill |
| installed package - crash resume | `pyproc` | `boot({ deterministic: true })`, machine `history.commit`/`history.recover` | Leaving a reactive boundary on an installed-package `deterministic` machine with `history.commit()` and recovering product state in a new machine with `history.recover()` |
| installed package - immortal python machine | `pyproc` | `open({ persistent })`, the `KernelElection` handle | Three independent browsing contexts of the installed package sharing one Python state and prepared environment, confirming participant request IDs never collide and late responses are discarded, then continuing execution after the leader is force-removed through persistent epoch succession and recovery of heap plus `/home/web` from OPFS, and reopening from the last commit and the manifest environment after every context has closed |
| installed package - permission policy | `pyproc` | the machine `runtime` escape hatch (the `setGlobal` chokepoint plus the CSP `connect-src`) | Enforcement of a product permission manifest (`net=false`, `clipboard=false`, `home=true`, `workers=false`) and of the Python chokepoints |
| installed package - portable machine | `pyproc`, `pyproc/history` | `boot({ deterministic: true })`, `open(blob)`, `createStateKeyPair`, `exportStatePublicKey`, `fingerprintStatePublicKey`, machine `history.export({ signingKey })`, Runtime `enableInit` | Signed `.pymachine` plus `/home/web` export, signer fingerprint, untrusted and wrong-key rejection, trusted open, reopening the `resume.py` SQLite resource, the S4 timing source |
| installed package - web computer | `pyproc` | `createWebComputer` | Assembling a browser computer from the installed package alone: booting the Python guest, running code, and stopping the whole thing |

## Direction and boundaries

- Package-internal paths are private. Only root and documented subpath exports are public.
- UI and domain logic do not go into pyproc. pyproc provides runtime and capabilities only.
- Support: Chromium/Edge only (JSPI + SharedArrayBuffer + crossOriginIsolated). The page needs COOP/COEP headers.

## Runtime consistency (hard constraints)

- Default Pyodide: **v314.0.2 (CPython 3.14)**, loaded from a CDN by default. A supplied Pyodide loader must resolve the same version.
- **Self-hosting (distribution independence)**: CDN availability and policy are outside our control, so the whole distribution point can be moved. `npm run fetch:engine` prepares the full distribution (core plus every package wheel, 426MB) from GitHub Releases into `vendor/pyodide/`, and you consume it with `boot({ indexURL: "/vendor/pyodide/" })` - zero CDN traffic even for package installs and lock resolution. The full gate runs on the same switch: `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:browser` (measured 2026-07-13: 39/39 GREEN on the self-hosted path, with offlineBoot and swOffline re-measured GREEN). `indexURL` is recorded as a property of the booting kernel, so child workers (subprocess) use the same point and nothing leaks to a CDN.
- **Boot asset SRI (v2)**: `engineScriptIntegrity` attaches a standard `sha256-...` SRI to the `pyodide.js` script tag pyproc injects. `coreIntegrity` verifies the fetch-path indexURL assets (wasm, stdlib, lock, wheels) against the same SRI manifest, and in strict mode - the default - a missing manifest entry or a tampered OPFS cache converges to a boot failure. `assetIntegrity` fetches and SHA-256 verifies the local import graph of pyproc's Worker, SharedWorker, and WASI worker before spawn. `registerPyProcServiceWorker()` binds the Service Worker registration file to the same manifest, and the `coreIntegrity` mode of `pyprocSw.js` verifies, at the SW fetch event, even the Pyodide internal modules that a browser dynamic import pulls in outside the JavaScript `fetch` wrapper. Measured: `runtimeIntegrityProbe.html` GREEN 6/6; the Node gate's asset integrity preflight and assetManifest CLI GREEN; the browser gate's Service Worker registration path and SW `coreIntegrity` verification GREEN.
- **The WASI session (bootWasi/WasiSession) is a separate async surface on the `pyproc/wasi` subpath.** It is additive and independent of the Pyodide-based surfaces (boot/Runtime/PyProc/ReactiveController). It is an opt-in for proving engine independence, with `wasmURL` supplied by the caller and self-hosted under COOP/COEP. Constraints: the value bridge is JSON-serializable only (no FFI), native extensions are impossible (static linking), and a cross-engine `.pymachine` is not possible. For production Python the Pyodide surface is canonical.
- Bundler contract: types resolve under `moduleResolution: "Bundler"` with `allowJs: false`, and Vite emits `new Worker(new URL(...))` as a worker chunk under the installed-package gate.

## Package surface boundary

This repository records only the package contract and its executable gates. Root `boot()` returns a
`PyprocMachine`; `pyproc/runtime` provides Runtime-only boot and loaded-engine adoption; the
public `pyproc-assets` executable emits hosted runtime assets. Package-internal paths are never public.

## Adopting a self-booted Pyodide (optional pattern)

If a worker already has a self-booted Pyodide, adopt that instance rather than calling pyproc's `boot()` a second time:

This pattern imports `pyproc/runtime`, available from 0.0.11.

```js
// In a worker that already owns a self-booted Pyodide
const py = await loadPyodide({ indexURL });
// Layer pyproc capabilities on top of it (do not create a second interpreter)
import { Runtime } from "pyproc/runtime";

const rt = new Runtime(py);              // Runtime(py) wraps a loaded Pyodide instance
const asgi = rt.enableAsgiServer({ app: "app" });   // the in-kernel server
rt.setInterruptBuffer(interruptSab);     // cancel a runaway synchronous UDF (SIGINT)
const raw = rt.getGlobal("myUdf");
const fn = rt.toHostValue(raw, { proxyMode: "copy", fallback: null }); // normalize to a host function
const out = fn(1, 2);
rt.destroyHostValue(raw);
```

- `new Runtime(py)` wraps a loaded Pyodide in an adapter. A custom engine must declare `engineContractVersion`, `engineKind`, `capabilities()`, and the required methods.
- `setInterruptBuffer(sab)`: write a signal number into `[0]` of that SAB (2 is SIGINT) and running Python is cancelled. This is reachable through the contract, with no engine `raw`.
- `getGlobal(name)` returns the engine proxy as is. Normalize the return value into a host value with `toHostValue(raw, options)` and release it with `destroyHostValue(raw)` when done.
- `toHostValue(value, { proxyMode, fallback })` is the engine-neutral value bridge. `proxyMode` is `copy` or `preserve`, and the adapter translates it into engine-specific options. Without a `fallback`, a conversion failure propagates as a throw.
- The Pyodide `Runtime` and `WasiSession` implement a minimum RuntimeContract sharing `runtimeContractVersion=1`, `runtimeKind`, `capabilities()`, `runAsync`, and the global and value bridges. Synchronous execution and heap access are capability differences.
- The WASI session (`bootWasi`) is a separate async surface with a JSON-only value bridge. Products that depend on C extensions such as polars and pyarrow use the Pyodide engine path.

The runtime wrapper, engine contracts, and installed-package gates are the maintained wiring record.
