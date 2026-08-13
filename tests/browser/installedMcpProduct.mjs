// installedMcpProduct.mjs - packed pyproc-mcp command, Python machine, browser and artifacts in one gate.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const targetHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>installed product target</title></head>
<body style="margin:0;min-height:1800px;background:#f8fafc">
  <label>Title <input id="title" value="ready"></label>
  <button id="apply">Apply</button><output id="state">ready</output>
  <canvas id="chart" width="160" height="60" aria-label=""></canvas>
  <button id="verify">Verify</button><output id="verified" role="status">waiting</output>
  <script>
    console.info("installed-startup", "token=must-redact");
    document.getElementById("apply").addEventListener("click", () => {
      document.getElementById("state").textContent = document.getElementById("title").value;
    });
    document.getElementById("verify").addEventListener("click", async () => {
      const response = await fetch("/evidence", { method: "POST" });
      document.getElementById("verified").textContent = response.ok ? "verified" : "failed";
    });
    const context = document.getElementById("chart").getContext("2d");
    context.fillStyle = "#2563eb";
    context.fillRect(10, 10, 90, 35);
  </script>
</body></html>`;

const targetServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(targetHtml);
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

const installed = await installPackedPyProc("pyprocInstalledMcpProduct-");
const configPath = join(installed.appDir, ".pyproc-mcp-product", "manifest.json");
const browser = process.env.PYPROC_BROWSER || undefined;
const cli = binPath(installed.appDir, "pyproc-mcp");
const initArgs = ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
  "--out", ".pyproc-mcp-product", "--engine-root", join(ROOT, "vendor", "pyodide"),
  "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin, "--max-risk", "externalEffect",
  "--purpose", "installed-browser-automation-product-gate", "--acknowledge-effects",
  "--method", "Runtime.evaluate", "--viewport-width", "390", "--viewport-height", "844",
  "--device-scale-factor", "3", "--mobile", "--touch",
  "--artifact-max-bytes", String(16 * 1024 * 1024), "--artifact-total-bytes", String(32 * 1024 * 1024),
  "--artifact-max-count", "16", "--artifact-inline-bytes", String(4 * 1024 * 1024),
  "--artifact-ttl-ms", "120000",
  ...["snapshot", "screenshot", "waitFor", "hydrateLazy", "fill", "click"].flatMap((action) => ["--action", action]),
  ...(browser ? ["--browser", browser] : []),
];
const initializedProfile = JSON.parse(run(cli, initArgs, { cwd: installed.appDir }).stdout);
const versionRun = run(cli, ["--version"], { cwd: installed.appDir });
const helpRun = run(cli, ["--help"], { cwd: installed.appDir });
const checkRun = run(cli, ["--config", configPath, "--check"], { cwd: installed.appDir });
const checkReport = JSON.parse(checkRun.stdout);
check("installed bin help, version, check가 제품 시작 표면과 권한을 검증",
  initializedProfile.manifestPath === configPath
    && versionRun.stdout.trim() === installed.packed.version && helpRun.stdout.includes("--config <file>")
    && helpRun.stdout.includes("--check") && checkReport.ok === true
    && checkReport.browser.actions.includes("screenshot")
    && checkReport.browser.rawMethods.join(",") === "Runtime.evaluate"
    && checkReport.engine.mode === "root",
`${versionRun.stdout.trim()}, ${checkReport.browser.actions.length} actions`);

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
  check("설치 제품이 Python 4종과 browser 10종을 제공",
    tools.length === 14 && tools.includes("browserArtifactRead") && tools.includes("browserArtifactDelete"), tools.join(","));
  await callTool("pythonRun", { code: "product_state = 41" });
  const pythonResponse = await callTool("pythonRun", { code: "product_state + 1" });
  const python = toolText(pythonResponse);
  check("설치 제품의 persistent Python Machine과 canonical terminal",
    python.value === "42" && pythonResponse.result._meta?.pyprocControl?.terminal === "completed"
      && pythonResponse.result._meta?.pyprocControl?.outcome === "applied", python.value);

  const opened = toolText(await callTool("browserOpen", {
    url: targetUrl, expectedRisk: "externalEffect", waitUntil: "load",
  }));
  check("설치 제품 browserOpen이 viewport와 첫 navigation trace를 반환",
    opened.startup?.viewport?.width === 390
      && opened.startup?.network?.some((event) => event.phase === "request" && event.url === targetUrl)
      && opened.startup?.console?.some((event) => event.args?.includes("installed-startup"))
      && !JSON.stringify(opened.startup).includes("must-redact"));
  const sessionRef = toolText(await callTool("browserAttach", { targetRef: opened.targetRef }));
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

  const evidenced = toolText(await callTool("browserAct", {
    sessionRef,
    actions: [{ kind: "click", locatorRef: verifyEntity.locatorRef, expectedRisk: "externalEffect",
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
        clip: { x: 0, y: 0, width: 320, height: 180, scale: 1 }, expectedRisk: "read" },
    ],
  });
  const pipeline = toolText(pipelineResponse);
  const artifacts = pipeline.actions.slice(2).map((action) => action.result);
  check("설치 제품에서 effect 뒤 ordered screenshot 3종 생성",
    pipeline.actions.length === 5 && artifacts.map((artifact) => artifact.format).join(",") === "png,jpeg,webp"
      && artifacts.every((artifact) => artifact.artifactRef.startsWith("artifact:")),
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
  await callTool("browserDetach", { sessionRef });
} catch (error) {
  check("제품 흐름 예외 없음", false, String(error).slice(-500));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  targetServer.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
