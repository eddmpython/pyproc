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
import {
  BrowserArtifactStore,
  BROWSER_ARTIFACT_DEFAULT_INLINE_BYTES,
  BROWSER_ARTIFACT_DEFAULT_MAX_BYTES,
  BROWSER_ARTIFACT_DEFAULT_MAX_COUNT,
  BROWSER_ARTIFACT_DEFAULT_TOTAL_BYTES,
  BROWSER_ARTIFACT_DEFAULT_TTL_MS,
  BROWSER_ARTIFACT_MAX_CHUNK_BYTES,
} from "./browserArtifactStore.js";
import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { parseBrowserViewportEnvironment } from "./browserViewport.js";
import {
  APX_OBSERVE_PROPERTIES,
  APX_OBSERVE_OPTION_KEYS,
} from "../perception/apxCatalog.js";

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

function boundedEnvironmentInteger(env, key, fallback, maximum) {
  if (env[key] === undefined || env[key] === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(String(env[key]))) throw new Error(`${key} must be a positive integer`);
  const value = Number(env[key]);
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error(`${key} exceeds ${maximum}`);
  return value;
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
      || parsed.username || parsed.password || parsed.hostname.includes("*")
      || parsed.href !== parsed.origin + "/") {
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
  const rawMethods = unique(Object.hasOwn(env, "PYPROC_BROWSER_METHODS")
    ? requestedRawMethods : BROWSER_CONTROL_DEFAULT_READ_METHODS);
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
  const viewport = parseBrowserViewportEnvironment(env.PYPROC_BROWSER_VIEWPORT);
  if ((actions.includes("upload") || rawMethods.includes("DOM.setFileInputFiles")) && fileRoots.length < 1) {
    throw new Error("browser file upload requires PYPROC_BROWSER_FILE_ROOTS");
  }
  const artifacts = Object.freeze({
    maxArtifactBytes: boundedEnvironmentInteger(env, "PYPROC_BROWSER_ARTIFACT_MAX_BYTES",
      BROWSER_ARTIFACT_DEFAULT_MAX_BYTES, 64 * 1024 * 1024),
    maxTotalBytes: boundedEnvironmentInteger(env, "PYPROC_BROWSER_ARTIFACT_TOTAL_BYTES",
      BROWSER_ARTIFACT_DEFAULT_TOTAL_BYTES, 512 * 1024 * 1024),
    maxArtifacts: boundedEnvironmentInteger(env, "PYPROC_BROWSER_ARTIFACT_MAX_COUNT",
      BROWSER_ARTIFACT_DEFAULT_MAX_COUNT, 1024),
    inlineMaxBytes: boundedEnvironmentInteger(env, "PYPROC_BROWSER_ARTIFACT_INLINE_BYTES",
      BROWSER_ARTIFACT_DEFAULT_INLINE_BYTES, 4 * 1024 * 1024),
    ttlMs: boundedEnvironmentInteger(env, "PYPROC_BROWSER_ARTIFACT_TTL_MS",
      BROWSER_ARTIFACT_DEFAULT_TTL_MS, 24 * 60 * 60 * 1000),
  });
  if (artifacts.maxArtifactBytes > artifacts.maxTotalBytes) {
    throw new Error("PYPROC_BROWSER_ARTIFACT_MAX_BYTES must not exceed total bytes");
  }
  if (artifacts.inlineMaxBytes > artifacts.maxArtifactBytes) {
    throw new Error("PYPROC_BROWSER_ARTIFACT_INLINE_BYTES must not exceed max artifact bytes");
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
    artifacts,
    viewport,
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
      description: "Instrument a blank target, apply configured device metrics, navigate to an allowed HTTP(S) URL, "
        + "and return at navigation commit by default. DOM-ready and load are explicit options. "
        + "Requires external-effect acknowledgement.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          expectedRisk: { type: "string", const: "externalEffect" },
          waitUntil: { type: "string", enum: ["commit", "domcontentloaded", "load"] },
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
      name: "browserClose",
      description: "Close one target created by this broker and invalidate every session attached to it.",
      inputSchema: {
        type: "object",
        properties: {
          targetRef: { type: "string", minLength: 1 },
          expectedRisk: { type: "string", const: "externalEffect" },
        },
        required: ["targetRef", "expectedRisk"],
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
      description: "Capture a legacy accessibility snapshot, an APX graph, or a goal-specific APX SituationCapsule.",
      inputSchema: {
        type: "object",
        properties: {
          sessionRef: BROWSER_SESSION_SCHEMA,
          expectedRisk: { type: "string", const: "read" },
          maxNodes: { type: "integer", minimum: 1, maximum: BROWSER_AUTOMATION_MAX_NODES },
          mode: { type: "string", enum: ["all", "interactive"] },
          includeScreenshot: { type: "boolean" },
          includeConsole: { type: "boolean" },
          includeNetwork: { type: "boolean" },
          maxEvents: { type: "integer", minimum: 1, maximum: BROWSER_OBSERVATION_MAX_EVENTS },
          ...APX_OBSERVE_PROPERTIES,
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
  tools.push({
    name: "browserArtifactRead",
    description: "Read one bounded base64 chunk from an opaque screenshot or download artifact.",
    inputSchema: {
      type: "object",
      properties: {
        artifactRef: { type: "string", pattern: "^artifact:[A-Za-z0-9_-]+$", minLength: 10, maxLength: 105 },
        offset: { type: "integer", minimum: 0 },
        maxBytes: { type: "integer", minimum: 1, maximum: BROWSER_ARTIFACT_MAX_CHUNK_BYTES },
      },
      required: ["artifactRef"],
      additionalProperties: false,
    },
  });
  tools.push({
    name: "browserArtifactDelete",
    description: "Delete one broker-owned artifact before its TTL expires.",
    inputSchema: {
      type: "object",
      properties: { artifactRef: { type: "string", pattern: "^artifact:[A-Za-z0-9_-]+$", minLength: 10, maxLength: 105 } },
      required: ["artifactRef"],
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
    this._artifactStore = null;
    this._profileDir = profileDir;
    this._brokerFactory = brokerFactory;
    this._auditWriter = auditWriter;
    this._authorities = new WeakSet();
  }

  authorize(tool, args = {}) {
    if (!this._toolNames.has(tool)) throw new Error(`unknown browser tool: ${tool}`);
    if (tool === "browserOpen" && args.expectedRisk !== "externalEffect") {
      throw permissionError("browserOpen requires expectedRisk externalEffect");
    }
    if (tool === "browserClose" && args.expectedRisk !== "externalEffect") {
      throw permissionError("browserClose requires expectedRisk externalEffect");
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
    const authority = Object.freeze({ tool });
    this._authorities.add(authority);
    return authority;
  }

  invoke(tool, args = {}, { signal } = {}) {
    return this.invokeAuthorized(tool, args, { signal, authority: this.authorize(tool, args) });
  }

  async invokeAuthorized(tool, args = {}, { signal, authority } = {}) {
    if (!authority || !this._authorities.has(authority) || authority.tool !== tool) {
      throw permissionError("browser operation requires a current authorization token");
    }
    this._authorities.delete(authority);
    const { broker, automation, artifactStore } = await this._ready();
    if (tool === "browserInspect") {
      await artifactStore.reap();
      const automationInspection = automation.inspect();
      return Object.freeze({
        ...broker.inspect(),
        automation: automationInspection,
        perception: automationInspection.perception,
        rawMethods: this.config.rawMethods,
        purposeDeclared: !!this.config.purpose,
        externalEffectsAcknowledged: this.config.externalEffectsAcknowledged,
      });
    }
    if (tool === "browserListTargets") return broker.listTargets();
    if (tool === "browserOpen") {
      this._audit({ kind: "open", risk: "externalEffect", state: "attempted" });
      const target = await broker.openTarget(args.url, { waitUntil: args.waitUntil || "commit" });
      this._audit({ kind: "open", risk: "externalEffect", state: "applied" });
      return target;
    }
    if (tool === "browserClose") return broker.closeTarget(args.targetRef);
    if (tool === "browserAttach") return broker.attach(args.targetRef);
    if (tool === "browserCommand") {
      return broker.command(args.sessionRef, {
        method: args.method,
        params: args.params || {},
        expectedRisk: args.expectedRisk,
      }, { signal });
    }
    if (tool === "browserObserve") {
      const perceptionOptions = Object.fromEntries(APX_OBSERVE_OPTION_KEYS
        .filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
      return automation.observe(args.sessionRef, {
        ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
        ...(args.mode === undefined ? {} : { mode: args.mode }),
        ...(args.includeScreenshot === undefined ? {} : { includeScreenshot: args.includeScreenshot }),
        ...(args.includeConsole === undefined ? {} : { includeConsole: args.includeConsole }),
        ...(args.includeNetwork === undefined ? {} : { includeNetwork: args.includeNetwork }),
        ...(args.maxEvents === undefined ? {} : { maxEvents: args.maxEvents }),
        ...perceptionOptions,
      }, { signal });
    }
    if (tool === "browserAct") return automation.run(args.sessionRef, args.actions, { signal });
    if (tool === "browserArtifactRead") {
      return artifactStore.read(args.artifactRef, {
        ...(args.offset === undefined ? {} : { offset: args.offset }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
      });
    }
    if (tool === "browserArtifactDelete") return artifactStore.delete(args.artifactRef);
    if (tool === "browserDetach") {
      automation.dropSession(args.sessionRef);
      await broker.detach(args.sessionRef);
      return Object.freeze({ detached: true });
    }
    throw new Error(`unhandled browser tool: ${tool}`);
  }

  async close() {
    this._automation?.close();
    await this._artifactStore?.close();
    if (this._brokerPromise) await (await this._brokerPromise).close();
  }

  async _ready() {
    const downloadDir = join(this._profileDir, "browserDownloads");
    const artifactDir = join(this._profileDir, "browserArtifacts");
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
        viewport: this.config.viewport,
      });
    }
    const broker = await this._brokerPromise;
    if (!this._artifactStore) {
      this._artifactStore = new BrowserArtifactStore({ root: artifactDir, ...this.config.artifacts });
    }
    if (!this._automation) {
      this._automation = new BrowserAutomation({
        port: broker.port,
        actions: this.config.actions,
        onAudit: (record) => {
          if (record.risk === "externalEffect" || record.state === "failed") this._audit(record);
        },
        downloadDir,
        artifactStore: this._artifactStore,
      });
    }
    return { broker, automation: this._automation, artifactStore: this._artifactStore };
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
    ...(error?.actionEvidence ? { actionEvidence: error.actionEvidence } : {}),
    ...(error?.trace ? { trace: error.trace } : {}),
  };
}

export const BROWSER_AUTOMATION_TOOL_DEFAULTS = Object.freeze({
  actions: BROWSER_AUTOMATION_DEFAULT_ACTIONS,
  maxNodes: BROWSER_AUTOMATION_DEFAULT_MAX_NODES,
  externalEffectAcknowledgement: EXTERNAL_EFFECT_ACK,
  actionCatalog: inspectBrowserAutomationActions(),
});
