import { strict as assert } from "node:assert";
import {
  AUTOMATION_SPACE_OPERATIONS,
  AutomationSpaceRouter,
  assertAutomationSpace,
} from "../../scripts/automationSpace/automationSpace.js";
import { BrowserControlSpace } from "../../scripts/automationSpace/browserControlSpace.js";
import { NativeCdpSpace, NATIVE_CDP_CAPABILITIES } from "../../scripts/automationSpace/nativeCdpSpace.js";
import { controlToolForOperation } from "../../scripts/controlProtocol/controlOperations.js";

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

export async function assertAutomationSpaceContract() {
  assert.equal(AUTOMATION_SPACE_OPERATIONS.length, 10);
  const calls = [];
  const provider = {
    spaceId: "space:contract",
    providerKind: "fakeSpace",
    operations: AUTOMATION_SPACE_OPERATIONS,
    replayBoundary: "deterministic",
    authorize(operation, input) {
      calls.push({ phase: "authorize", operation });
      if (input.deny) {
        const error = new Error("denied before effect");
        error.code = "AUTOMATION_SPACE_PERMISSION_DENIED";
        error.outcome = "notSent";
        throw error;
      }
      return Object.freeze({ operation });
    },
    execute(operation, input, { authority }) {
      calls.push({ phase: "execute", operation });
      assert.equal(authority.operation, operation);
      if (input.unknown) {
        const error = new Error("effect state unknown");
        error.code = "AUTOMATION_SPACE_OUTCOME_UNKNOWN";
        error.outcome = "outcomeUnknown";
        error.retryable = false;
        throw error;
      }
      return operation === "artifact.read" ? { artifactRef: input.artifactRef, dataBase64: "cG5n" } : { operation };
    },
    async close() { calls.push({ phase: "close" }); },
  };
  assert.equal(assertAutomationSpace(provider), provider);
  assert.throws(() => assertAutomationSpace({ ...provider,
    operations: ["automation.observe", "automation.observe"] }));
  const router = new AutomationSpaceRouter(provider);
  for (const operation of AUTOMATION_SPACE_OPERATIONS) await router.invoke(operation, {});
  for (const operation of AUTOMATION_SPACE_OPERATIONS) {
    assert.deepEqual(calls.filter((call) => call.operation === operation).map((call) => call.phase),
      ["authorize", "execute"]);
  }
  const inspect = await router.invoke("automation.space.inspect", {});
  assert.deepEqual(inspect.space, {
    spaceId: "space:contract", providerKind: "fakeSpace", operations: AUTOMATION_SPACE_OPERATIONS,
    capabilities: [],
    restoreBoundary: "externalEffectsRemain", replayBoundary: "deterministic",
  });
  const beforeDenied = calls.filter((call) => call.phase === "execute").length;
  const denied = await errorOf(() => router.invoke("automation.target.open", { deny: true }));
  assert.equal(denied?.outcome, "notSent");
  assert.equal(calls.filter((call) => call.phase === "execute").length, beforeDenied);
  const abort = new AbortController();
  abort.abort("cancel before authority");
  const beforeAbort = calls.length;
  const cancelled = await errorOf(() => router.invoke("automation.observe", {}, { signal: abort.signal }));
  assert.equal(cancelled?.code, "CONTROL_CANCELLED");
  assert.equal(calls.length, beforeAbort);
  const unknown = await errorOf(() => router.invoke("automation.act", { unknown: true }));
  assert.equal(unknown?.outcome, "outcomeUnknown");
  assert.equal(unknown?.retryable, false);
  assert.deepEqual(await router.invoke("artifact.read", { artifactRef: "artifact:contract" }),
    { artifactRef: "artifact:contract", dataBase64: "cG5n" });
  assert.equal((await errorOf(() => router.invoke("automation.unknown", {})))?.code,
    "AUTOMATION_SPACE_OPERATION_UNSUPPORTED");

  const controlCalls = [];
  const control = {
    tools: AUTOMATION_SPACE_OPERATIONS.map((operation) => ({ name: controlToolForOperation(operation) })),
    authorize(tool, input) { controlCalls.push(["authorize", tool]); return { tool }; },
    invokeAuthorized(tool, input, context) { controlCalls.push(["execute", tool, context.authority]); return { tool }; },
    async close() { controlCalls.push(["close"]); },
  };
  const adapter = new BrowserControlSpace(control);
  const adapterRouter = new AutomationSpaceRouter(adapter);
  const listed = await adapterRouter.invoke("automation.target.list", {});
  assert.equal(listed.tool, "browserListTargets");
  assert.deepEqual(controlCalls.slice(0, 2).map((entry) => entry.slice(0, 2)),
    [["authorize", "browserListTargets"], ["execute", "browserListTargets"]]);
  await adapterRouter.close();
  await adapterRouter.close();
  assert.equal(controlCalls.filter(([phase]) => phase === "close").length, 1);
  const nativeControl = {
    ...control,
    async close() {},
  };
  const native = new NativeCdpSpace({ control: nativeControl, spaceId: "space:nativeContract" });
  assert.equal(native.providerKind, "nativeCdp");
  assert.deepEqual(native.capabilities, NATIVE_CDP_CAPABILITIES);
  const nativeRouter = new AutomationSpaceRouter(native);
  const nativeInspect = await nativeRouter.invoke("automation.space.inspect", {});
  assert.equal(nativeInspect.space.providerKind, "nativeCdp");
  assert.deepEqual(nativeInspect.space.capabilities,
    ["dom", "network", "target", "storage", "runtime", "screenshot", "artifact"]);
  await nativeRouter.close();
  await router.close();
  await router.close();
  assert.equal(calls.filter((call) => call.phase === "close").length, 1);
  assert.equal((await errorOf(() => router.invoke("automation.target.list", {})))?.code,
    "AUTOMATION_SPACE_CLOSED");
}
