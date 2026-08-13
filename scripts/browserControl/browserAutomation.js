// browserAutomation.js - compact observe, opaque locator, 순차 action pipeline 실행기.
import {
  BROWSER_AUTOMATION_ACTIONS,
  BROWSER_AUTOMATION_MAX_ACTIONS,
  BROWSER_AUTOMATION_DEFAULT_MAX_NODES,
  BROWSER_AUTOMATION_DEFAULT_WAIT_MS,
  inspectBrowserAutomationActions,
  validateBrowserAutomationActions,
} from "./browserAutomationCatalog.js";
import {
  BROWSER_CONTROL_COMMAND_RISKS,
} from "./browserControlPolicy.js";
import {
  BrowserControlError,
  BROWSER_CONTROL_ERROR_CODES,
} from "./browserControlPort.js";
import {
  actionLocator,
  browserLocatorExpression,
  describeBrowserLocator,
  parseBrowserLocatorCount,
} from "./browserLocator.js";
import {
  BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
  BROWSER_ACTIONABILITY_FUNCTION,
  waitForBrowserActionability,
} from "./browserActionability.js";
import { BrowserObservation } from "./browserObservation.js";
import { BrowserTrace } from "./browserTrace.js";
import { BrowserLifecycle } from "./browserLifecycle.js";
import { BrowserDownload } from "./browserDownload.js";
import { BrowserScreenshot } from "./browserScreenshot.js";
import {
  APX_ERROR_CODES,
  APX_REPRESENTATION,
  perceptionOptionsFromInput,
} from "../perception/apxCatalog.js";
import { APX_SITUATION_REPRESENTATION } from "../perception/situationCatalog.js";
import { ActionEvidenceLoop } from "../perception/actionEvidence.js";
import { PerceptionSpace } from "../perception/perceptionSpace.js";
import { WebCdpSensor } from "../perception/profiles/webCdpSensor.js";

export const BROWSER_AUTOMATION_ERROR_CODES = Object.freeze({
  actionRejected: "BROWSER_AUTOMATION_ACTION_REJECTED",
  actionDenied: "BROWSER_AUTOMATION_ACTION_DENIED",
  invalidAction: "BROWSER_AUTOMATION_INVALID_ACTION",
  staleLocator: "BROWSER_AUTOMATION_STALE_LOCATOR",
  strictLocator: "BROWSER_AUTOMATION_STRICT_LOCATOR",
  targetMissing: "BROWSER_AUTOMATION_TARGET_MISSING",
  actionabilityTimeout: "BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT",
  waitTimeout: "BROWSER_AUTOMATION_WAIT_TIMEOUT",
});

const WAIT_POLL_MS = 100;
const MAX_REPORTED_REQUEST_IDS = 16;
const TEXT_LIMIT = 500;
const STORAGE_VALUE_LIMIT = 10000;
const AX_STATES = new Set([
  "checked", "disabled", "expanded", "focused", "level", "pressed", "readonly", "required", "selected",
]);
const AX_INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "gridcell", "link", "listbox", "menuitem", "menuitemcheckbox",
  "menuitemradio", "option", "radio", "scrollbar", "searchbox", "slider", "spinbutton", "switch", "tab",
  "textbox", "treeitem",
]);
const AX_CONTEXT_ROLES = new Set([
  "alert", "dialog", "form", "heading", "main", "navigation", "region", "status",
]);
const AX_LIVE_ROLES = new Set(["alert", "status"]);
const AX_TEXT_ROLES = new Set(["InlineTextBox", "StaticText"]);

const FILL_FUNCTION = `function(value) {
  "use strict";
  if (!this || this.nodeType !== 1) throw new Error("browser action target is not an Element");
  this.focus();
  if (this.isContentEditable) {
    const selection = this.ownerDocument.getSelection();
    const range = this.ownerDocument.createRange();
    range.selectNodeContents(this);
    selection.removeAllRanges();
    selection.addRange(range);
    return { tag: this.tagName.toLowerCase(), contenteditable: true };
  }
  const view = this.ownerDocument.defaultView;
  const prototype = this.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("browser fill target is not editable");
  setter.call(this, value);
  this.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { tag: this.tagName.toLowerCase(), value: String(this.value), inputMode: "nativeSetter" };
}`;

const CONTENTEDITABLE_FILL_RESULT_FUNCTION = `function() {
  "use strict";
  if (!this || this.nodeType !== 1 || !this.isContentEditable) throw new Error("browser fill target is not editable");
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { tag: this.tagName.toLowerCase(), value: String(this.textContent || ""), inputMode: "trusted" };
}`;

const SELECT_FUNCTION = `function(values) {
  "use strict";
  if (!this || this.tagName !== "SELECT") throw new Error("browser select target is not a select element");
  const wanted = new Set(values);
  const available = new Set(Array.from(this.options, (option) => option.value));
  for (const value of wanted) if (!available.has(value)) throw new Error("browser select value is unavailable");
  for (const option of this.options) option.selected = wanted.has(option.value);
  const selected = Array.from(this.selectedOptions, (option) => option.value);
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { selected };
}`;

const SCROLL_FUNCTION = `function(block) {
  "use strict";
  if (!this || this.nodeType !== 1) throw new Error("browser action target is not an Element");
  this.scrollIntoView({ block, inline: "nearest" });
  return { tag: this.tagName.toLowerCase(), block };
}`;

const FOCUS_FUNCTION = `function() {
  "use strict";
  if (!this || this.nodeType !== 1 || typeof this.focus !== "function") throw new Error("browser press target is not focusable");
  this.focus();
  return { tag: this.tagName.toLowerCase(), focused: this.ownerDocument.activeElement === this };
}`;

const CHECKED_FUNCTION = `function() {
  "use strict";
  if (!this || this.tagName !== "INPUT" || !["checkbox", "radio"].includes(this.type)) {
    throw new Error("browser check target is not a checkbox or radio");
  }
  return { type: this.type, checked: this.checked === true };
}`;

const UPLOAD_STATE_FUNCTION = `function() {
  "use strict";
  if (!this || this.tagName !== "INPUT" || this.type !== "file") throw new Error("browser upload target is not a file input");
  return { files: Array.from(this.files || [], (file) => ({ name: file.name, size: file.size, type: file.type })) };
}`;

