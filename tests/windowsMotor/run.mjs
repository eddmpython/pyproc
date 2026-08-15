// run.mjs - installed optional Windows Motor setup, integrity, semantic action, and removal gate.
import { strict as assert } from "node:assert";
import { appendFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

if (process.platform !== "win32") {
  console.log("Windows Motor installed gate skipped outside Windows");
  process.exit(0);
}

let passed = 0;
function check(name, operation) {
  return Promise.resolve().then(operation).then(() => {
    passed += 1;
    console.log(`  PASS ${name}`);
  });
}

function waitForExit(child, timeout = 5000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("child process did not exit")), timeout);
    child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await waitForExit(child).catch(() => child.kill("SIGKILL"));
}

const fixtureScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'PyProc Motor Fixture'
$form.Width = 420
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 100
$form.Top = 100
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Save'
$button.Left = 32
$button.Top = 32
$button.Width = 120
$button.Height = 44
$status = New-Object System.Windows.Forms.Label
$status.Text = 'idle'
$status.Left = 32
$status.Top = 94
$status.Width = 240
$status.Height = 32
$button.Add_Click({ $status.Text = 'saved' })
$form.Controls.Add($button)
$form.Controls.Add($status)
$form.Add_Shown({
  $form.TopMost = $true
  $form.Activate()
  [Console]::Out.WriteLine('{"windowTitle":"PyProc Motor Fixture"}')
  [Console]::Out.Flush()
})
[System.Windows.Forms.Application]::Run($form)
`;

async function launchFixture(path) {
  const child = spawn(path, ["-NoLogo", "-NoProfile", "-STA", "-Command", fixtureScript], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: false,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = await new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    const timer = setTimeout(() => rejectReady(new Error(`fixture timeout: ${stderr}`)), 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline !== -1) {
        clearTimeout(timer);
        resolveReady(JSON.parse(stdout.slice(0, newline).trim()));
      }
    });
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  return { child, ready };
}

const installed = await installPackedPyProc("pyproc Windows Motor 한글 ");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const fixturePath = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell",
  "v1.0", "powershell.exe");
const installRoot = join(installed.appDir, "native install 한글");
const configPath = join(installed.appDir, "Motor 설정.json");
const engineRoot = join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core");
const memoryRoot = join(installed.appDir, "Motor 실행 기억 한글");
const webServer = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body><button>Save</button></body></html>");
});
await new Promise((resolveListen) => webServer.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${webServer.address().port}`;
await writeFile(configPath, `${JSON.stringify({ schemaVersion: 1, engine: { root: engineRoot },
  browser: { enabled: true, provider: "nativeCdp", allowedOrigins: [origin],
    maxRisk: "externalEffect", actions: ["snapshot", "click"], methods: [],
    externalEffects: "acknowledged", purpose: "Verify the installed Windows Motor fixture",
    artifacts: {}, ...(process.env.PYPROC_BROWSER ? { executable: process.env.PYPROC_BROWSER } : {}) },
  executionMemory: { enabled: true, root: memoryRoot, importRoots: [], secretEnv: [] },
  actuation: { enabled: true, native: { enabled: true, installRoot, applications: [{
    applicationId: "application:motorFixture", executablePath: fixturePath,
    windowTitle: "PyProc Motor Fixture",
  }] } }, timeoutMs: 180000 }, null, 2)}\n`);

