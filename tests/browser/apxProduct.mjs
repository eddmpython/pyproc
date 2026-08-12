// APX Native CDP product gate.
import { join } from "node:path";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { connectNodeBrowserControl } from "../../scripts/browserControl/browserControlBroker.mjs";
import { BrowserAutomation } from "../../scripts/browserControl/browserAutomation.js";
import { BROWSER_AUTOMATION_ACTIONS } from "../../scripts/browserControl/browserAutomationCatalog.js";
import { BrowserArtifactStore } from "../../scripts/browserControl/browserArtifactStore.js";
import { APX_WEB_COMPUTED_STYLES, parseWebDomSnapshot } from "../../scripts/perception/profiles/webCdpSensor.js";
import { launchBrowser } from "./harness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const server = createStaticServer(async (request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  if (url.pathname !== "/apxProbeOrder") return false;
  for await (const chunk of request) void chunk;
  response.writeHead(201, { "Content-Type": "application/json" });
  response.end('{"saved":true}');
  return true;
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const targetUrl = `${origin}/tests/browser/apxProduct.html`;

let browser = null;
let broker = null;
let automation = null;
let artifactStore = null;
let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

console.log("APX Native CDP product gate");
try {
  browser = launchBrowser("about:blank", {
    prefix: "pyprocApxProductProbe-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
  });
  const actionNames = ["snapshot", "screenshot", "click"];
  broker = await connectNodeBrowserControl({
    profileDir: browser.profile,
    targetOrigins: [origin],
    methods: [...new Set(actionNames.flatMap((name) => BROWSER_AUTOMATION_ACTIONS[name].methods))],
    events: [...new Set(actionNames.flatMap((name) => BROWSER_AUTOMATION_ACTIONS[name].events))],
    maxRisk: "externalEffect",
    timeoutMs,
  });
  const target = await broker.openTarget(targetUrl, { waitUntil: "load" });
  const sessionRef = await broker.attach(target.targetRef);
  artifactStore = new BrowserArtifactStore({ root: join(browser.profile, "apxProductArtifacts") });
  automation = new BrowserAutomation({ port: broker.port, actions: actionNames, artifactStore });

  const legacy = await automation.observe(sessionRef, { maxNodes: 40, mode: "interactive" });
  check("legacy observe 호환", legacy.result?.snapshotId?.startsWith("snapshot:")
    && Array.isArray(legacy.result.nodes) && legacy.result.protocol === undefined);

  const rawDom = await broker.command(sessionRef, { method: "DOMSnapshot.captureSnapshot", params: {
    computedStyles: APX_WEB_COMPUTED_STYLES, includePaintOrder: true, includeDOMRects: true,
  }, expectedRisk: "read" });
  const rawMetrics = await broker.command(sessionRef, { method: "Page.getLayoutMetrics", params: {}, expectedRisk: "read" });
  const parsedDom = parseWebDomSnapshot(rawDom.result, rawMetrics.result);
  const parsedCovered = parsedDom.records.find((node) => node.attributes.id === "covered");
  const parsedOverlay = parsedDom.records.find((node) => node.attributes.id === "overlay");
  const parentChain = (node) => {
    const records = parsedDom.recordsByDocument.get(node.documentIndex);
    const chain = [];
    let index = node.parentIndex;
    while (index >= 0 && chain.length < 20) { chain.push(index); index = records[index]?.parentIndex ?? -1; }
    return chain;
  };
  check("DOMSnapshot occlusion derivation", parsedCovered?.occludedBy === parsedOverlay,
    JSON.stringify({ covered: parsedCovered && { rect: parsedCovered.rect, paint: parsedCovered.paintOrder },
      overlay: parsedOverlay && { rect: parsedOverlay.rect, paint: parsedOverlay.paintOrder,
        visible: parsedOverlay.visible, pointer: parsedOverlay.styles["pointer-events"] },
      coveredIndex: parsedCovered?.nodeIndex, overlayIndex: parsedOverlay?.nodeIndex,
      coveredParents: parsedCovered ? parentChain(parsedCovered) : [], overlayParents: parsedOverlay ? parentChain(parsedOverlay) : [],
      blocker: parsedCovered?.occludedBy?.attributes?.id || null }));

  const firstRun = await automation.observe(sessionRef, {
    representation: "apx.graph",
    visual: { mode: "auto", maxCrops: 2 },
    budget: { maxEntities: 120, maxRelations: 300, maxBytes: 256 * 1024 },
  });
  const first = firstRun.result;
  const save = first.entities.find((entity) => entity.semantic?.name === "저장");
  const covered = first.entities.find((entity) => entity.semantic?.name === "가려진 작업");
  const offscreen = first.entities.find((entity) => entity.semantic?.name === "화면 밖 작업");
  check("APX full semantic, spatial graph", first.protocol === "apx" && first.kind === "full"
    && save?.locatorRef && covered?.geometry?.occluded === true
    && offscreen?.interaction?.reasons?.includes("outsideViewport"),
  JSON.stringify({ entities: first.entities.length, relations: first.relations.length,
    save: !!save?.locatorRef, covered: covered?.geometry, offscreen: offscreen?.interaction }));
  check("pixel-on-demand artifact", first.visualProbes?.some((probe) => probe.reason === "canvas"
    && probe.artifact?.mimeType === "image/png" && probe.artifact?.sha256?.length === 64),
  `${first.visualProbes?.length || 0} probes`);
  const serialized = JSON.stringify(first);
  check("raw driver ID 비노출", !serialized.includes("backendNodeId") && !serialized.includes("DOMSnapshot")
    && !serialized.includes('"nativeRef"'));

  const acted = await automation.run(sessionRef, [{
    kind: "click",
    locatorRef: save.locatorRef,
    expectedRisk: "externalEffect",
    verify: { all: [
      { entityAppeared: { role: "status", nameContains: "저장 완료" } },
      { networkResponse: { method: "POST", urlPath: "/apxProbeOrder", status: 201 } },
    ], withinMs: 5000 },
  }]);
  const evidence = acted.actions[0].result.evidence;
  check("EvidenceLoop confirmed", evidence?.effectOutcome === "applied"
    && evidence.verification?.state === "confirmed" && evidence.verification.evidenceRefs.length >= 2,
  JSON.stringify(evidence));

  const secondRun = await automation.observe(sessionRef, {
    representation: "apx.graph",
    since: first.observationRef,
    visual: { mode: "off" },
    budget: { maxEntities: 120, maxRelations: 300, maxBytes: 256 * 1024 },
  });
  const second = secondRun.result;
  const changedSave = second.entities.find((entity) => entity.entityRef === save.entityRef);
  check("stable entity와 delta", second.kind === "delta" && changedSave?.semantic?.states?.disabled === true
    && second.delta.changed.some((entry) => entry.entityRef === save.entityRef)
    && changedSave.locatorRef !== save.locatorRef,
  `${second.delta?.changed?.length || 0} changed`);

  await broker.detach(sessionRef);
} catch (error) {
  check("gate 예외 없음", false, String(error?.stack || error).slice(0, 700));
} finally {
  try { automation?.close(); } catch (error) {}
  try { await artifactStore?.close(); } catch (error) {}
  try { await broker?.close(); } catch (error) {}
  try { browser?.close(); } catch (error) {}
  await new Promise((resolve) => server.close(resolve));
}

console.log(`결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
