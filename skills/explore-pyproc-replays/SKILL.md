---
name: explore-pyproc-replays
description: Explore PyProc ReplayGraph worlds, branches, recordings, coverage, dead ends, provenance, and counterfactual replays. Use for replay graph inspection, branch exploration, world coverage, 리플레이 탐색, or recorded evidence.
---

# Explore PyProc Replays

## Outcome

Explore recorded and synthetic branches without confusing replayed evidence with live effects.

## Read first

Read the combined ReplayGraph usage and specification reference.

## Procedure

1. Import or create a graph with explicit provenance.
2. Inspect reachable nodes, known edges, and unexplored action classes.
3. Branch only through allowed replay semantics.
4. Compare transitions and preserve original effect classification.
5. Report coverage and dead ends without inventing live observations.

## Verification

Run ReplayGraph and ReplaySpace product gates.

## Failure modes

Reject provenance loss, cyclic corruption, replay presented as live confirmation, and unsupported branch effects.

## References

- [ReplayGraph contract](references/replay-graph.md)
