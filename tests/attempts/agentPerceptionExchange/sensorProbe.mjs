// 결과 2026-08-12, Chrome 151 headless: 9/9 PASS. AX 23 nodes, DOM 54 nodes,
// stable identity and replacement split, DOM geometry and occlusion inputs, PNG crop 423 bytes.
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { readDevToolsEndpoint } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { CdpConnection } from "../../../scripts/browserControl/cdpConnection.mjs";
import { NodeCdpTransport } from "../../../scripts/browserControl/nodeCdpTransport.js";
import { launchBrowser } from "../../browser/harness.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const computedStyles = ["display", "visibility", "opacity", "pointer-events", "position", "z-index"];
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const targetUrl = `${origin}/tests/browser/apxProduct.html`;

let browser = null;
let broker = null;
let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

function stringAt(strings, index) {
  return Number.isInteger(index) && index >= 0 && index < strings.length ? strings[index] : "";
}

function rareBoolean(data, index) {
  return Array.isArray(data?.index) && data.index.includes(index);
}

function snapshotNodes(payload) {
  const strings = payload.strings || [];
  const output = [];
  for (const [documentIndex, document] of (payload.documents || []).entries()) {
    const nodes = document.nodes || {};
    const layoutIndexByNode = new Map((document.layout?.nodeIndex || []).map((nodeIndex, layoutIndex) => [nodeIndex, layoutIndex]));
    for (let nodeIndex = 0; nodeIndex < (nodes.backendNodeId || []).length; nodeIndex += 1) {
      const layoutIndex = layoutIndexByNode.get(nodeIndex);
      const bounds = layoutIndex === undefined ? null : document.layout.bounds?.[layoutIndex] || null;
      const attributes = {};
      const attributeIndexes = nodes.attributes?.[nodeIndex] || [];
      for (let attributeIndex = 0; attributeIndex + 1 < attributeIndexes.length; attributeIndex += 2) {
        attributes[stringAt(strings, attributeIndexes[attributeIndex])] = stringAt(strings, attributeIndexes[attributeIndex + 1]);
      }
      const styles = {};
      const styleIndexes = layoutIndex === undefined ? [] : document.layout.styles?.[layoutIndex] || [];
      for (let styleIndex = 0; styleIndex < computedStyles.length; styleIndex += 1) {
        styles[computedStyles[styleIndex]] = stringAt(strings, styleIndexes[styleIndex]);
      }
      output.push({
        documentIndex,
        nodeIndex,
        backendNodeId: nodes.backendNodeId[nodeIndex],
        parentIndex: nodes.parentIndex?.[nodeIndex] ?? -1,
        nodeName: stringAt(strings, nodes.nodeName?.[nodeIndex]),
        attributes,
        frameId: stringAt(strings, document.frameId),
        bounds,
        paintOrder: layoutIndex === undefined ? null : document.layout.paintOrders?.[layoutIndex] ?? null,
        styles,
        clickable: rareBoolean(nodes.isClickable, nodeIndex),
      });
    }
  }
  return output;
}

function axName(node) {
  return typeof node?.name?.value === "string" ? node.name.value : "";
}

async function command(sessionRef, method, params = {}) {
  return broker.send(sessionRef, { method, params });
}

async function capture(sessionRef) {
  const [ax, dom] = await Promise.all([
    command(sessionRef, "Accessibility.getFullAXTree"),
    command(sessionRef, "DOMSnapshot.captureSnapshot", {
      computedStyles: ["display", "visibility", "opacity", "pointer-events", "position", "z-index"],
      includePaintOrder: true,
      includeDOMRects: true,
    }),
  ]);
  return { ax: ax.nodes || [], dom, domNodes: snapshotNodes(dom) };
}

