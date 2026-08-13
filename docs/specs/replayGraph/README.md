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
