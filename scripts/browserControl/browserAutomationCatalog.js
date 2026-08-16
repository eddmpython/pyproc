// browserAutomationCatalog.js - 고수준 action schema, risk, required method의 SSOT.
import { BROWSER_CONTROL_RISKS } from "./browserControlPolicy.js";
import { BROWSER_LOCATOR_SCHEMA, validateBrowserLocator } from "./browserLocator.js";
import {
  BROWSER_OBSERVATION_EVENTS,
  BROWSER_OBSERVATION_MAX_EVENTS,
  BROWSER_OBSERVATION_MAX_NODES,
  BROWSER_OBSERVATION_METHODS,
  BROWSER_OBSERVATION_PROPERTIES,
} from "./browserObservationCatalog.js";
import {
  BROWSER_SCREENSHOT_FORMATS,
  BROWSER_SCREENSHOT_MAX_CSS_DIMENSION,
  validateBrowserScreenshotBounds,
} from "./browserScreenshot.js";
import {
  APX_LEGACY_REPRESENTATION,
  APX_OBSERVE_PROPERTIES,
  APX_POSTCONDITION_SCHEMA,
  APX_REPRESENTATION,
  perceptionOptionsFromInput,
  validatePerceptionOptions,
} from "../perception/apxCatalog.js";
import { APX_ACTION_CONTEXT_SCHEMA, APX_SITUATION_REPRESENTATION,
  validateActionContext } from "../perception/situationCatalog.js";
import { validatePostcondition } from "../perception/postconditionVerifier.js";

export const BROWSER_AUTOMATION_MAX_ACTIONS = 16;
export const BROWSER_AUTOMATION_DEFAULT_MAX_NODES = 200;
export const BROWSER_AUTOMATION_MAX_NODES = BROWSER_OBSERVATION_MAX_NODES;
export const BROWSER_AUTOMATION_DEFAULT_WAIT_MS = 5000;
export const BROWSER_AUTOMATION_MAX_WAIT_MS = 30000;

const URL_PROPERTY = Object.freeze({ type: "string", format: "uri", minLength: 1, maxLength: 10000 });
const STORAGE_AREA_PROPERTY = Object.freeze({ type: "string", enum: ["local", "session"] });
const SCREENSHOT_CLIP_PROPERTY = Object.freeze({
  type: "object",
  properties: Object.freeze({
    x: { type: "number", minimum: 0, maximum: BROWSER_SCREENSHOT_MAX_CSS_DIMENSION },
    y: { type: "number", minimum: 0, maximum: BROWSER_SCREENSHOT_MAX_CSS_DIMENSION },
    width: { type: "number", exclusiveMinimum: 0, maximum: BROWSER_SCREENSHOT_MAX_CSS_DIMENSION },
    height: { type: "number", exclusiveMinimum: 0, maximum: BROWSER_SCREENSHOT_MAX_CSS_DIMENSION },
    scale: { type: "number", minimum: 0.1, maximum: 3 },
  }),
  required: Object.freeze(["x", "y", "width", "height"]),
  additionalProperties: false,
});

const TARGET_PROPERTIES = Object.freeze({
  selector: { type: "string", minLength: 1, maxLength: 2000 },
  locatorRef: { type: "string", minLength: 1 },
  locator: BROWSER_LOCATOR_SCHEMA,
  timeoutMs: { type: "integer", minimum: 1, maximum: BROWSER_AUTOMATION_MAX_WAIT_MS },
});

const TARGET_RESOLUTION_METHODS = Object.freeze([
  "Page.getFrameTree", "Page.createIsolatedWorld", "DOM.getFrameOwner", "DOM.getBoxModel", "DOM.getNodeForLocation",
  "DOM.resolveNode", "Runtime.evaluate", "Runtime.callFunctionOn", "Runtime.releaseObject",
]);
const TRUSTED_POINTER_METHODS = Object.freeze([...TARGET_RESOLUTION_METHODS, "Input.dispatchMouseEvent"]);
const TRUSTED_DRAG_METHODS = Object.freeze([
  ...TRUSTED_POINTER_METHODS, "Input.setInterceptDrags", "Input.dispatchDragEvent",
]);

