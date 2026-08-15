# execution-memory

## Contents

- Execution Memory
- Configure it
- JavaScript client
- Link a browser situation
- Complete with evidence
- Signed handoff
- Python client
- MCP tools
- Direct host composition
- Boundaries
- Motor records
- Execution Memory specification
- Revision law
- Linked truth
- Session states
- Browser boundary
- Completion
- Handoff
- Privacy and storage
- Conformance

# Execution Memory

Execution Memory keeps the exact Machine, repository, browser observation boundary, permission manifest, and
evidence needed to resume or hand off work. It is opt-in and lives in the installed Control product or the
existing `pyproc/control` subpath.

Transactional AppSpace stores its immutable paired objects and app HEADs beneath the same configured root, but
does not add them to an Execution Memory revision or handoff inventory in version 1. Each pair independently links
the exact Execution Session revision and exported Machine image. Its live restore handle is an in-process Machine
checkpoint, so reopening the filesystem registry proves the pair but does not cold-import it into a new running
Machine. See [Transactional AppSpace](../../transact-pyproc-app-state/references/app-space.md).

ReplayGraph also stores immutable graph revisions, graph HEADs, and content-addressed artifact bytes beneath the
same configured root. Those objects are not added to an Execution Memory session revision or signed handoff
inventory in version 1. Graph import reuses the configured import roots, and graph publication reuses the same
immutable object and compare-and-swap primitives. See [ReplayGraph Worlds](../../explore-pyproc-replays/references/replay-graph.md).

## Configure it

Add `executionMemory` to the version 1 product manifest. The root and every import root must be absolute.

```json
{
  "schemaVersion": 1,
  "engine": { "root": "C:/absolute/cpython-wasi" },
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
  approval is local to its trust domain and is not carried by handoff. See [Rehearse-Commit](../../commit-pyproc-effects/references/rehearse-commit.md).
- A portable Control image is not called cold.
- A signature is not a permission grant.
- `retentionPlan()` reports unreachable objects and sidecars but performs no deletion.
- Literal secret scanning does not understand text rendered inside pixels. Keep the root private and retain the
  redaction rules of Automation Recording and Evidence Pack producers.
- The current Machine sidecar is `.pymachine`; `.webmachine` import remains a separate `pyproc/machine` trust
  flow.

See the [specification](#), [Control Protocol](../../control-pyproc/references/control-protocol.md),
[Machine Fleet](./machine-fleet.md), and [trust and permissions](./trust-permissions.md).

## Motor records

When Motor is enabled, its immutable policies, receipts, and episodes live in the `actuation` namespace beneath
the same private Execution Memory root. Receipt and episode publication uses content-addressed objects plus
single-assignment heads. A receipt must resolve to exactly one episode before an Experience audit can project it
into an Evidence Pack.

Execution Memory stores this lineage but does not transfer action, approval, commit, control, browser, or native
authority. Handoff and replay cannot resend a recorded effect. Apply the same secret, quota, and retention policy
to Motor records as to linked Situations and Evidence Packs. See [Proof-Carrying Motor](../../automate-browser-with-pyproc/references/actuation.md).

# Execution Memory specification

Execution Memory is the durable index that lets a caller reopen verified execution state instead of reconstructing
it from a conversation. Its unit is an immutable session revision. A mutable session HEAD points to one revision
through compare-and-swap, while the revision links existing pyproc artifacts by digest.

It does not introduce another Machine image, browser recording, or evidence format.

```text
session HEAD
    |
    v
immutable revision
|-- repository identity
|-- .pymachine generation and environment
|-- branch and checkpoint labels
|-- SituationCapsule and recording boundary
|-- Evidence Pack verdict
|-- permission manifest digest
`-- parent revision and provenance
```

## Revision law

The canonical format is `pyproc.executionMemoryRevision`, version 1. Every field is closed and the
`contentSha256` is calculated from canonical JSON without the digest field. A revision has zero or one parent.
The first revision has no parent, and every later revision names the exact former HEAD.

Publication is ordered:

```text
verify referenced artifacts
-> write immutable revision object
-> compare expected HEAD
-> atomically replace HEAD
```

A failed comparison leaves the former HEAD unchanged. It may leave an unreachable immutable object or sidecar,
which `retentionPlan()` reports but never deletes.

