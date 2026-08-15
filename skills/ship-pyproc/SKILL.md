---
name: ship-pyproc
description: Package, release, publish, and host PyProc with exact version, provenance, clean-install, demo, and rollback verification. Use for npm pack, release preparation, 배포, publishing, or demo hosting.
---

# Ship PyProc

## Outcome

Produce a reproducible package or hosted demo whose bytes and claims match the source contract.

## Read first

Read release procedure for publishing and demo hosting for static deployment.

## Procedure

1. Confirm explicit release authority before changing versions or tags.
2. Regenerate required derived artifacts.
3. Inspect the packed tarball and clean installed consumer.
4. Run Edge and Chrome installed gates.
5. Publish only after source, package, and provenance digests agree.

## Verification

Run package, installed browser, asset provenance, and release checks from the references.

## Failure modes

Stop on floating versions, unverified generated files, package-only behavior, missing release authority, or a dirty release tree.

## References

- [Release procedure](references/release.md)
- [Demo hosting](references/demo-hosting.md)
