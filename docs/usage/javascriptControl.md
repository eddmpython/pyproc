# JavaScript Control SDK

The stable `pyproc/control` Node.js subpath starts the installed pyproc product and exposes persistent Python,
checkpoint recovery, browser automation, PyProc Eyes, verified binary attachments, and cancellation through
one supported JavaScript API.

## Install and preflight

Install the exact npm version and prepare the pinned engine distribution.

```sh
npm install --save-exact pyproc@0.0.21
npx pyproc-engine --out /absolute/path/to/pyodide
```

Create the version 1 policy manifest with [Machine Entrance](machineEntrance.md), then validate it without
starting a live product:

```sh
npx pyproc-mcp init --recipe pythonOnly --engine-root /absolute/path/to/pyodide
npx pyproc-control doctor --config ./.pyproc/manifest.json
```

```js
import { PyProcControlClient } from "pyproc/control";

const report = await PyProcControlClient.check(".pyproc/manifest.json");
console.log(report.ok);
```

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
  --engine-root /absolute/path/to/pyodide \
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
still requires a separately approved permission-manifest digest. See [Execution Memory](executionMemory.md).

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
[Rehearse-Commit guide](rehearseCommit.md).

## PyProc Eyes and evidence-backed action

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
```

`query().one()` checks APX `query.matched` and rejects zero or multiple matches even if the byte budget returned
only one of several candidates. `entityRef` is observation identity. Only a fresh broker-issued authorized
affordance is proof-carrying action authority. The older locator action remains available for compatibility.
`SituationResult`, `SituationRequirement`, `SituationFact`, `SituationAffordance`, and `SituationUnknown` are
immutable wire views. `whatChanged(observationRef)` requests a
delta, and `explainActionability(entityRef)` returns the semantic, geometry, and interaction slice.

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
});

if (audit.output.verdict !== "verified") {
  throw new Error(`experience verdict: ${audit.output.verdict}`);
}
await client.replayEvidencePack(".pyproc/evidence/current");
```

The caller supplies repository identity. The SDK does not assume Git, run a shell, or mutate the index. The
Evidence Pack arrives as a digest-verified `evidence.pack` attachment. Full setup and contract schemas are in the
[experience verification guide](experienceVerification.md).
