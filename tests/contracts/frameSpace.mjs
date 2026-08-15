import { strict as assert } from "node:assert";
import { FrameSpace } from "../../scripts/automationSpace/frameSpace.js";
import { FrameSpacePage } from "../../scripts/automationSpace/frameSpacePage.js";
import { createFrameSpaceTools } from "../../scripts/automationSpace/frameSpaceTools.js";
import { AutomationSpaceRouter } from "../../scripts/automationSpace/automationSpace.js";
import { PageCommandBridge } from "../../scripts/controlProtocol/pageCommandBridge.mjs";
import { APX_REPRESENTATION } from "../../scripts/perception/apxCatalog.js";
import { APX_SITUATION_REPRESENTATION } from "../../scripts/perception/situationCatalog.js";

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

export async function assertFrameSpaceContract() {
  const calls = [];
  const pageBridge = {
    async waitForReady() { calls.push(["ready"]); },
    dispatch(operation, input, options) {
      calls.push(["dispatch", operation, input, options.requestId]);
      if (operation === "automation.space.inspect") return { transport: "messageChannel", resources: {
        targets: 0, ownedTargets: 0, sessions: 0, locators: 0, quarantinedSessions: 0,
        semanticInventories: 0, continuations: 0, observationListeners: 0, observationEvents: 0,
        lifecycleSessions: 0, lifecycleWatchers: 0, lifecycleQueuedEvents: 0,
        artifacts: 0, artifactBytes: 0, transport: { sessions: 0, pending: 0, listeners: 0 },
      } };
      if (operation === "frame.perception.capture") return {
        documentEpoch: 3,
        page: { url: "https://allowed.example/path?secret=hidden", title: "Frame target",
          viewport: { width: 800, height: 600, scale: 1 }, scroll: { x: 0, y: 0 } },
        entities: [{ nativeRef: "frameNode:private:1", locatorData: { locatorRef: "locator:frame:1" },
          kind: "ui.control", semantic: { role: "button", name: "Save", states: { disabled: false } },
          structure: { frameNativeRef: "frame:private", nodeName: "BUTTON" },
          geometry: { rect: { x: 10, y: 10, width: 80, height: 30 }, viewportRatio: 1,
            visible: true, occluded: false },
          interaction: { supportedActions: ["focus", "click"], actionable: true, reasons: [] },
          provenance: { semantic: { mode: "reported", source: "frame.dom", trust: "page" } } }],
        relations: [], events: [], completeness: { semantic: "complete", structure: "complete",
          geometry: "complete", interaction: "complete", network: "notAvailable" },
        omitted: { entities: input.maxEntities >= 1000 ? 0 : 2 },
      };
      if (operation === "automation.act") return { completed: [{ index: 0, kind: input.actions[0].kind }], results: [{}] };
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
  assert.equal(tools.length, 10);
  assert.equal(tools.some((tool) => tool.name === "browserCommand"), false);
  assert.equal(tools.find((tool) => tool.name === "browserObserve")
    .inputSchema.properties.representation.enum.includes(APX_REPRESENTATION), true);
  assert.equal(tools.find((tool) => tool.name === "browserObserve")
    .inputSchema.properties.representation.enum.includes(APX_SITUATION_REPRESENTATION), true);
  const space = new FrameSpace({ pageBridge, config, spaceId: "space:frameContract" });
  assert.equal(space.providerKind, "frame");
  assert.deepEqual(space.capabilities,
    ["dom", "target", "screenshot", "artifact", "perception", "actionEvidence", "actionConvergence"]);
  const router = new AutomationSpaceRouter(space);
  const inspect = await router.invoke("automation.space.inspect", {}, { requestId: "contract:inspect" });
  assert.equal(inspect.space.providerKind, "frame");
  assert.equal(inspect.transport, "messageChannel");
  assert.equal(inspect.perception.level, "L3");
  assert.equal(inspect.perception.profiles.includes("apx-action/1"), false);
  assert.equal(inspect.resources.targets, 0);
  assert.equal(inspect.resources.perception.identitySessions, 0);

  const observed = await router.invoke("automation.observe", {
    sessionRef: { protocolVersion: "1", spaceId: "space:frameContract",
      sessionId: "session:contract", targetRef: "target:contract" },
    expectedRisk: "read",
    representation: APX_REPRESENTATION,
  }, { requestId: "contract:apx" });
  assert.equal(observed.protocol, "apx");
  assert.equal(observed.entities[0].semantic.name, "Save");
  assert.equal(observed.entities[0].locatorRef, "locator:frame:1");
  assert.equal(observed.budget.truncated, true);
  assert.equal(observed.budget.omitted.entities, 2);
  assert.equal(JSON.stringify(observed).includes("frameNode:private"), false);
  assert.equal(observed.page.url, "https://allowed.example/path");
  const situation = await router.invoke("automation.observe", {
    sessionRef: { protocolVersion: "1", spaceId: "space:frameContract",
      sessionId: "session:contract", targetRef: "target:contract" },
    expectedRisk: "read", representation: APX_SITUATION_REPRESENTATION,
    focus: { requirements: [{ requirementRef: "requirement:save", select: { role: "button", name: "Save" },
      need: ["fact", "affordance"], cardinality: "one" }] },
  }, { requestId: "contract:situation" });
  const save = situation.affordances.find((entry) => entry.kind === "authorized" && entry.action === "click");
  assert.equal(situation.requirements[0].state, "satisfied");
  assert.equal(save.capabilityRef.startsWith("capability:"), true);
  await router.invoke("automation.act", { sessionRef: { protocolVersion: "1", spaceId: "space:frameContract",
    sessionId: "session:contract", targetRef: "target:contract" }, actions: [{ kind: "click",
    locatorRef: save.locatorRef, expectedRisk: "externalEffect", actionContext: {
      situationRef: situation.situationRef, worldRef: situation.worldRef, capabilityRef: save.capabilityRef,
    } }] }, { requestId: "contract:proof-action" });
  assert.equal(calls.at(-1)[1], "automation.act");

  const beforeUnsupported = calls.length;
  const unsupportedProfile = await errorOf(() => router.invoke("automation.observe", {
    sessionRef: {}, expectedRisk: "read", representation: APX_REPRESENTATION,
    profile: ["apx-core/1", "apx-web/1", "apx-action/1"],
  }));
  assert.equal(unsupportedProfile?.code, "APX_PROFILE_UNSUPPORTED");
  const unsupportedVisual = await errorOf(() => router.invoke("automation.observe", {
    sessionRef: {}, expectedRisk: "read", representation: APX_REPRESENTATION,
    visual: { mode: "auto" },
  }));
  assert.equal(unsupportedVisual?.code, "APX_VISUAL_PROVIDER_DENIED");
  assert.equal(calls.length, beforeUnsupported);

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
  const evidenced = await router.invoke("automation.act", {
    sessionRef: { protocolVersion: "1", spaceId: "space:frameContract",
      sessionId: "session:contract", targetRef: "target:contract" }, actions: [{ kind: "click",
      locatorRef: save.locatorRef, expectedRisk: "externalEffect", actionContext: {
        situationRef: situation.situationRef, worldRef: situation.worldRef, capabilityRef: save.capabilityRef },
      verify: { entityState: { entityRef: situation.requirements[0].entityRefs[0], disabled: false } } }],
  }, { requestId: "contract:evidence" });
  assert.equal(evidenced.results[0].evidence.verification.state, "confirmed");
  const afterEvidenced = calls.length;

  const readOnly = new AutomationSpaceRouter(new FrameSpace({ pageBridge, config: {
    ...config, maxRisk: "read", actions: ["snapshot", "screenshot"],
  }, spaceId: "space:frameReadOnly" }));
  const readOnlyOpen = await errorOf(() => readOnly.invoke("automation.target.open", {
    url: "https://allowed.example/path", expectedRisk: "externalEffect",
  }));
  assert.equal(readOnlyOpen?.code, "FRAME_SPACE_PERMISSION_DENIED");
  assert.equal(calls.length, afterEvidenced);
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
  const emptyResources = (await artifactPage.inspect()).resources;
  assert.equal(emptyResources.targets, 0);
  assert.equal(emptyResources.artifacts, 0);
  assert.equal(emptyResources.transport.listeners, 0);

  await router.invoke("automation.target.open", {
    url: "https://allowed.example/path", expectedRisk: "externalEffect",
  }, { requestId: "contract:open" });
  assert.equal(calls.at(-1)[1], "automation.target.open");
  await router.close();
  await router.close();
  assert.equal(calls.filter((call) => call[1] === "frame.close").length, 0);
}
