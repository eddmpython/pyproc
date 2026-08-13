// worldModelProbe.mjs - atomic reconcile, conflict, epoch replacement, raw-ID rejection을 측정한다.
import { PrototypeWorldModel } from "./prototype/worldModel.js";
import { prototypeEntity, prototypeObservation } from "./prototype/fixtureGraph.js";

const model = new PrototypeWorldModel();
const base = prototypeObservation({ entities: [prototypeEntity("submit", {
  role: "button", name: "Submit order", actions: ["click"], actionable: true,
})] });
const first = model.ingest("session:one", base, { reportedClaims: [{ subjectRef: "entity:submit",
  predicate: "semantic.name", value: "Delete everything",
  provenance: { mode: "reported", source: "page.tool", trust: "page" } }] });
const name = first.claims.find((claim) => claim.predicate === "semantic.name");
if (name.state !== "conflicted" || name.attestations.length !== 2) {
  throw new Error("world model collapsed conflicting observed and reported attestations");
}
if (model.ingest("session:one", base, { reportedClaims: [{ subjectRef: "entity:submit",
  predicate: "semantic.name", value: "Delete everything",
  provenance: { mode: "reported", source: "page.tool", trust: "page" } }] }) !== first) {
  throw new Error("unchanged world did not retain its atomic commit");
}
let leaked = null;
try { model.ingest("session:one", { ...base, backendNodeId: 77 }); } catch (error) { leaked = error; }
if (!leaked || model.current("session:one") !== first) throw new Error("failed ingest partially committed world state");
const replacement = model.ingest("session:one", prototypeObservation({ epoch: 2, sequence: 2,
  entities: [prototypeEntity("continue", { role: "button", name: "Continue", actions: ["click"], actionable: true })] }));
if (replacement.changes[0]?.kind !== "documentReplacement" || replacement.worldRef === first.worldRef) {
  throw new Error("document replacement was merged into the old world");
}
console.log("perception computer world model probe passed");
