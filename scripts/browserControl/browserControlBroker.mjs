// browserControlBroker.mjs - 임시 profile CDP authority를 제한된 port로 감싸는 Node broker.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpConnection } from "./cdpConnection.mjs";
import { BrowserControlError, BrowserControlPort, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";
import { BrowserControlPolicy, BROWSER_CONTROL_RISKS } from "./browserControlPolicy.js";
import { NodeCdpTransport } from "./nodeCdpTransport.js";
import { assertBrowserCompatibility } from "./browserCompatibility.js";
import { applyBrowserViewport } from "./browserViewport.js";
import { normalizeBrowserObservationEvent } from "./browserObservation.js";

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

export async function readDevToolsEndpoint(profileDir, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!profileDir || typeof profileDir !== "string") throw new TypeError("profileDir is required");
  const path = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const [port, browserPath] = (await readFile(path, "utf8")).trim().split(/\r?\n/);
      if (Number(port) > 0 && browserPath?.startsWith("/devtools/browser/")) {
        return `ws://127.0.0.1:${port}${browserPath}`;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(RETRY_MS);
  }
  throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.brokerUnavailable,
    `DevToolsActivePort unavailable: ${lastError?.code || "invalid contents"}`);
}

export class NodeBrowserControlBroker {
  constructor({ connection, port, compatibility, timeoutMs = DEFAULT_TIMEOUT_MS, viewport = null } = {}) {
    if (!connection || !port) throw new TypeError("connection and port are required");
    this._connection = connection;
    this.port = port;
    this.compatibility = compatibility || null;
    this._timeoutMs = timeoutMs;
    this._viewport = viewport;
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
      ({ targetId } = await this._connection.send("Target.createTarget", { url: "about:blank" }));
      created = true;
      ({ sessionId } = await this._connection.send("Target.attachToTarget", { targetId, flatten: true }));
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
      await this._connection.send("Target.detachFromTarget", { sessionId });
      sessionId = "";
      const deadlineAfterDetach = Date.now() + this._timeoutMs;
      while (Date.now() < deadlineAfterDetach) {
        const target = (await this.port.listTargets()).find((entry) => entry.url === finalTarget.url);
        if (target) {
          return Object.freeze({
            ...target,
            startup: Object.freeze({
              waitUntil,
              readyState,
              viewport: this._viewport,
              ...startupObservation(events, rawEventsTruncated),
            }),
          });
        }
        await delay(RETRY_MS);
      }
      throw new Error(`opened browser target did not become visible: ${finalTarget.url}`);
    } catch (error) {
      if (created) await Promise.allSettled([this._connection.send("Target.closeTarget", { targetId })]);
      if (error instanceof BrowserControlError) throw error;
      throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
        `opened browser target did not become ready: ${normalized}`, {
          outcome: created ? "applied" : "notSent",
          cause: error,
        });
    } finally {
      unsubscribe?.();
      if (sessionId) await Promise.allSettled([
        this._connection.send("Target.detachFromTarget", { sessionId }),
      ]);
    }
  }

  inspect() {
    return Object.freeze({ transport: "node-cdp", listener: null, compatibility: this.compatibility,
      viewport: this._viewport, ...this.port.inspect() });
  }

  close() { return this.port.close(); }
}

export async function connectNodeBrowserControl({
  profileDir,
  targetOrigins,
  methods,
  events = [],
  fileRoots = [],
  downloadRoot = null,
  maxRisk = "read",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  viewport = null,
} = {}) {
  const policy = new BrowserControlPolicy({ targetOrigins, methods, events, fileRoots, downloadRoot, maxRisk });
  const endpoint = await readDevToolsEndpoint(profileDir, { timeoutMs });
  const connection = await CdpConnection.connect(endpoint, { timeoutMs });
  try {
    const compatibility = assertBrowserCompatibility(await connection.send("Browser.getVersion"));
    const port = new BrowserControlPort({ transport: new NodeCdpTransport(connection), policy });
    return new NodeBrowserControlBroker({ connection, port, compatibility, timeoutMs, viewport });
  } catch (error) {
    connection.close();
    throw error;
  }
}
