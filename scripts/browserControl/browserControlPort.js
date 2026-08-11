// browserControlPort.js - transport 독립 target/session/permission/outcome 계약.
import { BrowserControlPolicy } from "./browserControlPolicy.js";
import { applyBrowserViewport } from "./browserViewport.js";

export const BROWSER_CONTROL_PROTOCOL_VERSION = "1";

export const BROWSER_CONTROL_ERROR_CODES = Object.freeze({
  brokerUnavailable: "BROWSER_CONTROL_BROKER_UNAVAILABLE",
  commandCancelled: "BROWSER_CONTROL_COMMAND_CANCELLED",
  commandRejected: "BROWSER_CONTROL_COMMAND_REJECTED",
  commandTimeout: "BROWSER_CONTROL_COMMAND_TIMEOUT",
  commandUnsupported: "BROWSER_CONTROL_COMMAND_UNSUPPORTED",
  contextReplaced: "BROWSER_CONTROL_CONTEXT_REPLACED",
  outcomeUnknown: "BROWSER_CONTROL_OUTCOME_UNKNOWN",
  permissionDenied: "BROWSER_CONTROL_PERMISSION_DENIED",
  sessionDetached: "BROWSER_CONTROL_SESSION_DETACHED",
  staleBroker: "BROWSER_CONTROL_STALE_BROKER",
  targetUnavailable: "BROWSER_CONTROL_TARGET_UNAVAILABLE",
});

// JavaScript dialog가 열린 동안 Page.getFrameTree도 멈춘다. 이 한 method만 dialog를 연
// 직전 verified target을 사용해야 modal을 닫을 수 있다. 다른 method는 매번 origin을 재검사한다.
const MODAL_UNBLOCK_METHODS = new Set(["Page.handleJavaScriptDialog"]);
const TRUSTED_READ_METHODS = new Set([
  "DOM.getBoxModel", "DOM.getFrameOwner", "DOM.resolveNode", "Page.createIsolatedWorld",
  "Page.getFrameTree", "Runtime.callFunctionOn", "Runtime.evaluate", "Runtime.releaseObject",
]);

export class BrowserControlError extends Error {
  constructor(code, message, { outcome = "notSent", retryable = false, cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "BrowserControlError";
    this.code = code;
    this.outcome = outcome;
    this.retryable = retryable;
  }
}

function validateTransport(transport) {
  if (!transport || typeof transport !== "object") throw new TypeError("browser control transport is required");
  for (const method of ["listTargets", "closeTarget", "attach", "describe", "send", "subscribe", "detach", "close"]) {
    if (typeof transport[method] !== "function") throw new TypeError(`browser control transport is missing ${method}()`);
  }
  return transport;
}

function copyTarget(target) {
  return Object.freeze({
    id: String(target.id || ""),
    type: String(target.type || ""),
    url: String(target.url || ""),
    title: String(target.title || ""),
    openerId: String(target.openerId || ""),
  });
}

function popupDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
      "browser popup capture was cancelled", { outcome: "outcomeUnknown" }));
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
        "browser popup capture was cancelled", { outcome: "outcomeUnknown" }));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function validateSignal(signal) {
  if (signal === undefined) return;
  if (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") {
    throw new TypeError("signal must be an AbortSignal");
  }
}

export class BrowserControlPort {
  constructor({ transport, policy, brokerId, brokerEpoch = 1, idFactory = () => crypto.randomUUID() } = {}) {
    this.kind = "browser-control";
    this.mode = "command";
    this.protocolVersion = BROWSER_CONTROL_PROTOCOL_VERSION;
    this._transport = validateTransport(transport);
    this.policy = policy instanceof BrowserControlPolicy ? policy : new BrowserControlPolicy(policy);
    if (typeof idFactory !== "function") throw new TypeError("idFactory must be a function");
    this._idFactory = idFactory;
    this.brokerId = String(brokerId || idFactory());
    if (!this.brokerId) throw new TypeError("brokerId must be non-empty");
    if (!Number.isInteger(brokerEpoch) || brokerEpoch < 1) throw new TypeError("brokerEpoch must be a positive integer");
    this._brokerEpoch = brokerEpoch;
    this._targets = new Map();
    this._sessions = new Map();
    this._popupCaptures = new Map();
    this._requestSeq = 0;
    this._eventSeq = 0;
    this._closed = false;
  }