console.log("APX sensor probe");
try {
  browser = launchBrowser(targetUrl, {
    prefix: "pyprocApxSensorProbe-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
  });
  const endpoint = await readDevToolsEndpoint(browser.profile, { timeoutMs });
  broker = new NodeCdpTransport(await CdpConnection.connect(endpoint, { timeoutMs }));
  let target = null;
  const deadline = Date.now() + timeoutMs;
  while (!target && Date.now() < deadline) {
    target = (await broker.listTargets()).find((entry) => entry.url === targetUrl);
    if (!target) await delay(50);
  }
  if (!target) throw new Error("APX sensor target did not become ready");
  const sessionRef = await broker.attach(target.id);
  await command(sessionRef, "Accessibility.enable");

  const first = await capture(sessionRef);
  const saveAx = first.ax.find((node) => axName(node) === "저장");
  const coveredAx = first.ax.find((node) => axName(node) === "가려진 작업");
  const offscreenAx = first.ax.find((node) => axName(node) === "화면 밖 작업");
  const saveDom = first.domNodes.find((node) => node.backendNodeId === saveAx?.backendDOMNodeId);
  const coveredDom = first.domNodes.find((node) => node.backendNodeId === coveredAx?.backendDOMNodeId);
  const offscreenDom = first.domNodes.find((node) => node.backendNodeId === offscreenAx?.backendDOMNodeId);
  const overlayDom = first.domNodes.find((node) => node.attributes.id === "overlay");
  check("AX와 DOMSnapshot backend node join", !!saveDom && !!coveredDom && !!offscreenDom,
    `${first.ax.length} AX, ${first.domNodes.length} DOM`);
  check("AX parent와 describedby relation 보존", !!saveAx?.parentId
    && saveAx.properties?.some((property) => property.name === "describedby"
      && property.value?.relatedNodes?.length === 1));
  check("DOMSnapshot geometry와 paint order", saveDom?.bounds?.length === 4
    && coveredDom?.bounds?.length === 4 && Number.isInteger(coveredDom?.paintOrder));
  const overlaps = overlayDom?.bounds && coveredDom?.bounds
    && overlayDom.bounds[0] < coveredDom.bounds[0] + coveredDom.bounds[2]
    && overlayDom.bounds[0] + overlayDom.bounds[2] > coveredDom.bounds[0]
    && overlayDom.bounds[1] < coveredDom.bounds[1] + coveredDom.bounds[3]
    && overlayDom.bounds[1] + overlayDom.bounds[3] > coveredDom.bounds[1];
  check("overlay occlusion을 결정할 입력", overlaps && overlayDom.paintOrder > coveredDom.paintOrder
    && overlayDom.styles["pointer-events"] !== "none" && Number(overlayDom.styles.opacity || 1) > 0,
  `${coveredDom?.paintOrder}->${overlayDom?.paintOrder}`);
  check("viewport와 offscreen 구분 가능", saveDom?.bounds?.[1] < 900 && offscreenDom?.bounds?.[1] > 900,
    `${saveDom?.bounds?.[1]}/${offscreenDom?.bounds?.[1]}`);

  const second = await capture(sessionRef);
  const saveSecond = second.ax.find((node) => axName(node) === "저장");
  check("Accessibility.enable 뒤 AX identity 유지", saveSecond?.nodeId === saveAx?.nodeId
    && saveSecond?.backendDOMNodeId === saveAx?.backendDOMNodeId);

  await command(sessionRef, "Runtime.evaluate", { expression: "globalThis.apxProbe.update()" });
  const updated = await capture(sessionRef);
  const updatedSave = updated.ax.find((node) => axName(node) === "저장");
  const updatedStatus = updated.ax.find((node) => axName(node) === "저장 완료");
  check("같은 node 상태 변화의 identity 유지", updatedSave?.backendDOMNodeId === saveAx?.backendDOMNodeId
    && updatedSave?.properties?.some((property) => property.name === "disabled" && property.value?.value === true)
    && !!updatedStatus);

  await command(sessionRef, "Runtime.evaluate", { expression: "globalThis.apxProbe.replace()" });
  const replaced = await capture(sessionRef);
  const replacedSave = replaced.ax.find((node) => axName(node) === "새 저장");
  check("교체 node의 native identity 변경", !!replacedSave
    && replacedSave.backendDOMNodeId !== saveAx?.backendDOMNodeId,
  `${saveAx?.backendDOMNodeId}->${replacedSave?.backendDOMNodeId}`);

  const canvasDom = first.domNodes.find((node) => node.nodeName === "CANVAS");
  const clip = canvasDom?.bounds;
  const screenshot = clip ? await command(sessionRef, "Page.captureScreenshot", {
    format: "png",
    clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 },
    captureBeyondViewport: true,
  }) : null;
  const png = Buffer.from(screenshot?.data || "", "base64");
  check("unresolved canvas bounded crop", png.length > 8
    && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${png.length} bytes`);

  await broker.detach(sessionRef);
} catch (error) {
  check("probe 예외 없음", false, String(error?.stack || error).slice(0, 500));
} finally {
  try { await broker?.close(); } catch (error) {}
  try { browser?.close(); } catch (error) {}
  await new Promise((resolve) => server.close(resolve));
}

console.log(`결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
