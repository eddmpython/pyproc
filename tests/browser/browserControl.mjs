// browserControl.mjs - opt-in MCP browser broker의 hermetic end-to-end gate.
// Python restore와 외부 Chromium effect를 한 흐름에서 대조하고, 둘을 같은 rollback으로 위장하지 않는다.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { connectNodeBrowserControl } from "../../scripts/browserControl/browserControlBroker.mjs";
import { BrowserAutomation } from "../../scripts/browserControl/browserAutomation.js";
import { BROWSER_AUTOMATION_ACTIONS } from "../../scripts/browserControl/browserAutomationCatalog.js";
import { launchBrowser } from "./harness.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let receiverRequests = 0;
let receiverBody = null;
let deniedOrigin = "";
const receiverHandler = async (req, res) => {
  const url = new URL(req.url, "http://fixture.invalid");
  if (url.pathname === "/browserControlRedirect") {
    res.writeHead(302, { Location: `${deniedOrigin}/tests/browser/browserControlFrameTarget.html?redirected=1` });
    res.end();
    return true;
  }
  if (url.pathname !== "/browserControlReceiver") return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  receiverRequests += 1;
  receiverBody = { marker: url.searchParams.get("marker"), payload: JSON.parse(body || "null") };
  res.writeHead(204, { "Access-Control-Allow-Origin": "*" }); res.end();
  return true;
};
const targetServer = createStaticServer(receiverHandler);
const crossServer = createStaticServer(receiverHandler, {
  headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
});
const deniedServer = createStaticServer();
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => crossServer.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => deniedServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;
const crossOrigin = `http://127.0.0.1:${crossServer.address().port}`;
deniedOrigin = `http://127.0.0.1:${deniedServer.address().port}`;
const targetUrl = `${targetOrigin}/tests/browser/browserControlTarget.html`;
const crossFrameUrl = `${crossOrigin}/tests/browser/browserControlFrameTarget.html`;
const deniedUrl = `${deniedOrigin}/tests/browser/browserControlFrameTarget.html`;

const child = spawn(process.execPath, [join(ROOT, "scripts", "mcpSandboxServer.mjs")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PYPROC_BROWSER_CONTROL: "1",
    PYPROC_BROWSER_ALLOWED_ORIGINS: `${targetOrigin},${crossOrigin}`,
    PYPROC_BROWSER_MAX_RISK: "externalEffect",
    PYPROC_BROWSER_ACTIONS: Object.keys(BROWSER_AUTOMATION_ACTIONS).join(","),
    PYPROC_BROWSER_EXTERNAL_EFFECTS: "acknowledged",
    PYPROC_BROWSER_PURPOSE: "authorized pyproc browser-control regression test",
    PYPROC_BROWSER_FILE_ROOTS: ROOT,
    PYPROC_BROWSER_METHODS: [
      "DOM.getDocument", "DOM.getOuterHTML", "DOM.querySelector", "Network.enable",
      "Page.navigate", "Runtime.enable", "Runtime.evaluate",
    ].join(","),
  },
});
child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));

const waiters = new Map();
let requestSeq = 0;
const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch (error) { return; }
  const waiter = waiters.get(message.id);
  if (waiter) { waiters.delete(message.id); waiter(message); }
});

function beginRequest(method, params) {
  const id = ++requestSeq;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`${method} timeout`)); }, TIMEOUT_MS);
    waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return { id, response };
}

function request(method, params) {
  return beginRequest(method, params).response;
}

function toolText(message) {
  return JSON.parse(message.result.content[0].text);
}

function callTool(name, args = {}) {
  return request("tools/call", { name, arguments: args });
}

function browserCommand(sessionRef, method, params, expectedRisk) {
  return callTool("browserCommand", { sessionRef, method, params: params || {}, expectedRisk });
}

async function errorOf(operation) {
  try { await operation; return null; }
  catch (error) { return error; }
}

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

