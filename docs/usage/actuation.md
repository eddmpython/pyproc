# Execute proof-carrying actions

Proof-Carrying Motor is an opt-in layer in the existing `pyproc/control` product. It turns a complete APX
Situation and an absolute desired state into one verified effect, durable receipt, and episode. Use it when the
completion claim must survive beyond a successful click command.

## Enable the browser path

Motor requires browser authority and Execution Memory. The smallest browser-only profile is:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/pyodide" },
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

## Gates

```sh
npm run test:contracts
npm run test:actuation
npm run test:delegated-tab
npm run test:windows-motor
npm run test:types
```

See [Proof-Carrying Motor 1.0](../specs/actuation/README.md) for the canonical contract and
[security](../../SECURITY.md) for trust boundaries.
