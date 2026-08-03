# Module boundaries

pyproc divides modules by reason to change and dependency direction, not by file count. Implementation,
composition, policy, and verification have separate owners without widening the public surface.

## Runtime composition

- `src/runtime/` owns the engine wrapper and the minimal Runtime contract.
- `src/capabilities/` owns optional capabilities and does not import composition.
- Clusters under `src/composition/runtimeBindings/` own capability construction rules.
- `src/composition/runtimeBindings.js` only merges clusters, rejects duplicates, and installs prototypes.
- Adding a capability must not add a class import to a central installer.

The current clusters are:

| Cluster | Responsibility |
|---|---|
| `state` | Reactive checkpoints and the durable journal |
| `service` | Syscalls, ASGI, virtual origins, and terminals |
| `environment` | Wheel cache, device filesystem, and init |

## Policy and mechanism

Keep state-changing mechanisms separate from pure policy such as input normalization and budget checks.
`src/capabilities/reactive/retentionPolicy.js` owns reactive-retention normalization and budget decisions.
`ReactiveController` only observes, runs pruning, and emits pressure events.

## Contract verification

- Each suite in `tests/contracts/` exports exactly one `assert*` function.
- `tests/contracts/run.mjs` discovers suites automatically.
- Shared fixtures and helpers belong to the runner helper allowlist and must not masquerade as suites.
- Synchronous checks cannot receive a Promise. Asynchronous contracts use `checkAsync`.
- `tests/browser/gate.html` is a document shell; `tests/browser/gate.js` owns execution.

## Public surface

An internal module split is not a reason to add a package export. A new subpath or root value must first
meet the exit criteria in the [Experimental freeze policy](experimentalFreeze.md). Each public subpath owns
its sibling `.d.ts`; ambient modules do not accumulate in the root declaration.

## Runtime assets

The Buildroot guest is reproducible from the official release archive SHA-256, matching revision, config,
legal-info, and SBOM contract under `scripts/buildroot/`. `.github/workflows/buildroot-guest.yml` owns the
Linux build and evidence retention. Promoting a generated artifact into the development catalog requires a
separate review after its digest and provenance have been reconciled.

## Layer ranks

The layer contract is a total order, and every import edge must point downward. Peers do not import peers.

| Rank | Folder | What lives there |
|---:|---|---|
| 0 | `runtime/` (0) | The engine core and cross-cutting concerns behind capability contracts |
| 1 | `state/` (1) | The durable half of the state kernel: object model, ref CAS, signing core |
| 2 | `capabilities/` (2) | Optional capabilities installed onto a runtime as `(rt, cfg)` |
| 3 | `composition/` (3) | Registry installation and the public surface |
| 4 | `session/` (4) and `processOs/` (4) | Session revival and the process OS |
| 5 | `machine/` (5) | The browser computer host and its guests |

`machine/` has its own internal order, and the folder is the rank: `contracts/` and `host/` are `pure`,
`devices/`, `image/`, and `persistence/` are `platform`, `guests/` is `guests`, and `composition/` plus the
layer barrel are `composition`. A pure file names no guest and no engine, reaches for no browser global, and
imports only other pure files. That set used to be a hand-kept list of file paths, which meant a new file was
silently exempt from the purity check until someone remembered to register it; it is now derived from the
folder, so a new file is checked by default.

The only upward edge is a worker asset URL, not an ESM import: a capability may point at a worker entrypoint
that lives above it, because the spawning side has to know where the worker file is. Those edges are
enumerated in `tests/run.mjs`, and the asset manifest publishes the same paths as a consumer contract. A
worker spawned through an injected URL cannot be resolved statically, so it must be declared in the same
place; the gate refuses an undeclared one.

### Why the type graph does not mirror the value graph

`src/runtime/index.d.ts` imports its type names from the root declaration, which looks like an upward edge.
It is not a violation to fix by moving those declarations down. The public `Runtime` type names capability
types (`AsgiServer`, `MachineJail`, `SyscallBridge`, `ReactiveController`, and others), so it is a
composition-rank type by construction, and the `pyproc/runtime` subpath ships that composed runtime rather
than a rank-0 core. Moving the declaration down would drag every capability type with it. The type surface
therefore keeps its definitions at the composition root and the subpath re-exports them.
