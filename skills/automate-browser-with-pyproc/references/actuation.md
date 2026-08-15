# actuation

## Contents

- Execute proof-carrying actions
- Enable the browser path
- Complete one task from JavaScript
- Refine ambiguity explicitly
- Add Motor journeys to an Evidence Pack
- Enable the optional Windows host
- Delegated signed-in tab
- Cleanup and recovery
- Gates
- Proof-Carrying Motor 1.0
- Composition contract
- Absolute intents
- Complete perception before contact
- TargetBinding
- Deterministic actuator broker
- Effect window
- ControlLease and user precedence
- Receipts, episodes, and Evidence Pack
- Optional Windows host
- Delegated tab boundary
- Task resource lifecycle
- Error and terminal boundary
- Conformance

# Execute proof-carrying actions

Proof-Carrying Motor is an opt-in layer in the existing `pyproc/control` product. It turns a complete APX
Situation and an absolute desired state into one verified effect, durable receipt, and episode. Use it when the
completion claim must survive beyond a successful click command.

## Enable the browser path

Motor requires browser authority and Execution Memory. The smallest browser-only profile is:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/cpython-wasi" },
  "browser": {
    "enabled": true,
    "provider": "nativeCdp",
    "allowedOrigins": ["https://app.example"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "click", "check", "uncheck", "fill"],
    "methods": [],
    "externalEffects": "acknowledged",
    "purpose": "Operate the declared application",
    "artifacts": {}
  },
  "executionMemory": {
    "enabled": true,
    "root": "/absolute/private/path/to/memory",
    "importRoots": [],
    "secretEnv": []
  },
  "actuation": { "enabled": true }
}
```

Run preflight before starting a target:

```sh
npx pyproc-control doctor --config ./.pyproc/manifest.json
npx pyproc-control --config ./.pyproc/manifest.json --check
```

The default path creates an isolated temporary browser profile. It does not install or start the optional
Windows host and does not attach to a signed-in default profile.

## Complete one task from JavaScript

Use the stable public subpath. `openMotorTask()` closes only the target it opened and removes unretained task
artifacts when the scope closes.

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start(".pyproc/manifest.json");
const task = await client.openMotorTask({
  url: "https://app.example/documents/42",
  expectedRisk: "externalEffect",
  waitUntil: "load",
});

try {
  const observed = await task.situate({ requirements: [{
    requirementRef: "requirement:save",
    select: { role: "button", name: "Save", actionable: true },
    need: ["fact", "affordance"],
    cardinality: "one",
  }] }, { visual: { mode: "off" } });

  const situation = observed.situation;
  const requirement = situation.requirements[0];
  const capability = situation.affordances.find((entry) =>
    entry.kind === "authorized" && entry.requirementRef === requirement.requirementRef
      && entry.action === "click");
  const space = (await client.inspectSpace()).output.space;

  const result = await task.execute({
    situation,
    requirementRef: requirement.requirementRef,
    intent: {
      intent: "activate",
      target: {
        spaceRef: space.spaceId,
        entityRef: requirement.entityRefs[0],
        worldRef: situation.worldRef,
        surfaceEpoch: `document:${situation.documentEpoch}`,
      },
      desired: { activated: true },
      preconditions: [],
      expectedTransition: {
        all: [
          { entityAppeared: { role: "status", name: "Saved" } },
          { networkResponse: { method: "POST", urlPath: "/documents/42", status: 200 } }
        ]
      },
      authority: {
        actionCapabilityRef: capability.capabilityRef,
        approvalGrantRef: null,
        commitLeaseRef: null,
        controlLeaseRef: null,
      },
      policy: {
        allowedActuatorKinds: ["browserInput"],
        allowPreContactFallback: false,
      },
    },
  });

  console.log(result.output.terminal, result.output.receipt.receiptSha256);
} finally {
  console.log(await task.close());
  await client.close();
}
```

`task.execute()` accepts only a Situation observed by that task. It also requires one satisfied target and no
unknown for that requirement. A forged, stale, truncated, or ambiguous capsule fails before the provider call.

## Refine ambiguity explicitly

Do not pick the first match. Inspect only the safe diagnostic and submit a more precise semantic query:

```js
const first = await task.situate({ requirements: [{
  requirementRef: "requirement:approve",
  select: { role: "button", name: "Approve" },
  need: ["fact", "affordance"],
  cardinality: "one",
}] });

const diagnostic = task.diagnoseAmbiguity(first, "requirement:approve");
if (!diagnostic.canExecute) {
  const refined = await task.situate({ requirements: [{
    requirementRef: "requirement:approve-enabled",
    select: { role: "button", name: "Approve", actionable: true },
    need: ["fact", "affordance"],
    cardinality: "one",
  }] });
  console.log(task.diagnoseAmbiguity(refined, "requirement:approve-enabled"));
}
```

