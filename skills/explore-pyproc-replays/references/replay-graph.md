# replay-graph

## Contents

- ReplayGraph Worlds
- Enable it
- Import a sealed recording
- Build an AppSpace branch world
- Traverse without effects
- Evaluate and inspect coverage
- Operations and MCP tools
- Safety and limits
- Motor integration
- ReplayGraph Worlds 1.0
- Contract
- Node identity
- Edge identity and provenance
- Construction
- Traversal authority
- Evaluation and coverage
- Storage, integrity, and quotas
- Non-goals and boundaries
- Conformance

# ReplayGraph Worlds

ReplayGraph turns a verified linear recording or exact Transactional AppSpace pairs into an immutable branch
world. Opening, inspecting, traversing, checkpointing, restoring, evaluating, and measuring that world performs
no live browser action.

## Enable it

ReplayGraph is disabled by default and requires Execution Memory. Use a private absolute root and limit recording
imports with `importRoots`:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/cpython-wasi" },
  "executionMemory": {
    "enabled": true,
    "root": "/absolute/private/pyproc-memory",
    "importRoots": ["/absolute/private/recordings"]
  },
  "replayGraph": { "enabled": true }
}
```

Check the complete product before starting it:

```bash
npx pyproc-control --config /absolute/path/to/pyproc-control.json --check
npx pyproc-mcp --config /absolute/path/to/pyproc-control.json --check
```

Enabling the feature adds twelve `world.*` operations to the existing Control Protocol and twelve matching MCP
tools. It adds no root export or new package subpath.

## Import a sealed recording

First create and seal an Automation Recording as described in [ReplaySpace](../../automate-browser-with-pyproc/references/replay-space.md). The file must be
absolute and resolve beneath an Execution Memory import root.

JavaScript:

```js
const imported = await client.importReplayGraphRecording(
  "graph:checkout-review",
  "/absolute/private/recordings/checkout.pyproc-recording.json",
);
const rootSha256 = imported.output.graph.rootSha256;
```

Python:

```python
imported = client.importReplayGraphRecording(
    "graph:checkout-review",
    "/absolute/private/recordings/checkout.pyproc-recording.json",
)
root_sha256 = imported.output["graph"]["rootSha256"]
```

Import verifies the complete recording and copies content-addressed artifact bytes. It creates honest implicit
cursor nodes rather than claiming that the recording contains a complete browser snapshot.

## Build an AppSpace branch world

Attach and checkpoint the cooperative app, then create the world from that complete pair:

```js
const created = await client.createReplayGraphAppWorld("graph:pricing", basePairId);
let rootSha256 = created.output.rootSha256;
const sourceNodeRef = created.output.startNodeRefs[0];
```

Each branch must be a direct AppSpace child of the source pair. Restore the exact source immediately before
capturing the edge:

```js
const restored = await client.restoreApp(appRef, sourcePairId);
const added = await client.captureReplayGraphAppBranch({
  graphId: "graph:pricing",
  expectedRootSha256: rootSha256,
  sourceNodeRef,
  sourcePairId,
  targetPairId: candidatePairId,
  restoreRef: restored.output.restoreProof.restoreRef,
  operation: "pricing.choose",
  input: { choice: "candidate-a" },
  terminal: { ok: true, output: { accepted: true } },
  risk: "localMutation",
});
rootSha256 = added.output.rootSha256;
```

The restore reference is one-shot. Reusing it or passing another pair's proof fails before publication. A second
writer must use the current root or handle `REPLAY_GRAPH_HEAD_CONFLICT` by reopening and deciding whether its
candidate still belongs.

## Traverse without effects

Open one exact revision, list current edges, then pass a returned capability and the current node back together:

```js
const opened = await client.openReplayWorld("graph:pricing", rootSha256);
const worldRef = opened.output.world.worldRef;
const currentNodeRef = opened.output.world.currentNodeRef;
const choices = await client.listReplayWorldEdges(worldRef);
const choice = choices.output.find((edge) => edge.input.choice === "candidate-a");
const result = await client.traverseReplayWorld(
  worldRef,
  choice.capabilityRef,
  currentNodeRef,
);