function actionSpec({ risk, description, methods, trustedReadMethods = [], events = [], properties = {}, required = [], target = "none" }) {
  const targetRule = target === "required"
    ? {
        oneOf: [
          { required: ["selector"], not: { anyOf: [{ required: ["locatorRef"] }, { required: ["locator"] }] } },
          { required: ["locatorRef"], not: { anyOf: [{ required: ["selector"] }, { required: ["locator"] }] } },
          { required: ["locator"], not: { anyOf: [{ required: ["selector"] }, { required: ["locatorRef"] }] } },
        ],
      }
    : target === "optional"
      ? { not: { anyOf: [
          { required: ["selector", "locatorRef"] },
          { required: ["selector", "locator"] },
          { required: ["locatorRef", "locator"] },
        ] } }
      : {};
  return Object.freeze({
    risk,
    description,
    methods: Object.freeze([...methods]),
    trustedReadMethods: Object.freeze([...trustedReadMethods]),
    events: Object.freeze([...events]),
    schema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        kind: { type: "string" },
        expectedRisk: { type: "string", const: risk },
        ...(risk === "externalEffect" ? { verify: APX_POSTCONDITION_SCHEMA,
          actionContext: APX_ACTION_CONTEXT_SCHEMA } : {}),
        ...properties,
      }),
      required: Object.freeze(["kind", "expectedRisk", ...required]),
      additionalProperties: false,
      ...targetRule,
    }),
  });
}

