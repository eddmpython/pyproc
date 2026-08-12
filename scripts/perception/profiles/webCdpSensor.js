// webCdpSensor.js - CDP AX, DOMSnapshot, layout, event facts를 driver-neutral sensor facts로 정규화한다.
import { redactBrowserUrl } from "../../browserControl/browserObservation.js";
import { perceptionSessionKey } from "../perceptionIdentity.js";

export const APX_WEB_COMPUTED_STYLES = Object.freeze([
  "display", "visibility", "opacity", "pointer-events", "overflow", "position", "z-index",
]);

const TEXT_LIMIT = 300;
const AX_STATES = new Set([
  "busy", "disabled", "editable", "focusable", "focused", "hidden", "invalid", "readonly", "required",
  "checked", "expanded", "modal", "pressed", "selected", "valuemin", "valuemax", "valuetext",
]);
const RELATION_TYPES = Object.freeze({
  labelledby: "labelledBy",
  describedby: "describedBy",
  controls: "controls",
  owns: "owns",
  activedescendant: "activeDescendant",
  errormessage: "errorMessageFor",
});
const CONTROL_ROLES = new Set([
  "button", "checkbox", "combobox", "gridcell", "link", "listbox", "menuitem", "menuitemcheckbox",
  "menuitemradio", "option", "radio", "scrollbar", "slider", "spinbutton", "switch", "tab", "treeitem",
]);
const INPUT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const CONTAINER_ROLES = new Set(["form", "group", "list", "listitem", "row", "table", "tree", "document"]);
const LANDMARK_ROLES = new Set(["banner", "complementary", "contentinfo", "main", "navigation", "region", "search"]);
const STATUS_ROLES = new Set(["alert", "log", "marquee", "status", "timer"]);

function clipped(value, limit = TEXT_LIMIT) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function remoteValue(value) {
  if (!value || typeof value !== "object") return undefined;
  return value.value;
}

function stringAt(strings, index) {
  return Number.isInteger(index) && index >= 0 && index < strings.length ? strings[index] : "";
}

function rareMap(data, valueAt = (value) => value) {
  const output = new Map();
  for (let index = 0; index < (data?.index || []).length; index += 1) {
    output.set(data.index[index], valueAt(data.value?.[index]));
  }
  return output;
}

function attributesAt(strings, indexes = []) {
  const output = {};
  for (let index = 0; index + 1 < indexes.length; index += 2) {
    output[stringAt(strings, indexes[index]).toLowerCase()] = stringAt(strings, indexes[index + 1]);
  }
  return output;
}

function rectOf(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 4 || bounds.some((value) => !Number.isFinite(value))) return null;
  return { x: bounds[0], y: bounds[1], width: Math.max(0, bounds[2]), height: Math.max(0, bounds[3]) };
}

