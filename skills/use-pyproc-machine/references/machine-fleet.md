# machine-fleet

## Contents

- Hibernating Machine Fleet
- Create a durable computer factory
- Acquire, use, release
- Explicit suspend and resume
- Hot limit and pins
- Prefetch is not warm
- Restart and multiple tabs
- Client boundary
- Inspect without false memory claims
- Verification
- Hibernating Machine Fleet specification
- 1. Contract boundary
- 2. States
- 3. Lease law
- 4. Safe terminal
- 5. Suspend protocol
- 6. Resume protocol
- 7. Hot admission
- 8. Resource accounting
- 9. Errors
- 10. Evidence

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
    manifest: { kernel: {} },
    permissions: { devices: ["console", "network"] },
  });
  computer.adoptMachines(new Map([[runtime.machineId, runtime]]));
  return computer;
}

const fleet = createMachineFleet({ hotLimit: 2 });
for (const machineId of ["accounts", "forecast", "audit"]) {
  fleet.register({
    machineId,
    environmentFingerprint: "cpython-wasi-3.14.6/app-manifest-sha256:...",
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

[Execution Memory](./execution-memory.md) is that optional index for installed and direct hosts. Fleet alone owns
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

# Hibernating Machine Fleet specification

This specification defines the contract by which pyproc keeps a bounded number of durable Web Computers
resident and leaves inactive computers as verified generations. It does not claim that a browser uses no
host memory. It claims that a cold Fleet member owns no live computer, guest runtime, Worker, device lease,
or guest timer through the Fleet.

## 1. Contract boundary

A Fleet member is a durable `WebComputer`, not an individual guest inside one computer. A generation commits
all guest snapshots and block devices together. Suspending only one guest would break that atomic boundary.

The product has three independent owners:

| Owner | Responsibility |
| --- | --- |
| `MachineCommitCoordinator` | Content-addressed generation, fenced HEAD, recovery window, environment pin |
| durable `WebComputer` | Drain, pause, commit, verify, terminate adapters, release owner |
| `MachineFleet` | Registration, lease freshness, hot admission, safe candidate selection |

Fleet policy does not enter guest adapters or the state kernel. A product supplies `createComputer` and keeps
project metadata outside the kernel.

## 2. States

The public lifecycle is:

```text
registered -> waking -> hot -> draining -> committing -> stopping -> cold -> waking
                                      \-> cleanupIncomplete
any failed wake or rollback boundary -> failed or the previous safe state
```

- `registered` has identity, an environment fingerprint, and a computer factory, but no live runtime.
- `waking` is acquiring the durable owner and booting or restoring the exact HEAD.
- `hot` can accept a fresh lease and owns a live `WebComputer`.
- `draining` rejects new Fleet leases and waits for accepted `use()` calls to finish.
- `committing` snapshots paused guests and flushed block devices into one fenced generation.
- `stopping` terminates adapters and releases ownership after HEAD verification.
- `cold` retains the generation identity but no live computer reference.
- `cleanupIncomplete` means a generation is durable but at least one execution owner could not be proven gone.

`paused` is a guest state under a hot computer. It is never a synonym for cold. Prefetched assets are a cache
receipt, not a Machine state.

## 3. Lease law

`acquire(machineId, purpose)` returns a lease bound to four values: Machine identity, Fleet lease ID, Fleet
epoch, and durable owner epoch. `use`, `release`, and explicit `suspend` validate all applicable values.
Reacquiring a Machine advances the Fleet epoch. Cold resume acquires a newer durable owner epoch. A lease from
before either transition is stale and cannot mutate the new owner.

One Fleet lease may be active for a Machine at a time. `use()` counts active operations. `release()` refuses
while an operation remains active. Lifecycle mutations are serialized so concurrent wake calls cannot both
consume the same hot slot.

## 4. Safe terminal

The caller reports a terminal with these fields:

```json
{
  "activeCommands": 0,
  "pendingApprovals": 0,
  "unresolvedEffects": 0,
  "outcomeUnknown": false,
  "unsaved": false
}
```

An omitted release terminal is conservative and sets `unsaved: true`. Automatic suspension requires every
counter to be zero, both booleans to be false, no active lease, no active `use()` call, and no pin. Active
commands, pending approval, unresolved external effects, unknown outcomes, failed commits, and pinned Machines
are never automatic candidates.

The Fleet can validate only the terminal it is given. An effect system must derive these fields from its own
durable intent and outcome ledger. Page content and model inference are not approval authority.

## 5. Suspend protocol

The normative order is:

```text
validate fresh released lease and safe terminal
-> fence Fleet admission
-> drain accepted use calls
-> pause running guests
-> flush devices and capture portable snapshots
-> commit with owner fence and environment h0
-> reread and verify durable HEAD
-> terminate adapters and Worker owners
-> release durable owner
-> remove the live computer reference
-> publish cold
```

Failure rules are strict:

- A pause or commit failure resumes guests that were running, marks the computer unsaved, and performs no
  shutdown.
- An environment or HEAD mismatch performs no shutdown.
- A shutdown or owner-release failure after commit is `cleanupIncomplete`, not cold.
- `retrySuspendCleanup()` or Fleet `retryCleanup()` retries only termination and owner release against the
  already verified generation. It never commits or replays guest work again.
- Prune failure does not invalidate the committed HEAD, but remains visible as cleanup pending.
- No automatic retry is inferred for an unresolved external effect.

## 6. Resume protocol

A cold resume constructs a new durable `WebComputer`, acquires a new owner epoch, reads HEAD, rejects an
environment fingerprint mismatch before applying payload bytes, restores every guest and block device, resumes
paused guests, and publishes a fresh Fleet lease only after readiness.

The environment fingerprint is stored as the state kernel commit `env.h0`. Products should derive it from the
exact engine, adapter versions, asset manifest, guest manifest, and package set. Changing any of those inputs
requires a new fingerprint and makes an old generation fail closed.

Runtime resources outside snapshot bytes are not portable. The adapter rebinds declared devices. Applications
must reopen sockets, file descriptors, permissions, and database connections using their resource catalog and
resume hook. A signature proves provenance, not permission.

## 7. Hot admission

`hotLimit` is an admission limit over records that still retain a live computer reference. Before waking a cold
target, the Fleet repeatedly suspends an eligible candidate until a slot exists. The default policy is safe LRU.
A custom selector may choose only from the supplied eligible set. Returning an ineligible ID is a policy error.

If no safe candidate exists, `WEB_MACHINE_FLEET_CAPACITY` is returned. The Fleet does not force-stop active or
unknown work to satisfy the number. Lowering the limit follows the same rule and leaves the old limit in force
when it cannot complete safely.

## 8. Resource accounting

`inspect()` reports lifecycle counts and per-Machine resources. A hot Worker-hosted guest reports its stable
Worker identity through the adapter lifecycle observer. A cold member reports exact zeros because the Fleet has
removed the live computer reference after termination. Guest timers are `null` while a hot runtime cannot expose
them and zero only when no runtime exists.

Memory in MB is deliberately not a public contract. Chromium controls garbage collection, process reuse, and
when terminated Worker pages return to the operating system. Worker termination and owner reachability are the
normative evidence. Process-memory deltas are diagnostic artifacts only.

## 9. Errors

The stable error axis is `WebMachineError.code`:

| Code | Meaning |
| --- | --- |
| `WEB_MACHINE_FLEET_CAPACITY` | No safe candidate can satisfy hot admission |
| `WEB_MACHINE_FLEET_LEASE_STALE` | Lease or owner epoch no longer matches |
| `WEB_MACHINE_FLEET_UNSAFE` | Terminal, pin, command, or lifecycle blocks suspend |
| `WEB_MACHINE_ENVIRONMENT_MISMATCH` | Durable generation and requested environment differ |
| `WEB_MACHINE_SUSPEND_COMMIT_UNVERIFIED` | New commit is not the reread durable HEAD |
| `WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE` | HEAD is durable but execution cleanup is not proven |

The complete union is in `pyproc/machine` types.

## 10. Evidence

The source contract suite uses the real durable coordinator and portable fake guest to test exact values,
commit failure, runtime and owner cleanup failure, stale leases, and unsafe admission. The browser probe uses
real owned CPython WASI workers, persists the portable kernel snapshot, terminates the original Worker, restores into a
distinct Worker, restarts the browser process with the same profile, rebuilds Fleet registration, and cold-opens
the same IndexedDB HEAD. The installed-package gate repeats the public subpath lifecycle from a packed npm
artifact.

Run:

```bash
npm run test:contracts
node tests/browser/run.mjs tests/webMachine/browser/probes/machineFleetProbe.html
npm run test:installed
```
