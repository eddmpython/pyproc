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
  surfaceHeld: "BROWSER_CONTROL_SURFACE_HELD",
  targetUnavailable: "BROWSER_CONTROL_TARGET_UNAVAILABLE",
  targetCertificateUntrusted: "BROWSER_CONTROL_TARGET_CERTIFICATE_UNTRUSTED",
});

// Page.getFrameTree stops answering while the page waits on something only the controller can release: an open
// JavaScript dialog, or a document response the download's interception paused. The commands that release it never
// read the frame tree. Closing a dialog uses the target verified just before. Letting a paused response continue
// unchanged and turning interception off change nothing the page did not ask for, so they go to the session's page
// wherever it is, verified or not: a response is never left waiting. Every other command checks the origin again.
const MODAL_UNBLOCK_METHOD = "Page.handleJavaScriptDialog";
const FETCH_RELEASE_METHODS = new Set(["Fetch.continueRequest", "Fetch.disable"]);

function releasesInterception(command) {
  if (!FETCH_RELEASE_METHODS.has(command.method)) return false;
  const params = command.params && typeof command.params === "object" ? command.params : {};
  return command.method === "Fetch.disable" ? Object.keys(params).length === 0
    : Object.keys(params).length === 1 && typeof params.requestId === "string";
}
const TRUSTED_READ_METHODS = new Set([
  "Accessibility.getPartialAXTree", "Accessibility.queryAXTree", "DOM.getDocument", "DOM.getBoxModel", "DOM.getFrameOwner", "DOM.getNodeForLocation", "DOM.resolveNode", "Page.createIsolatedWorld",
  "Page.getFrameTree", "Runtime.callFunctionOn", "Runtime.evaluate", "Runtime.releaseObject",
]);

