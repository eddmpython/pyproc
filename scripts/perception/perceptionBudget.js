// perceptionBudget.js - entity, relation, byte ceiling을 조용한 손실 없이 적용한다.
// 잘린 entity를 가리키는 참조는 envelope에 남기지 않는다: relation은 양 끝이 남은 것만, unresolved는 남은 entity의
// 주석만(entity와 함께 빠지므로 따로 세지 않는다), entity crop은 남은 entity의 것만 두고 빠진 crop은
// omitted.visualProbes로 센다. 참조가 끊긴 envelope는 APX schema 검사에서 관찰 전체를 실패시킨다.
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
  const keepProbesOfAllowedEntities = () => {
    const before = visualProbes.length;
    visualProbes = visualProbes.filter((probe) => probe.entityRef === null || probe.entityRef === undefined
      || allowedRefs.has(probe.entityRef));
    omitted.visualProbes += before - visualProbes.length;
  };
  keepProbesOfAllowedEntities();
  const build = () => ({ ...payload, entities, relations,
    unresolved: (payload.unresolved || []).filter((entry) => allowedRefs.has(entry.entityRef)),
    ...(payload.visualProbes ? { visualProbes } : {}),
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
    keepProbesOfAllowedEntities();
    result = build();
  }
  if (byteLength(result) > limits.maxBytes) throw budgetError("APX envelope metadata exceeds maxBytes");
  let usedBytes = byteLength(result);
  result = { ...result, budget: { ...result.budget, usedBytes } };
  const corrected = byteLength(result);
  if (corrected !== usedBytes) result = { ...result, budget: { ...result.budget, usedBytes: corrected } };
  return result;
}
