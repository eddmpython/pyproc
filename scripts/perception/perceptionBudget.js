// perceptionBudget.js - entity, relation, byte ceiling을 조용한 손실 없이 적용한다.
import { APX_ERROR_CODES } from "./apxCatalog.js";

function byteLength(value) { return Buffer.byteLength(JSON.stringify(value)); }

function budgetError(message) {
  const error = new Error(message);
  error.code = APX_ERROR_CODES.budgetExceeded;
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

export function applyPerceptionBudget(payload, limits, sensorOmitted = {}) {
  let entities = [...payload.entities].slice(0, limits.maxEntities);
  let allowedRefs = new Set(entities.map((entity) => entity.entityRef));
  let relations = payload.relations.filter((relation) => allowedRefs.has(relation.from) && allowedRefs.has(relation.to))
    .slice(0, limits.maxRelations);
  let visualProbes = [...(payload.visualProbes || [])];
  const omitted = {
    entities: Math.max(0, Number(sensorOmitted.entities) || 0) + Math.max(0, payload.entities.length - entities.length),
    relations: Math.max(0, Number(sensorOmitted.relations) || 0) + Math.max(0, payload.relations.length - relations.length),
    visualProbes: Math.max(0, Number(sensorOmitted.visualProbes) || 0),
  };
  const build = () => ({ ...payload, entities, relations, ...(payload.visualProbes ? { visualProbes } : {}),
    budget: { ...limits, usedBytes: 0, truncated: Object.values(omitted).some((count) => count > 0), omitted } });
  let result = build();
  while (byteLength(result) > limits.maxBytes && visualProbes.length) {
    visualProbes.pop(); omitted.visualProbes += 1; result = build();
  }
  while (byteLength(result) > limits.maxBytes && relations.length) {
    relations.pop(); omitted.relations += 1; result = build();
  }
  while (byteLength(result) > limits.maxBytes && entities.length > 1) {
    entities.pop(); omitted.entities += 1;
    allowedRefs = new Set(entities.map((entity) => entity.entityRef));
    const before = relations.length;
    relations = relations.filter((relation) => allowedRefs.has(relation.from) && allowedRefs.has(relation.to));
    omitted.relations += before - relations.length;
    result = build();
  }
  if (byteLength(result) > limits.maxBytes) throw budgetError("APX envelope metadata exceeds maxBytes");
  let usedBytes = byteLength(result);
  result = { ...result, budget: { ...result.budget, usedBytes } };
  const corrected = byteLength(result);
  if (corrected !== usedBytes) result = { ...result, budget: { ...result.budget, usedBytes: corrected } };
  return result;
}
