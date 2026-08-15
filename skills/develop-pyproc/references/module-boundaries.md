# module-boundaries

## Contents

- Module boundaries
- Runtime composition
- Policy and mechanism
- Contract verification
- Public surface
- Runtime assets
- Package-internal browser automation
- Layer ranks
- Why the type graph does not mirror the value graph

# Module boundaries

pyproc divides modules by reason to change and dependency direction, not by file count. Implementation,
composition, policy, and verification have separate owners without widening the public surface.

## Runtime composition

- `src/runtime/` owns the engine wrapper and the minimal Runtime contract.
- `src/capabilities/` owns optional capabilities and does not import composition.
- Clusters under `src/composition/runtimeBindings/` own capability construction rules.
- `src/composition/runtimeBindings.js` only merges clusters, rejects duplicates, and installs prototypes.
- Adding a capability must not add a class import to a central installer.

The experimental WASI package lane keeps resolution and archive policy in Layer 0
(`packageResolver.js`, `wheelInstaller.js`), kernel composition in Layer 2 (`packageEnvironment.js`,
`kernelTerminal.js`), and PEP 723 orchestration in Layer 3 (`kernelEnvironmentManager.js`). The resolver never
imports a live kernel, and the wheel installer never selects dependencies or performs network access.

The current clusters are:

| Cluster | Responsibility |
|---|---|
| `state` | Reactive checkpoints and the durable journal |
| `service` | Syscalls, ASGI, virtual origins, and terminals |
| `environment` | Wheel cache, device filesystem, and init |

The existing Experimental GPU surface follows the same direction. `src/runtime/gpuOracle.js` owns the
provider-neutral registered programs, expected values, digest receipt, and mismatch error. The optional
`src/capabilities/webGpuHostAdapter.js` owns WebGPU device, pipeline, buffer, texture, and readback lifecycle.
`src/composition/gpuSubpath.js` only gathers those contracts under `pyproc/gpu`; it does not move a browser
device or arbitrary WGSL across the hostcall boundary.

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
meet the exit criteria in the [Experimental freeze policy](../../evolve-pyproc/references/experimental-freeze.md). Each public subpath owns
its sibling `.d.ts`; ambient modules do not accumulate in the root declaration.

## Runtime assets

The Buildroot guest is reproducible from the official release archive SHA-256, matching revision, config,
legal-info, and SBOM contract under `scripts/buildroot/`. `.github/workflows/buildroot-guest.yml` owns the
Linux build and evidence retention. Promoting a generated artifact into the development catalog requires a
separate review after its digest and provenance have been reconciled.

## Package-internal browser automation

`scripts/browserControl/` is a shipped Node integration library used only by the stable `pyproc-mcp` bin. It
enters the npm tarball but is not a root or subpath JavaScript export. `browserControlPolicy.js` owns raw
method risk and parameter guards,
`browserAutomationCatalog.js` owns high-level action risk, schema, and required methods,
`browserLocator.js` and `browserActionability.js` own strict target resolution and pre-effect waiting,
`inputStateGuard.js` owns possibly-down input tracking, independent bounded release, and residual-risk evidence,
`browserObservation.js`, `browserScreenshot.js`, `browserArtifactStore.js`, and `browserTrace.js` own bounded
evidence, capture, disk lifecycle, and trace,
`browserLifecycle.js` and `browserDownload.js` own declared event effects,
`browserCompatibility.js` owns the supported Chromium and CDP boundary,
`browserControlPort.js` owns opaque target, popup, session, outcome, and event fencing,
`browserAutomation.js` owns action orchestration, and `mcpBrowserControl.js` alone adapts configuration and
tools to MCP. `browserLauncher.mjs` owns isolated browser process lifecycle. `mcpProductConfig.mjs` owns the
versioned installed manifest, while `scripts/browserControl/index.js` is the package-internal composition
surface imported by `mcpSandboxServer.mjs`. A contract test rejects browser schema or configuration lists
that return to the server composition root. The installed-package gate requires the bin runtime while also
rejecting any browser JavaScript export or runtime dependency.

`scripts/automationSpace/semanticInventory.js` owns the provider-neutral legacy semantic paging primitive:
finite retained inventory, single-use continuation, epoch fencing, canonical page, prefix, and full digests,
and evidence receipt binding. NativeCdpSpace and FrameSpace materialize provider facts once and delegate paging
to it. MCP, Control, and SDK adapters pass the opaque continuation through and do not invent offsets or a second
completeness meaning.

`scripts/perception/` owns the provider-neutral APX contract. `apxCatalog.js` and the JSON schemas own strict
wire validation and conformance vocabulary; `perceptionIdentity.js` and `perceptionTimeline.js` own epoch-bound
identity and deltas; `perceptionBudget.js` and `perceptionQuery.js` own bounded attention;
`requirementCandidateEvaluator.js` owns candidate truth and read-only continuation binding before projection;
`unresolvedVocabulary.js` owns the shared unresolved enum; `perceptionSpace.js` owns sensor fusion;
`postconditionObservationPlanner.js`, `postconditionVerifier.js`, `actionEvidence.js`, and `actionConvergence.js` own focused observation,
coverage-aware terminal truth, and one-shot verification. Provider
adapters live only under `scripts/perception/profiles/`. They may consume private CDP or Frame facts but must
emit no native identifier. `browserAutomation.js` composes perception with policy, artifact, and action
orchestration. MCP, Control, recording, replay, and Python code adapt this one result rather than reimplementing
it. The directory ships in the tarball but is not an npm JavaScript export.

