# javascript-control

## Contents

- JavaScript Control SDK
- Install and preflight
- Persistent Python and recovery
- Execution Memory
- Rehearse-Commit transactions
- Transactional AppSpace
- ReplayGraph Worlds
- PyProc Eyes and evidence-backed action
- Screenshots and artifacts
- Proof-Carrying Motor
- Cancellation, deadlines, and external effects
- Verification
- Repository experience verification

# JavaScript Control SDK

The stable `pyproc/control` Node.js subpath starts the installed pyproc product and exposes persistent Python,
checkpoint recovery, browser automation, PyProc Eyes, verified binary attachments, and cancellation through
one supported JavaScript API.

## Install and preflight

Install the exact npm version and prepare the pinned engine distribution.

```sh
npm install --save-exact pyproc@0.0.24
npm install pyproc@<exact-version>
```

Create the version 1 policy manifest with [Machine Entrance](../../use-pyproc-machine/references/machine-entrance.md), then validate it without
starting a live product:

```sh
npx pyproc-mcp init --recipe pythonOnly
npx pyproc-control doctor --config ./.pyproc/manifest.json
```

```js
import { PyProcControlClient } from "pyproc/control";

const report = await PyProcControlClient.doctor(".pyproc/manifest.json");
console.log(report.ok);
```

`doctor()` runs the same complete digest-verifying preflight as the shell command and returns its blocking report
without starting the Machine. `check()` remains the lighter startup-configuration compatibility check. The
doctor's `next.firstResult.javascript` names `start()` and `runPython()` while the parent action fixes the
canonical `machine.run` operation and input shared with shell, Python, and MCP.

`start()` runs the matching `pyproc-control` file from the installed package. It does not depend on a global
bin lookup. An embedded host can pass `command: [nodePath, controlScriptPath]` explicitly.

## Persistent Python and recovery

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start(".pyproc/manifest.json");
try {
  await client.runPython("prepared = [10, 20, 30]");
  const checkpoint = await client.saveCheckpoint();

  try {
    await client.runPython("prepared.append(999)\nraise ValueError('failed attempt')");
  } catch (error) {
    await client.restoreCheckpoint(checkpoint.output.index);
  }

  console.log((await client.runPython("prepared")).output.value);
} finally {
  await client.close();
}
```

The child process owns one persistent Python Machine for its lifetime. `close()` first closes protocol input,
allows the product to drain, then applies a bounded termination fallback. It is safe to await more than once.

## Execution Memory

Enable it when creating the profile, then publish the current Machine as an immutable session revision:

```sh
npx pyproc-mcp init \
  --recipe pythonOnly \
  --execution-memory-root /absolute/private/pyproc-memory