  async listTargets() {
    this._requireOpen();
    const rawTargets = await this._transport.listTargets();
    const visible = [];
    for (const raw of rawTargets || []) {
      const target = copyTarget(raw);
      if (!target.id || !this.policy.allowsTarget(target)) continue;
      let targetRef = [...this._targets.entries()].find(([, value]) => value.id === target.id)?.[0];
      if (!targetRef) targetRef = `target:${this._idFactory()}`;
      this._targets.set(targetRef, target);
      visible.push(Object.freeze({ targetRef, type: target.type, url: target.url, title: target.title }));
    }
    return Object.freeze(visible);
  }

  async attach(targetRef) {
    this._requireOpen();
    const remembered = this._targets.get(String(targetRef));
    if (!remembered) throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable, `unknown target reference: ${targetRef}`);
    const current = (await this._transport.listTargets()).map(copyTarget).find((target) => target.id === remembered.id);
    if (!current) throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable, `target is unavailable: ${targetRef}`);
    // Chromium은 새 target 또는 이미 attach된 target의 browser-level URL을 잠깐 빈 문자열로
    // 내릴 수 있다. 마지막 허용 관찰 없이 blank target에 붙지는 않되, attach 직후에는
    // session-level frame URL로 반드시 다시 검사하고 실패하면 session을 내준다.
    try { this._authorizeTarget(current.url ? current : remembered); }
    catch (error) {
      await Promise.allSettled([this._transport.closeTarget(current.id)]);
      throw error;
    }
    let transportSession = null;
    let described = null;
    try {
      transportSession = await this._transport.attach(current.id);
      described = copyTarget(await this._transport.describe(transportSession));
      this._authorizeTarget(described);
      this._targets.set(String(targetRef), described);
    } catch (error) {
      if (transportSession) await Promise.allSettled([this._transport.detach(transportSession)]);
      await Promise.allSettled([this._transport.closeTarget(current.id)]);
      if (error instanceof BrowserControlError) throw error;
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        `browser target is unavailable: ${targetRef}`, { cause: error });
    }
    const sessionId = `session:${this._idFactory()}`;
    const session = {
      sessionId,
      targetRef: String(targetRef),
      targetId: current.id,
      transportSession,
      listeners: new Set(),
      state: "attached",
      authorizationState: "verified",
      authorizedTarget: described,
      contextEpoch: 0,
      unsubscribe: null,
    };
    session.unsubscribe = this._transport.subscribe(transportSession, (event) => this._receiveEvent(session, event));
    this._sessions.set(sessionId, session);
    return this._sessionRef(session);
  }

  async beginPopupCapture(sessionRef) {
    this._requireOpen();
    const session = this._requireSession(sessionRef);
    const targets = (await this._transport.listTargets()).map(copyTarget);
    const captureRef = `popup-capture:${this._idFactory()}`;
    this._popupCaptures.set(captureRef, {
      sessionId: session.sessionId,
      parentTargetId: session.targetId,
      targetIds: new Set(targets.map((target) => target.id)),
    });
    return captureRef;
  }

  async finishPopupCapture(sessionRef, captureRef, { timeoutMs = 5000, signal } = {}) {
    this._requireOpen();
    validateSignal(signal);
    const session = this._requireSession(sessionRef);
    const capture = this._popupCaptures.get(String(captureRef));
    if (!capture || capture.sessionId !== session.sessionId) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        "browser popup capture is stale", { outcome: "notSent" });
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("popup timeoutMs must be positive");
    const deadline = Date.now() + timeoutMs;
    let stableId = "";
    let stableUrl = "";
    let stablePolls = 0;
    const discovered = new Set();
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          throw this._error(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
            "browser popup capture was cancelled", { outcome: "outcomeUnknown" });
        }
        const targets = (await this._transport.listTargets()).map(copyTarget);
        const candidates = targets.filter((target) => !capture.targetIds.has(target.id)
          && target.type === "page" && target.openerId === capture.parentTargetId);
        for (const target of candidates) discovered.add(target.id);
        if (candidates.length > 1) {
          await Promise.allSettled(candidates.map((target) => this._transport.closeTarget(target.id)));
          throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
            `browser click opened ${candidates.length} popup targets`, { outcome: "applied" });
        }
        const target = candidates[0];
        if (target && target.url && target.url !== "about:blank") {
          try { this._authorizeTarget(target); }
          catch (error) {
            await Promise.allSettled([this._transport.closeTarget(target.id)]);
            throw this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
              "browser popup final URL is outside permission", { outcome: "applied", cause: error });
          }
          if (stableId === target.id && stableUrl === target.url) stablePolls += 1;
          else {
            stableId = target.id;
            stableUrl = target.url;
            stablePolls = 1;
          }
          if (stablePolls >= 2) {
            let targetRef = [...this._targets.entries()].find(([, value]) => value.id === target.id)?.[0];
            if (!targetRef) targetRef = `target:${this._idFactory()}`;
            this._targets.set(targetRef, target);
            return Object.freeze({ targetRef, type: target.type, url: target.url, title: target.title });
          }
        }
        await popupDelay(Math.min(50, Math.max(1, deadline - Date.now())), signal);
      }
      await Promise.allSettled([...discovered].map((targetId) => this._transport.closeTarget(targetId)));
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        "browser popup did not reach an allowed stable URL", { outcome: "outcomeUnknown" });
    } finally {
      this._popupCaptures.delete(String(captureRef));
    }
  }

  cancelPopupCapture(captureRef) {
    this._popupCaptures.delete(String(captureRef));
  }

  async send(sessionRef, command, { signal, trustedRead = false } = {}) {
    this._requireOpen();
    validateSignal(signal);
    const session = this._requireSession(sessionRef);
    if (!command || typeof command !== "object" || typeof command.method !== "string" || !command.method) {
      throw new TypeError("browser command requires method");
    }
    if (signal?.aborted) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
        `browser command was cancelled before send: ${command.method}`);
    }
    let target = null;
    if (MODAL_UNBLOCK_METHODS.has(command.method)) {
      if (session.authorizationState !== "verified" || !session.authorizedTarget) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
          "browser modal unblock requires a verified target");
      }
      target = session.authorizedTarget;
    } else {
      try {
        target = await this._describe(session);
        session.authorizationState = "verified";
        session.authorizedTarget = target;
      } catch (error) {
        session.authorizationState = "unverified";
        throw error;
      }
    }
    let risk;
    const params = command.params && typeof command.params === "object" ? command.params : {};
    if (trustedRead) {
      if (!TRUSTED_READ_METHODS.has(command.method)) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
          `browser trusted read method is not approved: ${command.method}`);
      }
      risk = "read";
    } else {
      try { risk = this.policy.authorizeCommand(target, command.method, params); }
      catch (error) { throw this._mapPolicyError(error); }
    }
    if (command.expectedRisk !== undefined && command.expectedRisk !== risk) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
        `browser command risk acknowledgement mismatch: expected ${command.expectedRisk}, actual ${risk}`);
    }
    if (signal?.aborted) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
        `browser command was cancelled before send: ${command.method}`);
    }
    const requestId = `${this.brokerId}:${this._brokerEpoch}:${++this._requestSeq}`;
    try {
      const result = await this._transport.send(session.transportSession, {
        method: command.method,
        params,
      }, { signal });
      return Object.freeze({
        requestId,
        state: risk === "read" ? "observed" : "applied",
        risk,
        contextEpoch: session.contextEpoch,
        target: Object.freeze({ type: target.type, url: target.url, title: target.title }),
        result,
      });
    } catch (error) {
      if (error?.cancelled) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.commandCancelled,
          `browser command was cancelled: ${command.method}`,
          { outcome: error.outcomeUnknown ? "outcomeUnknown" : "notSent", cause: error });
      }
      if (error?.timedOut) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.commandTimeout,
          `browser command timed out: ${command.method}`, { outcome: "outcomeUnknown", cause: error });
      }
      if (error?.outcomeUnknown) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.outcomeUnknown,
          `browser command outcome is unknown: ${command.method}`, { outcome: "outcomeUnknown", cause: error });
      }
      if (error?.protocolRejected && (error.protocolCode === -32601 || /method.*(not found|unsupported)/i.test(String(error.message)))) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.commandUnsupported,
          `browser command is unsupported: ${command.method}`, { outcome: "rejected", cause: error });
      }
      if (/context|execution context/i.test(String(error?.message || ""))) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.contextReplaced,
          `browser execution context was replaced: ${command.method}`, { outcome: "rejected", retryable: true, cause: error });
      }
      throw this._error(BROWSER_CONTROL_ERROR_CODES.commandRejected,
        `browser command was rejected: ${command.method}: ${error?.message || error}`,
        { outcome: "rejected", cause: error });
    }
  }

  subscribe(sessionRef, listener) {
    const session = this._requireSession(sessionRef);
    if (typeof listener !== "function") throw new TypeError("browser control listener must be a function");
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  async applyViewport(sessionRef, viewport) {
    this._requireOpen();
    const session = this._requireSession(sessionRef);
    const target = await this._describe(session);
    session.authorizationState = "verified";
    session.authorizedTarget = target;
    await applyBrowserViewport((method, params) => this._transport.send(session.transportSession, { method, params }), viewport);
    return viewport;
  }

  async detach(sessionRef) {
    const session = this._requireSession(sessionRef);
    for (const [captureRef, capture] of this._popupCaptures) {
      if (capture.sessionId === session.sessionId) this._popupCaptures.delete(captureRef);
    }
    try { await this._transport.detach(session.transportSession); }
    finally { this._markDetached(session, "client_detach"); }
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    this._popupCaptures.clear();
    const sessions = [...this._sessions.values()].filter((session) => session.state === "attached");
    await Promise.allSettled(sessions.map(async (session) => {
      try { await this._transport.detach(session.transportSession); }
      finally { this._markDetached(session, "broker_close"); }
    }));
    await this._transport.close();
    this._brokerEpoch += 1;
  }

  inspect() {
    return Object.freeze({
      protocolVersion: this.protocolVersion,
      brokerId: this.brokerId,
      brokerEpoch: this._brokerEpoch,
      closed: this._closed,
      targets: this._targets.size,
      sessions: [...this._sessions.values()].filter((session) => session.state === "attached").length,
      popupCaptures: this._popupCaptures.size,
      policy: this.policy.inspect(),
    });
  }

  _sessionRef(session) {
    return Object.freeze({
      protocolVersion: this.protocolVersion,
      brokerId: this.brokerId,
      brokerEpoch: this._brokerEpoch,
      sessionId: session.sessionId,
      targetRef: session.targetRef,
    });
  }

  _requireOpen() {
    if (this._closed) throw this._error(BROWSER_CONTROL_ERROR_CODES.brokerUnavailable, "browser control broker is closed");
  }

  _requireSession(ref) {
    if (!ref || ref.protocolVersion !== this.protocolVersion || ref.brokerId !== this.brokerId || ref.brokerEpoch !== this._brokerEpoch) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.staleBroker, "browser session belongs to a stale broker");
    }
    const session = this._sessions.get(String(ref.sessionId));
    if (!session || session.targetRef !== ref.targetRef || session.state !== "attached") {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.sessionDetached, "browser session is detached");
    }
    return session;
  }

  async _describe(session) {
    try {
      const target = copyTarget(await this._transport.describe(session.transportSession));
      this._authorizeTarget(target);
      return target;
    } catch (error) {
      if (error instanceof BrowserControlError) throw error;
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        `browser target is unavailable: ${session.targetRef}`, { cause: error });
    }
  }

  _authorizeTarget(target) {
    try { return this.policy.authorizeTarget(target); }
    catch (error) { throw this._mapPolicyError(error); }
  }

  _mapPolicyError(error) {
    return this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied, error?.message || "browser permission denied", { cause: error });
  }

  _receiveEvent(session, event) {
    if (session.state !== "attached" || !event || typeof event.method !== "string") return;
    let method = event.method;
    let params = event.params || {};
    if (method === "Runtime.executionContextsCleared" || method === "Page.frameNavigated") {
      session.contextEpoch += 1;
      session.authorizationState = "unverified";
      session.authorizedTarget = null;
      method = "Transport.contextReplaced";
      params = { sourceMethod: event.method, contextEpoch: session.contextEpoch };
    }
    if (method === "Transport.detached") this._markDetached(session, params.reason || "transport_detach");
    if (session.authorizationState !== "verified"
      && method !== "Transport.contextReplaced" && method !== "Transport.detached") return;
    if (!this.policy.allowsEvent(method)) return;
    const normalized = Object.freeze({
      sequence: ++this._eventSeq,
      method,
      params: Object.freeze({ ...params }),
      sessionRef: this._sessionRef(session),
    });
    for (const listener of [...session.listeners]) listener(normalized);
  }

  _markDetached(session, reason, removeTransportListener = true) {
    if (session.state === "detached") return;
    session.state = "detached";
    session.detachReason = reason;
    if (removeTransportListener) session.unsubscribe?.();
  }

  _error(code, message, options = {}) {
    return new BrowserControlError(code, message, options);
  }
}