const controlCli = binPath(installed.appDir, "pyproc-control");
let fixture = null;
let client = null;
let controlClient = null;
let mcpChild = null;
console.log("installed Windows Motor product gate");
try {
  const setup = JSON.parse(run(controlCli, ["native", "setup", "--config", configPath], {
    cwd: installed.appDir,
  }).stdout);
  await check("explicit setup builds and signs a locked host in a spaced non-ASCII path", async () => {
    assert.equal(setup.installed, true);
    assert.equal(setup.installation.signatureValid, true);
    assert.equal((await stat(setup.installation.hostPath)).isFile(), true);
    assert.match(setup.installation.sbomSha256, /^[0-9a-f]{64}$/);
  });

  const hostModule = await import(pathToFileURL(join(packageRoot, "scripts", "actuation", "windowsNativeHost.js")).href);
  const configModule = await import(pathToFileURL(join(packageRoot, "scripts", "mcpProductConfig.mjs")).href);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  client = await hostModule.WindowsNativeHostClient.open(config.actuation.native);
  fixture = await launchFixture(fixturePath);
  const binding = await client.bindApplication({ applicationId: "application:motorFixture",
    surfaceEpoch: "surface:installed1", target: { name: "Save", controlType: "button" } });
  const nativeResult = await client.executeAccessibility({ bindingRef: binding.bindingRef,
    planSha256: "a".repeat(64), intentSha256: "b".repeat(64), intent: "activate", desired: {},
    surfaceEpoch: "surface:installed1", postcondition: { name: "saved", controlType: "text" } });
  await check("installed UIA path binds an allowed executable and confirms semantic change", () => {
    assert.equal(nativeResult.terminal, "confirmed");
    assert.equal(nativeResult.providerCalls, 1);
    assert.equal(/processId|windowHandle|runtimeId|coordinate|"x"|"y"/.test(JSON.stringify(binding)), false);
  });

  await stop(fixture.child);
  fixture = await launchFixture(fixturePath);
  const publicRequire = createRequire(join(installed.appDir, "package.json"));
  const controlEntry = publicRequire.resolve("pyproc/control");
  const { PyProcControlClient } = await import(pathToFileURL(controlEntry).href);
  controlClient = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: 180000, shutdownTimeoutMs: 10000 });
  const space = await controlClient.inspectSpace();
  const target = await controlClient.openTarget(`${origin}/fixture`, { expectedRisk: "externalEffect" });
  const attached = await controlClient.attachSession(target.output.targetRef);
  const sessionRef = attached.output;
  const situation = (await controlClient.observe(sessionRef, { expectedRisk: "read",
    representation: "apx.situation",
    focus: { requirements: [{ requirementRef: "requirement:save", select: { role: "button", name: "Save" },
      need: ["fact", "affordance"], cardinality: "one" }] }, visual: { mode: "off" },
    budget: { maxEntities: 20, maxRelations: 20, maxBytes: 65536 } })).output;
  const affordance = situation.affordances.find((entry) => entry.kind === "authorized");
  const entityRef = situation.requirements[0].entityRefs[0];
  const motorResult = (await controlClient.executeMotor({ sessionRef, situation,
    requirementRef: "requirement:save",
    applicationId: "application:motorFixture", nativePostcondition: { name: "saved", controlType: "text" },
    intent: { intent: "activate", target: { spaceRef: space.output.space.spaceId, entityRef,
      worldRef: situation.worldRef, surfaceEpoch: `document:${situation.documentEpoch}` },
    desired: { activated: true },
    preconditions: [], expectedTransition: { entityState: { entityRef, disabled: false } },
    authority: { actionCapabilityRef: affordance.capabilityRef, approvalGrantRef: null,
      commitLeaseRef: null, controlLeaseRef: null }, policy: {
      allowedActuatorKinds: ["accessibility"], allowPreContactFallback: false,
    } } }, { timeoutMs: 180000 })).output;
  const receiptSha256 = motorResult.receipt.receiptSha256;
  await check("public pyproc/control selects Windows accessibility and seals the common receipt", () => {
    assert.equal(motorResult.terminal, "confirmed");
    assert.equal(motorResult.provider.kind, "accessibility");
    assert.equal(motorResult.receipt.decision.selectedActuator, "accessibility");
    assert.equal(motorResult.receipt.effectWindow.providerCalls, 1);
  });
  await stop(fixture.child);
  fixture = await launchFixture(fixturePath);
  const baseIntentInput = { intent: "activate", target: {
    spaceRef: space.output.space.spaceId, entityRef, worldRef: situation.worldRef,
    surfaceEpoch: `document:${situation.documentEpoch}`,
  }, desired: { activated: true }, preconditions: [], expectedTransition: {
    entityState: { entityRef, disabled: false },
  }, authority: { actionCapabilityRef: affordance.capabilityRef, approvalGrantRef: null,
    commitLeaseRef: null, controlLeaseRef: null }, policy: {
    allowedActuatorKinds: ["osInput"], allowPreContactFallback: false,
  } };
  const lease = (await controlClient.acquireMotorControl({ applicationId: "application:motorFixture",
    intent: baseIntentInput, expiresInMs: 5000 })).output;
  const finalIntentInput = { ...baseIntentInput, authority: {
    ...baseIntentInput.authority, controlLeaseRef: lease.leaseRef,
  } };
  const physicalResult = (await controlClient.executeMotor({ sessionRef, situation,
    requirementRef: "requirement:save",
    applicationId: "application:motorFixture", nativePostcondition: { name: "saved", controlType: "text" },
    intent: finalIntentInput })).output;
  await check("intent-bound one-shot ControlLease selects OS input and confirms the same terminal", async () => {
    assert.equal(lease.state, "active");
    assert.equal(physicalResult.terminal, "confirmed", JSON.stringify(physicalResult));
    assert.equal(physicalResult.provider.kind, "osInput");
    assert.equal(physicalResult.receipt.effectWindow.providerCalls, 1);
    let reused = null;
    try { await controlClient.executeMotor({ sessionRef, situation, requirementRef: "requirement:save",
      applicationId: "application:motorFixture", nativePostcondition: { name: "saved", controlType: "text" },
      intent: finalIntentInput }); } catch (error) { reused = error; }
    assert.equal(reused?.code, "ACTUATION_CONTROL_REVOKED");
  });
  await controlClient.detachSession(sessionRef);
  await controlClient.close();
  controlClient = null;

  const controlScript = join(packageRoot, "scripts", "pyprocControl.mjs");
  const pythonResult = run(process.env.PYTHON || "python", [join(ROOT, "tests", "pythonSdk", "motorList.py"),
    configPath, process.execPath, controlScript], { cwd: installed.appDir,
    env: { ...process.env, PYTHONPATH: join(ROOT, "pythonSdk", "src") } });
  const pythonRecords = JSON.parse(pythonResult.stdout.trim());
  await check("Python facade preserves the Windows receipt digest", () => {
    assert.equal(pythonRecords.some((entry) => entry.receiptSha256 === receiptSha256), true);
  });

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
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => { waiters.delete(id);
        rejectRequest(new Error(`${method} timeout\n${mcpStderr}`)); }, 180000);
      waiters.set(id, (message) => { clearTimeout(timer); resolveRequest(message); });
    });
  };
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "windows-motor-gate", version: "1" } });
  mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = (await request("tools/list")).result.tools.map((tool) => tool.name);
  const listed = await request("tools/call", { name: "motorList", arguments: {} });
  const mcpRecords = JSON.parse(listed.result.content[0].text);
  await check("MCP facade exposes physical control and preserves the Windows receipt digest", () => {
    assert.equal(["motorControlAcquire", "motorControlRevoke"].every((name) => tools.includes(name)), true);
    assert.equal(mcpRecords.some((entry) => entry.receiptSha256 === receiptSha256), true);
  });
  mcpChild.kill("SIGTERM");
  await waitForExit(mcpChild, 10000);
  mcpChild = null;

  await client.close();
  client = null;
  await stop(fixture.child);
  fixture = null;
  await appendFile(setup.installation.hostPath, Buffer.from([0]));
  await check("tampered installed binary is rejected before spawn", async () => {
    let error = null;
    try { await hostModule.WindowsNativeHostClient.open(config.actuation.native); }
    catch (caught) { error = caught; }
    assert.equal(error?.code, "ACTUATION_NATIVE_INTEGRITY");
  });

  const repaired = JSON.parse(run(controlCli, ["native", "setup", "--config", configPath], {
    cwd: installed.appDir,
  }).stdout);
  const status = JSON.parse(run(controlCli, ["native", "status", "--config", configPath], {
    cwd: installed.appDir,
  }).stdout);
  await check("setup is an integrity-preserving update and status is effect-free", () => {
    assert.equal(repaired.installation.signatureValid, true);
    assert.equal(status.enabled, true);
    assert.equal(status.installation.signatureValid, true);
  });

  const disabled = configModule.validateMcpProductConfig({ schemaVersion: 1, engine: { root: engineRoot },
    browser: { enabled: false }, actuation: { enabled: false }, timeoutMs: 180000 });
  await check("default browser-only installation projects no native process authority", () => {
    assert.equal(disabled.config.actuation.native.enabled, false);
    assert.equal(Object.hasOwn(disabled.env, "PYPROC_WINDOWS_MOTOR"), false);
  });

  const removal = JSON.parse(run(controlCli, ["native", "remove", "--config", configPath], {
    cwd: installed.appDir,
  }).stdout);
  await check("explicit removal deletes only owned native files and clears the manifest", async () => {
    assert.equal(removal.installed, false);
    for (const path of removal.removed) {
      let exists = true;
      try { await stat(path); } catch (error) { if (error?.code === "ENOENT") exists = false; else throw error; }
      assert.equal(exists, false);
    }
    const removedConfig = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(removedConfig.actuation.native.enabled, false);
    assert.equal(Object.hasOwn(removedConfig.actuation.native, "installation"), false);
  });
} finally {
  if (mcpChild?.exitCode === null) mcpChild.kill("SIGTERM");
  if (mcpChild) await waitForExit(mcpChild).catch(() => {});
  await controlClient?.close();
  await client?.close();
  await stop(fixture?.child);
  await new Promise((resolveClose) => webServer.close(resolveClose));
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`Windows Motor installed gate: ${passed}/${passed} passed`);
