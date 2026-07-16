# Security

## Reporting

Report vulnerabilities via GitHub security advisories on this repository (preferred) or a
private issue to the maintainer. Please do not open public issues for unpatched problems.

## Threat model in one page

pyproc runs real CPython inside the browser tab: Chrome's renderer sandbox plus WASM
isolation. That boundary protects the **user from the code** (escape hardening), not your
secrets from the user, and not the tab from resource exhaustion. Products still own CPU,
memory, and network budgets.

### Machine files are executables

A `.pymachine` is live interpreter state plus a boot manifest whose `setup` runs on open.
Treat it exactly like an executable download. `openMachine` refuses untrusted files:
either the file carries a signature verifiable by a key you pass in `trustedPublicKeys`,
or you explicitly accept the risk with `trust: true`. Integrity is a full-envelope SHA-256
(header and payload both authenticated; the v1 format that authenticated only the delta is
rejected). Signing is WebCrypto ECDSA P-256; `fingerprintMachinePublicKey` gives the
stable `sha256:<hex>` shown in approval UIs. Signature verifies **origin**, not safety:
key distribution and permission UI belong to the product
(see [trustPermissions](docs/consuming/trustPermissions.md), Korean).

### Supply chain: every executed byte is pinned

- npm publishing uses Trusted Publishing (OIDC) with provenance; manual publishes are
  disabled by policy.
- The `pyproc-assets` CLI emits an SRI manifest over the worker/service-worker import
  graph; `verifyPyProcAssetIntegrity` enforces it **before any worker spawns**, and
  `registerPyProcServiceWorker` registers the service worker only from a verified graph.
- Engine boot supports `engineScriptIntegrity` / `coreIntegrity` (fail-closed SRI on the
  Pyodide script and core assets) plus an OPFS offline cache that re-verifies on read.

### Deterministic boot window

`bootSession` stubs `crypto.getRandomValues`, `Date.now`, and `performance.now` for the
duration of the boot so replays are byte-identical; the stub is tab-global while it lasts.
Product code running concurrently in the same tab during that window would read the stub
entropy. pyproc serializes all of its own global-patching windows behind one internal
mutex, and reseeds Python's `random` immediately after the boundary (cp0) is captured.
If your product generates keys or nonces at page start, do it before or after machine
boot, not concurrently with it.

### Jail boundaries are two-tier and honestly labeled

`MachineJail`'s Python chokepoints are cooperative (bypassable via `import js`); the real
wall is the CSP (`connect-src`) the product applies to the jail context. Do not present
the Python tier alone as a security boundary.

### Revival never fakes continuity

Journal recovery refuses foreign state: a generation whose replay fingerprint (h0) does
not match the current engine/manifest fails with `PYPROC_REPLAY_MISMATCH` instead of
silently corrupting the heap, and corrupted stores fail loudly rather than masquerading
as a first boot. RPCs cut off mid-flight report `PYPROC_RPC_OUTCOME_UNKNOWN` and are never
auto-replayed.
