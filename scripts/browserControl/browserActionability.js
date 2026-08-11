// browserActionability.js - 외부 효과 전에만 반복하는 actionability 판정기.
import { BrowserControlError, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";

export const BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS = 5000;
export const BROWSER_ACTIONABILITY_MAX_TIMEOUT_MS = 30000;
export const BROWSER_ACTIONABILITY_POLL_MS = 50;
export const BROWSER_ACTIONABILITY_STABLE_POLLS = 2;

export const BROWSER_ACTIONABILITY_FUNCTION = `function(requirements) {
  "use strict";
  if (!this || this.nodeType !== 1) throw new Error("browser action target is not an Element");
  const rect = this.getBoundingClientRect();
  const style = getComputedStyle(this);
  const connected = this.isConnected;
  const visible = connected && style.display !== "none" && style.visibility !== "hidden"
    && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  const enabled = !this.matches(":disabled") && this.getAttribute("aria-disabled") !== "true";
  const editable = this.isContentEditable || ((this.tagName === "INPUT" || this.tagName === "TEXTAREA")
    && !this.readOnly && !this.disabled && this.type !== "hidden");
  const viewportWidth = this.ownerDocument.defaultView.innerWidth;
  const viewportHeight = this.ownerDocument.defaultView.innerHeight;
  const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(0, viewportWidth - 1));
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(0, viewportHeight - 1));
  const root = this.getRootNode();
  let hit = root && typeof root.elementFromPoint === "function" ? root.elementFromPoint(x, y)
    : this.ownerDocument.elementFromPoint(x, y);
  const composedContains = (ancestor, node) => {
    let cursor = node;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = cursor.parentNode || cursor.host || null;
    }
    return false;
  };
  const receivesEvents = inViewport && !!hit && (composedContains(this, hit) || composedContains(hit, this));
  let topX = x;
  let topY = y;
  let topTranslated = false;
  let view = this.ownerDocument.defaultView;
  while (view && view !== view.top) {
    const frame = view.frameElement;
    if (!frame) break;
    const frameRect = frame.getBoundingClientRect();
    topX += frameRect.left;
    topY += frameRect.top;
    topTranslated = true;
    view = view.parent;
  }
  const reasons = [];
  if (!connected) reasons.push("notAttached");
  if (requirements.visible && !visible) reasons.push("notVisible");
  if (requirements.enabled && !enabled) reasons.push("notEnabled");
  if (requirements.editable && !editable) reasons.push("notEditable");
  if (requirements.receivesEvents && !receivesEvents) reasons.push(inViewport ? "intercepted" : "outsideViewport");
  return {
    tag: this.tagName.toLowerCase(),
    type: String(this.getAttribute("type") || "").toLowerCase(),
    checked: "checked" in this ? this.checked === true : null,
    connected,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    point: { x: topX, y: topY },
    topTranslated,
    visible,
    enabled,
    editable,
    inViewport,
    receivesEvents,
    needsScroll: visible && !inViewport,
    reasons,
  };
}`;

const REQUIREMENTS = Object.freeze({
  click: Object.freeze({ visible: true, stable: true, enabled: true, receivesEvents: true }),
  check: Object.freeze({ visible: true, stable: true, enabled: true, receivesEvents: true }),
  drag: Object.freeze({ visible: true, stable: true, receivesEvents: true }),
  fill: Object.freeze({ visible: true, stable: true, enabled: true, editable: true }),
  focus: Object.freeze({ visible: true, stable: true, enabled: true }),
  hover: Object.freeze({ visible: true, stable: true, receivesEvents: true }),
  press: Object.freeze({ visible: true, stable: true, enabled: true }),
  select: Object.freeze({ visible: true, stable: true, enabled: true }),
  scroll: Object.freeze({ visible: true }),
  uncheck: Object.freeze({ visible: true, stable: true, enabled: true, receivesEvents: true }),
  upload: Object.freeze({ visible: true, stable: true, enabled: true }),
});

function sameRect(left, right) {
  if (!left || !right) return false;
  return ["x", "y", "width", "height"].every((key) => Math.abs(Number(left[key]) - Number(right[key])) <= 0.25);
}

function delay(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
      "browser actionability was cancelled before send", { outcome: "notSent" }));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
        "browser actionability was cancelled before send", { outcome: "notSent" }));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function browserActionabilityRequirements(kind) {
  return REQUIREMENTS[kind] || Object.freeze({});
}

export async function waitForBrowserActionability({
  kind,
  timeoutMs = BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
  resolveTarget,
  inspectTarget,
  scrollTarget,
  releaseTarget = async () => {},
  signal,
} = {}) {
  if (!Object.hasOwn(REQUIREMENTS, kind)) throw new TypeError(`actionability is not defined for ${kind}`);
  if (![resolveTarget, inspectTarget, scrollTarget, releaseTarget].every((entry) => typeof entry === "function")) {
    throw new TypeError("actionability callbacks are required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BROWSER_ACTIONABILITY_MAX_TIMEOUT_MS) {
    throw new TypeError("actionability timeout is invalid");
  }
  const requirements = REQUIREMENTS[kind];
  const deadline = Date.now() + timeoutMs;
  let previousRect = null;
  let stablePolls = 0;
  let polls = 0;
  let scrolled = false;
  let lastReasons = ["notAttached"];
  let target = null;
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
      "browser actionability was cancelled before send", { outcome: scrolled ? "applied" : "notSent" });
    if (!target) target = await resolveTarget();
    if (target) {
      try {
        const status = await inspectTarget(target, requirements);
        polls += 1;
        lastReasons = status.reasons || [];
        if (!status.connected) {
          await releaseTarget(target);
          target = null;
          previousRect = null;
          stablePolls = 0;
        } else if (status.needsScroll) {
          await scrollTarget(target);
          scrolled = true;
          previousRect = null;
          stablePolls = 0;
        } else {
          stablePolls = requirements.stable && sameRect(previousRect, status.rect) ? stablePolls + 1 : 0;
          previousRect = status.rect;
          const baseReady = (!requirements.visible || status.visible)
            && (!requirements.enabled || status.enabled)
            && (!requirements.editable || status.editable)
            && (!requirements.receivesEvents || status.receivesEvents);
          const stable = !requirements.stable || stablePolls >= BROWSER_ACTIONABILITY_STABLE_POLLS;
          if (baseReady && stable) {
            return Object.freeze({ target, status: Object.freeze(status), polls, scrolled });
          }
        }
      } catch (error) {
        if (!error?.retryable || error?.outcome === "outcomeUnknown") throw error;
        await releaseTarget(target);
        target = null;
        previousRect = null;
        stablePolls = 0;
      }
    } else {
      previousRect = null;
      stablePolls = 0;
      lastReasons = ["notAttached"];
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(BROWSER_ACTIONABILITY_POLL_MS, remaining), signal);
  }
  if (target) await releaseTarget(target);
  const error = new BrowserControlError("BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT",
    `browser ${kind} actionability timed out (${lastReasons.join(",") || "notStable"})`,
    { outcome: scrolled ? "applied" : "notSent", retryable: !scrolled });
  error.actionability = Object.freeze({ kind, polls, scrolled, reasons: Object.freeze([...lastReasons]) });
  throw error;
}
