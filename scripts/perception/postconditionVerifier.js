// postconditionVerifier.js - entity와 network evidence를 confirmed로 과장하지 않는 결정적 판정기.

function plainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }

function invalid(message) {
  const error = new TypeError(message);
  error.code = "APX_SCHEMA_INVALID";
  error.outcome = "notSent";
  error.retryable = false;
  throw error;
}

function validateLeaf(condition) {
  const keys = ["entityAppeared", "entityState", "networkResponse"].filter((key) => condition[key] !== undefined);
  if (keys.length !== 1) invalid("postcondition leaf requires one supported condition");
  const value = condition[keys[0]];
  if (!plainObject(value)) invalid(`${keys[0]} must be an object`);
  const leaf = keys[0];
  const allowed = leaf === "entityAppeared" ? new Set(["role", "name", "nameContains"])
    : leaf === "entityState" ? new Set(["entityRef", "disabled", "checked", "selected", "expanded", "value"])
      : new Set(["method", "urlPath", "status"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`${leaf} does not accept ${key}`);
  if (Object.keys(value).length < 1) invalid(`${leaf} requires at least one condition`);
  if (leaf === "entityAppeared") {
    for (const key of ["role", "name", "nameContains"]) {
      if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length < 1
        || value[key].length > 300)) invalid(`${leaf}.${key} is invalid`);
    }
  } else if (leaf === "entityState") {
    if (!/^entity:[A-Za-z0-9_-]{1,128}$/.test(String(value.entityRef || ""))) {
      invalid("entityState.entityRef is invalid");
    }
    if (Object.keys(value).length < 2) invalid("entityState requires a state assertion");
    for (const key of ["disabled", "checked", "selected", "expanded"]) {
      if (value[key] !== undefined && typeof value[key] !== "boolean") invalid(`entityState.${key} must be boolean`);
    }
    if (value.value !== undefined && !["string", "number", "boolean"].includes(typeof value.value)) {
      invalid("entityState.value is invalid");
    }
  } else {
    if (value.method !== undefined && (typeof value.method !== "string" || !/^[A-Z]{1,20}$/.test(value.method))) {
      invalid("networkResponse.method is invalid");
    }
    if (value.urlPath !== undefined && (typeof value.urlPath !== "string" || !value.urlPath.startsWith("/")
      || value.urlPath.length > 2000 || value.urlPath.includes("?") || value.urlPath.includes("#"))) {
      invalid("networkResponse.urlPath is invalid");
    }
    if (value.status !== undefined && (!Number.isInteger(value.status) || value.status < 100 || value.status > 599)) {
      invalid("networkResponse.status is invalid");
    }
  }
  return keys[0];
}

export function validatePostcondition(condition, depth = 0) {
  if (!plainObject(condition) || depth > 4) invalid("postcondition is invalid");
  const allowed = new Set(["all", "any", "entityAppeared", "entityState", "networkResponse", "withinMs"]);
  for (const key of Object.keys(condition)) if (!allowed.has(key)) invalid(`postcondition does not accept ${key}`);
  const groups = ["all", "any"].filter((key) => condition[key] !== undefined);
  if (groups.length) {
    if (groups.length !== 1 || Object.keys(condition).some((key) => ![groups[0], "withinMs"].includes(key))) {
      invalid("postcondition group is ambiguous");
    }
    const values = condition[groups[0]];
    if (!Array.isArray(values) || values.length < 1 || values.length > 8) invalid(`${groups[0]} must contain 1 to 8 entries`);
    for (const child of values) validatePostcondition(child, depth + 1);
  } else validateLeaf(condition);
  if (condition.withinMs !== undefined && (!Number.isInteger(condition.withinMs)
    || condition.withinMs < 1 || condition.withinMs > 30000)) invalid("postcondition.withinMs is invalid");
  if (depth > 0 && condition.withinMs !== undefined) invalid("postcondition.withinMs is only valid at the root");
  return condition;
}

