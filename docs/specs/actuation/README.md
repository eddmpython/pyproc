# Proof-Carrying Motor 1.0

Status: shipped, opt-in, bounded to the providers and platforms stated here.

Proof-Carrying Motor compiles one absolute desired-state intent against a complete APX
`SituationCapsule`, chooses one eligible actuator deterministically, crosses at most one provider effect
boundary, verifies the result, and seals an immutable receipt plus episode.

It is not a selector facade, a coordinate API, a permission source, or a retry engine. Pixels can support an
observation, but they never become an actuator or create authority.

## Composition contract

```text
SituationCapsule
+ ActuationIntent
+ ActionCapability and optional external authority
-> TargetBinding
-> deterministic actuator decision
-> immutable ActuationPlan
-> one bounded effect window
-> transition verification
-> ActuationReceipt
-> ActuationEpisode
```

Motor reuses existing contracts rather than replacing them:

- APX owns observed identity, completeness, affordances, and `ActionCapability`.
- Rehearse-Commit owns consequential-effect approval and one-shot commit authority.
- AppSpace owns cooperative app state and its outbox.
- ReplayGraph owns effect-free traversal of recorded state transitions.
- Evidence Pack owns repository verification truth and artifact integrity.
- Motor owns exact target binding, actuator choice, physical control, the effect window, receipt, and episode.

## Absolute intents

Version 1 accepts `activate`, `focus`, `setValue`, `setSelected`, `setExpanded`, `scrollTo`, and `dragTo`.
Each request describes a final state. Relative verbs such as `toggle`, raw key sequences, coordinates, native
handles, and provider objects are rejected from the canonical intent.

Every intent binds:

- exact `spaceRef`, `worldRef`, `entityRef`, and `surfaceEpoch`;
- final desired state and declared preconditions;
- expected semantic or business transition;
- current action capability and optional approval, commit, or control references;
- an explicit actuator allowlist and pre-contact fallback policy.

The canonical digest changes when any of these values changes. Sensitive values should use an existing bounded
value binding rather than enter the receipt or episode.

## Complete perception before contact

Motor accepts only a requirement whose cardinality is `one`, whose match count is exactly one, and whose source
inventory is task-complete. APX captures a Situation request with the provider's maximum bounded inventory,
evaluates the caller's focus against that inventory, then projects only related entities into the caller budget.
This lets a target remain exact even when many unrelated controls exist.

If the provider reports omitted source entities or relations, `completeness.inventory` becomes `truncated`, the
requirement becomes unknown, and Motor returns `ACTUATION_PERCEPTION_INCOMPLETE` before any provider call.

Version 1 deliberately does not turn a generic pagination token into action authority. A caller resolves
ambiguity by submitting another explicit semantic focus, for example adding `actionable: true` or an exact state.
`MotorTaskSession.diagnoseAmbiguity()` returns only safe predicate classes. It never returns a candidate order,
coordinate, live locator, raw node identity, or an automatic choice.

## TargetBinding

`entityRef` is observation identity, not an actuator handle. Immediately before execution, Motor compiles an
opaque `TargetBinding` containing the exact world and surface epoch, semantic invariants, actuator kind,
candidate count, uniqueness verdict, freshness deadline, and provider fence digest.

A binding is invalid when any of these conditions holds:

- no candidate or more than one candidate remains;
- the Situation is stale, conflicted, unknown, or source-truncated;
- navigation, window substitution, foreground change, or origin change replaces the surface epoch;
- the provider cannot support the intent or required evidence;
- a required authority reference is absent, expired, consumed, or out of scope.

Provider-local identifiers stay inside the adapter. Receipts and public errors carry no DOM backend node,
Windows handle, runtime pointer, or coordinate.

## Deterministic actuator broker

The broker applies hard eligibility first. It then uses a versioned lexicographic preference. A score cannot
offset missing permission, ambiguous binding, unsupported evidence, or stale authority.

| Actuator | Effect path | Required boundary | Shipped status |
|---|---|---|---|
| `browserInput` | isolated Native CDP input | exact origin, action, risk, live APX capability | shipped |
| `cooperative` | typed AppSpace action | exact app profile and existing transaction boundary | shipped |
| `replay` | stored ReplayGraph edge | exact graph revision and edge capability | shipped, no live effect |
| `accessibility` | Windows UI Automation pattern | explicit optional host and application allowlist | shipped on Windows |
| `osInput` | Windows `SendInput` | exact app binding, foreground, one-shot `ControlLease` | shipped on Windows |

macOS accessibility and Linux AT-SPI are not shipped providers. DelegatedTab is a bounded optional extension
authority described below and is not silently enabled by the default profile.

Fallback is allowed only before provider contact, after the previous route proves zero provider calls, with the
same intent, target, world, surface, and authority. It is forbidden after contact and for `outcomeUnknown`.

## Effect window

An immutable plan has three phases:

