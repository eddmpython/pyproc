// controlProtocolProduct.mjs - packed pyproc-control의 machine, cancel, automation, attachment 제품 게이트.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const frameBridge = await readFile(join(ROOT, "scripts", "automationSpace", "frameSpaceTarget.js"));
const targetServer = createServer((req, res) => {
  if (req.url === "/frameSpaceTarget.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(frameBridge);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body><h1 id=title>control-ready</h1><script src=/frameSpaceTarget.js></script></body></html>");
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
const configPath = join(installed.appDir, "pyproc-control.json");
const reloadConfigPath = join(installed.appDir, "pyproc-control-reload.json");
const browser = process.env.PYPROC_BROWSER || undefined;
await writeFile(configPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: TIMEOUT_MS,
  browser: {
    enabled: true,
    ...(browser ? { executable: browser } : {}),
    allowedOrigins: [targetOrigin],
    maxRisk: "externalEffect",
    actions: ["snapshot", "screenshot"],
    methods: [],
    externalEffects: "acknowledged",
    purpose: "control protocol product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
  },
}, null, 2));
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

const cli = binPath(installed.appDir, "pyproc-control");
const checkReport = JSON.parse(run(cli, ["--config", configPath, "--check"], { cwd: installed.appDir }).stdout);
check("installed pyproc-control preflight", checkReport.ok === true
  && checkReport.automation.actions.includes("screenshot") && !!checkReport.machineBrowser);

const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const clientFile = join(packageRoot, "scripts", "controlProtocol", "controlClient.js");
const { ControlRemoteError, ControlStdioClient } = await import(pathToFileURL(clientFile).href);
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

const script = join(packageRoot, "scripts", "pyprocControl.mjs");
const child = spawn(process.execPath, [script, "--config", configPath], {
  cwd: installed.appDir,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  const text = String(chunk);
  stderr = (stderr + text).slice(-8000);
  process.stderr.write(text);
});
const client = new ControlStdioClient({ readable: child.stdout, writable: child.stdin,
  peer: { name: "product-gate", version: "1" }, maxAttachmentChunkBytes: 64 });

console.log("installed pyproc-control product gate");
try {
  await Promise.race([
    client.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`control hello timeout\n${stderr}`)), TIMEOUT_MS)),
  ]);
  check("언어 중립 hello가 machine과 automation operation 14종을 선언",
    client.operations.length === 14 && client.operations.includes("machine.run")
      && client.operations.includes("automation.act"), client.operations.join(","));

  await client.request("machine.run", { code: "controlState = 40" });
  const machine = await client.request("machine.run", { code: "controlState + 2" });
  check("Control Protocol의 persistent Python Machine", machine.output.value === "42", machine.output.value);
  const space = await client.request("automation.space.inspect", {});
  check("설치 제품이 NativeCdpSpace 능력과 복원 경계를 선언",
    space.output.space?.providerKind === "nativeCdp"
      && space.output.space?.capabilities?.join(",") === "dom,network,target,storage,runtime,screenshot,artifact,perception"
      && space.output.space?.restoreBoundary === "externalEffectsRemain"
      && space.output.space?.replayBoundary === "recordOnly");
  let wrongSpace = null;
  try {
    await client.request("automation.space.inspect", {}, { spaceId: "space:wrong" });
  } catch (error) { wrongSpace = error; }
  check("request spaceId가 configured provider와 다르면 effect 전에 거부",
    wrongSpace instanceof ControlRemoteError && wrongSpace.code === "CONTROL_SPACE_MISMATCH"
      && wrongSpace.outcome === "notSent");

  const cancelId = "request:cancel";
  const cancelled = client.request("machine.run", {
    code: "import time\ncontrolEffect = 'applied'\ntime.sleep(1.0)",
  }, { requestId: cancelId });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await client.cancel(cancelId, "product gate cancellation");
  let cancelError = null;
  try { await cancelled; } catch (error) { cancelError = error; }
  check("전달 뒤 cancel이 결과 불명과 비재시도로 종결",
    cancelError instanceof ControlRemoteError && cancelError.code === "CONTROL_CANCELLED"
      && cancelError.outcome === "outcomeUnknown" && cancelError.retryable === false);
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const opened = await client.request("automation.target.open", {
    url: `${targetOrigin}/product`, expectedRisk: "externalEffect", waitUntil: "load",
  });
  const attached = await client.request("automation.session.attach", { targetRef: opened.output.targetRef });
  const perceived = await client.request("automation.observe", {
    sessionRef: attached.output,
    expectedRisk: "read",
    representation: "apx.graph",
    budget: { maxEntities: 40, maxRelations: 80, maxBytes: 65536 },
  });
  const perceptionGraph = perceived.output;
  check("언어 중립 protocol이 같은 APX graph와 conformance 경계를 반환",
    perceptionGraph.protocol === "apx"
      && perceptionGraph.profile.includes("apx-core/1")
      && perceptionGraph.entities.length > 0
      && !JSON.stringify(perceptionGraph).includes("backendNodeId"));
  const captured = await client.request("automation.act", {
    sessionRef: attached.output,
    actions: [{ kind: "screenshot", format: "png", expectedRisk: "read" }],
  });
  const attachment = captured.attachments[0];
  const bytes = Buffer.from(attachment.bytes);
  check("협상된 작은 chunk로 screenshot attachment가 terminal 전에 검증됨",
    captured.outcome === "observed" && captured.attachments.length === 1
      && attachment.mimeType === "image/png"
      && createHash("sha256").update(bytes).digest("hex") === attachment.sha256
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && !JSON.stringify(captured.output).includes("dataBase64"), `${bytes.byteLength} bytes`);
  await client.request("automation.session.detach", { sessionRef: attached.output });

  const duplicateId = "request:single-use";
  const first = await client.request("machine.run", { code: "6 * 7" }, { requestId: duplicateId });
  let duplicate = null;
  try { await client.request("machine.run", { code: "duplicateEffect = True" }, { requestId: duplicateId }); }
  catch (error) { duplicate = error; }
  const absent = await client.request("machine.run", { code: "'duplicateEffect' in globals()" });
  check("client가 request ID 재사용을 두 번째 effect 전에 거부",
    first.output.value === "42" && duplicate?.code === "CONTROL_REQUEST_DUPLICATE"
      && absent.output.value === "False");
} catch (error) {
  check("Control Protocol 제품 흐름 예외 없음", false, String(error?.stack || error).slice(-800));
} finally {
  client.close();
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => child.exitCode === null ? child.once("exit", resolve) : resolve());
  targetServer.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
