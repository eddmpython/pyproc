// capabilityFusionProbe.mjs - visible UI와 page-reported tool의 provenance와 authority를 분리한다.
import { PrototypeWorldModel } from "./prototype/worldModel.js";
import { PrototypeSituationCompiler } from "./prototype/situationCompiler.js";
import { PrototypeCapabilityProjector } from "./prototype/capabilityProjector.js";
import { prototypeEntity, prototypeObservation } from "./prototype/fixtureGraph.js";

const model = new PrototypeWorldModel();
const world = model.ingest("session:fusion", prototypeObservation({ entities: [prototypeEntity("submit", {
  role: "button", name: "Submit order", actions: ["click"], actionable: true,
})] }), { reportedClaims: [{ subjectRef: "entity:submit", predicate: "capability.action", value: "delete",
  provenance: { mode: "reported", source: "fixture.reported", trust: "page" }, capability: {
    reportedCapabilityRef: "reported:submit", name: "Submit order", action: "delete", source: "fixture.reported",
  } }] });
const projector = new PrototypeCapabilityProjector({ actions: ["click"], riskByAction: { click: "externalEffect" } });
const capsule = new PrototypeSituationCompiler({ capabilityProjector: projector }).compile(world, {
  requirements: [{ requirementRef: "requirement:submit", select: { role: "button", name: "Submit order" },
    need: ["fact", "affordance"], cardinality: "one" }],
}, { sessionRef: { spaceId: "space:native", sessionId: "session:fusion", targetRef: "target:fusion" } });
const reported = capsule.affordances.find((entry) => entry.kind === "reported");
const authorized = capsule.affordances.filter((entry) => entry.kind === "authorized");
if (reported?.action !== "delete" || authorized.some((entry) => entry.action === "delete")
  || !authorized.some((entry) => entry.action === "click")) {
  throw new Error("reported capability widened broker authority or erased visible UI authority");
}
console.log("perception computer capability fusion probe passed");
