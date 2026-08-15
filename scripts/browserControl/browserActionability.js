// browserActionability.js - 외부 효과 전에만 반복하는 actionability 판정기.
import { BrowserControlError, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";

export const BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS = 5000;
export const BROWSER_ACTIONABILITY_MAX_TIMEOUT_MS = 30000;
export const BROWSER_ACTIONABILITY_POLL_MS = 50;
export const BROWSER_ACTIONABILITY_STABLE_POLLS = 2;
export const BROWSER_ACTIONABILITY_MIN_STABLE_MS = 100;

export function viewportClippedCenter(rect, viewport) {
  const x1 = Number(rect?.x ?? rect?.left);
  const y1 = Number(rect?.y ?? rect?.top);
  const x2 = x1 + Number(rect?.width);
  const y2 = y1 + Number(rect?.height);
  const left = Math.max(0, Math.min(x1, x2));
  const right = Math.min(Number(viewport?.width), Math.max(x1, x2));
  const top = Math.max(0, Math.min(y1, y2));
  const bottom = Math.min(Number(viewport?.height), Math.max(y1, y2));
  if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return Object.freeze({ x: Math.floor((left + right) / 2), y: Math.floor((top + bottom) / 2) });
}

export function mapViewportPointToQuad(point, viewport, quad) {
  if (!Array.isArray(quad) || quad.length !== 8 || !quad.every(Number.isFinite)
    || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)
    || !Number.isFinite(viewport?.width) || !Number.isFinite(viewport?.height)
    || viewport.width <= 0 || viewport.height <= 0) return null;
  const area = Math.abs(quad.reduce((sum, value, index) => {
    if (index % 2 !== 0) return sum;
    const next = (index + 2) % quad.length;
    return sum + value * quad[next + 1] - quad[index + 1] * quad[next];
  }, 0) / 2);
  if (area < 0.5) return null;
  const u = point.x / viewport.width;
  const v = point.y / viewport.height;
  const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
  const x = weights.reduce((sum, weight, index) => sum + weight * quad[index * 2], 0);
  const y = weights.reduce((sum, weight, index) => sum + weight * quad[index * 2 + 1], 0);
  return Object.freeze({ x: Math.floor(x), y: Math.floor(y) });
}

export function browserActionabilityFingerprint(status) {
  return JSON.stringify({
    contextEpoch: status?.contextEpoch ?? null,
    targetIdentity: status?.targetIdentity ?? null,
    rect: status?.rect ?? null,
    point: status?.point ?? null,
    connected: status?.connected === true,
    visible: status?.visible === true,
    enabled: status?.enabled === true,
    editable: status?.editable === true,
    hitTargetPath: status?.hitTargetPath ?? null,
    frameChain: status?.frameChain ?? [],
  });
}

export const BROWSER_ACTIONABILITY_FUNCTION = `function(requirements) {
  "use strict";
  if (!this || this.nodeType !== 1) throw new Error("browser action target is not an Element");
  const rect = this.getClientRects()[0] || this.getBoundingClientRect();
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
  const left = Math.max(0, Math.min(rect.x, rect.x + rect.width));
  const right = Math.min(viewportWidth, Math.max(rect.x, rect.x + rect.width));
  const top = Math.max(0, Math.min(rect.y, rect.y + rect.height));
  const bottom = Math.min(viewportHeight, Math.max(rect.y, rect.y + rect.height));
  const x = Math.floor((left + right) / 2);
  const y = Math.floor((top + bottom) / 2);
  const root = this.getRootNode();
  let hit = root && typeof root.elementFromPoint === "function" ? root.elementFromPoint(x, y)
    : this.ownerDocument.elementFromPoint(x, y);
  const composedPath = (ancestor, node) => {
    let cursor = node;
    const path = [];
    while (cursor) {
      if (cursor === ancestor) return path.length ? path.reverse().join("/") : "self";
      const parent = cursor.parentNode || cursor.host || null;
      const index = parent?.children ? Array.prototype.indexOf.call(parent.children, cursor) : -1;
      path.push(String(cursor.localName || cursor.nodeName || "node").toLowerCase() + ":" + index);
      cursor = parent;
    }
    return null;
  };
  const hitTargetPath = inViewport && hit ? composedPath(this, hit) : null;
  let receivesEvents = hitTargetPath !== null;
  let topX = x;
  let topY = y;
  let topTranslated = false;
  const frameChain = [];
  let view = this.ownerDocument.defaultView;
  if (!requirements.hostFrameChain) {
    while (view && view !== view.top) {
      const frame = view.frameElement;
      if (!frame) {
        receivesEvents = false;
        frameChain.push({ owner: "unavailable", parentHitPath: null });
        break;
      }
      const frameRect = frame.getBoundingClientRect();
      const transform = frame.ownerDocument.defaultView.getComputedStyle(frame).transform;
      if (transform && transform !== "none") {
        receivesEvents = false;
        frameChain.push({ owner: "transformed", parentHitPath: null });
        break;
      }
      const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
      const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1;
      topX = frameRect.left + (frame.clientLeft + topX) * scaleX;
      topY = frameRect.top + (frame.clientTop + topY) * scaleY;
      const parentHit = frame.ownerDocument.elementFromPoint(topX, topY);
      const parentHitPath = parentHit ? composedPath(frame, parentHit) : null;
      if (parentHitPath === null) receivesEvents = false;
      frameChain.push({ ownerRect: { x: frameRect.x, y: frameRect.y, width: frameRect.width,
        height: frameRect.height }, parentHitPath });
      topTranslated = true;
      view = view.parent;
    }
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
    viewport: { width: viewportWidth, height: viewportHeight },
    hitTargetPath,
    topTranslated,
    frameChain,
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
  let previousFingerprint = null;
  let stablePolls = 0;
  let stableSince = 0;
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
          previousFingerprint = null;
          stablePolls = 0;
          stableSince = 0;
        } else if (status.needsScroll) {
          await scrollTarget(target);
          scrolled = true;
          previousFingerprint = null;
          stablePolls = 0;
          stableSince = 0;
        } else {
          const fingerprint = browserActionabilityFingerprint(status);
          if (requirements.stable && fingerprint === previousFingerprint) stablePolls += 1;
          else {
            stablePolls = 0;
            stableSince = Date.now();
          }
          previousFingerprint = fingerprint;
          const baseReady = (!requirements.visible || status.visible)
            && (!requirements.enabled || status.enabled)
            && (!requirements.editable || status.editable)
            && (!requirements.receivesEvents || status.receivesEvents);
          const stable = !requirements.stable || (stablePolls >= BROWSER_ACTIONABILITY_STABLE_POLLS
            && Date.now() - stableSince >= BROWSER_ACTIONABILITY_MIN_STABLE_MS);
          if (baseReady && stable) {
            return Object.freeze({ target, status: Object.freeze(status), polls, scrolled });
          }
        }
      } catch (error) {
        if (!error?.retryable || error?.outcome === "outcomeUnknown") throw error;
        await releaseTarget(target);
        target = null;
        previousFingerprint = null;
        stablePolls = 0;
        stableSince = 0;
      }
    } else {
      previousFingerprint = null;
      stablePolls = 0;
      stableSince = 0;
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
