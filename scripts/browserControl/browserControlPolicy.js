// browserControlPolicy.js - command 위험도와 target/event allowlist 계약.
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const BROWSER_CONTROL_RISKS = Object.freeze({
  read: 0,
  mutate: 1,
  externalEffect: 2,
});

// 호출자가 위험도를 낮춰 적는 구조를 막는다. 알려진 method의 최소 위험도는 코드가 소유한다.
export const BROWSER_CONTROL_COMMAND_RISKS = Object.freeze({
  "Accessibility.enable": "read",
  "Accessibility.getFullAXTree": "read",
  "Browser.getVersion": "read",
  "DOM.describeNode": "read",
  "DOM.getAttributes": "read",
  "DOM.getDocument": "read",
  "DOM.getOuterHTML": "read",
  "DOM.getBoxModel": "read",
  "DOM.getFrameOwner": "read",
  "DOM.querySelector": "read",
  "DOM.querySelectorAll": "read",
  "DOM.requestNode": "read",
  "DOM.resolveNode": "read",
  "DOMSnapshot.captureSnapshot": "read",
  "DOMStorage.enable": "read",
  "DOMStorage.getDOMStorageItems": "read",
  "Network.enable": "read",
  "Network.getCookies": "read",
  "Page.getFrameTree": "read",
  "Page.captureScreenshot": "read",
  "Page.getLayoutMetrics": "read",
  "Page.createIsolatedWorld": "read",
  "Runtime.enable": "read",
  "Runtime.getProperties": "read",
  "Runtime.releaseObject": "read",
  "DOM.focus": "mutate",
  "DOM.setAttributeValue": "mutate",
  "DOM.setFileInputFiles": "externalEffect",
  "DOMStorage.clear": "externalEffect",
  "DOMStorage.removeDOMStorageItem": "externalEffect",
  "DOMStorage.setDOMStorageItem": "externalEffect",
  "Fetch.continueRequest": "externalEffect",
  "Input.dispatchKeyEvent": "externalEffect",
  "Input.dispatchDragEvent": "externalEffect",
  "Input.dispatchMouseEvent": "externalEffect",
  "Input.setInterceptDrags": "externalEffect",
  "Input.insertText": "externalEffect",
  "Network.deleteCookies": "externalEffect",
  "Network.setCookie": "externalEffect",
  "Page.navigate": "externalEffect",
  "Page.handleJavaScriptDialog": "externalEffect",
  "Page.setDownloadBehavior": "externalEffect",
  "Runtime.callFunctionOn": "externalEffect",
  "Runtime.evaluate": "externalEffect",
  "Storage.clearDataForOrigin": "externalEffect",
});

export const BROWSER_CONTROL_DEFAULT_READ_METHODS = Object.freeze([
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "DOM.describeNode",
  "DOM.getAttributes",
  "DOM.getDocument",
  "DOM.getOuterHTML",
  "DOM.querySelector",
  "DOM.querySelectorAll",
  "DOMSnapshot.captureSnapshot",
  "Page.getFrameTree",
]);

const OPERATIONAL_EVENTS = new Set(["Transport.detached", "Transport.contextReplaced"]);

function stringSet(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return new Set(values);
}

function originSet(values) {
  const origins = stringSet(values, "targetOrigins");
  for (const value of origins) {
    let parsed;
    try { parsed = new URL(value); }
    catch (error) { throw new TypeError(`invalid browser target origin: ${value}`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(`browser target origin must use http or https: ${value}`);
    }
    if (parsed.origin !== value) throw new TypeError(`browser target origin must be exact: ${value}`);
  }
  return origins;
}

function targetUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch (error) { return null; }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
  return parsed;
}

function targetOrigin(url) {
  return targetUrl(url)?.origin || null;
}

function fileRoots(values) {
  if (!Array.isArray(values)) throw new TypeError("fileRoots must be an array");
  return values.map((value) => {
    if (typeof value !== "string" || !isAbsolute(value)) throw new TypeError("browser file root must be an absolute path");
    const root = realpathSync(resolve(value));
    if (!statSync(root).isDirectory()) throw new TypeError("browser file root must be a directory");
    return root;
  });
}

