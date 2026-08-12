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
  "capabilities": ["dom", "network", "target", "storage", "runtime", "screenshot", "artifact"],
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

Recording and replay details are in the [ReplaySpace guide](replaySpace.md).

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
