---
name: commit-pyproc-effects
description: Rehearse, approve, commit, inspect, retry safely, and seal one-shot PyProc effect transactions. Use for external effects, effect approval, rehearse commit, one-shot action, 외부 효과, or evidence sealing.
---

# Commit PyProc Effects

## Outcome

Apply an intended external effect at most once with intent-bound approval and verifiable terminal evidence.

## Read first

Read the combined effect transaction contract before preparing authority or acting.

## Procedure

1. Prepare an exact intent, destination, subject digest, expected revision, and transition.
2. Rehearse without sending the external effect.
3. Obtain an authority-bound approval grant.
4. Commit once and preserve outcome-unknown truth.
5. Publish evidence and seal the terminal revision.

## Verification

Run effect transaction, actuation, installed MCP, and Python SDK product gates.

## Failure modes

Never synthesize approval, reuse a lease, retry outcome-unknown work, alter content after approval, or claim confirmation without transition evidence.

## References

- [Rehearse and commit contract](references/rehearse-commit.md)
