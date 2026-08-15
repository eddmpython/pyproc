// installedMcpProduct.mjs - packed pyproc-mcp command, Python machine, browser and artifacts in one gate.
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, run } from "../packageHarness.mjs";
import { publishVerifiedEffectPack } from "../effectTransactionFixtures.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const ARTIFACT_TTL_MS = 10 * 60 * 1000;
const targetHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>installed product target</title></head>
<body style="margin:0;min-height:1800px;background:#f8fafc">
  <label>Title <input id="title" value="ready"></label>
  <button id="apply">Apply</button><output id="state">ready</output>
  <canvas id="chart" width="160" height="60" aria-label=""></canvas>
  <button id="verify">Verify</button><output id="verified" role="status">waiting</output>
  <button id="commit">Commit</button><output id="committed" role="status">not committed</output>
  <script>
    console.info("installed-startup", "token=must-redact");
    document.getElementById("apply").addEventListener("click", () => {
      document.getElementById("state").textContent = document.getElementById("title").value;
    });
    document.getElementById("verify").addEventListener("click", async () => {
      const response = await fetch("/evidence", { method: "POST" });
      document.getElementById("verified").textContent = response.ok ? "verified" : "failed";
    });
    document.getElementById("commit").addEventListener("click", async () => {
      const response = await fetch("/effect", { method: "POST" });
      document.getElementById("committed").textContent = response.ok ? "effect committed" : "effect failed";
    });
    const context = document.getElementById("chart").getContext("2d");
    context.fillStyle = "#2563eb";
    context.fillRect(10, 10, 90, 35);
  </script>
</body></html>`;
const bootstrapInitialHtml = `<!doctype html><html><body><button>Continue</button><script>
  addEventListener("load", () => setTimeout(() => location.replace("/bootstrap-final"), 1000));
</script></body></html>`;
const bootstrapFinalHtml = `<!doctype html><html><body><button id="continue">Continue</button>
  <output role="status">ready</output><script>
  document.querySelector("#continue").addEventListener("click", async () => {
    const response = await fetch("/bootstrap-effect", { method: "POST" });
    document.querySelector("output").textContent = response.ok ? "done" : "failed";
  });
