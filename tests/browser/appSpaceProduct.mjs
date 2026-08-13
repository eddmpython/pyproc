// appSpaceProduct.mjs - packed cooperative app state와 Machine pair의 installed browser gate.
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const SECRET = "app-space-product-secret-value";
const previousSecret = process.env.APP_SPACE_PRODUCT_SECRET;
process.env.APP_SPACE_PRODUCT_SECRET = SECRET;
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
let passed = 0;
let failed = 0;
let effectRequests = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const installed = await installPackedPyProc("pyprocAppSpace-");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const frameSource = await readFile(join(packageRoot, "scripts", "automationSpace", "frameSpaceTarget.js"));
const appSource = await readFile(join(packageRoot, "scripts", "appSpace", "appSpaceTarget.js"));
let targetOrigin = null;
const targetServer = createServer((req, res) => {
  if (req.url === "/effect" && req.method === "POST") {
    effectRequests += 1;
    res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ effectRequests }));
    return;
  }
  if (req.url === "/frameSpaceTarget.js" || req.url === "/appSpaceTarget.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(req.url === "/frameSpaceTarget.js" ? frameSource : appSource);
    return;
  }
  const foreign = req.url?.startsWith("/foreign");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html><body><h1>Transactional workspace</h1>
    <button id="one">One</button><button id="two">Two</button><button id="secret">Secret</button>
    <button id="commit">Commit</button><output id="state" role="status">base</output>
    <script src="/appSpaceTarget.js"></script><script>
      let logical = { value: "base", records: [{ id: "record:1", value: 0 }] };
      let outbox = [];
      let revision = 1;
      let frozen = false;
      const render = () => { document.querySelector("#state").textContent = logical.value; };
      const mutate = (value) => { if (frozen) throw new Error("app is quiesced"); logical.value = value;
        logical.records[0].value += 1; revision += 1; render(); };
      document.querySelector("#one").addEventListener("click", () => mutate("one"));
      document.querySelector("#two").addEventListener("click", () => mutate("two"));
      document.querySelector("#secret").addEventListener("click", () => mutate(${JSON.stringify(SECRET)}));
      pyprocAppSpace.register({ identity: { appId: ${JSON.stringify(foreign ? "foreign.app" : "product.app")},
        origin: location.origin, adapterVersion: "1.0.0", stateSchema: "workspace/1" },
        scope: ["router", "domainStore", "declaredRecords", "effectOutbox"],
        revision: () => "apprev:" + revision,
        quiesce: async () => { frozen = true; },
        exportState: async () => structuredClone(logical),
        importState: async (state, effects) => { logical = structuredClone(state); outbox = structuredClone(effects);
          revision += 1; render(); },
        resume: async () => { frozen = false; },
        describeEffects: async () => structuredClone(outbox),
        stageEffect: async (effect) => { if (outbox.some((entry) => entry.intentSha256 === effect.intentSha256)) {
          throw new Error("duplicate intent"); } outbox.push({ intentSha256: effect.intentSha256,
          state: "staged", terminal: null, effectReceiptSha256: null }); revision += 1; },
        finalizeEffect: async (effect) => { const entry = outbox.find((item) => item.intentSha256 === effect.intentSha256);
          if (!entry) throw new Error("intent unavailable"); entry.state = "terminal"; entry.terminal = effect.terminal;
          entry.effectReceiptSha256 = effect.effectReceiptSha256; revision += 1; },
      }); render();
    </script><script src="/frameSpaceTarget.js"></script></body></html>`);
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;

const executionRoot = join(installed.appDir, ".app-space-memory");
const approvalKeyFile = join(executionRoot, "approval-public.pem");
const approvalPair = generateKeyPairSync("ed25519");
await mkdir(executionRoot, { recursive: true });
await writeFile(approvalKeyFile, approvalPair.publicKey.export({ type: "spki", format: "pem" }));
const configPath = join(installed.appDir, "pyproc-app-space.json");
await writeFile(configPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: TIMEOUT_MS,
  executionMemory: { enabled: true, root: executionRoot, secretEnv: ["APP_SPACE_PRODUCT_SECRET"] },
  effectTransactions: { enabled: true, approvalAuthorities: [{
    authorityId: "operator:app-space", publicKeyFile: approvalKeyFile,
  }] },
  appSpace: { enabled: true, maxStateBytes: 64 * 1024, apps: [{ appId: "product.app",
    origin: targetOrigin, adapterVersion: "1.0.0", stateSchema: "workspace/1" }] },
  browser: { enabled: true, provider: "frame",
    ...(process.env.PYPROC_BROWSER ? { executable: process.env.PYPROC_BROWSER } : {}),
    allowedOrigins: [targetOrigin], maxRisk: "externalEffect",
    actions: ["snapshot", "waitFor", "click"], methods: [], externalEffects: "acknowledged",
    purpose: "Transactional AppSpace installed product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 } },
}, null, 2));

const controlCli = binPath(installed.appDir, "pyproc-control");
const env = { ...process.env, APP_SPACE_PRODUCT_SECRET: SECRET };
const preflight = JSON.parse(run(controlCli, ["--config", configPath, "--check"],
  { cwd: installed.appDir, env }).stdout);
check("preflight closes exact AppSpace identity and dependencies", preflight.ok === true
  && preflight.appSpace?.enabled === true && preflight.appSpace?.apps?.length === 1
  && preflight.executionMemory?.enabled === true && preflight.effectTransactions?.enabled === true);

const controlApiFile = join(packageRoot, "scripts", "controlProtocol", "controlApi.js");
const { ControlRemoteError, PyProcControlClient } = await import(pathToFileURL(controlApiFile).href);
const client = await PyProcControlClient.start(configPath, {
  command: [process.execPath, join(packageRoot, "scripts", "pyprocControl.mjs")],
  cwd: installed.appDir, env, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000,
});
let mcpChild = null;
let clientClosed = false;

console.log("installed Transactional AppSpace product gate");
try {
  check("one public wire exposes the nine AppSpace operations",
    client.operations.length === 41 && ["app.attach", "app.checkpoint", "app.branch", "app.restore",
      "app.adopt", "app.inspect", "app.list", "app.effect.stage", "app.effect.finalize"]
      .every((operation) => client.operations.includes(operation)), `${client.operations.length} operations`);

  await client.runPython("app_machine = 'base'");
  const project = { workspaceId: "workspace:app-space", commit: "fixture",
    treeSha256: `sha256:${digest("tree")}`, diffSha256: `sha256:${digest("diff")}`, untracked: false };
  const memory = await client.createExecutionSession("session:app-space", project);
  const opened = await client.openTarget(`${targetOrigin}/workspace`, { expectedRisk: "externalEffect" });
  const frame = await client.attachSession(opened.output.targetRef);
  const app = await client.attachApp(frame.output);
  check("configured cooperative adapter attaches through credentialless FrameSpace",
    app.output.identity.appId === "product.app" && app.output.isolation === "credentialless-opaque-frame");

  const base = await client.checkpointApp({ appRef: app.output.appRef, pairId: "pair:base",
    executionSessionId: "session:app-space", expectedSessionRevisionSha256: memory.output.contentSha256,
    expectedActivePairSha256: null });
  await client.act(frame.output, [{ kind: "click", selector: "#one", expectedRisk: "externalEffect" }]);
  await client.runPython("app_machine = 'one'");
  const first = await client.branchApp({ appRef: app.output.appRef, pairId: "pair:first",
    parentPairId: "pair:base", executionSessionId: "session:app-space",
    expectedSessionRevisionSha256: memory.output.contentSha256,
    expectedActivePairSha256: base.output.pair.contentSha256 });

  await client.restoreApp(app.output.appRef, "pair:base");
  const restoredBase = await client.observe(frame.output, { mode: "interactive", expectedRisk: "read" });
  const baseMachine = await client.runPython("app_machine");
  check("restore returns app state and Machine heap to one exact pair",
    restoredBase.output.nodes.some((node) => node.id === "state" && node.text === "base")
      && baseMachine.output.value === "'base'");

  await client.act(frame.output, [{ kind: "click", selector: "#two", expectedRisk: "externalEffect" }]);
  await client.runPython("app_machine = 'two'");
  const second = await client.branchApp({ appRef: app.output.appRef, pairId: "pair:second",
    parentPairId: "pair:base", executionSessionId: "session:app-space",
    expectedSessionRevisionSha256: memory.output.contentSha256,
    expectedActivePairSha256: base.output.pair.contentSha256 });
  await client.adoptApp(app.output.appRef, first.output.pair.pairId, base.output.pair.contentSha256);
  let stale = null;
  try { await client.adoptApp(app.output.appRef, second.output.pair.pairId, base.output.pair.contentSha256); }
  catch (error) { stale = error; }
  const afterRace = await client.observe(frame.output, { mode: "interactive", expectedRisk: "read" });
  const afterRaceMachine = await client.runPython("app_machine");
  const inspected = await client.inspectApp(app.output.appRef);
  check("stale adopt rolls app, Machine, and active HEAD back together",
    stale instanceof ControlRemoteError && stale.code === "APP_SPACE_HEAD_CONFLICT"
      && afterRace.output.nodes.some((node) => node.id === "state" && node.text === "one")
      && afterRaceMachine.output.value === "'one'" && inspected.output.active.pairId === "pair:first");

  const transition = { entityAppeared: { role: "status", nameContains: "committed" }, withinMs: 5000 };
  const prepared = await client.prepareEffectTransaction({ transactionId: "effect:app-space",
    intentId: "intent:app-space", executionSessionId: "session:app-space",
    expectedSessionRevisionSha256: memory.output.contentSha256,
    destination: { origin: targetOrigin, subjectSha256: digest("app-space-subject"),
      purpose: "Stage an exact product fixture effect" },
    effectTemplate: { sessionRef: frame.output, focus: { requirements: [{
      requirementRef: "requirement:commit", select: { role: "button", name: "Commit", actionable: true },
      need: ["fact", "affordance"], cardinality: "one",
    }] }, actions: [{ kind: "click", requirementRef: "requirement:commit", expectedRisk: "externalEffect",
      verify: transition }] }, expectedTransition: transition });
  const staged = await client.stageAppEffect(app.output.appRef, "effect:app-space",
    prepared.output.transaction.contentSha256);
  const stagedPair = await client.checkpointApp({ appRef: app.output.appRef, pairId: "pair:staged",
    executionSessionId: "session:app-space",
    expectedSessionRevisionSha256: prepared.output.executionSession.contentSha256,
    expectedActivePairSha256: first.output.pair.contentSha256 });
  check("outbox stages only an exact prepared intent without external send",
    staged.output.sent === false && effectRequests === 0
      && stagedPair.output.pair.app.outbox[0].intentSha256 === prepared.output.transaction.intent.contentSha256
      && stagedPair.output.pair.app.outbox[0].state === "staged");

  await client.act(frame.output, [{ kind: "click", selector: "#secret", expectedRisk: "externalEffect" }]);
  let secretFailure = null;
  try { await client.checkpointApp({ appRef: app.output.appRef, pairId: "pair:secret",
    executionSessionId: "session:app-space",
    expectedSessionRevisionSha256: prepared.output.executionSession.contentSha256,
    expectedActivePairSha256: stagedPair.output.pair.contentSha256 }); }
  catch (error) { secretFailure = error; }
  const afterSecret = await client.inspectApp(app.output.appRef);
  check("configured secret fails closed and releases the app fence",
    secretFailure instanceof ControlRemoteError && secretFailure.code === "APP_SPACE_SECRET"
      && afterSecret.output.live.quiesced === false);

  const foreignOpened = await client.openTarget(`${targetOrigin}/foreign`, { expectedRisk: "externalEffect" });
  const foreignFrame = await client.attachSession(foreignOpened.output.targetRef);
  let foreignFailure = null;
  try { await client.attachApp(foreignFrame.output); } catch (error) { foreignFailure = error; }
  check("unconfigured app identity is rejected after live adapter description",
    foreignFailure instanceof ControlRemoteError && foreignFailure.code === "APP_SPACE_IDENTITY_MISMATCH");
  const listed = await client.listAppPairs();
  check("only complete paired markers are listed with one active generation",
    listed.output.filter((entry) => entry.active).length === 1
      && listed.output.some((entry) => entry.pairId === "pair:staged" && entry.active));
  const expectedDigest = stagedPair.output.pair.contentSha256;
  await client.close();
  clientClosed = true;

  const pythonEnv = { ...env, PYTHONPATH: join(ROOT, "pythonSdk", "src") };
  const pythonResult = run(process.env.PYTHON || "python", [join(ROOT, "tests", "pythonSdk", "appSpaceList.py"),
    configPath, process.execPath, join(packageRoot, "scripts", "pyprocControl.mjs")],
  { cwd: installed.appDir, env: pythonEnv });
  const pythonPairs = JSON.parse(pythonResult.stdout.trim());
  check("Python client reopens the same durable paired generation digest",
    pythonPairs.some((entry) => entry.pairId === "pair:staged"
      && entry.contentSha256 === expectedDigest && entry.active));

  mcpChild = spawn(process.execPath, [join(packageRoot, "scripts", "pyprocMcp.mjs"), "--config", configPath], {
    cwd: installed.appDir, stdio: ["pipe", "pipe", "pipe"], env,
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
    clientInfo: { name: "app-space-product-gate", version: "1" } });
  mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const mcpTools = (await request("tools/list")).result.tools.map((tool) => tool.name);
  const mcpList = await request("tools/call", { name: "appList", arguments: {} });
  const mcpPairs = JSON.parse(mcpList.result.content[0].text);
  check("MCP exposes all AppSpace tools and the same paired generation digest",
    ["appAttach", "appCheckpoint", "appBranch", "appRestore", "appAdopt", "appInspect", "appList",
      "appEffectStage", "appEffectFinalize"].every((name) => mcpTools.includes(name))
      && mcpPairs.some((entry) => entry.pairId === "pair:staged"
        && entry.contentSha256 === expectedDigest && entry.active));
} catch (error) {
  check("Transactional AppSpace installed journey has no exception", false,
    String(error?.stack || error).slice(-1600));
} finally {
  if (!clientClosed) await client.close();
  if (mcpChild?.exitCode === null) mcpChild.kill("SIGTERM");
  if (mcpChild) await new Promise((resolve) => mcpChild.exitCode === null
    ? mcpChild.once("exit", resolve) : resolve());
  await new Promise((resolve) => targetServer.close(resolve));
  await rm(installed.tmp, { recursive: true, force: true });
  if (previousSecret === undefined) delete process.env.APP_SPACE_PRODUCT_SECRET;
  else process.env.APP_SPACE_PRODUCT_SECRET = previousSecret;
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
