---
name: transact-pyproc-app-state
description: Transact PyProc AppSpace logical application state with paired generations, preconditions, conflicts, evidence, and durable revisions. Use for app state mutation, AppSpace, application transaction, 상태 트랜잭션, or paired state.
---

# Transact PyProc App State

## Outcome

Commit logical application state with explicit preconditions and content-addressed durable truth.

## Read first

Read the combined AppSpace usage and specification reference.

## Procedure

1. Inspect the current paired generation.
2. State expected identity, revision, and logical transition.
3. Prepare and validate the next state.
4. Commit with compare-and-swap semantics.
5. Preserve conflict and evidence terminals.

## Verification

Run AppSpace contract and browser product gates.

## Failure modes

Reject blind overwrite, mismatched identity, mutable committed records, missing provenance, and conflict presented as success.

## References

- [AppSpace contract](references/app-space.md)