console.log("pyproc MCP browser-control gate");
let directBrowser = null;
let directBroker = null;
try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "browser-control-gate", version: "1" },
  });
  check("initialize가 browser effect 비복원 경계를 말함", initialized.result.instructions.includes("never rolls back browser actions"));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const listedTools = await request("tools/list", {});
  const names = listedTools.result.tools.map((tool) => tool.name).sort();
  check("opt-in에서 Python 4종과 browser 8종", names.length === 12 && names.includes("pythonRun")
    && names.includes("browserCommand") && names.includes("browserObserve") && names.includes("browserAct"), names.join(","));

  // 엔진 부팅과 CDP target 생성이 CPU를 놓고 경쟁하면 공유 CI에서 준비 시간이 크게 흔들린다.
  // Python Machine을 먼저 준비한 뒤 외부 browser target을 여는 것이 실제 agent 소비 순서이기도 하다.
  const booted = toolText(await callTool("pythonRun", { code: "40 + 2" }));
  check("browser broker 사용 전 Python Machine 준비", booted.value === "42", booted.value);

  const initialTargets = toolText(await callTool("browserListTargets"));
  check("operator allowlist 밖 MCP 머신 페이지는 target 목록에서 숨김",
    Array.isArray(initialTargets) && initialTargets.length === 0, JSON.stringify(initialTargets));

  const inspected = toolText(await callTool("browserInspect"));
  check("browserInspect가 action과 이중 승인 상태를 보고", inspected.automation?.actions?.length === Object.keys(BROWSER_AUTOMATION_ACTIONS).length
    && inspected.externalEffectsAcknowledged === true && inspected.listener === null
    && inspected.compatibility?.supported === true && inspected.compatibility?.browserMajor >= 137,
  `${inspected.automation?.actions?.length} actions`);

  const openWithoutRisk = await callTool("browserOpen", { url: targetUrl });
  check("browserOpen expectedRisk 생략은 target 생성 전 거부", openWithoutRisk.result.isError === true
    && toolText(openWithoutRisk).code === "BROWSER_CONTROL_PERMISSION_DENIED");
  const opened = toolText(await callTool("browserOpen", { url: targetUrl, expectedRisk: "externalEffect" }));
  check("browserOpen이 opaque targetRef 반환", opened.targetRef?.startsWith("target:") && opened.url === targetUrl, opened.targetRef);

  const sessionRef = toolText(await callTool("browserAttach", { targetRef: opened.targetRef }));
  check("browserAttach가 versioned broker-scoped sessionRef 반환",
    sessionRef.protocolVersion === "1" && sessionRef.sessionId?.startsWith("session:") && Number.isInteger(sessionRef.brokerEpoch));
  await browserCommand(sessionRef, "Runtime.enable", {}, "read");
  await browserCommand(sessionRef, "Network.enable", {}, "read");

  let ready = null;
  const readyDeadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < readyDeadline) {
    ready = toolText(await browserCommand(sessionRef, "Runtime.evaluate",
      { expression: "window.browserControlFixture ? window.browserControlFixture.read() : null", returnByValue: true },
      "externalEffect"));
    if (ready.result?.result?.value?.text === "ready:0") break;
    await delay(50);
  }
  check("browserCommand가 controlled target을 관찰", ready?.result?.result?.value?.text === "ready:0", JSON.stringify(ready?.result?.result?.value));

  const observed = toolText(await callTool("browserObserve", {
    sessionRef,
    expectedRisk: "read",
    maxNodes: 100,
  }));
  const titleLocator = observed.result?.nodes?.find((node) => node.role === "textbox")?.locatorRef;
  check("browserObserve가 한 command compact snapshot과 opaque locator를 반환", observed.requestCount === 1
    && observed.result?.compactBytes * 2 <= observed.result?.rawBytes && !!titleLocator,
  `${observed.result?.compactBytes}/${observed.result?.rawBytes}`);

  const highLevel = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [
      { kind: "fill", locatorRef: titleLocator, value: "hello", expectedRisk: "externalEffect" },
      { kind: "select", selector: "#lane", values: ["fast"], expectedRisk: "externalEffect" },
      { kind: "press", locatorRef: titleLocator, key: "Enter", expectedRisk: "externalEffect" },
      { kind: "scroll", selector: "#apply", block: "center", expectedRisk: "externalEffect" },
      { kind: "click", selector: "#apply", expectedRisk: "externalEffect" },
      { kind: "waitFor", selector: "#applied", state: "attached", expectedRisk: "read" },
    ],
  }));
  check("browserAct가 고수준 작업 여섯 개를 MCP 한 호출에서 순서 실행", highLevel.state === "completed"
    && highLevel.actions?.length === 6 && highLevel.actions[5]?.result?.state === "attached",
  `${highLevel.actions?.length} actions`);
  const highLevelState = toolText(await browserCommand(sessionRef, "Runtime.evaluate",
    { expression: "window.browserControlFixture.form()", returnByValue: true }, "externalEffect"));
  check("fill, select, press, scroll, click 결과가 실제 DOM에 반영", highLevelState.result?.result?.value?.applied === "hello:fast:Enter",
    JSON.stringify(highLevelState.result?.result?.value));

  const resetActionability = async (kind) => browserCommand(sessionRef, "Runtime.evaluate", {
    expression: `window.browserControlFixture.resetActionability(${JSON.stringify(kind)})`,
    returnByValue: true,
  }, "externalEffect");
  await resetActionability("moving");
  const movingAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click", locator: { by: "role", value: "button", name: "Moving action" }, timeoutMs: 3000,
      expectedRisk: "externalEffect",
    }],
  }));
  check("role locator가 움직임 종료와 연속 stable poll 뒤 trusted click",
    movingAction.actions?.[0]?.result?.actionability?.polls >= 3 && movingAction.actions[0].result.trusted === true,
  `${movingAction.actions?.[0]?.result?.actionability?.polls} polls`);

  await resetActionability("covered");
  const coveredAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click", locator: { by: "text", value: "Covered action" }, timeoutMs: 3000,
      expectedRisk: "externalEffect",
    }],
  }));
  check("text locator가 overlay 제거 전까지 hit-target을 기다림",
    coveredAction.actions?.[0]?.result?.actionability?.polls >= 3,
  `${coveredAction.actions?.[0]?.result?.actionability?.polls} polls`);

  await resetActionability("enabled");
  const enabledAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click", locator: { by: "role", value: "button", name: "Enable later" }, timeoutMs: 3000,
      expectedRisk: "externalEffect",
    }],
  }));
  check("role locator가 disabled 해제 전까지 effect를 보내지 않음",
    enabledAction.actions?.[0]?.result?.actionability?.polls >= 3,
  `${enabledAction.actions?.[0]?.result?.actionability?.polls} polls`);

  const semanticActions = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [
      { kind: "fill", locator: { by: "label", value: "Work email" }, value: "agent@example.test", expectedRisk: "externalEffect" },
      { kind: "click", locator: { by: "testId", value: "shadow-action" }, expectedRisk: "externalEffect" },
      { kind: "click", locator: { by: "role", value: "button", name: "Frame action" }, expectedRisk: "externalEffect" },
      { kind: "click", locator: {
        by: "role", value: "button", name: "Frame action", frame: [{ by: "name", value: "semantic-frame" }],
      }, expectedRisk: "externalEffect" },
    ],
  }));
  const semanticState = toolText(await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: "window.browserControlFixture.actionability()", returnByValue: true,
  }, "externalEffect"));
  check("label, testId, open Shadow DOM, same-origin frame locator가 실제 target에 적용",
    semanticActions.actions?.length === 4 && semanticState.result?.result?.value?.email === "agent@example.test"
      && semanticState.result.result.value.counts.shadow === 1 && semanticState.result.result.value.counts.frame === 2
      && semanticState.result.result.value.trusted.shadow === true && semanticState.result.result.value.trusted.frame === true,
  JSON.stringify(semanticState.result?.result?.value));

  receiverRequests = 0;
  receiverBody = null;
  await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: `document.getElementById('cross-origin-frame').src = ${JSON.stringify(crossFrameUrl)}`,
    returnByValue: true,
  }, "externalEffect");
  const crossFrameAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click",
      locator: {
        by: "role",
        value: "button",
        name: "Cross frame action",
        frame: [{ by: "url", value: crossFrameUrl }],
      },
      timeoutMs: 5000,
      expectedRisk: "externalEffect",
    }],
  }));
  const crossFrameDeadline = Date.now() + 5000;
  while (Date.now() < crossFrameDeadline && receiverBody?.marker !== "cross-frame") await delay(25);
  check("허용된 cross-origin frame을 isolated world에서 찾고 trusted click",
    crossFrameAction.actions?.[0]?.result?.trusted === true
      && receiverRequests === 1 && receiverBody?.marker === "cross-frame" && receiverBody?.payload?.trusted === true,
  `${receiverRequests} request, ${JSON.stringify({
    actionability: crossFrameAction.actionability || null,
    commands: crossFrameAction.trace?.steps?.[0]?.commands?.map((command) => command.method) || [],
  })}`);

  const controlActions = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [
      { kind: "hover", locator: { by: "testId", value: "hover-action" }, expectedRisk: "externalEffect" },
      { kind: "focus", locator: { by: "label", value: "Work email" }, expectedRisk: "externalEffect" },
      { kind: "check", locator: { by: "role", value: "checkbox", name: "Receive updates" }, expectedRisk: "externalEffect" },
      { kind: "uncheck", locator: { by: "role", value: "checkbox", name: "Receive updates" }, expectedRisk: "externalEffect" },
      { kind: "upload", locator: { by: "testId", value: "upload-field" }, files: [join(ROOT, "LICENSE")], expectedRisk: "externalEffect" },
    ],
  }));
  const controlState = toolText(await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: "window.browserControlFixture.actionability()", returnByValue: true,
  }, "externalEffect"));
  check("hover, focus, check, uncheck, upload가 trusted input과 filesystem guard 아래 동작",
    controlActions.actions?.length === 5 && controlState.result?.result?.value?.counts.hover === 1
      && controlState.result.result.value.trusted.hover === true
      && controlActions.actions[1]?.result?.focused === true
      && controlState.result.result.value.counts.check === 2
      && controlState.result.result.value.trusted.check === true
      && controlState.result.result.value.checked === false
      && controlState.result.result.value.files?.[0] === "LICENSE",
  JSON.stringify(controlState.result?.result?.value));

  const dialogAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click",
      locator: { by: "role", value: "button", name: "Confirm action" },
      dialog: { decision: "dismiss" },
      timeoutMs: 3000,
      expectedRisk: "externalEffect",
    }],
  }));
  const dialogState = toolText(await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: "window.browserControlFixture.actionability()", returnByValue: true,
  }, "externalEffect"));
  check("명시적 dialog decision이 click command deadlock 없이 적용",
    dialogAction.actions?.[0]?.result?.dialog?.type === "confirm"
      && dialogAction.actions[0].result.dialog.decision === "dismiss"
      && dialogState.result?.result?.value?.dialogDecision === "dismissed",
  JSON.stringify(dialogAction.actions?.[0]?.result?.dialog));

  const downloadAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click",
      locator: { by: "role", value: "button", name: "Download action" },
      download: true,
      timeoutMs: 5000,
      expectedRisk: "externalEffect",
    }],
  }));
  const downloadArtifact = downloadAction.actions?.[0]?.result?.download;
  check("선언된 download가 controlled profile에서 bounded artifact로 회수",
    downloadArtifact?.suggestedFilename === "browser-control.txt"
      && downloadArtifact?.sourceUrl === "[redacted-url]"
      && Buffer.from(downloadArtifact?.dataBase64 || "", "base64").toString("utf8") === "bounded browser download"
      && /^[a-f0-9]{64}$/.test(downloadArtifact?.sha256 || ""),
  `${downloadArtifact?.byteLength || 0} bytes`);

  const dragAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "drag",
      locator: { by: "testId", value: "drag-source" },
      to: { by: "testId", value: "drop-target" },
      timeoutMs: 3000,
      expectedRisk: "externalEffect",
    }],
  }));
  const dragState = toolText(await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: "window.browserControlFixture.actionability()", returnByValue: true,
  }, "externalEffect"));
  check("drag가 source와 destination actionability 뒤 trusted pointer sequence로 적용",
    dragAction.actions?.[0]?.result?.trusted === true
      && dragAction.actions[0].result.destinationActionability?.polls >= 3
      && dragState.result?.result?.value?.counts.drag === 1
      && dragState.result.result.value.trusted.drag === true,
  JSON.stringify(dragState.result?.result?.value));

  await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: `document.getElementById('popup-action').dataset.url = ${JSON.stringify(`${crossFrameUrl}?popup=1`)};
      document.getElementById('denied-popup-action').dataset.url = ${JSON.stringify(`${deniedUrl}?popup=denied`)}`,
    returnByValue: true,
  }, "externalEffect");
  const popupAction = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click", locator: { by: "role", value: "button", name: "Open allowed popup" },
      popup: true, timeoutMs: 5000, expectedRisk: "externalEffect",
    }],
  }));
  const popupRef = popupAction.actions?.[0]?.result?.popup;
  const popupSession = popupRef?.targetRef
    ? toolText(await callTool("browserAttach", { targetRef: popupRef.targetRef }))
    : null;
  const popupObserved = popupSession
    ? toolText(await callTool("browserObserve", { sessionRef: popupSession, expectedRisk: "read", maxNodes: 20 }))
    : null;
  if (popupSession) await callTool("browserDetach", { sessionRef: popupSession });
  check("허용 popup이 opaque target으로 승격되고 attach 뒤 origin을 재검사",
    popupRef?.targetRef?.startsWith("target:") && popupRef.url === `${crossFrameUrl}?popup=1`
      && popupObserved?.result?.url === `${crossFrameUrl}?popup=1`
      && !JSON.stringify(popupAction).includes("targetId"),
  popupRef?.url || "missing");

  const deniedPopupResponse = await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "click", locator: { by: "role", value: "button", name: "Open denied popup" },
      popup: true, timeoutMs: 5000, expectedRisk: "externalEffect",
    }],
  });
  const deniedPopup = toolText(deniedPopupResponse);
  const targetsAfterDeniedPopup = toolText(await callTool("browserListTargets"));
  check("권한 밖 popup은 닫히고 applied 실패로 남음",
    deniedPopupResponse.result.isError === true
      && deniedPopup.code === "BROWSER_CONTROL_PERMISSION_DENIED" && deniedPopup.outcome === "applied"
      && !targetsAfterDeniedPopup.some((target) => target.url.startsWith(deniedOrigin)),
  deniedPopup.code);

  const stateActions = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [
      { kind: "cookieSet", name: "browser-session", value: "browser-cookie-secret", httpOnly: true, sameSite: "Lax", expectedRisk: "externalEffect" },
      { kind: "cookiesGet", expectedRisk: "read" },
      { kind: "cookieDelete", name: "browser-session", expectedRisk: "externalEffect" },
      { kind: "cookiesGet", expectedRisk: "read" },
      { kind: "storageSet", area: "local", key: "browser-mode", value: "ready", expectedRisk: "externalEffect" },
      { kind: "storageGet", area: "local", expectedRisk: "read" },
      { kind: "storageRemove", area: "local", key: "browser-mode", expectedRisk: "externalEffect" },
      { kind: "storageSet", area: "session", key: "temporary", value: "remove-me", expectedRisk: "externalEffect" },
      { kind: "storageClear", area: "session", expectedRisk: "externalEffect" },
    ],
  }));
  const cookieReads = stateActions.actions?.filter((action) => action.kind === "cookiesGet") || [];
  const storageRead = stateActions.actions?.find((action) => action.kind === "storageGet");
  const stateAfter = toolText(await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: "({local: localStorage.getItem('browser-mode'), session: sessionStorage.getItem('temporary')})",
    returnByValue: true,
  }, "externalEffect"));
  check("cookie metadata와 Web Storage action이 bounded destination 계약으로 동작",
    cookieReads[0]?.result?.cookies?.some((cookie) => cookie.name === "browser-session")
      && cookieReads[1]?.result?.cookies?.every((cookie) => cookie.name !== "browser-session")
      && storageRead?.result?.entries?.some((entry) => entry.key === "browser-mode" && entry.value === "ready")
      && stateAfter.result?.result?.value?.local === null && stateAfter.result.result.value.session === null
      && !JSON.stringify(stateActions).includes("browser-cookie-secret"),
  `${cookieReads.length} cookie reads`);

  const strictDuplicate = await callTool("browserAct", {
    sessionRef,
    actions: [{ kind: "click", locator: { by: "text", value: "Strict duplicate" }, expectedRisk: "externalEffect" }],
  });
  const strictDuplicatePayload = toolText(strictDuplicate);
  check("semantic locator가 둘 이상이면 effect 전 strict 거부",
    strictDuplicate.result.isError === true && strictDuplicatePayload.code === "BROWSER_AUTOMATION_STRICT_LOCATOR"
      && strictDuplicatePayload.outcome === "notSent",
  strictDuplicatePayload.code);

  const artifactReady = toolText(await callTool("browserObserve", {
    sessionRef,
    expectedRisk: "read",
    maxNodes: 100,
    includeScreenshot: true,
    includeConsole: true,
    includeNetwork: true,
    maxEvents: 20,
  }));
  check("bounded screenshot와 trace schema가 semantic observation에 결합",
    artifactReady.result?.screenshot?.mimeType === "image/png"
      && artifactReady.result.screenshot.byteLength > 0
      && artifactReady.result.screenshot.dataBase64.length > 100
      && artifactReady.trace?.schemaVersion === "1"
      && artifactReady.trace.steps?.[0]?.commands.some((command) => command.method === "Page.captureScreenshot"),
  `${artifactReady.result?.screenshot?.byteLength || 0} bytes`);
  receiverRequests = 0;
  receiverBody = null;
  await browserCommand(sessionRef, "Runtime.evaluate", {
    expression: "window.browserControlFixture.observeArtifacts()", awaitPromise: true, returnByValue: true,
  }, "externalEffect");
  const artifactEvents = toolText(await callTool("browserObserve", {
    sessionRef,
    expectedRisk: "read",
    maxNodes: 100,
    includeConsole: true,
    includeNetwork: true,
    maxEvents: 20,
  }));
  const artifactText = JSON.stringify(artifactEvents.result);
  check("console과 network artifact가 query와 secret을 redaction",
    artifactEvents.result?.console?.some((event) => event.args?.includes("token=[redacted]"))
      && artifactEvents.result?.network?.some((event) => event.url === `${targetOrigin}/browserControlReceiver`)
      && !artifactText.includes("must-redact") && !artifactText.includes("?token="),
  `${artifactEvents.result?.console?.length || 0} console, ${artifactEvents.result?.network?.length || 0} network`);

  const missingHighLevelTarget = await callTool("browserAct", {
    sessionRef,
    actions: [{ kind: "click", selector: "#missing", timeoutMs: 1, expectedRisk: "externalEffect" }],
  });
  const missingHighLevelPayload = toolText(missingHighLevelTarget);
  check("없는 target이 effect 전 actionability 실패로 분리됨",
    missingHighLevelTarget.result.isError === true
      && missingHighLevelPayload.code === "BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT"
      && missingHighLevelPayload.outcome === "notSent"
      && missingHighLevelPayload.failedActionIndex === 0,
  missingHighLevelPayload.code);

  await browserCommand(sessionRef, "Page.navigate", { url: `${targetUrl}?raw-same-origin=1` }, "externalEffect");
  await delay(250);
  const staleLocatorUse = await callTool("browserAct", {
    sessionRef,
    actions: [{ kind: "fill", locatorRef: titleLocator, value: "must-not-apply", expectedRisk: "externalEffect" }],
  });
  const staleLocatorPayload = toolText(staleLocatorUse);
  check("raw same-origin navigation 뒤 locator는 external command 전에 무효화",
    staleLocatorUse.result.isError === true
      && staleLocatorPayload.code === "BROWSER_AUTOMATION_STALE_LOCATOR"
      && staleLocatorPayload.outcome === "notSent",
  staleLocatorPayload.code);

  const navigated = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{ kind: "navigate", url: `${targetUrl}#high-level`, waitUntil: "load", timeoutMs: 5000, expectedRisk: "externalEffect" }],
  }));
  check("고수준 navigate가 final origin을 재검사하고 load state까지 대기",
    navigated.actions?.[0]?.state === "applied"
      && navigated.actions[0].result?.waitUntil === "load"
      && navigated.actions[0].result?.readyState === "complete"
      && navigated.actions[0].result?.finalOrigin === targetOrigin,
  JSON.stringify(navigated.actions?.[0]?.result));
  await delay(250);

  const health = await fetch(targetOrigin + "/browserControlReceiver", { method: "POST", body: JSON.stringify({ marker: "health" }) });
  check("controlled receiver 대조군 도달", health.status === 204);
  receiverRequests = 0;
  receiverBody = null;
  await callTool("pythonRun", { code: `import js\njs.fetch(${JSON.stringify(targetOrigin + "/browserControlReceiver?marker=python-exfil")})` });
  await delay(250);
  check("browser broker opt-in 뒤에도 Python CSP 외부 전송 0", receiverRequests === 0, `${receiverRequests} requests`);

  await callTool("pythonRun", { code: "prepared = {'value': 41}" });
  const checkpoint = toolText(await callTool("checkpointSave"));
  check("Python checkpoint 준비", Number.isInteger(checkpoint.index) && checkpoint.index > 0, checkpoint.index);

  const browserEffect = toolText(await browserCommand(sessionRef, "Runtime.evaluate", {
      expression: "window.browserControlFixture.increment(); window.browserControlFixture.send('mcp-browser')",
      awaitPromise: true,
      returnByValue: true,
    }, "externalEffect"));
  check("browser external effect는 applied로 반환", browserEffect.state === "applied" && browserEffect.risk === "externalEffect", browserEffect.state);
  await callTool("pythonRun", { code: "prepared['value'] = 999\ndirty = True" });
  await callTool("checkpointRestore", { index: checkpoint.index });
  const pythonAfter = toolText(await callTool("pythonRun", { code: "(prepared['value'], 'dirty' in globals())" }));
  check("checkpointRestore가 Python 상태를 복원", pythonAfter.value === "(41, False)", pythonAfter.value);

  const browserAfter = toolText(await browserCommand(sessionRef, "Runtime.evaluate",
    { expression: "window.browserControlFixture.read()", returnByValue: true }, "externalEffect"));
  check("checkpointRestore 뒤 browser mutation은 남음", browserAfter.result?.result?.value?.count === 1, JSON.stringify(browserAfter.result?.result?.value));
  check("checkpointRestore 뒤 receiver effect도 정확히 한 번 남음",
    receiverRequests === 1 && receiverBody?.marker === "mcp-browser" && receiverBody?.payload?.count === 1,
    `${receiverRequests} request, ${JSON.stringify(receiverBody)}`);

  const riskMismatch = await browserCommand(sessionRef, "Runtime.evaluate",
    { expression: "window.browserControlFixture.increment()", returnByValue: true }, "read");
  check("호출자가 Runtime.evaluate 위험도를 read로 낮추면 전송 전 거부",
    riskMismatch.result.isError === true && toolText(riskMismatch).code === "BROWSER_CONTROL_PERMISSION_DENIED"
      && toolText(riskMismatch).outcome === "notSent");
  const missingRisk = await callTool("browserCommand", {
    sessionRef,
    method: "Runtime.evaluate",
    params: { expression: "window.browserControlFixture.increment()" },
  });
  check("expectedRisk를 생략한 MCP 명령도 전송 전 거부",
    missingRisk.result.isError === true && toolText(missingRisk).code === "BROWSER_CONTROL_PERMISSION_DENIED"
      && toolText(missingRisk).outcome === "notSent");
  const afterMismatch = toolText(await browserCommand(sessionRef, "Runtime.evaluate",
    { expression: "window.browserControlFixture.read()", returnByValue: true }, "externalEffect"));
  check("위험도 불일치 명령은 DOM effect 0", afterMismatch.result?.result?.value?.count === 1,
    afterMismatch.result?.result?.value?.count);

  receiverRequests = 0;
  receiverBody = null;
  const cancellablePipeline = beginRequest("tools/call", {
    name: "browserAct",
    arguments: {
      sessionRef,
      actions: [
        { kind: "click", selector: "#signal", expectedRisk: "externalEffect" },
        { kind: "waitFor", selector: "#never-created", timeoutMs: 30000, expectedRisk: "read" },
      ],
    },
  });
  const pipelineDeadline = Date.now() + Math.min(TIMEOUT_MS, 30000);
  while (Date.now() < pipelineDeadline && receiverBody?.marker !== "high-level-cancel") await delay(25);
  check("고수준 pipeline 첫 external action이 실제 한 번 적용", receiverRequests === 1
    && receiverBody?.marker === "high-level-cancel", `${receiverRequests} request`);
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: cancellablePipeline.id, reason: "browser pipeline gate cancellation" },
  }) + "\n");
  const pipelineCancelled = await cancellablePipeline.response;
  const pipelineCancelledPayload = toolText(pipelineCancelled);
  const cancelledAtClick = pipelineCancelledPayload.outcome === "outcomeUnknown"
    && pipelineCancelledPayload.failedActionIndex === 0 && pipelineCancelledPayload.completed?.length === 0;
  const cancelledAfterClick = pipelineCancelledPayload.outcome === "notSent"
    && pipelineCancelledPayload.failedActionIndex === 1 && pipelineCancelledPayload.completed?.length === 1
    && pipelineCancelledPayload.completed[0]?.kind === "click";
  check("pipeline 취소가 실제 command 응답 경계의 completed prefix를 보존", pipelineCancelled.result.isError === true
    && pipelineCancelledPayload.code === "BROWSER_CONTROL_COMMAND_CANCELLED"
    && (cancelledAtClick || cancelledAfterClick),
  `${pipelineCancelledPayload.completed?.length} completed`);
  await delay(250);
  check("취소된 고수준 pipeline external effect는 재시도하지 않음", receiverRequests === 1, `${receiverRequests} requests`);

  const deniedMethod = await browserCommand(sessionRef, "Network.getCookies", {}, "read");
  const deniedPayload = toolText(deniedMethod);
  check("method allowlist 밖 명령은 tool isError", deniedMethod.result.isError === true && deniedPayload.code === "BROWSER_CONTROL_PERMISSION_DENIED" && deniedPayload.outcome === "notSent", deniedPayload.code);

  receiverRequests = 0;
  receiverBody = null;
  const cancellable = beginRequest("tools/call", {
    name: "browserCommand",
    arguments: {
      sessionRef,
      method: "Runtime.evaluate",
      expectedRisk: "externalEffect",
      params: {
        expression: `fetch('/browserControlReceiver?marker=cancelled', {method:'POST', body:JSON.stringify({marker:'cancelled'})}).then(() => new Promise(() => {}))`,
        awaitPromise: true,
      },
    },
  });
  const cancellableResponse = cancellable.response.then(
    (message) => ({ message, error: null }),
    (error) => ({ message: null, error }),
  );
  const cancelDeadline = Date.now() + Math.min(TIMEOUT_MS, 30000);
  while (Date.now() < cancelDeadline && receiverBody?.marker !== "cancelled") await delay(25);
  check("취소 대상 명령이 실제 전송됨", receiverRequests === 1 && receiverBody?.marker === "cancelled", `${receiverRequests} request`);
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: cancellable.id, reason: "browser-control gate cancellation" },
  }) + "\n");
  const cancelledOutcome = await cancellableResponse;
  if (cancelledOutcome.error) throw cancelledOutcome.error;
  const cancelled = cancelledOutcome.message;
  const cancelledPayload = toolText(cancelled);
  check("전송 뒤 MCP cancellation은 outcomeUnknown이고 자동 재시도하지 않음",
    cancelled.result.isError === true && cancelledPayload.code === "BROWSER_CONTROL_COMMAND_CANCELLED"
      && cancelledPayload.outcome === "outcomeUnknown" && cancelledPayload.retryable === false,
    cancelledPayload.code);
  await delay(250);
  check("취소된 external command receiver 요청은 정확히 1회", receiverRequests === 1, `${receiverRequests} requests`);

  const deniedNavigate = await browserCommand(sessionRef, "Page.navigate", { url: deniedUrl }, "externalEffect");
  check("raw Page.navigate도 destination origin을 전송 전에 검사", deniedNavigate.result.isError === true
    && toolText(deniedNavigate).code === "BROWSER_CONTROL_PERMISSION_DENIED"
    && toolText(deniedNavigate).outcome === "notSent");
  const redirectedNavigateResponse = await callTool("browserAct", {
    sessionRef,
    actions: [{
      kind: "navigate", url: `${targetOrigin}/browserControlRedirect`, waitUntil: "load",
      timeoutMs: 5000, expectedRisk: "externalEffect",
    }],
  });
  const redirectedNavigate = toolText(redirectedNavigateResponse);
  check("허용 URL의 권한 밖 redirect는 post-send applied 실패",
    redirectedNavigateResponse.result.isError === true
      && redirectedNavigate.code === "BROWSER_CONTROL_PERMISSION_DENIED" && redirectedNavigate.outcome === "applied"
      && redirectedNavigate.trace?.steps?.[0]?.commands?.[0]?.method === "Page.navigate",
  redirectedNavigate.code);
  const originSwap = await browserCommand(sessionRef, "DOM.getDocument", {}, "read");
  const originPayload = toolText(originSwap);
  check("redirect 뒤 session은 command 직전까지 권한 미검증 상태", originSwap.result.isError === true && originPayload.code === "BROWSER_CONTROL_PERMISSION_DENIED", originPayload.code);

  const detached = toolText(await callTool("browserDetach", { sessionRef }));
  check("browserDetach 성공", detached.detached === true);
  const afterDetach = toolText(await callTool("browserInspect"));
  check("detach가 locator, watcher, artifact buffer와 popup capture를 모두 정리",
    afterDetach.sessions === 0 && afterDetach.popupCaptures === 0
      && afterDetach.automation?.locators === 0
      && afterDetach.automation?.observation?.sessions === 0
      && afterDetach.automation?.lifecycle?.sessions === 0
      && afterDetach.automation?.lifecycle?.watchers === 0
      && afterDetach.automation?.download?.enabledSessions === 0,
  JSON.stringify({
    sessions: afterDetach.sessions,
    popupCaptures: afterDetach.popupCaptures,
    locators: afterDetach.automation?.locators,
    observationSessions: afterDetach.automation?.observation?.sessions,
    lifecycleSessions: afterDetach.automation?.lifecycle?.sessions,
    lifecycleWatchers: afterDetach.automation?.lifecycle?.watchers,
    downloadSessions: afterDetach.automation?.download?.enabledSessions,
  }));
  const stale = await browserCommand(sessionRef, "DOM.getDocument", {}, "read");
  check("detach 뒤 stale session은 고유 오류", stale.result.isError === true && toolText(stale).code === "BROWSER_CONTROL_SESSION_DETACHED", toolText(stale).code);

  // mousePressed는 완료됐고 mouseReleased event handler가 renderer를 멈춘 사이 browser를 죽인다.
  // trace의 두 command 경계로 effect 전송과 무재시도를 판정한다.
  directBrowser = launchBrowser(targetUrl, {
    prefix: "pyprocBrowserControlDeath-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
  });
  directBroker = await connectNodeBrowserControl({
    profileDir: directBrowser.profile,
    targetOrigins: [targetOrigin],
    methods: BROWSER_AUTOMATION_ACTIONS.click.methods,
    maxRisk: "externalEffect",
    timeoutMs: TIMEOUT_MS,
  });
  check("Node broker가 stdio 밖 loopback listener를 열지 않음", directBroker.inspect().listener === null);
  let directTarget = null;
  const targetDeadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < targetDeadline && !directTarget) {
    directTarget = (await directBroker.listTargets()).find((entry) => entry.url === targetUrl);
    if (!directTarget) await delay(50);
  }
  if (!directTarget) throw new Error("direct browser-control target did not become ready");
  const directSession = await directBroker.attach(directTarget.targetRef);
  const directAutomation = new BrowserAutomation({ port: directBroker.port, actions: ["click"] });
  const uncertainCommand = errorOf(directAutomation.run(directSession, [
    { kind: "click", selector: "#hang", expectedRisk: "externalEffect" },
  ]));
  await delay(1000);
  directBrowser.close();
  directBrowser = null;
  const uncertainError = await uncertainCommand;
  const inputCommands = uncertainError?.trace?.steps?.[0]?.commands?.filter((command) => command.method === "Input.dispatchMouseEvent") || [];
  check("browser 사망 전 trusted pointer effect가 전송됨",
    inputCommands.length === 2 && inputCommands[0].state === "applied" && inputCommands[1].state === "failed",
  `${inputCommands.length} input commands`);
  check("전송 뒤 browser 사망은 pipeline 위치와 outcomeUnknown을 보존",
    uncertainError?.code === "BROWSER_CONTROL_OUTCOME_UNKNOWN" && uncertainError.outcome === "outcomeUnknown" && uncertainError.retryable === false,
    uncertainError?.code);
  check("browser 사망 pipeline은 완료되지 않은 action을 성공으로 만들지 않음",
    uncertainError?.failedActionIndex === 0 && uncertainError?.completed?.length === 0,
    `${uncertainError?.completed?.length} completed`);
  await delay(250);
  check("outcomeUnknown 고수준 action을 자동 재시도하지 않음", inputCommands.length === 2,
    `${inputCommands.length} input commands`);
  await directBroker.close();
  directBroker = null;
} catch (error) {
  check("gate 예외 없음", false, String(error?.stack || error).slice(0, 600));
} finally {
  try { await directBroker?.close(); } catch (error) {}
  try { directBrowser?.close(); } catch (error) {}
  child.kill();
  await new Promise((resolve) => targetServer.close(resolve));
  await new Promise((resolve) => crossServer.close(resolve));
  await new Promise((resolve) => deniedServer.close(resolve));
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
