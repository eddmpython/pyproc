// frameSpaceTools.js - FrameSpace가 제공하는 MCP 이름과 strict input schema.
import { FRAME_SPACE_ACTION_RISKS } from "./frameSpace.js";
import { APX_OBSERVE_PROPERTIES } from "../perception/apxCatalog.js";
import { APX_ACTION_CONTEXT_SCHEMA } from "../perception/situationCatalog.js";

const TARGET_PROPERTIES = Object.freeze({
  selector: { type: "string", minLength: 1, maxLength: 2000 },
  locatorRef: { type: "string", minLength: 1, maxLength: 200 },
  timeoutMs: { type: "integer", minimum: 1, maximum: 30000 },
});

export const FRAME_SESSION_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    protocolVersion: { type: "string", const: "1" },
    spaceId: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 },
    targetRef: { type: "string", minLength: 1 },
  }),
  required: Object.freeze(["protocolVersion", "spaceId", "sessionId", "targetRef"]),
  additionalProperties: false,
});

function targetRule() {
  return Object.freeze({ oneOf: Object.freeze([
    Object.freeze({ required: Object.freeze(["selector"]), not: Object.freeze({ required: Object.freeze(["locatorRef"]) }) }),
    Object.freeze({ required: Object.freeze(["locatorRef"]), not: Object.freeze({ required: Object.freeze(["selector"]) }) }),
  ]) });
}

function actionSchema(name) {
  const risk = FRAME_SPACE_ACTION_RISKS[name];
  const properties = {
    kind: { type: "string", const: name },
    expectedRisk: { type: "string", const: risk },
    ...(risk === "externalEffect" ? { actionContext: APX_ACTION_CONTEXT_SCHEMA } : {}),
  };
  const required = ["kind", "expectedRisk"];
  if (["waitFor", "click", "focus", "fill", "press", "select", "check", "uncheck", "scroll"].includes(name)) {
    Object.assign(properties, TARGET_PROPERTIES);
  }
  if (name === "snapshot") Object.assign(properties, {
    maxNodes: { type: "integer", minimum: 1, maximum: 1000 },
    mode: { type: "string", enum: ["all", "interactive"] },
  });
  if (name === "screenshot") properties.inline = { type: "boolean" };
  if (name === "waitFor") properties.state = { type: "string",
    enum: ["attached", "detached", "visible", "hidden", "enabled", "disabled", "editable"] };
  if (name === "navigate") {
    properties.url = { type: "string", format: "uri", minLength: 1, maxLength: 10000 };
    required.push("url");
  }
  if (name === "fill") {
    properties.value = { type: "string", maxLength: 100000 };
    required.push("value");
  }
  if (name === "press") {
    properties.key = { type: "string", minLength: 1, maxLength: 100 };
    required.push("key");
  }
  if (name === "select") {
    properties.value = { type: "string", maxLength: 10000 };
    properties.values = { type: "array", items: { type: "string", maxLength: 10000 }, minItems: 1, maxItems: 100 };
  }
  if (name === "scroll") {
    properties.block = { type: "string", enum: ["start", "center", "end", "nearest"] };
    properties.inline = { type: "string", enum: ["start", "center", "end", "nearest"] };
  }
  return Object.freeze({ type: "object", properties: Object.freeze(properties), required: Object.freeze(required),
    additionalProperties: false, ...(["waitFor", "click", "focus", "fill", "press", "select", "check", "uncheck", "scroll"].includes(name)
      ? targetRule() : {}) });
}

export function createFrameSpaceTools(config) {
  const tools = [
    { name: "browserInspect", description: "Inspect the cooperative FrameSpace permission, isolation, and action catalog.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "browserListTargets", description: "List sandbox targets opened inside this FrameSpace.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "browserOpen", description: "Open an allowed cooperative page in a credentialless sandbox frame.",
      inputSchema: { type: "object", properties: {
        url: { type: "string", format: "uri", minLength: 1, maxLength: 10000 },
        expectedRisk: { type: "string", const: "externalEffect" },
        waitUntil: { type: "string", enum: ["commit", "domcontentloaded", "load"] },
      }, required: ["url", "expectedRisk"], additionalProperties: false } },
    { name: "browserAttach", description: "Create an opaque session for a FrameSpace target.",
      inputSchema: { type: "object", properties: { targetRef: { type: "string", minLength: 1 } },
        required: ["targetRef"], additionalProperties: false } },
    { name: "browserClose", description: "Close one FrameSpace target created by this provider.",
      inputSchema: { type: "object", properties: { targetRef: { type: "string", minLength: 1 },
        expectedRisk: { type: "string", const: "externalEffect" } },
      required: ["targetRef", "expectedRisk"], additionalProperties: false } },
    { name: "browserDetach", description: "Detach a FrameSpace session.",
      inputSchema: { type: "object", properties: { sessionRef: FRAME_SESSION_SCHEMA },
        required: ["sessionRef"], additionalProperties: false } },
  ];
  if (config.actions.includes("snapshot")) tools.push({
    name: "browserObserve", description: "Capture a legacy semantic snapshot or an opt-in bounded APX graph from a cooperative target.",
    inputSchema: { type: "object", properties: {
      sessionRef: FRAME_SESSION_SCHEMA,
      expectedRisk: { type: "string", const: "read" },
      maxNodes: { type: "integer", minimum: 1, maximum: 1000 },
      mode: { type: "string", enum: ["all", "interactive"] },
      includeScreenshot: { type: "boolean" },
      ...APX_OBSERVE_PROPERTIES,
    }, required: ["sessionRef", "expectedRisk"], additionalProperties: false },
  });
  tools.push({
    name: "browserAct", description: "Run up to 16 ordered cooperative DOM actions and stop at the first failure.",
    inputSchema: { type: "object", properties: {
      sessionRef: FRAME_SESSION_SCHEMA,
      actions: { type: "array", items: { oneOf: config.actions.map(actionSchema) }, minItems: 1, maxItems: 16 },
    }, required: ["sessionRef", "actions"], additionalProperties: false },
  }, {
    name: "browserArtifactRead", description: "Read one bounded base64 chunk from a FrameSpace screenshot artifact.",
    inputSchema: { type: "object", properties: {
      artifactRef: { type: "string", pattern: "^artifact:[A-Za-z0-9_-]+$", minLength: 10, maxLength: 105 },
      offset: { type: "integer", minimum: 0 },
      maxBytes: { type: "integer", minimum: 1, maximum: 256 * 1024 },
    }, required: ["artifactRef"], additionalProperties: false },
  }, {
    name: "browserArtifactDelete", description: "Delete one FrameSpace screenshot artifact before its TTL expires.",
    inputSchema: { type: "object", properties: {
      artifactRef: { type: "string", pattern: "^artifact:[A-Za-z0-9_-]+$", minLength: 10, maxLength: 105 },
    }, required: ["artifactRef"], additionalProperties: false },
  });
  return Object.freeze(tools.map((tool) => Object.freeze(tool)));
}
