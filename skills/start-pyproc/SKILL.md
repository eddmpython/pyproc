---
name: start-pyproc
description: Route PyProc tasks and changed repository paths to the required skill knowledge and verification gates. Use for first entry, task routing, changed-path review, 작업 라우팅, or when the correct PyProc workflow is unclear.
---

# Start PyProc

## Outcome

Select the smallest sufficient skill set and the complete required gate set before changing PyProc.

## Read first

Read [path routing](references/path-routing.md) for repository changes. Search metadata before opening any other body.

## Procedure

1. Validate `skills/catalog.json` with `npm run skills:check`.
2. Search the task text and keep at most three metadata results.
3. Route every old and new changed path through the canonical path map.
4. Read selected bodies and only their necessary direct references.
5. Union every required gate. Never let a narrow route erase a broad route.

## Verification

Run `npm run skills:test-routing`. For repository changes, run every gate returned by the path router.

## Failure modes

Stop on stale catalog, ambiguous top score, unknown path, missing gate, or a request for authority the task did not grant.

## References

- [Repository knowledge entry map](references/entry-map.md)
- [Canonical changed-path routes](references/path-routing.md)
- [Skill OS source, retrieval, and transport contract](references/skill-os-contract.md)
