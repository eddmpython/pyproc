// controlProduct.mjs - Python machine page와 automation provider를 한 ControlHost로 조립한다.
import { realpathSync, statSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer, safeJoin, sendFile } from "../staticServer.mjs";
import { launchBrowser } from "../browserControl/browserLauncher.mjs";
import { createBrowserControlTools, parseBrowserControlConfig } from "../browserControl/index.js";
import { AutomationSpaceRouter } from "../automationSpace/automationSpace.js";
import { FrameSpace, assertFrameSpaceConfig } from "../automationSpace/frameSpace.js";
import { createFrameSpaceTools } from "../automationSpace/frameSpaceTools.js";
import { NativeCdpSpace } from "../automationSpace/nativeCdpSpace.js";
import { ControlHost } from "./controlHost.js";
import { controlOperationCatalog } from "./controlOperations.js";
import { PageCommandBridge } from "./pageCommandBridge.mjs";

const DEFAULT_COMMAND_TIMEOUT_MS = 180000;
const POLL_HOLD_MS = 20000;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CONTROL_PYTHON_TOOLS = Object.freeze([
  Object.freeze({
    name: "pythonRun",
    description: "Run Python in the prepared browser machine under a fail-closed external-network policy. Returns stdout and the repr of the last expression. State persists across calls.",
    inputSchema: { type: "object", properties: { code: { type: "string", description: "Python source to execute" } }, required: ["code"] },
  }),
  Object.freeze({
    name: "checkpointSave",
    description: "Save the current machine state as a restore handle. Returns the checkpoint index.",
    inputSchema: { type: "object", properties: {} },
  }),
  Object.freeze({
    name: "checkpointRestore",
    description: "Restore a saved checkpoint in milliseconds (omit index for the most recent save). Use after a failed attempt to get the prepared state back.",
    inputSchema: { type: "object", properties: { index: { type: "number", description: "Checkpoint index from checkpointSave" } } },
  }),
  Object.freeze({
    name: "sandboxReset",
    description: "Restore the machine to its just-booted prepared state (cp0) and drop saved checkpoints.",
    inputSchema: { type: "object", properties: {} },
  }),
]);