export const BROWSER_AUTOMATION_ACTIONS = Object.freeze({
  snapshot: actionSpec({
    risk: "read",
    description: "Capture a compact semantic snapshot with optional bounded screenshot, console, and network artifacts.",
    methods: BROWSER_OBSERVATION_METHODS,
    events: BROWSER_OBSERVATION_EVENTS,
    properties: {
      ...BROWSER_OBSERVATION_PROPERTIES,
      ...APX_OBSERVE_PROPERTIES,
      mode: { type: "string", enum: ["all", "interactive"] },
    },
  }),
  screenshot: actionSpec({
    risk: "read",
    description: "Capture a bounded viewport, full-page, or clipped PNG, JPEG, or WebP artifact.",
    methods: ["Page.getLayoutMetrics", "Page.captureScreenshot"],
    properties: {
      format: { type: "string", enum: BROWSER_SCREENSHOT_FORMATS },
      quality: { type: "integer", minimum: 0, maximum: 100 },
      fullPage: { type: "boolean" },
      clip: SCREENSHOT_CLIP_PROPERTY,
      optimizeForSpeed: { type: "boolean" },
      inline: { type: "boolean" },
    },
  }),
  waitFor: actionSpec({
    risk: "read",
    description: "Wait for one selector or semantic locator to reach a user-visible readiness state without client polling.",
    methods: [],
    trustedReadMethods: TARGET_RESOLUTION_METHODS,
    properties: {
      ...TARGET_PROPERTIES,
      state: { type: "string", enum: ["attached", "detached", "visible", "hidden", "enabled", "disabled", "editable", "stable"] },
    },
    target: "required",
  }),
  hydrateLazy: actionSpec({
    risk: "externalEffect",
    description: "Run a bounded viewport sweep to trigger lazy assets, then restore the original scroll position.",
    methods: ["Runtime.evaluate"],
    properties: {
      maxScrolls: { type: "integer", minimum: 1, maximum: 100 },
      settleMs: { type: "integer", minimum: 0, maximum: 2000 },
      timeoutMs: { type: "integer", minimum: 1, maximum: BROWSER_AUTOMATION_MAX_WAIT_MS },
    },
  }),
  navigate: actionSpec({
    risk: "externalEffect",
    description: "Navigate to an allowed HTTP(S) URL and wait for an explicit commit, DOM-ready, or load state.",
    methods: ["Page.navigate", "Page.getFrameTree", "Runtime.evaluate"],
    properties: {
      url: URL_PROPERTY,
      waitUntil: { type: "string", enum: ["commit", "domcontentloaded", "load"] },
      timeoutMs: { type: "integer", minimum: 1, maximum: BROWSER_AUTOMATION_MAX_WAIT_MS },
    },
    required: ["url"],
  }),
  cookiesGet: actionSpec({
    risk: "read",
    description: "List bounded cookie metadata for one allowed URL without returning cookie values.",
    methods: ["Page.getFrameTree", "Network.getCookies"],
    properties: {
      url: URL_PROPERTY,
      maxCookies: { type: "integer", minimum: 1, maximum: 200 },
    },
  }),
  cookieSet: actionSpec({
    risk: "externalEffect",
    description: "Set one cookie for an allowed URL without widening scope through a domain parameter.",
    methods: ["Page.getFrameTree", "Network.setCookie"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 4096 },
      value: { type: "string", maxLength: 65536 },
      url: URL_PROPERTY,
      path: { type: "string", minLength: 1, maxLength: 4096 },
      secure: { type: "boolean" },
      httpOnly: { type: "boolean" },
      sameSite: { type: "string", enum: ["Strict", "Lax", "None"] },
      expires: { type: "number", minimum: 0 },
    },
    required: ["name", "value"],
  }),
  cookieDelete: actionSpec({
    risk: "externalEffect",
    description: "Delete one named cookie at an allowed URL.",
    methods: ["Page.getFrameTree", "Network.deleteCookies"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 4096 },
      url: URL_PROPERTY,
    },
    required: ["name"],
  }),
  storageGet: actionSpec({
    risk: "read",
    description: "Read a bounded view of localStorage or sessionStorage for the attached allowed origin.",
    methods: ["Page.getFrameTree", "DOMStorage.enable", "DOMStorage.getDOMStorageItems"],
    properties: {
      area: STORAGE_AREA_PROPERTY,
      maxEntries: { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["area"],
  }),
  storageSet: actionSpec({
    risk: "externalEffect",
    description: "Set one localStorage or sessionStorage entry for the attached allowed origin.",
    methods: ["Page.getFrameTree", "DOMStorage.enable", "DOMStorage.setDOMStorageItem"],
    properties: {
      area: STORAGE_AREA_PROPERTY,
      key: { type: "string", minLength: 1, maxLength: 10000 },
      value: { type: "string", maxLength: 100000 },
    },
    required: ["area", "key", "value"],
  }),
  storageRemove: actionSpec({
    risk: "externalEffect",
    description: "Remove one localStorage or sessionStorage entry for the attached allowed origin.",
    methods: ["Page.getFrameTree", "DOMStorage.enable", "DOMStorage.removeDOMStorageItem"],
    properties: {
      area: STORAGE_AREA_PROPERTY,
      key: { type: "string", minLength: 1, maxLength: 10000 },
    },
    required: ["area", "key"],
  }),
  storageClear: actionSpec({
    risk: "externalEffect",
    description: "Clear localStorage or sessionStorage for the attached allowed origin.",
    methods: ["Page.getFrameTree", "DOMStorage.enable", "DOMStorage.clear"],
    properties: { area: STORAGE_AREA_PROPERTY },
    required: ["area"],
  }),
  click: actionSpec({
    risk: "externalEffect",
    description: "Click exactly one target, with an optional declared dialog, download, or popup lifecycle effect.",
    methods: [...TRUSTED_POINTER_METHODS, "Page.handleJavaScriptDialog", "Page.setDownloadBehavior"],
    events: ["Page.javascriptDialogOpening", "Page.downloadWillBegin", "Page.downloadProgress"],
    properties: {
      ...TARGET_PROPERTIES,
      dialog: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["accept", "dismiss"] },
          promptText: { type: "string", maxLength: 10000 },
        },
        required: ["decision"],
        additionalProperties: false,
      },
      download: { type: "boolean", const: true },
      popup: { type: "boolean", const: true },
    },
    target: "required",
  }),
  hover: actionSpec({
    risk: "externalEffect",
    description: "Move trusted pointer input to one actionability-checked target.",
    methods: TRUSTED_POINTER_METHODS,
    properties: TARGET_PROPERTIES,
    target: "required",
  }),
  focus: actionSpec({
    risk: "externalEffect",
    description: "Focus exactly one visible and enabled target.",
    methods: TARGET_RESOLUTION_METHODS,
    properties: TARGET_PROPERTIES,
    target: "required",
  }),
  check: actionSpec({
    risk: "externalEffect",
    description: "Set a checkbox or radio to checked using trusted pointer input and verify the state.",
    methods: TRUSTED_POINTER_METHODS,
    properties: TARGET_PROPERTIES,
    target: "required",
  }),
  uncheck: actionSpec({
    risk: "externalEffect",
    description: "Set a checkbox to unchecked using trusted pointer input and verify the state.",
    methods: TRUSTED_POINTER_METHODS,
    properties: TARGET_PROPERTIES,
    target: "required",
  }),
  drag: actionSpec({
    risk: "externalEffect",
    description: "Drag one actionability-checked target to one strict semantic destination with trusted pointer input.",
    methods: TRUSTED_DRAG_METHODS,
    events: ["Input.dragIntercepted"],
    properties: {
      ...TARGET_PROPERTIES,
      to: BROWSER_LOCATOR_SCHEMA,
      toLocatorRef: { type: "string", minLength: 1 },
    },
    target: "required",
  }),
  fill: actionSpec({
    risk: "externalEffect",
    description: "Fill an input or textarea through its native setter, or a contenteditable through trusted text input.",
    methods: [...TARGET_RESOLUTION_METHODS, "Input.insertText"],
    properties: {
      ...TARGET_PROPERTIES,
      value: { type: "string", maxLength: 100000 },
    },
    required: ["value"],
    target: "required",
  }),
  press: actionSpec({
    risk: "externalEffect",
    description: "Press a keyboard key, optionally after focusing a selector or locator.",
    methods: [...TARGET_RESOLUTION_METHODS, "Input.dispatchKeyEvent"],
    properties: {
      ...TARGET_PROPERTIES,
      key: { type: "string", minLength: 1, maxLength: 40 },
      modifiers: {
        type: "array",
        items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] },
        uniqueItems: true,
        maxItems: 4,
      },
    },
    required: ["key"],
    target: "optional",
  }),
  select: actionSpec({
    risk: "externalEffect",
    description: "Select option values and dispatch input/change.",
    methods: TARGET_RESOLUTION_METHODS,
    properties: {
      ...TARGET_PROPERTIES,
      values: {
        type: "array",
        items: { type: "string", maxLength: 10000 },
        minItems: 1,
        maxItems: 100,
      },
    },
    required: ["values"],
    target: "required",
  }),
  scroll: actionSpec({
    risk: "externalEffect",
    description: "Scroll a selector or locator into view. Conservatively classified for lazy-load effects.",
    methods: TARGET_RESOLUTION_METHODS,
    properties: {
      ...TARGET_PROPERTIES,
      block: { type: "string", enum: ["start", "center", "end", "nearest"] },
    },
    target: "required",
  }),
  upload: actionSpec({
    risk: "externalEffect",
    description: "Set files on one file input after filesystem root authorization.",
    methods: [...TARGET_RESOLUTION_METHODS, "DOM.setFileInputFiles"],
    properties: {
      ...TARGET_PROPERTIES,
      files: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 10000 },
        minItems: 1,
        maxItems: 16,
      },
    },
    required: ["files"],
    target: "required",
  }),
});

