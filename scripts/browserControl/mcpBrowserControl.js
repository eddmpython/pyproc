// mcpBrowserControl.js - browser env config, MCP schema, dispatch adapter의 SSOT.
import { BrowserAutomation } from "./browserAutomation.js";
import {
  BROWSER_AUTOMATION_ACTIONS,
  BROWSER_AUTOMATION_DEFAULT_ACTIONS,
  BROWSER_AUTOMATION_DEFAULT_MAX_NODES,
  BROWSER_AUTOMATION_MAX_ACTIONS,
  BROWSER_AUTOMATION_MAX_NODES,
  assertBrowserAutomationRisk,
  createBrowserActionSchema,
  inspectBrowserAutomationActions,
} from "./browserAutomationCatalog.js";
import { connectNodeBrowserControl } from "./browserControlBroker.mjs";
import {
  BROWSER_CONTROL_COMMAND_RISKS,
  BROWSER_CONTROL_DEFAULT_READ_METHODS,
  BROWSER_CONTROL_RISKS,
} from "./browserControlPolicy.js";
import { BrowserControlError, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";
import { BROWSER_OBSERVATION_MAX_EVENTS } from "./browserObservationCatalog.js";
import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const EXTERNAL_EFFECT_ACK = "acknowledged";

export const BROWSER_SESSION_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    protocolVersion: { type: "string", const: "1" },
    brokerId: { type: "string", minLength: 1 },
    brokerEpoch: { type: "integer", minimum: 1 },
    sessionId: { type: "string", minLength: 1 },
    targetRef: { type: "string", minLength: 1 },
  }),
  required: Object.freeze(["protocolVersion", "brokerId", "brokerEpoch", "sessionId", "targetRef"]),
  additionalProperties: false,
});

function csv(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function permissionError(message) {
  return new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.permissionDenied, message, { outcome: "notSent" });
}

function parsePurpose(value) {
  const purpose = String(value || "").trim();
  if (!purpose) return "";
  if (purpose.length > 200 || /[\u0000-\u001f\u007f]/.test(purpose)) {
    throw new Error("PYPROC_BROWSER_PURPOSE must be printable text up to 200 characters");
  }
  return purpose;
}

function parseOrigins(value) {
  const origins = [];
  for (const entry of csv(value)) {
    const parsed = new URL(entry);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username || parsed.password || parsed.href !== parsed.origin + "/") {
      throw new Error(`browser origin must be an exact HTTP(S) origin: ${entry}`);
    }
    origins.push(parsed.origin);
  }
  return unique(origins);
}

function parseFileRoots(value) {
  const roots = String(value || "").split(delimiter).map((entry) => entry.trim()).filter(Boolean);
  const verified = roots.map((root) => {
    if (!isAbsolute(root)) throw new Error(`browser file root must be absolute: ${root}`);
    let present;
    try { present = realpathSync(resolve(root)); }
    catch (error) { throw new Error(`browser file root is unavailable: ${root}`); }
    if (!statSync(present).isDirectory()) throw new Error(`browser file root must be a directory: ${root}`);
    return present;
  });
  return unique(verified);
}

function validateMethods(methods, maxRisk, label) {
  for (const method of methods) {
    if (!Object.hasOwn(BROWSER_CONTROL_COMMAND_RISKS, method)) throw new Error(`unclassified ${label} entry: ${method}`);
    const risk = BROWSER_CONTROL_COMMAND_RISKS[method];
    if (BROWSER_CONTROL_RISKS[risk] > BROWSER_CONTROL_RISKS[maxRisk]) {
      throw new Error(`${label} ${method} exceeds max risk ${maxRisk}`);
    }
  }
}

