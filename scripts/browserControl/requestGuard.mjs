// requestGuard.mjs - read-only browsing: the browser itself refuses every request that could change a server.
//
// The guard is installed on the browser connection before any target is created. Every target the browser then makes
// (pages, popups, cross-site frames, workers, service workers) is attached paused, gets its guard, and only then runs.
// No boundary depends on a script racing the page's own first script:
// - Methods: request interception on the browser connection itself sees every request of every target, including the
//   ones a tab's unload handlers send while the tab closes, after the tab's own session is gone (a page closing a
//   popup it opened would otherwise send them freely). It lets GET, HEAD, and OPTIONS continue and refuses every other
//   method, remembering it (method, origin and path, never the query or body) until the next observe or act result
//   drains it. A refused navigation is answered 204 so the page stays where it was; any other refused request fails.
// - Sockets in documents: interception never sees a WebSocket, and an open socket can send anything. Every page the
//   guard lets through is re-served with a Content-Security-Policy allowing connections only over http(s), blob:, and
//   data:. The policy comes with the document, so it binds the document's first script and every frame or window that
//   inherits the document's policy (about:blank, srcdoc, data:, blob:).
// - Sockets in workers: a dedicated worker is attached paused with its global scope already made, so its socket
//   constructors are replaced before its first script, and the workers it makes are attached the same way.
// - WebTransport runs only over HTTP/3, which the browser of a read-only session is started without
//   (`requestGuardLaunchArgs`).
// Service workers and shared workers have no script context until they run and outlive the page that made them, so one
// that appears is never run; frames also refuse to create them, so a page's registration fails at once instead of
// waiting forever. A target that should be guarded but could not be is never resumed (or, if it already runs, is
// closed), and a page that cannot be re-served is refused. The browser's own targets (its built-in extensions and
// internal pages) are not web content and run unchanged.
// - Downloads: the browser refuses every download a page starts; pyproc's own click download still saves into its
//   artifact folder.
// - Speculative loads: a prefetched or prerendered page is shown from a response the browser fetched outside request
//   interception, so without the connection policy. The browser of a read-only session starts with preloading off
//   (`requestGuardProfilePreferences`), so every page is fetched when it is really visited.
// Refusals are reported by method, origin, and path: requests, downloads, and sockets a document tried to open (the
// browser reports those as policy issues). A socket a worker tried to open is refused without a report.
// A read-only session runs only in a browser-only host with the nativeCdp provider (`assertBrowserRequestHost`); the
// Python Machine page would share its browser and need an exemption this guard does not make.

import { ANY_TARGET_ORIGIN } from "./browserControlPolicy.js";

