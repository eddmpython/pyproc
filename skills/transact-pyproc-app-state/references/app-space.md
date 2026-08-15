# app-space

## Contents

- Pair a cooperative app with the Python Machine
- Create the profile
- Install the cooperative adapter
- Attach and establish a base pair
- Branch, restore, and adopt
- Stage an effect without sending
- Python and MCP
- Recovery boundary
- Publish restored candidates as a ReplayGraph
- Motor integration
- Transactional AppSpace 1.0
- Activation and authority
- App identity
- Cooperative target protocol
- AppStateSnapshot
- PairedGeneration
- Publication and crash rule
- Restore and adopt
- Effect boundary
- Operations
- Conformance

# Pair a cooperative app with the Python Machine

Transactional AppSpace lets an application you control export bounded logical state and pair it with the current
Python Machine checkpoint. Use it when app state and Python calculations must branch, restore, and adopt together.
Use Native CDP for arbitrary sites or existing signed-in sessions.

## Create the profile

Generate an Ed25519 approval key outside the page and keep its private half with the approving authority. Then
compile the `transactionalApp` recipe:

```sh
npx pyproc-mcp init \
  --recipe transactionalApp \
  --engine-root /absolute/path/to/cpython-wasi \
  --origin https://workspace.example.test \
  --action snapshot --action click \
  --purpose "branch the cooperative workspace" \
  --acknowledge-effects \
  --execution-memory-root /absolute/private/pyproc-memory \
  --enable-effect-transactions \
  --effect-approval-authority operator:workspace=/absolute/keys/workspace-public.pem \
  --enable-app-space \
  --app-id com.example.workspace \
  --app-origin https://workspace.example.test \
  --app-adapter-version 1.0.0 \
  --app-state-schema workspace/3
```

Add `--execution-memory-secret-env NAME` for each literal that snapshots must reject and
`--app-max-state-bytes N` to lower the default 1 MiB state limit. The named secrets must be present when the
profile is compiled, checked, and run.

Run an effect-free preflight:

```sh
npx pyproc-control --config .pyproc/manifest.json --check
```

The report must show AppSpace, Execution Memory, Rehearse-Commit, and the FrameSpace provider as enabled. It
contains app identities and public approval-key paths, never secret values or private keys.

## Install the cooperative adapter

Serve the two classic scripts from the installed package and load the AppSpace target first:

```html
<script src="/appSpaceTarget.js"></script>
<script>
  pyprocAppSpace.register({
    identity: {
      appId: "com.example.workspace",
      origin: location.origin,
      adapterVersion: "1.0.0",
      stateSchema: "workspace/3",
    },
    scope: ["router", "domainStore", "declaredRecords", "effectOutbox"],
    revision: () => `apprev:${store.revision}`,
    quiesce: async () => store.freezeLocalWrites(),
    exportState: async () => store.exportDeclaredState(),
    importState: async (state, outbox) => store.replaceDeclaredState(state, outbox),
    resume: async () => store.resumeLocalWrites(),
    describeEffects: async () => store.outbox(),
    stageEffect: async (effect) => store.stagePublicEffectIdentity(effect),
    finalizeEffect: async (effect) => store.finalizeEffect(effect),
  });
</script>
<script src="/frameSpaceTarget.js"></script>
```

`revision()` must change for every exported logical-state or outbox change. `quiesce()` must stop those changes
until `resume()`. The adapter must not export credentials, cookies, DOM, renderer internals, or server state.

## Attach and establish a base pair

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start(".pyproc/manifest.json");
const project = {
  workspaceId: "workspace:records",
  commit: "exact-project-revision",
  treeSha256: "sha256:...",
  diffSha256: "sha256:...",
  untracked: false,
};
const memory = await client.createExecutionSession("session:records", project);
const target = await client.openTarget("https://workspace.example.test/records/42", {
  expectedRisk: "externalEffect",
});
const frame = await client.attachSession(target.output.targetRef);
const app = await client.attachApp(frame.output);

