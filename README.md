# pyproc

pyproc is a browser computer built around an owned, worker-hosted CPython 3.14 WASI kernel. The npm
package includes the verified engine and standard library, so the default runtime does not require a
separate engine download or a remote execution service.

## Install

```sh
npm install pyproc
```

Serve the installed package from the same origin as your application. The supported production browser
boundary is current Chromium and Edge with `SharedArrayBuffer` and cross-origin isolation enabled.

## Run Python

```js
import { boot } from "pyproc";

const machine = await boot();
const receipt = await machine.run.python("print(sum(range(100)))");

console.log(receipt.output); // 4950
await machine.close();
```

Every execution returns a structured receipt. Python exceptions produce a stable `PyProcError` with
`code === "PYPROC_KERNEL_EXECUTION_ERROR"`. Values cross the worker boundary through versioned value
envelopes:

```js
await machine.run.set("settings", { locale: "ko-KR", retries: 3 });
const settings = await machine.run.get("settings");
```

## Checkpoints and Machine images

```js
import { boot, open } from "pyproc";

const machine = await boot({ deterministic: true });
await machine.run.python("counter = 41");

const checkpoint = await machine.history.checkpoint();
await machine.run.python("counter = 99");
await machine.history.restore(checkpoint);

const image = await machine.history.export();
await machine.close();

const restored = await open(image);
console.log(await restored.run.get("counter")); // 41
await restored.close();
```

A Machine image contains a verified engine reference and content-addressed checkpoint objects. It does not
duplicate the engine binary. A wrong engine identity, corrupt checkpoint, missing parent, or digest mismatch
fails before the restored worker becomes active.

## Processes

```js
const parent = await boot();
await parent.run.python("value = 21");

const { process } = await parent.proc.clone();
const result = await process.execute("print(value * 2)");
console.log(result.output); // 42

await process.close();
await parent.close();
```

Each process owns a separate worker and kernel. Clone starts from a verified checkpoint, never from a live
heap view.

## Packages and terminal

`machine.createPackageEnvironment()` installs pure Python wheels selected from standard Simple API metadata,
with hash, tag, `Requires-Python`, marker, and yanked-policy checks. Curated native modules are bound to an
exact engine profile. Unsupported binary wheels fail before installation with
`PYPROC_PACKAGE_ABI_UNSUPPORTED`.

`machine.terminal()` exposes the version 2 terminal contract. Its `%pip install` command routes through the
same package environment and does not bypass package policy.

## Host capabilities

The `pyproc/wasi` subpath exports `HostCapabilityBroker` and `ProductHostCapabilityPort`. HTTP, socket relay,
ASGI, process, GPU, clipboard, framebuffer, and artifact effects require explicit authority and cross the
versioned hostcall ABI. Browser objects and live Python objects are not durable state.

```js
import {
  HostCapabilityBroker,
  ProductHostCapabilityPort,
  createFetchHostAdapter,
} from "pyproc/wasi";

const broker = new HostCapabilityBroker({
  authorize: ({ capability }) => capability === "http.fetch",
});
const port = new ProductHostCapabilityPort({
  http: createFetchHostAdapter(fetch.bind(globalThis)),
});
port.install(broker);
```

## WebComputer

`createWebComputer()` composes the owned kernel guest with WebMachine devices, signed images, ownership,
and optional durable storage. The default Python guest uses the same `KernelMachine` and Machine image
contract as root `boot()` and `open()`.

## Package subpaths

| Subpath | Contract |
|---|---|
| `pyproc/runtime` | Kernel runtime, session, process, package, and Machine composition |
| `pyproc/history` | Content-addressed state objects, stores, bundles, and signed tags |
| `pyproc/machine` | WebMachine host, devices, images, fleet, and kernel guest |
| `pyproc/assets` | Same-origin worker asset manifest and integrity verification |
| `pyproc/wasi` | Low-level session, kernel, hostcall, package, and factory contracts |
| `pyproc/gpu` | GPU host adapter |
| `pyproc/socket` | Socket relay host adapter |
| `pyproc/control` | Local control protocol client and registries |

## Control and browser automation

Use `PyProcControlClient` from `pyproc/control` for a supported JavaScript client, or the installed
`pyproc-control` command for a language-neutral NDJSON connection. Both use the same strict manifest,
operation catalog, cancellation rules, and verified attachment framing.
The effect-free doctor also returns one structured first-result action mapped to shell, JavaScript, Python, and
MCP, with `machine.run` as the canonical meaning.

Legacy semantic observation keeps each response at 1,000 nodes or fewer. A result with `continuationRef` can be
continued with a continuation-only `automation.observe` call. Every page carries the same document epoch,
snapshot receipt, complete-inventory digest, and observation evidence binding. A document replacement rejects
the old continuation instead of treating a partial prefix as complete.

`automation.space.inspect` also returns one provider-neutral `resources` snapshot. After deleting owned
artifacts, detaching sessions, and closing owned targets, every counter returns to the starting baseline. A new
isolated profile therefore returns zero for targets, sessions, locators, continuations, watchers, artifacts,
perception ledgers, transport sessions, pending commands, and listeners.

Start with [Machine Entrance](skills/use-pyproc-machine/references/machine-entrance.md), then use the
[JavaScript Control SDK](skills/control-pyproc/references/javascript-control.md), the
[Python SDK](skills/control-pyproc/references/python-sdk.md), or the complete
[Control Protocol](skills/control-pyproc/references/control-protocol.md). These files are included in the npm
package, and the package gate verifies every relative README link against the packed install.

## Verification

```sh
npm test
npm run test:types
npm run test:package
npm run test:installed
```

The installed-package gate packs and installs the real tarball, boots the included engine in Chrome and
Edge, checks package installation, checkpoint restore, offline image reopen, process clone, terminal behavior,
and verifies that the clean boot makes no undeclared external engine request.

See [API reference](skills/reference-pyproc-api/references/api.md), [platform requirements](skills/use-pyproc-runtime/references/platform-requirements.md),
and [kernel factory contract](skills/use-pyproc-runtime/references/kernel-contracts.md).

## Maintained knowledge

Start with [the PyProc skill router](skills/start-pyproc/SKILL.md). It selects the relevant maintained skill and the
required verification gates without loading the full knowledge tree. The npm package includes the same digest-bound
skill catalog used by the read-only `skills.search` and `skills.read` MCP tools.

## License

[Mozilla Public License 2.0](LICENSE). Copyright 2026 eddmpython.
