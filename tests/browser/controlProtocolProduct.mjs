// controlProtocolProduct.mjs - packed pyproc-control의 machine, cancel, automation, attachment 제품 게이트.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const frameBridge = await readFile(join(ROOT, "scripts", "automationSpace", "frameSpaceTarget.js"));
const targetServer = createServer((req, res) => {
  if (req.url === "/evidence" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end('{"ok":true}');
    return;
  }
  if (req.url === "/frameSpaceTarget.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(frameBridge);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body><h1 id=title>control-ready</h1><button id=verify>Verify</button>
    <script>document.getElementById("verify").addEventListener("click", async () => {
      const response = await fetch("/evidence", { method: "POST" });
      const status = document.createElement("p"); status.setAttribute("role", "status");
      status.textContent = response.ok ? "verified" : "failed"; document.body.append(status);
    });</script><script src=/frameSpaceTarget.js></script></body></html>`);
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const installed = await installPackedPyProc("pyprocControlProduct-");
const configPath = join(installed.appDir, ".pyproc-control-product", "manifest.json");
const pythonOnlyConfigPath = join(installed.appDir, ".pyproc-python-only", "manifest.json");
const observeConfigPath = join(installed.appDir, ".pyproc-observe", "manifest.json");
const reloadConfigPath = join(installed.appDir, "pyproc-control-reload.json");
const frameConfigPath = join(installed.appDir, "pyproc-control-frame.json");
const browser = process.env.PYPROC_BROWSER || undefined;
const mcpCli = binPath(installed.appDir, "pyproc-mcp");
run(mcpCli, ["init", "--recipe", "pythonOnly", "--project-root", installed.appDir,
  "--out", ".pyproc-python-only", "--engine-root", join(ROOT, "vendor", "pyodide"),
  "--timeout-ms", String(TIMEOUT_MS), ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
run(mcpCli, ["init", "--recipe", "observeLocal", "--project-root", installed.appDir,
  "--out", ".pyproc-observe", "--engine-root", join(ROOT, "vendor", "pyodide"),
  "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin,
  "--purpose", "observe-local-product-gate", "--acknowledge-effects",
  ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
run(mcpCli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
  "--out", ".pyproc-control-product", "--engine-root", join(ROOT, "vendor", "pyodide"),
  "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin, "--max-risk", "externalEffect",
  "--purpose", "control-protocol-product-gate", "--acknowledge-effects",
  "--action", "snapshot", "--action", "screenshot", "--action", "click",
  "--artifact-max-bytes", String(8 * 1024 * 1024), "--artifact-total-bytes", String(16 * 1024 * 1024),
  "--artifact-max-count", "8", "--artifact-inline-bytes", String(4 * 1024 * 1024),
  "--artifact-ttl-ms", "120000", ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
await writeFile(reloadConfigPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: 1500,
  browser: {
    enabled: true,
    provider: "frame",
    ...(browser ? { executable: browser } : {}),
    allowedOrigins: [targetOrigin],
    maxRisk: "externalEffect",
    actions: ["snapshot", "waitFor"],
    methods: [],
    externalEffects: "acknowledged",
    purpose: "control page reload product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
  },
}, null, 2));
await writeFile(frameConfigPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: TIMEOUT_MS,
  browser: {
    enabled: true,
    provider: "frame",
    ...(browser ? { executable: browser } : {}),
    allowedOrigins: [targetOrigin],
    maxRisk: "externalEffect",
    actions: ["snapshot", "waitFor"],
    methods: [],
    externalEffects: "acknowledged",
    purpose: "JavaScript Control FrameSpace product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
  },
}, null, 2));

const cli = binPath(installed.appDir, "pyproc-control");
const pythonOnlyDoctor = JSON.parse(run(cli, ["doctor", "--config", pythonOnlyConfigPath],
  { cwd: installed.appDir }).stdout);
check("설치본 Python-only doctor가 자동화와 CDP authority를 effect 없이 닫음",
  pythonOnlyDoctor.ok === true && pythonOnlyDoctor.automation.enabled === false
    && pythonOnlyDoctor.automation.cdpEndpoint === false
    && pythonOnlyDoctor.checks.some((entry) => entry.code === "MACHINE_PREFLIGHT_EFFECT_FREE"));
const pythonOnlyRun = JSON.parse(run(cli, ["run", "--config", pythonOnlyConfigPath,
  "--code", "40+2", "--timeout-ms", String(TIMEOUT_MS)],
{ cwd: installed.appDir, timeoutMs: TIMEOUT_MS + 30000 }).stdout);
check("설치본 Python-only init, doctor, run, close 여정",
  pythonOnlyRun.terminal === "completed" && pythonOnlyRun.output?.value === "42"
    && pythonOnlyRun.attachments?.length === 0);
const checkReport = JSON.parse(run(cli, ["--config", configPath, "--check"], { cwd: installed.appDir }).stdout);
check("installed pyproc-control preflight", checkReport.ok === true
  && checkReport.automation.actions.includes("screenshot") && !!checkReport.machineBrowser);

const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const installedRequire = createRequire(join(installed.appDir, "controlProductEntry.mjs"));
const controlEntry = installedRequire.resolve("pyproc/control");
const { ControlRemoteError, PyProcControlClient } = await import(pathToFileURL(controlEntry).href);
const { createControlProduct } = await import(pathToFileURL(join(packageRoot,
  "scripts", "controlProtocol", "controlProduct.mjs")).href);
const { loadMcpProductConfig } = await import(pathToFileURL(join(packageRoot,
  "scripts", "mcpProductConfig.mjs")).href);
const { launchBrowser } = await import(pathToFileURL(join(packageRoot,
  "scripts", "browserControl", "browserLauncher.mjs")).href);
const { readDevToolsEndpoint } = await import(pathToFileURL(join(packageRoot,
  "scripts", "browserControl", "browserControlBroker.mjs")).href);
const { CdpConnection } = await import(pathToFileURL(join(packageRoot,
  "scripts", "browserControl", "cdpConnection.mjs")).href);
const { controlBase } = await import(pathToFileURL(join(packageRoot,
  "scripts", "controlProtocol", "controlProtocol.js")).href);

let reloadProduct = null;
let reloadConnection = null;
try {
  const loaded = await loadMcpProductConfig(reloadConfigPath);
  reloadProduct = await createControlProduct({ env: loaded.env,
    browserLauncher: (url, options) => launchBrowser(url, { ...options,
      extraArgs: [...(options.extraArgs || []), "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] }) });
  await reloadProduct.pageBridge.waitForReady();
  const opened = await reloadProduct.host.request({ ...controlBase("request"), requestId: "product:reload-open",
    operation: "automation.target.open", input: { url: `${targetOrigin}/reload`,
      expectedRisk: "externalEffect", waitUntil: "load" } });
  const attached = await reloadProduct.host.request({ ...controlBase("request"), requestId: "product:reload-attach",
    operation: "automation.session.attach", input: { targetRef: opened.terminal.output.targetRef } });
  await reloadProduct.host.request({ ...controlBase("request"), requestId: "product:fetch-interceptor-install",
    operation: "machine.run", input: { code: `import js
js.eval("globalThis.pyprocOriginalFetch=globalThis.fetch;globalThis.pyprocFetchIntercepted=false;globalThis.fetch=(...args)=>{globalThis.pyprocFetchIntercepted=true;return globalThis.pyprocOriginalFetch(...args)}")` } });
  const fetchFence = await reloadProduct.host.request({ ...controlBase("request"),
    requestId: "product:fetch-interceptor-probe", operation: "machine.run",
    input: { code: "bool(js.pyprocFetchIntercepted)" } });
  await reloadProduct.host.request({ ...controlBase("request"), requestId: "product:fetch-interceptor-restore",
    operation: "machine.run", input: { code: `import js
js.eval("globalThis.fetch=globalThis.pyprocOriginalFetch;delete globalThis.pyprocOriginalFetch;delete globalThis.pyprocFetchIntercepted")` } });
  const activeId = "product:page-reload";
  const active = reloadProduct.host.request({ ...controlBase("request"), requestId: activeId,
    operation: "automation.act", input: { sessionRef: attached.terminal.output,
      actions: [{ kind: "waitFor", selector: "#never", state: "visible", expectedRisk: "read" }] } });
  const deliveryDeadline = Date.now() + 30000;
  while (reloadProduct.pageBridge._pending.get(activeId)?.state !== "delivered"
    && Date.now() < deliveryDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
  const previousEpoch = reloadProduct.pageBridge.pageEpoch;
  reloadConnection = await CdpConnection.connect(await readDevToolsEndpoint(reloadProduct.browserSession.profile));
  const targets = await reloadConnection.send("Target.getTargets");
  const controlTarget = targets.targetInfos.find((target) => target.type === "page"
    && target.url.startsWith(reloadProduct.pageUrl));
  if (!controlTarget) throw new Error("control product page target was not found");
  const { sessionId } = await reloadConnection.send("Target.attachToTarget",
    { targetId: controlTarget.targetId, flatten: true });
  const tokenProbe = await reloadConnection.send("Runtime.evaluate", {
    expression: `(async () => {
      const navigationNames = performance.getEntriesByType('navigation').map((entry) => entry.name);
      const replayStatus = await fetch(navigationNames[0], { cache: 'no-store' }).then((response) => response.status);
      return { stored: sessionStorage.getItem('pyprocControlToken'), hash: location.hash,
        navigationNames, replayStatus };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  await reloadConnection.send("Page.reload", { ignoreCache: true }, sessionId);
  const terminal = (await active).terminal;
  const afterReload = await reloadProduct.host.request({ ...controlBase("request"), requestId: "product:after-reload",
    operation: "machine.run", input: { code: "40 + 2" } });
  const reloadPassed = fetchFence.terminal.output.value === "False"
      && tokenProbe.result.value.stored === null && tokenProbe.result.value.hash === ""
      && tokenProbe.result.value.navigationNames.every((name) => !name.includes("controlToken"))
      && tokenProbe.result.value.replayStatus === 410
      && terminal.type === "error" && terminal.error.code === "CONTROL_TIMEOUT"
      && terminal.error.outcome === "outcomeUnknown" && reloadProduct.pageBridge.pageEpoch === previousEpoch
      && afterReload.terminal.type === "error" && afterReload.terminal.error.code === "CONTROL_TIMEOUT"
      && afterReload.terminal.error.outcome === "notSent";
  check("control token을 guest realm 밖에 두고 실제 reload를 fail-closed 처리", reloadPassed,
    reloadPassed ? "" : JSON.stringify({ terminal, previousEpoch,
      pageEpoch: reloadProduct.pageBridge.pageEpoch, tokenProbe: tokenProbe.result.value,
      fetchFence: fetchFence.terminal, afterReload: afterReload.terminal }));
} catch (error) {
  check("실제 control page reload 제품 경로", false, String(error?.stack || error).slice(-800));
} finally {
  reloadConnection?.close();
  await reloadProduct?.close();
}

let client = null;
let frameClient = null;
let observeClient = null;

console.log("installed pyproc-control product gate");
try {
  const observeDoctor = await PyProcControlClient.check(observeConfigPath,
    { cwd: installed.appDir, timeoutMs: TIMEOUT_MS });
  observeClient = await PyProcControlClient.start(observeConfigPath,
    { cwd: installed.appDir, startupTimeoutMs: TIMEOUT_MS });
  const observeOpened = await observeClient.openTarget(`${targetOrigin}/observe`, {
    expectedRisk: "externalEffect", waitUntil: "load",
  });
  const observeAttached = await observeClient.attachSession(observeOpened.output.targetRef);
  const observeHeading = (await observeClient.perception(observeAttached.output)
    .query({ role: "heading", name: "control-ready" })).one();
  check("observeLocal 설치 profile이 고정 read catalog로 APX observation을 완료",
    observeDoctor.automation.actions.join(",") === "snapshot,screenshot,waitFor"
      && observeHeading.name === "control-ready");
  await observeClient.detachSession(observeAttached.output);
  await observeClient.close();
  observeClient = null;

  const preflight = await PyProcControlClient.check(configPath, { cwd: installed.appDir, timeoutMs: TIMEOUT_MS });
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: TIMEOUT_MS, maxAttachmentChunkBytes: 64 });
  check("공개 JavaScript 입구가 preflight와 operation 17종을 제공",
    preflight.ok === true
      && controlEntry === join(packageRoot, "scripts", "controlProtocol", "controlApi.js")
      && client.operations.length === 17 && client.operations.includes("machine.run")
      && client.operations.includes("automation.act"), client.operations.join(","));

  await client.runPython("controlState = 40");
  const machine = await client.runPython("controlState + 2");
  check("JavaScript facade의 persistent Python Machine과 canonical terminal",
    machine.terminal === "completed" && machine.output.value === "42", machine.output.value);
  const space = await client.inspectSpace();
  check("설치 제품이 NativeCdpSpace 능력과 복원 경계를 선언",
    space.output.space?.providerKind === "nativeCdp"
      && space.output.space?.capabilities?.join(",") === "dom,network,target,storage,runtime,screenshot,artifact,perception"
      && space.output.space?.restoreBoundary === "externalEffectsRemain"
      && space.output.space?.replayBoundary === "recordOnly");
  let wrongSpace = null;
  try {
    await client.inspectSpace({ spaceId: "space:wrong" });
  } catch (error) { wrongSpace = error; }
  check("request spaceId가 configured provider와 다르면 effect 전에 거부",
    wrongSpace instanceof ControlRemoteError && wrongSpace.code === "CONTROL_SPACE_MISMATCH"
      && wrongSpace.outcome === "notSent");

  const cancelId = "request:cancel";
  const cancelled = client.requestAsync("machine.run", {
    code: "import time\ncontrolEffect = 'applied'\ntime.sleep(1.0)",
  }, { requestId: cancelId });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await cancelled.cancel("product gate cancellation");
  let cancelError = null;
  try { await cancelled.result; } catch (error) { cancelError = error; }
  check("전달 뒤 cancel이 결과 불명과 비재시도로 종결",
    cancelError instanceof ControlRemoteError && cancelError.code === "CONTROL_CANCELLED"
      && cancelError.outcome === "outcomeUnknown" && cancelError.retryable === false);
  await new Promise((resolve) => setTimeout(resolve, 1100));

  let deadlineError = null;
  try {
    await client.runPython("import time\ntime.sleep(1.0)", { timeoutMs: 100 });
  } catch (error) { deadlineError = error; }
  check("고수준 timeoutMs가 protocol cancel과 canonical terminal로 수렴",
    deadlineError instanceof ControlRemoteError && deadlineError.code === "CONTROL_CANCELLED"
      && deadlineError.outcome === "outcomeUnknown" && deadlineError.retryable === false);
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const opened = await client.openTarget(`${targetOrigin}/product`, {
    expectedRisk: "externalEffect", waitUntil: "load",
  });
  const attached = await client.attachSession(opened.output.targetRef);
  const eyes = client.perception(attached.output);
  const perceived = await eyes.observe({
    budget: { maxEntities: 40, maxRelations: 80, maxBytes: 65536 },
  });
  const heading = (await eyes.query({ role: "heading", name: "control-ready" })).one();
  const perceptionGraph = perceived.output;
  check("공개 JavaScript Eyes가 같은 APX graph와 단일 query를 반환",
    perceptionGraph.protocol === "apx"
      && perceptionGraph.profile.includes("apx-core/1")
      && perceptionGraph.entities.length > 0
      && heading.role === "heading" && heading.name === "control-ready"
      && !JSON.stringify(perceptionGraph).includes("backendNodeId"));
  const situation = await eyes.situate({ objective: "Verify and prove the accepted state", requirements: [{
    requirementRef: "requirement:verify", select: { role: "button", name: "Verify", actionable: true },
    need: ["fact", "affordance"], cardinality: "one",
  }] });
  const verify = situation.requirement("requirement:verify").oneAffordance("click");
  check("공개 JavaScript Eyes가 목표별 SituationCapsule과 broker capability를 반환",
    situation.situationRef.startsWith("situation:") && situation.worldRef.startsWith("world:")
      && verify.capabilityRef?.startsWith("capability:"));
  const evidenced = await eyes.actAffordance(verify, { intent: "Verify the product state", verify: { all: [
    { entityAppeared: { role: "status", nameContains: "verified" } },
    { networkResponse: { method: "POST", urlPath: "/evidence", status: 200 } },
  ], withinMs: 5000 } });
  check("공개 JavaScript Eyes가 DOM과 network postcondition을 함께 확인",
    evidenced.output.actions[0].result.evidence?.effectOutcome === "applied"
      && evidenced.output.actions[0].result.evidence?.verification?.state === "confirmed"
      && evidenced.output.actions[0].result.evidence?.verification?.evidenceRefs?.length >= 2);
  const captured = await client.act(attached.output,
    [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  const attachment = captured.attachments[0];
  const bytes = Buffer.from(attachment.bytes);
  check("협상된 작은 chunk로 screenshot attachment가 terminal 전에 검증됨",
    captured.terminal === "completed" && captured.outcome === "observed" && captured.attachments.length === 1
      && attachment.mimeType === "image/png"
      && createHash("sha256").update(bytes).digest("hex") === attachment.sha256
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && !JSON.stringify(captured.output).includes("dataBase64"), `${bytes.byteLength} bytes`);
  const artifactRef = captured.output.actions[0].result.artifactRef;
  const deleted = await client.deleteArtifact(artifactRef);
  check("공개 JavaScript facade가 screenshot artifact를 명시 삭제",
    deleted.output.deleted === true);
  await client.detachSession(attached.output);

  const duplicateId = "request:single-use";
  const first = await client.request("machine.run", { code: "6 * 7" }, { requestId: duplicateId });
  let duplicate = null;
  try { await client.request("machine.run", { code: "duplicateEffect = True" }, { requestId: duplicateId }); }
  catch (error) { duplicate = error; }
  const absent = await client.request("machine.run", { code: "'duplicateEffect' in globals()" });
  check("client가 request ID 재사용을 두 번째 effect 전에 거부",
    first.output.value === "42" && duplicate?.code === "CONTROL_REQUEST_DUPLICATE"
      && absent.output.value === "False");

  frameClient = await PyProcControlClient.start(frameConfigPath, { cwd: installed.appDir,
    startupTimeoutMs: TIMEOUT_MS });
  const frameOpened = await frameClient.openTarget(`${targetOrigin}/frame-product`, {
    expectedRisk: "externalEffect", waitUntil: "load",
  });
  const frameAttached = await frameClient.attachSession(frameOpened.output.targetRef);
  const frameEyes = frameClient.perception(frameAttached.output);
  const frameHeading = (await frameEyes.query({ role: "heading", name: "control-ready" })).one();
  const frameSituation = await frameEyes.situate({ requirements: [{ requirementRef: "requirement:heading",
    select: { role: "heading", name: "control-ready" }, need: ["fact"], cardinality: "one" }] });
  const frameSpace = await frameClient.inspectSpace();
  const framePass = frameHeading.name === "control-ready"
      && frameSpace.output.space.providerKind === "frame"
      && frameSpace.output.perception.level === "L3"
      && frameSpace.output.perception.visualModes.join(",") === "off"
      && frameSituation.requirement("requirement:heading").state === "satisfied";
  check("같은 JavaScript Eyes가 FrameSpace L3 경계에서 작동", framePass,
    framePass ? "" : JSON.stringify({ heading: frameHeading.value, inspect: frameSpace.output }));
  await frameClient.detachSession(frameAttached.output);
} catch (error) {
  check("Control Protocol 제품 흐름 예외 없음", false, String(error?.stack || error).slice(-800));
} finally {
  await client?.close();
  await frameClient?.close();
  await observeClient?.close();
  targetServer.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