const base = await client.checkpointApp({
  appRef: app.output.appRef,
  pairId: "pair:records-base",
  executionSessionId: "session:records",
  expectedSessionRevisionSha256: memory.output.contentSha256,
  expectedActivePairSha256: null,
});
```

The checkpoint publishes one immutable pair marker and makes that pair active. It also exports a portable Machine
image for durable evidence, but live restore uses its in-process checkpoint index.

## Branch, restore, and adopt

After changing both app and Python state, capture a candidate from the active base:

```js
await client.runPython("candidate_total = calculate_total()");
const candidate = await client.branchApp({
  appRef: app.output.appRef,
  pairId: "pair:records-candidate-a",
  parentPairId: "pair:records-base",
  executionSessionId: "session:records",
  expectedSessionRevisionSha256: memory.output.contentSha256,
  expectedActivePairSha256: base.output.pair.contentSha256,
});
```

Restore is non-adopting:

```js
await client.restoreApp(app.output.appRef, "pair:records-base");
```

Adopt requires the active digest you inspected. A stale digest fails and rolls both live sides back:

```js
await client.adoptApp(
  app.output.appRef,
  candidate.output.pair.pairId,
  base.output.pair.contentSha256,
);
```

Never retry `APP_SPACE_ROLLBACK_FAILED` automatically. Its outcome is unknown and requires inspection.

## Stage an effect without sending

Prepare the consequential action through Rehearse-Commit first. Then stage its exact identity in the app outbox:

```js
const staged = await client.stageAppEffect(
  app.output.appRef,
  prepared.output.transaction.transactionId,
  prepared.output.transaction.contentSha256,
);

