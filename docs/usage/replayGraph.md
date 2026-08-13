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
  "engine": { "root": "/absolute/path/to/pyodide" },
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

First create and seal an Automation Recording as described in [ReplaySpace](replaySpace.md). The file must be
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

See the [ReplayGraph 1.0 specification](../specs/replayGraph/README.md) for the identity, integrity, provenance,
quota, and conformance rules.

## Motor integration

The Motor `replay` actuator requires one exact stored edge whose input names the requested receipt. Traversal
consumes the normal world capability and returns the recorded terminal with `providerCalls: 0`. It never converts
a missing edge into a guessed action, never calls a live provider, and never turns a historical external effect
into current authority. See [Proof-Carrying Motor](actuation.md).