export const BROWSER_AUTOMATION_DEFAULT_ACTIONS = Object.freeze(["snapshot", "screenshot", "waitFor"]);

function fail(message) {
  const error = new TypeError(message);
  error.code = "BROWSER_AUTOMATION_INVALID_ACTION";
  throw error;
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function requireString(value, label, { min = 1, max = Infinity } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) fail(`${label} must be a valid string`);
}

function validateTarget(action, { optional = false } = {}) {
  const selector = action.selector !== undefined;
  const locatorRef = action.locatorRef !== undefined;
  const locator = action.locator !== undefined;
  const targets = Number(selector) + Number(locatorRef) + Number(locator);
  if (targets > 1) fail(`${action.kind} accepts exactly one of selector, locatorRef, or locator`);
  if (!optional && targets === 0) fail(`${action.kind} requires selector, locatorRef, or locator`);
  if (selector) requireString(action.selector, `${action.kind}.selector`, { max: 2000 });
  if (locatorRef) requireString(action.locatorRef, `${action.kind}.locatorRef`);
  if (locator) validateBrowserLocator(action.locator);
  if (action.timeoutMs !== undefined) validateInteger(action.timeoutMs, `${action.kind}.timeoutMs`, 1, BROWSER_AUTOMATION_MAX_WAIT_MS);
}

function validateInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}`);
}

function allowedKeys(action, spec) {
  const allowed = new Set(Object.keys(spec.schema.properties));
  for (const key of Object.keys(action)) if (!allowed.has(key)) fail(`${action.kind} does not accept ${key}`);
}

export function validateBrowserAutomationAction(action) {
  requirePlainObject(action, "browser action");
  requireString(action.kind, "browser action kind");
  if (!Object.hasOwn(BROWSER_AUTOMATION_ACTIONS, action.kind)) fail(`unknown browser action: ${action.kind}`);
  const spec = BROWSER_AUTOMATION_ACTIONS[action.kind];
  allowedKeys(action, spec);
  if (action.expectedRisk !== spec.risk) {
    fail(`browser action risk acknowledgement mismatch: expected ${action.expectedRisk}, actual ${spec.risk}`);
  }
  if (action.kind === "snapshot" && action.maxNodes !== undefined) {
    validateInteger(action.maxNodes, "snapshot.maxNodes", 1, BROWSER_AUTOMATION_MAX_NODES);
  }
  if (action.kind === "snapshot") {
    if (action.continuationRef !== undefined) {
      requireString(action.continuationRef, "snapshot.continuationRef", { min: 14, max: 173 });
      if (!/^continuation:[A-Za-z0-9_-]+$/u.test(action.continuationRef)) {
        fail("snapshot.continuationRef is invalid");
      }
      const incompatible = ["mode", "maxNodes", "includeScreenshot", "includeConsole", "includeNetwork", "maxEvents",
        "representation", "profile", "since", "query", "focus", "visual", "budget", "channels"]
        .find((key) => action[key] !== undefined);
      if (incompatible) fail(`snapshot continuation does not accept ${incompatible}`);
    }
    if (action.mode !== undefined && !["all", "interactive"].includes(action.mode)) {
      fail("snapshot.mode must be all or interactive");
    }
    for (const key of ["includeScreenshot", "includeConsole", "includeNetwork"]) {
      if (action[key] !== undefined && typeof action[key] !== "boolean") fail(`snapshot.${key} must be boolean`);
    }
    if (action.maxEvents !== undefined) validateInteger(action.maxEvents, "snapshot.maxEvents", 1, BROWSER_OBSERVATION_MAX_EVENTS);
    const apxFields = ["profile", "since", "query", "focus", "visual", "budget", "channels"]
      .filter((key) => action[key] !== undefined);
    if ([APX_REPRESENTATION, APX_SITUATION_REPRESENTATION].includes(action.representation)) {
      for (const key of ["mode", "maxNodes", "continuationRef", "includeScreenshot", "includeConsole", "includeNetwork", "maxEvents"]) {
        if (action[key] !== undefined) fail(`APX snapshot does not accept legacy option ${key}`);
      }
      validatePerceptionOptions(perceptionOptionsFromInput(action));
    } else if (action.representation !== undefined && action.representation !== APX_LEGACY_REPRESENTATION) {
      fail("snapshot.representation is invalid");
    } else if (apxFields.length) {
      fail(`legacy snapshot does not accept APX option ${apxFields[0]}`);
    }
  }
  if (action.actionContext !== undefined) validateActionContext(action.actionContext);
  if (action.kind === "drag") {
    const destinations = Number(action.to !== undefined) + Number(action.toLocatorRef !== undefined);
    if (destinations !== 1) fail("drag requires exactly one of to or toLocatorRef");
    if (action.to !== undefined) validateBrowserLocator(action.to);
    if (action.toLocatorRef !== undefined) requireString(action.toLocatorRef, "drag.toLocatorRef");
  }
  if (action.kind === "screenshot") {
    if (action.format !== undefined && !BROWSER_SCREENSHOT_FORMATS.includes(action.format)) {
      fail("screenshot.format is invalid");
    }
    if (action.quality !== undefined) {
      validateInteger(action.quality, "screenshot.quality", 0, 100);
      if ((action.format || "png") === "png") fail("screenshot.quality is only valid for JPEG or WebP");
    }
    for (const key of ["fullPage", "optimizeForSpeed", "inline"]) {
      if (action[key] !== undefined && typeof action[key] !== "boolean") fail(`screenshot.${key} must be boolean`);
    }
    if (action.fullPage === true && action.clip !== undefined) fail("screenshot accepts fullPage or clip, not both");
    if (action.clip !== undefined) {
      requirePlainObject(action.clip, "screenshot.clip");
      for (const key of Object.keys(action.clip)) {
        if (!["x", "y", "width", "height", "scale"].includes(key)) fail(`screenshot.clip does not accept ${key}`);
      }
      for (const key of ["x", "y", "width", "height"]) {
        if (typeof action.clip[key] !== "number" || !Number.isFinite(action.clip[key])) fail(`screenshot.clip.${key} must be finite`);
      }
      if (action.clip.scale !== undefined && (typeof action.clip.scale !== "number" || !Number.isFinite(action.clip.scale))) {
        fail("screenshot.clip.scale must be finite");
      }
      validateBrowserScreenshotBounds({ source: "clip", ...action.clip, scale: action.clip.scale ?? 1 });
    }
  }
  if (action.kind === "waitFor") {
    validateTarget(action);
    if (action.state !== undefined && !["attached", "detached", "visible", "hidden", "enabled", "disabled",
      "editable", "stable"].includes(action.state)) {
      fail("waitFor.state is invalid");
    }
    if (action.timeoutMs !== undefined) validateInteger(action.timeoutMs, "waitFor.timeoutMs", 1, BROWSER_AUTOMATION_MAX_WAIT_MS);
  }
  if (action.kind === "hydrateLazy") {
    if (action.maxScrolls !== undefined) validateInteger(action.maxScrolls, "hydrateLazy.maxScrolls", 1, 100);
    if (action.settleMs !== undefined) validateInteger(action.settleMs, "hydrateLazy.settleMs", 0, 2000);
    if (action.timeoutMs !== undefined) validateInteger(action.timeoutMs, "hydrateLazy.timeoutMs", 1, BROWSER_AUTOMATION_MAX_WAIT_MS);
  }
  if (action.kind === "navigate") {
    requireString(action.url, "navigate.url", { max: 10000 });
    if (action.waitUntil !== undefined && !["commit", "domcontentloaded", "load"].includes(action.waitUntil)) {
      fail("navigate.waitUntil is invalid");
    }
    if (action.timeoutMs !== undefined) validateInteger(action.timeoutMs, "navigate.timeoutMs", 1, BROWSER_AUTOMATION_MAX_WAIT_MS);
  }
  if (["cookiesGet", "cookieSet", "cookieDelete"].includes(action.kind) && action.url !== undefined) {
    requireString(action.url, `${action.kind}.url`, { max: 10000 });
  }
  if (action.kind === "cookiesGet" && action.maxCookies !== undefined) {
    validateInteger(action.maxCookies, "cookiesGet.maxCookies", 1, 200);
  }
  if (["cookieSet", "cookieDelete"].includes(action.kind)) {
    requireString(action.name, `${action.kind}.name`, { max: 4096 });
  }
  if (action.kind === "cookieSet") {
    requireString(action.value, "cookieSet.value", { min: 0, max: 65536 });
    if (action.path !== undefined) requireString(action.path, "cookieSet.path", { max: 4096 });
    for (const key of ["secure", "httpOnly"]) {
      if (action[key] !== undefined && typeof action[key] !== "boolean") fail(`cookieSet.${key} must be boolean`);
    }
    if (action.sameSite !== undefined && !["Strict", "Lax", "None"].includes(action.sameSite)) fail("cookieSet.sameSite is invalid");
    if (action.expires !== undefined
      && (typeof action.expires !== "number" || !Number.isFinite(action.expires) || action.expires < 0)) {
      fail("cookieSet.expires must be a non-negative number");
    }
  }
  if (["storageGet", "storageSet", "storageRemove", "storageClear"].includes(action.kind)
    && !["local", "session"].includes(action.area)) fail(`${action.kind}.area is invalid`);
  if (action.kind === "storageGet" && action.maxEntries !== undefined) {
    validateInteger(action.maxEntries, "storageGet.maxEntries", 1, 200);
  }
  if (["storageSet", "storageRemove"].includes(action.kind)) {
    requireString(action.key, `${action.kind}.key`, { max: 10000 });
  }
  if (action.kind === "storageSet") requireString(action.value, "storageSet.value", { min: 0, max: 100000 });
  if (["click", "hover", "focus", "check", "uncheck", "drag", "fill", "select", "scroll", "upload"].includes(action.kind)) validateTarget(action);
  if (action.kind === "press") validateTarget(action, { optional: true });
  if (action.kind === "fill") requireString(action.value, "fill.value", { min: 0, max: 100000 });
  if (action.kind === "click" && action.dialog !== undefined) {
    requirePlainObject(action.dialog, "click.dialog");
    for (const key of Object.keys(action.dialog)) if (!["decision", "promptText"].includes(key)) fail(`click.dialog does not accept ${key}`);
    if (!["accept", "dismiss"].includes(action.dialog.decision)) fail("click.dialog.decision is invalid");
    if (action.dialog.promptText !== undefined) requireString(action.dialog.promptText, "click.dialog.promptText", { min: 0, max: 10000 });
    if (action.dialog.decision === "dismiss" && action.dialog.promptText !== undefined) fail("dismissed dialog does not accept promptText");
  }
  if (action.kind === "click" && action.download !== undefined && action.download !== true) fail("click.download must be true");
  if (action.kind === "click" && action.popup !== undefined && action.popup !== true) fail("click.popup must be true");
  if (action.kind === "click" && Number(!!action.dialog) + Number(!!action.download) + Number(!!action.popup) > 1) {
    fail("click accepts one lifecycle expectation");
  }
  if (action.kind === "press") {
    requireString(action.key, "press.key", { max: 40 });
    if (action.modifiers !== undefined) {
      if (!Array.isArray(action.modifiers) || action.modifiers.length > 4
        || action.modifiers.some((value) => !["Alt", "Control", "Meta", "Shift"].includes(value))
        || new Set(action.modifiers).size !== action.modifiers.length) fail("press.modifiers is invalid");
    }
  }
  if (action.kind === "select") {
    if (!Array.isArray(action.values) || action.values.length < 1 || action.values.length > 100) fail("select.values is invalid");
    for (const value of action.values) requireString(value, "select.values entry", { min: 0, max: 10000 });
  }
  if (action.kind === "scroll" && action.block !== undefined
    && !["start", "center", "end", "nearest"].includes(action.block)) fail("scroll.block is invalid");
  if (action.kind === "upload") {
    if (!Array.isArray(action.files) || action.files.length < 1 || action.files.length > 16) fail("upload.files is invalid");
    for (const value of action.files) requireString(value, "upload.files entry", { max: 10000 });
  }
  if (action.kind === "drag") validateBrowserLocator(action.to);
  if (action.verify !== undefined) validatePostcondition(action.verify);
  return Object.freeze({ ...action });
}

export function validateBrowserAutomationActions(actions) {
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > BROWSER_AUTOMATION_MAX_ACTIONS) {
    fail(`browser actions must contain 1 to ${BROWSER_AUTOMATION_MAX_ACTIONS} entries`);
  }
  return Object.freeze(actions.map(validateBrowserAutomationAction));
}

export function createBrowserActionSchema(actionNames) {
  const names = [...actionNames];
  for (const name of names) if (!Object.hasOwn(BROWSER_AUTOMATION_ACTIONS, name)) fail(`unknown browser action: ${name}`);
  return Object.freeze({
    oneOf: Object.freeze(names.map((name) => {
      const spec = BROWSER_AUTOMATION_ACTIONS[name];
      return {
        ...spec.schema,
        properties: { ...spec.schema.properties, kind: { type: "string", const: name } },
      };
    })),
  });
}

export function inspectBrowserAutomationActions(actionNames = Object.keys(BROWSER_AUTOMATION_ACTIONS)) {
  return Object.freeze(actionNames.map((name) => {
    const spec = BROWSER_AUTOMATION_ACTIONS[name];
    if (!spec) fail(`unknown browser action: ${name}`);
    return Object.freeze({ name, risk: spec.risk, methods: spec.methods, trustedReadMethods: spec.trustedReadMethods,
      events: spec.events, description: spec.description });
  }));
}

export function assertBrowserAutomationRisk(actionNames, maxRisk) {
  if (!Object.hasOwn(BROWSER_CONTROL_RISKS, maxRisk)) fail(`unsupported browser max risk: ${maxRisk}`);
  for (const name of actionNames) {
    const spec = BROWSER_AUTOMATION_ACTIONS[name];
    if (!spec) fail(`unknown browser action: ${name}`);
    if (BROWSER_CONTROL_RISKS[spec.risk] > BROWSER_CONTROL_RISKS[maxRisk]) {
      fail(`browser action ${name} exceeds max risk ${maxRisk}`);
    }
  }
}
