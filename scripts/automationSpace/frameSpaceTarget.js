// frameSpaceTarget.js - cooperative page가 sandbox host에 제공하는 classic-script bridge.
(function installPyProcFrameTarget() {
  "use strict";
  const PROTOCOL = "pyproc-frame";
  const VERSION = 1;
  const targetEpoch = crypto.randomUUID();
  const locatorByRef = new Map();
  let locatorSequence = 0;

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
    const selector = mode === "all"
      ? "body *"
      : "button,input,select,textarea,a[href],output,[role],[tabindex]";
    const limit = Math.max(1, Math.min(1000, Number(maxNodes) || 200));
    return Object.freeze({
      url: location.href,
      title: document.title,
      targetEpoch,
      parentAccessible: parentAccessible(),
      nodes: Object.freeze([...document.querySelectorAll(selector)].slice(0, limit).map(elementSummary)),
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
    if (operation === "observe") return snapshot(input);
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
          "action.select", "action.check", "action.uncheck", "action.scroll"].includes(data.operation);
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