export function parseBrowserControlConfig(env = process.env, { timeoutMs = 180000 } = {}) {
  const maxRisk = env.PYPROC_BROWSER_MAX_RISK || "read";
  if (!Object.hasOwn(BROWSER_CONTROL_RISKS, maxRisk)) throw new Error(`invalid PYPROC_BROWSER_MAX_RISK: ${maxRisk}`);
  const requestedRawMethods = csv(env.PYPROC_BROWSER_METHODS);
  const rawMethods = unique(requestedRawMethods.length ? requestedRawMethods : BROWSER_CONTROL_DEFAULT_READ_METHODS);
  validateMethods(rawMethods, maxRisk, "PYPROC_BROWSER_METHODS");
  const requestedActions = csv(env.PYPROC_BROWSER_ACTIONS);
  const actions = unique(requestedActions.length ? requestedActions : BROWSER_AUTOMATION_DEFAULT_ACTIONS);
  assertBrowserAutomationRisk(actions, maxRisk);
  const actionMethods = unique(actions.flatMap((name) => BROWSER_AUTOMATION_ACTIONS[name].methods));
  const events = unique(actions.flatMap((name) => BROWSER_AUTOMATION_ACTIONS[name].events));
  validateMethods(actionMethods, maxRisk, "PYPROC_BROWSER_ACTIONS required method");
  const purpose = parsePurpose(env.PYPROC_BROWSER_PURPOSE);
  const externalEffectsAcknowledged = env.PYPROC_BROWSER_EXTERNAL_EFFECTS === EXTERNAL_EFFECT_ACK;
  if (maxRisk === "externalEffect" && (!externalEffectsAcknowledged || !purpose)) {
    throw new Error("externalEffect requires PYPROC_BROWSER_EXTERNAL_EFFECTS=acknowledged and PYPROC_BROWSER_PURPOSE");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("browser control timeoutMs must be positive");
  const fileRoots = parseFileRoots(env.PYPROC_BROWSER_FILE_ROOTS);
  if ((actions.includes("upload") || rawMethods.includes("DOM.setFileInputFiles")) && fileRoots.length < 1) {
    throw new Error("browser file upload requires PYPROC_BROWSER_FILE_ROOTS");
  }
  return Object.freeze({
    targetOrigins: Object.freeze(parseOrigins(env.PYPROC_BROWSER_ALLOWED_ORIGINS)),
    rawMethods: Object.freeze(rawMethods),
    actions: Object.freeze(actions),
    methods: Object.freeze(unique([...rawMethods, ...actionMethods])),
    events: Object.freeze(events),
    fileRoots: Object.freeze(fileRoots),
    maxRisk,
    timeoutMs,
    purpose,
    externalEffectsAcknowledged,
  });
}

function browserBaseTools() {
  return [
    {
      name: "browserInspect",
      description: "Inspect the active browser permission and high-level action catalog without exposing CDP endpoint IDs.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "browserListTargets",
      description: "List only browser targets allowed by the exact-origin permission manifest.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "browserOpen",
      description: "Open an allowed HTTP(S) URL in the isolated automation profile. Requires explicit external-effect acknowledgement.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          expectedRisk: { type: "string", const: "externalEffect" },
        },
        required: ["url", "expectedRisk"],
        additionalProperties: false,
      },
    },
    {
      name: "browserAttach",
      description: "Attach to an opaque target reference returned by browserListTargets or browserOpen.",
      inputSchema: {
        type: "object",
        properties: { targetRef: { type: "string", minLength: 1 } },
        required: ["targetRef"],
        additionalProperties: false,
      },
    },
    {
      name: "browserCommand",
      description: "Send a separately raw-allowlisted CDP command. High-level action methods do not grant raw command access.",
      inputSchema: {
        type: "object",
        properties: {
          sessionRef: BROWSER_SESSION_SCHEMA,
          method: { type: "string", minLength: 1 },
          params: { type: "object" },
          expectedRisk: { type: "string", enum: ["read", "mutate", "externalEffect"] },
        },
        required: ["sessionRef", "method", "expectedRisk"],
        additionalProperties: false,
      },
    },
    {
      name: "browserDetach",
      description: "Detach a broker-scoped browser session and invalidate its opaque locators.",
      inputSchema: {
        type: "object",
        properties: { sessionRef: BROWSER_SESSION_SCHEMA },
        required: ["sessionRef"],
        additionalProperties: false,
      },
    },
  ];
}

