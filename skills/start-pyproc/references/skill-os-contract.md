# Skill OS contract

## Contents

- Authored source
- Discovery and reads
- Package and MCP projections
- Public projection
- Correction evidence
- Verification

## Authored source

`skills/` is the only current authored knowledge root. Each direct child is one strict skill directory with a
`SKILL.md`. Frontmatter accepts only `name` and `description`. The directory name and skill name must match, and the
body must contain Outcome, Read first, Procedure, Verification, Failure modes, and References sections.

Direct resources may live under `references/`, `scripts/`, `assets/`, and `agents/`. The parser rejects path escape,
symbolic links, junctions, text NUL bytes, undeclared frontmatter, missing headings, oversized bodies, and oversized
resources. No fallback to a retired knowledge root is allowed.

## Discovery and reads

`skills/catalog.json` is deterministic metadata. It contains names, descriptions, paths, byte counts, and digests,
but no skill body. Search reads only that metadata, returns at most three records, and stays within 4 KiB. A read names
one skill and one declared direct resource and must provide the expected SHA-256 digest from the catalog.

The reader limits a skill body to 96 KiB and a direct resource to 256 KiB. It resolves the real path, checks root
containment, reads bytes once, and verifies byte count and digest before returning content. Recursive bundled reads are
not part of the contract.

Stable failure codes include `SKILL_FRONTMATTER_INVALID`, `SKILL_NAME_MISMATCH`, `SKILL_STRUCTURE_INVALID`,
`SKILL_REFERENCE_ESCAPE`, `SKILL_RESOURCE_LIMIT`, `SKILL_CATALOG_STALE`, `SKILL_SEARCH_AMBIGUOUS`,
`SKILL_RESOURCE_UNDECLARED`, and `SKILL_READ_STALE`.

## Package and MCP projections

The npm tarball includes `skills/` and the read-only helpers under `scripts/skillOs/`. Installed consumers locate these
from the package directory without a repository-relative path or a new public JavaScript export. Rebuilding the catalog
inside the installed package must produce the same catalog bytes and source digest as the checkout.

The existing `pyproc-mcp` server exposes `skills.search` and `skills.read`. Both call the same catalog, search, and
reader modules as the filesystem path. They are read-only, idempotent, closed-world tools and do not receive runtime,
browser, network, or effect authority.

## Public projection

GitHub can display each `skills/*/SKILL.md` directly. A deployed website may build an ephemeral render model with the
skill name, source digest, catalog digest, media type, and source content. Rendered pages and search indexes are build
artifacts, never authored knowledge or committed mirrors.

## Correction evidence

Routing behavior changes only through reviewed skill or corpus changes. Forward episodes record a task class, salted
query digest, selected skill, repository-relative changed paths, selected gates, read digests, failure class, and stable
terminal. They do not store raw prompts, secrets, absolute user paths, sessions, or sensitive source material.

## Verification

Run all Skill OS gates after changing a skill, catalog helper, route map, package projection, or MCP projection:

```powershell
npm run skills:catalog -- --write
npm run skills:check
npm run skills:test-routing
npm run skills:test-package
npm run skills:test-mcp
npm run skills:test-forward
npm run skills:test-performance
```

Then run every product gate returned by the changed-path router. `npm test` remains the repository-wide structural
gate.