```

```js
const project = {
  workspaceId: "workspace:forecast",
  commit: "exact-commit",
  treeSha256: "sha256:...",
  diffSha256: "sha256:...",
  untracked: false,
};
const created = await client.createExecutionSession("session:forecast", project);
const opened = await client.openExecutionSession("session:forecast");
console.log(created.output.contentSha256 === opened.output.contentSha256);
```

Updates require the exact current `contentSha256`; stale writers fail instead of silently retrying. Completion
requires a verified Evidence Pack matching the repository identity. Signed export proves provenance but import
still requires a separately approved permission-manifest digest. See [Execution Memory](../../use-pyproc-machine/references/execution-memory.md).

## Rehearse-Commit transactions

An effect-enabled profile adds `prepareEffectTransaction`, `rehearseEffectTransaction`,
`approveEffectTransaction`, `commitEffectTransaction`, `inspectEffectTransaction`, `listEffectTransactions`,
and `sealEffectTransaction`. They map directly to the shared Control operations.

```js
const prepared = await client.prepareEffectTransaction(intentInput);
const rehearsed = await client.rehearseEffectTransaction(
  intentInput.transactionId,
  prepared.output.transaction.contentSha256,
  { mode: "computed", code: "6 * 7", expectedValue: "42" },
);
const approved = await client.approveEffectTransaction(
  intentInput.transactionId,
  rehearsed.output.contentSha256,
  separatelySignedGrant,
);
const terminal = await client.commitEffectTransaction(
  intentInput.transactionId,
  approved.output.contentSha256,
);
```

The stable subpath also exports `createApprovalGrant`, `verifyApprovalGrant`,
`createEffectTransactionRegistry`, `EffectTransactionRegistry`, and `FileEffectTransactionStore` for an
approving or embedded Node.js host. The private signing key must remain outside the page and manifest. See the
[Rehearse-Commit guide](../../commit-pyproc-effects/references/rehearse-commit.md).

## Transactional AppSpace

An AppSpace-enabled FrameSpace profile adds `attachApp`, `checkpointApp`, `branchApp`, `restoreApp`, `adoptApp`,
`inspectApp`, `listAppPairs`, `stageAppEffect`, and `finalizeAppEffect`. They map directly to the shared `app.*`
operations. The subpath also exports `createAppSpaceRegistry`, `AppSpaceRegistry`, and `FileAppSpaceStore` for an
embedded Node.js host.

App state is adapter-declared canonical JSON. A pair includes the exact app snapshot, live Machine checkpoint,
exported Machine generation, and Execution Session revision. Restore and adopt operate on both live sides;
effect staging returns `sent: false` and leaves dispatch to Rehearse-Commit. See
[Transactional AppSpace](../../transact-pyproc-app-state/references/app-space.md).

## ReplayGraph Worlds

A ReplayGraph-enabled profile adds `importReplayGraphRecording`, `createReplayGraphAppWorld`,
`captureReplayGraphAppBranch`, `openReplayWorld`, `inspectReplayWorld`, `listReplayWorldEdges`,
`traverseReplayWorld`, `checkpointReplayWorld`, `restoreReplayWorld`, `evaluateReplayWorld`,
`inspectReplayWorldCoverage`, and `listReplayGraphs`. They map directly to the shared `world.*` operations.

The stable subpath also exports `createReplayGraphRegistry`, `ReplayGraphRegistry`, `FileReplayGraphStore`,
`ReplayWorld`, `evaluateReplayGraph`, `inspectReplayGraphCoverage`, and `retainedReplayGraphObjects` for an
embedded Node.js host. Traversal returns stored terminals without provider calls. Its capabilities and cursor
checkpoints are process-local, while graph revisions and HEADs are durable. See [ReplayGraph Worlds](../../explore-pyproc-replays/references/replay-graph.md).

## PyProc Eyes and evidence-backed action

Legacy semantic pages can be collected without a raw browser handle:

```js
const pages = [];
let observed = await client.observe(attached.output, {
  expectedRisk: "read", mode: "all", maxNodes: 500,
});
for (;;) {
  const page = "result" in observed.output ? observed.output.result : observed.output;
  pages.push(page);
  if (page.inventory.complete) break;
  observed = await client.observe(attached.output, {
    expectedRisk: "read", continuationRef: page.continuationRef,
  });
}
const nodes = pages.flatMap((page) => page.nodes);
if (nodes.length !== pages.at(-1).inventory.total) throw new Error("semantic inventory is incomplete");
```

The final page's `nodesSha256` is the canonical sorted-key JSON digest of the complete node array. Every page
must have the same `receiptSha256`; a changed document rejects the continuation. NativeCdpSpace wraps the page
inside the snapshot action's `result`, while FrameSpace returns the page directly, so the example normalizes
that provider envelope explicitly.

```js
const opened = await client.openTarget("https://example.test", {
  expectedRisk: "externalEffect",
  waitUntil: "load",
});
const attached = await client.attachSession(opened.output.targetRef);
const eyes = client.perception(attached.output);

const situation = await eyes.situate({
  objective: "Save and prove completion",
  requirements: [{
    requirementRef: "requirement:save",
    select: { role: "button", name: "Save", actionable: true },
    need: ["fact", "affordance"],
    cardinality: "one",
  }],
});
const save = situation.requirement("requirement:save").oneAffordance("click");
const applied = await eyes.actAffordance(save, {
  intent: "Save the document",
  verify: { entityAppeared: { role: "status", nameContains: "Saved" } },
});
console.log(applied.output.actions[0].result.evidence.verification.state);
console.log(applied.output.actions[0].convergence);
```

`query().one()` checks APX `query.matched` and rejects zero or multiple matches even if the byte budget returned
only one of several candidates. `entityRef` is observation identity. Only a fresh broker-issued authorized
affordance is proof-carrying action authority. The older locator action remains available for compatibility.
`SituationResult`, `SituationRequirement`, `SituationFact`, `SituationAffordance`, and `SituationUnknown` are
immutable wire views. `whatChanged(observationRef)` requests a
delta, and `explainActionability(entityRef)` returns the semantic, geometry, and interaction slice.

`SituationRequirement.candidateEvidence` states whether enumeration was complete, the exact count or observed
lower bound, projected and omitted matches, and canonical ordering. An opaque continuation is read-only and bound
to the exact world and expiry. Verified actions recheck authority at the send boundary, perform independent input
release when needed, and return `observationCoverage`; incomplete relevant coverage cannot prove absence.

Every proof-carrying action also returns an `ActionConvergenceReceipt`. Native CDP places it on
`output.actions[0].convergence`; FrameSpace places it on `output.results[0].convergence`. A safe refusal exposes
the same value at `ControlRemoteError.details.convergence`. The receipt bounds the first-effect search to two
candidates, one reobservation, zero effect retries, and 30000 ms. `effectAttempts` is zero or one and an
`outcomeUnknown` terminal is never retried.

Native CDP and FrameSpace use the same facade. Native CDP can return verified pixel-on-demand attachments at
level L4. FrameSpace reports its honest L3 boundary and rejects visual inference.

## Screenshots and artifacts

```js
import { writeFile } from "node:fs/promises";

const captured = await client.act(attached.output, [
  { kind: "screenshot", format: "png", expectedRisk: "read" },
]);

