---
name: develop-pyproc
description: Develop and review PyProc source within its module boundaries, operating model, contribution workflow, and repository safety rules. Use when implementing, refactoring, debugging, reviewing code, 개발, or changing architecture.
---

# Develop PyProc

## Outcome

Place changes in the correct layer, preserve public boundaries, and leave an executable regression gate.

## Read first

Read the operating model for workflow and module boundaries before multi-module changes.

## Procedure

1. Confirm the capability does not already exist and inspect symbol references.
2. Choose the owning layer before editing.
3. Prototype new capability in the existing attempt campaign when required.
4. Keep native ESM, downward imports, and public exports at their approved entrances.
5. Add a gate that fails on the regression being prevented.

## Verification

Route changed paths with `start-pyproc`, then run `npm test` and every returned product gate.

## Failure modes

Stop on upward imports, deep package imports, silent catches, compatibility flags, unowned generated files, or weakened assertions.

## References

- [Operating model](references/operating-model.md)
- [Module boundaries](references/module-boundaries.md)
