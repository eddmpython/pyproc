// fixtureGraph.js - pure prototype probe가 공유하는 provider-neutral APX graph fixture.
import { apxDigest } from "../../../../scripts/perception/apxCanonical.js";

export function prototypeEntity(id, { role, name = "", kind = "ui.control", actions = [], actionable = false,
  states = {}, unresolved = null, parent = null } = {}) {
  return Object.freeze({ entityRef: `entity:${id}`, kind,
    semantic: Object.freeze({ role, name, states: Object.freeze({ ...states }), sensitivity: "public" }),
    structure: Object.freeze({ nodeName: role === "canvas" ? "CANVAS" : "BUTTON" }),
    geometry: Object.freeze({ rect: Object.freeze({ x: 10, y: 10, width: 100, height: 30 }),
      viewportRatio: 1, paintOrder: 1, visible: true, occluded: false }),
    interaction: Object.freeze({ supportedActions: Object.freeze(actions), actionable, reasons: Object.freeze([]) }),
    provenance: Object.freeze({
      semantic: Object.freeze({ mode: "observed", source: "fixture.semantic", trust: "browser" }),
      structure: Object.freeze({ mode: "observed", source: "fixture.dom", trust: "browser" }),
      geometry: Object.freeze({ mode: "observed", source: "fixture.layout", trust: "browser" }),
      interaction: Object.freeze({ mode: "derived", source: "fixture.actionability", trust: "broker" }),
    }),
    ...(actions.length ? { locatorRef: `locator:${id}` } : {}),
    ...(unresolved ? { unresolved: Object.freeze({ reason: unresolved }) } : {}),
    ...(parent ? { parent } : {}) });
}

export function prototypeObservation({ epoch = 1, entities = [], relations = [], sequence = 1,
  completeness = {} } = {}) {
  const graphSha256 = apxDigest({ epoch, entities, relations });
  return Object.freeze({ protocol: "apx", version: "1.0", representation: "apx.graph", kind: "full",
    observationRef: `observation:prototype_${sequence}`, documentEpoch: epoch,
    capturedAt: `2026-08-13T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    entities: Object.freeze(entities), relations: Object.freeze(relations), events: Object.freeze([]),
    completeness: Object.freeze({ semantic: "complete", structure: "complete", geometry: "complete",
      interaction: "complete", subscriptions: false, ...completeness }),
    integrity: Object.freeze({ canonicalSha256: graphSha256, graphSha256 }) });
}

export function semanticFormObservation() {
  const entities = [
    prototypeEntity("heading", { role: "heading", name: "Prepared order", kind: "content.heading" }),
    prototypeEntity("submit", { role: "button", name: "Submit order", actions: ["focus", "click"], actionable: true }),
    prototypeEntity("status", { role: "status", name: "Ready", kind: "ui.status" }),
  ];
  for (let index = 0; index < 120; index += 1) entities.push(prototypeEntity(`noise_${index}`, {
    role: "paragraph", name: `Archived order ${index + 1}`, kind: "content.text",
  }));
  return prototypeObservation({ entities, relations: [Object.freeze({ type: "parentOf",
    from: "entity:heading", to: "entity:submit",
    provenance: Object.freeze({ mode: "observed", source: "fixture.dom", trust: "browser" }) })] });
}