Live resource accounting stays with each owner. Perception identity, timeline, world, capability, sensor, and
space expose bounded counts; CDP connection, transport, port, broker, automation, artifact, observation, and
lifecycle modules expose only their own counts. `McpBrowserControl` and `FrameSpace` compose those values into
the provider-neutral `automation.space.inspect.resources` receipt and never infer hidden Map sizes in an adapter.

`scripts/executionMemory/` owns the installed filesystem registry above those existing artifacts.
`executionMemoryCanonical.js` owns the closed revision schema and digest;
`fileExecutionMemoryStore.js` owns immutable objects, session HEAD compare-and-swap, locks, and confinement;
`executionMemoryArtifacts.js` captures and reverifies minimal Machine, situation, recording, evidence, and
permission sidecars; `executionMemoryRegistry.js` owns publication, completion, retention, and signed handoff;
and `executionMemoryTools.js` alone adapts it to shared Control and MCP operations. The directory may depend on
state-bundle, perception, recording, and Evidence Pack validators. Those lower producers do not import the
registry. It is publicly composed only through the existing `pyproc/control` subpath.

`scripts/effectTransaction/` owns the Rehearse-Commit lifecycle above Execution Memory and the existing
automation spaces. `effectTransactionCanonical.js` owns the closed immutable transaction objects and revision
links; `effectInput.js` owns secret placeholders and live-only materialization; `approvalGrant.js` verifies the
external Ed25519 authority, expiry, trust domain, and nonce; `fileEffectTransactionStore.js` owns confined
objects, compare-and-swap HEAD, locks, and global nonce consumption; `effectTransactionRegistry.js` owns valid
state transitions and sending recovery; `effectTransactionCoordinator.js` composes Machine checkpoints, APX
affordances, rehearsal providers, one-shot live dispatch, verification, and sealing; and
`effectTransactionTools.js` alone adapts the coordinator to shared Control and MCP operations. Lower Machine,
perception, automation, recording, and evidence producers never import this directory. It is publicly composed
only through the existing `pyproc/control` subpath.

`scripts/appSpace/` owns cooperative logical application state above FrameSpace, Execution Memory, and
Rehearse-Commit. `appSpaceTarget.js` owns the closed page adapter and fence protocol;
`appSpaceCanonical.js` owns identity, snapshot, outbox, paired-generation validation, quotas, and digests;
`fileAppSpaceStore.js` owns immutable objects, completion markers, and active app HEAD compare-and-swap;
`appSpaceRegistry.js` owns candidate publication and current-configuration revalidation;
`appSpaceCoordinator.js` alone coordinates app fences, in-process Machine checkpoints, paired rollback, and
existing effect transaction identities; `appSpaceTools.js` adapts the nine operations to Control and MCP. The
directory never owns arbitrary page RPC, browser credentials, effect approval, or live effect dispatch. It is
publicly composed only through the existing `pyproc/control` subpath.

`scripts/replayGraph/` owns immutable verified branch worlds above Automation Recording and Transactional
AppSpace. `replayGraphCanonical.js` owns closed node, edge, artifact, revision, digest, quota, and provenance
validation; `recordingImporter.js` converts a sealed linear recording without inventing state;
`fileReplayGraphStore.js` owns immutable revisions, artifact bytes, and graph HEAD compare-and-swap;
`replayGraphRegistry.js` owns confined import and one-shot restored AppSpace branch capture;
`replayWorld.js` owns capability-bound effect-free cursors, deterministic evaluation, coverage, and retention
planning; `replayGraphCoordinator.js` and `replayGraphTools.js` adapt the twelve operations to Control and MCP.
The directory does not import a browser provider, send a live effect, infer a missing edge, or own AppSpace
restore. It is publicly composed only through the existing `pyproc/control` subpath.

`scripts/actuation/` owns Proof-Carrying Motor above Perception, AutomationSpace, AppSpace, ReplayGraph, and
Execution Memory. `actuationCanonical.js` owns absolute intents, exact bindings, plans, receipts, episodes,
policy revisions, and digests. `actuatorBroker.js`, `situationBinding.js`, and `effectWindow.js` own hard
eligibility, complete target binding, deterministic routing, and the one-effect boundary. Provider adapters
consume existing high-level provider contracts and never expose raw handles or coordinates. `fileActuationStore.js`
owns immutable records and policy HEAD compare-and-swap. `motorTaskSession.js` is a public client resource scope,
not a second wire protocol. The optional Windows host is verified before spawn and communicates only over owned
framed stdio. DelegatedTab extension source owns its two-gesture tab lease and cannot widen the host manifest.

`scripts/verification/motorJourneyEvidence.js` is the only bridge from Motor records into Evidence Pack. It reads
canonical receipt and episode values and projects one standard artifact and finding. Verification never imports
provider adapters or executes an effect, and Motor never owns a parallel audit format. The whole capability is
publicly composed only through the existing `pyproc/control`, Control, MCP, and Python surfaces.

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

`composition/machineFleet.js` coordinates durable `WebComputer` handles. It may call the public computer
lifecycle and read inspection summaries, but it does not import a guest adapter, storage implementation, or
product project model. Generation truth remains in `persistence/`, guest termination remains in the adapter,
and the product supplies registration factories and candidate policy.

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
