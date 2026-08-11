// browserLocator.js - strict semantic locator 계약과 broker-owned resolver script.

export const BROWSER_LOCATOR_KINDS = Object.freeze(["css", "role", "text", "label", "testId"]);
export const BROWSER_LOCATOR_MAX_VALUE = 2000;
export const BROWSER_LOCATOR_MAX_FRAME_DEPTH = 8;

const LOCATOR_COUNT_TOKEN = "__PYPROC_LOCATOR_COUNT__:";

export const BROWSER_FRAME_LOCATOR_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    by: { type: "string", enum: ["url", "name"] },
    value: { type: "string", minLength: 1, maxLength: 10000 },
  }),
  required: Object.freeze(["by", "value"]),
  additionalProperties: false,
});

export const BROWSER_LOCATOR_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    by: { type: "string", enum: BROWSER_LOCATOR_KINDS },
    value: { type: "string", minLength: 1, maxLength: BROWSER_LOCATOR_MAX_VALUE },
    name: { type: "string", minLength: 1, maxLength: BROWSER_LOCATOR_MAX_VALUE },
    exact: { type: "boolean" },
    shadow: { type: "string", const: "open" },
    frame: {
      type: "array",
      items: BROWSER_FRAME_LOCATOR_SCHEMA,
      minItems: 1,
      maxItems: BROWSER_LOCATOR_MAX_FRAME_DEPTH,
    },
  }),
  required: Object.freeze(["by", "value"]),
  additionalProperties: false,
});

function fail(message) {
  const error = new TypeError(message);
  error.code = "BROWSER_AUTOMATION_INVALID_ACTION";
  throw error;
}

export function validateBrowserLocator(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("browser locator must be an object");
  const allowed = new Set(["by", "value", "name", "exact", "shadow", "frame"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`browser locator does not accept ${key}`);
  if (!BROWSER_LOCATOR_KINDS.includes(input.by)) fail(`browser locator kind is invalid: ${String(input.by)}`);
  if (typeof input.value !== "string" || input.value.length < 1 || input.value.length > BROWSER_LOCATOR_MAX_VALUE) {
    fail("browser locator value must be a non-empty string up to 2000 characters");
  }
  if (input.name !== undefined && (input.by !== "role" || typeof input.name !== "string"
    || input.name.length < 1 || input.name.length > BROWSER_LOCATOR_MAX_VALUE)) {
    fail("browser locator name is valid only for role locators and must be non-empty");
  }
  if (input.exact !== undefined && typeof input.exact !== "boolean") fail("browser locator exact must be boolean");
  if (input.shadow !== undefined && input.shadow !== "open") fail("browser locator supports only open shadow roots");
  let frame;
  if (input.frame !== undefined) {
    if (!Array.isArray(input.frame) || input.frame.length < 1 || input.frame.length > BROWSER_LOCATOR_MAX_FRAME_DEPTH) {
      fail(`browser locator frame must contain 1 to ${BROWSER_LOCATOR_MAX_FRAME_DEPTH} entries`);
    }
    frame = input.frame.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || !["url", "name"].includes(entry.by)
        || typeof entry.value !== "string" || entry.value.length < 1 || entry.value.length > 10000
        || Object.keys(entry).some((key) => !["by", "value"].includes(key))) {
        fail("browser frame locator is invalid");
      }
      if (entry.by === "url") {
        let parsed;
        try { parsed = new URL(entry.value); } catch (error) { fail("browser frame locator URL is invalid"); }
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
          fail("browser frame locator URL must use HTTP(S) without credentials");
        }
      }
      return Object.freeze({ by: entry.by, value: entry.value });
    });
  }
  return Object.freeze({ by: input.by, value: input.value, ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.exact === undefined ? {} : { exact: input.exact }),
    ...(input.shadow === undefined ? {} : { shadow: input.shadow }), ...(frame ? { frame: Object.freeze(frame) } : {}) });
}

export function actionLocator(action) {
  if (action.locator) return validateBrowserLocator(action.locator);
  if (action.selector) return Object.freeze({ by: "css", value: action.selector, exact: true });
  return null;
}

export function browserLocatorExpression(locatorInput) {
  const locator = validateBrowserLocator(locatorInput);
  return `(() => {
    "use strict";
    const locator = ${JSON.stringify(locator)};
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const same = (actual, expected) => locator.exact === false
      ? normalize(actual).includes(normalize(expected))
      : normalize(actual) === normalize(expected);
    const roots = [];
    const elements = [];
    const visit = (root) => {
      if (!root || roots.includes(root)) return;
      roots.push(root);
      for (const element of root.querySelectorAll("*")) {
        elements.push(element);
        if (element.shadowRoot) visit(element.shadowRoot);
        if (element.tagName === "IFRAME") {
          try { if (element.contentDocument) visit(element.contentDocument); } catch (error) {}
        }
      }
    };
    visit(document);
    const implicitRole = (element) => {
      const explicit = element.getAttribute("role");
      if (explicit) return explicit.trim().split(/\\s+/)[0];
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (/^h[1-6]$/.test(tag)) return "heading";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return element.multiple ? "listbox" : "combobox";
      if (tag === "img" && element.hasAttribute("alt")) return "img";
      if (tag !== "input") return "";
      const type = String(element.type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (["hidden"].includes(type)) return "";
      return "textbox";
    };
    const accessibleName = (element) => {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return normalize(ariaLabel);
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const labelled = labelledBy.split(/\\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent || "").join(" ");
        if (normalize(labelled)) return normalize(labelled);
      }
      if (element.labels?.length) return normalize(Array.from(element.labels, (label) => label.textContent).join(" "));
      if (element.tagName === "INPUT" && ["button", "submit", "reset"].includes(element.type) && element.value) {
        return normalize(element.value);
      }
      return normalize(element.getAttribute("alt") || element.getAttribute("title")
        || element.getAttribute("placeholder") || element.textContent);
    };
    let matches;
    if (locator.by === "css") {
      matches = roots.flatMap((root) => Array.from(root.querySelectorAll(locator.value)));
    } else if (locator.by === "role") {
      matches = elements.filter((element) => implicitRole(element) === locator.value
        && (locator.name === undefined || same(accessibleName(element), locator.name)));
    } else if (locator.by === "label") {
      matches = elements.filter((element) => element.matches("input, textarea, select, [contenteditable='true']")
        && same(accessibleName(element), locator.value));
    } else if (locator.by === "testId") {
      matches = elements.filter((element) => element.getAttribute("data-testid") === locator.value);
    } else {
      const candidates = elements.filter((element) => same(element.innerText || element.textContent, locator.value));
      matches = candidates.filter((element) => !candidates.some((candidate) => candidate !== element && element.contains(candidate)));
    }
    matches = [...new Set(matches)];
    if (matches.length !== 1) throw new Error("${LOCATOR_COUNT_TOKEN}" + matches.length);
    return matches[0];
  })()`;
}

export function parseBrowserLocatorCount(errorText) {
  const match = String(errorText || "").match(/__PYPROC_LOCATOR_COUNT__:(\d+)/);
  return match ? Number(match[1]) : null;
}

export function describeBrowserLocator(locator) {
  const valid = validateBrowserLocator(locator);
  const target = valid.by === "role" && valid.name ? `role=${valid.value}, name=${valid.name}` : `${valid.by}=${valid.value}`;
  return valid.frame ? `frameDepth=${valid.frame.length}; ${target}` : target;
}
