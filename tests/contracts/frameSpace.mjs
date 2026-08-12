import { strict as assert } from "node:assert";
import { FrameSpace } from "../../scripts/automationSpace/frameSpace.js";
import { FrameSpacePage } from "../../scripts/automationSpace/frameSpacePage.js";
import { createFrameSpaceTools } from "../../scripts/automationSpace/frameSpaceTools.js";
import { AutomationSpaceRouter } from "../../scripts/automationSpace/automationSpace.js";
import { PageCommandBridge } from "../../scripts/controlProtocol/pageCommandBridge.mjs";

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

export async function assertFrameSpaceContract() {
  const calls = [];
  const pageBridge = {
    async waitForReady() { calls.push(["ready"]); },
    dispatch(operation, input, options) {
      calls.push(["dispatch", operation, input, options.requestId]);
      if (operation === "automation.space.inspect") return { transport: "messageChannel" };
      return { operation, input };
    },
  };
  const config = {
    targetOrigins: ["https://allowed.example"],
    actions: ["snapshot", "screenshot", "navigate", "fill", "click"],
    rawMethods: [],
    maxRisk: "externalEffect",
    artifacts: {},
  };
  const tools = createFrameSpaceTools(config);
  assert.equal(tools.length, 9);
  assert.equal(tools.some((tool) => tool.name === "browserCommand"), false);
  const space = new FrameSpace({ pageBridge, config, spaceId: "space:frameContract" });
  assert.equal(space.providerKind, "frame");
  assert.deepEqual(space.capabilities, ["dom", "target", "screenshot", "artifact"]);
  const router = new AutomationSpaceRouter(space);
  const inspect = await router.invoke("automation.space.inspect", {}, { requestId: "contract:inspect" });
  assert.equal(inspect.space.providerKind, "frame");
  assert.equal(inspect.transport, "messageChannel");

  const beforeDenied = calls.length;
  const denied = await errorOf(() => router.invoke("automation.target.open", {
    url: "https://denied.example/", expectedRisk: "externalEffect",
  }));
  assert.equal(denied?.code, "FRAME_SPACE_PERMISSION_DENIED");
  assert.equal(denied?.outcome, "notSent");
  assert.equal(calls.length, beforeDenied);

  const risk = await errorOf(() => router.invoke("automation.act", {
    sessionRef: {}, actions: [{ kind: "click", selector: "#save", expectedRisk: "read" }],
  }));
  assert.equal(risk?.code, "FRAME_SPACE_PERMISSION_DENIED");
  assert.equal(calls.length, beforeDenied);

  const readOnly = new AutomationSpaceRouter(new FrameSpace({ pageBridge, config: {
    ...config, maxRisk: "read", actions: ["snapshot", "screenshot"],
  }, spaceId: "space:frameReadOnly" }));
  const readOnlyOpen = await errorOf(() => readOnly.invoke("automation.target.open", {
    url: "https://allowed.example/path", expectedRisk: "externalEffect",
  }));
  assert.equal(readOnlyOpen?.code, "FRAME_SPACE_PERMISSION_DENIED");
  assert.equal(calls.length, beforeDenied);
  await readOnly.close();

  const queuedBridge = new PageCommandBridge({ timeoutMs: 1000 });
  const queuedRouter = new AutomationSpaceRouter(new FrameSpace({ pageBridge: queuedBridge, config,
    spaceId: "space:frameQueued" }));
  const controller = new AbortController();
  const queued = queuedRouter.invoke("automation.space.inspect", {}, {
    signal: controller.signal, requestId: "contract:queued",
  });
  controller.abort("cancel before page ready");
  const queuedError = await errorOf(() => queued);
  assert.equal(queuedError?.code, "CONTROL_CANCELLED");
  assert.equal(queuedError?.outcome, "notSent");
  queuedBridge.ready({ protocol: "pyproc-control", version: 1, pageEpoch: "epoch:contract", spaceId: "machine:contract" });
  assert.equal(queuedBridge.poll("epoch:contract"), null);
  await queuedRouter.close();
  queuedBridge.close();

  const artifactPage = new FrameSpacePage({ targetOrigins: ["https://allowed.example"], actions: ["screenshot"],
    artifacts: { maxArtifactBytes: 1024, maxTotalBytes: 2048, maxArtifacts: 2, inlineMaxBytes: 1024, ttlMs: 1000 } });
  const oversized = await errorOf(() => artifactPage._storeScreenshot({
    kind: "screenshot", mimeType: "image/png", byteLength: 1025, sha256: "0".repeat(64),
    dataBase64: "", width: 1, height: 1,
  }, true));
  assert.equal(oversized?.code, "FRAME_SPACE_ARTIFACT_INVALID");

  await router.invoke("automation.target.open", {
    url: "https://allowed.example/path", expectedRisk: "externalEffect",
  }, { requestId: "contract:open" });
  assert.equal(calls.at(-1)[1], "automation.target.open");
  await router.close();
  await router.close();
  assert.equal(calls.filter((call) => call[1] === "frame.close").length, 0);
}
