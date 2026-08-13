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
real Pyodide Workers, persists Python heap plus `/home/web`, terminates the original Worker, restores into a
distinct Worker, restarts the browser process with the same profile, rebuilds Fleet registration, and cold-opens
the same IndexedDB HEAD. The installed-package gate repeats the public subpath lifecycle from a packed npm
artifact.

Run:

```bash
npm run test:contracts
node tests/browser/run.mjs tests/webMachine/browser/probes/machineFleetProbe.html
npm run test:installed
```
