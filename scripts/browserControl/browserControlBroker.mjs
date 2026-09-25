// browserControlBroker.mjs - 임시 profile 브라우저의 CDP pipe authority를 제한된 port로 감싸는 Node broker.
import { CdpConnection } from "./cdpConnection.mjs";
import { BrowserControlError, BrowserControlPort, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";
import { BrowserControlPolicy, BROWSER_CONTROL_RISKS } from "./browserControlPolicy.js";
import { NodeCdpTransport } from "./nodeCdpTransport.js";
import { assertBrowserCompatibility } from "./browserCompatibility.js";
import { applyBrowserViewport } from "./browserViewport.js";
import { normalizeBrowserObservationEvent } from "./browserObservation.js";
import { RequestGuard, assertBrowserRequestScope } from "./requestGuard.mjs";

const RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 30000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STARTUP_EVENT_LIMIT = 100;
const STARTUP_RAW_EVENT_LIMIT = STARTUP_EVENT_LIMIT * 4;
const OPEN_WAIT_STATES = new Set(["commit", "domcontentloaded", "load"]);

function startupObservation(events, rawTruncated = false) {
  const consoleEvents = [];
  const networkEvents = [];
  let truncated = rawTruncated;
  for (const event of events) {
    const normalized = normalizeBrowserObservationEvent(event, () => crypto.randomUUID());
    if (!normalized) continue;
    const bucket = normalized.kind === "console" ? consoleEvents : networkEvents;
    if (bucket.length >= STARTUP_EVENT_LIMIT) {
      truncated = true;
      continue;
    }
    bucket.push(normalized);
  }
  return Object.freeze({
    console: Object.freeze(consoleEvents),
    network: Object.freeze(networkEvents),
    truncated,
  });
}

// How a broker creates, attaches to, and closes the raw targets it opens: the browser's own Target domain on a native
// CDP pipe. The user-browser provider supplies the same four through its extension.
export function cdpTargets(connection) {
  return Object.freeze({
    kind: "node-cdp",
    create: async (url) => (await connection.send("Target.createTarget", { url })).targetId,
    attach: async (targetId) => (await connection.send("Target.attachToTarget", { targetId, flatten: true })).sessionId,
    detach: (sessionId) => connection.send("Target.detachFromTarget", { sessionId }),
    close: (targetId) => connection.send("Target.closeTarget", { targetId }),
  });
}

export class NodeBrowserControlBroker {
  constructor({ connection, port, compatibility, timeoutMs = DEFAULT_TIMEOUT_MS, viewport = null, guard = null,
    targets = cdpTargets(connection) } = {}) {
    if (!connection || !port) throw new TypeError("connection and port are required");
    this._connection = connection;
    this._targets = targets;
    this._guard = guard;
    this.port = port;
    this.compatibility = compatibility || null;
    this._timeoutMs = timeoutMs;
    this._viewport = viewport;
    this._ownedTargets = new Set();
  }

  listTargets() { return this.port.listTargets(); }
  async attach(targetRef) {
    const sessionRef = await this.port.attach(targetRef);
    try {
      if (this._viewport) await this.port.applyViewport(sessionRef, this._viewport);
      return sessionRef;
    } catch (error) {
      await Promise.allSettled([this.port.detach(sessionRef)]);
      throw error;
    }
  }
  command(sessionRef, command, { signal } = {}) { return this.port.send(sessionRef, command, { signal }); }
  detach(sessionRef) { return this.port.detach(sessionRef); }
  async closeTarget(targetRef) {
    if (!this._ownedTargets.has(String(targetRef))) {
      throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
        "only a target created by this broker can be closed");
    }
    const output = await this.port.closeTarget(targetRef);
    this._ownedTargets.delete(String(targetRef));
    return output;
  }

  async openTarget(url, { waitUntil = "commit" } = {}) {
    if (!OPEN_WAIT_STATES.has(waitUntil)) throw new TypeError("browser open waitUntil is invalid");
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
        "browser target URL must use HTTP(S) without embedded credentials");
    }
    const normalized = parsed.href;
    try { this.port.policy.authorizeTarget({ id: "candidate", type: "page", url: normalized, title: "" }); }
    catch (error) {
      throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
        `browser target is outside permission: ${normalized}`, { cause: error });
    }
    if (BROWSER_CONTROL_RISKS[this.port.policy.maxRisk] < BROWSER_CONTROL_RISKS.externalEffect) {
      throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
        "opening a browser target requires maxRisk externalEffect");
    }
    let targetId = "";
    let sessionId = "";
    let unsubscribe = null;
    let created = false;
    const events = [];
    let rawEventsTruncated = false;
    try {
      targetId = await this._targets.create("about:blank");
      created = true;
      sessionId = await this._targets.attach(targetId);
      unsubscribe = this._connection.subscribe((event) => {
        if (event.sessionId !== sessionId) return;
        if (events.length < STARTUP_RAW_EVENT_LIMIT) events.push(event);
        else rawEventsTruncated = true;
      });
      await this._connection.send("Page.enable", {}, sessionId);
      await this._connection.send("Runtime.enable", {}, sessionId);
      await this._connection.send("Network.enable", {}, sessionId);
      if (this._viewport) {
        await applyBrowserViewport((method, params) => this._connection.send(method, params, sessionId), this._viewport);
      }
      const navigation = await this._connection.send("Page.navigate", { url: normalized }, sessionId);
      // 인증서 실패는 원인을 지목한다: 호출자가 자기 코드를 의심하지 않고 browser.trustedCertificates를 본다.
      if (/^net::ERR_CERT_/.test(navigation.errorText || "")) {
        throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.targetCertificateUntrusted,
          `browser target certificate is not trusted (${navigation.errorText}): ${normalized}`, {
            outcome: "applied", details: Object.freeze({ errorText: navigation.errorText, url: normalized }),
          });
      }
      if (navigation.errorText) throw new Error(`navigation rejected: ${navigation.errorText}`);
      const deadline = Date.now() + this._timeoutMs;
      let finalTarget = null;
      let readyState = "commit";
      while (Date.now() < deadline) {
        try {
          const tree = await this._connection.send("Page.getFrameTree", {}, sessionId);
          const frame = tree.frameTree?.frame;
          if (frame?.url && frame.url !== "about:blank") {
            if (waitUntil !== "commit") {
              const ready = await this._connection.send("Runtime.evaluate", {
                expression: "document.readyState",
                returnByValue: true,
              }, sessionId);
              readyState = String(ready.result?.value || "");
            }
            if (waitUntil === "commit"
              || (waitUntil === "domcontentloaded" && ["interactive", "complete"].includes(readyState))
              || (waitUntil === "load" && readyState === "complete")) {
              finalTarget = { id: targetId, type: "page", url: frame.url, title: "" };
              break;
            }
          }
        } catch (error) {
          if (!/context|frame|target/i.test(String(error?.message || error))) throw error;
        }
        await delay(RETRY_MS);
      }
      if (!finalTarget) throw new Error(`navigation did not reach ${waitUntil}: ${normalized}`);
      try { this.port.policy.authorizeTarget(finalTarget); }
      catch (error) {
        throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.permissionDenied,
          "browser navigation final URL is outside permission", { outcome: "applied", cause: error });
      }
      unsubscribe();
      unsubscribe = null;
      await this._targets.detach(sessionId);
      sessionId = "";
      const deadlineAfterDetach = Date.now() + this._timeoutMs;
      while (Date.now() < deadlineAfterDetach) {
        try {
          const target = await this.port.resolveCreatedTarget(targetId);
          this._ownedTargets.add(target.targetRef);
          return Object.freeze({
            ...target,
            startup: Object.freeze({
              waitUntil,
              readyState,
              viewport: this._viewport,
              ...startupObservation(events, rawEventsTruncated),
            }),
          });
        } catch (error) {
          if (error?.code !== BROWSER_CONTROL_ERROR_CODES.targetUnavailable) throw error;
        }
        await delay(RETRY_MS);
      }
      throw new Error(`opened browser target did not become visible: ${finalTarget.url}`);
    } catch (error) {
      if (created) await Promise.allSettled([this._targets.close(targetId)]);
      if (error instanceof BrowserControlError) throw error;
      throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        `opened browser target did not become ready: ${normalized}`, {
          outcome: created ? "applied" : "notSent",
          cause: error,
        });
    } finally {
      unsubscribe?.();
      if (sessionId) await Promise.allSettled([this._targets.detach(sessionId)]);
    }
  }

  inspect() {
    return Object.freeze({ transport: this._targets.kind, listener: null, compatibility: this.compatibility,
      viewport: this._viewport, ownedTargets: this._ownedTargets.size,
      requests: this._guard ? this._guard.inspect() : Object.freeze({ mode: "any" }),
      connection: this._connection.inspect?.() || null, ...this.port.inspect() });
  }

  // Requests the read-only guard refused since the last call ({requests, dropped}); null when any request may be sent.
  blockedRequests() { return this._guard ? this._guard.drainBlocked() : null; }

  // Lets a navigation or submission an action set off be decided before its result is drained (read-only only).
  settle() { return this._guard ? this._guard.settle() : Promise.resolve(); }

  close() {
    this._guard?.close();
    return this.port.close();
  }
}

export async function connectNodeBrowserControl({
  cdpPipe,
  targetOrigins,
  methods,
  events = [],
  fileRoots = [],
  downloadRoot = null,
  maxRisk = "read",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  viewport = null,
  requests = "any",
} = {}) {
  assertBrowserRequestScope({ requests, targetOrigins });
  const policy = new BrowserControlPolicy({ targetOrigins, methods, events, fileRoots, downloadRoot, maxRisk });
  const connection = CdpConnection.overPipe(cdpPipe, { timeoutMs });
  let guard = null;
  try {
    const compatibility = assertBrowserCompatibility(await connection.send("Browser.getVersion"));
    // Installed before the first target is opened, so no request of the session ever runs unguarded.
    guard = requests === "safe" ? await RequestGuard.install(connection) : null;
    const port = new BrowserControlPort({ transport: new NodeCdpTransport(connection), policy });
    return new NodeBrowserControlBroker({ connection, port, compatibility, timeoutMs, viewport, guard });
  } catch (error) {
    guard?.close();
    connection.close();
    throw error;
  }
}
