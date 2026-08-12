// frameSpacePage.js - machine page 안의 credentialless sandbox와 cooperative target bridge를 관리한다.
const PROTOCOL = "pyproc-frame";
const VERSION = 1;
const MAX_ACTIONS = 16;
const MAX_READ_BYTES = 256 * 1024;
const MAX_INLINE_BYTES = 512 * 1024;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

function frameError(code, message, outcome = "notSent", details = null) {
  const error = new Error(message);
  error.code = code;
  error.outcome = outcome;
  error.retryable = false;
  if (details) error.details = details;
  return error;
}

function decodeBase64(value) {
  if (typeof value !== "string") throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "artifact data must be base64");
  let binary;
  try { binary = atob(value); }
  catch (error) { throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "artifact data is not base64"); }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  let canonical = "";
  for (const byte of bytes) canonical += String.fromCharCode(byte);
  if (btoa(canonical) !== value) throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "artifact base64 is not canonical");
  return bytes;
}

function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Of(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch (error) { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url.origin;
}

export class FrameSpacePage {
  constructor(config) {
    if (!config || typeof config !== "object") throw new TypeError("FrameSpace page config is required");
    this.spaceId = String(config.spaceId || "space:frame");
    this.timeoutMs = Math.max(1, Math.min(30000, Number(config.timeoutMs) || 10000));
    this.allowedOrigins = new Set(config.targetOrigins || []);
    this.allowedActions = new Set(config.actions || []);
    this.artifactLimits = Object.freeze({
      maxArtifactBytes: Number(config.artifacts?.maxArtifactBytes) || 16 * 1024 * 1024,
      maxTotalBytes: Number(config.artifacts?.maxTotalBytes) || 64 * 1024 * 1024,
      maxArtifacts: Number(config.artifacts?.maxArtifacts) || 64,
      inlineMaxBytes: Math.min(MAX_INLINE_BYTES, Number(config.artifacts?.inlineMaxBytes) || MAX_INLINE_BYTES),
      ttlMs: Number(config.artifacts?.ttlMs) || 60 * 60 * 1000,
    });
    this.targets = new Map();
    this.sessions = new Map();
    this.artifacts = new Map();
    this.totalArtifactBytes = 0;
    this.sequence = 0;
  }

  operations() {
    return Object.freeze({
      "automation.space.inspect": () => this.inspect(),
      "automation.target.list": () => this.listTargets(),
      "automation.target.open": (input) => this.openTarget(input),
      "automation.session.attach": (input) => this.attach(input),
      "automation.session.detach": (input) => this.detach(input),
      "automation.observe": (input) => this.observe(input),
      "frame.perception.capture": (input) => this.perceptionCapture(input),
      "automation.act": (input) => this.act(input),
      "artifact.read": (input) => this.readArtifact(input),
      "artifact.delete": (input) => this.deleteArtifact(input),
      "frame.close": () => this.close(),
    });
  }

  inspect() {
    this._reap();
    return Object.freeze({
      transport: "messageChannel",
      sandbox: "allow-scripts allow-forms",
      credentialless: true,
      targetOrigins: Object.freeze([...this.allowedOrigins]),
      actions: Object.freeze([...this.allowedActions]),
      targetCount: this.targets.size,
      sessionCount: this.sessions.size,
      artifactCount: this.artifacts.size,
    });
  }

  listTargets() {
    return Object.freeze([...this.targets.values()].map((target) => Object.freeze({
      targetRef: target.targetRef,
      url: target.url,
      title: target.title || "",
      connected: !!target.port,
    })));
  }

  async openTarget({ url } = {}) {
    this._assertAllowedUrl(url);
    const targetRef = `target:${crypto.randomUUID()}`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms");
    iframe.setAttribute("credentialless", "");
    iframe.referrerPolicy = "no-referrer";
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:720px;border:0";
    const target = { targetRef, iframe, url: String(url), title: "", port: null, targetEpoch: null,
      generation: 0, pending: new Map(), isolation: null };
    this.targets.set(targetRef, target);
    try {
      await this._navigate(target, url);
      return Object.freeze({ targetRef, url: target.url, title: target.title, providerKind: "frame",
        sandbox: iframe.sandbox.value, credentialless: iframe.credentialless === true,
        parentAccessible: target.isolation.parentAccessible,
        storageAccessible: target.isolation.storageAccessible,
        cookieAccessible: target.isolation.cookieAccessible });
    } catch (error) {
      this.targets.delete(targetRef);
      target.port?.close();
      iframe.remove();
      throw error;
    }
  }

  attach({ targetRef } = {}) {
    const target = this._target(targetRef);
    const sessionId = crypto.randomUUID();
    const session = Object.freeze({ protocolVersion: "1", spaceId: this.spaceId, sessionId,
      targetRef: target.targetRef });
    this.sessions.set(sessionId, { session, targetRef: target.targetRef });
    return session;
  }

  detach({ sessionRef } = {}) {
    const record = this._session(sessionRef);
    this.sessions.delete(record.session.sessionId);
    return Object.freeze({ detached: true });
  }

  async observe({ sessionRef, expectedRisk, maxNodes, mode, includeScreenshot } = {}) {
    if (expectedRisk !== "read") throw frameError("FRAME_SPACE_PERMISSION_DENIED", "observe requires expectedRisk read");
    const target = this._targetForSession(sessionRef);
    const observed = await this._call(target, "observe", {
      ...(maxNodes === undefined ? {} : { maxNodes }),
      ...(mode === undefined ? {} : { mode }),
    });
    target.url = observed.url;
    target.title = observed.title;
    if (!includeScreenshot) return observed;
    const captured = await this._call(target, "action.screenshot", {});
    return Object.freeze({ ...observed, screenshot: await this._storeScreenshot(captured, true) });
  }

  async perceptionCapture({ sessionRef, maxEntities, issueLocators } = {}) {
    const target = this._targetForSession(sessionRef);
    const facts = await this._call(target, "perception.capture", {
      maxEntities,
      issueLocators: issueLocators !== false,
    });
    target.url = String(facts.page?.url || target.url);
    target.title = String(facts.page?.title || target.title).slice(0, 500);
    return Object.freeze({ ...facts, documentEpoch: target.generation });
  }

  async act({ sessionRef, actions } = {}) {
    const target = this._targetForSession(sessionRef);
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > MAX_ACTIONS) {
      throw frameError("FRAME_SPACE_ACTION_INVALID", `actions must contain 1 to ${MAX_ACTIONS} entries`);
    }
    const completed = [];
    const results = [];
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      try {
        let value;
        if (action.kind === "navigate") {
          await this._navigate(target, action.url);
          value = Object.freeze({ url: target.url, targetEpoch: target.targetEpoch });
        } else {
          value = await this._call(target, `action.${action.kind}`, action);
          if (action.kind === "screenshot") value = await this._storeScreenshot(value, action.inline !== false);
        }
        completed.push(Object.freeze({ index, kind: action.kind }));
        results.push(value);
      } catch (error) {
        error.failedActionIndex = index;
        error.failedAction = action;
        error.completed = Object.freeze([...completed]);
        if (error.outcome !== "outcomeUnknown" && completed.some((entry) =>
          !["snapshot", "screenshot", "waitFor"].includes(entry.kind))) error.outcome = "applied";
        error.retryable = false;
        throw error;
      }
    }
    return Object.freeze({ completed: Object.freeze(completed), results: Object.freeze(results) });
  }

  readArtifact({ artifactRef, offset = 0, maxBytes = MAX_READ_BYTES } = {}) {
    this._reap();
    const artifact = this.artifacts.get(artifactRef);
    if (!artifact) throw frameError("FRAME_SPACE_ARTIFACT_NOT_FOUND", `artifact is unavailable: ${artifactRef}`);
    if (!Number.isInteger(offset) || offset < 0 || offset > artifact.bytes.byteLength) {
      throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "artifact offset is invalid");
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_READ_BYTES) {
      throw frameError("FRAME_SPACE_ARTIFACT_INVALID", `artifact maxBytes must be 1 to ${MAX_READ_BYTES}`);
    }
    const end = Math.min(artifact.bytes.byteLength, offset + maxBytes);
    return Object.freeze({ artifactRef, kind: "screenshot", mimeType: artifact.mimeType,
      byteLength: artifact.bytes.byteLength, sha256: artifact.sha256, offset, nextOffset: end,
      eof: end === artifact.bytes.byteLength, dataBase64: encodeBase64(artifact.bytes.subarray(offset, end)) });
  }

  deleteArtifact({ artifactRef } = {}) {
    const artifact = this.artifacts.get(artifactRef);
    if (!artifact) return Object.freeze({ deleted: false });
    this.artifacts.delete(artifactRef);
    this.totalArtifactBytes -= artifact.bytes.byteLength;
    return Object.freeze({ deleted: true });
  }

  close() {
    for (const target of this.targets.values()) {
      for (const pending of target.pending.values()) pending.reject(frameError(
        "FRAME_SPACE_CLOSED", "FrameSpace closed after command delivery", "outcomeUnknown"));
      target.pending.clear();
      target.port?.close();
      target.iframe.remove();
    }
    this.targets.clear();
    this.sessions.clear();
    this.artifacts.clear();
    this.totalArtifactBytes = 0;
    return Object.freeze({ closed: true });
  }

  _assertAllowedUrl(value, outcome = "notSent") {
    const origin = exactOrigin(value);
    if (!origin || !this.allowedOrigins.has(origin)) {
      throw frameError("FRAME_SPACE_PERMISSION_DENIED", `target origin is outside FrameSpace permission: ${value}`, outcome);
    }
    return origin;
  }

  _target(targetRef) {
    const target = this.targets.get(targetRef);
    if (!target) throw frameError("FRAME_SPACE_TARGET_NOT_FOUND", `target is unavailable: ${targetRef}`);
    return target;
  }

  _session(sessionRef) {
    if (!sessionRef || sessionRef.protocolVersion !== "1" || sessionRef.spaceId !== this.spaceId
      || typeof sessionRef.sessionId !== "string" || typeof sessionRef.targetRef !== "string") {
      throw frameError("FRAME_SPACE_SESSION_INVALID", "sessionRef is invalid");
    }
    const record = this.sessions.get(sessionRef.sessionId);
    if (!record || record.targetRef !== sessionRef.targetRef) {
      throw frameError("FRAME_SPACE_SESSION_INVALID", "session is detached or stale");
    }
    return record;
  }

  _targetForSession(sessionRef) {
    return this._target(this._session(sessionRef).targetRef);
  }

  async _navigate(target, url) {
    this._assertAllowedUrl(url);
    const previousEpoch = target.targetEpoch;
    const generation = ++target.generation;
    target.port?.close();
    target.port = null;
    for (const pending of target.pending.values()) pending.reject(frameError(
      "FRAME_SPACE_CONTEXT_REPLACED", "target context was replaced", "outcomeUnknown"));
    target.pending.clear();
    const ready = new Promise((resolve, reject) => {
      let loaded = false;
      const timer = setTimeout(() => {
        removeEventListener("message", listener);
        target.iframe.removeEventListener("load", onLoad);
        reject(frameError("FRAME_SPACE_BRIDGE_UNAVAILABLE", "target did not load the cooperative bridge", "applied"));
      }, this.timeoutMs);
      const onLoad = () => { loaded = true; };
      const listener = (event) => {
        if (event.source !== target.iframe.contentWindow || event.data?.protocol !== PROTOCOL
          || event.data?.version !== VERSION || event.data?.type !== "ready" || !loaded
          || target.generation !== generation) return;
        clearTimeout(timer);
        removeEventListener("message", listener);
        target.iframe.removeEventListener("load", onLoad);
        resolve();
      };
      target.iframe.addEventListener("load", onLoad);
      addEventListener("message", listener);
    });
    target.iframe.src = String(url);
    if (!target.iframe.isConnected) document.body.append(target.iframe);
    await ready;
    const channel = new MessageChannel();
    const nonce = crypto.randomUUID();
    const hello = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(frameError(
        "FRAME_SPACE_BRIDGE_UNAVAILABLE", "target bridge handshake timed out", "applied")), this.timeoutMs);
      channel.port1.onmessage = ({ data }) => {
        if (data?.protocol !== PROTOCOL || data?.version !== VERSION || data?.type !== "hello" || data?.nonce !== nonce) return;
        clearTimeout(timer);
        resolve(data);
      };
      channel.port1.start();
      target.iframe.contentWindow.postMessage({ protocol: PROTOCOL, version: VERSION, type: "hello", nonce }, "*", [channel.port2]);
    });
    this._assertAllowedUrl(hello.url, "applied");
    if (target.generation !== generation || hello.parentAccessible !== false
      || hello.storageAccessible !== false || hello.cookieAccessible !== false
      || typeof hello.targetEpoch !== "string" || !hello.targetEpoch || hello.targetEpoch === previousEpoch) {
      channel.port1.close();
      throw frameError("FRAME_SPACE_ISOLATION_FAILED", "target did not prove the sandbox boundary", "applied");
    }
    target.url = hello.url;
    target.title = String(hello.title || "").slice(0, 500);
    target.targetEpoch = hello.targetEpoch;
    target.isolation = Object.freeze({ parentAccessible: false, storageAccessible: false, cookieAccessible: false });
    target.port = channel.port1;
    target.port.onmessage = ({ data }) => this._receive(target, data);
  }

  _call(target, operation, input) {
    if (!target.port) return Promise.reject(frameError("FRAME_SPACE_TARGET_NOT_FOUND", "target bridge is disconnected"));
    const id = `frame:${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        target.pending.delete(id);
        reject(frameError("FRAME_SPACE_TIMEOUT", `target operation timed out: ${operation}`, "outcomeUnknown"));
      }, this.timeoutMs);
      target.pending.set(id, { resolve, reject, timer });
      target.port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "request", id, operation, input: input || {} });
    });
  }

  _receive(target, data) {
    if (data?.protocol !== PROTOCOL || data?.version !== VERSION || data?.type !== "response" || typeof data?.id !== "string") return;
    const pending = target.pending.get(data.id);
    if (!pending) return;
    target.pending.delete(data.id);
    clearTimeout(pending.timer);
    if (data.ok === true) pending.resolve(data.value);
    else {
      const error = frameError(data.error?.code || "FRAME_SPACE_TARGET_FAILED",
        String(data.error?.message || "target operation failed"), data.error?.outcome || "rejected");
      if (data.error?.details && typeof data.error.details === "object") error.details = data.error.details;
      pending.reject(error);
    }
  }

  async _storeScreenshot(value, inline) {
    this._reap();
    const declaredBytes = Number(value?.byteLength);
    const declaredWidth = Number(value?.width);
    const declaredHeight = Number(value?.height);
    const expectedBase64Length = Number.isInteger(declaredBytes) ? Math.ceil(declaredBytes / 3) * 4 : -1;
    if (!Number.isInteger(declaredBytes) || declaredBytes < 8 || declaredBytes > this.artifactLimits.maxArtifactBytes
      || typeof value?.dataBase64 !== "string" || value.dataBase64.length !== expectedBase64Length
      || !/^[0-9a-f]{64}$/.test(String(value?.sha256 || ""))
      || !Number.isInteger(declaredWidth) || declaredWidth < 1 || declaredWidth > 4096
      || !Number.isInteger(declaredHeight) || declaredHeight < 1 || declaredHeight > 4096) {
      throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "target screenshot declaration is invalid");
    }
    const bytes = decodeBase64(value?.dataBase64);
    if (value?.kind !== "screenshot" || value?.mimeType !== "image/png"
      || bytes.byteLength !== declaredBytes
      || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
      throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "target screenshot metadata is invalid");
    }
    const digest = await sha256Of(bytes);
    if (digest !== value.sha256) throw frameError("FRAME_SPACE_ARTIFACT_INVALID", "target screenshot digest does not match");
    const limits = this.artifactLimits;
    if (bytes.byteLength > limits.maxArtifactBytes || this.artifacts.size >= limits.maxArtifacts
      || this.totalArtifactBytes + bytes.byteLength > limits.maxTotalBytes) {
      throw frameError("FRAME_SPACE_ARTIFACT_QUOTA", "FrameSpace artifact quota exceeded");
    }
    const artifactRef = `artifact:${crypto.randomUUID().replaceAll("-", "_")}`;
    this.artifacts.set(artifactRef, { bytes, mimeType: "image/png", sha256: digest, createdAt: Date.now() });
    this.totalArtifactBytes += bytes.byteLength;
    return Object.freeze({ kind: "screenshot", format: "png", mimeType: "image/png", artifactRef,
      byteLength: bytes.byteLength, sha256: digest, width: value.width, height: value.height,
      ...(inline && bytes.byteLength <= limits.inlineMaxBytes ? { dataBase64: value.dataBase64 } : {}) });
  }

  _reap() {
    const cutoff = Date.now() - this.artifactLimits.ttlMs;
    for (const [ref, artifact] of this.artifacts) {
      if (artifact.createdAt >= cutoff) continue;
      this.artifacts.delete(ref);
      this.totalArtifactBytes -= artifact.bytes.byteLength;
    }
  }
}