The diagnostic supplies predicate classes, not candidate values. The caller remains responsible for the intent
and refinement. If APX reports a truncated source inventory, there is no action-capable continuation token in
version 1. Narrow the task or use a provider that can produce a complete focused inventory.

## Add Motor journeys to an Evidence Pack

After a Motor action is stored, attach its exact receipt to a declared verification scenario:

```js
await client.auditExperience("qa/eyes", {
  repositoryRoot: ".",
  outputDir: ".pyproc/evidence/current",
  environmentId: "desktop",
  repository,
  motorJourneys: [{
    receiptSha256: result.output.receipt.receiptSha256,
    scenarioId: "save-document",
    checkpointId: "post-save",
  }],
});
```

The audit resolves one exact receipt and episode. It stores the canonical journey as an Evidence Pack sidecar.
A contradicted or incomplete Motor terminal becomes a standard finding and affects the scenario verdict. Missing
or mismatched records fail the audit instead of producing a detached report.

## Enable the optional Windows host

Windows accessibility and physical input require an explicit native block. Use an application-specific
executable path and exact window title:

```json
{
  "actuation": {
    "enabled": true,
    "native": {
      "enabled": true,
      "installRoot": "C:\\ProgramData\\PyProc\\Motor",
      "applications": [{
        "applicationId": "application:accounting",
        "executablePath": "C:\\Program Files\\Example\\Accounting.exe",
        "windowTitle": "Example Accounting"
      }]
    }
  }
}
```

Then build and bind the owned host installation:

```powershell
npx pyproc-control native setup --config .\.pyproc\manifest.json
npx pyproc-control native status --config .\.pyproc\manifest.json
```

`setup` requires a working Rust toolchain, uses the shipped lock file, writes installation digests and a local
integrity signature into the profile, and verifies the result. Review the changed profile before use. Run
`doctor` after setup.

Prefer `accessibility` when the target exposes a supported semantic pattern. Physical `osInput` additionally
requires a short-lived exact `ControlLease`:

```js
const lease = await client.acquireMotorControl({
  applicationId: "application:accounting",
  intent,
  expiresInMs: 5000,
});

const result = await client.executeMotor({
  sessionRef,
  situation,
  requirementRef: "requirement:save",
  applicationId: "application:accounting",
  nativePostcondition: { name: "Saved", controlType: "text" },
  intent: {
    ...intent,
    authority: { ...intent.authority, controlLeaseRef: lease.output.leaseRef },
  },
});
```

The lease is one-shot. Never retry a physical result after contact. Remove the integration with:

```powershell
npx pyproc-control native remove --config .\.pyproc\manifest.json
```

## Delegated signed-in tab

The optional extension source is under `scripts/actuation/delegatedTab/extension`. Load it only when a product
needs an explicitly selected signed-in tab. The flow requires a loopback host request, one extension action on
the host tab, then one extension action on the target tab. Automation cannot synthesize these user gestures.

The grant is limited to observe and high-level act operations in one tab and origin epoch. Same-origin
navigation invalidates old locators, while cross-origin navigation and tab close revoke the lease. The extension
does not provide broad host access, debugger access, native messaging, arbitrary navigation, or tab closure.

## Cleanup and recovery

Always close the task and client in `finally`. By default, the task deletes unretained screenshot artifacts.
Call `task.retainArtifact(ref)` before close only when another durable record owns its retention.

A cleanup result can be `incomplete` even when the action was confirmed. Treat those as separate facts. Inspect
the failed cleanup phases, but do not resend the action. Borrowed targets are detached and left open. Owned targets
are closed through the exact opaque ref created by the broker, never by URL matching.

The browser adapter enters contact only after the current Situation capability, document epoch, exact target,
and actionability fingerprint are rechecked. Mouse and key down commands are paired with bounded independent
safety release. A residual input state is `outcomeUnknown`, is attached to the action evidence, and quarantines
that browser session. It is not a fallback opportunity and does not consume a second business-effect lease.

## Gates

```sh
npm run test:contracts
npm run test:actuation
npm run test:delegated-tab
npm run test:windows-motor
npm run test:types
```

See [Proof-Carrying Motor 1.0](#) for the canonical contract and
[security](../../../SECURITY.md) for trust boundaries.

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