const HYDRATE_LAZY_FUNCTION = ({ maxScrolls, settleMs, timeoutMs }) => `(async () => {
  "use strict";
  const original = { x: scrollX, y: scrollY };
  const startedAt = performance.now();
  const deadline = startedAt + ${timeoutMs};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const lazy = () => Array.from(document.querySelectorAll("img[loading='lazy'], iframe[loading='lazy']"));
  const before = lazy();
  const initialHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
  const maximum = Math.max(0, initialHeight - innerHeight);
  const step = Math.max(1, Math.floor(innerHeight * 0.8));
  const idealScrolls = Math.floor(maximum / step) + 2;
  let scrolls = 0;
  let timedOut = false;
  try {
    for (let y = 0; y < maximum && scrolls < ${maxScrolls} - 1; y += step) {
      if (performance.now() >= deadline) { timedOut = true; break; }
      scrollTo(original.x, y);
      scrolls += 1;
      await wait(Math.min(${settleMs}, Math.max(0, deadline - performance.now())));
    }
    if (!timedOut && scrolls < ${maxScrolls}) {
      scrollTo(original.x, maximum);
      scrolls += 1;
      await wait(Math.min(${settleMs}, Math.max(0, deadline - performance.now())));
    }
    while (performance.now() < deadline && lazy().some((node) => "complete" in node && !node.complete)) {
      await wait(Math.min(50, Math.max(0, deadline - performance.now())));
    }
    if (performance.now() >= deadline) timedOut = true;
  } finally {
    scrollTo(original.x, original.y);
    await wait(Math.min(${settleMs}, 100));
  }
  const after = lazy();
  return {
    scrolls,
    truncated: idealScrolls > ${maxScrolls},
    timedOut,
    initialHeight,
    finalHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    lazyBefore: before.length,
    pendingBefore: before.filter((node) => "complete" in node && !node.complete).length,
    lazyAfter: after.length,
    pendingAfter: after.filter((node) => "complete" in node && !node.complete).length,
    restored: scrollX === original.x && scrollY === original.y,
    elapsedMs: Math.round(performance.now() - startedAt)
  };
})()`;

function sameRect(left, right) {
  if (!left || !right) return false;
  return ["x", "y", "width", "height"].every((key) => Math.abs(Number(left[key]) - Number(right[key])) <= 0.25);
}

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

function clipped(value, limit = TEXT_LIMIT) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function remoteValue(entry) {
  return entry && typeof entry === "object" && Object.hasOwn(entry, "value") ? entry.value : undefined;
}

function commandValue(commandResult) {
  return commandResult?.result?.result?.value;
}

function exceptionText(commandResult) {
  const details = commandResult?.result?.exceptionDetails;
  if (!details) return "";
  return clipped(details.exception?.description || details.text || "browser action script failed", 300);
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function httpUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); }
  catch (error) {
    throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionDenied,
      `${label} must be an HTTP(S) URL`, { outcome: "notSent" });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionDenied,
      `${label} must be an HTTP(S) URL without embedded credentials`, { outcome: "notSent" });
  }
  return parsed;
}

function redactedDocumentUrl(value) {
  const parsed = httpUrl(value, "browser document URL");
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancelledBeforeSend());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(cancelledBeforeSend());
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function cancelledBeforeSend() {
  return new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
    "browser action was cancelled before the next command", { outcome: "notSent" });
}

function automationError(code, message, options = {}) {
  return new BrowserControlError(code, message, options);
}

function summarizeCommands(commandResults) {
  const ids = commandResults.map((entry) => entry.result?.requestId).filter(Boolean);
  return Object.freeze({
    requestCount: ids.length,
    requestIds: Object.freeze(ids.slice(-MAX_REPORTED_REQUEST_IDS)),
  });
}

function keyDefinition(key) {
  const named = {
    Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
    Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
    Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
    Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
    Space: { code: "Space", text: " ", windowsVirtualKeyCode: 32 },
    ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
    ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
    ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
    Delete: { code: "Delete", windowsVirtualKeyCode: 46 },
    Home: { code: "Home", windowsVirtualKeyCode: 36 },
    End: { code: "End", windowsVirtualKeyCode: 35 },
  };
  if (Object.hasOwn(named, key)) return { key: key === "Space" ? " " : key, ...named[key] };
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const letter = /^[A-Z]$/.test(upper);
    const digit = /^[0-9]$/.test(key);
    return {
      key,
      code: letter ? `Key${upper}` : digit ? `Digit${key}` : "",
      text: key,
      windowsVirtualKeyCode: upper.codePointAt(0),
    };
  }
  return { key, code: key };
}

function modifierBits(modifiers = []) {
  const bits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
  return modifiers.reduce((total, name) => total | bits[name], 0);
}

export class BrowserAutomation {
  constructor({ port, actions = Object.keys(BROWSER_AUTOMATION_ACTIONS), idFactory = () => crypto.randomUUID(),
    onAudit = () => {}, downloadDir = null, artifactStore = null } = {}) {
    if (!port || typeof port.send !== "function" || !port.policy) throw new TypeError("browser automation port is required");
    if (typeof idFactory !== "function") throw new TypeError("browser automation idFactory must be a function");
    if (typeof onAudit !== "function") throw new TypeError("browser automation onAudit must be a function");
    this._port = port;
    this._allowedActions = new Set(actions);
    for (const name of this._allowedActions) {
      if (!Object.hasOwn(BROWSER_AUTOMATION_ACTIONS, name)) throw new TypeError(`unknown browser action: ${name}`);
    }
    this._idFactory = idFactory;
    this._onAudit = onAudit;
    this._locators = new Map();
    this._sessionLocators = new Map();
    this._artifactStore = artifactStore;
    this._screenshot = artifactStore ? new BrowserScreenshot({
      command: (sessionRef, method, params, commandResults, signal) => this._command(sessionRef, method, params, commandResults, signal),
      artifactStore,
    }) : null;
    const visualProbeEnabled = !!this._screenshot && this._allowedActions.has("screenshot");
    this._observation = new BrowserObservation({
      port,
      command: (sessionRef, method, params, commandResults, signal) => this._command(sessionRef, method, params, commandResults, signal),
      screenshot: this._screenshot,
      idFactory,
    });
    this._perception = new PerceptionSpace({
      sensor: new WebCdpSensor({
        command: (sessionRef, method, params, commandResults, signal) =>
          this._command(sessionRef, method, params, commandResults, signal),
        environmentCommand: (sessionRef, method, params, commandResults, signal) =>
          this._sendCommand(sessionRef, method, params, commandResults, signal, true),
        eventCapture: (sessionRef, options, commandResults, signal) =>
          this._observation.capture(sessionRef, options, commandResults, signal),
      }),
      idFactory,
      locatorReset: (sessionRef) => this._clearSessionLocators(sessionKey(sessionRef)),
      locatorIssuer: (sessionRef, contextEpoch, locatorData) =>
        this._issueOpaqueLocator(sessionRef, contextEpoch, locatorData.backendNodeId),
      visualProbe: visualProbeEnabled ? (sessionRef, entity, visual, context) =>
        this._captureVisualProbe(sessionRef, entity, visual, context) : null,
      visualRelease: visualProbeEnabled ? (probe) => artifactStore.delete(probe.artifact.artifactRef) : null,
      providerKind: "nativeCdp",
      capabilityPolicy: ({ action }) => this._allowedActions.has(action)
        ? { risk: BROWSER_AUTOMATION_ACTIONS[action].risk, destination: null }
        : null,
    });
    this._evidence = new ActionEvidenceLoop({ idFactory });
    this._lifecycle = new BrowserLifecycle({ port });
    this._download = downloadDir && artifactStore ? new BrowserDownload({
      lifecycle: this._lifecycle,
      command: (sessionRef, method, params, commandResults, signal) => this._command(sessionRef, method, params, commandResults, signal),
      downloadDir,
      artifactStore,
    }) : null;
  }

