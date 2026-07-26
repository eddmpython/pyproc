// runtimeSubpath.d.ts - types for the `pyproc/runtime` subpath.
//
// It sits beside runtimeSubpath.js because a subpath's types only hold from a sibling d.ts: if the
// module resolves as untyped .js, TypeScript refuses the augmentation (TS2665). The contract itself
// is unchanged and still declared once, in the rank-0 barrel; this file only re-exports it so the
// types travel with the target package.json actually points at.
export * from "../runtime/index.js";
