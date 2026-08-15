---
name: verify-pyproc
description: Verify PyProc changes, select required Node, type, package, browser, installed, and product gates, and diagnose contract drift. Use for testing, CI failures, verification review, 테스트, or changed-path gate selection.
---

# Verify PyProc

## Outcome

Run the smallest complete gate set and report real failures without masking unrelated state.

## Read first

Read the testing contract, then obtain required gates from the canonical changed-path router.

## Procedure

1. Run fast structural gates before browser gates.
2. Use the exact supported browser executable selected by the repository environment.
3. Reproduce a failure alone before changing product code.
4. Add a negative fixture for every new structural gate.
5. Rerun affected gates after the final edit.

## Verification

Always run `npm test`. Add `npm run test:types`, package, browser, installed, or product gates returned by routing.

## Failure modes

Do not treat a text scan as runtime verification, reduce an existing gate, or claim green when unrelated preserved work is the only failure.

## References

- [Testing and gate contract](references/testing.md)
