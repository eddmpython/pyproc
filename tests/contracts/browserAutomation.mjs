import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrowserAutomation,
  BROWSER_AUTOMATION_ERROR_CODES,
} from "../../scripts/browserControl/browserAutomation.js";
import {
  BROWSER_AUTOMATION_ACTIONS,
  validateBrowserAutomationAction,
} from "../../scripts/browserControl/browserAutomationCatalog.js";
import {
  McpBrowserControl,
  createBrowserControlTools,
  parseBrowserControlConfig,
} from "../../scripts/browserControl/mcpBrowserControl.js";
import { BROWSER_CONTROL_COMMAND_RISKS } from "../../scripts/browserControl/browserControlPolicy.js";
import { NodeCdpTransport } from "../../scripts/browserControl/nodeCdpTransport.js";
import { redactBrowserUrl } from "../../scripts/browserControl/browserObservation.js";
import { BrowserArtifactStore } from "../../scripts/browserControl/browserArtifactStore.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function sessionRef(suffix = "a") {
  return Object.freeze({
    protocolVersion: "1",
    brokerId: "automation-broker",
    brokerEpoch: 1,
    sessionId: `session:${suffix}`,
    targetRef: `target:${suffix}`,
  });
}

class FakePort {
  constructor() {
    this.policy = { inspect: () => ({ methods: Object.keys(BROWSER_CONTROL_COMMAND_RISKS) }) };
    this.commands = [];
    this.contextEpoch = 3;
    this.failMethod = null;
    this.failExpression = null;
    this.queryAttached = true;
    this.listeners = new Set();
    this.dialogOnClick = false;
    this.url = "http://allowed.test/app";
    this.popupCapture = 0;
    this.axNodes = null;
  }

