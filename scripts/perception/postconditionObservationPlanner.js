// postconditionObservationPlanner.js - postcondition leaf에서 필요한 관찰만 결정적으로 도출한다.
import { apxDigest } from "./apxCanonical.js";
import { validatePostcondition } from "./postconditionVerifier.js";

function collect(condition, plan) {
  if (condition.all || condition.any) {
    for (const child of condition.all || condition.any) collect(child, plan);
    return;
  }
  if (condition.entityAppeared) {
    const expected = condition.entityAppeared;
    plan.entityQueries.push(Object.freeze({
      kind: "entityAppeared",
      ...(expected.role ? { role: expected.role } : {}),
      ...(expected.name ? { name: { exact: expected.name } } : {}),
      ...(expected.nameContains ? { name: { contains: expected.nameContains } } : {}),
    }));
    return;
  }
  if (condition.entityState) {
    plan.entityQueries.push(Object.freeze({
      kind: "entityState",
      entityRef: condition.entityState.entityRef,
      states: Object.freeze(Object.fromEntries(Object.entries(condition.entityState)
        .filter(([key]) => key !== "entityRef"))),
    }));
    return;
  }
  plan.networkQueries.push(Object.freeze({ ...condition.networkResponse }));
}

export function planPostconditionObservation(postcondition) {
  validatePostcondition(postcondition);
  const mutable = { entityQueries: [], networkQueries: [] };
  collect(postcondition, mutable);
  const channels = [];
  if (mutable.entityQueries.length) channels.push("semantic");
  if (mutable.networkQueries.length) channels.push("networkMetadata");
  const body = {
    channels,
    entityQueries: mutable.entityQueries,
    networkQueries: mutable.networkQueries,
    entityEnumeration: mutable.entityQueries.length ? "focusedOrCompleteFallback" : "notRequested",
    eventChannels: mutable.networkQueries.length ? ["network"] : [],
  };
  return Object.freeze({
    ...body,
    channels: Object.freeze(channels),
    entityQueries: Object.freeze(mutable.entityQueries),
    networkQueries: Object.freeze(mutable.networkQueries),
    eventChannels: Object.freeze(body.eventChannels),
    networkOnly: mutable.networkQueries.length > 0 && mutable.entityQueries.length === 0,
    planSha256: apxDigest(body),
  });
}