## Linked truth

| Link | Verification |
|---|---|
| Project | Exact commit, tree digest, diff digest, and untracked flag |
| Machine | Full state-bundle integrity, generation commit, environment digest, and image digest |
| Cold Machine | The image checks above plus an exact completed suspend receipt |
| Browser | Valid SituationCapsule, recording ID, cursor prefix, and final recording digest |
| Evidence | Valid Evidence Pack and stored verdict |
| Permission | Canonical manifest digest, separate from image signature |

The Control product captures a portable `.pymachine` from its current deterministic Python Machine. A direct
host may mark that image `cold` only when a suspend receipt names the same Machine, generation, and environment
and has no pending cleanup. A caller supplied lifecycle string is not sufficient.

The current Machine sidecar contract is `.pymachine`. A multi-guest `.webmachine` remains owned by
`pyproc/machine` and is not accepted by `captureMachineImage()`.

## Session states

The closed states are `active`, `waitingApproval`, `suspended`, `completed`, `failed`, and `abandoned`.

- `waitingApproval` requires an exact pending intent digest.
- `suspended` requires a cold Machine and rejects `outcomeUnknown`.
- `completed` rejects `outcomeUnknown` and requires a verified Evidence Pack whose repository identity exactly
  matches the session project.
- The Control product publishes portable `active`, `waitingApproval`, `failed`, and `abandoned` checkpoints.
  Direct host composition owns a real cold suspend receipt.

Natural-language status, a successful function return, or an unsigned report cannot produce `completed`.

## Browser boundary

A browser boundary is valid only when the SituationCapsule and Automation Recording were captured together.
For a live RecordingSpace, capture runs inside its serialization queue. The queue remains occupied until the
minimal referenced sidecars have been copied and reloaded. For ReplaySpace, the manifest supplies the exact
recording ID, final digest, cursor, and prefix.

The cursor prefix is the digest of the last consumed entry, not the recording final digest. Cursor zero uses the
all-zero digest. Browser cookies, native profile state, unrecorded page state, and external effects are never
part of the revision.

## Completion

Completion consumes an existing canonical Evidence Pack. The pack must replay as `verified`, and its commit,
tree digest, diff digest, and untracked flag must equal the session project. A rejected or incomplete pack may
be linked to a non-completed revision but cannot close the session.

## Handoff

`exportHandoff()` creates a directory containing a canonical descriptor, Ed25519 signature, signer public key,
the full revision chain, and only sidecars reachable from that chain. Import requires both:

1. an exact trusted signer public-key file;
2. an exact approved permission-manifest digest.

Signature proves origin and descriptor integrity. It does not grant browser, network, file, or device authority.
The importer validates the chain and derives the expected inventory before copying any artifact. Missing,
unrelated, duplicated, unsorted, or path-shaped inventory entries fail closed.
Portable Machine images and cold suspend receipts occupy separate inventory sets. A handoff cannot acquire cold
authority merely because another session links the same Machine image digest.

## Privacy and storage

The store contains `objects/`, `sessions/`, `locks/`, `artifacts/`, `exports/`, and a local signing identity.
Files use content-derived names, and session IDs are encoded before becoming filenames. Export output is confined
to the store's `exports/` directory. Control import paths are confined to configured roots.

`secretEnv` values never enter the persisted manifest or preflight report. During capture and every reopen,
configured values are rejected in structured data and as literal UTF-8 or UTF-16LE bytes in Machine images and
artifact files. Values shorter than eight bytes are rejected at configuration time to avoid meaningless binary
matches. This is literal leak prevention, not semantic screenshot redaction or credential discovery. Callers
must still keep the registry outside source control and use the producing subsystem's redaction policy.

## Conformance

A conforming implementation proves:

1. stale writers cannot replace HEAD;
2. every linked object is reverified on open;
3. cold and completed terminals cannot be declared without their proofs;
4. a signed handoff does not grant permissions;
5. a handoff inventory equals the exact revision reachability set;
6. configured secret fixtures do not enter stored bytes;
7. retention identifies orphans without deleting reachable state;
8. installed Control, JavaScript, Python, and MCP operations preserve the same revision digest.

The executable contracts are `tests/contracts/executionMemory.mjs` and the installed Control product gate.
