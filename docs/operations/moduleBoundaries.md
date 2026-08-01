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
