// frameSpace.js - credentialless sandbox page bridge를 AutomationSpace 계약으로 노출한다.
import { BROWSER_CONTROL_RISKS } from "../browserControl/browserControlPolicy.js";

export const FRAME_SPACE_ACTION_RISKS = Object.freeze({
  snapshot: "read",
  screenshot: "read",
  waitFor: "read",
  navigate: "externalEffect",
  click: "externalEffect",
  focus: "externalEffect",
  fill: "externalEffect",
  press: "externalEffect",
  select: "externalEffect",
  check: "externalEffect",
  uncheck: "externalEffect",
  scroll: "externalEffect",
});

const FRAME_OPERATIONS = Object.freeze([
  "automation.space.inspect",
  "automation.target.list",
  "automation.target.open",
  "automation.session.attach",
  "automation.session.detach",
  "automation.observe",
  "automation.act",
  "artifact.read",
  "artifact.delete",
]);
const TARGET_ACTIONS = new Set(["waitFor", "click", "focus", "fill", "press", "select", "check", "uncheck", "scroll"]);
const ARTIFACT_REF = /^artifact:[A-Za-z0-9_-]+$/;

function frameError(code, message, outcome = "notSent") {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  return error;
}

function exactOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch (error) { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  return url.origin;
}

export function assertFrameSpaceConfig(config) {
  if (!config || typeof config !== "object") throw new TypeError("FrameSpace config is required");
  if (!Array.isArray(config.targetOrigins) || config.targetOrigins.length < 1) {
    throw new TypeError("FrameSpace requires at least one exact target origin");
  }
  if (!Array.isArray(config.actions) || config.actions.length < 1) throw new TypeError("FrameSpace actions are required");
  for (const action of config.actions) {
    if (!Object.hasOwn(FRAME_SPACE_ACTION_RISKS, action)) throw new TypeError(`FrameSpace action is unsupported: ${action}`);
  }
  if (Array.isArray(config.rawMethods) && config.rawMethods.length) {
    throw new TypeError("FrameSpace does not accept raw browser methods");
  }
  if (!Object.hasOwn(BROWSER_CONTROL_RISKS, config.maxRisk)) throw new TypeError("FrameSpace maxRisk is invalid");
  return config;
}

export class FrameSpace {
  constructor({ pageBridge, config, spaceId = "space:frame" } = {}) {
    if (!pageBridge || typeof pageBridge.dispatch !== "function" || typeof pageBridge.waitForReady !== "function") {
      throw new TypeError("FrameSpace pageBridge is required");
    }
    this.config = assertFrameSpaceConfig(config);
    this.spaceId = spaceId;
    this.providerKind = "frame";
    this.capabilities = Object.freeze(["dom", "target", "screenshot", "artifact"]);
    this.operations = Object.freeze(FRAME_OPERATIONS.filter((operation) => operation !== "automation.observe"
      || this.config.actions.includes("snapshot")));
    this.replayBoundary = "recordOnly";
    this.pageBridge = pageBridge;
    this._authorities = new WeakSet();
    this._sequence = 0;
    this._closed = false;
  }

  authorize(operation, input = {}) {
    if (this._closed) throw frameError("AUTOMATION_SPACE_CLOSED", "FrameSpace is closed");
    if (!this.operations.includes(operation)) {
      throw frameError("AUTOMATION_SPACE_OPERATION_UNSUPPORTED", `FrameSpace operation is unsupported: ${operation}`);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("FrameSpace input must be an object");
    if (operation === "automation.target.open") {
      if (input.expectedRisk !== "externalEffect") {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", "target open requires expectedRisk externalEffect");
      }
      if (BROWSER_CONTROL_RISKS.externalEffect > BROWSER_CONTROL_RISKS[this.config.maxRisk]) {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", `target open exceeds max risk ${this.config.maxRisk}`);
      }
      this._assertAllowedUrl(input.url);
    }
    if (operation === "automation.observe" && input.expectedRisk !== "read") {
      throw frameError("FRAME_SPACE_PERMISSION_DENIED", "observe requires expectedRisk read");
    }
    if (operation === "automation.act") this._assertActions(input.actions);
    if ((operation === "artifact.read" || operation === "artifact.delete") && !ARTIFACT_REF.test(String(input.artifactRef || ""))) {
      throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "artifactRef is invalid");
    }
    const authority = Object.freeze({ operation });
    this._authorities.add(authority);
    return authority;
  }

  async execute(operation, input, { signal, requestId, authority } = {}) {
    if (!authority || !this._authorities.has(authority) || authority.operation !== operation) {
      throw frameError("FRAME_SPACE_PERMISSION_DENIED", "FrameSpace operation requires a current authorization token");
    }
    this._authorities.delete(authority);
    return this.pageBridge.dispatch(operation, input, {
      signal,
      requestId: typeof requestId === "string" && requestId ? requestId : `frame:${++this._sequence}`,
    });
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
  }

  _assertAllowedUrl(value) {
    const origin = exactOrigin(value);
    if (!origin || !this.config.targetOrigins.includes(origin)) {
      throw frameError("FRAME_SPACE_PERMISSION_DENIED", `target origin is outside FrameSpace permission: ${value}`);
    }
  }

  _assertActions(actions) {
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 16) {
      throw frameError("FRAME_SPACE_ACTION_INVALID", "FrameSpace requires 1 to 16 actions");
    }
    for (const action of actions) {
      if (!action || typeof action !== "object" || Array.isArray(action)
        || !this.config.actions.includes(action.kind)) {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", `FrameSpace action is outside permission: ${action?.kind}`);
      }
      const risk = FRAME_SPACE_ACTION_RISKS[action.kind];
      if (action.expectedRisk !== risk || BROWSER_CONTROL_RISKS[risk] > BROWSER_CONTROL_RISKS[this.config.maxRisk]) {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", `FrameSpace action risk mismatch: ${action.kind}`);
      }
      if (action.kind === "navigate") this._assertAllowedUrl(action.url);
      if (TARGET_ACTIONS.has(action.kind)) {
        const targetCount = Number(typeof action.selector === "string" && !!action.selector)
          + Number(typeof action.locatorRef === "string" && !!action.locatorRef);
        if (targetCount !== 1) throw frameError("FRAME_SPACE_ACTION_INVALID",
          `${action.kind} requires exactly one selector or locatorRef`);
      }
    }
  }
}
