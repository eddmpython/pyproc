// activePerceptionProbe.mjs - semantic task는 pixel 0, visual unknown은 bounded crop만 계획하는지 측정한다.
import { PrototypeWorldModel } from "./prototype/worldModel.js";
import { PrototypeSituationCompiler } from "./prototype/situationCompiler.js";
import { prototypeEntity, prototypeObservation, semanticFormObservation } from "./prototype/fixtureGraph.js";

const model = new PrototypeWorldModel();
const compiler = new PrototypeSituationCompiler();
const semantic = compiler.compile(model.ingest("session:semantic", semanticFormObservation()), {
  requirements: [{ requirementRef: "requirement:submit", select: { role: "button", name: "Submit order" },
    need: ["fact"], cardinality: "one" }],
}, { visual: { mode: "auto" } });
if (semantic.suggestedProbes.length !== 0 || semantic.visualProbes !== undefined) {
  throw new Error("semantic task requested visual evidence");
}
const visualWorld = model.ingest("session:visual", prototypeObservation({ entities: [prototypeEntity("chart", {
  role: "canvas", name: "", kind: "content.canvas", unresolved: "canvas",
})] }));
const visual = compiler.compile(visualWorld, { requirements: [{ requirementRef: "requirement:chart",
  select: { role: "canvas" }, need: ["fact"], cardinality: "one" }] }, { visual: { mode: "auto" } });
if (visual.unknowns[0]?.reason !== "visualEvidenceRequired"
  || visual.suggestedProbes.length !== 1 || visual.suggestedProbes[0].kind !== "entityCrop"
  || visual.suggestedProbes.some((probe) => probe.kind === "fullScreenshot")) {
  throw new Error("visual unknown did not converge on one bounded entity crop");
}
console.log("perception computer active perception probe passed");
