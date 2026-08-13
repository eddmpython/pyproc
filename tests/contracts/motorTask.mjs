import { strict as assert } from "node:assert";
import { MotorTaskSession } from "../../scripts/actuation/motorTaskSession.js";

function capsule({ matched = 1, state = "satisfied", artifactRef = "artifact:owned" } = {}) {
  return Object.freeze({
    integrity: Object.freeze({ canonicalSha256: `sha_${matched}_${state}` }),
    requirements: Object.freeze([Object.freeze({ requirementRef: "requirement:target",
      state, cardinality: "one", matched,
      entityRefs: Object.freeze(Array.from({ length: matched }, (_, index) => `entity:${index + 1}`)) })]),
    unknowns: Object.freeze([]),
    visualProbes: Object.freeze([Object.freeze({ artifact: Object.freeze({ artifactRef }) })]),
  });
}

export async function assertMotorTaskContract() {
  const calls = [];
  let effects = 0;
  const observed = capsule();
  const client = {
    async openTarget() { calls.push("openTarget"); return { output: { targetRef: "target:owned" } }; },
    async closeTarget(targetRef) { calls.push(`closeTarget:${targetRef}`); return { output: { closed: true } }; },
    async attachSession(targetRef) {
      calls.push(`attachSession:${targetRef}`);
      return { output: { protocolVersion: "1", brokerId: "broker", brokerEpoch: 1,
        sessionId: "session:owned", targetRef } };
    },
    async detachSession() {
      calls.push("detachSession");
      const error = new Error("detach failed");
      error.code = "SESSION_DETACH_FAILED";
      throw error;
    },
    async deleteArtifact(artifactRef) {
      calls.push(`deleteArtifact:${artifactRef}`);
      const error = new Error("delete failed");
      error.code = "ARTIFACT_DELETE_FAILED";
      throw error;
    },
    perception() {
      return { situate: async () => ({ situation: observed }) };
    },
    async executeMotor() {
      effects += 1;
      calls.push("executeMotor");
      return { output: { terminal: "confirmed" } };
    },
  };

  const task = await MotorTaskSession.open(client, { url: "https://allowed.example/work" });
  const situated = await task.situate({ requirements: [] });
  await task.execute({ situation: situated, requirementRef: "requirement:target", intent: {} });
  const ambiguous = capsule({ matched: 2, state: "ambiguous", artifactRef: "artifact:other" });
  const diagnostic = task.diagnoseAmbiguity(ambiguous, "requirement:target");
  assert.equal(diagnostic.canExecute, false);
  assert.equal(diagnostic.state, "ambiguous");
  assert.equal(diagnostic.requiredCallerRefinement.every((entry) =>
    !/candidate|coordinate|locator|backend|objectId/i.test(JSON.stringify(entry))), true);

  const cleanup = await task.close();
  const callsAfterCleanup = calls.slice();
  const repeatedCleanup = await task.close();
  assert.equal(cleanup, repeatedCleanup);
  assert.equal(cleanup.state, "incomplete");
  assert.equal(cleanup.effectRetried, false);
  assert.deepEqual(cleanup.failures.map((entry) => entry.phase), ["sessionDetach", "artifactDelete"]);
  assert.equal(effects, 1);
  assert.deepEqual(calls, callsAfterCleanup);
  assert.equal(calls.includes("closeTarget:target:owned"), true);
}