console.log(result.output.terminal, result.output.replayedEffect); // stored terminal, false
```

Calling `world.edges` again invalidates previously issued capabilities. Traversing consumes one capability even
when validation fails. List again after restoring or changing the cursor.

An in-process checkpoint can rewind that open cursor:

```js
const checkpoint = await client.checkpointReplayWorld(worldRef);
// traverse one or more known edges
await client.restoreReplayWorld(worldRef, checkpoint.output);
```

The checkpoint cannot reopen a cursor after process exit. Persist `graphId`, `rootSha256`, and a start node when
you need a new process to open the same durable world.

## Evaluate and inspect coverage

Evaluation uses edge references, not natural-language action names:

```js
const verdict = await client.evaluateReplayWorld(
  "graph:pricing",
  rootSha256,
  {
    startNodeRef: sourceNodeRef,
    goalNodeRefs: [goalNodeRef],
    forbiddenEdgeRefs: [dangerousEdgeRef],
    stepBudget: 8,
  },
  selectedEdgeRefs,
);
```

`inspectReplayWorldCoverage(worldRef)` reports reachable nodes, known edges, dead ends, provenance, and explicit
unexplored action classes. Do not report a missing graph edge as a caller reasoning failure. It means the world
does not contain that transition.

Direct `pyproc/control` consumers can use `evaluateReplayGraph`, `inspectReplayGraphCoverage`, and
`retainedReplayGraphObjects` against a verified revision without starting a Control process.

## Operations and MCP tools

| Control operation | MCP tool | Purpose |
|---|---|---|
| `world.import.recording` | `worldImportRecording` | Import one sealed recording |
| `world.create.app` | `worldCreateApp` | Create a world from one complete pair |
| `world.capture.app.branch` | `worldCaptureAppBranch` | Add one restored direct-child transition |
| `world.open` | `worldOpen` | Open a pinned effect-free cursor |
| `world.inspect` | `worldInspect` | Inspect cursor and root identity |
| `world.edges` | `worldEdges` | List exact edges and issue capabilities |
| `world.traverse` | `worldTraverse` | Consume one edge capability |
| `world.checkpoint` | `worldCheckpoint` | Save the in-process cursor |
| `world.restore` | `worldRestore` | Restore the same open cursor |
| `world.evaluate` | `worldEvaluate` | Run the deterministic path evaluator |
| `world.coverage` | `worldCoverage` | Inspect known and unexplored coverage |
| `world.list` | `worldList` | List durable graph HEADs |

## Safety and limits

- Traversal never calls Native CDP, FrameSpace, AppSpace, or a remote service.
- A historical external effect remains labelled, but replay does not resend it.
- Graph SHA-256 values detect changed content and do not identify an author.
- Graph state and artifacts may contain secrets. Keep the root private and apply retention outside the process.
- Version 1 does not synthesize branches, delete unreachable objects, sign graph roots, or cold-resume cursors.
- A graph is a bounded record of known transitions, not a complete copy of a site.

See the [ReplayGraph 1.0 specification](#) for the identity, integrity, provenance,
quota, and conformance rules.

## Motor integration

The Motor `replay` actuator requires one exact stored edge whose input names the requested receipt. Traversal
consumes the normal world capability and returns the recorded terminal with `providerCalls: 0`. It never converts
a missing edge into a guessed action, never calls a live provider, and never turns a historical external effect
into current authority. See [Proof-Carrying Motor](../../automate-browser-with-pyproc/references/actuation.md).

# ReplayGraph Worlds 1.0

ReplayGraph Worlds is the immutable, effect-free branch model above Automation Recording and Transactional
AppSpace. It preserves exact observed or restored transitions as content-addressed nodes and edges. It never
predicts an unrecorded browser result and never opens a browser during traversal.

## Contract

A version 1 revision has format `pyproc.replayGraph` and contains:

- one `graphId`, an optional parent-root digest, and one or more start node references;
- content-addressed nodes, edges, and artifact descriptors;
- explicit unexplored action classes;
- a canonical SHA-256 `rootSha256` over the complete revision body.

An update creates a new immutable revision and compare-and-swaps the graph HEAD. An old pinned root remains
readable. A writer using a stale expected root receives `REPLAY_GRAPH_HEAD_CONFLICT` and does not move HEAD.

## Node identity

A node reference is the canonical digest of all fields below:

```text
provider kind
environment digest
policy digest
canonical state
complete, partial, or implicit completeness
artifact digests
session revision digest, when present
pending effect digest, when present
```

URL, title, DOM identity, or screenshot similarity alone cannot merge nodes. A linear recording therefore uses
honest `implicit` cursor nodes when it has no complete page-state capture. A Transactional AppSpace pair produces
a `complete` node that binds the app state, Machine generation and image, session revision, outbox, policy, and
environment.

## Edge identity and provenance

An edge binds one source node to one target node with the exact operation, canonical input digest, terminal,
original risk, effect class, artifact references, and transition proof. A source node may not contain two edges
with the same operation and input digest. Such ambiguity is `REPLAY_GRAPH_TRANSITION_CONFLICT`.

The provenance vocabulary is closed:

| Provenance | Required proof |
|---|---|
| `recordedLive` | Recording identity, sequence, and exact entry digest |
| `recordedFrame` | Recording identity, sequence, and exact entry digest |
| `transactional` | Consumed one-shot AppSpace restore reference and exact source and target pair digests |
| `syntheticFixture` | Exact fixture oracle digest |

The installed product imports the two recording forms and captures transactional branches. The fixture form is
available to repository contracts, not as an installed graph-construction operation.

An imported external effect is labelled `recordedExternal`. Traversal still returns `replayedEffect: false`.
The label describes the historical edge and does not grant live effect authority.

## Construction

`world.import.recording` accepts only an absolute file beneath a configured Execution Memory import root. It
fully verifies the sealed recording and its artifact sidecars, then creates one implicit node per cursor boundary
and one exact edge per entry. Operation, input, terminal, entry digest, artifact metadata, and artifact bytes are
preserved.

`world.create.app` creates one graph start from a complete AppSpace pair. `world.capture.app.branch` accepts only
a direct child pair whose parent digest matches the source pair. The source node must already exist in the pinned
revision. The caller must first run `app.restore`; graph capture consumes the resulting restore proof exactly
once. A missing, stale, reused, or cross-pair proof is `REPLAY_GRAPH_SOURCE_UNVERIFIED`.

Graph construction does not call a live provider. Recording is authorized before import, and cooperative state
transition happens before branch capture.

## Traversal authority

`world.open` pins one immutable root and creates an in-process cursor. `world.edges` clears older edge capabilities
and issues fresh random `worldcap:` references for the current node. `world.traverse` consumes exactly one
capability, checks the pinned root and expected source node, returns the stored terminal, and advances the cursor.

- a foreign or reused capability is `REPLAY_GRAPH_AUTHORITY_INVALID`;
- a capability issued before another traversal is `REPLAY_GRAPH_CURSOR_STALE`;
- a graph checkpoint is valid only for the same open world and pinned root;
- no missing edge is approximated, searched ahead, or generated.

Cursor checkpoints are process-local. Durable truth is the graph revision, not an open cursor object.

## Evaluation and coverage

The deterministic evaluator accepts an exact start node, goal node set, forbidden edge set, step budget, and edge
path. It returns `goalReached`, `budgetExhausted`, or `edgeMissing`, plus whether a forbidden edge was selected.
The verdict digest depends only on the pinned graph and canonical result, not caller commentary.

Coverage reports reachable and unreachable nodes, known edges, dead ends, provenance counts, and declared
unexplored action classes. `complete` means only that the graph declares no unexplored classes. It does not mean
the graph represents every possible action of a site.

`retainedReplayGraphObjects` computes the nodes, edges, and artifacts reachable from start and pinned nodes. It is
a retention planner. Version 1 does not delete objects automatically.

## Storage, integrity, and quotas

ReplayGraph uses the configured private Execution Memory root under `replayGraph/`. Revisions use the existing
immutable object and CAS HEAD store. Artifact bytes are stored once by SHA-256 with exclusive creation.

Preflight rejects changed digests, duplicate objects, missing endpoints, absent artifacts, ambiguous exact
transitions, invalid values, and broken provenance. Limits are 20,000 nodes, 50,000 edges, 10,000 artifacts,
32 MiB per canonical revision, nesting depth 64, and one million scanned structural items.

SHA-256 proves content integrity, not author identity. Version 1 has no graph signature. Keep recordings, graph
objects, application state, and artifacts private because they may contain credentials or personal data.

## Non-goals and boundaries

ReplayGraph is not a browser engine, virtual internet, live site clone, training framework, or remote transaction
rollback system. It does not infer page state from pixels, invent a terminal, sign provenance, authorize a live
effect, cold-restore an AppSpace Machine, or prove that a recorded success remains true now.

## Conformance

A conforming implementation must prove all of the following:

1. linear import preserves every operation, input, terminal, digest, and artifact;
2. graph traversal sends zero browser or application requests;
3. a capability is current-node-bound and one-shot;
4. a transactional edge cannot exist without a consumed exact restore proof;
5. mutation, missing objects, ambiguous transitions, and stale HEAD publication fail closed;
6. evaluation is deterministic and coverage distinguishes known graph truth from unexplored space;
7. installed Control, MCP, JavaScript, and Python clients reopen the same root.

The installed gate is `npm run test:replay-graph` and runs on Chrome and Edge in CI.