function intersectionRatio(rect, viewport) {
  if (!rect || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 0;
  const left = Math.max(rect.x, viewport.x);
  const top = Math.max(rect.y, viewport.y);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  const bottom = Math.min(rect.y + rect.height, viewport.y + viewport.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top) / (rect.width * rect.height);
}

function containsPoint(rect, x, y) {
  return !!rect && x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}

function isAncestor(documentIndex, ancestorIndex, child, recordsByDocument) {
  if (child.documentIndex !== documentIndex) return false;
  const records = recordsByDocument.get(documentIndex);
  let index = child.parentIndex;
  for (let depth = 0; index >= 0 && depth < 200; depth += 1) {
    if (index === ancestorIndex) return true;
    index = records[index]?.parentIndex ?? -1;
  }
  return false;
}

function nodeKind(role, nodeName) {
  if (nodeName === "CANVAS") return "content.canvas";
  if (nodeName === "IMG" || role === "img") return "content.image";
  if (INPUT_ROLES.has(role) || ["INPUT", "TEXTAREA", "SELECT"].includes(nodeName)) return "ui.input";
  if (CONTROL_ROLES.has(role)) return "ui.control";
  if (role === "dialog" || role === "alertdialog") return "ui.dialog";
  if (STATUS_ROLES.has(role)) return "ui.status";
  if (LANDMARK_ROLES.has(role)) return "ui.landmark";
  if (CONTAINER_ROLES.has(role)) return role === "document" ? "content.document" : "ui.container";
  if (["StaticText", "InlineTextBox", "heading", "paragraph"].includes(role)) return "content.text";
  return "ui.container";
}

function supportedActions(role, nodeName, states) {
  if (states.disabled === true) return [];
  if (["checkbox", "radio", "switch"].includes(role)) return ["focus", "click", "check"];
  if (INPUT_ROLES.has(role) || ["INPUT", "TEXTAREA"].includes(nodeName)) return ["focus", "fill"];
  if (nodeName === "SELECT" || role === "combobox") return ["focus", "select"];
  if (CONTROL_ROLES.has(role)) return ["focus", "click"];
  return [];
}

function sensitiveValue(attributes, role, value) {
  if (!value) return { value: "", sensitivity: "public" };
  const autocomplete = String(attributes.autocomplete || "").toLowerCase();
  const type = String(attributes.type || "").toLowerCase();
  const credential = type === "password" || /password|one-time-code|webauthn/u.test(autocomplete);
  const financial = /cc-|transaction-/u.test(autocomplete);
  if (credential || financial) return { value: "[redacted]", sensitivity: credential ? "credential" : "financial" };
  return { value: clipped(value), sensitivity: INPUT_ROLES.has(role) ? "unknown-sensitive" : "public" };
}

export function parseWebDomSnapshot(payload, metrics) {
  const strings = payload.strings || [];
  const records = [];
  const recordsByDocument = new Map();
  const byBackend = new Map();
  for (const [documentIndex, document] of (payload.documents || []).entries()) {
    const nodes = document.nodes || {};
    const layout = document.layout || {};
    const layoutByNode = new Map((layout.nodeIndex || []).map((nodeIndex, layoutIndex) => [nodeIndex, layoutIndex]));
    const clickable = new Set(nodes.isClickable?.index || []);
    const shadowRoots = rareMap(nodes.shadowRootType, (index) => stringAt(strings, index));
    const documentRecords = [];
    const frameNativeRef = `frame:${stringAt(strings, document.frameId) || documentIndex}`;
    for (let nodeIndex = 0; nodeIndex < (nodes.backendNodeId || []).length; nodeIndex += 1) {
      const layoutIndex = layoutByNode.get(nodeIndex);
      const styles = {};
      const styleIndexes = layoutIndex === undefined ? [] : layout.styles?.[layoutIndex] || [];
      for (let styleIndex = 0; styleIndex < APX_WEB_COMPUTED_STYLES.length; styleIndex += 1) {
        styles[APX_WEB_COMPUTED_STYLES[styleIndex]] = stringAt(strings, styleIndexes[styleIndex]);
      }
      const backendNodeId = nodes.backendNodeId[nodeIndex];
      const record = {
        documentIndex,
        nodeIndex,
        parentIndex: nodes.parentIndex?.[nodeIndex] ?? -1,
        backendNodeId,
        nativeRef: `dom:${frameNativeRef}:${backendNodeId}`,
        frameNativeRef,
        nodeName: stringAt(strings, nodes.nodeName?.[nodeIndex]),
        attributes: attributesAt(strings, nodes.attributes?.[nodeIndex]),
        shadowRoot: shadowRoots.get(nodeIndex) || null,
        clickable: clickable.has(nodeIndex),
        rect: rectOf(layoutIndex === undefined ? null : layout.bounds?.[layoutIndex]),
        paintOrder: layoutIndex === undefined ? null : layout.paintOrders?.[layoutIndex] ?? null,
        styles,
      };
      records.push(record);
      documentRecords[nodeIndex] = record;
      if (Number.isInteger(backendNodeId) && backendNodeId > 0) byBackend.set(backendNodeId, record);
    }
    recordsByDocument.set(documentIndex, documentRecords);
  }
  const viewportRaw = metrics.cssVisualViewport || metrics.cssLayoutViewport || {};
  const viewport = {
    x: Number(viewportRaw.pageX ?? viewportRaw.pageX) || 0,
    y: Number(viewportRaw.pageY ?? viewportRaw.pageY) || 0,
    width: Number(viewportRaw.clientWidth) || 0,
    height: Number(viewportRaw.clientHeight) || 0,
    scale: Number(viewportRaw.scale) || 1,
  };
  for (const record of records) {
    const opacity = record.styles.opacity === "" ? 1 : Number(record.styles.opacity);
    record.visible = !!record.rect && record.rect.width > 0 && record.rect.height > 0
      && record.styles.display !== "none" && record.styles.visibility !== "hidden"
      && Number.isFinite(opacity) && opacity > 0;
    record.viewportRatio = intersectionRatio(record.rect, viewport);
    record.occludedBy = null;
  }
  for (const record of records) {
    if (!record.visible || !record.rect || record.paintOrder === null) continue;
    const centerX = record.rect.x + record.rect.width / 2;
    const centerY = record.rect.y + record.rect.height / 2;
    let blocker = null;
    for (const candidate of records) {
      if (candidate === record || candidate.paintOrder === null || candidate.paintOrder <= record.paintOrder
        || !candidate.visible || candidate.styles["pointer-events"] === "none"
        || !containsPoint(candidate.rect, centerX, centerY)
        || isAncestor(record.documentIndex, record.nodeIndex, candidate, recordsByDocument)
        || isAncestor(candidate.documentIndex, candidate.nodeIndex, record, recordsByDocument)) continue;
      if (!blocker || candidate.paintOrder > blocker.paintOrder) blocker = candidate;
    }
    record.occludedBy = blocker;
  }
  return { records, recordsByDocument, byBackend, viewport, strings, documents: payload.documents || [] };
}

function axStates(node) {
  const states = {};
  for (const property of node.properties || []) {
    if (!AX_STATES.has(property.name)) continue;
    const value = remoteValue(property.value);
    if (value !== undefined) states[property.name] = value;
  }
  return states;
}

function axDescendantText(node, axById) {
  const queue = [...(node.childIds || [])];
  const seen = new Set();
  const values = [];
  while (queue.length && seen.size < 40) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const child = axById.get(id);
    if (!child) continue;
    const role = clipped(remoteValue(child.role), 80);
    const name = clipped(remoteValue(child.name));
    if (["StaticText", "InlineTextBox"].includes(role) && name) values.push(name);
    queue.push(...(child.childIds || []));
  }
  return clipped([...new Set(values)].join(" "));
}

