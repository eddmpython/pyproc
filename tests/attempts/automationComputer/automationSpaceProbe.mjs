import { strict as assert } from "node:assert";
import { AUTOMATION_SPACE_OPERATIONS, AutomationSpaceRouter, assertAutomationSpace } from "./automationSpaceDraft.mjs";

let passed = 0;
function check(name, operation) {
  try { operation(); console.log(`  PASS ${name}`); passed += 1; }
  catch (error) { console.log(`  FAIL ${name}: ${error.message}`); throw error; }
}
async function checkAsync(name, operation) {
  try { await operation(); console.log(`  PASS ${name}`); passed += 1; }
  catch (error) { console.log(`  FAIL ${name}: ${error.message}`); throw error; }
}
async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

const calls = [];
const provider = {
  spaceId: "space:fake",
  providerKind: "fakeSpace",
  operations: AUTOMATION_SPACE_OPERATIONS,
  replayBoundary: "deterministic",
  authorize(operation, input) {
    calls.push({ phase: "authorize", operation });
    if (input.deny === true) {
      const error = new Error("permission denied before effect");
      error.code = "AUTOMATION_SPACE_PERMISSION_DENIED";
      error.outcome = "notSent";
      throw error;
    }
    return Object.freeze({ risk: input.expectedRisk || "read" });
  },
  execute(operation, input, context) {
    calls.push({ phase: "execute", operation, authority: context.authority });
    if (input.unknown === true) {
      const error = new Error("effect outcome is unknown");
      error.code = "AUTOMATION_SPACE_OUTCOME_UNKNOWN";
      error.outcome = "outcomeUnknown";
      error.retryable = false;
      throw error;
    }
    if (operation === "automation.space.inspect") return { ready: true };
    if (operation === "artifact.read") return { artifactRef: input.artifactRef, dataBase64: "cG5n" };
    return { operation, input };
  },
  async close() { calls.push({ phase: "close" }); },
};

console.log("automationComputer AutomationSpace probe");
check("operation catalog has ten canonical operations", () => assert.equal(AUTOMATION_SPACE_OPERATIONS.length, 10));
check("provider contract accepts the fake space", () => assert.equal(assertAutomationSpace(provider), provider));
check("provider contract rejects duplicate operations", () => assert.throws(() => assertAutomationSpace({
  ...provider, operations: ["automation.observe", "automation.observe"],
})));
const router = new AutomationSpaceRouter(provider);
await checkAsync("all canonical operations route authorize before execute", async () => {
  for (const operation of AUTOMATION_SPACE_OPERATIONS) await router.invoke(operation, {});
  for (const operation of AUTOMATION_SPACE_OPERATIONS) {
    const phases = calls.filter((call) => call.operation === operation).map((call) => call.phase);
    assert.deepEqual(phases, ["authorize", "execute"]);
  }
});
await checkAsync("inspect declares restore and replay boundaries", async () => {
  const value = await router.invoke("automation.space.inspect", {});
  assert.deepEqual(value.space, {
    spaceId: "space:fake", providerKind: "fakeSpace", operations: AUTOMATION_SPACE_OPERATIONS,
    restoreBoundary: "externalEffectsRemain", replayBoundary: "deterministic",
  });
});
await checkAsync("permission denial does not execute the effect", async () => {
  const before = calls.filter((call) => call.phase === "execute").length;
  const error = await errorOf(() => router.invoke("automation.target.open", { deny: true }));
  assert.equal(error.code, "AUTOMATION_SPACE_PERMISSION_DENIED");
  assert.equal(error.outcome, "notSent");
  assert.equal(calls.filter((call) => call.phase === "execute").length, before);
});
await checkAsync("pre-aborted request never reaches authorization", async () => {
  const controller = new AbortController();
  controller.abort("already cancelled");
  const before = calls.length;
  const error = await errorOf(() => router.invoke("automation.observe", {}, { signal: controller.signal }));
  assert.equal(error.code, "CONTROL_CANCELLED");
  assert.equal(error.outcome, "notSent");
  assert.equal(calls.length, before);
});
await checkAsync("provider outcomeUnknown remains non-retryable", async () => {
  const error = await errorOf(() => router.invoke("automation.act", { unknown: true }));
  assert.equal(error.code, "AUTOMATION_SPACE_OUTCOME_UNKNOWN");
  assert.equal(error.outcome, "outcomeUnknown");
  assert.equal(error.retryable, false);
});
await checkAsync("artifact payload crosses the provider boundary unchanged", async () => {
  const value = await router.invoke("artifact.read", { artifactRef: "artifact:fake" });
  assert.deepEqual(value, { artifactRef: "artifact:fake", dataBase64: "cG5n" });
});
await checkAsync("unknown operation fails before provider", async () => {
  const before = calls.length;
  const error = await errorOf(() => router.invoke("automation.unknown", {}));
  assert.equal(error.code, "AUTOMATION_SPACE_OPERATION_UNSUPPORTED");
  assert.equal(calls.length, before);
});
await checkAsync("close is idempotent and rejects later work", async () => {
  await router.close();
  await router.close();
  assert.equal(calls.filter((call) => call.phase === "close").length, 1);
  const error = await errorOf(() => router.invoke("automation.target.list", {}));
  assert.equal(error.code, "AUTOMATION_SPACE_CLOSED");
});

console.log(`\n결과: GREEN (${passed}/${passed})`);
