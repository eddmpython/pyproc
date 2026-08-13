// controlProduct.mjs - Python machine page와 automation provider를 한 ControlHost로 조립한다.
import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COI_HEADERS, createStaticServer, safeJoin, sendFile } from "../staticServer.mjs";
import { launchBrowser } from "../browserControl/browserLauncher.mjs";
import { createBrowserControlTools, parseBrowserControlConfig } from "../browserControl/index.js";
import { AutomationSpaceRouter } from "../automationSpace/automationSpace.js";
import { FrameSpace, assertFrameSpaceConfig } from "../automationSpace/frameSpace.js";
import { createFrameSpaceTools } from "../automationSpace/frameSpaceTools.js";
import { NativeCdpSpace } from "../automationSpace/nativeCdpSpace.js";
import {
  assertAutomationRecordingSelection,
  loadAutomationRecording,
} from "../automationSpace/automationRecording.js";
import { RecordingSpace } from "../automationSpace/recordingSpace.js";
import { ReplaySpace } from "../automationSpace/replaySpace.js";
import { ControlHost } from "./controlHost.js";
import { controlOperationCatalog } from "./controlOperations.js";
import { CONTROL_MAX_ATTACHMENT_BYTES } from "./controlProtocol.js";
import { PageCommandBridge } from "./pageCommandBridge.mjs";
import {
  createVerificationHandlers,
  VERIFICATION_OFFLINE_TOOLS,
  VERIFICATION_TOOLS,
} from "../verification/verificationTools.js";
import { createExecutionMemoryHandlers, EXECUTION_MEMORY_TOOLS } from "../executionMemory/executionMemoryTools.js";
import { createEffectTransactionHandlers, EFFECT_TRANSACTION_TOOLS }
  from "../effectTransaction/effectTransactionTools.js";
