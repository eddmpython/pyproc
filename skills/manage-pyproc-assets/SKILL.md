---
name: manage-pyproc-assets
description: Manage PyProc generated runtime assets, catalogs, SBOM, provenance, integrity, and deterministic rebuilds. Use when asset bytes, digests, manifests, engine artifacts, provenance, 생성 자산, or package assets change.
---

# Manage PyProc Assets

## Outcome

Keep every shipped asset attributable, integrity checked, reproducible, and synchronized with derived catalogs.

## Read first

Read the asset provenance contract before rebuilding or replacing bytes.

## Procedure

1. Identify the authored source, exact toolchain, license, and output owner.
2. Rebuild with pinned inputs when possible.
3. Update the single catalog and SBOM through their generator.
4. Compare digests and package contents.

## Verification

Run `npm run assets:provenance -- --check`, package gates, and the asset-specific product gate.

## Failure modes

Reject manual edits to generated files, unknown provenance, digest drift, hidden download fallback, and unbounded assets.

## References

- [Asset provenance contract](references/asset-provenance.md)
