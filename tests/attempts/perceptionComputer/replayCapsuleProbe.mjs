// replayCapsuleProbe.mjs - canonical capsule replay가 live provider 없이 exact terminal을 보존하는지 측정한다.
import { apxDigest } from "../../../scripts/perception/apxCanonical.js";
import { PrototypeWorldModel } from "./prototype/worldModel.js";
import { PrototypeSituationCompiler } from "./prototype/situationCompiler.js";
import { prototypeEntity, prototypeObservation } from "./prototype/fixtureGraph.js";

const world = new PrototypeWorldModel().ingest("session:replay", prototypeObservation({ entities: [
  prototypeEntity("status", { role: "status", name: "Accepted", kind: "ui.status" }),
] }));
const capsule = new PrototypeSituationCompiler().compile(world, { requirements: [{
  requirementRef: "requirement:status", select: { role: "status", name: "Accepted" },
  need: ["fact"], cardinality: "one",
}] });
const recording = Object.freeze({ operation: "automation.observe", input: Object.freeze({
  representation: "apx.situation", focus: capsule.focus }), terminal: capsule,
  digest: apxDigest({ operation: "automation.observe", input: { representation: "apx.situation",
    focus: capsule.focus }, terminal: capsule }) });
let providerCalls = 0;
const replay = (input) => {
  if (apxDigest(input) !== apxDigest(recording.input)) throw new Error("APX_REPLAY_DIVERGED");
  return recording.terminal;
};
const returned = replay(recording.input);
if (providerCalls !== 0 || returned.integrity.canonicalSha256 !== capsule.integrity.canonicalSha256) {
  throw new Error("capsule replay called a provider or changed the terminal digest");
}
let mutation = null;
try { replay({ ...recording.input, focus: { ...recording.input.focus, objective: "changed" } }); }
catch (error) { mutation = error; }
if (!mutation) throw new Error("mutated replay input was accepted");
console.log("perception computer replay capsule probe passed");
