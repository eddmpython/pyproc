import { strict as assert } from "node:assert";
import { NativeCdpSpace } from "../../../scripts/automationSpace/nativeCdpSpace.js";
import { AutomationSpaceRouter } from "../../../scripts/automationSpace/automationSpace.js";

const calls = [];
const tools = [
  "browserInspect", "browserListTargets", "browserOpen", "browserAttach", "browserCommand",
  "browserDetach", "browserObserve", "browserAct", "browserArtifactRead", "browserArtifactDelete",
].map((name) => ({ name }));
const control = {
  tools,
  authorize(tool) { calls.push(["authorize", tool]); return Object.freeze({ tool }); },
  invokeAuthorized(tool, input, { authority }) {
    calls.push(["execute", tool]);
    assert.equal(authority.tool, tool);
    return tool === "browserInspect" ? { transport: "fake-cdp" } : { tool, input };
  },
  async close() { calls.push(["close"]); },
};

console.log("automationComputer NativeCdpSpace probe");
const space = new NativeCdpSpace({ control, spaceId: "space:cdpProbe" });
assert.equal(space.providerKind, "nativeCdp");
assert.deepEqual(space.capabilities, ["dom", "network", "target", "storage", "runtime", "screenshot", "artifact"]);
assert.equal(space.operations.length, 10);
console.log("  PASS provider identity and seven capability declarations");
const router = new AutomationSpaceRouter(space);
const inspected = await router.invoke("automation.space.inspect", {});
assert.equal(inspected.transport, "fake-cdp");
assert.equal(inspected.space.providerKind, "nativeCdp");
assert.deepEqual(inspected.space.capabilities, space.capabilities);
console.log("  PASS inspect projects native provider without exposing transport authority");
for (const operation of space.operations) await router.invoke(operation, {});
for (const tool of tools) {
  const phases = calls.filter((call) => call[1] === tool.name).map((call) => call[0]);
  assert.deepEqual(phases, tool.name === "browserInspect"
    ? ["authorize", "execute", "authorize", "execute"] : ["authorize", "execute"]);
}
console.log("  PASS ten canonical operations map to the existing CDP implementation once");
await router.close();
await router.close();
assert.equal(calls.filter(([phase]) => phase === "close").length, 1);
console.log("  PASS provider close is idempotent through the router");
console.log("\n결과: GREEN (4/4)");