function configuredEngineRoot(value) {
  if (!value) return null;
  if (!isAbsolute(value)) throw new TypeError("PYPROC_MCP_ENGINE_ROOT must be absolute");
  const root = realpathSync(resolve(value));
  if (!statSync(root).isDirectory()) throw new TypeError("PYPROC_MCP_ENGINE_ROOT must be a directory");
  return root;
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("control request body exceeds the byte limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

export async function createControlProduct({ env = process.env } = {}) {
  const timeoutMs = Number(env.PYPROC_MCP_TIMEOUT || DEFAULT_COMMAND_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("PYPROC_MCP_TIMEOUT must be positive");
  const browserEnabled = env.PYPROC_BROWSER_CONTROL === "1";
  const providerKind = browserEnabled ? (env.PYPROC_AUTOMATION_PROVIDER || "nativeCdp") : null;
  if (browserEnabled && !["nativeCdp", "frame"].includes(providerKind)) {
    throw new TypeError(`unsupported automation provider: ${providerKind}`);
  }
  const browserConfig = browserEnabled ? parseBrowserControlConfig(env, { timeoutMs }) : null;
  if (providerKind === "frame") assertFrameSpaceConfig(browserConfig);
  const browserTools = browserConfig
    ? (providerKind === "frame" ? createFrameSpaceTools(browserConfig) : createBrowserControlTools(browserConfig)) : [];
  const tools = Object.freeze(browserEnabled ? [...CONTROL_PYTHON_TOOLS, ...browserTools] : [...CONTROL_PYTHON_TOOLS]);
  const pythonToolNames = new Set(CONTROL_PYTHON_TOOLS.map((tool) => tool.name));
  const engineRoot = configuredEngineRoot(env.PYPROC_MCP_ENGINE_ROOT);
  const pageBridge = new PageCommandBridge({ timeoutMs });
  const controlToken = randomBytes(32).toString("base64url");
  const expectedToken = Buffer.from(controlToken);
  const authorizedControlRequest = (req) => {
    const supplied = Buffer.from(String(req.headers["x-pyproc-control-token"] || ""));
    return supplied.byteLength === expectedToken.byteLength && timingSafeEqual(supplied, expectedToken);
  };

  const server = createStaticServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://control.local");
    if (req.method === "GET" && engineRoot && requestUrl.pathname.startsWith("/pyprocEngine/")) {
      const file = safeJoin(engineRoot, requestUrl.pathname.slice("/pyprocEngine/".length));
      if (!file) { res.writeHead(403); res.end("forbidden"); return true; }
      await sendFile(res, file);
      return true;
    }
    if (["/controlReady", "/controlCommand", "/controlResult"].includes(requestUrl.pathname)
      && !authorizedControlRequest(req)) {
      req.resume();
      sendJson(res, 403, { error: "CONTROL_BRIDGE_UNAUTHORIZED", message: "control bridge token is invalid" });
      return true;
    }
    if (req.method === "POST" && requestUrl.pathname === "/controlReady") {
      try { sendJson(res, 200, pageBridge.ready(await readJsonBody(req))); }
      catch (error) { sendJson(res, 400, { error: error?.code || "CONTROL_INVALID_FRAME", message: String(error?.message || error) }); }
      return true;
    }
    if (req.method === "GET" && requestUrl.pathname === "/controlCommand") {
      const pageEpoch = requestUrl.searchParams.get("pageEpoch") || "";
      let command;
      try { command = pageBridge.poll(pageEpoch); }
      catch (error) { sendJson(res, 409, { error: error?.code || "CONTROL_PAGE_STALE", message: String(error?.message || error) }); return true; }
      if (command) { sendJson(res, 200, command); return true; }
      let cancelHold = null;
      const hold = setTimeout(() => {
        cancelHold?.();
        sendJson(res, 200, { none: true, pageEpoch });
      }, POLL_HOLD_MS);
      try {
        cancelHold = pageBridge.holdPoll(pageEpoch, (next, error) => {
          clearTimeout(hold);
          if (error) sendJson(res, 409, { error: error?.code || "CONTROL_PAGE_STALE", message: String(error?.message || error) });
          else sendJson(res, 200, next);
        });
      } catch (error) {
        clearTimeout(hold);
        sendJson(res, 409, { error: error?.code || "CONTROL_POLL_CONFLICT", message: String(error?.message || error) });
      }
      return true;
    }
    if (req.method === "POST" && requestUrl.pathname === "/controlResult") {
      try { sendJson(res, 200, pageBridge.result(await readJsonBody(req))); }
      catch (error) { sendJson(res, 400, { error: error?.code || "CONTROL_INVALID_FRAME", message: String(error?.message || error) }); }
      return true;
    }
    return false;
  }, { root: PACKAGE_ROOT });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const serverOrigin = `http://127.0.0.1:${server.address().port}`;
  const engineIndexURL = engineRoot ? `${serverOrigin}/pyprocEngine/`
    : (env.PYPROC_INDEX_URL || `${serverOrigin}/vendor/pyodide/`);
  const pageParams = new URLSearchParams({ indexURL: engineIndexURL });
  if (providerKind === "frame") {
    pageParams.set("automationProvider", "frame");
    pageParams.set("frameConfig", Buffer.from(JSON.stringify({
      spaceId: "space:frame",
      targetOrigins: browserConfig.targetOrigins,
      actions: browserConfig.actions,
      timeoutMs: Math.min(timeoutMs, 10000),
      artifacts: browserConfig.artifacts,
    })).toString("base64url"));
  }
  const pageUrl = `${serverOrigin}/scripts/browserControl/mcpMachine.html?${pageParams}`;
  const launchUrl = `${pageUrl}#controlToken=${encodeURIComponent(controlToken)}`;
  let browserSession = null;
  let browserControl = null;
  let automationSpace = null;
  let automationRouter = null;
  try {
    browserSession = launchBrowser(launchUrl, {
      prefix: "pyprocControl-",
      extraArgs: providerKind === "nativeCdp" ? ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] : [],
    });
    automationSpace = browserEnabled
      ? (providerKind === "frame"
        ? new FrameSpace({ pageBridge, config: browserConfig, spaceId: "space:frame" })
        : new NativeCdpSpace({ profileDir: browserSession.profile, config: browserConfig })) : null;
    browserControl = automationSpace?.control || null;
    automationRouter = automationSpace ? new AutomationSpaceRouter(automationSpace) : null;
    const operationCatalog = controlOperationCatalog(tools);
    const operationHandlers = Object.fromEntries(operationCatalog.map(({ name, toolName }) => [name,
      async (input, { signal, requestId }) => {
        if (pythonToolNames.has(toolName)) {
          await pageBridge.waitForReady();
          return pageBridge.dispatch(name, input, { signal, requestId });
        }
        if (automationRouter) return automationRouter.invoke(name, input, { signal, requestId });
        const error = new Error(`control operation is unavailable: ${name}`);
        error.code = "CONTROL_OPERATION_UNAVAILABLE";
        error.outcome = "notSent";
        throw error;
      },
    ]));
    const host = new ControlHost({ handlers: operationHandlers, operations: operationCatalog });
    let closed = false;
    return Object.freeze({
      tools, operationCatalog, host, pageBridge, automationSpace, automationRouter,
      browserControl, browserSession, serverOrigin, pageUrl,
      async close() {
        if (closed) return;
        closed = true;
        host.close("control product is shutting down");
        try { await automationRouter?.close(); } catch (error) {}
        pageBridge.close();
        try { browserSession?.close(); } catch (error) {}
        await new Promise((resolveClose) => server.close(resolveClose));
      },
    });
  } catch (error) {
    pageBridge.close();
    try { await automationRouter?.close(); } catch (closeError) {}
    if (!automationRouter) try { await browserControl?.close(); } catch (closeError) {}
    try { browserSession?.close(); } catch (closeError) {}
    await new Promise((resolveClose) => server.close(resolveClose));
    throw error;
  }
}
