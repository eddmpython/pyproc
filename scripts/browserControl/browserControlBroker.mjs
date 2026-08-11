// browserControlBroker.mjs - 임시 profile CDP authority를 제한된 port로 감싸는 Node broker.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpConnection } from "./cdpConnection.mjs";
import { BrowserControlError, BrowserControlPort, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";
import { BrowserControlPolicy, BROWSER_CONTROL_RISKS } from "./browserControlPolicy.js";
import { NodeCdpTransport } from "./nodeCdpTransport.js";
import { assertBrowserCompatibility } from "./browserCompatibility.js";

const RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 30000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  constructor({ connection, port, compatibility, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!connection || !port) throw new TypeError("connection and port are required");
    this._connection = connection;
    this.port = port;
    this.compatibility = compatibility || null;
    this._timeoutMs = timeoutMs;
  }

  listTargets() { return this.port.listTargets(); }
  attach(targetRef) { return this.port.attach(targetRef); }
  command(sessionRef, command, options = {}) { return this.port.send(sessionRef, command, options); }
  detach(sessionRef) { return this.port.detach(sessionRef); }

  async openTarget(url) {
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
    await this._connection.send("Target.createTarget", { url: normalized });
    const deadline = Date.now() + this._timeoutMs;
    while (Date.now() < deadline) {
      const target = (await this.port.listTargets()).find((entry) => entry.url === normalized);
      if (target) return target;
      await delay(RETRY_MS);
    }
    throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.targetUnavailable,
      `opened browser target did not become ready: ${normalized}`);
  }

  inspect() {
    return Object.freeze({ transport: "node-cdp", listener: null, compatibility: this.compatibility, ...this.port.inspect() });
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
} = {}) {
  const policy = new BrowserControlPolicy({ targetOrigins, methods, events, fileRoots, downloadRoot, maxRisk });
  const endpoint = await readDevToolsEndpoint(profileDir, { timeoutMs });
  const connection = await CdpConnection.connect(endpoint, { timeoutMs });
  try {
    const compatibility = assertBrowserCompatibility(await connection.send("Browser.getVersion"));
    const port = new BrowserControlPort({ transport: new NodeCdpTransport(connection), policy });
    return new NodeBrowserControlBroker({ connection, port, compatibility, timeoutMs });
  } catch (error) {
    connection.close();
    throw error;
  }
}
