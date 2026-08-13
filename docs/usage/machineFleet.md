# Hibernating Machine Fleet

Use `createMachineFleet` when an application has many durable project computers but should keep only a bounded
number of execution owners resident. Use `open({ name })` for one durable Python Machine. Fleet is the higher
level choice for multiple whole `WebComputer` instances.

## Create a durable computer factory

Fleet registration persists identity in application configuration. Executable factories cannot be serialized,
so after a browser restart the application re-registers the same Machine IDs and environment fingerprints. Each
factory must bind the same durable store and group ID. The group HEAD is the durable state of that member.

```js
import {
  IndexedDbMachineStore,
  createMachineFleet,
  createWebComputer,
} from "pyproc/machine";

const store = new IndexedDbMachineStore({
  indexedDb: globalThis.indexedDB,
  databaseName: "my-product-machines",
});

let ownerSerial = 0;
function createProjectComputer({ machineId, environmentFingerprint }) {
  const computer = createWebComputer({
    createMachines: false,
    python: {
      onWorkerLifecycle(event) {
        console.debug(machineId, event.state, event.workerId);
      },
    },
    durability: {
      groupId: `project/${machineId}`,
      store,
      ownerId: `${machineId}/${++ownerSerial}`,
      environmentFingerprint,
    },
  });
  const runtime = computer.host.createMachine({
    machineId: "runtime",
    adapterId: "pyproc-worker",
    manifest: { session: { indexURL: "/vendor/pyodide/" } },
    permissions: { devices: ["console", "network"] },
  });
  computer.adoptMachines(new Map([[runtime.machineId, runtime]]));
  return computer;
}

const fleet = createMachineFleet({ hotLimit: 2 });
for (const machineId of ["accounts", "forecast", "audit"]) {
  fleet.register({
    machineId,
    environmentFingerprint: "pyodide-v314.0.2/app-manifest-sha256:...",
    createComputer: createProjectComputer,
  });
}
```

The default `pythonOs` guest is in-process. This example deliberately assembles a `pyproc-worker` Machine so
termination reclaims a dedicated Python execution owner. Fleet does not rename an in-process pause as memory
reclamation.

## Acquire, use, release

```js
const lease = await fleet.acquire("forecast", "refresh model");

const value = await fleet.use(lease, (computer) =>
  computer.machine("runtime").request({
    type: "run",
    code: "forecast.refresh()",
  }),
);

fleet.release(lease, {
  activeCommands: 0,
  pendingApprovals: 0,
  unresolvedEffects: 0,
  outcomeUnknown: false,
  unsaved: false,
});
```

`use()` is the command fence. Do not retain the supplied `computer` and use it outside the callback. A later
resume creates a new owner, and the previous lease must fail.

If `release()` omits the terminal, the Machine is conservatively marked unsaved and cannot be selected for
automatic suspension. Pass an explicit empty object only when the surrounding workflow proves the safe terminal.

## Explicit suspend and resume

The same released lease can request an explicit suspend:

```js
const receipt = await fleet.suspend("forecast", { lease });
console.log(receipt.terminal, receipt.generationId);

const nextLease = await fleet.resume("forecast", "continue model work");
```

`suspend()` succeeds only after the generation is the reread durable HEAD and all owned runtimes terminate. A
commit failure leaves the Machine hot and unsaved. A cleanup failure returns
`WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE` and keeps the hot slot occupied until the product resolves or disposes
the remaining owner.

After the underlying adapter or platform fault is resolved, call `fleet.retryCleanup(machineId)`. It retries
only adapter termination and owner release for the already verified generation. It does not rerun commands or
publish another generation.

You can use the lower `WebComputer.suspend({ safety })` and `WebComputer.resume()` lifecycle directly for one
computer. Fleet adds admission and stale-lease fencing across computers.

## Hot limit and pins

```js
await fleet.setHotLimit(3);
console.log(fleet.inspect());
```

The default candidate policy is safe LRU. `pinned: true` excludes a registration from automatic suspension.
`chooseCandidate(candidates)` can add product priority, but it can return only an eligible ID. If every hot
Machine is active, pinned, unsaved, awaiting approval, unresolved, or outcome-unknown, admission fails with
`WEB_MACHINE_FLEET_CAPACITY`.

## Prefetch is not warm

A registration may provide `prefetch()`. Its receipt records an environment fingerprint and byte length. It may
populate an engine or wheel cache, but does not create a live Machine and does not consume a hot slot. The public
lifecycle intentionally has no ambiguous warm state.

## Restart and multiple tabs

After a browser process restart, rebuild registration from product configuration with the same Machine ID,
group ID, store, and environment fingerprint. The next `acquire()` claims a newer owner epoch and restores HEAD.
The durable owner coordinator uses Web Locks plus the store epoch, so another tab cannot commit with a stale
owner. A Fleet registration does not serialize JavaScript factories or transfer permissions.

## Client boundary

`createMachineFleet` is a browser JavaScript composition API because each registration supplies an executable
`createComputer` factory and browser-owned Worker, lock, and storage capabilities. The command-line Control
product, MCP adapter, and Python guest do not serialize or impersonate that authority. They continue to operate
their individual Machine surface. Cross-client session discovery and handoff require a durable registry above
the Fleet rather than a second lifecycle hidden in each client.

[Execution Memory](executionMemory.md) is that optional index for installed and direct hosts. Fleet alone owns
the act of terminating execution owners. Execution Memory accepts a `cold` Machine link only when the caller
supplies the completed Fleet suspend receipt for the exact Machine, generation, and environment with no pending
cleanup. A portable Control image remains `portable`, even when no Control process is currently running.

## Inspect without false memory claims

`fleet.inspect()` returns `hotLimit`, lifecycle counts, generation IDs, lease state, terminal safety, prefetch
receipts, and resource-owner counts. A cold record has zero Workers, runtimes, device leases, and timers. A hot
guest's timer count may be unknown. Do not turn this into an exact MB promise. Browser RAM and process reuse are
controlled by Chromium.

## Verification

```bash
npm run test:contracts
npm run test:web-machine
npm run test:installed
```

The browser lane verifies actual Worker termination, fresh-Worker recovery, `/home/web`, hot admission, unsafe
effect refusal, stale leases, and registry rebind after a real browser-process restart.
