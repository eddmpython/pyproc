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
  --engine-root /absolute/path/to/pyodide \
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

See the [AppSpace specification](../specs/appSpace/README.md), [FrameSpace](frameSpace.md),
[Execution Memory](executionMemory.md), and [Rehearse-Commit](rehearseCommit.md).
