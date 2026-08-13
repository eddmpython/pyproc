// actuationProduct.mjs - installed browser Motor의 exact bind, one-shot effect, receipt, client parity gate.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
let effects = 0;
const fixture = createServer((req, res) => {
  if (req.url === "/save" && req.method === "POST") {
    effects += 1;
    res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ effects }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html><body>
    <button id="save">Save</button><input id="keep" type="checkbox" aria-label="Keep" checked>
    <button>Duplicate</button><button>Duplicate</button>
    <script>document.getElementById("save").addEventListener("click", async () => {
      const response = await fetch("/save", { method: "POST" });
      const status = document.createElement("p"); status.setAttribute("role", "status");
      status.textContent = response.ok ? "saved" : "failed"; document.body.append(status);
    });</script></body></html>`);
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}

const installed = await installPackedPyProc("pyprocActuation-");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const memoryRoot = join(installed.appDir, ".motor-memory");
const configPath = join(installed.appDir, "pyproc-motor.json");
await mkdir(memoryRoot, { recursive: true });
await writeFile(configPath, JSON.stringify({ schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") }, timeoutMs: TIMEOUT_MS,
  browser: { enabled: true, provider: "nativeCdp", ...(process.env.PYPROC_BROWSER
    ? { executable: process.env.PYPROC_BROWSER } : {}), allowedOrigins: [origin], maxRisk: "externalEffect",
    actions: ["snapshot", "click", "check", "uncheck"], methods: [], externalEffects: "acknowledged",
    purpose: "Verify the installed proof-carrying Motor fixture", artifacts: {} },
  executionMemory: { enabled: true, root: memoryRoot, importRoots: [], secretEnv: [] },
  actuation: { enabled: true },
}, null, 2));

const controlCli = binPath(installed.appDir, "pyproc-control");
const preflight = JSON.parse(run(controlCli, ["--config", configPath, "--check"], { cwd: installed.appDir }).stdout);
check("preflight enables browser-only Motor with one durable root",
  preflight.ok === true && preflight.actuation?.enabled === true
    && preflight.executionMemory?.enabled === true && preflight.automation?.provider === "nativeCdp");

const { ControlRemoteError, PyProcControlClient } = await import(pathToFileURL(join(packageRoot,
  "scripts", "controlProtocol", "controlApi.js")).href);
const controlScript = join(packageRoot, "scripts", "pyprocControl.mjs");
const client = await PyProcControlClient.start(configPath, { command: [process.execPath, controlScript],
  cwd: installed.appDir, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
let clientClosed = false;
let mcpChild = null;
console.log("installed Proof-Carrying Motor product gate");
try {
  const inspectedSpace = await client.inspectSpace();
  const motorSpaceRef = inspectedSpace.output.space.spaceId;
  const target = await client.openTarget(`${origin}/fixture`, { expectedRisk: "externalEffect" });
  const session = await client.attachSession(target.output.targetRef);
  const sessionRef = session.output;
  const observe = (requirementRef, role, name) => client.observe(sessionRef, { expectedRisk: "read",
    representation: "apx.situation", focus: { requirements: [{ requirementRef,
      select: { role, name }, need: ["fact", "affordance"], cardinality: "one" }] },
    visual: { mode: "off" }, budget: { maxEntities: 100, maxRelations: 200, maxBytes: 131072 } });
  const saveSituation = (await observe("requirement:save", "button", "Save")).output;
  const saveRequirement = saveSituation.requirements[0];
  const saveAffordance = saveSituation.affordances.find((entry) => entry.kind === "authorized"
    && entry.action === "click");
  const freshForMs = Date.parse(saveAffordance.expiresAt) - Date.now();
  check("observed Motor authority is fresh when returned to the caller", freshForMs > 0,
    `freshForMs=${freshForMs}`);
  const intent = { intent: "activate", target: { spaceRef: motorSpaceRef,
    entityRef: saveRequirement.entityRefs[0], worldRef: saveSituation.worldRef,
    surfaceEpoch: `document:${saveSituation.documentEpoch}` }, desired: { activated: true }, preconditions: [],
  expectedTransition: { all: [
    { entityAppeared: { role: "status", name: "saved" } },
    { networkResponse: { method: "POST", urlPath: "/save", status: 201 } },
  ], withinMs: 5000 }, authority: { actionCapabilityRef: saveAffordance.capabilityRef,
    approvalGrantRef: null, commitLeaseRef: null, controlLeaseRef: null },
  policy: { allowedActuatorKinds: ["browserInput"], allowPreContactFallback: false } };
  const executed = await client.executeMotor({ sessionRef, situation: saveSituation,
    requirementRef: "requirement:save", intent }, { timeoutMs: TIMEOUT_MS });
  const receiptSha256 = executed.output.receipt.receiptSha256;
  check("absolute intent sends one provider effect and closes with semantic plus network proof",
    effects === 1 && executed.output.terminal === "confirmed"
      && executed.output.receipt.effectWindow.providerCalls === 1
      && executed.output.receipt.actionEvidenceRef?.startsWith("evidence:"));
  check("public Motor output carries no locator, coordinate, or provider handle",
    !/locator:|backendNode|objectId|"x"\s*:|"y"\s*:/.test(JSON.stringify(executed.output)));

  const selectedSituation = (await observe("requirement:keep", "checkbox", "Keep")).output;
  const selectedAffordance = selectedSituation.affordances.find((entry) => entry.kind === "authorized"
    && entry.action === "check");
  const selected = await client.executeMotor({ sessionRef, situation: selectedSituation,
    requirementRef: "requirement:keep", intent: { intent: "setSelected", target: {
      spaceRef: motorSpaceRef, entityRef: selectedSituation.requirements[0].entityRefs[0],
      worldRef: selectedSituation.worldRef, surfaceEpoch: `document:${selectedSituation.documentEpoch}` },
    desired: { selected: true }, preconditions: [], expectedTransition: {}, authority: {
      actionCapabilityRef: selectedAffordance.capabilityRef, approvalGrantRef: null,
      commitLeaseRef: null, controlLeaseRef: null }, policy: { allowedActuatorKinds: ["browserInput"],
      allowPreContactFallback: false } } }, { timeoutMs: TIMEOUT_MS });
  check("already-satisfied desired state closes with zero provider effects",
    selected.output.terminal === "alreadySatisfied"
      && selected.output.receipt.effectWindow.providerCalls === 0 && effects === 1,
    `terminal=${selected.output.terminal}, providerCalls=${selected.output.receipt.effectWindow.providerCalls}, effects=${effects}`);

  const ambiguousSituation = (await observe("requirement:duplicate", "button", "Duplicate")).output;
  let ambiguousError = null;
  try {
    await client.executeMotor({ sessionRef, situation: ambiguousSituation,
      requirementRef: "requirement:duplicate", intent: { ...intent, target: { ...intent.target,
        entityRef: ambiguousSituation.requirements[0].entityRefs[0], worldRef: ambiguousSituation.worldRef,
        surfaceEpoch: `document:${ambiguousSituation.documentEpoch}` } } }, { timeoutMs: TIMEOUT_MS });
  } catch (error) { ambiguousError = error; }
  check("ambiguous target is rejected before another provider effect",
    ambiguousError instanceof ControlRemoteError
      && ambiguousError.code === "ACTUATION_TARGET_AMBIGUOUS" && effects === 1);
  check("Control surface exposes all Motor lifecycle operations",
    ["motor.execute", "motor.inspect", "motor.list", "motor.replay", "motor.policy.evaluate",
      "motor.policy.promote", "motor.policy.rollback"].every((operation) => client.operations.includes(operation)));
  await client.detachSession(sessionRef);
  await client.close();
  clientClosed = true;

  const pythonResult = run(process.env.PYTHON || "python", [join(ROOT, "tests", "pythonSdk", "motorList.py"),
    configPath, process.execPath, controlScript], { cwd: installed.appDir,
    env: { ...process.env, PYTHONPATH: join(ROOT, "pythonSdk", "src") } });
  const pythonRecords = JSON.parse(pythonResult.stdout.trim());
  check("Python facade preserves the same durable receipt digest",
    pythonRecords.some((entry) => entry.receiptSha256 === receiptSha256));

  mcpChild = spawn(process.execPath, [join(packageRoot, "scripts", "pyprocMcp.mjs"), "--config", configPath], {
    cwd: installed.appDir, stdio: ["pipe", "pipe", "pipe"], env: process.env,
  });
  let mcpStderr = "";
  mcpChild.stderr.on("data", (chunk) => { mcpStderr = (mcpStderr + String(chunk)).slice(-8000); });
  const waiters = new Map();
  let sequence = 0;
  createInterface({ input: mcpChild.stdout, crlfDelay: Infinity }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch (error) { return; }
    const waiter = waiters.get(message.id);
    if (waiter) { waiters.delete(message.id); waiter(message); }
  });
  const request = (method, params = {}) => {
    const id = ++sequence;
    mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`${method} timeout\n${mcpStderr}`)); }, TIMEOUT_MS);
      waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
    });
  };
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "motor-product-gate", version: "1" } });
  mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const toolNames = (await request("tools/list")).result.tools.map((tool) => tool.name);
  const listed = await request("tools/call", { name: "motorList", arguments: {} });
  const mcpRecords = JSON.parse(listed.result.content[0].text);
  check("MCP facade exposes every Motor tool and preserves the same receipt digest",
    ["motorExecute", "motorInspect", "motorList", "motorReplay", "motorPolicyEvaluate",
      "motorPolicyPromote", "motorPolicyRollback"].every((name) => toolNames.includes(name))
      && mcpRecords.some((entry) => entry.receiptSha256 === receiptSha256));
} catch (error) {
  check("installed Motor journey has no exception", false,
    `${String(error?.stack || error).slice(-1600)} details=${JSON.stringify(error?.details || null)}`);
} finally {
  if (!clientClosed) await client.close();
  if (mcpChild?.exitCode === null) mcpChild.kill("SIGTERM");
  if (mcpChild) await new Promise((resolve) => mcpChild.exitCode === null ? mcpChild.once("exit", resolve) : resolve());
  await rm(installed.tmp, { recursive: true, force: true });
  await new Promise((resolve) => fixture.close(resolve));
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