function provenance(mode, source, trust) { return Object.freeze({ mode, source, trust }); }

export class WebCdpSensor {
  constructor({ command, eventCapture = null } = {}) {
    if (typeof command !== "function") throw new TypeError("WebCdpSensor command is required");
    if (eventCapture !== null && typeof eventCapture !== "function") throw new TypeError("WebCdpSensor eventCapture is invalid");
    this.command = command;
    this.eventCapture = eventCapture;
    this.enabledSessions = new Set();
  }

  async capture(sessionRef, options, context = {}) {
    const key = perceptionSessionKey(sessionRef);
    if (!this.enabledSessions.has(key)) {
      await this.command(sessionRef, "Accessibility.enable", {}, context.commandResults || [], context.signal);
      this.enabledSessions.add(key);
    }
    const axCommand = await this.command(sessionRef, "Accessibility.getFullAXTree", {}, context.commandResults || [], context.signal);
    const domCommand = await this.command(sessionRef, "DOMSnapshot.captureSnapshot", {
      computedStyles: APX_WEB_COMPUTED_STYLES,
      includePaintOrder: true,
      includeDOMRects: true,
    }, context.commandResults || [], context.signal);
    const metricsCommand = await this.command(sessionRef, "Page.getLayoutMetrics", {}, context.commandResults || [], context.signal);
    const dom = parseWebDomSnapshot(domCommand.result || {}, metricsCommand.result || {});
    const axNodes = (axCommand.result?.nodes || []).filter((node) => !node.ignored);
    const axById = new Map(axNodes.map((node) => [node.nodeId, node]));
    const nativeByAxId = new Map();
    const sources = [];
    const includedBackends = new Set();
    for (const node of axNodes) {
      const role = clipped(remoteValue(node.role) || "unknown", 80);
      let name = clipped(remoteValue(node.name));
      if (!name && STATUS_ROLES.has(role)) name = axDescendantText(node, axById);
      const description = clipped(remoteValue(node.description));
      const rawValue = remoteValue(node.value);
      if (!role && !name && !description && rawValue === undefined) continue;
      const domNode = dom.byBackend.get(node.backendDOMNodeId);
      const nativeRef = domNode?.nativeRef || `ax:${node.frameId || "main"}:${node.nodeId}`;
      nativeByAxId.set(node.nodeId, nativeRef);
      if (domNode) includedBackends.add(domNode.backendNodeId);
      const states = axStates(node);
      const protectedValue = sensitiveValue(domNode?.attributes || {}, role, rawValue);
      const supported = supportedActions(role, domNode?.nodeName || "", states);
      const reasons = [];
      if (states.disabled === true) reasons.push("disabled");
      if (domNode && !domNode.visible) reasons.push("hidden");
      if (domNode?.viewportRatio === 0) reasons.push("outsideViewport");
      if (domNode?.occludedBy) reasons.push("occluded");
      if (!domNode && supported.length) reasons.push("geometryUnavailable");
      sources.push({
        nativeRef,
        ...(domNode ? { locatorData: { backendNodeId: domNode.backendNodeId } } : {}),
        kind: nodeKind(role, domNode?.nodeName || ""),
        semantic: {
          role,
          ...(name ? { name } : {}),
          ...(description ? { description } : {}),
          ...(rawValue !== undefined ? { value: protectedValue.value } : {}),
          states,
          sensitivity: protectedValue.sensitivity,
        },
        structure: { parentNativeRef: null, frameNativeRef: domNode?.frameNativeRef || `frame:${node.frameId || "main"}`,
          nodeName: domNode?.nodeName || null, shadowRoot: domNode?.shadowRoot || null },
        ...(domNode ? { geometry: {
          ...(domNode.rect ? { rect: domNode.rect } : {}),
          viewportRatio: domNode.viewportRatio,
          paintOrder: domNode.paintOrder,
          visible: domNode.visible,
          occluded: !!domNode.occludedBy,
        } } : {}),
        interaction: { supportedActions: supported, actionable: supported.length > 0 && reasons.length === 0, reasons },
        provenance: {
          semantic: provenance("observed", "cdp.accessibility", "page"),
          ...(domNode ? { geometry: provenance("observed", "cdp.domSnapshot", "browser") } : {}),
          interaction: provenance("derived", "pyproc.actionability", "broker"),
        },
        ...(domNode && ((domNode.nodeName === "CANVAS")
          || ((domNode.nodeName === "IMG" || domNode.clickable) && !name))
          ? { unresolved: { reason: domNode.nodeName === "CANVAS" ? "canvas" : domNode.nodeName === "IMG"
            ? "unlabelledImage" : "unlabelledControl" } } : {}),
      });
    }
    for (const domNode of dom.records) {
      if (includedBackends.has(domNode.backendNodeId) || !domNode.visible || !domNode.rect) continue;
      const unresolvedReason = domNode.nodeName === "CANVAS" ? "canvas"
        : domNode.nodeName === "IMG" ? "unlabelledImage"
          : domNode.clickable ? "unlabelledControl" : null;
      if (!unresolvedReason) continue;
      const role = domNode.nodeName === "CANVAS" ? "canvas" : domNode.nodeName === "IMG" ? "img" : "control";
      const supported = domNode.clickable ? ["focus", "click"] : [];
      sources.push({
        nativeRef: domNode.nativeRef,
        locatorData: { backendNodeId: domNode.backendNodeId },
        kind: nodeKind(role, domNode.nodeName),
        semantic: { role, name: "", states: {}, sensitivity: "public" },
        structure: { parentNativeRef: null, frameNativeRef: domNode.frameNativeRef,
          nodeName: domNode.nodeName, shadowRoot: domNode.shadowRoot },
        geometry: { rect: domNode.rect, viewportRatio: domNode.viewportRatio, paintOrder: domNode.paintOrder,
          visible: domNode.visible, occluded: !!domNode.occludedBy },
        interaction: { supportedActions: supported, actionable: supported.length > 0 && !domNode.occludedBy,
          reasons: domNode.occludedBy ? ["occluded"] : [] },
        provenance: {
          semantic: provenance("observed", "cdp.domSnapshot", "page"),
          geometry: provenance("observed", "cdp.domSnapshot", "browser"),
          interaction: provenance("derived", "pyproc.actionability", "broker"),
        },
        unresolved: { reason: unresolvedReason },
      });
    }
    const sourceByNative = new Map(sources.map((source) => [source.nativeRef, source]));
    const relations = [];
    for (const node of axNodes) {
      const from = nativeByAxId.get(node.nodeId);
      if (!from || !sourceByNative.has(from)) continue;
      let parentId = node.parentId;
      while (parentId && !nativeByAxId.has(parentId)) parentId = axById.get(parentId)?.parentId;
      const parent = nativeByAxId.get(parentId);
      if (parent && sourceByNative.has(parent)) {
        sourceByNative.get(from).structure.parentNativeRef = parent;
        relations.push({ type: "parentOf", fromNativeRef: parent, toNativeRef: from,
          provenance: provenance("observed", "cdp.accessibility", "page") });
        relations.push({ type: "childOf", fromNativeRef: from, toNativeRef: parent,
          provenance: provenance("observed", "cdp.accessibility", "page") });
      }
      for (const property of node.properties || []) {
        const type = RELATION_TYPES[property.name];
        if (!type) continue;
        for (const related of property.value?.relatedNodes || []) {
          const target = dom.byBackend.get(related.backendDOMNodeId)?.nativeRef;
          if (!target || !sourceByNative.has(target)) continue;
          relations.push({ type, fromNativeRef: from, toNativeRef: target,
            provenance: provenance("observed", "cdp.accessibility", "page") });
        }
      }
    }
    for (const source of sources) {
      const domNode = source.locatorData ? dom.byBackend.get(source.locatorData.backendNodeId) : null;
      const blockerNative = domNode?.occludedBy?.nativeRef;
      if (blockerNative && sourceByNative.has(blockerNative)) relations.push({
        type: "occludedBy", fromNativeRef: source.nativeRef, toNativeRef: blockerNative,
        provenance: provenance("derived", "pyproc.spatial", "broker"),
      });
    }
    let capturedEvents = {};
    if (this.eventCapture) capturedEvents = await this.eventCapture(sessionRef, {
      includeConsole: options.channels.includes("events"),
      includeNetwork: options.channels.includes("networkMetadata"),
      maxEvents: 100,
    }, context.commandResults || [], context.signal);
    const rootDocument = dom.documents[0] || {};
    const pageUrl = redactBrowserUrl(axCommand.target?.url || stringAt(dom.strings, rootDocument.documentURL));
    return Object.freeze({
      documentEpoch: Number(axCommand.contextEpoch) || 0,
      page: Object.freeze({
        url: pageUrl,
        title: clipped(stringAt(dom.strings, rootDocument.title), 500),
        viewport: Object.freeze({ width: dom.viewport.width, height: dom.viewport.height, scale: dom.viewport.scale }),
        scroll: Object.freeze({ x: dom.viewport.x, y: dom.viewport.y }),
      }),
      entities: Object.freeze(sources),
      relations: Object.freeze(relations),
      events: Object.freeze([...(capturedEvents.console || []), ...(capturedEvents.network || [])]),
      completeness: Object.freeze({ semantic: "complete", structure: "complete", geometry: "complete",
        interaction: "complete", network: options.channels.includes("networkMetadata") ? "metadata-only" : "notRequested" }),
    });
  }

  dropSession(sessionRef) { this.enabledSessions.delete(perceptionSessionKey(sessionRef)); }
  close() { this.enabledSessions.clear(); }
}