const image = captured.attachments[0];
await writeFile("capture.png", image.bytes);
await client.deleteArtifact(captured.output.actions[0].result.artifactRef);
```

Output is not exposed until chunk order, decoded byte length, MIME type, and SHA-256 match the terminal
descriptor. A successful `ControlResult` has `terminal: "completed"`; `ControlRemoteError.terminal` preserves
`rejected`, `partial`, `outcomeUnknown`, or `cancelled`. JSON keeps the opaque artifact reference for bounded
reads and explicit deletion.

After the owned flow, verify resource convergence through the existing inspect operation:

```js
await client.detachSession(attached.output);
await client.closeTarget(opened.output.targetRef);
const { output } = await client.inspectSpace();
if (output.resources.sessions !== 0 || output.resources.artifacts !== 0
  || Object.values(output.resources.perception).some((value) => value !== 0)) {
  throw new Error("automation resources did not return to the isolated baseline");
}
```

The complete vector also includes target, locator, continuation, watcher, transport session, pending command,
and listener counts. Shared profiles compare against their starting snapshot rather than assuming zero borrowed
targets.

## Proof-Carrying Motor

When `actuation.enabled` is true, use `openMotorTask()` to bind target, session, Situation, artifact, and cleanup
ownership to one scope:

```js
const task = await client.openMotorTask({ url: "https://app.example/work",
  expectedRisk: "externalEffect", waitUntil: "load" });
try {
  const observed = await task.situate({ requirements: [{
    requirementRef: "requirement:save",
    select: { role: "button", name: "Save", actionable: true },
    need: ["fact", "affordance"], cardinality: "one",
  }] });
  const diagnostic = task.diagnoseAmbiguity(observed, "requirement:save");
  if (!diagnostic.canExecute) throw new Error("caller refinement is required");
  // Build an absolute ActuationIntent from observed.situation and call task.execute(...).
} finally {
  const cleanup = await task.close();
  if (cleanup.state !== "complete") console.error(cleanup.failures);
}
```

The task never chooses among ambiguous candidates. It executes only a Situation observed by the same task and
closes only a target it created. `retainArtifact()` transfers explicit retention intent. Cleanup attempts remain
independent, and a cleanup error never retries an earlier effect. See [the Motor guide](../../automate-browser-with-pyproc/references/actuation.md).

## Cancellation, deadlines, and external effects

```js
const request = client.requestAsync("machine.run", {
  code: "import time\ntime.sleep(30)",
});
await request.cancel("operator deadline");

try {
  await request.result;
} catch (error) {
  console.log(error.code, error.outcome, error.retryable);
}
```

Every high-level method accepts `timeoutMs`. A deadline sends one protocol cancel and waits for the canonical
terminal. If the connection cannot settle, it closes and returns `CONTROL_TIMEOUT` with `outcomeUnknown` and
`retryable: false`. A pending connection loss returns the equally conservative `CONTROL_CONNECTION_LOST`.
Neither case automatically repeats an effect.

Python restore cannot undo navigation, input, storage, download, popup, network, or another external effect.
Never retry an `applied` or `outcomeUnknown` action automatically.

## Verification

The contract gate fixes the public classes, APX operation mapping, one-match refusal, deadline cancel, and
invalid startup input. The package gate imports only `pyproc/control` from a packed install. The installed
Control product gate uses that public import to preflight and start the product, run persistent Python, cancel
a delivered command, query APX through Native CDP and FrameSpace, verify screenshot bytes, reject request ID
reuse, detach, and shut down on Chrome and Edge.

The same installed gate captures a real portable Machine image, publishes it through Execution Memory, reopens
the immutable revision, and verifies session discovery without exposing image bytes in JSON.

It also sends one approved HTTP effect, refuses automatic resend, and seals the terminal EffectResult with an
exact verified Evidence Pack.

## Repository experience verification

`auditExperience(contractRoot, options)` runs the strict repository contract through the configured
AutomationSpace and atomically publishes one Evidence Pack. `verifyExperience(referenceDir, currentDir)` compares
two exact packs, and `replayEvidencePack(packDir)` validates content, sidecars, and the stored verdict without a
live provider effect.

```js
const audit = await client.auditExperience("qa/eyes", {
  repositoryRoot: process.cwd(),
  outputDir: ".pyproc/evidence/current",
  environmentId: "desktop",
  repository: {
    commit: "exact-commit-id",
    treeSha256: "sha256:...",
    diffSha256: "sha256:...",
    untracked: false,
  },
  motorJourneys: [{ receiptSha256, scenarioId: "save-document", checkpointId: "post-save" }],
});

if (audit.output.verdict !== "verified") {
  throw new Error(`experience verdict: ${audit.output.verdict}`);
}
await client.replayEvidencePack(".pyproc/evidence/current");
```

The caller supplies repository identity. The SDK does not assume Git, run a shell, or mutate the index. The
Evidence Pack arrives as a digest-verified `evidence.pack` attachment. Full setup and contract schemas are in the
[experience verification guide](../../verify-browser-experience/references/verification.md).