  subscribe(ref, listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(method, params) {
    for (const listener of this.listeners) listener({ method, params });
  }

  async beginPopupCapture() { this.popupCapture += 1; return `capture:${this.popupCapture}`; }
  async finishPopupCapture() {
    return Object.freeze({ targetRef: "target:popup", type: "page", url: "http://allowed.test/popup", title: "" });
  }
  cancelPopupCapture() {}

  async send(ref, command, { signal } = {}) {
    if (signal?.aborted) {
      const error = new Error("cancelled");
      error.code = "BROWSER_CONTROL_COMMAND_CANCELLED";
      error.outcome = "notSent";
      throw error;
    }
    this.commands.push({ ref, command });
    if (command.method === this.failMethod
      && (!this.failExpression || String(command.params?.expression || "").includes(this.failExpression))) {
      const error = new Error(`failed ${command.method}`);
      error.code = "BROWSER_CONTROL_COMMAND_REJECTED";
      error.outcome = "rejected";
      throw error;
    }
    let result = {};
    if (command.method === "Accessibility.getFullAXTree") {
      result = {
        nodes: [
          {
            nodeId: "1",
            backendDOMNodeId: 11,
            ignored: false,
            role: { type: "role", value: "button" },
            name: { type: "computedString", value: "Save" },
            description: { type: "computedString", value: "Save the current record" },
            properties: [
              { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
              { name: "disabled", value: { type: "boolean", value: false } },
            ],
            childIds: [],
            frameId: "frame-internal-value-that-compact-output-does-not-copy",
          },
          {
            nodeId: "2",
            backendDOMNodeId: 12,
            ignored: false,
            role: { type: "role", value: "textbox" },
            name: { type: "computedString", value: "Title" },
            value: { type: "string", value: "draft" },
            properties: [{ name: "focused", value: { type: "booleanOrUndefined", value: false } }],
            childIds: [],
          },
          { nodeId: "3", ignored: true, ignoredReasons: [{ name: "uninteresting", value: { value: true } }] },
        ],
      };
    }
    if (command.method === "Accessibility.getFullAXTree" && this.axNodes) result = { nodes: this.axNodes };
    if (command.method === "DOM.getDocument") result = { root: { nodeId: 1 } };
    if (command.method === "DOM.querySelector") result = { nodeId: this.queryAttached ? 9 : 0 };
    if (command.method === "DOM.resolveNode") result = { object: { objectId: "remote:11" } };
    if (command.method === "Runtime.evaluate") {
      result = command.params?.expression === "document.readyState"
        ? { result: { value: "complete" } }
        : command.params?.expression?.includes("#missing")
        ? { result: { type: "object", subtype: "error" }, exceptionDetails: { text: "__PYPROC_LOCATOR_COUNT__:0" } }
        : command.params?.expression?.includes(".duplicate")
          ? { result: { type: "object", subtype: "error" }, exceptionDetails: { text: "__PYPROC_LOCATOR_COUNT__:2" } }
          : { result: { type: "object", objectId: "remote:semantic" } };
    }
    if (command.method === "Runtime.callFunctionOn") {
      result = command.params?.functionDeclaration?.includes("const connected = this.isConnected")
        ? { result: { value: {
            tag: "button", connected: true, rect: { x: 10, y: 10, width: 100, height: 30 },
            point: { x: 60, y: 25 }, visible: true, enabled: true, editable: true,
            inViewport: true, receivesEvents: true, needsScroll: false, reasons: [],
          } } }
        : command.params?.functionDeclaration?.includes("selection.addRange")
          ? { result: { value: { tag: "div", contenteditable: true } } }
          : command.params?.functionDeclaration?.includes('inputMode: "trusted"')
            ? { result: { value: { tag: "div", value: "filled", inputMode: "trusted" } } }
        : { result: { value: { ok: true } } };
    }
    if (command.method === "Page.navigate") {
      this.url = command.params.url;
      result = { frameId: "frame", loaderId: "loader" };
    }
    if (command.method === "Page.getFrameTree") {
      result = { frameTree: { frame: { id: "frame", loaderId: "loader", url: this.url } } };
    }
    if (command.method === "Network.setCookie") result = { success: true };
    if (command.method === "Network.getCookies") result = { cookies: [{
      name: "session", value: "must-not-leak", domain: "allowed.test", path: "/", expires: -1,
      size: 24, httpOnly: true, secure: false, session: true, sameSite: "Lax", priority: "Medium",
    }] };
    if (command.method === "DOMStorage.getDOMStorageItems") result = { entries: [["mode", "ready"]] };
    if (command.method === "Page.getLayoutMetrics") {
      result = { cssVisualViewport: { clientWidth: 800, clientHeight: 600 }, contentSize: { width: 800, height: 1200 } };
    }
    if (command.method === "Page.captureScreenshot") {
      result = { data: Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("bounded png fixture"),
      ]).toString("base64") };
    }
    if (this.dialogOnClick && command.method === "Input.dispatchMouseEvent" && command.params?.type === "mouseReleased") {
      queueMicrotask(() => this.emit("Page.javascriptDialogOpening", { type: "confirm", hasBrowserHandler: false }));
    }
    return Object.freeze({
      requestId: `request:${this.commands.length}`,
      state: BROWSER_CONTROL_COMMAND_RISKS[command.method] === "read" ? "observed" : "applied",
      risk: BROWSER_CONTROL_COMMAND_RISKS[command.method],
      contextEpoch: this.contextEpoch,
      target: Object.freeze({ type: "page", url: this.url, title: "" }),
      result,
    });
  }
}