export function createBrowserControlTools(config) {
  const tools = browserBaseTools();
  if (config.actions.includes("snapshot")) {
    tools.push({
      name: "browserObserve",
      description: "Capture a compact accessibility snapshot in one observation command and return opaque locators.",
      inputSchema: {
        type: "object",
        properties: {
          sessionRef: BROWSER_SESSION_SCHEMA,
          expectedRisk: { type: "string", const: "read" },
          maxNodes: { type: "integer", minimum: 1, maximum: BROWSER_AUTOMATION_MAX_NODES },
          includeScreenshot: { type: "boolean" },
          includeConsole: { type: "boolean" },
          includeNetwork: { type: "boolean" },
          maxEvents: { type: "integer", minimum: 1, maximum: BROWSER_OBSERVATION_MAX_EVENTS },
        },
        required: ["sessionRef", "expectedRisk"],
        additionalProperties: false,
      },
    });
  }
  tools.push({
    name: "browserAct",
    description: `Run 1 to ${BROWSER_AUTOMATION_MAX_ACTIONS} ordered high-level actions in one MCP call. Stops on the first failure and reports the completed prefix.`,
    inputSchema: {
      type: "object",
      properties: {
        sessionRef: BROWSER_SESSION_SCHEMA,
        actions: {
          type: "array",
          items: createBrowserActionSchema(config.actions),
          minItems: 1,
          maxItems: BROWSER_AUTOMATION_MAX_ACTIONS,
        },
      },
      required: ["sessionRef", "actions"],
      additionalProperties: false,
    },
  });
  return Object.freeze(tools.map((tool) => Object.freeze(tool)));
}

function defaultAuditWriter(record) {
  process.stderr.write(`pyproc browser audit: ${JSON.stringify(record)}\n`);
}

export class McpBrowserControl {
  constructor({ profileDir, config, brokerFactory = connectNodeBrowserControl, auditWriter = defaultAuditWriter } = {}) {
    if (!profileDir || typeof profileDir !== "string") throw new TypeError("browser MCP profileDir is required");
    if (!config || typeof config !== "object") throw new TypeError("browser MCP config is required");
    if (typeof brokerFactory !== "function") throw new TypeError("browser MCP brokerFactory is required");
    if (typeof auditWriter !== "function") throw new TypeError("browser MCP auditWriter is required");
    this.config = config;
    this.tools = createBrowserControlTools(config);
    this._toolNames = new Set(this.tools.map((tool) => tool.name));
    this._rawMethods = new Set(config.rawMethods);
    this._brokerPromise = null;
    this._automation = null;
    this._profileDir = profileDir;
    this._brokerFactory = brokerFactory;
    this._auditWriter = auditWriter;
  }

