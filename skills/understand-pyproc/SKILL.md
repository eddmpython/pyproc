---
name: understand-pyproc
description: Understand and explain PyProc product vision, concepts, glossary, browser support, runtime capabilities, and compatibility boundaries. Use for architecture orientation, capability questions, 제품 이해, or terminology.
---

# Understand PyProc

## Outcome

Explain PyProc from current product contracts without turning plans or history into shipped behavior.

## Read first

Read the capability matrix for support questions, the glossary for stable terms, and the vision for product direction.

## Procedure

1. Identify whether the question concerns purpose, vocabulary, capability, or compatibility.
2. Read only the matching reference.
3. Cross-check exact public claims against `index.js`, `src/`, and current gates.
4. Mark plans and attempts as non-shipped evidence.

## Verification

Run `npm test` when changing product claims or capability boundaries.

## Failure modes

Do not infer support from an unfinished initiative, benchmark artifact, or historical changelog entry.

## References

- [Product vision](references/vision.md)
- [Glossary](references/glossary.md)
- [Capability matrix](references/capability-matrix.md)