export async function assertBrowserAutomationContract() {
  const deniedExternal = await errorOf(async () => parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "http://allowed.test",
    PYPROC_BROWSER_MAX_RISK: "externalEffect",
    PYPROC_BROWSER_ACTIONS: "snapshot,click",
  }));
  assert(/requires PYPROC_BROWSER_EXTERNAL_EFFECTS/.test(deniedExternal?.message),
    "external effect가 운영자 이중 승인 없이 열렸다");

  const deniedPurpose = await errorOf(async () => parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "http://allowed.test",
    PYPROC_BROWSER_MAX_RISK: "externalEffect",
    PYPROC_BROWSER_ACTIONS: "snapshot,click",
    PYPROC_BROWSER_EXTERNAL_EFFECTS: "acknowledged",
  }));
  assert(/PYPROC_BROWSER_PURPOSE/.test(deniedPurpose?.message), "external effect가 목적 선언 없이 열렸다");

  const deniedScheme = await errorOf(async () => parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "file:///tmp",
  }));
  assert(/exact HTTP\(S\) origin/.test(deniedScheme?.message), "file origin이 browser permission으로 열렸다");

  const deniedUploadRoot = await errorOf(async () => parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "http://allowed.test",
    PYPROC_BROWSER_MAX_RISK: "externalEffect",
    PYPROC_BROWSER_ACTIONS: "upload",
    PYPROC_BROWSER_EXTERNAL_EFFECTS: "acknowledged",
    PYPROC_BROWSER_PURPOSE: "authorized upload regression test",
  }));
  assert(/PYPROC_BROWSER_FILE_ROOTS/.test(deniedUploadRoot?.message),
    "upload action이 filesystem root 선언 없이 열렸다");

  const unavailableUploadRoot = await errorOf(async () => parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "http://allowed.test",
    PYPROC_BROWSER_MAX_RISK: "externalEffect",
    PYPROC_BROWSER_ACTIONS: "upload",
    PYPROC_BROWSER_EXTERNAL_EFFECTS: "acknowledged",
    PYPROC_BROWSER_PURPOSE: "authorized upload regression test",
    PYPROC_BROWSER_FILE_ROOTS: join(process.cwd(), "missing-browser-upload-root"),
  }));
  assert(/file root is unavailable/.test(unavailableUploadRoot?.message),
    "존재하지 않는 upload root가 broker 시작 전 fail-closed가 아니다");

  const readWaitConfig = parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "http://allowed.test",
    PYPROC_BROWSER_MAX_RISK: "read",
    PYPROC_BROWSER_ACTIONS: "waitFor",
    PYPROC_BROWSER_METHODS: "",
  }, { timeoutMs: 1000 });
  assert(readWaitConfig.methods.length === 0 && readWaitConfig.rawMethods.length === 0
    && BROWSER_AUTOMATION_ACTIONS.waitFor.trustedReadMethods.includes("Runtime.evaluate"),
  "read-only semantic wait가 raw Runtime 권한이나 external-effect maxRisk를 요구한다");

  const config = parseBrowserControlConfig({
    PYPROC_BROWSER_ALLOWED_ORIGINS: "http://allowed.test",
    PYPROC_BROWSER_MAX_RISK: "externalEffect",
    PYPROC_BROWSER_ACTIONS: Object.keys(BROWSER_AUTOMATION_ACTIONS).join(","),
    PYPROC_BROWSER_METHODS: "DOM.getDocument",
    PYPROC_BROWSER_EXTERNAL_EFFECTS: "acknowledged",
    PYPROC_BROWSER_PURPOSE: "authorized product regression test",
    PYPROC_BROWSER_FILE_ROOTS: process.cwd(),
  }, { timeoutMs: 1000 });
  assert(config.actions.length === Object.keys(BROWSER_AUTOMATION_ACTIONS).length,
    "action catalog와 config action allowlist가 어긋났다");
  assert(config.methods.includes("Runtime.evaluate") && !config.rawMethods.includes("Runtime.evaluate"),
    "고수준 action required method가 raw command 권한으로 새었다");
  assert(config.events.includes("Runtime.consoleAPICalled") && config.events.includes("Network.responseReceived"),
    "observation event allowlist가 action catalog에서 파생되지 않았다");
  const tools = createBrowserControlTools(config);
  const browserAct = tools.find((tool) => tool.name === "browserAct");
  assert(browserAct.inputSchema.properties.actions.items.oneOf.length === config.actions.length,
    "MCP action schema가 action catalog에서 파생되지 않았다");
  const browserOpen = tools.find((tool) => tool.name === "browserOpen");
  assert(browserOpen.inputSchema.properties.waitUntil?.enum?.join(",") === "commit,domcontentloaded,load",
    "browserOpen이 명시적 readiness 경계를 제공하지 않는다");
  const semanticWait = validateBrowserAutomationAction({
    kind: "waitFor", locator: { by: "role", value: "button", name: "Save" }, state: "visible", expectedRisk: "read",
  });
  assert(semanticWait.state === "visible" && semanticWait.locator.by === "role",
    "semantic wait state와 locator validation이 한 계약을 쓰지 않는다");
  const interactiveSnapshot = validateBrowserAutomationAction({
    kind: "snapshot", mode: "interactive", maxNodes: 3, expectedRisk: "read",
  });
  assert(interactiveSnapshot.mode === "interactive", "interactive snapshot mode가 action 계약을 통과하지 못했다");
  const invalidWaitState = await errorOf(() => validateBrowserAutomationAction({
    kind: "waitFor", selector: "#save", state: "painted", expectedRisk: "read",
  }));
  assert(invalidWaitState?.code === BROWSER_AUTOMATION_ERROR_CODES.invalidAction,
    "알 수 없는 waitFor state가 fail-closed가 아니다");
  const invalidHydrationBound = await errorOf(() => validateBrowserAutomationAction({
    kind: "hydrateLazy", maxScrolls: 101, expectedRisk: "externalEffect",
  }));
  assert(invalidHydrationBound?.code === BROWSER_AUTOMATION_ERROR_CODES.invalidAction,
    "hydrateLazy scroll 상한이 fail-closed가 아니다");

  let id = 0;
  const port = new FakePort();
  const audit = [];
  const artifactStore = new BrowserArtifactStore({
    root: await mkdtemp(join(tmpdir(), "pyprocBrowserArtifactContract-")),
    idFactory: () => `artifact-${++id}`,
  });
  const snapshotOnly = new BrowserAutomation({
    port,
    actions: ["snapshot"],
    idFactory: () => String(++id),
    artifactStore,
  });
  const beforeVisualDenial = port.commands.length;
  const visualDenied = await errorOf(() => snapshotOnly.observe(sessionRef("snapshot-only"), {
    representation: "apx.graph", visual: { mode: "auto", maxCrops: 1 },
  }));
  assert(visualDenied?.code === "APX_VISUAL_PROVIDER_DENIED" && port.commands.length === beforeVisualDenial,
    "screenshot allowlist 없는 APX visual request가 명령 전에 거부되지 않았다");
  snapshotOnly.close();
  const automation = new BrowserAutomation({
    port,
    actions: config.actions,
    idFactory: () => String(++id),
    onAudit: (record) => audit.push(record),
    artifactStore,
  });
  const session = sessionRef();
  const observed = await automation.observe(session, { maxNodes: 10 });
  assert(observed.kind === "snapshot" && observed.requestCount === 1,
    "semantic snapshot이 관찰 command 한 번으로 끝나지 않았다");
  assert(observed.trace?.schemaVersion === "1" && observed.trace.steps.length === 1
    && observed.trace.steps[0].commands[0].method === "Accessibility.getFullAXTree",
  "bounded trace가 observation command와 action 위치를 보존하지 않았다");
  assert(observed.result.nodes.length === 2 && observed.result.nodes.every((node) => node.locatorRef),
    "compact accessibility snapshot 또는 opaque locator가 어긋났다");
  assert(observed.result.compactBytes < observed.result.rawBytes,
    `compact snapshot이 raw payload보다 작지 않다 (${observed.result.compactBytes}/${observed.result.rawBytes})`);

  port.axNodes = [
    ...Array.from({ length: 8 }, (_, index) => ({
      nodeId: `noise:${index}`,
      ignored: false,
      role: { type: "role", value: "StaticText" },
      name: { type: "computedString", value: `noise ${index}` },
      childIds: [],
    })),
    {
      nodeId: "late-editor", backendDOMNodeId: 91, ignored: false,
      role: { type: "role", value: "textbox" },
      name: { type: "computedString", value: "Late editor" },
      properties: [{ name: "focused", value: { type: "booleanOrUndefined", value: false } }],
      childIds: [],
    },
    {
      nodeId: "late-action", backendDOMNodeId: 92, ignored: false,
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Run late editor" },
      childIds: [],
    },
    {
      nodeId: "completion-status", backendDOMNodeId: 93, ignored: false,
      role: { type: "role", value: "status" },
      name: { type: "computedString", value: "" },
      childIds: ["completion-text"],
    },
    {
      nodeId: "completion-text", parentId: "completion-status", backendDOMNodeId: 94, ignored: false,
      role: { type: "role", value: "StaticText" },
      name: { type: "computedString", value: "Completion saved" },
      childIds: [],
    },
  ];
  const focused = await automation.observe(session, { mode: "interactive", maxNodes: 4 });
  assert(focused.result.mode === "interactive"
    && focused.result.eligibleNodes === 12 && focused.result.candidateNodes === 4
    && focused.result.nodes.length === 4
    && focused.result.nodes.every((node) => node.locatorRef)
    && focused.result.nodes.some((node) => node.name === "Late editor")
    && focused.result.nodes.some((node) => node.name === "Completion saved"),
  "interactive snapshot이 전체 AX tree에서 control과 live status text를 먼저 고르지 않았다");
  port.axNodes = null;

  const artifactReady = await automation.observe(session, {
    maxNodes: 10, includeScreenshot: true, includeConsole: true, includeNetwork: true, maxEvents: 5,
  });
  assert(artifactReady.result.screenshot?.mimeType === "image/png" && artifactReady.result.screenshot?.dataBase64
    && artifactReady.result.screenshot?.artifactRef?.startsWith("artifact:")
    && artifactReady.requestCount === 5,
  "screenshot와 event domain 준비가 bounded observation으로 합쳐지지 않았다");
  port.emit("Runtime.consoleAPICalled", {
    type: "info", timestamp: 1, args: [{ value: "token=must-not-leak" }, { value: 42 }],
  });
  port.emit("Network.requestWillBeSent", {
    timestamp: 2, type: "Fetch", request: { method: "GET", url: "http://allowed.test/data?token=must-not-leak" },
  });
  port.emit("Network.responseReceived", {
    timestamp: 3, type: "Fetch", response: { status: 200, mimeType: "application/json", url: "http://allowed.test/data?token=must-not-leak" },
  });
  const artifacts = await automation.observe(session, {
    maxNodes: 10, includeConsole: true, includeNetwork: true, maxEvents: 5,
  });
  assert(artifacts.result.console?.[0]?.args[0] === "token=[redacted]"
    && artifacts.result.network?.length === 2
    && artifacts.result.network.every((event) => event.url === "http://allowed.test/data")
    && !JSON.stringify(artifacts).includes("must-not-leak"),
  "console 또는 network artifact가 secret과 query를 redaction하지 않았다");
  assert(redactBrowserUrl("data:text/plain,secret") === "[redacted-url]",
    "non-HTTP observation URL이 노출됐다");

  const locatorRef = artifacts.result.nodes[0].locatorRef;
  const locatorClick = await automation.run(session, [{ kind: "click", locatorRef, expectedRisk: "externalEffect" }]);
  assert(locatorClick.actions[0].result.trusted === true
    && port.commands.some((entry) => entry.command.method === "DOM.resolveNode")
    && port.commands.some((entry) => entry.command.method === "Input.dispatchMouseEvent"),
  "opaque locator action이 strict actionability와 trusted input을 거치지 않았다");

  const highLevel = await automation.run(session, [
    { kind: "waitFor", selector: "#ready", expectedRisk: "read" },
    { kind: "click", selector: "#save", expectedRisk: "externalEffect" },
    { kind: "fill", selector: "#title", value: "hello", expectedRisk: "externalEffect" },
    { kind: "press", selector: "#title", key: "Enter", expectedRisk: "externalEffect" },
    { kind: "select", selector: "#lane", values: ["fast"], expectedRisk: "externalEffect" },
    { kind: "scroll", selector: "#save", block: "center", expectedRisk: "externalEffect" },
    { kind: "navigate", url: "http://allowed.test/next", expectedRisk: "externalEffect" },
  ]);
  assert(highLevel.state === "completed" && highLevel.actions.length === 7,
    "고수준 action pipeline이 한 run에서 순서를 보존하지 않았다");
  assert(port.commands.some((entry) => entry.command.method === "Input.insertText"),
    "fill이 contenteditable 호환 trusted text 입력 경로를 사용하지 않았다");
  assert(new Set(highLevel.actions.map((action) => action.actionId)).size === 7,
    "action ID가 pipeline 안에서 고유하지 않다");
  assert(audit.some((record) => record.kind === "click" && record.state === "applied"),
    "external action 감사 이벤트가 없다");

  const missingTarget = await errorOf(() => automation.run(session, [
    { kind: "click", selector: "#missing", timeoutMs: 1, expectedRisk: "externalEffect" },
  ]));
  assert(missingTarget?.code === "BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT"
    && missingTarget.outcome === "notSent" && missingTarget.failedAction?.requestCount >= 1,
  "없는 target을 effect 전 actionability 실패로 분리하지 않았다");

  const duplicateTarget = await errorOf(() => automation.run(session, [
    { kind: "click", locator: { by: "css", value: ".duplicate" }, expectedRisk: "externalEffect" },
  ]));
  assert(duplicateTarget?.code === "BROWSER_AUTOMATION_STRICT_LOCATOR" && duplicateTarget.outcome === "notSent",
    "여러 target을 고른 semantic locator가 effect 전에 거부되지 않았다");

  const closedShadow = await errorOf(() => automation.run(session, [{
    kind: "click", locator: { by: "testId", value: "inside", shadow: "closed" }, expectedRisk: "externalEffect",
  }]));
  assert(closedShadow?.code === BROWSER_AUTOMATION_ERROR_CODES.invalidAction
    && /only open shadow roots/.test(closedShadow.message),
  "closed shadow root 경계가 명시적 unsupported 오류가 아니다");

  const semanticTarget = await automation.run(session, [
    { kind: "fill", locator: { by: "label", value: "Title" }, value: "semantic", expectedRisk: "externalEffect" },
  ]);
  assert(semanticTarget.actions[0].result.actionability?.polls >= 3
    && port.commands.some((entry) => entry.command.params?.expression?.includes('"by":"label"')),
  "semantic locator가 strict resolver와 actionability를 거치지 않았다");

  port.dialogOnClick = true;
  const dialogClick = await automation.run(session, [{
    kind: "click", selector: "#confirm", dialog: { decision: "dismiss" }, expectedRisk: "externalEffect",
  }]);
  port.dialogOnClick = false;
  assert(dialogClick.actions[0].result.dialog?.type === "confirm"
    && dialogClick.actions[0].result.dialog?.decision === "dismiss"
    && port.commands.some((entry) => entry.command.method === "Page.handleJavaScriptDialog"),
  "dialog 선언 click이 event와 command deadlock을 풀지 못했다");

  const popupClick = await automation.run(session, [{
    kind: "click", selector: "#popup", popup: true, expectedRisk: "externalEffect",
  }]);
  assert(popupClick.actions[0].result.popup?.targetRef === "target:popup"
    && !JSON.stringify(popupClick).includes("raw-target"),
  "popup 선언 click이 opaque target을 반환하지 않았다");

  const stateActions = await automation.run(session, [
    { kind: "cookieSet", name: "session", value: "secret", expectedRisk: "externalEffect" },
    { kind: "cookiesGet", expectedRisk: "read" },
    { kind: "cookieDelete", name: "session", expectedRisk: "externalEffect" },
    { kind: "storageSet", area: "local", key: "mode", value: "ready", expectedRisk: "externalEffect" },
    { kind: "storageGet", area: "local", expectedRisk: "read" },
    { kind: "storageRemove", area: "local", key: "mode", expectedRisk: "externalEffect" },
    { kind: "storageClear", area: "session", expectedRisk: "externalEffect" },
  ]);
  const cookieRead = stateActions.actions.find((entry) => entry.kind === "cookiesGet").result;
  const storageRead = stateActions.actions.find((entry) => entry.kind === "storageGet").result;
  assert(stateActions.actions.length === 7 && cookieRead.cookies[0].name === "session"
    && !JSON.stringify(cookieRead).includes("must-not-leak")
    && storageRead.entries[0].value === "ready",
  "cookie metadata 또는 bounded storage action 계약이 어긋났다");

  const widenedCookie = await errorOf(() => automation.run(session, [{
    kind: "cookieSet", name: "session", value: "secret", domain: "allowed.test", expectedRisk: "externalEffect",
  }]));
  assert(widenedCookie?.code === BROWSER_AUTOMATION_ERROR_CODES.invalidAction,
    "cookie domain scope 확장이 schema를 통과했다");

  port.failMethod = "Runtime.evaluate";
  port.failExpression = '"value":"#save"';
  const partial = await errorOf(() => automation.run(session, [
    { kind: "waitFor", selector: "#ready", expectedRisk: "read" },
    { kind: "click", selector: "#save", expectedRisk: "externalEffect" },
  ]));
  assert(partial?.failedActionIndex === 1 && partial.completed?.length === 1
    && partial.failedAction?.requestCount === 0 && partial.trace?.state === "failed"
    && partial.trace.steps.at(-1)?.commands.at(-1)?.method === "Runtime.evaluate",
  "pipeline 실패가 완료 prefix와 실패 index를 보존하지 않았다");
  port.failMethod = null;
  port.failExpression = null;

  const wrongRisk = await errorOf(() => automation.run(session, [
    { kind: "click", selector: "#save", expectedRisk: "read" },
  ]));
  assert(wrongRisk?.code === BROWSER_AUTOMATION_ERROR_CODES.invalidAction,
    "호출자가 고수준 action 위험도를 낮췄다");

  const otherSession = await errorOf(() => automation.run(sessionRef("b"), [
    { kind: "click", locatorRef, expectedRisk: "externalEffect" },
  ]));
  assert(otherSession?.code === "BROWSER_AUTOMATION_STALE_LOCATOR",
    "opaque locator가 session 경계를 넘어갔다");

  const refreshed = await automation.observe(session, { maxNodes: 10 });
  const staleLocator = refreshed.result.nodes[0].locatorRef;
  port.contextEpoch += 1;
  const replacedDocument = await errorOf(() => automation.run(session, [
    { kind: "click", locatorRef: staleLocator, expectedRisk: "externalEffect" },
  ]));
  assert(replacedDocument?.code === "BROWSER_AUTOMATION_STALE_LOCATOR"
    && port.commands.at(-1)?.command.method === "Page.getFrameTree",
  "document 교체 locator가 external command 전에 거부되지 않았다");

  const connectionCalls = [];
  const transport = new NodeCdpTransport({
    async send(method, params, rawSessionId) {
      connectionCalls.push({ method, params, rawSessionId });
      if (method === "Target.attachToTarget") return { sessionId: "raw-session" };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { url: "http://allowed.test/app" } } };
      return {};
    },
    subscribe() { return () => {}; },
    close() {},
  });
  const transportSession = await transport.attach("raw-target");
  assert(connectionCalls.map((entry) => entry.method).join(",") === "Target.attachToTarget,Page.enable",
    "transport attach가 locator epoch용 Page event를 활성화하지 않았다");
  connectionCalls.length = 0;
  await transport.describe(transportSession);
  assert(connectionCalls.map((entry) => entry.method).join(",") === "Page.getFrameTree",
    "target 권한 재검사가 title Runtime.evaluate 왕복을 남겼다");

  const mcpPort = new FakePort();
  let openedWith = null;
  const fakeBroker = {
    port: mcpPort,
    inspect: () => ({ transport: "fake", listener: null }),
    listTargets: async () => [],
    openTarget: async (...args) => { openedWith = args; return { targetRef: "target:opened" }; },
    closeTarget: async (targetRef) => ({ closed: true, targetRef }),
    attach: async () => session,
    command: (ref, command, options) => mcpPort.send(ref, command, options),
    detach: async () => {},
    close: async () => {},
  };
  let brokerStarts = 0;
  const mcp = new McpBrowserControl({
    profileDir: join(tmpdir(), "fake-profile"),
    config,
    brokerFactory: async () => { brokerStarts += 1; return fakeBroker; },
    auditWriter: () => {},
  });
  const rawDenied = await errorOf(() => mcp.invoke("browserCommand", {
    sessionRef: session,
    method: "Runtime.evaluate",
    params: { expression: "1" },
    expectedRisk: "externalEffect",
  }));
  assert(rawDenied?.code === "BROWSER_CONTROL_PERMISSION_DENIED" && mcpPort.commands.length === 0,
    "고수준 Runtime method가 raw browserCommand로 전송됐다");
  const openDenied = await errorOf(() => mcp.invoke("browserOpen", { url: "http://allowed.test/app" }));
  assert(openDenied?.code === "BROWSER_CONTROL_PERMISSION_DENIED",
    "browserOpen 호출별 external risk 확인이 없다");
  assert(brokerStarts === 0, "전송 전 permission 거부가 CDP broker를 불필요하게 시작했다");
  const closeDenied = await errorOf(() => mcp.invoke("browserClose", { targetRef: "target:opened" }));
  assert(closeDenied?.code === "BROWSER_CONTROL_PERMISSION_DENIED" && brokerStarts === 0,
    "browserClose 호출별 external risk 확인이 없다");
  await mcp.invoke("browserOpen", { url: "http://allowed.test/app", expectedRisk: "externalEffect" });
  assert(openedWith?.[1]?.waitUntil === "commit", "browserOpen 기본 완료 경계가 navigation commit이 아니다");
  await mcp.invoke("browserOpen", {
    url: "http://allowed.test/app", expectedRisk: "externalEffect", waitUntil: "load",
  });
  assert(openedWith?.[1]?.waitUntil === "load", "browserOpen의 명시적 load 경계가 broker로 전달되지 않았다");
  await mcp.close();

  const serverSource = await readFile(new URL("../../scripts/mcpSandboxServer.mjs", import.meta.url), "utf8");
  const productSource = await readFile(new URL("../../scripts/controlProtocol/controlProduct.mjs", import.meta.url), "utf8");
  for (const duplicate of ["BROWSER_SESSION_SCHEMA", "function browserControlConfig", "const BROWSER_TOOLS = ["]) {
    assert(!serverSource.includes(duplicate) && !productSource.includes(duplicate),
      `Control composition root에 browser SSOT 중복이 남았다: ${duplicate}`);
  }
  assert(serverSource.includes('from "./controlProtocol/controlProduct.mjs"')
    && productSource.includes('from "../browserControl/index.js"')
    && !productSource.includes('from "../browserControl/mcpBrowserControl.js"'),
  "Control composition root가 repository browser-control surface를 우회했다");
  automation.close();
  await artifactStore.close();
  return true;
}