</script></body></html>`;
const semanticInventoryHtml = `<!doctype html><html><body><h1>Semantic inventory</h1><section id="inventory"></section>
  <output>ready:1001</output><script>{const fragment=document.createDocumentFragment();
  for(let index=0;index<1001;index+=1){const button=document.createElement('button');button.type='button';
    button.textContent='inventory-'+String(index).padStart(4,'0');fragment.append(button)}
  document.querySelector('#inventory').append(fragment);console.info('semantic-inventory-ready',1001)}</script></body></html>`;

let committedEffects = 0;
let bootstrapEffects = 0;
const targetServer = createServer((req, res) => {
  if (req.url === "/effect" && req.method === "POST") {
    committedEffects += 1;
    res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ committedEffects }));
    return;
  }
  if (req.url === "/bootstrap-effect" && req.method === "POST") {
    bootstrapEffects += 1;
    res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ bootstrapEffects }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(req.url === "/bootstrap-initial" ? bootstrapInitialHtml
    : req.url === "/bootstrap-final" ? bootstrapFinalHtml
      : req.url?.startsWith("/semantic-inventory") ? semanticInventoryHtml : targetHtml);
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;
const targetUrl = `${targetOrigin}/product`;

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const samePath = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const values = [left, right].map((value) => {
    const absolute = resolve(value);
    return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
  });
  return process.platform === "win32"
    ? values[0].toLowerCase() === values[1].toLowerCase()
    : values[0] === values[1];
};

const installed = await installPackedPyProc("pyprocInstalledMcpProduct-");
const configPath = join(installed.appDir, ".pyproc-mcp-product", "manifest.json");
const memoryRoot = join(installed.appDir, ".pyproc-mcp-memory");
const approvalKeyFile = join(memoryRoot, "approval-public.pem");
const approvalPair = generateKeyPairSync("ed25519");
await mkdir(memoryRoot, { recursive: true });
await writeFile(approvalKeyFile, approvalPair.publicKey.export({ type: "spki", format: "pem" }));
const { createApprovalGrant } = await import(pathToFileURL(join(installed.appDir, "node_modules", "pyproc",
  "scripts", "controlProtocol", "controlApi.js")).href);
const { createEvidencePack, publishEvidencePack } = await import(pathToFileURL(join(installed.appDir,
  "node_modules", "pyproc", "scripts", "verification", "evidencePack.js")).href);
const browser = process.env.PYPROC_BROWSER || undefined;
const cli = binPath(installed.appDir, "pyproc-mcp");
const initArgs = ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
  "--out", ".pyproc-mcp-product",
  "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin, "--max-risk", "externalEffect",
  "--purpose", "installed-browser-automation-product-gate", "--acknowledge-effects",
  "--method", "Runtime.evaluate", "--viewport-width", "390", "--viewport-height", "844",
  "--device-scale-factor", "3", "--mobile", "--touch",
  "--artifact-max-bytes", String(16 * 1024 * 1024), "--artifact-total-bytes", String(32 * 1024 * 1024),
  "--artifact-max-count", "16", "--artifact-inline-bytes", String(4 * 1024 * 1024),
  "--artifact-ttl-ms", String(ARTIFACT_TTL_MS),
  "--execution-memory-root", memoryRoot,
  "--enable-effect-transactions", "--effect-approval-authority", `operator:mcp-product=${approvalKeyFile}`,
  ...["snapshot", "screenshot", "waitFor", "hydrateLazy", "fill", "click", "navigate"]
    .flatMap((action) => ["--action", action]),
  ...(browser ? ["--browser", browser] : []),
];
const initializedProfile = JSON.parse(run(cli, initArgs, { cwd: installed.appDir }).stdout);
const controlCli = binPath(installed.appDir, "pyproc-control");
const doctorReport = JSON.parse(run(controlCli, ["doctor", "--config", configPath],
  { cwd: installed.appDir }).stdout);
const versionRun = run(cli, ["--version"], { cwd: installed.appDir });
const helpRun = run(cli, ["--help"], { cwd: installed.appDir });
const checkRun = run(cli, ["--config", configPath, "--check"], { cwd: installed.appDir });
const checkReport = JSON.parse(checkRun.stdout);
const unknownRecipeOutput = join(installed.appDir, ".pyproc-unknown-recipe");
let unknownRecipeError = null;
try {
  run(cli, ["init", "--recipe", "unknownRecipe", "--project-root", installed.appDir,
    "--out", ".pyproc-unknown-recipe"], { cwd: installed.appDir });
} catch (error) { unknownRecipeError = error; }
check("installed bin help, version, check가 제품 시작 표면과 권한을 검증",
  samePath(initializedProfile.manifestPath, configPath)
    && versionRun.stdout.trim() === installed.packed.version && helpRun.stdout.includes("--config <file>")
    && helpRun.stdout.includes("pyproc-mcp init --recipe") && helpRun.stdout.includes("--check") && checkReport.ok === true
    && checkReport.browser.actions.includes("screenshot")
    && checkReport.executionMemory?.enabled === true
    && samePath(checkReport.executionMemory?.root, memoryRoot)
    && checkReport.effectTransactions?.enabled === true
    && checkReport.browser.rawMethods.join(",") === "Runtime.evaluate"
    && checkReport.engine.mode === "root"
    && initializedProfile.engine?.source === "packageDefault"
    && samePath(initializedProfile.engine?.root, join(installed.appDir, "node_modules", "pyproc",
      "src", "runtime", "engines", "wasi", "owned", "core")),
`${versionRun.stdout.trim()}, ${checkReport.browser.actions.length} actions`);
check("installed init가 unknown recipe를 쓰기 전에 거부",
  unknownRecipeError?.message.includes("recipe must be one of") && !existsSync(unknownRecipeOutput));

const installedScript = join(installed.appDir, "node_modules", "pyproc", "scripts", "pyprocMcp.mjs");
const child = spawn(process.execPath, [installedScript, "--config", configPath], {
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

const waiters = new Map();
let requestSeq = 0;
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch (error) { return; }
  const waiter = waiters.get(message.id);
  if (waiter) { waiters.delete(message.id); waiter(message); }
});

function request(method, params = {}) {
  const id = ++requestSeq;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`${method} timeout\n${stderr}`));
    }, TIMEOUT_MS);
    waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
  });
}

const callTool = (name, args = {}) => request("tools/call", { name, arguments: args });
const toolText = (message) => JSON.parse(message.result.content[0].text);

async function readArtifact(artifactRef) {
  const chunks = [];
  let offset = 0;
  let descriptor = null;
  for (;;) {
    descriptor = toolText(await callTool("browserArtifactRead", { artifactRef, offset, maxBytes: 2048 }));
    chunks.push(Buffer.from(descriptor.dataBase64, "base64"));
    offset = descriptor.nextOffset;
    if (descriptor.eof) return { descriptor, bytes: Buffer.concat(chunks) };
  }
}

console.log("installed pyproc-mcp product gate");
try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "installed-product-gate", version: "1" },
  });
  check("installed server initialize", initialized.result?.serverInfo?.name === "pyproc-sandbox");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = (await request("tools/list")).result.tools.map((tool) => tool.name);
  check("설치 제품이 Python, browser, Execution Memory, Rehearse-Commit operation을 함께 제공",
    tools.length === 36 && tools.includes("browserArtifactRead") && tools.includes("browserArtifactDelete")
      && tools.includes("browserClose")
      && tools.includes("machineImageExport") && tools.includes("memoryCreate") && tools.includes("memoryImport")
      && tools.includes("eyesAudit") && tools.includes("eyesVerify") && tools.includes("eyesReplay")
      && tools.includes("effectPrepare") && tools.includes("effectCommit") && tools.includes("effectSeal"), tools.join(","));
  const firstResult = doctorReport.next.firstResult;
  const firstMachine = toolText(await callTool(firstResult.mcp.tool, firstResult.mcp.arguments));
  check("doctor의 MCP 다음 행동이 canonical Machine 첫 결과를 실행",
    firstResult.operation === "machine.run" && firstResult.input.code === "40 + 2"
      && firstResult.mcp.serverArguments[1] === configPath && firstMachine.value === "42");
  await callTool("pythonRun", { code: "product_state = 41" });
  const pythonResponse = await callTool("pythonRun", { code: "product_state + 1" });
  const python = toolText(pythonResponse);
  check("설치 제품의 persistent Python Machine과 canonical terminal",
    python.value === "42" && pythonResponse.result._meta?.pyprocControl?.terminal === "completed"
      && pythonResponse.result._meta?.pyprocControl?.outcome === "applied", python.value);

  const projectIdentity = { workspaceId: "installed:mcp", commit: "fixture",
    treeSha256: `sha256:${"1".repeat(64)}`, diffSha256: `sha256:${"2".repeat(64)}`, untracked: false };
  const memoryCreated = toolText(await callTool("memoryCreate", {
    executionSessionId: "session:installed-mcp", project: projectIdentity,
  }));
  const memoryOpened = toolText(await callTool("memoryOpen", {
    executionSessionId: "session:installed-mcp",
  }));
  const memoryListed = toolText(await callTool("memoryList"));
  check("설치 MCP가 실제 Machine image를 immutable Execution Memory로 다시 연다",
    memoryCreated.contentSha256 === memoryOpened.contentSha256
      && /^[0-9a-f]{64}$/.test(memoryOpened.machine?.imageSha256 || "")
      && typeof memoryOpened.machine?.generation === "string"
      && memoryListed.some((entry) => entry.executionSessionId === "session:installed-mcp")
      && memoryOpened.machine?.lifecycle === "portable",
  memoryOpened.contentSha256);

  const opened = toolText(await callTool("browserOpen", {
    url: targetUrl, expectedRisk: "externalEffect", waitUntil: "load",
  }));
  check("설치 제품 browserOpen이 viewport와 첫 navigation trace를 반환",
    opened.startup?.viewport?.width === 390
      && opened.startup?.network?.some((event) => event.phase === "request" && event.url === targetUrl)
      && opened.startup?.console?.some((event) => event.args?.includes("installed-startup"))
      && !JSON.stringify(opened.startup).includes("must-redact"));
  const sessionRef = toolText(await callTool("browserAttach", { targetRef: opened.targetRef }));
  const inventoryOpened = toolText(await callTool("browserOpen", {
    url: `${targetOrigin}/semantic-inventory`, expectedRisk: "externalEffect", waitUntil: "load",
  }));
  const inventorySession = toolText(await callTool("browserAttach", { targetRef: inventoryOpened.targetRef }));
  const inventoryPages = [];
  const inventoryResponses = [];
  let inventoryResponse = await callTool("browserObserve", {
    sessionRef: inventorySession, expectedRisk: "read", mode: "all", maxNodes: 400,
    includeScreenshot: true, includeConsole: true,
  });
  let inventoryPage = toolText(inventoryResponse);
  inventoryResponses.push(inventoryResponse);
  inventoryPages.push(inventoryPage.result);
  while (inventoryPage.result.continuationRef) {
    inventoryResponse = await callTool("browserObserve", { sessionRef: inventorySession, expectedRisk: "read",
      continuationRef: inventoryPage.result.continuationRef });
    inventoryPage = toolText(inventoryResponse);
    inventoryResponses.push(inventoryResponse);
    inventoryPages.push(inventoryPage.result);
  }
  const inventoryNodes = inventoryPages.flatMap((page) => page.nodes);
  const inventoryNames = inventoryNodes.filter((node) => node.role === "button"
    && typeof node.name === "string" && node.name.startsWith("inventory-")).map((node) => node.name);
  const inventoryFirst = inventoryPages[0];
  const inventoryLast = inventoryPages.at(-1);
  check("설치 MCP가 같은 snapshot의 대형 의미 inventory와 화면 증거를 누락 없이 순회",
    inventoryPages.length >= 3 && inventoryNames.length === 1001 && new Set(inventoryNames).size === 1001
      && inventoryNodes.length === inventoryLast.inventory.total
      && inventoryLast.inventory.complete === true
      && inventoryLast.inventory.prefixSha256 === inventoryLast.inventory.nodesSha256
      && inventoryPages.every((page) => page.inventory.receiptSha256 === inventoryFirst.inventory.receiptSha256)
      && inventoryResponses[0].result.content.some((entry) => entry.type === "image")
      && typeof inventoryLast.inventory.evidence.console?.sha256 === "string"
      && inventoryFirst.screenshot.sha256 === inventoryLast.inventory.evidence.screenshot.sha256,
  `${inventoryPages.length} pages, ${inventoryNames.length}/${inventoryNodes.length}`);
  const inventoryStaleFirst = toolText(await callTool("browserObserve", {
    sessionRef: inventorySession, expectedRisk: "read", mode: "all", maxNodes: 500,
  }));
  await callTool("browserAct", { sessionRef: inventorySession, actions: [{ kind: "navigate",
    url: `${targetOrigin}/semantic-inventory?epoch=2`, expectedRisk: "externalEffect" }] });
  const inventoryStale = await callTool("browserObserve", { sessionRef: inventorySession, expectedRisk: "read",
    continuationRef: inventoryStaleFirst.result.continuationRef });
  check("설치 MCP가 document epoch 교체 뒤 partial inventory를 stale로 거부",
    inventoryStale.result?.isError === true
      && toolText(inventoryStale).code === "AUTOMATION_OBSERVATION_CONTINUATION_STALE"
      && toolText(inventoryStale).outcome === "notSent");
  await callTool("browserArtifactDelete", { artifactRef: inventoryFirst.screenshot.artifactRef });
  await callTool("browserDetach", { sessionRef: inventorySession });
  await callTool("browserClose", { targetRef: inventoryOpened.targetRef, expectedRisk: "externalEffect" });
  const apxResponse = await callTool("browserObserve", {
    sessionRef,
    expectedRisk: "read",
    representation: "apx.graph",
    visual: { mode: "auto", maxCrops: 2 },
    budget: { maxEntities: 80, maxRelations: 160, maxBytes: 131072 },
  });
  const apx = toolText(apxResponse);
  const verifyEntity = apx.entities.find((entity) => entity.semantic?.name === "Verify");
  const apxImages = apxResponse.result.content.filter((entry) => entry.type === "image");
  check("설치 MCP가 APX semantic, spatial, temporal graph와 pixel-on-demand를 반환",
    apx.protocol === "apx"
      && apx.kind === "full"
      && verifyEntity?.locatorRef?.startsWith("locator:")
      && apx.visualProbes.some((probe) => probe.reason === "canvas")
      && apxImages.length >= 1
      && !apxResponse.result.content[0].text.includes("dataBase64")
      && !JSON.stringify(apx).includes("backendNodeId"));
  const situation = toolText(await callTool("browserObserve", {
    sessionRef,
    expectedRisk: "read",
    representation: "apx.situation",
    focus: { objective: "Verify and prove the accepted state", requirements: [{
      requirementRef: "requirement:verify", select: { role: "button", name: "Verify", actionable: true },
      need: ["fact", "affordance"], cardinality: "one",
    }] },
    visual: { mode: "off" },
    budget: { maxEntities: 80, maxRelations: 160, maxBytes: 131072 },
  }));
  const verifyAffordance = situation.affordances.find((entry) =>
    entry.kind === "authorized" && entry.requirementRef === "requirement:verify" && entry.action === "click");
  check("설치 MCP가 같은 browserObserve에서 SituationCapsule과 broker capability를 반환",
    situation.situationRef?.startsWith("situation:") && situation.worldRef?.startsWith("world:")
      && verifyAffordance?.capabilityRef?.startsWith("capability:")
      && situation.visualProbes === undefined);

  const evidenced = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{ kind: "click", locatorRef: verifyAffordance.locatorRef, expectedRisk: "externalEffect",
      actionContext: { intent: "Verify the installed product", situationRef: situation.situationRef,
        worldRef: situation.worldRef, capabilityRef: verifyAffordance.capabilityRef,
        expectedTransition: verifyAffordance.expectedTransition },
      verify: { all: [
        { entityAppeared: { role: "status", nameContains: "verified" } },
        { networkResponse: { method: "POST", urlPath: "/evidence", status: 200 } },
      ], withinMs: 5000 } }],
  }));
  check("설치 MCP의 EvidenceLoop가 실제 DOM과 network postcondition을 함께 확인",
    evidenced.actions[0].result.evidence?.effectOutcome === "applied"
      && evidenced.actions[0].result.evidence?.verification?.state === "confirmed"
      && evidenced.actions[0].result.evidence?.verification?.evidenceRefs?.length >= 2);

  const pipelineResponse = await callTool("browserAct", {
    sessionRef,
    actions: [
      { kind: "fill", selector: "#title", value: "installed-ready", expectedRisk: "externalEffect" },
      { kind: "click", selector: "#apply", expectedRisk: "externalEffect" },
      { kind: "screenshot", format: "png", expectedRisk: "read" },
      { kind: "screenshot", format: "jpeg", quality: 75, fullPage: true, expectedRisk: "read" },
      { kind: "screenshot", format: "webp", quality: 70,
        clip: { x: 0, y: 0, width: 320, height: 180 }, expectedRisk: "read" },
    ],
  });
  const pipeline = toolText(pipelineResponse);
  const artifacts = pipeline.actions.slice(2).map((action) => action.result);
  check("설치 제품에서 effect 뒤 ordered screenshot 3종 생성",
    pipeline.actions.length === 5 && artifacts.map((artifact) => artifact.format).join(",") === "png,jpeg,webp"
      && artifacts.every((artifact) => artifact.artifactRef.startsWith("artifact:"))
      && artifacts[2].cssWidth === 320 && artifacts[2].cssHeight === 180,
  artifacts.map((artifact) => `${artifact.format}:${artifact.byteLength}`).join(", "));
  const nativeImages = pipelineResponse.result.content.filter((entry) => entry.type === "image");
  check("설치 제품 screenshot이 artifact와 ordered native image를 함께 반환",
    nativeImages.map((entry) => entry.mimeType).join(",") === "image/png,image/jpeg,image/webp"
      && !pipelineResponse.result.content[0].text.includes("dataBase64")
      && Buffer.from(nativeImages[0].data, "base64").subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && Buffer.from(nativeImages[1].data, "base64")[0] === 0xff
      && Buffer.from(nativeImages[2].data, "base64").subarray(0, 4).toString("ascii") === "RIFF",
  nativeImages.map((entry) => `${entry.mimeType}:${entry.data.length}`).join(", "));
  check("MCP terminal metadata가 Control outcome과 attachment digest를 보존",
    pipelineResponse.result._meta?.pyprocControl?.terminal === "completed"
      && pipelineResponse.result._meta?.pyprocControl?.outcome === "applied"
      && pipelineResponse.result._meta?.pyprocControl?.attachments.length === 3
      && pipelineResponse.result._meta.pyprocControl.attachments.every((entry, index) => entry.sha256 === artifacts[index].sha256));
  const state = toolText(await callTool("browserCommand", {
    sessionRef,
    method: "Runtime.evaluate",
    params: { expression: "document.querySelector('#state').textContent", returnByValue: true },
    expectedRisk: "externalEffect",
  }));
  check("ordered pipeline의 fill과 click이 screenshot 전에 적용", state.result?.result?.value === "installed-ready");

  const effectTransition = { all: [
    { entityAppeared: { role: "status", nameContains: "effect committed" } },
    { networkResponse: { method: "POST", urlPath: "/effect", status: 201 } },
  ], withinMs: 5000 };
  const effectPrepared = toolText(await callTool("effectPrepare", {
    transactionId: "effect:mcp-product", intentId: "intent:mcp-product",
    executionSessionId: "session:installed-mcp", expectedSessionRevisionSha256: memoryCreated.contentSha256,
    destination: { origin: targetOrigin, subjectSha256: createHash("sha256").update("mcp-product").digest("hex"),
      purpose: "Commit the exact installed MCP fixture" },
    effectTemplate: { sessionRef, focus: { requirements: [{ requirementRef: "requirement:commit",
      select: { role: "button", name: "Commit", actionable: true }, need: ["fact", "affordance"],
      cardinality: "one" }] }, actions: [{ kind: "click", requirementRef: "requirement:commit",
      expectedRisk: "externalEffect", verify: effectTransition }] }, expectedTransition: effectTransition,
  }));
  if (!effectPrepared?.transaction) throw new Error(`effectPrepare failed: ${JSON.stringify(effectPrepared)}`);
  const effectRehearsed = toolText(await callTool("effectRehearse", { transactionId: "effect:mcp-product",
    expectedRevisionSha256: effectPrepared.transaction.contentSha256, mode: "computed", code: "6 * 7",
    expectedValue: "42" }));
  if (!effectRehearsed?.intent) throw new Error(`effectRehearse failed: ${JSON.stringify(effectRehearsed)}`);
  const effectGrant = createApprovalGrant({ intent: effectRehearsed.intent, authorityId: "operator:mcp-product",
    trustDomainSha256: effectPrepared.trustDomain.trustDomainSha256,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), nonce: "nonce:mcp-product",
    policyVersion: "mcp-product/1" }, approvalPair.privateKey);
  const effectApproved = toolText(await callTool("effectApprove", { transactionId: "effect:mcp-product",
    expectedRevisionSha256: effectRehearsed.contentSha256, grant: effectGrant }));
  if (!effectApproved?.contentSha256) throw new Error(`effectApprove failed: ${JSON.stringify(effectApproved)}`);
  const effectTerminal = toolText(await callTool("effectCommit", { transactionId: "effect:mcp-product",
    expectedRevisionSha256: effectApproved.contentSha256 }));
  if (!effectTerminal?.contentSha256) throw new Error(`effectCommit failed: ${JSON.stringify(effectTerminal)}`);
  const effectRetried = toolText(await callTool("effectCommit", { transactionId: "effect:mcp-product",
    expectedRevisionSha256: effectTerminal.contentSha256 }));
  const effectListed = toolText(await callTool("effectList"));
  const effectInspected = toolText(await callTool("effectInspect", { transactionId: "effect:mcp-product" }));
  const effectEvidence = await publishVerifiedEffectPack({ createEvidencePack, publishEvidencePack,
    repositoryRoot: memoryRoot, outputDir: "packs/effect-mcp-product", repository: projectIdentity,
    projectId: "mcp-product", transaction: effectTerminal });
  const effectSealed = toolText(await callTool("effectSeal", { transactionId: "effect:mcp-product",
    expectedRevisionSha256: effectTerminal.contentSha256, evidencePackDir: effectEvidence.outputDir }));
  check("설치 MCP가 approved effect를 한 번만 보내고 terminal evidence를 보존",
    committedEffects === 1 && effectTerminal.state === "terminal"
      && effectTerminal.effectResult?.terminal === "confirmed"
      && effectTerminal.effectResult?.actionEvidence?.length === 1,
  JSON.stringify({ committedEffects, state: effectTerminal.state, terminal: effectTerminal.effectResult?.terminal,
    actionEvidence: effectTerminal.effectResult?.actionEvidence?.length }));
  check("설치 MCP effect 재호출과 조회가 terminal revision을 바꾸지 않는다",
    effectRetried.contentSha256 === effectTerminal.contentSha256
      && effectListed.some((entry) => entry.transactionId === "effect:mcp-product")
      && effectInspected.transaction.contentSha256 === effectTerminal.contentSha256,
  JSON.stringify({ terminal: effectTerminal.contentSha256, retried: effectRetried.contentSha256,
    inspected: effectInspected.transaction.contentSha256 }));
  check("설치 MCP effect가 검증된 Evidence Pack으로 봉인된다",
    effectSealed.state === "sealed" && effectSealed.receipt?.evidencePackSha256 === effectEvidence.contentSha256,
  JSON.stringify({ state: effectSealed.state, receipt: effectSealed.receipt?.evidencePackSha256,
    evidence: effectEvidence.contentSha256 }));
  const wrongMemory = toolText(await callTool("memoryCreate", { executionSessionId: "session:mcp-destination",
    project: projectIdentity }));
  const wrongPrepared = toolText(await callTool("effectPrepare", {
    transactionId: "effect:mcp-destination", intentId: "intent:mcp-destination",
    executionSessionId: "session:mcp-destination", expectedSessionRevisionSha256: wrongMemory.contentSha256,
    destination: { origin: "https://wrong.example", subjectSha256: createHash("sha256")
      .update("wrong-destination").digest("hex"), purpose: "Reject a changed live destination" },
    effectTemplate: { sessionRef, focus: { requirements: [{ requirementRef: "requirement:commit",
      select: { role: "button", name: "Commit", actionable: true }, need: ["fact", "affordance"],
      cardinality: "one" }] }, actions: [{ kind: "click", requirementRef: "requirement:commit",
      expectedRisk: "externalEffect", verify: effectTransition }] }, expectedTransition: effectTransition,
  }));
  if (!wrongPrepared?.transaction) throw new Error(`wrong effectPrepare failed: ${JSON.stringify(wrongPrepared)}`);
  const wrongRehearsed = toolText(await callTool("effectRehearse", { transactionId: "effect:mcp-destination",
    expectedRevisionSha256: wrongPrepared.transaction.contentSha256, mode: "computed", code: "6 * 7",
    expectedValue: "42" }));
  if (!wrongRehearsed?.intent) throw new Error(`wrong effectRehearse failed: ${JSON.stringify(wrongRehearsed)}`);
  const wrongGrant = createApprovalGrant({ intent: wrongRehearsed.intent, authorityId: "operator:mcp-product",
    trustDomainSha256: wrongPrepared.trustDomain.trustDomainSha256,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), nonce: "nonce:mcp-destination",
    policyVersion: "mcp-product/1" }, approvalPair.privateKey);
  const wrongApproved = toolText(await callTool("effectApprove", { transactionId: "effect:mcp-destination",
    expectedRevisionSha256: wrongRehearsed.contentSha256, grant: wrongGrant }));
  const wrongCommitMessage = await callTool("effectCommit", { transactionId: "effect:mcp-destination",
    expectedRevisionSha256: wrongApproved.contentSha256 });
  check("승인 뒤 live target origin이 바뀌면 CommitLease 전에 거부",
    wrongCommitMessage.result?.isError === true && toolText(wrongCommitMessage).code === "EFFECT_DESTINATION_MISMATCH"
      && committedEffects === 1);

  const read = await Promise.all(artifacts.map((artifact) => readArtifact(artifact.artifactRef)));
  check("설치 제품 artifact chunk, digest, PNG/JPEG/WebP signature",
    read.every((entry, index) => createHash("sha256").update(entry.bytes).digest("hex") === artifacts[index].sha256)
      && read[0].bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && read[1].bytes[0] === 0xff && read[1].bytes[1] === 0xd8
      && read[2].bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && read[2].bytes.subarray(8, 12).toString("ascii") === "WEBP");
  const deleted = toolText(await callTool("browserArtifactDelete", { artifactRef: artifacts[0].artifactRef }));
  const stale = await callTool("browserArtifactRead", { artifactRef: artifacts[0].artifactRef });
  check("설치 제품 artifact 삭제와 stale ref 오류",
    deleted.deleted === true && stale.result?.isError === true
      && toolText(stale).code === "BROWSER_AUTOMATION_ARTIFACT_NOT_FOUND");

  const bootstrapOpened = toolText(await callTool("browserOpen", {
    url: `${targetOrigin}/bootstrap-initial`, expectedRisk: "externalEffect", waitUntil: "load",
  }));
  const bootstrapSession = toolText(await callTool("browserAttach", { targetRef: bootstrapOpened.targetRef }));
  const bootstrapSituation = toolText(await callTool("browserObserve", {
    sessionRef: bootstrapSession, expectedRisk: "read", representation: "apx.situation",
    focus: { requirements: [{ requirementRef: "requirement:continue",
      select: { role: "button", name: "Continue", actionable: true },
      need: ["fact", "affordance"], cardinality: "one" }] },
    visual: { mode: "off" },
  }));
  const bootstrapAffordance = bootstrapSituation.affordances.find((entry) =>
    entry.kind === "authorized" && entry.requirementRef === "requirement:continue" && entry.action === "click");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
  const bootstrapActed = toolText(await callTool("browserAct", {
    sessionRef: bootstrapSession,
    actions: [{ kind: "click", locatorRef: bootstrapAffordance.locatorRef, expectedRisk: "externalEffect",
      actionContext: { situationRef: bootstrapSituation.situationRef, worldRef: bootstrapSituation.worldRef,
        capabilityRef: bootstrapAffordance.capabilityRef },
      verify: { entityAppeared: { role: "status", name: "done" }, withinMs: 5000 } }],
  }));
  check("첫 load 뒤 문서 교체가 새 Situation 재발급과 한 번의 verified effect로 수렴",
    bootstrapActed.actions[0].convergence?.reason === "documentReplacement"
      && bootstrapActed.actions[0].convergence?.attempts === 2
      && bootstrapActed.actions[0].convergence?.effectRetries === 0
      && bootstrapActed.actions[0].result.evidence?.verification?.state === "confirmed"
      && bootstrapEffects === 1);
  await callTool("browserDetach", { sessionRef: bootstrapSession });
  await callTool("browserClose", { targetRef: bootstrapOpened.targetRef, expectedRisk: "externalEffect" });
  await callTool("browserDetach", { sessionRef });
} catch (error) {
  check("제품 흐름 예외 없음", false, String(error?.stack || error).slice(-1200));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  targetServer.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
