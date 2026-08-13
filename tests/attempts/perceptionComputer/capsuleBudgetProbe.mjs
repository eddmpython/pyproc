// capsuleBudgetProbe.mjs - typed focus가 full graph보다 작은 required-preserving capsule을 만드는지 측정한다.
import { PrototypeWorldModel } from "./prototype/worldModel.js";
import { PrototypeSituationCompiler } from "./prototype/situationCompiler.js";
import { PrototypeCapabilityProjector } from "./prototype/capabilityProjector.js";
import { semanticFormObservation } from "./prototype/fixtureGraph.js";
import { assertOracleCapsule, taskOracle } from "./oracle/taskOracle.js";

const observation = semanticFormObservation();
const world = new PrototypeWorldModel().ingest("session:form", observation);
const projector = new PrototypeCapabilityProjector({ actions: ["click"], riskByAction: { click: "externalEffect" } });
const compiler = new PrototypeSituationCompiler({ capabilityProjector: projector });
const focus = { objective: "Submit the prepared order and prove acceptance", requirements: [
  { requirementRef: "requirement:submit", select: { role: "button", name: { exact: "Submit order" } },
    need: ["fact", "affordance"], cardinality: "one" },
  { requirementRef: "requirement:status", select: { role: "status" }, need: ["fact"], cardinality: "one" },
] };
const sessionRef = { spaceId: "space:native", sessionId: "session:form", targetRef: "target:form" };
const capsule = compiler.compile(world, focus, { sessionRef, budget: { maxBytes: 32768 }, visual: { mode: "auto" } });
assertOracleCapsule(capsule, taskOracle("semanticForm"));
if (capsule.integrity.canonicalSha256 !== compiler.compile(world, focus,
  { sessionRef, budget: { maxBytes: 32768 }, visual: { mode: "auto" } }).integrity.canonicalSha256) {
  throw new Error("same world and focus did not produce a stable capsule digest");
}
if (JSON.stringify(capsule).length >= JSON.stringify(observation).length || capsule.visualProbes?.length) {
  throw new Error("semantic capsule was not smaller than the full graph or created pixels");
}
let budgetFailure = null;
try { compiler.compile(world, focus, { sessionRef, budget: { maxBytes: 100 } }); }
catch (error) { budgetFailure = error; }
if (budgetFailure?.code !== "APX_BUDGET_EXCEEDED") throw new Error("required facts were silently cut by budget");
console.log("perception computer capsule budget probe passed");
