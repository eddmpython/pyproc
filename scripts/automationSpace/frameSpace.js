// frameSpace.js - credentialless sandbox page bridge를 AutomationSpace 계약으로 노출한다.
import { BROWSER_CONTROL_RISKS } from "../browserControl/browserControlPolicy.js";
import {
  APX_LEGACY_REPRESENTATION,
  APX_OBSERVE_OPTION_KEYS,
  APX_REPRESENTATION,
  perceptionOptionsFromInput,
  validatePerceptionOptions,
} from "../perception/apxCatalog.js";
import { APX_SITUATION_REPRESENTATION, validateActionContext } from "../perception/situationCatalog.js";
import { ActionEvidenceLoop } from "../perception/actionEvidence.js";
import { ActionConvergence, shouldReobserveAction } from "../perception/actionConvergence.js";
import { PerceptionSpace } from "../perception/perceptionSpace.js";
import { FrameSensor } from "../perception/profiles/frameSensor.js";

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
  "automation.target.close",
  "automation.session.attach",
  "automation.session.detach",
  "automation.observe",
  "automation.act",
  "artifact.read",
  "artifact.delete",
]);
const TARGET_ACTIONS = new Set(["waitFor", "click", "focus", "fill", "press", "select", "check", "uncheck", "scroll"]);
const ARTIFACT_REF = /^artifact:[A-Za-z0-9_-]+$/;
const LEGACY_OBSERVE_KEYS = Object.freeze(["maxNodes", "mode", "includeScreenshot", "continuationRef"]);

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
  constructor({ pageBridge, config, spaceId = "space:frame", idFactory = () => crypto.randomUUID() } = {}) {
    if (!pageBridge || typeof pageBridge.dispatch !== "function" || typeof pageBridge.waitForReady !== "function") {
      throw new TypeError("FrameSpace pageBridge is required");
    }
    this.config = assertFrameSpaceConfig(config);
    this.spaceId = spaceId;
    this.providerKind = "frame";
    this.capabilities = Object.freeze(["dom", "target", "screenshot", "artifact", "perception", "actionEvidence",
      "actionConvergence"]);
    this.operations = Object.freeze(FRAME_OPERATIONS.filter((operation) => operation !== "automation.observe"
      || this.config.actions.includes("snapshot")));
    this.replayBoundary = "recordOnly";
    this.pageBridge = pageBridge;
    this._perception = new PerceptionSpace({
      sensor: new FrameSensor({
        dispatch: (operation, input, context) => this.pageBridge.dispatch(operation, input, context),
        idFactory,
      }),
      idFactory,
      locatorIssuer: (sessionRef, documentEpoch, locatorData) => locatorData.locatorRef || null,
      providerKind: "frame",
      conformanceLevel: "L3",
      capabilityPolicy: ({ action }) => this.config.actions.includes(action)
        ? { risk: FRAME_SPACE_ACTION_RISKS[action], destination: null }
        : null,
    });
    this._evidence = new ActionEvidenceLoop({ idFactory });
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
    if (operation === "automation.target.open" || operation === "automation.target.close") {
      if (input.expectedRisk !== "externalEffect") {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", "target lifecycle requires expectedRisk externalEffect");
      }
      if (BROWSER_CONTROL_RISKS.externalEffect > BROWSER_CONTROL_RISKS[this.config.maxRisk]) {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", `target open exceeds max risk ${this.config.maxRisk}`);
      }
      if (operation === "automation.target.open") this._assertAllowedUrl(input.url);
    }
    if (operation === "automation.observe") {
      if (input.expectedRisk !== "read") {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", "observe requires expectedRisk read");
      }
      const apxKeys = APX_OBSERVE_OPTION_KEYS.filter((key) => key !== "representation" && input[key] !== undefined);
      if ([APX_REPRESENTATION, APX_SITUATION_REPRESENTATION].includes(input.representation)) {
        const legacyKey = LEGACY_OBSERVE_KEYS.find((key) => input[key] !== undefined);
        if (legacyKey) throw frameError("FRAME_SPACE_ACTION_INVALID", `APX observe does not accept ${legacyKey}`);
        validatePerceptionOptions(perceptionOptionsFromInput(input));
      } else if (input.representation !== undefined && input.representation !== APX_LEGACY_REPRESENTATION) {
        throw frameError("FRAME_SPACE_ACTION_INVALID", "observe representation is invalid");
      } else if (apxKeys.length) {
        throw frameError("FRAME_SPACE_ACTION_INVALID", `legacy observe does not accept ${apxKeys[0]}`);
      }
      if (input.continuationRef !== undefined) {
        if (typeof input.continuationRef !== "string" || !/^continuation:[A-Za-z0-9_-]+$/u.test(input.continuationRef)) {
          throw frameError("FRAME_SPACE_ACTION_INVALID", "observe continuationRef is invalid");
        }
        const incompatible = ["maxNodes", "mode", "includeScreenshot", "representation"]
          .find((key) => input[key] !== undefined);
        if (incompatible) throw frameError("FRAME_SPACE_ACTION_INVALID",
          `observe continuation does not accept ${incompatible}`);
      }
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
    if (operation === "automation.observe"
      && [APX_REPRESENTATION, APX_SITUATION_REPRESENTATION].includes(input.representation)) {
      return this._perception.observe(input.sessionRef, perceptionOptionsFromInput(input), { signal });
    }
    if (operation === "automation.act" && input.actions.some((action) => action.verify || action.actionContext)) {
      return this._act(input, { signal, requestId });
    }
    if (operation === "automation.act") {
      for (const action of input.actions) {
        if (action.actionContext) this._perception.assertActionContext(input.sessionRef, action.actionContext, action);
      }
    }
    const output = await this.pageBridge.dispatch(operation, input, {
      signal,
      requestId: typeof requestId === "string" && requestId ? requestId : `frame:${++this._sequence}`,
    });
    if (operation === "automation.space.inspect") {
      const perception = this._perception.inspect();
      return Object.freeze({ ...output, targetOrigins: Object.freeze([...this.config.targetOrigins]),
        viewport: this.config.viewport, compatibility: Object.freeze({ family: "chromium", version: "embedded" }),
        perception,
        resources: Object.freeze({ ...output.resources, perception: perception.resources }) });
    }
    if (operation === "automation.session.detach") this._perception.dropSession(input.sessionRef);
    return output;
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    this._perception.close();
  }

  assertActionContext(sessionRef, actionContext, action) {
    return this._perception.assertActionContext(sessionRef, actionContext, action);
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
      if (action?.actionContext !== undefined) validateActionContext(action.actionContext);
      if (!action || typeof action !== "object" || Array.isArray(action)
        || !this.config.actions.includes(action.kind)) {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", `FrameSpace action is outside permission: ${action?.kind}`);
      }
      const risk = FRAME_SPACE_ACTION_RISKS[action.kind];
      if (action.expectedRisk !== risk || BROWSER_CONTROL_RISKS[risk] > BROWSER_CONTROL_RISKS[this.config.maxRisk]) {
        throw frameError("FRAME_SPACE_PERMISSION_DENIED", `FrameSpace action risk mismatch: ${action.kind}`);
      }
      if (action.kind === "navigate") this._assertAllowedUrl(action.url);
      if (action.kind === "snapshot" && action.continuationRef !== undefined) {
        if (typeof action.continuationRef !== "string"
          || !/^continuation:[A-Za-z0-9_-]+$/u.test(action.continuationRef)) {
          throw frameError("FRAME_SPACE_ACTION_INVALID", "snapshot continuationRef is invalid");
        }
        const incompatible = ["maxNodes", "mode"].find((key) => action[key] !== undefined);
        if (incompatible) throw frameError("FRAME_SPACE_ACTION_INVALID",
          `snapshot continuation does not accept ${incompatible}`);
      }
      if (TARGET_ACTIONS.has(action.kind)) {
        const targetCount = Number(typeof action.selector === "string" && !!action.selector)
          + Number(typeof action.locatorRef === "string" && !!action.locatorRef);
        if (targetCount !== 1) throw frameError("FRAME_SPACE_ACTION_INVALID",
          `${action.kind} requires exactly one selector or locatorRef`);
      }
    }
  }

  async _act(input, { signal, requestId } = {}) {
    const completed = [];
    const results = [];
    for (let index = 0; index < input.actions.length; index += 1) {
      const action = input.actions[index];
      const convergence = action.actionContext ? new ActionConvergence({ signal }) : null;
      try {
        const perform = async (candidate) => {
          if (candidate.actionContext) {
            this._perception.assertActionContext(input.sessionRef, candidate.actionContext, candidate);
          }
          const { verify, actionContext: _actionContext, ...providerAction } = candidate;
          const actionSignal = convergence?.signal || signal;
          const effect = async () => {
            const output = await this.pageBridge.dispatch("automation.act", {
              sessionRef: input.sessionRef, actions: [providerAction],
            }, { signal: actionSignal, requestId: `${requestId || "frame"}:effect:${index}` });
            const { effectSent, ...effectResult } = output.results[0] || {};
            if (effectSent === true) convergence?.markEffectAttempt();
            return Object.freeze(effectResult);
          };
          return verify ? this._evidence.run({
            actionRef: `action:${crypto.randomUUID()}`,
            postcondition: verify,
            signal: actionSignal,
            capture: ({ since }) => this._perception.observe(input.sessionRef, {
              representation: APX_REPRESENTATION,
              ...(since ? { since } : {}),
              channels: ["semantic", "structure", "geometry", "interaction", "events"],
              visual: { mode: "off" },
              budget: { maxEntities: 500, maxRelations: 1000, maxBytes: 512 * 1024 },
            }, { signal: actionSignal, issueLocators: false }),
            effect,
          }) : { effectResult: await effect(), evidence: null };
        };
        let result;
        try {
          result = await perform(action);
        } catch (error) {
          if (error?.details?.effectSent === true) convergence?.markEffectAttempt();
          if (!convergence || !shouldReobserveAction(error)) throw error;
          convergence.recordActionability(error.actionability || error.details?.actionability);
          convergence.beginReobservation();
          const reissued = await this._perception.reissueAction(input.sessionRef, action,
            { signal: convergence.signal });
          convergence.adoptBinding(reissued.convergence);
          result = await perform(reissued.action);
        }
        const receipt = convergence?.success(result.effectResult) || null;
        completed.push(Object.freeze({ index, kind: action.kind }));
        results.push(Object.freeze({ ...(result.effectResult || {}),
          ...(result.evidence ? { evidence: result.evidence } : {}),
          ...(receipt ? { convergence: receipt } : {}) }));
        convergence?.close();
      } catch (error) {
        const failure = convergence && !error.convergence ? convergence.failure(error) : error;
        failure.failedActionIndex = index;
        failure.completed = Object.freeze([...completed]);
        convergence?.close();
        throw failure;
      }
    }
    return Object.freeze({ completed: Object.freeze(completed), results: Object.freeze(results) });
  }
}