  async invoke(tool, args = {}, { signal } = {}) {
    if (!this._toolNames.has(tool)) throw new Error(`unknown browser tool: ${tool}`);
    if (tool === "browserOpen" && args.expectedRisk !== "externalEffect") {
      throw permissionError("browserOpen requires expectedRisk externalEffect");
    }
    if (tool === "browserCommand") {
      if (!this._rawMethods.has(args.method)) throw permissionError(`raw browser command is outside permission: ${args.method}`);
      if (!Object.hasOwn(BROWSER_CONTROL_RISKS, args.expectedRisk)) {
        throw permissionError("browserCommand requires expectedRisk: read, mutate, or externalEffect");
      }
    }
    if (tool === "browserObserve" && args.expectedRisk !== "read") {
      throw permissionError("browserObserve requires expectedRisk read");
    }
    const { broker, automation } = await this._ready();
    if (tool === "browserInspect") {
      return Object.freeze({
        ...broker.inspect(),
        automation: automation.inspect(),
        rawMethods: this.config.rawMethods,
        purposeDeclared: !!this.config.purpose,
        externalEffectsAcknowledged: this.config.externalEffectsAcknowledged,
      });
    }
    if (tool === "browserListTargets") return broker.listTargets();
    if (tool === "browserOpen") {
      this._audit({ kind: "open", risk: "externalEffect", state: "attempted" });
      const target = await broker.openTarget(args.url);
      this._audit({ kind: "open", risk: "externalEffect", state: "applied" });
      return target;
    }
    if (tool === "browserAttach") return broker.attach(args.targetRef);
    if (tool === "browserCommand") {
      return broker.command(args.sessionRef, {
        method: args.method,
        params: args.params || {},
        expectedRisk: args.expectedRisk,
      }, { signal });
    }
    if (tool === "browserObserve") {
      return automation.observe(args.sessionRef, {
        ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
        ...(args.includeScreenshot === undefined ? {} : { includeScreenshot: args.includeScreenshot }),
        ...(args.includeConsole === undefined ? {} : { includeConsole: args.includeConsole }),
        ...(args.includeNetwork === undefined ? {} : { includeNetwork: args.includeNetwork }),
        ...(args.maxEvents === undefined ? {} : { maxEvents: args.maxEvents }),
      }, { signal });
    }
    if (tool === "browserAct") return automation.run(args.sessionRef, args.actions, { signal });
    if (tool === "browserDetach") {
      automation.dropSession(args.sessionRef);
      await broker.detach(args.sessionRef);
      return Object.freeze({ detached: true });
    }
    throw new Error(`unhandled browser tool: ${tool}`);
  }

  async close() {
    this._automation?.close();
    if (!this._brokerPromise) return;
    const broker = await this._brokerPromise;
    await broker.close();
  }

  async _ready() {
    const downloadDir = join(this._profileDir, "browserDownloads");
    if (!this._brokerPromise) {
      this._brokerPromise = this._brokerFactory({
        profileDir: this._profileDir,
        targetOrigins: this.config.targetOrigins,
        methods: this.config.methods,
        events: this.config.events,
        fileRoots: this.config.fileRoots,
        downloadRoot: downloadDir,
        maxRisk: this.config.maxRisk,
        timeoutMs: this.config.timeoutMs,
      });
    }
    const broker = await this._brokerPromise;
    if (!this._automation) {
      this._automation = new BrowserAutomation({
        port: broker.port,
        actions: this.config.actions,
        onAudit: (record) => {
          if (record.risk === "externalEffect" || record.state === "failed") this._audit(record);
        },
        downloadDir,
      });
    }
    return { broker, automation: this._automation };
  }

  _audit(record) {
    this._auditWriter(Object.freeze({
      type: "browser-control",
      purpose: this.config.purpose || null,
      ...record,
    }));
  }
}

export function browserToolErrorDetails(error) {
  return {
    ...(Number.isInteger(error?.failedActionIndex) ? { failedActionIndex: error.failedActionIndex } : {}),
    ...(error?.failedAction ? { failedAction: error.failedAction } : {}),
    ...(Array.isArray(error?.completed) ? { completed: error.completed } : {}),
    ...(error?.actionability ? { actionability: error.actionability } : {}),
    ...(error?.trace ? { trace: error.trace } : {}),
  };
}

export const BROWSER_AUTOMATION_TOOL_DEFAULTS = Object.freeze({
  actions: BROWSER_AUTOMATION_DEFAULT_ACTIONS,
  maxNodes: BROWSER_AUTOMATION_DEFAULT_MAX_NODES,
  externalEffectAcknowledgement: EXTERNAL_EFFECT_ACK,
  actionCatalog: inspectBrowserAutomationActions(),
});