import { createAppSpaceHandlers, APP_SPACE_TOOLS } from "../appSpace/appSpaceTools.js";
import { createReplayGraphHandlers, REPLAY_GRAPH_TOOLS } from "../replayGraph/replayGraphTools.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 180000;
const POLL_HOLD_MS = 20000;
const CONTROL_RESULT_MAX_BYTES = Math.ceil(CONTROL_MAX_ATTACHMENT_BYTES * 4 / 3) + 1024 * 1024;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CONTROL_MACHINE_IMAGE_TOOLS = Object.freeze([
  Object.freeze({
    name: "machineImageExport",
    description: "Export the current portable Machine image as a verified binary attachment.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }),
]);

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

export async function createControlProduct({ env = process.env, browserLauncher = launchBrowser } = {}) {
  if (typeof browserLauncher !== "function") throw new TypeError("control product browserLauncher must be a function");
  const timeoutMs = Number(env.PYPROC_MCP_TIMEOUT || DEFAULT_COMMAND_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("PYPROC_MCP_TIMEOUT must be positive");
  const browserEnabled = env.PYPROC_BROWSER_CONTROL === "1";
  const providerKind = browserEnabled ? (env.PYPROC_AUTOMATION_PROVIDER || "nativeCdp") : null;
  if (browserEnabled && !["nativeCdp", "frame", "replay"].includes(providerKind)) {
    throw new TypeError(`unsupported automation provider: ${providerKind}`);
  }
  let recordingConfig = null;
  if (env.PYPROC_AUTOMATION_RECORDING) {
    try { recordingConfig = JSON.parse(env.PYPROC_AUTOMATION_RECORDING); }
    catch (error) { throw new TypeError("PYPROC_AUTOMATION_RECORDING must be JSON"); }
  }
  if (providerKind === "replay" && recordingConfig?.mode !== "replay") {
    throw new TypeError("ReplaySpace requires replay recording config");
  }
  const browserConfig = browserEnabled ? parseBrowserControlConfig(env, { timeoutMs }) : null;
  const replayRecording = providerKind === "replay" ? await loadAutomationRecording(recordingConfig.file) : null;
  if (replayRecording) assertAutomationRecordingSelection(replayRecording, recordingConfig, browserConfig);
  if (providerKind === "frame") assertFrameSpaceConfig(browserConfig);
  if (providerKind === "replay" && replayRecording.provider.providerKind === "frame") assertFrameSpaceConfig(browserConfig);
  const frameToolProvider = providerKind === "frame"
    || (providerKind === "replay" && replayRecording.provider.providerKind === "frame");
  const browserTools = browserConfig
    ? (frameToolProvider ? createFrameSpaceTools(browserConfig) : createBrowserControlTools(browserConfig)) : [];
  const verificationTools = browserEnabled ? VERIFICATION_TOOLS : VERIFICATION_OFFLINE_TOOLS;
  const executionMemoryEnabled = !!env.PYPROC_EXECUTION_MEMORY_ROOT;
  const memoryTools = executionMemoryEnabled ? EXECUTION_MEMORY_TOOLS : [];
  const effectTransactionsEnabled = env.PYPROC_EFFECT_TRANSACTIONS === "1";
  if (effectTransactionsEnabled && !executionMemoryEnabled) {
    throw new TypeError("effect transactions require Execution Memory");
  }
  const effectTools = effectTransactionsEnabled ? EFFECT_TRANSACTION_TOOLS : [];
  const appSpaceConfig = env.PYPROC_APP_SPACE ? JSON.parse(env.PYPROC_APP_SPACE) : null;
  const appSpaceEnabled = !!appSpaceConfig;
  if (appSpaceEnabled && (!executionMemoryEnabled || !effectTransactionsEnabled || providerKind !== "frame")) {
    throw new TypeError("AppSpace requires Execution Memory, Rehearse-Commit, and FrameSpace");
  }
  const appTools = appSpaceEnabled ? APP_SPACE_TOOLS : [];
  const replayGraphEnabled = env.PYPROC_REPLAY_GRAPH === "1";
  if (replayGraphEnabled && !executionMemoryEnabled) {
    throw new TypeError("ReplayGraph requires Execution Memory");
  }
  const replayGraphTools = replayGraphEnabled ? REPLAY_GRAPH_TOOLS : [];
  const machineImageTools = executionMemoryEnabled ? CONTROL_MACHINE_IMAGE_TOOLS : [];
  const pythonTools = [...CONTROL_PYTHON_TOOLS, ...machineImageTools];
  const tools = Object.freeze([...pythonTools, ...browserTools, ...verificationTools, ...memoryTools,
    ...effectTools, ...appTools, ...replayGraphTools]);
  const pythonToolNames = new Set(pythonTools.map((tool) => tool.name));
  const verificationToolNames = new Set(VERIFICATION_TOOLS.map((tool) => tool.name));
  const memoryToolNames = new Set(memoryTools.map((tool) => tool.name));
  const effectToolNames = new Set(effectTools.map((tool) => tool.name));
  const appToolNames = new Set(appTools.map((tool) => tool.name));
  const replayGraphToolNames = new Set(replayGraphTools.map((tool) => tool.name));
  const producerVersion = JSON.parse(await readFile(resolve(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const engineRoot = configuredEngineRoot(env.PYPROC_MCP_ENGINE_ROOT);
  const pageBridge = new PageCommandBridge({ timeoutMs });
  const controlToken = randomBytes(32).toString("base64url");
  const bootstrapNonce = randomBytes(32).toString("base64url");
  const expectedToken = Buffer.from(controlToken);
  const expectedBootstrap = Buffer.from(bootstrapNonce);
  const machinePagePath = resolve(PACKAGE_ROOT, "scripts", "browserControl", "mcpMachine.html");
  const machinePageTemplate = await readFile(machinePagePath, "utf8");
  const tokenMarker = '"__PYPROC_CONTROL_TOKEN__"';
  if (!machinePageTemplate.includes(tokenMarker)) throw new Error("control machine page token marker is missing");
  const machinePage = machinePageTemplate.replace(tokenMarker, JSON.stringify(controlToken));
  let bootstrapServed = false;
  const matchesSecret = (supplied, expected) => supplied.byteLength === expected.byteLength
    && timingSafeEqual(supplied, expected);
  const authorizedControlRequest = (req) => {
    const supplied = Buffer.from(String(req.headers["x-pyproc-control-token"] || ""));
    return matchesSecret(supplied, expectedToken);
  };

  const server = createStaticServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://control.local");
    if (req.method === "GET" && requestUrl.pathname === "/scripts/browserControl/mcpMachine.html"
      && requestUrl.searchParams.has("controlBootstrap")) {
      const supplied = Buffer.from(requestUrl.searchParams.get("controlBootstrap") || "");
      if (bootstrapServed || !matchesSecret(supplied, expectedBootstrap)) {
        res.writeHead(bootstrapServed ? 410 : 403, { "Cache-Control": "no-store", ...COI_HEADERS });
        res.end(bootstrapServed ? "control bootstrap already consumed" : "control bootstrap is invalid");
        return true;
      }
      bootstrapServed = true;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        ...COI_HEADERS });
      res.end(machinePage);
      return true;
    }
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
      try { sendJson(res, 200, pageBridge.result(await readJsonBody(req, CONTROL_RESULT_MAX_BYTES))); }
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
      appSpaceEnabled,
    })).toString("base64url"));
  }
  const pageUrl = `${serverOrigin}/scripts/browserControl/mcpMachine.html?${pageParams}`;
  const launchUrl = `${pageUrl}&controlBootstrap=${encodeURIComponent(bootstrapNonce)}`;
  let browserSession = null;
  let browserControl = null;
  let automationSpace = null;
  let automationRouter = null;
  try {
    browserSession = browserLauncher(launchUrl, {
      prefix: "pyprocControl-",
      extraArgs: providerKind === "nativeCdp" ? ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] : [],
    });
    automationSpace = browserEnabled
      ? (providerKind === "frame"
        ? new FrameSpace({ pageBridge, config: browserConfig, spaceId: "space:frame" })
        : providerKind === "replay"
          ? new ReplaySpace({ recording: replayRecording,
              cursor: recordingConfig.startCursor || 0,
              prefixSha256: recordingConfig.prefixSha256 || null })
          : new NativeCdpSpace({ profileDir: browserSession.profile, config: browserConfig })) : null;
    if (automationSpace && recordingConfig?.mode === "record") {
      automationSpace = await RecordingSpace.open({ provider: automationSpace, file: recordingConfig.file,
        overwrite: recordingConfig.overwrite });
    }
    browserControl = automationSpace?.control || null;
    automationRouter = automationSpace ? new AutomationSpaceRouter(automationSpace) : null;
    const verificationHandlers = createVerificationHandlers({ automation: automationRouter, producerVersion });
    const memoryProduct = executionMemoryEnabled ? await createExecutionMemoryHandlers({
      root: env.PYPROC_EXECUTION_MEMORY_ROOT,
      pageBridge,
      permissionManifest: Object.freeze({
        pythonNetwork: "denied",
        browser: browserConfig ? Object.freeze({ providerKind, targetOrigins: browserConfig.targetOrigins,
          actions: browserConfig.actions, maxRisk: browserConfig.maxRisk }) : null,
      }),
      recordingConfig,
      recordingProvider: (consumer) => typeof automationRouter?.provider?.snapshotRecording === "function"
        ? automationRouter.withRecordingSnapshot(consumer) : consumer(recordingConfig),
      importRoots: String(env.PYPROC_EXECUTION_MEMORY_IMPORT_ROOTS || "").split(delimiter).filter(Boolean),
      secretValues: env.PYPROC_EXECUTION_MEMORY_SECRET_VALUES
        ? JSON.parse(env.PYPROC_EXECUTION_MEMORY_SECRET_VALUES) : [],
    }) : null;
    const effectProduct = effectTransactionsEnabled ? await createEffectTransactionHandlers({
      root: env.PYPROC_EXECUTION_MEMORY_ROOT,
      approvalAuthorities: JSON.parse(env.PYPROC_EFFECT_APPROVAL_AUTHORITIES || "[]"),
      secretBindings: JSON.parse(env.PYPROC_EFFECT_SECRET_BINDINGS || "{}"),
      memoryProduct,
      automationRouter,
      pageBridge,
    }) : null;
    const appProduct = appSpaceEnabled ? await createAppSpaceHandlers({
      root: env.PYPROC_EXECUTION_MEMORY_ROOT,
      config: appSpaceConfig,
      memoryProduct,
      effectProduct,
      automationRouter,
      pageBridge,
      secretValues: env.PYPROC_EXECUTION_MEMORY_SECRET_VALUES
        ? JSON.parse(env.PYPROC_EXECUTION_MEMORY_SECRET_VALUES) : [],
    }) : null;
    const replayGraphProduct = replayGraphEnabled ? await createReplayGraphHandlers({
      root: env.PYPROC_EXECUTION_MEMORY_ROOT,
      importRoots: String(env.PYPROC_EXECUTION_MEMORY_IMPORT_ROOTS || "").split(delimiter).filter(Boolean),
      appProduct,
    }) : null;
    const operationCatalog = controlOperationCatalog(tools);
    const operationHandlers = Object.fromEntries(operationCatalog.map(({ name, toolName }) => [name,
      async (input, { signal, requestId, spaceId }) => {
        const expectedSpaceId = pythonToolNames.has(toolName) ? "machine:primary"
          : verificationToolNames.has(toolName) || memoryToolNames.has(toolName) || effectToolNames.has(toolName)
            || appToolNames.has(toolName) || replayGraphToolNames.has(toolName)
            ? undefined : automationRouter?.spaceId;
        if (spaceId && spaceId !== expectedSpaceId) {
          const error = new Error(`control request space does not match ${expectedSpaceId}`);
          error.code = "CONTROL_SPACE_MISMATCH";
          error.outcome = "notSent";
          error.retryable = false;
          throw error;
        }
        if (pythonToolNames.has(toolName)) {
          await pageBridge.waitForReady();
          return pageBridge.dispatch(name, input, { signal, requestId });
        }
        if (verificationToolNames.has(toolName)) {
          return verificationHandlers[name](input, { signal, requestId });
        }
        if (memoryToolNames.has(toolName)) {
          await pageBridge.waitForReady();
          return memoryProduct.handlers[name](input, { signal, requestId });
        }
        if (effectToolNames.has(toolName)) {
          await pageBridge.waitForReady();
          return effectProduct.handlers[name](input, { signal, requestId });
        }
        if (appToolNames.has(toolName)) {
          await pageBridge.waitForReady();
          return appProduct.handlers[name](input, { signal, requestId });
        }
        if (replayGraphToolNames.has(toolName)) {
          return replayGraphProduct.handlers[name](input, { signal, requestId });
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
      executionMemory: memoryProduct?.registry || null, effectTransactions: effectProduct?.registry || null,
      appSpace: appProduct?.registry || null,
      replayGraph: replayGraphProduct?.registry || null,
      browserControl, browserSession, serverOrigin, pageUrl,
      async close() {
        if (closed) return;
        closed = true;
        await host.close("control product is shutting down");
        try { await automationRouter?.close(); } catch (error) {}
        pageBridge.close();
        try { browserSession?.close(); } catch (error) {}
        await new Promise((resolveClose) => server.close(resolveClose));
      },
    });
  } catch (error) {
    pageBridge.close();
    try { await automationRouter?.close(); } catch (closeError) {}
    if (!automationRouter) try { await automationSpace?.close(); } catch (closeError) {}
    try { browserSession?.close(); } catch (closeError) {}
    await new Promise((resolveClose) => server.close(resolveClose));
    throw error;
  }
}
