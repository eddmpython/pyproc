// controlProtocolProduct.mjs - packed pyproc-control의 machine, cancel, automation, attachment 제품 게이트.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const targetServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body><h1 id=title>control-ready</h1></body></html>");
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

const cli = binPath(installed.appDir, "pyproc-control");
const checkReport = JSON.parse(run(cli, ["--config", configPath, "--check"], { cwd: installed.appDir }).stdout);
check("installed pyproc-control preflight", checkReport.ok === true
  && checkReport.automation.actions.includes("screenshot") && !!checkReport.machineBrowser);

const clientFile = join(installed.appDir, "node_modules", "pyproc", "scripts", "controlProtocol", "controlClient.js");
const { ControlRemoteError, ControlStdioClient } = await import(pathToFileURL(clientFile).href);
const script = join(installed.appDir, "node_modules", "pyproc", "scripts", "pyprocControl.mjs");
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
  peer: { name: "product-gate", version: "1" } });

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
  const captured = await client.request("automation.act", {
    sessionRef: attached.output,
    actions: [{ kind: "screenshot", format: "png", expectedRisk: "read" }],
  });
  const attachment = captured.attachments[0];
  const bytes = Buffer.from(attachment.bytes);
  check("screenshot descriptor와 binary attachment가 terminal 전에 검증됨",
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
