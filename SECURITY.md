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

### Fleet suspension never overrides effect safety

`createMachineFleet` accepts a caller-owned safe terminal because only the surrounding product knows whether an
approval or external effect is pending. Page text, model output, and a released UI control cannot prove that
terminal. An omitted terminal is conservatively unsaved. Active commands, pending approval, unresolved effects,
`outcomeUnknown`, unsaved state, pins, and stale leases block automatic suspension.

Suspend commits and rereads the durable HEAD with the owner fence and exact environment fingerprint before any
adapter is terminated. A commit or environment failure performs no shutdown. A cleanup failure after commit is
reported as `cleanupIncomplete`, not cold. Cold generations still contain live interpreter and application data,
so protect the MachineStore with the same confidentiality and quota policy as `.pymachine` files. Prefetch does
not grant permission, and restoring a signed generation does not silently reopen network, device, or browser
authority.

### Execution Memory handoff does not transfer authority

Execution Memory stores complete interpreter and workspace bytes plus linked observation and evidence artifacts.
Keep its absolute root private, outside source control, and protected by operating-system permissions and disk
quota. Export directories are confined beneath that root. Control imports additionally require an absolute path
under a configured import root.

The handoff descriptor uses Ed25519 to authenticate its canonical revision chain and exact reachable inventory.
That signature proves provenance only. Import requires an independently trusted public-key file and a separately
approved exact permission-manifest digest. It never imports browser cookies, a default profile, unrecorded page
state, or authority to repeat external effects.

Configured `secretEnv` values are projected to the owned process without being persisted in the manifest or
preflight report. Capture and reopen reject their literal UTF-8 and UTF-16LE bytes in structured data, Machine
images, recordings, and evidence. Values shorter than eight bytes are refused. This check is not credential
discovery and cannot understand secrets rendered into pixels, transformed values, or unrelated sensitive data.
Producing subsystems must retain their own redaction rules.

### Rehearsal is not approval and a lease is not remote rollback

Rehearse-Commit is disabled by default. Enabling it requires Execution Memory, an acknowledged
`externalEffect` Native CDP profile, and at least one exact Ed25519 public-key file. Keep the matching private
keys outside the page, product manifest, Machine image, and controlled process whenever practical. DOM text,
accessibility labels, pixels, reported capabilities, and inference output cannot issue an ApprovalGrant.

Approval binds one intent, destination, risk, Execution Session base, local trust domain, expiry, nonce, and
policy version. Copying transaction files or a signed grant to another memory root does not transfer authority.
The live target origin and broker-issued APX affordances are rechecked before the CommitLease is reserved.

The lease limits pyproc to one provider dispatch. It does not guarantee that a remote service applies the
request exactly once and cannot undo an external effect. If the process dies after the durable send boundary,
recovery records non-retryable `outcomeUnknown` and never resends. Investigate the remote system before
preparing another intent.

Configured secret placeholders are HMAC-bound during preparation and materialized only for live provider input.
RecordingSpace receives a separate placeholder-only input. The literal scan is a bounded defense for declared
secret values, not general data-loss prevention.

A terminal transaction is not an audit receipt until `effect.seal` verifies an Evidence Pack with the same
repository identity and exact transaction, intent, EffectResult, and terminal session links. A pack digest
proves content integrity, not issuer identity or legal authorization.

### Transactional AppSpace captures declared state, not browser authority

AppSpace is disabled by default and requires credentialless FrameSpace, Execution Memory, Rehearse-Commit, and
an exact configured app identity. Its cooperative target runs without `allow-same-origin`, parent DOM access,
default-profile credentials, popup authority, or a raw page method channel. A page-reported identity or
capability cannot widen the manifest.

Treat exported app state as untrusted data. The host enforces canonical JSON, structural and byte limits,
forbidden credential and browser-internal keys, exact schema identity, and configured secret literal scans. These
checks do not discover transformed secrets or arbitrary sensitive business data. Applications must export only
the minimum declared logical state and keep their own domain redaction and access controls.

A pair marker proves that the app snapshot, in-process Machine checkpoint, exported Machine generation, and
Execution Session link were published together. It does not authenticate business truth, grant permission, or
make a remote service transactional. AppSpace staging sends nothing. Only Rehearse-Commit owns approval and live
dispatch. Restoring a pair cannot undo an external request. A failed paired rollback is `outcomeUnknown`; stop
and investigate rather than retrying either side.

### ReplayGraph preserves recorded truth but grants no live authority

ReplayGraph is disabled by default and stores graph revisions and artifact bytes beneath the configured private
Execution Memory root. Recording import is limited to absolute files under approved import roots. Recordings,
app state, stored terminals, screenshots, and other artifacts may contain credentials or personal data. Keep the
root out of source control, restrict operating-system access, and apply a deliberate retention policy.

Traversal consumes current-node-bound one-shot capabilities and returns only stored terminals. It does not call
a browser provider, cooperative app, or remote service. A historical `recordedExternal` edge does not authorize
or repeat that effect. An AppSpace branch requires a consumed exact source restore proof and a direct child pair;
a graph digest, pair marker, or recording digest cannot replace permission or approval.

SHA-256 roots and object references detect content changes but do not authenticate an author. Version 1 has no
graph signature and does not delete unreachable objects automatically. Do not treat a complete coverage flag as
proof that every site action is represented, or treat a missing edge as permission to invent a transition.

### Proof-Carrying Motor does not turn perception into permission

Motor is disabled by default and requires explicit browser and Execution Memory configuration. A Situation must
be task-complete, fresh, and uniquely matched before contact. `entityRef`, accessible names, page content,
geometry, pixels, reported capabilities, ambiguity diagnostics, and historical episodes never create authority.
The exact APX action capability and any required approval, commit, or control lease remain independent checks.

Motor plans are immutable at contact. Fallback is allowed only after the previous route proves zero provider
calls. A contacted, applied, contradicted, unobserved, or unknown effect is never automatically resent. Cleanup
failure remains a separate terminal fact and cannot change or retry the original action. Borrowed browser targets
are detached and never closed. Owned target closure uses the exact underlying target identity rather than a URL.

The optional Windows host is an explicitly installed child process with framed stdio and an exact application
allowlist. It has no network listener, shell, unrestricted target, or public raw-coordinate command. Setup records
binary, shipped source, and SBOM digests and a local Ed25519 integrity signature. This detects change since setup,
but is not publisher signing or authorization for the target application. Physical input requires a short-lived,
one-shot `ControlLease`; user activity, foreground loss, target substitution, expiry, or reuse revokes it.

The optional DelegatedTab extension uses only `activeTab` and `scripting`. A loopback host request plus explicit
extension action gestures bind the host and target tab. Synthetic browser input cannot forge that gesture.
Same-origin navigation rotates the tab epoch, while cross-origin navigation and tab close revoke access. The
extension does not grant broad profile, debugger, navigation, or closure authority.

Motor receipts and episodes may contain private application state even after structural redaction. Keep the
Execution Memory root private. Evidence Pack projection resolves an exact stored receipt and episode and applies
the existing artifact quota and replay integrity checks. A pack digest and a Motor receipt prove integrity and
lineage, not identity, consent, site ownership, business approval, or remote exactly-once application.

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