  async observe(sessionRef, options = {}, { signal } = {}) {
    const run = await this.run(sessionRef, [{ kind: "snapshot", expectedRisk: "read", ...options }], { signal });
    return Object.freeze({ ...run.actions[0], trace: run.trace });
  }

  async run(sessionRef, inputActions, { signal } = {}) {
    const actions = validateBrowserAutomationActions(inputActions);
    for (const action of actions) {
      this._authorizeAction(action.kind);
      if (action.verify) this._authorizeAction("snapshot");
    }
    const runId = `run:${this._idFactory()}`;
    const trace = new BrowserTrace({ traceId: `trace:${this._idFactory()}`, runId });
    const completed = [];
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const actionId = `action:${this._idFactory()}`;
      const commandResults = [];
      const traceToken = trace.begin({ index, actionId, kind: action.kind, risk: BROWSER_AUTOMATION_ACTIONS[action.kind].risk });
      try {
        let result;
        if (action.verify) {
          const evidenced = await this._evidence.run({
            actionRef: actionId,
            postcondition: action.verify,
            signal,
            capture: ({ since }) => this._perception.observe(sessionRef, {
              representation: APX_REPRESENTATION,
              ...(since ? { since } : {}),
              channels: ["semantic", "structure", "geometry", "interaction", "events", "networkMetadata"],
              visual: { mode: "off" },
              budget: { maxEntities: 500, maxRelations: 1000, maxBytes: 512 * 1024 },
            }, { signal, commandResults, issueLocators: false }),
            effect: () => this._execute(sessionRef, action, commandResults, signal),
          });
          result = Object.freeze({ ...(evidenced.effectResult || {}), evidence: evidenced.evidence });
        } else result = await this._execute(sessionRef, action, commandResults, signal);
        const summary = summarizeCommands(commandResults);
        const normalized = Object.freeze({
          actionId,
          kind: action.kind,
          risk: BROWSER_AUTOMATION_ACTIONS[action.kind].risk,
          state: BROWSER_AUTOMATION_ACTIONS[action.kind].risk === "read" ? "observed" : "applied",
          ...summary,
          result,
        });
        this._audit({ runId, actionId, index, kind: action.kind, risk: normalized.risk, state: normalized.state });
        completed.push(normalized);
        trace.complete(traceToken, commandResults);
      } catch (error) {
        const enriched = error instanceof Error ? error : new Error(String(error));
        enriched.runId = runId;
        enriched.failedActionIndex = index;
        enriched.failedAction = Object.freeze({
          actionId,
          kind: action.kind,
          ...summarizeCommands(commandResults),
        });
        enriched.completed = Object.freeze([...completed]);
        trace.fail(traceToken, commandResults, enriched);
        enriched.trace = trace.finish("failed");
        this._audit({
          runId,
          actionId,
          index,
          kind: action.kind,
          risk: BROWSER_AUTOMATION_ACTIONS[action.kind].risk,
          state: "failed",
          outcome: enriched.outcome || "notSent",
          code: enriched.code || "PYPROC_INTERNAL",
        });
        throw enriched;
      }
    }
    return Object.freeze({ runId, state: "completed", actions: Object.freeze(completed), trace: trace.finish("completed") });
  }

  dropSession(sessionRef) {
    this._clearSessionLocators(sessionKey(sessionRef));
    this._observation.dropSession(sessionRef);
    this._perception.dropSession(sessionRef);
    this._lifecycle.dropSession(sessionRef);
    this._download?.dropSession(sessionRef);
  }

  close() {
    this._observation.close();
    this._perception.close();
    this._lifecycle.close();
    this._download?.close();
    this._locators.clear();
    this._sessionLocators.clear();
  }

  inspect() {
    return Object.freeze({
      actions: inspectBrowserAutomationActions([...this._allowedActions]),
      maxActions: BROWSER_AUTOMATION_MAX_ACTIONS,
      locators: this._locators.size,
      observation: this._observation.inspect(),
      perception: this._perception.inspect(),
      lifecycle: this._lifecycle.inspect(),
      download: this._download?.inspect() || null,
      artifacts: this._artifactStore?.inspect() || null,
    });
  }

  _authorizeAction(kind) {
    if (this._allowedActions.has(kind)) return;
    throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionDenied,
      `browser action is outside permission: ${kind}`, { outcome: "notSent" });
  }

  async _execute(sessionRef, action, commandResults, signal) {
    if (action.actionContext) this._perception.assertActionContext(sessionRef, action.actionContext, action);
    if (action.kind === "snapshot") return this._snapshot(sessionRef, action, commandResults, signal);
    if (action.kind === "screenshot") {
      if (!this._screenshot) throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionDenied,
        "browser screenshot artifact store is unavailable", { outcome: "notSent" });
      return this._screenshot.capture(sessionRef, action, commandResults, signal);
    }
    if (action.kind === "waitFor") return this._waitFor(sessionRef, action, commandResults, signal);
    if (action.kind === "hydrateLazy") return this._hydrateLazy(sessionRef, action, commandResults, signal);
    if (action.kind === "navigate") return this._navigate(sessionRef, action, commandResults, signal);
    if (action.kind === "cookiesGet") return this._cookiesGet(sessionRef, action, commandResults, signal);
    if (action.kind === "cookieSet") return this._cookieSet(sessionRef, action, commandResults, signal);
    if (action.kind === "cookieDelete") return this._cookieDelete(sessionRef, action, commandResults, signal);
    if (["storageGet", "storageSet", "storageRemove", "storageClear"].includes(action.kind)) {
      return this._storage(sessionRef, action, commandResults, signal);
    }
    if (action.kind === "press") return this._press(sessionRef, action, commandResults, signal);
    return this._targetAction(sessionRef, action, commandResults, signal);
  }

  async _snapshot(sessionRef, action, commandResults, signal) {
    if ([APX_REPRESENTATION, APX_SITUATION_REPRESENTATION].includes(action.representation)) {
      return this._perception.observe(sessionRef, perceptionOptionsFromInput(action), { signal, commandResults });
    }
    const command = await this._command(sessionRef, "Accessibility.getFullAXTree", {}, commandResults, signal);
    const raw = command.result || {};
    const maxNodes = action.maxNodes || BROWSER_AUTOMATION_DEFAULT_MAX_NODES;
    const key = sessionKey(sessionRef);
    this._clearSessionLocators(key);
    const mode = action.mode || "all";
    const eligibleNodes = [];
    const rawNodeById = new Map((raw.nodes || []).map((node) => [node.nodeId, node]));
    const locatorRefs = new Set();
    for (const node of raw.nodes || []) {
      if (node.ignored) continue;
      const role = clipped(remoteValue(node.role));
      const name = clipped(remoteValue(node.name));
      const value = clipped(remoteValue(node.value));
      const description = clipped(remoteValue(node.description));
      if (!role && !name && !value && !description) continue;
      const compact = { role: role || "unknown" };
      if (name) compact.name = name;
      if (value) compact.value = value;
      if (description) compact.description = description;
      const states = {};
      for (const property of node.properties || []) {
        if (!AX_STATES.has(property.name)) continue;
        const propertyValue = remoteValue(property.value);
        if (propertyValue !== undefined) states[property.name] = propertyValue;
      }
      if (Object.keys(states).length) compact.states = Object.freeze(states);
      eligibleNodes.push({ node, compact });
    }
    const liveText = ({ node, compact }) => {
      if (!AX_TEXT_ROLES.has(compact.role)) return false;
      let parentId = node.parentId;
      for (let depth = 0; parentId && depth < 4; depth += 1) {
        const parent = rawNodeById.get(parentId);
        if (!parent) return false;
        if (AX_LIVE_ROLES.has(clipped(remoteValue(parent.role)))) return true;
        parentId = parent.parentId;
      }
      return false;
    };
    const candidates = mode === "interactive"
      ? eligibleNodes.filter((entry) => AX_INTERACTIVE_ROLES.has(entry.compact.role)
        || AX_CONTEXT_ROLES.has(entry.compact.role) || liveText(entry))
      : eligibleNodes;
    const nodes = [];
    for (const { node, compact } of candidates.slice(0, maxNodes)) {
      if (Number.isInteger(node.backendDOMNodeId) && node.backendDOMNodeId > 0) {
        const locatorRef = `locator:${this._idFactory()}`;
        compact.locatorRef = locatorRef;
        locatorRefs.add(locatorRef);
        this._locators.set(locatorRef, Object.freeze({
          sessionKey: key,
          contextEpoch: command.contextEpoch,
          backendNodeId: node.backendDOMNodeId,
        }));
      }
      nodes.push(Object.freeze(compact));
    }
    this._sessionLocators.set(key, locatorRefs);
    const response = {
      snapshotId: `snapshot:${this._idFactory()}`,
      contextEpoch: command.contextEpoch,
      url: command.target.url,
      mode,
      nodes: Object.freeze(nodes),
      eligibleNodes: eligibleNodes.length,
      candidateNodes: candidates.length,
      truncated: candidates.length > nodes.length,
      rawBytes: byteLength(raw),
    };
    response.compactBytes = byteLength(response);
    const artifacts = await this._observation.capture(sessionRef, action, commandResults, signal);
    return Object.freeze({ ...response, ...artifacts });
  }

  async _waitFor(sessionRef, action, commandResults, signal) {
    const state = action.state || "attached";
    const timeoutMs = action.timeoutMs || BROWSER_AUTOMATION_DEFAULT_WAIT_MS;
    const deadline = Date.now() + timeoutMs;
    let polls = 0;
    let previousRect = null;
    let stablePolls = 0;
    while (true) {
      if (signal?.aborted) throw cancelledBeforeSend();
      let target = null;
      try {
        target = await this._resolveActionTarget(sessionRef, action, commandResults, signal, true);
      } catch (error) {
        if (error?.code !== BROWSER_CONTROL_ERROR_CODES.contextReplaced) throw error;
      }
      polls += 1;
      let reached = (state === "attached" && !!target) || (state === "detached" && !target)
        || (state === "hidden" && !target);
      let status = null;
      if (target) {
        try {
          status = await this._inspectTarget(sessionRef, target, {}, commandResults, signal, true);
          if (state === "visible") reached = status.visible === true;
          if (state === "hidden") reached = status.visible !== true;
          if (state === "enabled") reached = status.enabled === true;
          if (state === "disabled") reached = status.enabled === false;
          if (state === "editable") reached = status.editable === true;
          if (state === "stable") {
            stablePolls = sameRect(previousRect, status.rect) ? stablePolls + 1 : 0;
            previousRect = status.rect;
            reached = stablePolls >= 2;
          }
        } finally {
          await this._releaseTarget(sessionRef, target, commandResults, signal, true);
        }
      } else {
        previousRect = null;
        stablePolls = 0;
      }
      if (reached) {
        return Object.freeze({ state, polls, ...(status ? {
          status: Object.freeze({ visible: status.visible, enabled: status.enabled, editable: status.editable,
            connected: status.connected, rect: status.rect }),
        } : {}) });
      }
      if (Date.now() >= deadline) {
        throw automationError(BROWSER_AUTOMATION_ERROR_CODES.waitTimeout,
          `browser wait timed out for ${state} target`, { outcome: "notSent", retryable: true });
      }
      await delay(Math.min(WAIT_POLL_MS, Math.max(1, deadline - Date.now())), signal);
    }
  }

  async _hydrateLazy(sessionRef, action, commandResults, signal) {
    const timeoutMs = action.timeoutMs || 10000;
    const command = await this._command(sessionRef, "Runtime.evaluate", {
      expression: HYDRATE_LAZY_FUNCTION({
        maxScrolls: action.maxScrolls || 50,
        settleMs: action.settleMs === undefined ? 100 : action.settleMs,
        timeoutMs,
      }),
      awaitPromise: true,
      returnByValue: true,
    }, commandResults, signal);
    const scriptError = exceptionText(command);
    if (scriptError) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionRejected,
        `browser lazy hydration failed: ${scriptError}`, { outcome: "applied" });
    }
    return Object.freeze(commandValue(command) || {});
  }

  async _navigate(sessionRef, action, commandResults, signal) {
    const command = await this._command(sessionRef, "Page.navigate", { url: action.url }, commandResults, signal);
    if (command.result?.errorText) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionRejected,
        `browser navigation was rejected: ${clipped(command.result.errorText, 200)}`, { outcome: "rejected" });
    }
    this._clearSessionLocators(sessionKey(sessionRef));
    const waitUntil = action.waitUntil || "load";
    const timeoutMs = action.timeoutMs || BROWSER_AUTOMATION_DEFAULT_WAIT_MS;
    const deadline = Date.now() + timeoutMs;
    const expectedLoaderId = command.result?.loaderId || "";
    let polls = 0;
    try {
      while (Date.now() < deadline) {
        const tree = await this._command(sessionRef, "Page.getFrameTree", {}, commandResults, signal);
        const frame = tree.result?.frameTree?.frame;
        polls += 1;
        const committed = !!frame?.url && (!expectedLoaderId || frame.loaderId === expectedLoaderId);
        if (committed) {
          let readyState = "commit";
          if (waitUntil !== "commit") {
            const ready = await this._command(sessionRef, "Runtime.evaluate", {
              expression: "document.readyState",
              returnByValue: true,
            }, commandResults, signal);
            readyState = String(commandValue(ready) || "");
          }
          const reached = waitUntil === "commit"
            || (waitUntil === "domcontentloaded" && ["interactive", "complete"].includes(readyState))
            || (waitUntil === "load" && readyState === "complete");
          if (reached) {
            return Object.freeze({
              frameId: frame.id || command.result?.frameId || null,
              loaderId: frame.loaderId || command.result?.loaderId || null,
              finalUrl: redactedDocumentUrl(frame.url),
              finalOrigin: httpUrl(frame.url, "browser document URL").origin,
              waitUntil,
              readyState,
              polls,
            });
          }
        }
        await delay(Math.min(WAIT_POLL_MS, Math.max(1, deadline - Date.now())), signal);
      }
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.waitTimeout,
        `browser navigation timed out waiting for ${waitUntil}`, { outcome: "applied", retryable: false });
    } catch (error) {
      if (error && error.outcome === "notSent") {
        error.outcome = "applied";
        error.retryable = false;
      }
      throw error;
    }
  }

  async _documentUrl(sessionRef, commandResults, signal) {
    const tree = await this._command(sessionRef, "Page.getFrameTree", {}, commandResults, signal);
    const value = tree.result?.frameTree?.frame?.url;
    if (!value) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.targetMissing,
        "browser document URL is unavailable", { outcome: "notSent", retryable: true });
    }
    return httpUrl(value, "browser document URL");
  }

  async _cookieUrl(sessionRef, action, commandResults, signal) {
    if (action.url) return httpUrl(action.url, `${action.kind}.url`);
    return this._documentUrl(sessionRef, commandResults, signal);
  }

  async _cookiesGet(sessionRef, action, commandResults, signal) {
    const url = await this._cookieUrl(sessionRef, action, commandResults, signal);
    const command = await this._command(sessionRef, "Network.getCookies", { urls: [url.href] }, commandResults, signal);
    const all = Array.isArray(command.result?.cookies) ? command.result.cookies : [];
    const maxCookies = action.maxCookies || 100;
    const cookies = all.slice(0, maxCookies).map((cookie) => Object.freeze({
      name: clipped(cookie.name || "", 4096),
      domain: clipped(cookie.domain || "", 4096),
      path: clipped(cookie.path || "/", 4096),
      expires: Number(cookie.expires) || 0,
      size: Number(cookie.size) || 0,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      session: cookie.session === true,
      sameSite: cookie.sameSite || null,
      priority: cookie.priority || null,
    }));
    return Object.freeze({ origin: url.origin, cookies: Object.freeze(cookies), truncated: all.length > cookies.length });
  }

  async _cookieSet(sessionRef, action, commandResults, signal) {
    const url = await this._cookieUrl(sessionRef, action, commandResults, signal);
    const command = await this._command(sessionRef, "Network.setCookie", {
      name: action.name,
      value: action.value,
      url: url.href,
      ...(action.path === undefined ? {} : { path: action.path }),
      ...(action.secure === undefined ? {} : { secure: action.secure }),
      ...(action.httpOnly === undefined ? {} : { httpOnly: action.httpOnly }),
      ...(action.sameSite === undefined ? {} : { sameSite: action.sameSite }),
      ...(action.expires === undefined ? {} : { expires: action.expires }),
    }, commandResults, signal);
    if (command.result?.success !== true) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionRejected,
        "browser cookie was not accepted", { outcome: "rejected" });
    }
    return Object.freeze({ name: action.name, origin: url.origin, success: true });
  }

  async _cookieDelete(sessionRef, action, commandResults, signal) {
    const url = await this._cookieUrl(sessionRef, action, commandResults, signal);
    await this._command(sessionRef, "Network.deleteCookies", { name: action.name, url: url.href }, commandResults, signal);
    return Object.freeze({ name: action.name, origin: url.origin, deleted: true });
  }

  async _storage(sessionRef, action, commandResults, signal) {
    const url = await this._documentUrl(sessionRef, commandResults, signal);
    const storageId = Object.freeze({ securityOrigin: url.origin, isLocalStorage: action.area === "local" });
    await this._command(sessionRef, "DOMStorage.enable", {}, commandResults, signal);
    if (action.kind === "storageGet") {
      const command = await this._command(sessionRef, "DOMStorage.getDOMStorageItems", { storageId }, commandResults, signal);
      const raw = Array.isArray(command.result?.entries) ? command.result.entries : [];
      const maxEntries = action.maxEntries || 100;
      const entries = raw.slice(0, maxEntries).map((entry) => Object.freeze({
        key: clipped(entry?.[0] || "", STORAGE_VALUE_LIMIT),
        value: clipped(entry?.[1] || "", STORAGE_VALUE_LIMIT),
      }));
      return Object.freeze({
        origin: url.origin,
        area: action.area,
        entries: Object.freeze(entries),
        truncated: raw.length > entries.length,
        rawBytes: byteLength(raw),
      });
    }
    if (action.kind === "storageSet") {
      await this._command(sessionRef, "DOMStorage.setDOMStorageItem", {
        storageId, key: action.key, value: action.value,
      }, commandResults, signal);
      return Object.freeze({ origin: url.origin, area: action.area, key: action.key, set: true });
    }
    if (action.kind === "storageRemove") {
      await this._command(sessionRef, "DOMStorage.removeDOMStorageItem", {
        storageId, key: action.key,
      }, commandResults, signal);
      return Object.freeze({ origin: url.origin, area: action.area, key: action.key, removed: true });
    }
    await this._command(sessionRef, "DOMStorage.clear", { storageId }, commandResults, signal);
    return Object.freeze({ origin: url.origin, area: action.area, cleared: true });
  }

  async _targetAction(sessionRef, action, commandResults, signal) {
    const prepared = await this._prepareTarget(sessionRef, action, commandResults, signal);
    try {
      let result;
      if (action.kind === "click") {
        result = action.dialog
          ? await this._clickWithDialog(sessionRef, prepared, action, commandResults, signal)
          : action.download
            ? await this._clickWithDownload(sessionRef, prepared, action, commandResults, signal)
            : action.popup
              ? await this._clickWithPopup(sessionRef, prepared, action, commandResults, signal)
          : await this._clickTarget(sessionRef, prepared, commandResults, signal);
      } else if (action.kind === "hover") result = await this._hoverTarget(sessionRef, prepared, commandResults, signal);
      else if (action.kind === "focus") {
        result = await this._callTargetFunction(sessionRef, prepared.target, FOCUS_FUNCTION, [], commandResults, signal);
      } else if (action.kind === "check" || action.kind === "uncheck") {
        result = await this._setChecked(sessionRef, prepared, action.kind === "check", commandResults, signal);
      } else if (action.kind === "upload") {
        result = await this._uploadTarget(sessionRef, prepared, action.files, commandResults, signal);
      } else if (action.kind === "drag") {
        result = await this._dragTarget(sessionRef, prepared, action, commandResults, signal);
      } else if (action.kind === "fill") {
        result = await this._callTargetFunction(
          sessionRef, prepared.target, FILL_FUNCTION, [action.value], commandResults, signal,
        );
        if (result.contenteditable === true) {
          await this._command(sessionRef, "Input.insertText", { text: action.value }, commandResults, signal);
          result = await this._callTargetFunction(
            sessionRef, prepared.target, CONTENTEDITABLE_FILL_RESULT_FUNCTION, [], commandResults, signal,
          );
        }
      } else {
        const functions = {
          select: [SELECT_FUNCTION, [action.values]],
          scroll: [SCROLL_FUNCTION, [action.block || "center"]],
        };
        const [functionDeclaration, args] = functions[action.kind];
        result = await this._callTargetFunction(sessionRef, prepared.target, functionDeclaration, args, commandResults, signal);
      }
      return Object.freeze({
        ...result,
        actionability: Object.freeze({ polls: prepared.polls, scrolled: prepared.scrolled }),
      });
    } finally {
      await this._releaseTarget(sessionRef, prepared.target, commandResults, signal);
    }
  }

  async _callTargetFunction(sessionRef, target, functionDeclaration, args, commandResults, signal) {
    const command = await this._command(sessionRef, "Runtime.callFunctionOn", {
      objectId: target.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, commandResults, signal);
    const scriptError = exceptionText(command);
    if (scriptError) {
      const missing = /target is missing|not an Element|not editable|not a select|not focusable/i.test(scriptError);
      throw automationError(
        missing ? BROWSER_AUTOMATION_ERROR_CODES.targetMissing : BROWSER_AUTOMATION_ERROR_CODES.actionRejected,
        missing ? "browser action target is unavailable" : `browser action script outcome is unknown: ${scriptError}`,
        { outcome: missing ? "rejected" : "outcomeUnknown", retryable: missing },
      );
    }
    return Object.freeze(commandValue(command) || {});
  }

  async _clickTarget(sessionRef, prepared, commandResults, signal) {
    const { x, y } = prepared.status.point;
    await this._command(sessionRef, "Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
    }, commandResults, signal);
    await this._command(sessionRef, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1,
    }, commandResults, signal);
    return Object.freeze({ tag: prepared.status.tag, point: Object.freeze({ x, y }), trusted: true });
  }

  async _clickWithDialog(sessionRef, prepared, action, commandResults, signal) {
    const watcher = this._lifecycle.watch(sessionRef, "Page.javascriptDialogOpening", {
      timeoutMs: action.timeoutMs || BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
      signal,
      timeoutOutcome: "applied",
    });
    const clickPromise = this._clickTarget(sessionRef, prepared, commandResults, signal);
    clickPromise.catch(() => {});
    const clickFailure = clickPromise.then(() => new Promise(() => {}), (error) => Promise.reject(error));
    try {
      const event = await Promise.race([watcher.promise, clickFailure]);
      const accept = action.dialog.decision === "accept";
      await this._command(sessionRef, "Page.handleJavaScriptDialog", {
        accept,
        ...(accept && action.dialog.promptText !== undefined ? { promptText: action.dialog.promptText } : {}),
      }, commandResults, signal);
      const click = await clickPromise;
      return Object.freeze({
        ...click,
        dialog: Object.freeze({
          type: clipped(event.params?.type || "dialog", 40),
          decision: action.dialog.decision,
          hasBrowserHandler: event.params?.hasBrowserHandler === true,
        }),
      });
    } finally {
      watcher.cancel();
    }
  }

  async _clickWithDownload(sessionRef, prepared, action, commandResults, signal) {
    if (!this._download) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionDenied,
        "browser download capture is unavailable", { outcome: "notSent" });
    }
    const captured = await this._download.run({
      sessionRef,
      timeoutMs: action.timeoutMs || BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
      commandResults,
      signal,
      click: () => this._clickTarget(sessionRef, prepared, commandResults, signal),
    });
    return Object.freeze({ ...captured.click, download: captured.artifact });
  }

  async _clickWithPopup(sessionRef, prepared, action, commandResults, signal) {
    const captureRef = await this._port.beginPopupCapture(sessionRef);
    try {
      const click = await this._clickTarget(sessionRef, prepared, commandResults, signal);
      const popup = await this._port.finishPopupCapture(sessionRef, captureRef, {
        timeoutMs: action.timeoutMs || BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
        signal,
      });
      return Object.freeze({ ...click, popup });
    } finally {
      this._port.cancelPopupCapture(captureRef);
    }
  }

  async _hoverTarget(sessionRef, prepared, commandResults, signal) {
    const { x, y } = prepared.status.point;
    await this._command(sessionRef, "Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y, button: "none", buttons: 0,
    }, commandResults, signal);
    return Object.freeze({ tag: prepared.status.tag, point: Object.freeze({ x, y }), trusted: true });
  }

  async _setChecked(sessionRef, prepared, checked, commandResults, signal) {
    const type = prepared.status.type;
    if (prepared.status.tag !== "input" || !["checkbox", "radio"].includes(type) || (!checked && type === "radio")) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.targetMissing,
        `browser ${checked ? "check" : "uncheck"} target has an incompatible control type`,
        { outcome: "notSent" });
    }
    if (prepared.status.checked === checked) return Object.freeze({ type, checked, changed: false });
    await this._clickTarget(sessionRef, prepared, commandResults, signal);
    const state = await this._callTargetFunction(sessionRef, prepared.target, CHECKED_FUNCTION, [], commandResults, signal);
    if (state.checked !== checked) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionRejected,
        `browser ${checked ? "check" : "uncheck"} did not reach the requested state`, { outcome: "outcomeUnknown" });
    }
    return Object.freeze({ type, checked, changed: true });
  }

  async _uploadTarget(sessionRef, prepared, files, commandResults, signal) {
    if (prepared.status.tag !== "input" || prepared.status.type !== "file") {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.targetMissing,
        "browser upload target is not a file input", { outcome: "notSent" });
    }
    await this._command(sessionRef, "DOM.setFileInputFiles", { objectId: prepared.target.objectId, files }, commandResults, signal);
    return this._callTargetFunction(sessionRef, prepared.target, UPLOAD_STATE_FUNCTION, [], commandResults, signal);
  }

  async _dragTarget(sessionRef, source, action, commandResults, signal) {
    const destination = await this._prepareTarget(sessionRef, {
      kind: "drag",
      ...(action.toLocatorRef ? { locatorRef: action.toLocatorRef } : { locator: action.to }),
      timeoutMs: action.timeoutMs,
    }, commandResults, signal);
    const watcher = this._lifecycle.watch(sessionRef, "Input.dragIntercepted", {
      timeoutMs: action.timeoutMs || BROWSER_AUTOMATION_DEFAULT_WAIT_MS,
      signal,
      timeoutOutcome: "outcomeUnknown",
    });
    let interceptEnabled = false;
    try {
      const from = source.status.point;
      const to = destination.status.point;
      await this._command(sessionRef, "Input.setInterceptDrags", { enabled: true }, commandResults, signal);
      interceptEnabled = true;
      await this._command(sessionRef, "Input.dispatchMouseEvent", {
        type: "mouseMoved", x: from.x, y: from.y, button: "none", buttons: 0,
      }, commandResults, signal);
      await this._command(sessionRef, "Input.dispatchMouseEvent", {
        type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1,
      }, commandResults, signal);
      const steps = 6;
      for (let index = 1; index <= steps; index += 1) {
        const ratio = index / steps;
        await this._command(sessionRef, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
          button: "left",
          buttons: 1,
        }, commandResults, signal);
      }
      const intercepted = await watcher.promise;
      const data = intercepted.params?.data;
      if (!data || typeof data !== "object") {
        throw automationError(BROWSER_AUTOMATION_ERROR_CODES.invalidAction,
          "browser drag interception returned no drag data", { outcome: "outcomeUnknown" });
      }
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await this._command(sessionRef, "Input.dispatchDragEvent", {
          type, x: to.x, y: to.y, data,
        }, commandResults, signal);
      }
      await this._command(sessionRef, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1,
      }, commandResults, signal);
      return Object.freeze({
        from: Object.freeze({ x: from.x, y: from.y }),
        to: Object.freeze({ x: to.x, y: to.y }),
        trusted: true,
        destinationActionability: Object.freeze({ polls: destination.polls, scrolled: destination.scrolled }),
      });
    } finally {
      watcher.cancel();
      if (interceptEnabled) {
        await this._command(sessionRef, "Input.setInterceptDrags", { enabled: false }, commandResults, signal);
      }
      await this._releaseTarget(sessionRef, destination.target, commandResults, signal);
    }
  }

  async _press(sessionRef, action, commandResults, signal) {
    let actionability = null;
    if (action.selector || action.locatorRef || action.locator) {
      const prepared = await this._prepareTarget(sessionRef, action, commandResults, signal);
      try {
        await this._callTargetFunction(sessionRef, prepared.target, FOCUS_FUNCTION, [], commandResults, signal);
        actionability = Object.freeze({ polls: prepared.polls, scrolled: prepared.scrolled });
      } finally {
        await this._releaseTarget(sessionRef, prepared.target, commandResults, signal);
      }
    }
    const definition = keyDefinition(action.key);
    const modifiers = modifierBits(action.modifiers);
    const hasCommandModifier = !!(modifiers & (1 | 2 | 4));
    const base = { ...definition, modifiers };
    if (hasCommandModifier) {
      delete base.text;
      delete base.unmodifiedText;
    } else if (definition.text) {
      base.unmodifiedText = definition.text;
    }
    await this._command(sessionRef, "Input.dispatchKeyEvent", { type: "keyDown", ...base }, commandResults, signal);
    await this._command(sessionRef, "Input.dispatchKeyEvent", { type: "keyUp", ...base, text: undefined, unmodifiedText: undefined }, commandResults, signal);
    return Object.freeze({ key: action.key, modifiers: Object.freeze([...(action.modifiers || [])]),
      ...(actionability ? { actionability } : {}) });
  }

  async _prepareTarget(sessionRef, action, commandResults, signal) {
    return waitForBrowserActionability({
      kind: action.kind,
      timeoutMs: action.timeoutMs || BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
      resolveTarget: () => this._resolveActionTarget(sessionRef, action, commandResults, signal),
      inspectTarget: (target, requirements) => this._inspectTarget(sessionRef, target, requirements, commandResults, signal),
      scrollTarget: (target) => this._callTargetFunction(sessionRef, target, SCROLL_FUNCTION, ["center"], commandResults, signal),
      releaseTarget: (target) => this._releaseTarget(sessionRef, target, commandResults, signal),
      signal,
    });
  }

  async _inspectTarget(sessionRef, target, requirements, commandResults, signal, trustedRead = false) {
    const command = await this._sendCommand(sessionRef, "Runtime.callFunctionOn", {
      objectId: target.objectId,
      functionDeclaration: BROWSER_ACTIONABILITY_FUNCTION,
      arguments: [{ value: requirements }],
      returnByValue: true,
    }, commandResults, signal, trustedRead);
    const scriptError = exceptionText(command);
    if (scriptError) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.targetMissing,
        `browser actionability target is unavailable: ${scriptError}`, { outcome: "notSent", retryable: true });
    }
    const status = commandValue(command) || {};
    if (target.pointOffset && !status.topTranslated && status.point) {
      status.point = {
        x: status.point.x + target.pointOffset.x,
        y: status.point.y + target.pointOffset.y,
      };
    }
    return status;
  }

  async _resolveActionTarget(sessionRef, action, commandResults, signal, trustedRead = false) {
    if (action.locatorRef) return this._resolveOpaqueLocator(sessionRef, action.locatorRef, commandResults, signal, trustedRead);
    const locator = actionLocator(action);
    const frame = await this._resolveFrameContext(sessionRef, locator, commandResults, signal, trustedRead);
    if (locator.frame && !frame) return null;
    const command = await this._sendCommand(sessionRef, "Runtime.evaluate", {
      expression: browserLocatorExpression(locator),
      returnByValue: false,
      ...(frame ? { contextId: frame.contextId } : {}),
    }, commandResults, signal, trustedRead);
    const scriptError = exceptionText(command);
    if (scriptError) {
      const count = parseBrowserLocatorCount(scriptError);
      if (count === 0) return null;
      if (count !== null) {
        throw automationError(BROWSER_AUTOMATION_ERROR_CODES.strictLocator,
          `browser locator resolved to ${count} elements: ${describeBrowserLocator(locator)}`,
          { outcome: "notSent", retryable: false });
      }
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.invalidAction,
        `browser locator evaluation failed: ${scriptError}`, { outcome: "notSent" });
    }
    const objectId = command.result?.result?.objectId;
    if (!objectId) return null;
    return Object.freeze({ objectId, description: describeBrowserLocator(locator), contextEpoch: command.contextEpoch,
      ...(frame ? { pointOffset: frame.pointOffset } : {}) });
  }

  async _resolveFrameContext(sessionRef, locator, commandResults, signal, trustedRead = false) {
    if (!locator.frame) return null;
    const treeCommand = await this._sendCommand(sessionRef, "Page.getFrameTree", {}, commandResults, signal, trustedRead);
    let branch = treeCommand.result?.frameTree;
    let authorityUrl = branch?.frame?.url || "";
    for (const frameLocator of locator.frame) {
      const matches = (branch?.childFrames || []).filter((candidate) => {
        const frame = candidate.frame || {};
        if (frameLocator.by === "name") return frame.name === frameLocator.value;
        try { return new URL(frame.url).href === new URL(frameLocator.value).href; }
        catch (error) { return false; }
      });
      if (matches.length === 0) return null;
      if (matches.length !== 1) {
        throw automationError(BROWSER_AUTOMATION_ERROR_CODES.strictLocator,
          `browser frame locator resolved to ${matches.length} frames`, { outcome: "notSent" });
      }
      branch = matches[0];
      try {
        const frameUrl = branch.frame?.url || "";
        if (!/^about:(?:blank|srcdoc)$/.test(frameUrl)) authorityUrl = frameUrl;
        this._port.policy.authorizeTarget({ id: "frame", type: "page", url: authorityUrl, title: "" });
      } catch (error) {
        throw automationError(BROWSER_AUTOMATION_ERROR_CODES.actionDenied,
          "browser frame is outside permission", { outcome: "notSent" });
      }
    }
    const frameId = branch?.frame?.id;
    if (!frameId) return null;
    const isolated = await this._sendCommand(sessionRef, "Page.createIsolatedWorld", {
      frameId,
      worldName: "pyproc-browser-control",
      grantUniveralAccess: false,
    }, commandResults, signal, trustedRead);
    const contextId = isolated.result?.executionContextId;
    if (!Number.isInteger(contextId)) return null;
    const owner = await this._sendCommand(sessionRef, "DOM.getFrameOwner", { frameId }, commandResults, signal, trustedRead);
    const backendNodeId = owner.result?.backendNodeId;
    if (!Number.isInteger(backendNodeId)) return null;
    const box = await this._sendCommand(sessionRef, "DOM.getBoxModel", { backendNodeId }, commandResults, signal, trustedRead);
    const quad = box.result?.model?.content || box.result?.model?.border;
    if (!Array.isArray(quad) || quad.length < 2) return null;
    return Object.freeze({ contextId, pointOffset: Object.freeze({ x: Number(quad[0]) || 0, y: Number(quad[1]) || 0 }) });
  }

  async _resolveOpaqueLocator(sessionRef, locatorRef, commandResults, signal, trustedRead = false) {
    const locator = this._locators.get(locatorRef);
    if (!locator || locator.sessionKey !== sessionKey(sessionRef)) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.staleLocator,
        "browser locator is unknown or belongs to another session", { outcome: "notSent" });
    }
    const guarded = await this._sendCommand(sessionRef, "Page.getFrameTree", {}, commandResults, signal, trustedRead);
    if (guarded.contextEpoch !== locator.contextEpoch) {
      this._clearSessionLocators(locator.sessionKey);
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.staleLocator,
        "browser locator belongs to a replaced document", { outcome: "notSent", retryable: true });
    }
    const resolved = await this._sendCommand(sessionRef, "DOM.resolveNode", {
      backendNodeId: locator.backendNodeId,
    }, commandResults, signal, trustedRead);
    if (resolved.contextEpoch !== locator.contextEpoch) {
      this._clearSessionLocators(locator.sessionKey);
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.staleLocator,
        "browser locator belongs to a replaced document", { outcome: "notSent", retryable: true });
    }
    const objectId = resolved.result?.object?.objectId;
    if (!objectId) {
      throw automationError(BROWSER_AUTOMATION_ERROR_CODES.targetMissing,
        "browser locator target is unavailable", { outcome: "notSent", retryable: true });
    }
    return Object.freeze({ objectId, description: locatorRef, contextEpoch: resolved.contextEpoch });
  }

  async _releaseTarget(sessionRef, target, commandResults, signal, trustedRead = false) {
    if (!target?.objectId) return;
    try {
      await this._sendCommand(sessionRef, "Runtime.releaseObject", { objectId: target.objectId }, commandResults, signal, trustedRead);
    } catch (error) {
      this._audit({ kind: "remoteObjectRelease", risk: "read", state: "failed", code: error?.code || "PYPROC_INTERNAL" });
    }
  }

  async _command(sessionRef, method, params, commandResults, signal) {
    return this._sendCommand(sessionRef, method, params, commandResults, signal, false);
  }

  async _sendCommand(sessionRef, method, params, commandResults, signal, trustedRead) {
    try {
      const result = await this._port.send(sessionRef, {
        method,
        params,
        expectedRisk: trustedRead ? "read" : BROWSER_CONTROL_COMMAND_RISKS[method],
      }, { signal, trustedRead });
      commandResults.push(Object.freeze({ method, result }));
      return result;
    } catch (error) {
      commandResults.push(Object.freeze({ method, error }));
      throw error;
    }
  }

  _clearSessionLocators(key) {
    for (const locatorRef of this._sessionLocators.get(key) || []) this._locators.delete(locatorRef);
    this._sessionLocators.delete(key);
  }

  _issueOpaqueLocator(sessionRef, contextEpoch, backendNodeId) {
    if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return null;
    const key = sessionKey(sessionRef);
    const locatorRef = `locator:${this._idFactory()}`;
    let refs = this._sessionLocators.get(key);
    if (!refs) {
      refs = new Set();
      this._sessionLocators.set(key, refs);
    }
    refs.add(locatorRef);
    this._locators.set(locatorRef, Object.freeze({ sessionKey: key, contextEpoch, backendNodeId }));
    return locatorRef;
  }

  async _captureVisualProbe(sessionRef, entity, visual, context) {
    if (!this._screenshot) {
      throw automationError(APX_ERROR_CODES.visualProviderDenied,
        "APX visual probe requires the screenshot artifact store", { outcome: "notSent" });
    }
    let action;
    if (entity?.geometry?.rect) {
      const rect = entity.geometry.rect;
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      const width = Math.max(1, rect.width - Math.max(0, -rect.x));
      const height = Math.max(1, rect.height - Math.max(0, -rect.y));
      action = { format: "png", inline: true, clip: { x, y, width, height, scale: 1 } };
    } else {
      const page = context.page || {};
      action = { format: "jpeg", quality: 60, inline: true, clip: {
        x: Math.max(0, page.scroll?.x || 0),
        y: Math.max(0, page.scroll?.y || 0),
        width: Math.max(1, page.viewport?.width || 1),
        height: Math.max(1, page.viewport?.height || 1),
        scale: 0.25,
      } };
    }
    const artifact = await this._screenshot.capture(sessionRef, action,
      context.commandResults || [], context.signal);
    return Object.freeze({
      kind: entity ? "entityCrop" : "overview",
      entityRef: entity?.entityRef || null,
      reason: entity?.unresolved?.reason || (visual.overview === "lowResolution" ? "overview" : "requested"),
      artifact,
      provenance: Object.freeze({ mode: "observed", source: "cdp.screenshot", trust: "browser" }),
    });
  }

  _audit(record) {
    try { this._onAudit(Object.freeze({ ...record })); }
    catch (error) {
      throw new Error(`browser automation audit failed: ${error?.message || error}`, { cause: error });
    }
  }
}
