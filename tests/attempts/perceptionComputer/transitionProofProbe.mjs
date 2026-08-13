// transitionProofProbe.mjs - direct/strong/weak/unknown causality와 false confirmation을 측정한다.
import { prototypeTransitionProof } from "./prototype/transitionLedger.js";

const direct = prototypeTransitionProof({ beforeWorldRef: "world:before", afterWorldRef: "world:after",
  actionRef: "action:submit", effectOutcome: "applied", correlatedEvents: [{ actionRef: "action:submit" }],
  postcondition: { state: "confirmed", evidenceRefs: ["evidence:accepted"] } });
if (direct.causality !== "direct" || direct.businessState !== "confirmed") {
  throw new Error("direct transition proof was not confirmed");
}
const unrelated = prototypeTransitionProof({ beforeWorldRef: "world:before", afterWorldRef: "world:after",
  actionRef: "action:submit", effectOutcome: "applied", correlatedEvents: [{ actionRef: "action:other" }],
  postcondition: { state: "confirmed", evidenceRefs: ["evidence:one", "evidence:two"] } });
if (unrelated.causality !== "weak" || unrelated.businessState !== "ambiguous") {
  throw new Error("weak unrelated transition was falsely confirmed");
}
const death = prototypeTransitionProof({ beforeWorldRef: "world:before", afterWorldRef: null,
  actionRef: "action:submit", effectOutcome: "outcomeUnknown", captureGap: true });
if (death.causality !== "unknown" || death.effectOutcome !== "outcomeUnknown") {
  throw new Error("post-send capture gap hid the unknown outcome");
}
console.log("perception computer transition proof probe passed");
