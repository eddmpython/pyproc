// temporalIdentityProbe.mjs - document epoch 교체 뒤 old capability가 effect 전에 거부되는지 측정한다.
import { PrototypeWorldModel } from "./prototype/worldModel.js";
import { PrototypeSituationCompiler } from "./prototype/situationCompiler.js";
import { PrototypeCapabilityProjector } from "./prototype/capabilityProjector.js";
import { prototypeEntity, prototypeObservation } from "./prototype/fixtureGraph.js";

const sessionRef = { spaceId: "space:native", sessionId: "session:temporal", targetRef: "target:temporal" };
const model = new PrototypeWorldModel();
const projector = new PrototypeCapabilityProjector({ actions: ["click"], riskByAction: { click: "externalEffect" } });
const compiler = new PrototypeSituationCompiler({ capabilityProjector: projector });
const focus = { requirements: [{ requirementRef: "requirement:continue", select: { role: "button", name: "Continue" },
  need: ["fact", "affordance"], cardinality: "one" }] };
const before = model.ingest("session:temporal", prototypeObservation({ epoch: 1,
  entities: [prototypeEntity("continue", { role: "button", name: "Continue", actions: ["click"], actionable: true })] }));
const situation = compiler.compile(before, focus, { sessionRef });
const capability = situation.affordances.find((entry) => entry.kind === "authorized");
const after = model.ingest("session:temporal", prototypeObservation({ epoch: 2, sequence: 2,
  entities: [prototypeEntity("continue_new", { role: "button", name: "Continue", actions: ["click"], actionable: true })] }));
let stale = null;
try { projector.assert({ capabilityRef: capability.capabilityRef, worldRef: before.worldRef,
  situationRef: situation.situationRef }, { kind: "click", locatorRef: capability.locatorRef }, sessionRef,
{ world: after, situationRef: situation.situationRef, now: Date.parse(before.capturedAt) }); }
catch (error) { stale = error; }
if (stale?.code !== "APX_CAPABILITY_STALE" || stale.outcome !== "notSent") {
  throw new Error("old document capability reached the provider boundary");
}
console.log("perception computer temporal identity probe passed");
