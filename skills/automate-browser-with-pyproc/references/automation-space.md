# automation-space

## Contents

- AutomationSpace provider contract
- Canonical operations
- Authorization boundary
- Lifecycle and recovery
- Experience Verification consumer
- Nested browser guest boundary
- Contract verification
- Motor integration

# AutomationSpace provider contract

`AutomationSpace` is the package-internal provider boundary behind Control Protocol automation operations.
It keeps client behavior stable while the implementation changes between a native Chromium connection, an
isolated frame, or a recorded replay. It does not add a JavaScript package export.

## Canonical operations

Every provider declares a stable `spaceId`, a `providerKind`, and a supported subset of ten operations:

```text
automation.space.inspect
automation.target.list
automation.target.open
automation.session.attach
automation.command
automation.session.detach
automation.observe
automation.act
artifact.read
artifact.delete
```

The Control Protocol catalog remains the client-facing contract. Provider-specific target, session, locator,
and artifact handles stay opaque. A client never receives a DevTools endpoint or provider object.

## Authorization boundary

The router executes every operation in this order:

```text
closed and supported checks -> pre-cancel check -> authorize -> pre-execute cancel check -> execute
```

`authorize` must complete without starting the provider transport or sending an effect. The current browser
adapter returns a single-use authority token; `execute` rejects a missing, stale, mismatched, or reused token.
An origin, raw method, expected risk, or observation-risk denial therefore has provider execution count zero.

Provider execution owns the exact send boundary. An interruption before send is `notSent`. Once an effect
may have crossed that boundary, failure is `applied` or `outcomeUnknown` and never retryable. The router does
not replay a provider operation.

Providers that declare `linearizeInvocations` run authorization, execution, terminal recording, and persistence
as one FIFO turn. `RecordingSpace` and `ReplaySpace` use this boundary so concurrent callers produce and consume
one reproducible order. A queued request cancelled before its turn reaches no provider code.

## Lifecycle and recovery

`automation.space.inspect` adds a provider-neutral descriptor to the implementation report:

```json
{
  "spaceId": "space:native",
  "providerKind": "nativeCdp",
  "operations": ["automation.space.inspect"],
  "capabilities": ["dom", "network", "target", "storage", "runtime", "screenshot", "artifact", "perception"],
  "restoreBoundary": "externalEffectsRemain",
  "replayBoundary": "recordOnly"
}
```

The operation list above is abbreviated. `restoreBoundary` is deliberately fixed: restoring Python never
claims to reverse provider effects. `replayBoundary` describes what that provider can do with a recorded
operation. The current native and frame adapters record evidence but do not replay effects. FrameSpace
declares `dom`, `target`, `screenshot`, and `artifact`, omits `automation.command`, and keeps the same restore
boundary. `RecordingSpace` wraps either live provider without changing that identity. `ReplaySpace` declares
the recorded capabilities, consumes exactly one matching entry at a time, and owns no live browser provider.

`perception` means the provider can return an APX graph and SituationCapsule through the existing
`automation.observe` operation. `PerceptionSpace` owns the session WorldModel, situation ledger, and
broker-issued capability leases. A new world is committed only after the requested capsule passes strict
validation, so capture, budget, schema, or artifact failure leaves no partial world or authority.
It does not imply pixel authority. Provider inspection separately declares conformance level, supported APX
profiles, channels, and visual modes. Native CDP reports live semantic, spatial, temporal, evidence, and
verified crop support. FrameSpace reports semantic, spatial, and temporal facts while accepting only visual
mode `off`. Its inspect result also reports `subscriptions`, `inference`, `reportedCapabilities`, and
`nativeWebMcp` without inferring support from page content. Native CDP can push exact semantic postcondition
queries into `Accessibility.queryAXTree`; unsupported providers use the complete fallback. Network-only
verification does not read AX, DOM snapshots, screenshots, or inference. ReplaySpace returns recorded APX
terminals and artifacts without pretending to be a live sensor.
The [APX product contract](../../verify-browser-experience/references/apx.md) owns this provider-neutral contract.

Recording and replay details are in the [ReplaySpace guide](./replay-space.md).

## Experience Verification consumer

The repository verification runner is a consumer of this boundary, not a fourth provider. It validates the strict
Experience Contract before target execution, checks `automation.space.inspect` against the declared viewport and origin
authority, then uses only the canonical target, session, observe, act, and detach operations. It does not receive a raw
provider object or bypass provider authorization.

Each action target comes from a current APX SituationCapsule affordance. The runner compares the contract action and risk
to that affordance, rechecks exact authority and binding at send, sends the action once, and evaluates the
resulting ActionEvidence with explicit entity and event coverage. `outcomeUnknown` remains
incomplete and is never retried. Evidence Pack verification and replay can run without this provider boundary because
they consume already sealed bytes. See [Experience verification](../../verify-browser-experience/references/verification.md) and the
[Experience Verification 1.0 specification](../../verify-browser-experience/references/verification.md).

## Nested browser guest boundary

The current product does not claim a browser engine running inside a v86 guest. The formal
`nestedBrowserBoundaryProbe` boots the two available guest candidates and keeps that decision executable.
The reproducible Buildroot guest provides Linux, text display, PS/2 input, a packet NIC, and portable restore,
but its image contains neither a browser engine nor a graphical server. The graphical Kolibri fixture provides
RGBA frames, pointer input, PNG capture, and restore, but its image provenance is opaque and it has neither the
external network provider nor semantic browser-control contract required for automation.

`NativeCdpSpace` is the provider for authoritative Chromium control and compositor screenshots. `FrameSpace`
is the provider for a cooperative, credentialless page nested in the machine tab. `ReplaySpace` is the provider
for effect-free reproduction. A future v86 browser provider must place a reproducibly built browser engine,
graphical stack, external network boundary, semantic actions, screenshot artifacts, permission policy, and
restore semantics in one guest before it can join this list. Booting a graphical guest alone is not sufficient.

Close is idempotent. The Control host first rejects new requests, aborts active work, and waits for every terminal
to settle. The router then drains its FIFO before closing the provider. After close, every new operation fails
with `AUTOMATION_SPACE_CLOSED` before provider code. The provider is responsible for dropping session-owned
locators, observations, lifecycle watchers, downloads, popup captures, artifacts, and transport state.

## Contract verification

The `automationSpace` contract suite runs the same router against a fake provider. It verifies all ten
operation mappings, authorize-before-execute, permission denial with zero executions, pre-aborted requests,
unchanged artifact payloads, non-retryable unknown outcomes, unsupported operations, inspect boundaries, and
idempotent close. The installed MCP, native Control Protocol, and Python SDK gates then run the real provider
through that router on Chrome and Edge.

## Motor integration

Proof-Carrying Motor is a consumer of AutomationSpace, not another provider. Native CDP supplies
`browserInput`, FrameSpace supplies the cooperative route together with AppSpace, and ReplaySpace remains an
effect-free exact provider. Motor feeds only broker-authorized high-level actions through `automation.act` and
uses returned ActionEvidence for its receipt.

`automation.target.close` is part of the lifecycle contract. Native CDP closes only a target that the broker
created, identified by its exact internal target identity rather than URL. FrameSpace closes only its own frame
target. A borrowed target must be detached and left open. See [Proof-Carrying Motor](./actuation.md).