export const BROWSER_REQUEST_MODES = Object.freeze(["any", "safe"]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CONTAINER_TYPES = new Set(["tab", "browser"]);
const QUIET_TYPES = new Set(["other"]);
const BROWSER_OWN_URL = /^(?:chrome|chrome-extension|chrome-untrusted|edge|devtools):/i;
const FRAME_TYPES = new Set(["page", "iframe"]);
const UNGUARDABLE_TYPES = new Set(["shared_worker", "service_worker"]);
const AUTO_ATTACH = Object.freeze({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
// `http:` and `https:` do not match `ws:` or `wss:` (CSP scheme matching), so sockets are refused before they connect.
const CONNECT_POLICY = "connect-src http: https: blob: data:";
const FETCH_PATTERNS = Object.freeze([
  { urlPattern: "*", requestStage: "Request" },
  { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
]);
// Responses that become a page able to run script: HTML, XHTML, SVG, XML (which XSLT can turn into HTML), and an
// untyped response the browser may sniff as HTML.
const PAGE_TYPES = /html|xml|svg/i;
const EMPTY_STATUSES = new Set([204, 205, 304]);
// A courtesy, not a boundary: a page's service worker registration or shared worker fails at once instead of creating
// a worker that is never run. Idempotent, since a frame can run it more than once.
const FRAME_SCRIPT = `(() => {
  const refused = (name) => new DOMException(name + " is refused in a read-only session", "SecurityError");
  if (globalThis.SharedWorker && globalThis.SharedWorker.readOnlySession !== true) {
    const refuse = function () { throw refused("SharedWorker"); };
    refuse.readOnlySession = true;
    Object.defineProperty(globalThis, "SharedWorker", { value: refuse, configurable: false, writable: false });
  }
  const container = globalThis.ServiceWorkerContainer?.prototype;
  if (container && container.register.readOnlySession !== true) {
    const register = function () { return Promise.reject(refused("A service worker")); };
    register.readOnlySession = true;
    Object.defineProperty(container, "register", { value: register, configurable: false, writable: false });
  }
})();`;
// Run in a paused dedicated worker, whose scope exists before its first script. Idempotent, since a worker can be
// attached from the browser and from its parent.
const WORKER_SCRIPT = `(() => {
  for (const name of ["WebSocket", "WebSocketStream", "WebTransport"]) {
    if (!globalThis[name] || globalThis[name].readOnlySession === true) continue;
    const refuse = function () { throw new DOMException(name + " is refused in a read-only session", "SecurityError"); };
    refuse.readOnlySession = true;
    Object.defineProperty(globalThis, name, { value: refuse, configurable: false, writable: false });
  }
})();`;
const BLOCKED_KEEP = 50;
const SOCKET_URL = /^wss?:/i;
// Policy issues already reported; the browser can report one issue to more than one session.
const ISSUES_KEEP = 500;
// Recent targets and what the guard did with each, for inspect.
const ATTACHED_KEEP = 40;

// The request mode and the scope agree: a mode pyproc knows, and "*" (any site) only for a read-only session. The
// environment parser and the broker check this before anything else about the host is known.
export function assertBrowserRequestScope({ requests, targetOrigins }) {
  if (!BROWSER_REQUEST_MODES.includes(requests)) {
    throw new TypeError(`browser requests must be ${BROWSER_REQUEST_MODES.join(" or ")}: ${requests}`);
  }
  if (targetOrigins.includes(ANY_TARGET_ORIGIN) && requests !== "safe") {
    throw new TypeError("browser target origin * needs requests safe");
  }
}

// Where a read-only session can run: only the nativeCdp provider installs the guard, the Python Machine page would
// share the browser, and a recording of a "*" session could never be replayed (replay has no read-only mode). The
// manifest and the control product check this with the same function.
export function assertBrowserRequestHost({ requests, targetOrigins, providerKind, engineEnabled, recordingMode = "" }) {
  assertBrowserRequestScope({ requests, targetOrigins });
  if (requests !== "safe") return;
  if (providerKind !== "nativeCdp") throw new TypeError("browser requests safe needs the nativeCdp provider");
  if (engineEnabled) throw new TypeError("browser requests safe needs a browser-only host (engine disabled)");
  if (recordingMode && targetOrigins.includes(ANY_TARGET_ORIGIN)) {
    throw new TypeError("a browser session with target origin * cannot be recorded");
  }
}

// Where a URL points, without its path or query, for the guard's own diagnostics.
function originOf(url) {
  try { return new URL(String(url || "")).origin; } catch { return ""; }
}

// How a refused request is reported: origin and path of an http(s) or socket URL, never its query or body; only the
// scheme (and the origin that made it) of a blob: or data: URL, whose text is the content itself.
function reportedUrl(url) {
  const text = String(url || "");
  if (/^data:/i.test(text)) return "data:";
  if (/^blob:/i.test(text)) return `blob:${originOf(text.slice(5))}`;
  try {
    const parsed = new URL(text);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

// Browser arguments a session with this request mode starts with.
export function requestGuardLaunchArgs(mode) {
  return mode === "safe" ? ["--disable-quic"] : [];
}

// First preferences of the fresh profile a session with this request mode starts with: a read-only session never
// preloads pages (speculation rules prefetch and prerender run outside request interception).
export function requestGuardProfilePreferences(mode) {
  return mode === "safe" ? { net: { network_prediction_options: 2 } } : null;
}

export class RequestGuard {
  static async install(connection) {
    const guard = new RequestGuard(connection);
    guard._unsubscribe = connection.subscribe((event) => guard._onEvent(event));
    try {
      await connection.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
      await connection.send("Fetch.enable", { patterns: FETCH_PATTERNS });
      await connection.send("Target.setAutoAttach", AUTO_ATTACH);
    } catch (error) {
      guard.close();
      throw error;
    }
    return guard;
  }

  constructor(connection) {
    this._connection = connection;
    this._blocked = [];
    this._dropped = 0;
    this._blockedTotal = 0;
    this._guarded = new Set();
    this._issues = new Set();
    // Targets attached but not yet guarded and released, and requests paused but not yet decided: a guard that stalls
    // shows here instead of as a page that silently never runs.
    this._pending = new Map();
    this._paused = new Map();
    this._attached = [];
    this._detached = new Set();
    this._failedDecisions = [];
    this._refused = [];
    this._unsubscribe = null;
  }

  _onEvent(event) {
    if (event.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo, waitingForDebugger } = event.params || {};
      void this._guardTarget(sessionId, targetInfo || {}, !!waitingForDebugger);
    } else if (event.method === "Fetch.requestPaused") {
      const params = event.params || {};
      const answered = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
      this._paused.set(params.requestId, Object.freeze({ stage: answered ? "response" : "request",
        resourceType: String(params.resourceType || ""), origin: originOf(params.request?.url) }));
      void (answered ? this._reserve(event.sessionId, params) : this._decide(event.sessionId, params))
        .finally(() => this._paused.delete(params.requestId));
    } else if (event.method === "Audits.issueAdded") {
      this._rememberSocket(event.params?.issue);
    } else if (event.method === "Browser.downloadWillBegin") {
      this._remember("GET", String(event.params?.url || ""), "Download");
    } else if (event.method === "Target.detachedFromTarget") {
      const detached = event.params?.sessionId;
      this._guarded.delete(detached);
      this._pending.delete(detached);
      if (detached) {
        this._detached.add(detached);
        if (this._detached.size > ISSUES_KEEP) this._detached.delete(this._detached.values().next().value);
      }
    }
  }

  _noteTarget(info, waiting, outcome) {
    this._attached.push(Object.freeze({ type: String(info.type || ""), origin: originOf(info.url), waiting,
      outcome }));
    if (this._attached.length > ATTACHED_KEEP) this._attached.shift();
  }

  async _guardTarget(sessionId, info, waiting) {
    if (!sessionId) return;
    const resume = () => this._connection.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    if (QUIET_TYPES.has(info.type) || BROWSER_OWN_URL.test(String(info.url || ""))) {
      if (waiting) await resume().catch(() => {});
      this._noteTarget(info, waiting, "unguarded");
      return;
    }
    let running = !waiting;
    this._pending.set(sessionId, Object.freeze({ type: String(info.type || ""), origin: originOf(info.url) }));
    try {
      const { pageReady } = await this._install(sessionId, info.type);
      // A page, frame, or worker is released whether or not it said it was waiting: Chromium can hold a frame's
      // navigation for an auto-attached client that never reported the wait, and releasing a target that is not held
      // does nothing. A tab or browser container has no script to release unless it waits.
      if (waiting || !CONTAINER_TYPES.has(info.type)) await resume();
      running = true;
      const failure = await pageReady;
      if (failure) throw failure;
      if (!CONTAINER_TYPES.has(info.type)) this._guarded.add(sessionId);
      this._noteTarget(info, waiting, "guarded");
    } catch (error) {
      // A target that went away while its guard was being installed (its tab closed) was never left running.
      if (this._detached.has(sessionId)) {
        this._noteTarget(info, waiting, "gone");
        return;
      }
      this._noteTarget(info, waiting, "refused");
      this._refuseTarget(info.type, error);
      // A page whose guard failed after it started is closed rather than left running unguarded.
      if (running && info.targetId) await this._connection.send("Target.closeTarget", { targetId: info.targetId }).catch(() => {});
    } finally {
      this._pending.delete(sessionId);
    }
  }

  // Installs every guard the target needs before it may run. Commands that the page itself answers (its new-document
  // script and its own auto-attach) are answered only after a page waiting for the debugger runs, so they are sent now,
  // ahead of the release and in order; `pageReady` settles to their error, if any, once they are answered.
  async _install(sessionId, type) {
    if (CONTAINER_TYPES.has(type)) {
      await this._connection.send("Target.setAutoAttach", AUTO_ATTACH, sessionId);
      return { pageReady: null };
    }
    if (UNGUARDABLE_TYPES.has(type)) throw new Error(`a ${type} cannot be guarded before it runs, so it is not run`);
    if (type === "worker") {
      // A dedicated worker's requests are intercepted on the browser connection; its sockets are refused here, and the
      // workers it makes are attached paused in turn.
      const refused = await this._connection.send("Runtime.evaluate", { expression: WORKER_SCRIPT }, sessionId);
      if (refused?.exceptionDetails) throw new Error("the worker kept its sockets");
      await this._connection.send("Target.setAutoAttach", AUTO_ATTACH, sessionId);
      return { pageReady: null };
    }
    if (!FRAME_TYPES.has(type)) return { pageReady: null };
    const pageReady = Promise.all([
      this._connection.send("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_SCRIPT, runImmediately: true },
        sessionId),
      this._connection.send("Target.setAutoAttach", AUTO_ATTACH, sessionId),
      // A socket the connection policy refuses comes back as a policy issue, the one way to report it.
      this._connection.send("Audits.enable", {}, sessionId),
    ]).then(() => null, (error) => error);
    return { pageReady };
  }

  async _decide(sessionId, params) {
    const method = String(params.request?.method || "GET").toUpperCase();
    const url = String(params.request?.url || "");
    try {
      if (SAFE_METHODS.has(method)) {
        await this._connection.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId);
        return;
      }
      this._remember(method, url, params.resourceType);
      if (params.resourceType === "Document") {
        // A refused navigation answered with 204 leaves the page where it was; failing it would replace the page with
        // the browser's error page and the tab would seem to have left its site.
        await this._connection.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204,
          responseHeaders: [{ name: "Cache-Control", value: "no-store" }] }, sessionId);
        return;
      }
      await this._connection.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" },
        sessionId);
    } catch (error) {
      this._decisionFailed("request", params, error);
    }
  }

  // A document response that becomes a page is served again with the connection policy. The browser reads a
  // response's policy before interception can change its headers, so the page is answered anew with its own status,
  // headers, and exact bytes; a page that cannot be read to do so is refused rather than let through without it.
  async _reserve(sessionId, params) {
    const { requestId } = params;
    const headers = params.responseHeaders || [];
    const header = (name) => headers.find((item) => item.name.toLowerCase() === name)?.value || "";
    const status = Number(params.responseStatusCode);
    const type = header("content-type");
    const becomesPage = params.responseErrorReason === undefined
      && !(status >= 300 && status < 400) && !EMPTY_STATUSES.has(status)
      && !/^\s*attachment/i.test(header("content-disposition"))
      && (!type || PAGE_TYPES.test(type))
      && !headers.some((item) => item.name.toLowerCase() === "content-security-policy" && item.value === CONNECT_POLICY);
    try {
      if (!becomesPage) {
        await this._connection.send("Fetch.continueRequest", { requestId }, sessionId);
        return;
      }
      let body;
      try {
        body = await this._connection.send("Fetch.getResponseBody", { requestId }, sessionId);
      } catch (error) {
        this._refuseTarget("document", error);
        await this._connection.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId);
        return;
      }
      await this._connection.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        ...(params.responseStatusText ? { responsePhrase: params.responseStatusText } : {}),
        responseHeaders: [...headers, { name: "Content-Security-Policy", value: CONNECT_POLICY }],
        // A body that is not valid UTF-8 (an EUC-KR page, say) arrives base64-encoded; either way the bytes are kept.
        body: body.base64Encoded ? body.body : Buffer.from(body.body, "utf8").toString("base64"),
      }, sessionId);
    } catch (error) {
      this._decisionFailed("response", params, error);
    }
  }

  // A decision the browser did not take leaves its request waiting unseen; it usually means the request's target went
  // away between the pause and the decision, and inspect lists the recent ones.
  _decisionFailed(stage, params, error) {
    this._failedDecisions.push(Object.freeze({ stage, resourceType: String(params.resourceType || ""),
      origin: originOf(params.request?.url), reason: String(error?.message || error).slice(0, 200) }));
    if (this._failedDecisions.length > 10) this._failedDecisions.shift();
  }

  _refuseTarget(type, error) {
    this._refused.push(Object.freeze({ type: String(type || "unknown"), reason: String(error?.message || error) }));
    if (this._refused.length > 10) this._refused.shift();
  }

  _rememberSocket(issue) {
    const details = issue?.code === "ContentSecurityPolicyIssue" ? issue.details?.contentSecurityPolicyIssueDetails : null;
    const url = String(details?.blockedURL || "");
    if (details?.violatedDirective !== "connect-src" || details.isReportOnly || !SOCKET_URL.test(url)) return;
    const key = issue.issueId || JSON.stringify([url, details.sourceCodeLocation || null]);
    if (this._issues.has(key)) return;
    this._issues.add(key);
    if (this._issues.size > ISSUES_KEEP) this._issues.delete(this._issues.values().next().value);
    this._remember("GET", url, "WebSocket");
  }

  _remember(method, url, resourceType) {
    const where = reportedUrl(url);
    this._blockedTotal += 1;
    this._blocked.push(Object.freeze({ method, url: where, resourceType: String(resourceType || ""), at: Date.now() }));
    if (this._blocked.length > BLOCKED_KEEP) {
      this._blocked.shift();
      this._dropped += 1;
    }
  }

  // The refusals since the last drain, oldest first, and how many older ones did not fit.
  drainBlocked() {
    const drained = Object.freeze({ requests: Object.freeze(this._blocked), dropped: this._dropped });
    this._blocked = [];
    this._dropped = 0;
    return drained;
  }

  inspect() {
    return Object.freeze({ mode: "safe", guardedSessions: this._guarded.size, blockedTotal: this._blockedTotal,
      refusedTargets: this._refused.length, refusals: [...this._refused],
      pendingTargets: [...this._pending.values()], pausedRequests: this._paused.size,
      pausedSample: [...this._paused.values()].slice(0, 10), recentTargets: [...this._attached],
      failedDecisions: [...this._failedDecisions] });
  }

  close() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}
