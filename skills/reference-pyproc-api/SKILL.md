---
name: reference-pyproc-api
description: Reference exact PyProc public JavaScript APIs, TypeScript surfaces, package subpaths, protocols, and bundle format fields. Use for API lookup, signature review, bundle schema, type contract, API 참조, or exact field questions.
---

# Reference PyProc API

## Outcome

Answer exact public API and format questions from the current reference and executable type surface.

## Read first

Read API reference for members and bundle format for persisted bytes.

## Procedure

1. Identify the public package entrance or persisted format.
2. Read the smallest matching section.
3. Cross-check signatures against `index.d.ts` and exported values against `index.js`.
4. Cross-check format fields against the canonical validator.
5. Distinguish public contract from package-internal implementation.

## Verification

Run type, public surface, package, and format contract gates after reference changes.

## Failure modes

Do not document deep imports, infer fields from examples alone, preserve removed compatibility options, or treat internal classes as public.

## References

- [Public API](references/api.md)
- [Bundle format](references/bundle-format.md)
