// unresolvedVocabulary.js - APX producer, compiler, probe planner가 공유하는 unresolved reason 정본.
export const APX_UNRESOLVED_REASONS = Object.freeze([
  "canvas",
  "unlabelledImage",
  "unlabelledControl",
  "geometryUnavailable",
  "semanticUnavailable",
]);

const VISUAL_REASONS = new Set(["canvas", "unlabelledImage", "unlabelledControl"]);

export function isApxUnresolvedReason(value) {
  return APX_UNRESOLVED_REASONS.includes(value);
}

export function isVisualApxUnresolvedReason(value) {
  return VISUAL_REASONS.has(value);
}