console.assert(staged.output.sent === false);
```

Staging does not approve, commit, or dispatch. Continue through `rehearseEffectTransaction`, a separately signed
approval, and `commitEffectTransaction`. After that transaction reaches `terminal` or `sealed`, copy its result to
the app outbox:

```js
await client.finalizeAppEffect(
  app.output.appRef,
  terminal.output.transactionId,
  terminal.output.contentSha256,
);
```

Do not use app restore as compensation for a remote effect. It restores only declared local state and the Python
checkpoint.

## Python and MCP

The Python client has the same camel-case methods: `attachApp`, `checkpointApp`, `branchApp`, `restoreApp`,
`adoptApp`, `inspectApp`, `listAppPairs`, `stageAppEffect`, and `finalizeAppEffect`.

MCP exposes `appAttach`, `appCheckpoint`, `appBranch`, `appRestore`, `appAdopt`, `appInspect`, `appList`,
`appEffectStage`, and `appEffectFinalize`. All three clients return the same content-addressed pair objects.

## Recovery boundary

Complete pair markers and active HEADs persist under the Execution Memory root. A later process can inspect and
list them. AppSpace 1.0 does not cold-import a stored pair's Machine image into a new running control process.
Perform branch, restore, and adopt while the originating Machine and its checkpoint tree are alive. Use Execution
Memory handoff for durable provenance and a normal Machine revival path for cold work.

See the [AppSpace specification](#), [FrameSpace](../../automate-browser-with-pyproc/references/frame-space.md),
[Execution Memory](../../use-pyproc-machine/references/execution-memory.md), and [Rehearse-Commit](../../commit-pyproc-effects/references/rehearse-commit.md).

## Publish restored candidates as a ReplayGraph

ReplayGraph can turn complete AppSpace pairs into effect-free state nodes and exact direct-child transitions.
After `app.restore`, AppSpace returns a random restore proof bound to that source pair. ReplayGraph consumes it
once when `world.capture.app.branch` publishes the candidate edge. This proves that capture started from the
declared source and prevents another edge from reusing the same restoration event.

The graph stores pair digests and state identity, not an independent copy of browser authority. It does not call
the adapter during traversal, adopt a candidate, stage an effect, or cold-import the Machine side. See
[ReplayGraph Worlds](../../explore-pyproc-replays/references/replay-graph.md).

## Motor integration

The Motor `cooperative` actuator compiles the same absolute intent into an already authorized AppSpace action.
It does not add a raw page RPC, bypass app revision fencing, consume an outbox item without Rehearse-Commit, or
claim that paired restore undoes a remote effect. The resulting ActuationReceipt keeps the same terminal
vocabulary as browser and Windows routes and references the cooperative evidence. See
[Proof-Carrying Motor](../../automate-browser-with-pyproc/references/actuation.md).

# Transactional AppSpace 1.0

Transactional AppSpace is the protocol for pairing a cooperative application's declared logical state with an
in-process Python Machine checkpoint. It lets a caller create immutable candidates, restore both sides, and
adopt one candidate with compare-and-swap protection. External effects remain owned by Rehearse-Commit.

This specification is intentionally narrower than browser snapshotting. It does not capture a renderer heap,
DOM nodes, event listeners, cookies, arbitrary IndexedDB databases, cross-origin frames, canvas pixels, service
workers, or remote service state.

## Activation and authority

AppSpace is disabled by default. A profile may enable it only when all of these conditions hold:

- `executionMemory.enabled` is true;
- `effectTransactions.enabled` is true;
- `browser.provider` is `frame`;
- the browser profile acknowledges `externalEffect` authority;
- at least one exact app identity is configured;
- every configured app origin is also an exact `browser.allowedOrigins` entry.

The cooperative page runs in the existing FrameSpace iframe with `sandbox="allow-scripts allow-forms"`, the
`credentialless` attribute, and `referrerPolicy="no-referrer"`. AppSpace does not add `allow-same-origin`, parent
DOM access, popup authority, top navigation, downloads, or a raw method channel. The page's self-description is
data, not permission. The host compares it with the configured identity and the live FrameSpace target origin.

## App identity

An identity has exactly four fields:

```json
{
  "appId": "com.example.workspace",
  "origin": "https://workspace.example.test",
  "adapterVersion": "1.0.0",
  "stateSchema": "workspace/3"
}
```

`appId`, exact URL origin, adapter version, and state schema must all match. AppSpace performs no implicit schema
migration and does not substitute an adapter from another origin. The `appRef` returned by `app.attach` is an
opaque attachment to one live FrameSpace session. It is not durable authority.

## Cooperative target protocol

The target loads `appSpaceTarget.js` before `frameSpaceTarget.js` and registers one adapter through
`globalThis.pyprocAppSpace.register(adapter)`. Registration is single-use. The adapter provides:

```text
identity
scope
revision()
quiesce()
exportState()
importState(state, outbox)
resume()
describeEffects()       optional
stageEffect(effect)     optional
finalizeEffect(effect)  optional
```

The transport exposes only `describe`, `quiesce`, `export`, `import`, `resume`, `stageEffect`, and
`finalizeEffect`. It is not an arbitrary page RPC surface. A capture uses an unguessable fence and checks the app
revision before quiesce, before export, and after export. A changed revision fails with
`APP_SPACE_REVISION_CONFLICT` and publishes no pair.

## AppStateSnapshot

The host creates the content-addressed `pyproc.appStateSnapshot` version 1 envelope. Its closed fields are:

```text
format, version
identity
revision
state
outbox
scope
stateSha256
contentSha256
```

`state` must be canonical JSON data. Object depth is at most 24, the structural item budget is 100,000, and the
configured `maxStateBytes` is at most 8 MiB. The current format has no blob sidecar. Allowed scope labels are
`router`, `form`, `domainStore`, `declaredRecords`, `localOperations`, and `effectOutbox`.

Keys that name passwords, tokens, API keys, cookies, authorization, client secrets, DOM, HTML, or a JavaScript
heap are rejected recursively. Every configured Execution Memory secret literal is also rejected. This is a
bounded literal defense, not general sensitive-data discovery. The host recomputes all digests and repeats secret
and quota validation whenever a pair is opened under the current configuration.

An outbox contains at most 64 unique entries. Each entry has exactly:

```json
{
  "intentSha256": "...",
  "state": "staged",
  "terminal": null,
  "effectReceiptSha256": null
}
```

A terminal entry requires an honest terminal value. A staged entry cannot contain a terminal or receipt.

## PairedGeneration

The immutable `pyproc.pairedAppGeneration` version 1 object contains:

```text
pairId and optional parentPairSha256
exact AppStateSnapshot
Machine checkpoint index
exported Machine image SHA-256, generation, and environment fingerprint
exact Execution Session ID and revision SHA-256
creation provenance
contentSha256
```

The Machine checkpoint index is the live restore handle. The exported portable Machine image and generation are
durable evidence of the captured state. The current Control product cannot import that image into the already
running Machine, so AppSpace restore is an in-process checkpoint operation. A new process can list and verify old
pairs, but it cannot cold-restore their Machine side through AppSpace 1.0.

## Publication and crash rule

Publication has three distinct facts:

1. write the immutable content-addressed pair object;
2. compare-and-swap `pairMarker:<pairId>` to publish a complete candidate;
3. for a checkpoint or adopt, compare-and-swap `appHead:<appId>` to select the active pair.

An object without its pair marker is invisible to `app.list`, cannot be opened by pair ID, and never becomes
active after a crash. A branch publishes a complete candidate without moving the active app HEAD. Its parent must
be the current active pair, preventing sibling work from being based on an unadopted state by accident.

## Restore and adopt

Restore first captures rollback checkpoints for the live app and Machine. It then imports the candidate app
snapshot under the fence, exports it again, verifies state and outbox equality, and restores the Machine
checkpoint. Both sides remain quiesced until verification finishes.

`app.restore` changes live state without changing `appHead`. `app.adopt` restores the pair and then moves
`appHead` with the caller's exact expected digest. If that compare-and-swap loses a race, AppSpace restores the
previous app snapshot and Machine checkpoint. If the HEAD moved but releasing the app fence fails, it attempts to
move the HEAD back as well. A failed paired rollback is `APP_SPACE_ROLLBACK_FAILED` with `outcomeUnknown`; callers
must stop and investigate instead of guessing which side is current.

AppSpace provides adopt, not merge. General merging of interpreter heaps and application state is outside the
contract.

## Effect boundary

`app.effect.stage` accepts only an existing exact Rehearse-Commit transaction in `prepared`, `rehearsed`, or
`approved` state. It gives the cooperative app only the transaction ID, intent digest, destination, and risk. The
operation returns `sent: false` and never dispatches an external effect.

`app.effect.finalize` accepts only the exact `terminal` or `sealed` transaction revision and copies its honest
terminal and receipt digest into the outbox. AppSpace never approves or commits an effect. Only `effect.commit`
owns the durable send lease and live provider boundary. Restoring app state cannot undo a remote effect.

## Operations

| Operation | Success outcome | Meaning |
|---|---|---|
| `app.attach` | `applied` | Bind one configured live cooperative adapter |
| `app.checkpoint` | `applied` | Capture a pair and move the active HEAD |
| `app.branch` | `applied` | Capture a sibling candidate without moving HEAD |
| `app.restore` | `applied` | Restore both sides without changing HEAD |
| `app.adopt` | `applied` | Restore both sides and CAS the active HEAD |
| `app.inspect` | `observed` | Inspect live adapter and active pair |
| `app.list` | `observed` | List complete pair markers |
| `app.effect.stage` | `applied` | Stage an exact effect identity without sending |
| `app.effect.finalize` | `applied` | Record an exact terminal effect result |

JavaScript Control, Python Control, and MCP adapt these same operations. They do not maintain separate state
machines.

## Conformance

A conforming implementation must prove all of the following:

- configured identity and live origin match before attachment;
- DOM, renderer heap, cookie, and cross-origin state are never claimed as captured;
- revision races publish no pair;
- a missing completion marker creates no visible candidate;
- restore and adopt never intentionally leave one side on another pair;
- stale adopt restores both live sides and leaves the existing HEAD unchanged;
- configured secret literals and forbidden state keys are rejected;
- stage performs zero external sends;
- JavaScript, Python, and MCP return the same durable pair digest;
- browser evidence runs from the packed npm artifact in Chrome and Edge.

The executable gates are `npm run test:contracts`, `npm run test:types`, and
`npm run test:app-space`.
