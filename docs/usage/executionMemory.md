# Execution Memory

Execution Memory keeps the exact Machine, repository, browser observation boundary, permission manifest, and
evidence needed to resume or hand off work. It is opt-in and lives in the installed Control product or the
existing `pyproc/control` subpath.

Transactional AppSpace stores its immutable paired objects and app HEADs beneath the same configured root, but
does not add them to an Execution Memory revision or handoff inventory in version 1. Each pair independently links
the exact Execution Session revision and exported Machine image. Its live restore handle is an in-process Machine
checkpoint, so reopening the filesystem registry proves the pair but does not cold-import it into a new running
Machine. See [Transactional AppSpace](appSpace.md).

ReplayGraph also stores immutable graph revisions, graph HEADs, and content-addressed artifact bytes beneath the
same configured root. Those objects are not added to an Execution Memory session revision or signed handoff
inventory in version 1. Graph import reuses the configured import roots, and graph publication reuses the same
immutable object and compare-and-swap primitives. See [ReplayGraph Worlds](replayGraph.md).

## Configure it

Add `executionMemory` to the version 1 product manifest. The root and every import root must be absolute.

```json
{
  "schemaVersion": 1,
  "engine": { "root": "C:/absolute/pyodide" },
  "browser": { "enabled": false },
  "executionMemory": {
    "enabled": true,
    "root": "C:/private/pyproc-memory",
    "importRoots": ["C:/approved/handoffs"],
    "secretEnv": ["WORKSPACE_SECRET"]
  },
  "timeoutMs": 180000
}
```

Each named secret environment variable must exist and contain at least eight bytes. The value is projected only
to the owned product process. The config, `--check` output, and handoff descriptor contain the environment
variable name but not its value.

If a session will link live browser state, enable Automation Recording on that browser provider. A ReplaySpace
manifest already carries fixed recording pins. A live Native CDP or FrameSpace manifest uses record mode:

```json
{
  "mode": "record",
  "file": "C:/private/pyproc-memory/live-recording.json",
  "overwrite": true
}
```

The recording file's parent must already exist. The product owns the recording lock and captures a verified
snapshot through its serialization queue.

## JavaScript client

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start("./pyproc.json");
await client.runPython("prepared = [10, 20, 30]");

const project = {
  workspaceId: "workspace:forecast",
  commit: "3ad9f2c",
  treeSha256: "sha256:...",
  diffSha256: "sha256:...",
  untracked: false,
};

const created = await client.createExecutionSession("session:forecast", project);
const revision = created.output;

const checkpointed = await client.checkpointExecutionSession(
  "session:forecast",
  revision.contentSha256,
  {
    state: "active",
    branch: "candidate:validated",
    checkpoint: "checkpoint:7",
    outcomeUnknown: false,
    pendingIntentSha256: null,
  },
);

console.log((await client.openExecutionSession("session:forecast")).output);
console.log((await client.listExecutionSessions()).output);
console.log((await client.inspectExecutionSession("session:forecast")).output);
await client.close();
```

`expectedRevisionSha256` is mandatory on every update. Do not fetch HEAD and silently retry after a conflict.
Reopen, reconcile the other writer's revision, and publish a new decision.

## Link a browser situation

Create a SituationCapsule through the existing perception facade, then read the live recording boundary. Pass
both to the same checkpoint call.

```js
const eyes = client.perception(attachedSession);
const situation = await eyes.situate({
  requirements: [{
    requirementRef: "requirement:ready",
    select: { role: "status", name: "Ready" },
    need: ["fact"],
    cardinality: "one",
  }],
});
const inspected = await client.inspectSpace();
const recording = inspected.output.recording;

await client.checkpointExecutionSession(
  "session:forecast",
  current.contentSha256,
  work,
  {
    browser: {
      situation: situation.situation,
      cursor: recording.entries,
      prefixSha256: recording.prefixSha256,
    },
  },
);
```

The product resolves and pins the matching final recording digest itself. A SituationCapsule without a verified
recording snapshot is rejected.

## Complete with evidence

```js
const completed = await client.completeExecutionSession(
  "session:forecast",
  current.contentSha256,
  "C:/private/pyproc-memory/evidence/current",
);
```

The directory must contain a valid Evidence Pack. Its verdict must be `verified` and its repository identity must
equal the session project. The path must be under the registry root or an approved import root.

## Signed handoff

```js
const exported = await client.exportExecutionHandoff("session:forecast", "forecast-handoff");