function insideRoot(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export class BrowserControlPolicy {
  constructor({ targetOrigins = [], targetTypes = ["page"], methods = [], events = [], fileRoots: roots = [], downloadRoot = null, maxRisk = "read" } = {}) {
    this._targetOrigins = originSet(targetOrigins);
    this._targetTypes = stringSet(targetTypes, "targetTypes");
    this._methods = stringSet(methods, "methods");
    this._events = stringSet(events, "events");
    this._fileRoots = fileRoots(roots);
    if (downloadRoot !== null && (typeof downloadRoot !== "string" || !isAbsolute(downloadRoot))) {
      throw new TypeError("browser download root must be absolute");
    }
    this._downloadRoot = downloadRoot === null ? null : resolve(downloadRoot);
    if (!Object.hasOwn(BROWSER_CONTROL_RISKS, maxRisk)) throw new TypeError(`unsupported maxRisk: ${maxRisk}`);
    this.maxRisk = maxRisk;
    for (const method of this._methods) {
      if (!Object.hasOwn(BROWSER_CONTROL_COMMAND_RISKS, method)) throw new TypeError(`unclassified browser command: ${method}`);
      const risk = BROWSER_CONTROL_COMMAND_RISKS[method];
      if (BROWSER_CONTROL_RISKS[risk] > BROWSER_CONTROL_RISKS[maxRisk]) {
        throw new TypeError(`method ${method} exceeds maxRisk ${maxRisk}`);
      }
    }
  }

  allowsTarget(target) {
    if (!target || !this._targetTypes.has(String(target.type || ""))) return false;
    const origin = targetOrigin(target.url);
    return !!origin && this._targetOrigins.has(origin);
  }

  authorizeTarget(target) {
    if (!this.allowsTarget(target)) {
      const error = new Error(`browser target is outside permission (${String(target?.type || "unknown")})`);
      error.code = "BROWSER_CONTROL_PERMISSION_DENIED";
      throw error;
    }
    return target;
  }

  authorizeCommand(target, method, params = {}) {
    this.authorizeTarget(target);
    if (!this._methods.has(method)) {
      const error = new Error(`browser command is outside permission: ${method}`);
      error.code = "BROWSER_CONTROL_PERMISSION_DENIED";
      throw error;
    }
    this.authorizeCommandParams(method, params);
    return BROWSER_CONTROL_COMMAND_RISKS[method];
  }

  authorizeCommandParams(method, params = {}) {
    const input = params && typeof params === "object" ? params : {};
    if (method === "Page.navigate") this._authorizeCommandUrl(input.url);
    if (method === "Fetch.continueRequest" && input.url !== undefined) this._authorizeCommandUrl(input.url);
    if (method === "Storage.clearDataForOrigin") this._authorizeExactOrigin(input.origin);
    if (method === "Network.setCookie") {
      if (!input.url || input.domain) this._denyCommandTarget();
      this._authorizeCommandUrl(input.url);
    }
    if (method === "Network.deleteCookies") {
      if (!input.url || input.domain) this._denyCommandTarget();
      this._authorizeCommandUrl(input.url);
    }
    if (method === "Network.getCookies") {
      if (!Array.isArray(input.urls) || input.urls.length === 0) this._denyCommandTarget();
      for (const url of input.urls) this._authorizeCommandUrl(url);
    }
    if (method === "DOM.setFileInputFiles") this._authorizeFiles(input.files);
    if (method.startsWith("DOMStorage.") && method !== "DOMStorage.enable") {
      if (!input.storageId || typeof input.storageId !== "object"
        || typeof input.storageId.securityOrigin !== "string"
        || typeof input.storageId.isLocalStorage !== "boolean") this._denyCommandTarget();
      this._authorizeExactOrigin(input.storageId.securityOrigin);
    }
    if (method === "Page.setDownloadBehavior") {
      if (!this._downloadRoot || input.behavior !== "allowAndName" || input.eventsEnabled !== true
        || resolve(String(input.downloadPath || "")) !== this._downloadRoot) this._denyCommandTarget();
    }
  }

  allowsEvent(method) {
    return OPERATIONAL_EVENTS.has(method) || this._events.has(method);
  }

  inspect() {
    return Object.freeze({
      targetOrigins: Object.freeze([...this._targetOrigins]),
      targetTypes: Object.freeze([...this._targetTypes]),
      methods: Object.freeze([...this._methods]),
      events: Object.freeze([...this._events]),
      fileRootCount: this._fileRoots.length,
      controlledDownloads: this._downloadRoot !== null,
      maxRisk: this.maxRisk,
    });
  }

  _authorizeCommandUrl(value) {
    const parsed = targetUrl(value);
    if (!parsed || !this._targetOrigins.has(parsed.origin)) this._denyCommandTarget();
  }

  _authorizeExactOrigin(value) {
    if (typeof value !== "string" || !this._targetOrigins.has(value)) this._denyCommandTarget();
  }

  _authorizeFiles(values) {
    if (!Array.isArray(values) || values.length < 1 || this._fileRoots.length < 1) this._denyCommandTarget();
    for (const value of values) {
      if (typeof value !== "string" || !isAbsolute(value)) this._denyCommandTarget();
      let candidate;
      try {
        candidate = realpathSync(resolve(value));
        if (!statSync(candidate).isFile()) this._denyCommandTarget();
      } catch (error) {
        this._denyCommandTarget();
      }
      if (!this._fileRoots.some((root) => insideRoot(root, candidate))) this._denyCommandTarget();
    }
  }

  _denyCommandTarget() {
    const error = new Error("browser command parameters target an outside permission");
    error.code = "BROWSER_CONTROL_PERMISSION_DENIED";
    throw error;
  }
}
