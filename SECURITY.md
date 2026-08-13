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
Treat it exactly like an executable download. `open(blob, trustOpts)` refuses untrusted files:
either the file carries a signature verifiable by a key you pass in `trustedPublicKeys`,
or you explicitly accept the risk with `trust: true`. Integrity is a full-envelope SHA-256
(header and payload both authenticated; the v1 format that authenticated only the delta is
rejected). Signing is WebCrypto ECDSA P-256; `fingerprintStatePublicKey` (from `pyproc/history`) gives the
stable `sha256:<hex>` shown in approval UIs. Signature verifies **origin**, not safety:
key distribution and permission UI belong to the product
(see [trustPermissions](docs/usage/trustPermissions.md), Korean).

### Supply chain: every executed byte is pinned

- npm publishing uses Trusted Publishing (OIDC) with provenance; manual publishes are
  disabled by policy.
- The `pyproc-assets` CLI emits an SRI manifest over the worker/service-worker import
  graph; `verifyPyProcAssetIntegrity` enforces it **before any worker spawns**, and
  `registerPyProcServiceWorker` registers the service worker only from a verified graph.
- Engine boot supports `engineScriptIntegrity` / `coreIntegrity` (fail-closed SRI on the
  Pyodide script and core assets) plus an OPFS offline cache that re-verifies on read.

### Generated Machine profiles do not grant hidden authority

`pyproc-mcp init` compiles a named recipe into the same strict version 1 manifest used at runtime. The default
`pythonOnly` recipe contains no automation action or CDP authority. Browser recipes require exact origins and
preserve the canonical risk of every action; wildcard origins are rejected. Initial navigation still requires a
purpose and explicit effect acknowledgement even when the action catalog is read-only.

The initializer stays inside the selected project root, refuses existing generated files without
`--overwrite`, and never writes credentials, a default browser profile, or a repository command. Run
`pyproc-control doctor` before startup to verify the local engine chain and authority without launching a browser
or sending a target request. Generated `.pyproc/` files are policy and client configuration, so review them like
other executable configuration and keep recording paths private.

### Perception never grants itself authority

APX `entityRef` values identify observations, and `locatorRef` values bind targets. Neither grants permission.
Only a broker-issued authorized affordance may carry an effect, and its `actionContext` is bound to the exact
session, situation, world, document epoch, action, destination, risk, expiry, and expected transition. A stale
or mismatched binding fails before the provider receives the effect.

Treat `focus.objective`, page text, accessibility labels, reported tools, screenshots, OCR, and model inference
as untrusted data. They cannot widen manifest authority or approval. Objectives are retained in Control inputs
and recordings, so do not place secrets in them and protect recording files as sensitive artifacts. An
`outcomeUnknown` effect is never safe to resend automatically.

### Repository verification never executes prose

Verified Change Loop treats `EYES.md`, page content, scenario purpose, visual references, and generated reports as
untrusted data. Only strict version 1 JSON fields can describe routes, APX requirements, typed actions, rules, and
quotas. Paths stay inside the contract or repository root, wildcard origins fail, local fixture and reference
bytes must match pinned digests, and no repository shell command is started.

The Experience Contract can only narrow an already authorized Machine profile. Every non-read action requires a
current broker affordance, an exact risk match, and an explicit postcondition. `outcomeUnknown`, missing evidence,
environment mismatch, cleanup failure, and artifact quota failure cannot become `verified`. Pack SHA-256 values
detect mutation but do not authenticate the producer or constitute human approval. Protect packs as potentially
sensitive product data.

### Deterministic boot window

`boot({ deterministic: true })` stubs `crypto.getRandomValues`, `Date.now`, and `performance.now`
for the duration of the boot so replays are byte-identical; the stub is tab-global while it lasts.
Product code running concurrently in the same tab during that window would read the stub
entropy. pyproc serializes all of its own global-patching windows behind one internal
mutex, and reseeds Python's `random` immediately after the boundary (cp0) is captured.
If your product generates keys or nonces at page start, do it before or after machine
boot, not concurrently with it.

### Jail boundaries are two-tier and honestly labeled

`MachineJail`'s Python chokepoints are cooperative (bypassable via `import js`); the real
wall is the CSP (`connect-src`) the product applies to the jail context. Do not present
the Python tier alone as a security boundary.

Local execution and no-exfiltration are separate claims. `boot()` keeps computation in the
browser, but it does not by itself stop executed code from using the network. The Agent and MCP
sandbox examples finish trusted engine and package preparation, install `enableJail({ net: false })`,
then apply the returned jail CSP before accepting agent code. The MCP page keeps only same-origin
control traffic open. Its browser gate attempts an external request through `import js` and
`fetch` and requires the controlled receiver to observe zero requests.

The default engine distribution is fetched from a CDN before that example policy closes. Self-host
the engine when even trusted boot must make no external request. `connect-src 'self'` also treats the
product origin as trusted; protect same-origin endpoints with their own authorization and input
validation. MCP tool results intentionally cross that trusted control channel, so this policy is not
a confidentiality boundary against the MCP client; products still constrain and review returned
data. A same-origin parent remains a separate side channel, as described in the jail contract.

### Revival never fakes continuity

Journal recovery refuses foreign state: a generation whose replay fingerprint (h0) does
not match the current engine/manifest fails with `PYPROC_REPLAY_MISMATCH` instead of
silently corrupting the heap, and corrupted stores fail loudly rather than masquerading
as a first boot. A sent RPC is re-asked after leader loss only when the caller controller
can prove both a durable generation and a proxy-free session. Ordinary followers cannot
inspect the leader session and fail closed with `PYPROC_RPC_OUTCOME_UNKNOWN`; live-leader
timeouts and caller loss do too. The full resend and result boundary is the
[durable RPC state table](docs/usage/contract.md#durable-rpc-state-table-normative).