const imported = await client.importExecutionHandoff(exported.output.outputDir, {
  trustedPublicKeyFile: exported.output.signerPublicKeyFile,
  approvedPermissionManifestSha256: exported.output.requestedPermissionManifestSha256,
});
```

The export path is relative to the registry's `exports/` directory. Import paths must be absolute and under a
configured root. In a real transfer, obtain the trusted public key through a channel independent of the handoff,
inspect the requested permission manifest, and approve its exact digest separately.

The descriptor lists Machine images and cold suspend receipts separately. Export copies a suspend receipt only
when a reachable revision explicitly links that receipt, so sharing an image digest does not upgrade a portable
Machine to cold authority.

## Python client

The Python SDK uses the same camelCase product methods:

```python
created = client.createExecutionSession("session:forecast", project)
opened = client.openExecutionSession("session:forecast")
listed = client.listExecutionSessions()
```

`checkpointExecutionSession`, `completeExecutionSession`, `inspectExecutionSession`,
`exportExecutionHandoff`, and `importExecutionHandoff` map directly to the same Control operations.

## MCP tools

When `executionMemory.enabled` is true, the product exposes:

| Tool | Operation | Outcome |
|---|---|---|
| `memoryCreate` | `memory.create` | applied |
| `memoryCheckpoint` | `memory.checkpoint` | applied |
| `memoryComplete` | `memory.complete` | applied |
| `memoryOpen` | `memory.open` | observed |
| `memoryList` | `memory.list` | observed |
| `memoryInspect` | `memory.inspect` | observed |
| `memoryExport` | `memory.export` | applied |
| `memoryImport` | `memory.import` | applied |

`machineImageExport` and `machine.image.export` are also available only with Execution Memory enabled. Binary
image bytes travel through the attachment lane and are absent from JSON output.

## Direct host composition

Browser hosts that already own Machine Fleet lifecycle may import `createExecutionMemoryRegistry`,
`ExecutionMemoryRegistry`, `ExecutionMemoryArtifacts`, and `FileExecutionMemoryStore` from `pyproc/control`.
Capture the existing artifacts first, then pass their returned links to `createSession()` or
`checkpointSession()`. A cold link additionally requires a completed suspend receipt matching the image commit
and environment. This lower API does not impersonate Fleet authority or terminate a Worker itself.

## Boundaries

- Execution Memory is not a conversation database or vector index.
- It does not restore cookies, a default browser profile, unrecorded DOM state, or external effects.
- A pending Rehearse-Commit intent moves the session to `waitingApproval`. Its terminal EffectResult creates a
  new active or unresolved session revision, and the final EffectReceipt links all three revisions. Transaction
  approval is local to its trust domain and is not carried by handoff. See [Rehearse-Commit](rehearseCommit.md).
- A portable Control image is not called cold.
- A signature is not a permission grant.
- `retentionPlan()` reports unreachable objects and sidecars but performs no deletion.
- Literal secret scanning does not understand text rendered inside pixels. Keep the root private and retain the
  redaction rules of Automation Recording and Evidence Pack producers.
- The current Machine sidecar is `.pymachine`; `.webmachine` import remains a separate `pyproc/machine` trust
  flow.

See the [specification](../specs/executionMemory/README.md), [Control Protocol](controlProtocol.md),
[Machine Fleet](machineFleet.md), and [trust and permissions](trustPermissions.md).

## Motor records

When Motor is enabled, its immutable policies, receipts, and episodes live in the `actuation` namespace beneath
the same private Execution Memory root. Receipt and episode publication uses content-addressed objects plus
single-assignment heads. A receipt must resolve to exactly one episode before an Experience audit can project it
into an Evidence Pack.

Execution Memory stores this lineage but does not transfer action, approval, commit, control, browser, or native
authority. Handoff and replay cannot resend a recorded effect. Apply the same secret, quota, and retention policy
to Motor records as to linked Situations and Evidence Packs. See [Proof-Carrying Motor](actuation.md).