export class BrowserControlError extends Error {
  constructor(code, message, { outcome = "notSent", retryable = false, cause = undefined, details = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "BrowserControlError";
    this.code = code;
    this.outcome = outcome;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
  }
}

function validateTransport(transport) {
  if (!transport || typeof transport !== "object") throw new TypeError("browser control transport is required");
  for (const method of ["listTargets", "closeTarget", "activateTarget", "attach", "describe", "send", "subscribe", "detach", "close"]) {
    if (typeof transport[method] !== "function") throw new TypeError(`browser control transport is missing ${method}()`);
  }
  return transport;
}

// Where a surface outside the permission went: its origin and path, never its query or fragment (they may carry
// tokens). A surface without an HTTP(S) origin reports none.
export function heldPlace(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return Object.freeze({ origin: "", path: "" });
    return Object.freeze({ origin: parsed.origin, path: parsed.pathname });
  } catch {
    return Object.freeze({ origin: "", path: "" });
  }
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
    // Task targets that arrived outside the permission and are kept, held, until it is widened or they are closed.
    this._heldTargets = new Map();
    this._sessions = new Map();
    this._popupCaptures = new Map();
    this._requestSeq = 0;
    this._eventSeq = 0;
    this._closed = false;
    // Whether a held surface's place may be told; a broker over the user's own browser narrows it to its own tabs.
    this.revealsPlace = () => true;
  }

  async listTargets() {
    this._requireOpen();
    const rawTargets = await this._transport.listTargets();
    const visible = [];
    for (const raw of rawTargets || []) {
      const target = this._rememberVisibleTarget(raw);
      if (target) visible.push(target);
    }
    return Object.freeze(visible);
  }

  async resolveCreatedTarget(targetId) {
    this._requireOpen();
    const raw = (await this._transport.listTargets())
      .find((target) => String(target?.id || "") === String(targetId));
    // A permission narrowed while the target opened: it is held, not lost.
    if (raw && raw.url && !this.policy.allowsTarget(copyTarget(raw))) {
      const targetRef = this.holdTarget(raw);
      throw this._heldError(targetRef, raw);
    }
    const target = raw ? this._rememberVisibleTarget(raw) : null;
    if (!target) throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
      "created browser target is unavailable or outside permission");
    return target;
  }

  async attach(targetRef) {
    this._requireOpen();
    const remembered = this._targets.get(String(targetRef));
    if (!remembered) throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable, `unknown target reference: ${targetRef}`);
    const current = (await this._transport.listTargets()).map(copyTarget).find((target) => target.id === remembered.id);
    if (!current) throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable, `target is unavailable: ${targetRef}`);
    if (this._heldTargets.has(String(targetRef))) {
      // A held target stays open for the caller; only a widened permission lets anything attach to it.
      if (!this.policy.allowsTarget(current.url ? current : remembered)) throw this._heldError(String(targetRef), current);
      this._heldTargets.delete(String(targetRef));
    }
    // Chromium은 새 target 또는 이미 attach된 target의 browser-level URL을 잠깐 빈 문자열로
    // 내릴 수 있다. 마지막 허용 관찰 없이 blank target에 붙지는 않되, attach 직후에는
    // session-level frame URL로 반드시 다시 검사한다. 권한 밖이면 target을 닫지 않고 보류한다.
    if (!this.policy.allowsTarget(current.url ? current : remembered)) {
      this._holdUnattached(String(targetRef), (current.url ? current : remembered).url);
      throw this._heldError(String(targetRef), current.url ? current : remembered);
    }
    let transportSession = null;
    let described = null;
    try {
      transportSession = await this._transport.attach(current.id);
      described = copyTarget(await this._transport.describe(transportSession));
      this._targets.set(String(targetRef), described);
      if (!this.policy.allowsTarget(described)) {
        this._holdUnattached(String(targetRef), described.url);
        throw this._heldError(String(targetRef), described);
      }
    } catch (error) {
      if (transportSession) await Promise.allSettled([this._transport.detach(transportSession)]);
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
      lastTarget: described,
      contextEpoch: 0,
      unsubscribe: null,
    };
    session.unsubscribe = this._transport.subscribe(transportSession, (event) => this._receiveEvent(session, event));
    this._sessions.set(sessionId, session);
    return this._sessionRef(session);
  }

  async closeTarget(targetRef) {
    this._requireOpen();
    const ref = String(targetRef);
    const target = this._targets.get(ref);
    if (!target) throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
      `unknown target reference: ${targetRef}`);
    const attached = [...this._sessions.values()].filter((session) => session.targetRef === ref);
    await Promise.allSettled(attached.map((session) => this.detach(this._sessionRef(session))));
    await this._transport.closeTarget(target.id);
    this._targets.delete(ref);
    this._heldTargets.delete(ref);
    return Object.freeze({ closed: true, targetRef: ref });
  }

  /** Keep a task target that arrived outside the permission, held: it is listed nowhere and nothing attaches to it
   * until the permission is widened to its origin. Returns the reference the caller attaches with afterwards. */
  holdTarget(raw) {
    this._requireOpen();
    const target = copyTarget(raw);
    let targetRef = [...this._targets.entries()].find(([, value]) => value.id === target.id)?.[0];
    if (!targetRef) targetRef = `target:${this._idFactory()}`;
    this._targets.set(targetRef, target);
    this._heldTargets.set(targetRef, heldPlace(target.url));
    return targetRef;
  }

  /** Replace the permission in place. Every later check (listing, attach, each command of a running request) uses the
   * new one; a surface outside it is held, and a held surface inside it continues. */
  async revisePolicy(policy) {
    this._requireOpen();
    const next = policy instanceof BrowserControlPolicy ? policy : new BrowserControlPolicy(policy);
    // Tabs that closed on their own are forgotten first, so none is reported held.
    const live = new Set((await this._transport.listTargets()).map((target) => String(target?.id || "")));
    for (const [targetRef, target] of [...this._targets]) {
      if (live.has(target.id)) continue;
      this._targets.delete(targetRef);
      this._heldTargets.delete(targetRef);
    }
    this.policy = next;
    // Every surface is judged against the new permission at once, where it was last seen: one now outside is held
    // (its events stop and nothing attaches to it), one now inside is released and verified again at its next request.
    const attachedRefs = new Set();
    for (const session of this._sessions.values()) {
      if (session.state !== "attached") continue;
      attachedRefs.add(session.targetRef);
      if (!this.policy.allowsTarget(session.lastTarget)) {
        session.held = heldPlace(session.lastTarget?.url);
        session.authorizationState = "held";
        session.authorizedTarget = null;
      } else if (session.held) {
        session.held = null;
        session.authorizationState = "unverified";
      }
    }
    for (const [targetRef, target] of this._targets) {
      if (this.policy.allowsTarget(target)) this._heldTargets.delete(targetRef);
      else if (!attachedRefs.has(targetRef)) this._heldTargets.set(targetRef, heldPlace(target.url));
    }
    return this.policy.inspect();
  }

  /** Whether the session's surface is held outside the permission (its last check found it there). */
  sessionHeld(sessionRef) {
    const session = this._sessions.get(String(sessionRef?.sessionId || ""));
    return Boolean(session?.held);
  }

  _rememberVisibleTarget(raw) {
    const target = copyTarget(raw);
    if (!target.id || !this.policy.allowsTarget(target)) return null;
    let targetRef = [...this._targets.entries()].find(([, value]) => value.id === target.id)?.[0];
    if (!targetRef) targetRef = `target:${this._idFactory()}`;
    this._targets.set(targetRef, target);
    return Object.freeze({ targetRef, type: target.type, url: target.url, title: target.title });
  }

  /** Whether the browser saves a download itself and the transport says where (the user's own browser); otherwise
   * pyproc tells the browser over CDP where to save. */
  get browserSavesDownloads() {
    return typeof this._transport.armDownload === "function";
  }

  // Arms the transport for the one download the session's tab starts next, once the session's surface is checked to
  // be inside the permission. Returns `{ done, cancel }`: `done` settles to where the browser saved it, or why not.
  async armDownload(sessionRef, { timeoutMs }) {
    this._requireOpen();
    const session = this._requireSession(sessionRef);
    if (!this.browserSavesDownloads) throw new TypeError("this browser does not save downloads itself");
    await this.verifySurface(sessionRef);
    return this._transport.armDownload(session.transportSession, { timeoutMs });
  }

  // Checks again that the session's surface is inside the permission (it is described afresh); a surface outside it
  // is held and throws BROWSER_CONTROL_SURFACE_HELD. For an effect that finished without a command of its own (a
  // download the user's browser saved) before its result is taken.
  async verifySurface(sessionRef) {
    this._requireOpen();
    const session = this._requireSession(sessionRef);
    try {
      const target = await this._describe(session);
      session.authorizationState = "verified";
      session.authorizedTarget = target;
    } catch (error) {
      session.authorizationState = error?.code === BROWSER_CONTROL_ERROR_CODES.surfaceHeld ? "held" : "unverified";
      throw error;
    }
  }

  // Turns the session's own interception off, whatever the permission now says: an effect that turned it on (a
  // download reading its response) must be able to turn it off after a revision took the method away. It changes
  // nothing the page asked for, needs no surface, and returns nothing.
  async releaseInterception(sessionRef) {
    const session = this._sessions.get(String(sessionRef?.sessionId || ""));
    if (!session || session.state !== "attached") return;
    await this._transport.send(session.transportSession, { method: "Fetch.disable", params: {} }).catch(() => {});
  }

  // A paused request nobody will hear of is let go: a response that already came is continued unchanged, and a
  // request not yet sent is refused (nothing is sent from a surface that is not verified, or through interception the
  // permission no longer names).
  _releasePaused(session, params) {
    if (typeof params.requestId !== "string") return;
    const answered = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
    this._transport.send(session.transportSession, answered
      ? { method: "Fetch.continueRequest", params: { requestId: params.requestId } }
      : { method: "Fetch.failRequest", params: { requestId: params.requestId, errorReason: "BlockedByClient" } })
      .catch(() => {});
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
          await this._restorePopupOpener(session);
          throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
            `browser click opened ${candidates.length} popup targets`, { outcome: "applied" });
        }
        const target = candidates[0];
        if (target && target.url && target.url !== "about:blank") {
          try { this._authorizeTarget(target); }
          catch (error) {
            await Promise.allSettled([this._transport.closeTarget(target.id)]);
            await this._restorePopupOpener(session);
            // A popup is not a surface the caller opened: it is closed, and the caller learns where it went.
            throw this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
              "browser popup final URL is outside permission", { outcome: "applied", cause: error,
                details: heldPlace(target.url) });
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
      await this._restorePopupOpener(session);
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        "browser popup did not reach an allowed stable URL", { outcome: "outcomeUnknown" });
    } finally {
      this._popupCaptures.delete(String(captureRef));
    }
  }

  cancelPopupCapture(captureRef) {
    this._popupCaptures.delete(String(captureRef));
  }

  async _restorePopupOpener(session) {
    try { await this._transport.activateTarget(session.targetId); }
    catch (error) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        "browser popup cleanup could not restore the opener", { outcome: "applied", cause: error });
    }
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
    const release = !trustedRead && releasesInterception(command);
    if (release) {
      // A release names no surface it has not verified: a held or unverified page is never described in its result.
      target = session.authorizationState === "verified" && session.authorizedTarget ? session.authorizedTarget
        : Object.freeze({ type: "page", url: "", title: "" });
    } else if (command.method === MODAL_UNBLOCK_METHOD) {
      if (session.authorizationState !== "verified" || !session.authorizedTarget) {
        throw this._error(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
          "browser unblock requires a verified target");
      }
      target = session.authorizedTarget;
    } else {
      try {
        target = await this._describe(session);
        session.authorizationState = "verified";
        session.authorizedTarget = target;
      } catch (error) {
        session.authorizationState = error?.code === BROWSER_CONTROL_ERROR_CODES.surfaceHeld ? "held" : "unverified";
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
      try {
        risk = release ? this.policy.authorizeRelease(command.method, params)
          : this.policy.authorizeCommand(target, command.method, params);
      } catch (error) { throw this._mapPolicyError(error); }
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
    // A surface held when its session ends stays held where it was (the broker closes the ones it owns).
    if (session.lastTarget) this._targets.set(session.targetRef, session.lastTarget);
    if (session.held) this._heldTargets.set(session.targetRef, session.held);
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
      retainedSessions: this._sessions.size,
      popupCaptures: this._popupCaptures.size,
      heldSurfaces: Object.freeze([
        ...[...this._heldTargets].map(([targetRef, place]) => Object.freeze({ targetRef,
          ...(this.revealsPlace(targetRef) ? place : { origin: "", path: "" }) })),
        ...[...this._sessions.values()].filter((session) => session.state === "attached" && session.held)
          .map((session) => Object.freeze({ targetRef: session.targetRef, sessionId: session.sessionId,
            ...(this.revealsPlace(session.targetRef) ? session.held : { origin: "", path: "" }) })),
      ]),
      transport: this._transport.inspect?.() || null,
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
    let target;
    try {
      target = copyTarget(await this._transport.describe(session.transportSession));
    } catch (error) {
      throw this._error(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        `browser target is unavailable: ${session.targetRef}`, { cause: error });
    }
    // A surface that arrived outside the permission is held, not dropped: the caller learns where it went and may
    // widen the permission to go on with this same surface.
    session.lastTarget = target;
    if (!this.policy.allowsTarget(target)) {
      session.held = heldPlace(target.url);
      throw this._heldError(session.targetRef, target);
    }
    session.held = null;
    return target;
  }

  // A target with a session attached is held through that session; only one without keeps its own entry.
  _holdUnattached(targetRef, url) {
    const attached = [...this._sessions.values()].some((session) => session.state === "attached"
      && session.targetRef === targetRef);
    if (!attached) this._heldTargets.set(targetRef, heldPlace(url));
  }

  _heldError(targetRef, target) {
    // A surface the task did not open (a tab the user handed over in their own browser) is held without its place.
    const place = this.revealsPlace(targetRef) ? heldPlace(target?.url) : Object.freeze({ origin: "", path: "" });
    return this._error(BROWSER_CONTROL_ERROR_CODES.surfaceHeld,
      "browser surface is outside permission and held until the permission is widened to it or it is closed",
      { details: Object.freeze({ targetRef, ...place }) });
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
      const frame = method === "Page.frameNavigated" ? params.frame : null;
      if (frame?.parentId) {
        // A child frame's navigation replaces the locator epoch, not the surface: the page is where it was.
      } else if (frame && typeof frame.url === "string" && session.lastTarget) {
        // The main frame committed this URL: the surface is judged by it at once, so a page that moved on inside the
        // permission (an interstitial that starts a download, say) keeps its events flowing.
        session.lastTarget = Object.freeze({ ...session.lastTarget, url: frame.url });
        const allowed = this.policy.allowsTarget(session.lastTarget);
        session.held = allowed ? null : heldPlace(frame.url);
        session.authorizationState = allowed ? "verified" : "held";
        session.authorizedTarget = allowed ? session.lastTarget : null;
      } else {
        session.authorizationState = "unverified";
        session.authorizedTarget = null;
      }
      method = "Transport.contextReplaced";
      params = { sourceMethod: event.method, contextEpoch: session.contextEpoch };
    }
    const detachedListeners = method === "Transport.detached" ? [...session.listeners] : null;
    if (detachedListeners) this._markDetached(session, params.reason || "transport_detach");
    if (session.authorizationState !== "verified"
      && method !== "Transport.contextReplaced" && method !== "Transport.detached") {
      if (method === "Fetch.requestPaused") this._releasePaused(session, params);
      return;
    }
    if (!this.policy.allowsEvent(method)) {
      if (method === "Fetch.requestPaused") this._releasePaused(session, params);
      return;
    }
    const normalized = Object.freeze({
      sequence: ++this._eventSeq,
      method,
      params: Object.freeze({ ...params }),
      sessionRef: this._sessionRef(session),
    });
    for (const listener of detachedListeners || [...session.listeners]) listener(normalized);
  }

  _markDetached(session, reason, removeTransportListener = true) {
    if (session.state === "detached") return;
    session.state = "detached";
    session.detachReason = reason;
    if (removeTransportListener) session.unsubscribe?.();
    session.unsubscribe = null;
    session.listeners.clear();
    this._sessions.delete(session.sessionId);
  }

  _error(code, message, options = {}) {
    return new BrowserControlError(code, message, options);
  }
}
