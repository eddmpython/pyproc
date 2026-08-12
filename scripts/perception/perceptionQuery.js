// perceptionQuery.js - bounded graph에서 progressive disclosure 후보를 결정한다.

function nameMatches(actual, expected) {
  const value = String(actual || "");
  if (typeof expected === "string") return value === expected;
  if (expected.exact !== undefined) return value === expected.exact;
  if (expected.prefix !== undefined) return value.startsWith(expected.prefix);
  if (expected.contains !== undefined) return value.includes(expected.contains);
  if (expected.token !== undefined) return value.split(/\s+/u).includes(expected.token);
  if (expected.regex !== undefined) return new RegExp(expected.regex, "u").test(value);
  return true;
}

export function matchesPerceptionQuery(entity, query = {}, changedRefs = null) {
  if (query.entityRef !== undefined && entity.entityRef !== query.entityRef) return false;
  if (query.kind !== undefined && entity.kind !== query.kind) return false;
  if (query.role !== undefined && entity.semantic?.role !== query.role) return false;
  if (query.name !== undefined && !nameMatches(entity.semantic?.name, query.name)) return false;
  if (query.actionable !== undefined && entity.interaction?.actionable !== query.actionable) return false;
  if (query.state !== undefined) {
    for (const [key, value] of Object.entries(query.state)) if (entity.semantic?.states?.[key] !== value) return false;
  }
  if (query.changedSince !== undefined && !changedRefs?.has(entity.entityRef)) return false;
  return true;
}

export function queryPerceptionEntities(entities, query, changedRefs = null) {
  if (!query) return Object.freeze([...entities]);
  return Object.freeze(entities.filter((entity) => matchesPerceptionQuery(entity, query, changedRefs)));
}
