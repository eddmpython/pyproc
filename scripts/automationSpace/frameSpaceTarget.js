// frameSpaceTarget.js - cooperative page가 sandbox host에 제공하는 classic-script bridge.
(function installPyProcFrameTarget() {
  "use strict";
  const PROTOCOL = "pyproc-frame";
  const VERSION = 1;
  const MAX_SEMANTIC_NODES = 10000;
  const targetEpoch = crypto.randomUUID();
  const locatorByRef = new Map();
  const nativeRefByElement = new WeakMap();
  let locatorSequence = 0;
  let nativeSequence = 0;

  function frameError(code, message, outcome = "rejected") {
    const error = new Error(message);
    error.code = code;
    error.outcome = outcome;
    error.retryable = false;
    return error;
  }

  function parentAccessible() {
    try {
      void parent.document.documentElement;
      return true;
    } catch (error) {
      return false;
    }
  }

  function storageAccessible() {
    try {
      void localStorage.length;
      return true;
    } catch (error) {
      return false;
    }
  }

  function cookieAccessible() {
    try {
      void document.cookie;
      return true;
    } catch (error) {
      return false;
    }
  }

  function locatorFor(element) {
    for (const [ref, known] of locatorByRef) if (known === element) return ref;
    const ref = `locator:${targetEpoch}:${++locatorSequence}`;
    locatorByRef.set(ref, element);
    return ref;
  }

  function nativeRefFor(element) {
    let ref = nativeRefByElement.get(element);
    if (!ref) {
      ref = `frameNode:${targetEpoch}:${++nativeSequence}`;
      nativeRefByElement.set(element, ref);
    }
    return ref;
  }

  function clipped(value, limit = 300) {
    const text = String(value ?? "").trim();
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function implicitRole(element) {
    const explicit = clipped(element.getAttribute("role"), 80);
    if (explicit) return explicit;
    const tag = element.tagName;
    if (/^H[1-6]$/u.test(tag)) return "heading";
    if (tag === "A" && element.hasAttribute("href")) return "link";
    if (tag === "BUTTON") return "button";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "SELECT") return element.multiple ? "listbox" : "combobox";
    if (tag === "IMG") return "img";
    if (tag === "CANVAS") return "canvas";
    if (tag === "OUTPUT") return "status";
    if (tag === "FORM") return "form";
    if (tag === "MAIN") return "main";
    if (tag === "NAV") return "navigation";
    if (tag === "ARTICLE") return "article";
    if (tag === "SECTION") return "region";
    if (tag === "P") return "paragraph";
    if (tag === "INPUT") {
      if (["button", "submit", "reset", "image"].includes(element.type)) return "button";
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (element.type === "range") return "slider";
      if (element.type === "number") return "spinbutton";
      if (element.type === "search") return "searchbox";
      return "textbox";
    }
    return "generic";
  }

  function accessibleName(element, role) {
    const labelledBy = clipped(element.getAttribute("aria-labelledby"), 500);
    if (labelledBy) {
      const text = labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (clipped(text)) return clipped(text);
    }
    const aria = clipped(element.getAttribute("aria-label"));
    if (aria) return aria;
    if (element instanceof HTMLInputElement && element.labels?.length) {
      const text = clipped([...element.labels].map((label) => label.textContent || "").join(" "));
      if (text) return text;
    }
    if (element instanceof HTMLImageElement) return clipped(element.alt || element.title);
    if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
      return clipped(element.value);
    }
    if (["button", "link", "heading", "status", "paragraph"].includes(role)) return clipped(element.innerText);
    return clipped(element.getAttribute("name") || element.title);
  }

  function protectedValue(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement)) return { value: "", sensitivity: "public" };
    const autocomplete = String(element.autocomplete || "").toLowerCase();
    const credential = element instanceof HTMLInputElement && (element.type === "password"
      || /password|one-time-code|webauthn/u.test(autocomplete));
    const financial = /cc-|transaction-/u.test(autocomplete);
    if (credential || financial) return { value: "[redacted]", sensitivity: credential ? "credential" : "financial" };
    return { value: clipped(element.value), sensitivity: "unknown-sensitive" };
  }

  function entityKind(role, element) {
    if (role === "canvas") return "content.canvas";
    if (role === "img") return "content.image";
    if (["textbox", "searchbox", "combobox", "spinbutton"].includes(role)) return "ui.input";
    if (["button", "checkbox", "link", "radio", "slider", "switch", "tab"].includes(role)) return "ui.control";
    if (["dialog", "alertdialog"].includes(role)) return "ui.dialog";
    if (["alert", "log", "status", "timer"].includes(role)) return "ui.status";
    if (["main", "navigation", "region", "banner", "contentinfo", "search"].includes(role)) return "ui.landmark";
    if (["heading", "paragraph"].includes(role)) return "content.text";
    if (role === "document" || element === document.documentElement) return "content.document";
    return "ui.container";
  }

  function supportedActions(role, element, disabled) {
    if (disabled) return [];
    if (["checkbox", "radio", "switch"].includes(role)) return ["focus", "click", "check"];
    if (["textbox", "searchbox", "spinbutton"].includes(role)) return ["focus", "fill"];
    if (role === "combobox" || element instanceof HTMLSelectElement) return ["focus", "select"];
    if (["button", "link", "slider", "tab"].includes(role)) return ["focus", "click"];
    return [];
  }

  function viewportRatio(rect) {
    if (rect.width <= 0 || rect.height <= 0) return 0;
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height / (rect.width * rect.height);
  }

  function perceptionSnapshot({ maxEntities = 1000, issueLocators = true, includeEnvironment = false } = {}) {
    const limit = Math.max(1, Math.min(1000, Number(maxEntities) || 1000));
    if (issueLocators) locatorByRef.clear();
    const eligible = [document.documentElement, ...document.querySelectorAll("body *")]
      .filter((element) => !["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"].includes(element.tagName));
    const candidates = eligible.slice(0, limit);
    const included = new Set(candidates);
    const entities = [];
    const relationSeeds = [];
    for (const element of candidates) {
      const nativeRef = nativeRefFor(element);
      const role = implicitRole(element);
      const name = accessibleName(element, role);
      const value = protectedValue(element);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const ratio = viewportRatio(rect);
      const visible = style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = visible && ratio > 0 ? document.elementFromPoint(centerX, centerY) : null;
      const occluded = !!hit && hit !== element && !element.contains(hit);
      const disabled = element.matches(":disabled,[aria-disabled='true']");
      const actions = supportedActions(role, element, disabled);
      const reasons = [];
      if (disabled) reasons.push("disabled");
      if (!visible) reasons.push("hidden");
      if (ratio === 0) reasons.push("outsideViewport");
      if (occluded) reasons.push("occluded");
      const states = {
        disabled,
        focused: document.activeElement === element,
        hidden: !visible,
        ...(element.hasAttribute("aria-expanded") ? { expanded: element.getAttribute("aria-expanded") === "true" } : {}),
        ...(element.hasAttribute("aria-selected") ? { selected: element.getAttribute("aria-selected") === "true" } : {}),
        ...("checked" in element ? { checked: !!element.checked } : {}),
        ...("readOnly" in element ? { readonly: !!element.readOnly } : {}),
      };
      const unresolvedReason = element.tagName === "CANVAS" ? "canvas"
        : element.tagName === "IMG" && !name ? "unlabelledImage"
          : actions.length && !name ? "unlabelledControl" : null;
      entities.push(Object.freeze({
        nativeRef,
        ...(actions.length && issueLocators ? { locatorData: { locatorRef: locatorFor(element) } } : {}),
        kind: entityKind(role, element),
        semantic: { role, ...(name ? { name } : {}), ...(value.value ? { value: value.value } : {}),
          states, sensitivity: value.sensitivity },
        structure: { frameNativeRef: `frame:${targetEpoch}`, nodeName: element.tagName,
          parentNativeRef: element.parentElement && included.has(element.parentElement)
            ? nativeRefFor(element.parentElement) : null },
        geometry: { rect: { x: rect.left + scrollX, y: rect.top + scrollY,
          width: Math.max(0, rect.width), height: Math.max(0, rect.height) },
        viewportRatio: ratio, paintOrder: null, visible, occluded },
        interaction: { supportedActions: actions, actionable: actions.length > 0 && reasons.length === 0, reasons },
        provenance: {
          semantic: { mode: "reported", source: "frame.dom", trust: "page" },
          geometry: { mode: "observed", source: "frame.layout", trust: "page" },
          interaction: { mode: "derived", source: "frame.actionability", trust: "page" },
        },
        ...(unresolvedReason ? { unresolved: { reason: unresolvedReason } } : {}),
      }));
      relationSeeds.push({ element, nativeRef });
    }
    const relations = [];
    const seenRelations = new Set();
    const addRelation = (type, fromNativeRef, toNativeRef, mode = "observed") => {
      if (!fromNativeRef || !toNativeRef || fromNativeRef === toNativeRef) return;
      const key = `${type}:${fromNativeRef}:${toNativeRef}`;
      if (seenRelations.has(key)) return;
      seenRelations.add(key);
      relations.push(Object.freeze({ type, fromNativeRef, toNativeRef,
        provenance: { mode, source: "frame.dom", trust: "page" } }));
    };
    for (const { element, nativeRef } of relationSeeds) {
      if (element.parentElement && included.has(element.parentElement)) {
        const parentRef = nativeRefFor(element.parentElement);
        addRelation("parentOf", parentRef, nativeRef);
        addRelation("childOf", nativeRef, parentRef);
      }
      for (const [attribute, type] of [["aria-labelledby", "labelledBy"], ["aria-describedby", "describedBy"],
        ["aria-controls", "controls"], ["aria-owns", "owns"]]) {
        for (const id of String(element.getAttribute(attribute) || "").split(/\s+/u).filter(Boolean)) {
          const related = document.getElementById(id);
          if (related && included.has(related)) addRelation(type, nativeRef, nativeRefFor(related));
        }
      }
    }
    return Object.freeze({
      page: Object.freeze({ url: location.href, title: document.title,
        viewport: Object.freeze({ width: innerWidth, height: innerHeight, scale: devicePixelRatio || 1 }),
        scroll: Object.freeze({ x: scrollX, y: scrollY }),
        ...(includeEnvironment ? { environment: Object.freeze((() => {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          const metrics = context ? ["sans-serif", "serif", "monospace", "system-ui"].map((font) => {
            context.font = `16px ${font}`;
            return Math.round(context.measureText("PyProc 0123 한글").width * 1000) / 1000;
          }) : [];
          return { locale: navigator.language || "unknown",
            timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
            colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark"
              : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "no-preference",
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
            fontFingerprint: `font-metrics-v1:${metrics.join(",")}` };
        })()) } : {}) }),
      entities: Object.freeze(entities),
      relations: Object.freeze(relations),
      events: Object.freeze([]),
      omitted: Object.freeze({ entities: Math.max(0, eligible.length - candidates.length) }),
      completeness: Object.freeze({
        semantic: candidates.length < eligible.length ? "partial" : "complete",
        structure: candidates.length < eligible.length ? "partial" : "complete",
        geometry: candidates.length < eligible.length ? "partial" : "complete",
        interaction: candidates.length < eligible.length ? "partial" : "complete",
        network: "notAvailable", environment: includeEnvironment ? "complete" : "notRequested",
        captureAuthority: "dom-rendered",
      }),
    });
  }

  function elementSummary(element) {
    const rect = element.getBoundingClientRect();
    return Object.freeze({
      locatorRef: locatorFor(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      role: element.getAttribute("role"),
      name: element.getAttribute("aria-label") || element.getAttribute("name") || null,
      text: String(element.innerText || element.value || "").trim().slice(0, 500),
      disabled: element.matches(":disabled,[aria-disabled='true']"),
      checked: "checked" in element ? !!element.checked : null,
      visible: rect.width > 0 && rect.height > 0,
    });
  }

  function snapshot({ maxNodes = 200, mode = "interactive" } = {}) {
    const eligible = [...document.querySelectorAll("body *")];
    const candidates = mode === "all" ? eligible
      : [...document.querySelectorAll("button,input,select,textarea,a[href],output,[role],[tabindex]")];
    const limit = Math.max(1, Math.min(MAX_SEMANTIC_NODES, Number(maxNodes) || 200));
    locatorByRef.clear();
    const nodes = candidates.slice(0, limit).map(elementSummary);
    return Object.freeze({
      url: location.href,
      title: document.title,
      targetEpoch,
      parentAccessible: parentAccessible(),
      mode,
      nodes: Object.freeze(nodes),
      eligibleNodes: eligible.length,
      candidateNodes: candidates.length,
      truncated: candidates.length > nodes.length,
    });
  }

  function targetElement(input) {
    const hasSelector = typeof input?.selector === "string" && !!input.selector;
    const hasLocator = typeof input?.locatorRef === "string" && !!input.locatorRef;
    if (Number(hasSelector) + Number(hasLocator) !== 1) {
      throw frameError("FRAME_SPACE_TARGET_INVALID", "action requires exactly one selector or locatorRef", "notSent");
    }
    let element;
    if (hasSelector) {
      try { element = document.querySelector(input.selector); }
      catch (error) { throw frameError("FRAME_SPACE_SELECTOR_INVALID", `invalid selector: ${input.selector}`, "notSent"); }
    } else {
      element = locatorByRef.get(input.locatorRef);
    }
    if (!element || !element.isConnected) {
      throw frameError("FRAME_SPACE_TARGET_NOT_FOUND", "target element is unavailable");
    }
    return element;
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  async function waitFor(input) {
    const timeoutMs = Math.max(1, Math.min(30000, Number(input.timeoutMs) || 5000));
    const state = input.state || "visible";
    const started = performance.now();
    for (;;) {
      let element = null;
      try { element = targetElement(input); } catch (error) {
        if (error.code !== "FRAME_SPACE_TARGET_NOT_FOUND") throw error;
      }
      const matches = state === "detached" ? !element
        : state === "attached" ? !!element
          : state === "hidden" ? !element || !isVisible(element)
            : state === "visible" ? !!element && isVisible(element)
              : state === "enabled" ? !!element && !element.matches(":disabled,[aria-disabled='true']")
                : state === "disabled" ? !!element && element.matches(":disabled,[aria-disabled='true']")
                  : state === "editable" ? !!element && !element.readOnly && !element.disabled
                    : false;
      if (matches) return element ? elementSummary(element) : { state };
      if (performance.now() - started >= timeoutMs) {
        throw frameError("FRAME_SPACE_WAIT_TIMEOUT", `target did not reach ${state} within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function screenshot() {
    const width = Math.max(1, Math.min(4096, document.documentElement.scrollWidth));
    const height = Math.max(1, Math.min(4096, document.documentElement.scrollHeight));
    const clone = document.documentElement.cloneNode(true);
    for (const script of clone.querySelectorAll("script")) script.remove();
    const liveControls = document.querySelectorAll("input,textarea,select");
    const clonedControls = clone.querySelectorAll("input,textarea,select");
    for (let index = 0; index < liveControls.length; index += 1) {
      const live = liveControls[index];
      const copied = clonedControls[index];
      if (live instanceof HTMLInputElement) {
        copied.setAttribute("value", live.value);
        if (live.checked) copied.setAttribute("checked", "");
        else copied.removeAttribute("checked");
      } else if (live instanceof HTMLTextAreaElement) copied.textContent = live.value;
      else if (live instanceof HTMLSelectElement) {
        for (let option = 0; option < live.options.length; option += 1) {
          if (live.options[option].selected) copied.options[option].setAttribute("selected", "");
          else copied.options[option].removeAttribute("selected");
        }
      }
    }
    const markup = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(frameError("FRAME_SPACE_SCREENSHOT_UNSUPPORTED", "target DOM could not be rendered as an image"));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw frameError("FRAME_SPACE_SCREENSHOT_UNSUPPORTED", "2D canvas is unavailable");
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw frameError("FRAME_SPACE_SCREENSHOT_UNSUPPORTED", "PNG encoding failed");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return Object.freeze({
      kind: "screenshot",
      mimeType: "image/png",
      byteLength: bytes.byteLength,
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      dataBase64: btoa(binary),
      width,
      height,
    });
  }

  async function dispatch(operation, input = {}) {
    if (operation.startsWith("app.")) {
      const appTarget = globalThis.pyprocAppSpaceTarget;
      if (!appTarget || typeof appTarget.dispatch !== "function") {
        throw frameError("APP_SPACE_ADAPTER_UNAVAILABLE", "cooperative app adapter is not installed", "notSent");
      }
      return appTarget.dispatch(operation.slice(4), input);
    }
    if (operation === "observe") return snapshot(input);
    if (operation === "observe.epoch") return Object.freeze({ targetEpoch, url: location.href, title: document.title });
    if (operation === "perception.capture") return perceptionSnapshot(input);
    if (operation === "action.snapshot") return snapshot(input);
    if (operation === "action.screenshot") return screenshot();
    if (operation === "action.waitFor") return waitFor(input);
    const element = targetElement(input);
    if (operation === "action.click") element.click();
    else if (operation === "action.focus") element.focus();
    else if (operation === "action.fill") {
      element.value = String(input.value ?? "");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (operation === "action.press") {
      const key = String(input.key || "");
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    } else if (operation === "action.select") {
      if (!(element instanceof HTMLSelectElement)) throw frameError("FRAME_SPACE_ACTION_INVALID", "select requires a select element");
      const values = Array.isArray(input.values) ? input.values.map(String) : [String(input.value ?? "")];
      for (const option of element.options) option.selected = values.includes(option.value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (operation === "action.check" || operation === "action.uncheck") {
      if (!(element instanceof HTMLInputElement) || !["checkbox", "radio"].includes(element.type)) {
        throw frameError("FRAME_SPACE_ACTION_INVALID", `${operation.slice(7)} requires a checkbox or radio`);
      }
      element.checked = operation === "action.check";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (operation === "action.scroll") {
      element.scrollIntoView({ behavior: "instant", block: input.block || "center", inline: input.inline || "nearest" });
    } else {
      throw frameError("FRAME_SPACE_OPERATION_UNSUPPORTED", `unsupported frame operation: ${operation}`, "notSent");
    }
    return elementSummary(element);
  }

  addEventListener("message", (event) => {
    const hello = event.data;
    const port = event.ports?.[0];
    if (event.source !== parent || !port || hello?.protocol !== PROTOCOL || hello?.version !== VERSION
      || hello?.type !== "hello" || typeof hello?.nonce !== "string") return;
    port.onmessage = async ({ data }) => {
      if (data?.protocol !== PROTOCOL || data?.version !== VERSION || data?.type !== "request"
        || typeof data?.id !== "string" || typeof data?.operation !== "string"
        || !data.input || typeof data.input !== "object" || Array.isArray(data.input)) return;
      try {
        port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "response", id: data.id,
          ok: true, value: await dispatch(data.operation, data.input) });
      } catch (error) {
        const externalEffect = ["action.navigate", "action.click", "action.focus", "action.fill", "action.press",
          "action.select", "action.check", "action.uncheck", "action.scroll", "app.actuate"].includes(data.operation);
        const outcome = error?.outcome || (externalEffect ? "outcomeUnknown" : "rejected");
        port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "response", id: data.id,
          ok: false, error: { code: error?.code || "FRAME_SPACE_TARGET_FAILED",
            message: String(error?.message || error).slice(-1000), outcome,
            retryable: error?.retryable === true } });
      }
    };
    port.start();
    port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "hello", nonce: hello.nonce,
      url: location.href, title: document.title, targetEpoch, parentAccessible: parentAccessible(),
      storageAccessible: storageAccessible(), cookieAccessible: cookieAccessible(), bridgeVersion: VERSION });
  });

  const announceReady = () => setTimeout(() =>
    parent.postMessage({ protocol: PROTOCOL, version: VERSION, type: "ready" }, "*"), 0);
  if (document.readyState === "complete") announceReady();
  else addEventListener("load", announceReady, { once: true });
}());