1. `preContact` may observe, align, and select another already eligible route.
2. `committedGesture` may finish only the predeclared gesture envelope and mandatory safety release.
3. `postContact` may observe, verify, clean up, and seal, but may not send another business effect.

`alreadySatisfied` crosses no boundary and records zero provider calls. A transport loss after contact is
`outcomeUnknown` unless deterministic evidence proves a narrower terminal. Cleanup failure never changes the
original effect result and never triggers another send.

## ControlLease and user precedence

`ControlLease` controls shared physical input only. It does not replace site permission, an APX capability,
business approval, or a commit lease. It binds one application, exact intent digest, surface epoch, expiry, and
one use.

The Windows OS-input adapter rechecks executable identity, window title, foreground, target uniqueness, intent,
and surface epoch before dispatch. Reuse, expiry, revocation, user activity, foreground loss, and window
substitution fail closed. After contact, only the required key-up or pointer-up safety release may be sent.

## Receipts, episodes, and Evidence Pack

`ActuationReceipt` connects the intent, binding, plan, authority references, route decision, effect window,
terminal, evidence reference, and cleanup state. `ActuationEpisode` adds policy revision, provider environment,
timeline, first failure point, robustness signals, evidence references, and a redaction manifest digest.

Both objects are canonical, content-addressed, and stored under the configured Execution Memory root. A
confirmed terminal requires deterministic evidence. Policy proposals can change only tactics covered by
effect-free fixtures and replay. They cannot change permission, uniqueness, effect safety, user precedence, or
redaction.

Repository audits can include stored Motor journeys through `motorJourneys`. The audit resolves the exact
receipt and episode and writes one `application/vnd.pyproc.motor-journey+json` sidecar into the existing
Evidence Pack. A failed or incomplete Motor terminal also becomes a standard behavioral finding and changes the
scenario verdict. There is no parallel Motor report format.

## Optional Windows host

The native host is disabled by default and is available only on Windows. It is an owned child process with
length-prefixed stdio frames. It has no network listener, shell operation, unrestricted process selection, or
public raw-coordinate command.

Setup builds the shipped Rust source with `cargo build --release --locked`, installs the binary directly under
the configured absolute `installRoot`, records binary, source, and CycloneDX SBOM digests, and creates a local
Ed25519 installation signature. Startup verifies all of them before spawning the process. This signature proves
that the locally recorded installation did not change. It is not a publisher signature or an operating-system
code-signing claim.

`status` is effect-free. Re-running `setup` is the update path. `remove` deletes only the owned executable and
installation receipt and clears the installation block from the profile.

## Delegated tab boundary

The shipped Manifest V3 extension source uses only `activeTab` and `scripting`. It declares no broad host
permission, debugger permission, native messaging, WebSocket, or fetch channel. A loopback host request and a
gesture on that host bind the local requester. A second explicit extension action gesture on the desired tab
grants one origin and tab-epoch lease.

Same-origin navigation increments the epoch and invalidates old locators and envelopes. Cross-origin navigation,
tab close, or host close revokes the lease. Synthetic CDP input cannot forge the extension action gesture, which
is enforced by the installed extension gate. The positive grant therefore remains a user-performed step, not an
unattended default-profile automation claim.

## Task resource lifecycle

`openMotorTask()` owns only resources it creates. It opens or borrows one target, attaches one session, records
Situation and artifact ownership, and executes only Situations observed by that task.

`close()` independently attempts session detach, deletion of unretained artifacts, and closure of an owned
target. A borrowed target is never closed. Repeated `close()` returns the same cleanup result. Failure is reported
as `incomplete`, with phase codes, while `effectRetried` remains false.

## Error and terminal boundary

Important pre-contact failures include `ACTUATION_PERCEPTION_INCOMPLETE`, `ACTUATION_TARGET_AMBIGUOUS`,
`ACTUATION_TARGET_STALE`, `ACTUATION_AUTHORITY_REQUIRED`, `ACTUATION_CONTROL_REVOKED`, and
`ACTUATION_NATIVE_INTEGRITY`. They send no effect.

Terminals include `confirmed`, `contradicted`, `ambiguous`, `notObserved`, `outcomeUnknown`, `alreadySatisfied`,
`notSent`, and `rejected`. Callers must not automatically retry `confirmed`, `contradicted`, `notObserved`,
`outcomeUnknown`, or any result whose effect window crossed provider contact.

## Conformance

Run the strongest applicable gates:

```sh
npm run test:contracts
npm run test:actuation
npm run test:delegated-tab
npm run test:windows-motor
npm run test:types
```

The browser gate installs the package and completes the documented public `pyproc/control` task. The Windows
gate uses an explicit local desktop fixture, exercises accessibility and physical input through the installed
host, checks client receipt parity, rejects a changed binary before spawn, and verifies removal. The delegated
tab gate proves the pre-gesture negative boundary in a real extension runtime.