function entityAppeared(expected, observation) {
  const entity = observation?.entities?.find((candidate) =>
    (expected.role === undefined || candidate.semantic?.role === expected.role)
    && (expected.nameContains === undefined || String(candidate.semantic?.name || "").includes(expected.nameContains))
    && (expected.name === undefined || candidate.semantic?.name === expected.name));
  return entity ? { verdict: "confirmed", evidenceRefs: [entity.entityRef] }
    : { verdict: "pending", evidenceRefs: [] };
}

function entityState(expected, observation) {
  const entity = observation?.entities?.find((candidate) => candidate.entityRef === expected.entityRef);
  if (!entity) return { verdict: "pending", evidenceRefs: [] };
  const checks = Object.entries(expected).filter(([key]) => key !== "entityRef");
  const actual = { ...entity.semantic?.states, value: entity.semantic?.value };
  const matches = checks.every(([key, value]) => actual[key] === value);
  return { verdict: matches ? "confirmed" : "contradicted", evidenceRefs: [entity.entityRef] };
}

function networkResponse(expected, events, coverage) {
  const pathMatches = (event) => expected.urlPath === undefined || (() => {
    try { return new URL(event.url).pathname === expected.urlPath; } catch (error) { return false; }
  })();
  const requests = expected.method === undefined ? [] : events.filter((event) => event.kind === "network"
    && event.phase === "request" && event.method === expected.method && pathMatches(event) && event.requestRef);
  if (expected.method !== undefined && !requests.length) return { verdict: "pending", evidenceRefs: [] };
  const requestRefs = new Set(requests.map((event) => event.requestRef));
  const responses = events.filter((event) => event.kind === "network" && event.phase === "response"
    && pathMatches(event) && (expected.method === undefined || requestRefs.has(event.requestRef)));
  if (!responses.length) return { verdict: "pending", evidenceRefs: [] };
  const matching = responses.find((event) => expected.status === undefined || event.status === expected.status);
  const evidenceRefs = (selected) => [...requests.filter((event) => selected.some((response) =>
    response.requestRef === event.requestRef)), ...selected].map((event) => event.eventId);
  return matching ? { verdict: "confirmed", evidenceRefs: evidenceRefs([matching]) }
    : coverage?.completeness !== "incomplete"
      ? { verdict: "contradicted", evidenceRefs: evidenceRefs(responses) }
      : { verdict: "pending", evidenceRefs: evidenceRefs(responses) };
}

function evaluate(condition, context) {
  if (condition.all) {
    const children = condition.all.map((child) => evaluate(child, context));
    return { verdict: children.some((child) => child.verdict === "contradicted") ? "contradicted"
      : children.every((child) => child.verdict === "confirmed") ? "confirmed" : "pending",
    evidenceRefs: children.flatMap((child) => child.evidenceRefs) };
  }
  if (condition.any) {
    const children = condition.any.map((child) => evaluate(child, context));
    return { verdict: children.some((child) => child.verdict === "confirmed") ? "confirmed"
      : children.every((child) => child.verdict === "contradicted") ? "contradicted" : "pending",
    evidenceRefs: children.flatMap((child) => child.evidenceRefs) };
  }
  if (condition.entityAppeared) return entityAppeared(condition.entityAppeared, context.observation);
  if (condition.entityState) return entityState(condition.entityState, context.observation);
  return networkResponse(condition.networkResponse, context.events || [], context.coverage);
}

export function verifyPostcondition(condition, context = {}) {
  validatePostcondition(condition);
  const result = evaluate(condition, context);
  let state = result.verdict;
  if (state === "pending" && context.final) {
    if (context.coverage?.completeness === "incomplete") state = "ambiguous";
    else {
      const changed = (context.observation?.delta?.added?.length || 0)
        + (context.observation?.delta?.changed?.length || 0) + (context.events?.length || 0);
      state = changed > 0 ? "ambiguous" : "notObserved";
    }
  }
  return Object.freeze({ state, postcondition: condition,
    evidenceRefs: Object.freeze([...new Set(result.evidenceRefs.filter(Boolean))]) });
}
