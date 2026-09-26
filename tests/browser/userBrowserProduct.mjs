// userBrowserProduct.mjs - the user-browser provider end to end in an isolated Edge that loads the extension.
// The gate installs the native host under a gate-only name and LOCALAPPDATA, so the user's own installation and
// browsers are never touched, then drives the installed Control product through the extension: Motor, APX, screenshot,
// a download the browser saves into the gate's own folder (received as a receipt and exported), and cleanup. Negative checks: a wrong pairing key, a tab outside the task, profile-touching commands, the pipe's
// access list and single instance, and the host leaving with the browser.
import { createServer } from "node:http";
import { connect, createServer as createPipeServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installPackedPyProc, ROOT } from "../packageHarness.mjs";
import { launchBrowser } from "../../scripts/browserControl/browserLauncher.mjs";
import { CdpConnection } from "../../scripts/browserControl/cdpConnection.mjs";
import { listUserBrowserHosts, userBrowserPipeChannel, userBrowserStatus }
  from "../../scripts/browserControl/userBrowser/userBrowserChannel.mjs";
import { removeUserBrowser, setupUserBrowser, userBrowserInstallStatus }
  from "../../scripts/browserControl/userBrowser/userBrowserInstaller.mjs";

if (process.platform !== "win32") {
  console.log("user browser gate skipped outside Windows");
  process.exit(0);
}

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}
async function waitFor(operation, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch {}
    await delay(100);
  }
  return null;
}

let effects = 0;
const REPORT_PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  "latin1");
const fixture = createServer((req, res) => {
  if (req.url === "/report.pdf") {
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=report.pdf",
      "Cache-Control": "no-store" });
    res.end(REPORT_PDF);
    return;
  }
  if (req.url === "/save" && req.method === "POST") {
    effects += 1;
    res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ effects }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><title>user browser fixture</title><h1>Orders</h1><button id="save">Save</button><a id="report" href="/report.pdf">Report</a>
    <script>document.getElementById("save").addEventListener("click", async () => {
      const response = await fetch("/save", { method: "POST" });
      const status = document.createElement("p"); status.setAttribute("role", "status");
      status.textContent = response.ok ? "saved" : "failed"; document.body.append(status);
    });</script>`);
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;

const key = randomBytes(32).toString("hex");
const hostName = `com.pyproc.user_browser_gate_${randomBytes(4).toString("hex")}`;
const localAppData = await mkdtemp(join(tmpdir(), "pyprocUserBrowserGate-"));
// The browser (and so the native host it starts) and the control host all inherit this LOCALAPPDATA.
process.env.LOCALAPPDATA = localAppData;
const installRoot = join(localAppData, "install");
// PYPROC_GATE_USER_BROWSER_HOST runs the gate on a prebuilt host (a release candidate) instead of building one.
const setupOptions = { installRoot, hostName, presetPairingSha256: createHash("sha256").update(key).digest("hex"),
  browsers: ["edge", "chrome"], hostBinary: process.env.PYPROC_GATE_USER_BROWSER_HOST || null };
const BROWSERS = [
  { kind: "edge", product: /^Edg\/\d+/, executable: findInstalled(["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]) },
  { kind: "chrome", product: /^Chrome\/\d+/, executable: findInstalled(["C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"]) },
].filter((entry) => entry.executable);
let browser = null;
let client = null;
console.log("user browser provider product gate");

function findInstalled(paths) {
  return paths.find((path) => existsSync(path)) || null;
}

function frameOf(message) {
  const body = Buffer.from(typeof message === "string" ? message : JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function frameReader(stream, into) {
  let buffered = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (buffered.length < 4 + length) break;
      into.push(JSON.parse(buffered.subarray(4, 4 + length).toString("utf8")));
      buffered = buffered.subarray(4 + length);
    }
  });
}

// The native host alone, driven the way the browser drives it (stdio frames) and the way a control host does (pipe):
// frames the extension wrote before it acknowledged a new client's connection number never reach that client, a
// client that stops reading is let go, and the host leaves with its stdin and withdraws its announcement.
async function hostChecks(hostPath) {
  const root = await mkdtemp(join(tmpdir(), "pyprocUserBrowserHost-"));
  const host = spawn(hostPath, ["chrome-extension://gate/"], { env: { ...process.env, LOCALAPPDATA: root },
    stdio: ["pipe", "pipe", "ignore"] });
  const fromHost = [];
  frameReader(host.stdout, fromHost);
  let exited = false;
  host.once("exit", () => { exited = true; });
  const announcement = join(root, "pyproc", "userBrowser", "hosts", "gate-profile.json");
  try {
    host.stdin.write(frameOf({ method: "PyprocUserBrowserHost.hello", params: { profileId: "../outside", product: "Edg/1" } }));
    await delay(200);
    const refusedBadProfile = !existsSync(join(root, "pyproc", "userBrowser", "hosts", "..", "outside.json"));
    host.stdin.write(frameOf({ method: "PyprocUserBrowserHost.hello", params: { profileId: "gate-profile", product: "Edg/1" } }));
    const announced = await waitFor(() => existsSync(announcement), 5000);
    const { pipeName } = JSON.parse(await readFile(announcement, "utf8"));
    const client = async () => {
      const socket = connect(pipeName);
      await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const got = [];
      frameReader(socket, got);
      socket.on("error", () => {});
      return { socket, got };
    };
    const connectedNumber = async (count) => (await waitFor(() => fromHost.filter((message) =>
      message.method === "PyprocUserBrowserHost.clientConnected").length >= count, 5000))
      && fromHost.filter((message) => message.method === "PyprocUserBrowserHost.clientConnected")[count - 1].params.connection;
    const first = await client();
    const firstNumber = await connectedNumber(1);
    host.stdin.write(frameOf({ method: "PyprocUserBrowserHost.ready", params: { connection: firstNumber } }));
    host.stdin.write(frameOf({ id: 1, result: { to: "first" } }));
    await waitFor(() => first.got.some((message) => message.id === 1), 5000);
    first.socket.destroy();
    await waitFor(() => fromHost.some((message) => message.method === "PyprocUserBrowserHost.clientGone"), 5000);
    const second = await client();
    const secondNumber = await connectedNumber(2);
    host.stdin.write(frameOf({ id: 2, result: { to: "first, written late" } }));
    await delay(300);
    host.stdin.write(frameOf({ method: "PyprocUserBrowserHost.ready", params: { connection: secondNumber } }));
    host.stdin.write(frameOf({ id: 3, result: { to: "second" } }));
    await waitFor(() => second.got.some((message) => message.id === 3), 5000);
    check("host: a frame written before the extension acknowledged a client never reaches it",
      announced && refusedBadProfile && secondNumber === firstNumber + 1 && first.got.map((message) => message.id).join() === "1"
        && second.got.map((message) => message.id).join() === "3",
      JSON.stringify({ first: first.got, second: second.got }));
    second.socket.destroy();
    await waitFor(() => fromHost.filter((message) => message.method === "PyprocUserBrowserHost.clientGone").length >= 2,
      5000);
    const stalled = await client();
    stalled.socket.pause();
    const stalledNumber = await connectedNumber(3);
    host.stdin.write(frameOf({ method: "PyprocUserBrowserHost.ready", params: { connection: stalledNumber } }));
    const padding = frameOf({ method: "Network.dataReceived", params: { pad: "x".repeat(60000) } });
    for (let index = 0; index < 40; index += 1) host.stdin.write(padding);
    const letGo = await waitFor(() => fromHost.filter((message) =>
      message.method === "PyprocUserBrowserHost.clientGone").length >= 3, 20000);
    host.stdin.end();
    const left = await waitFor(() => exited && !existsSync(announcement), 10000);
    stalled.socket.destroy();
    check("host: a client that stops reading is let go, and the host leaves with its stdin and its announcement",
      letGo === true && left === true, JSON.stringify({ letGo, exited, announced: existsSync(announcement) }));
  } finally {
    if (!exited) host.kill();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function journey({ kind, product, executable }, installed, app) {
  const label = `${kind}: `;
  // Branded Chrome ignores --load-extension; both browsers load an unpacked extension over the CDP pipe. The browser
  // saves downloads into a folder of the gate's own, never the user's download folder.
  const downloadsDir = join(localAppData, `downloads-${kind}`);
  await mkdir(downloadsDir, { recursive: true });
  browser = launchBrowser("about:blank", { executable, enableExtensions: true, cdpPipe: true,
    extraArgs: ["--enable-unsafe-extension-debugging"],
    preferences: { download: { default_directory: downloadsDir, prompt_for_download: false } } });
  const direct = CdpConnection.overPipe(browser.cdpPipe, { timeoutMs: 30000 });
  const loaded = await direct.send("Extensions.loadUnpacked", { path: installed.extensionPath });
  const host = await waitFor(async () => (await listUserBrowserHosts()).find((entry) => product.test(entry.product)),
    30000);
  check(`${label}the browser starts the native host, which announces its pipe for the extension's profile`,
    loaded.id === installed.extensionIds[0] && Boolean(host?.pipeName), JSON.stringify({ loaded, host }));
  // The pipe's access list, read through a client handle of the pipe itself (no control host is connected yet).
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`.toLowerCase();
  const pipeShortName = host.pipeName.slice("\\\\.\\pipe\\".length);
  const access = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", [
    `$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', '${pipeShortName}', [System.IO.Pipes.PipeDirection]::InOut)`,
    "$pipe.Connect(5000)",
    "$rules = $pipe.GetAccessControl().GetAccessRules($true, $true, [System.Security.Principal.NTAccount])",
    "$pipe.Dispose()",
    "@($rules | ForEach-Object { @{ who = $_.IdentityReference.Value; type = $_.AccessControlType.ToString() } }) | ConvertTo-Json -Compress",
  ].join("; ")]).toString() || "[]");
  const entries = Array.isArray(access) ? access : [access];
  check(`${label}only the current user may open the pipe`,
    entries.length === 1 && entries[0].who.toLowerCase() === user && entries[0].type === "Allow",
    JSON.stringify(entries));
  const squatter = createPipeServer();
  const squatted = await new Promise((resolve) => {
    squatter.once("error", () => resolve(false));
    squatter.listen(host.pipeName, () => resolve(true));
  });
  squatter.close();
  check(`${label}a second process cannot serve the same pipe`, squatted === false);

  await mkdir(join(localAppData, "pyproc", "userBrowser", "pairing"), { recursive: true });
  await writeFile(join(localAppData, "pyproc", "userBrowser", "pairing", `${host.profileId}.key`),
    JSON.stringify({ key, browser: kind, profileId: host.profileId, product: host.product }));

  const memoryRoot = join(app.appDir, `.motor-memory-${kind}`);
  await mkdir(memoryRoot, { recursive: true });
  const configPath = join(app.appDir, `pyproc-user-browser-${kind}.json`);
  // Edge runs beside a Machine; Chrome runs in a browser-only host, the way a consumer that needs no Python uses it.
  const engine = kind === "edge" ? { root: join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core") }
    : { enabled: false };
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine, timeoutMs: TIMEOUT_MS,
    browser: { enabled: true, provider: "userBrowser", userBrowser: kind, allowedOrigins: [origin],
      maxRisk: "externalEffect", actions: ["snapshot", "screenshot", "click"], methods: [],
      externalEffects: "acknowledged", purpose: "Verify the user-browser provider fixture", artifacts: {},
      exportRoot: join(app.appDir, `exports-${kind}`) },
    executionMemory: { enabled: true, root: memoryRoot, importRoots: [], secretEnv: [] },
    actuation: { enabled: true } }, null, 2));
  const publicRequire = createRequire(join(app.appDir, "package.json"));
  const { PyProcControlClient } = await import(pathToFileURL(publicRequire.resolve("pyproc/control")).href);
  const controlScript = join(app.appDir, "node_modules", "pyproc", "scripts", "pyprocControl.mjs");
  client = await PyProcControlClient.start(configPath, { command: [process.execPath, controlScript],
    cwd: app.appDir, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const space = (await client.inspectSpace()).output.space;
  check(`${label}the Control product runs the userBrowser provider`, space.providerKind === "userBrowser",
    JSON.stringify({ providerKind: space.providerKind }));

  const effectsBefore = effects;
  const task = await client.openMotorTask({ url: `${origin}/fixture`, expectedRisk: "externalEffect" });
  const observed = await task.situate({ requirements: [{ requirementRef: "requirement:save",
    select: { role: "button", name: "Save" }, need: ["fact", "affordance"], cardinality: "one" }] },
  { visual: { mode: "off" }, budget: { maxEntities: 100, maxRelations: 200, maxBytes: 131072 } });
  const situation = observed.situation;
  const affordance = situation.affordances.find((entry) => entry.kind === "authorized" && entry.action === "click");
  const executed = await task.execute({ situation, requirementRef: "requirement:save", intent: {
    intent: "activate", target: { spaceRef: space.spaceId, entityRef: situation.requirements[0].entityRefs[0],
      worldRef: situation.worldRef, surfaceEpoch: `document:${situation.documentEpoch}` },
    desired: { activated: true }, preconditions: [], expectedTransition: { all: [
      { entityAppeared: { role: "status", name: "saved" } },
      { networkResponse: { method: "POST", urlPath: "/save", status: 201 } }], withinMs: 5000 },
    authority: { actionCapabilityRef: affordance.capabilityRef, approvalGrantRef: null, commitLeaseRef: null,
      controlLeaseRef: null }, policy: { allowedActuatorKinds: ["browserInput"], allowPreContactFallback: false } } },
  { timeoutMs: TIMEOUT_MS });
  check(`${label}Motor in the user's browser sends one effect and closes with semantic plus network proof`,
    executed.output.terminal === "confirmed" && executed.output.receipt.effectWindow.providerCalls === 1
      && effects === effectsBefore + 1, JSON.stringify({ terminal: executed.output.terminal, effects }));
  const shot = await client.act(task.sessionRef, [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
  check(`${label}a screenshot of the task tab comes back as a PNG attachment`,
    shot.attachments.some((attachment) => attachment.mimeType === "image/png" && attachment.byteLength > 1000));
  const downloaded = await client.act(task.sessionRef, [{ kind: "click", selector: "#report", download: true,
    timeoutMs: 20000, expectedRisk: "externalEffect" }]);
  const receipt = downloaded.output.actions[0].result.download;
  const browserCopy = join(downloadsDir, "report.pdf");
  check(`${label}a download the task tab starts comes back as a receipt, is exported, and stays where the browser saved it`,
    receipt?.mimeType === "application/pdf" && receipt.mimeEvidence === "signature"
      && receipt.declaredMimeType === "application/pdf" && receipt.exportedFile?.name === "report.pdf"
      && existsSync(receipt.exportedFile.path) && existsSync(browserCopy)
      && Buffer.compare(await readFile(receipt.exportedFile.path), REPORT_PDF) === 0,
    JSON.stringify({ receipt: receipt && { mimeType: receipt.mimeType, declared: receipt.declaredMimeType,
      exportedFile: receipt.exportedFile }, browserCopy: existsSync(browserCopy) }));
  const cleanup = await task.close();
  const remaining = await client.listTargets();
  check(`${label}closing the task detaches and closes the tab it opened, without retrying the effect`,
    cleanup.state === "complete" && remaining.output.length === 0 && effects === effectsBefore + 1,
    JSON.stringify(cleanup));
  await client.close();
  client = null;

  const raw = async () => new CdpConnection(userBrowserPipeChannel(await new Promise((resolve, reject) => {
    const socket = connect(host.pipeName);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  })), { timeoutMs: 30000 });
  const refusal = (promise) => promise.then(() => "", (error) => String(error.message));
  const stranger = await waitFor(() => raw(), 10000);
  const wrongKey = await refusal(stranger.send("PyprocUserBrowser.hello", { key: "0".repeat(64) }));
  const unpairedOpen = await refusal(stranger.send("PyprocUserBrowser.openTab", { url: `${origin}/fixture` }));
  stranger.close();
  check(`${label}a control host without the paired key is refused before it can open anything`,
    /not the one this browser paired with/.test(wrongKey) && /not paired/.test(unpairedOpen));

  const paired = await waitFor(() => raw(), 10000);
  await paired.send("PyprocUserBrowser.hello", { key });
  const busy = await refusal(new Promise((resolve, reject) => {
    const socket = connect(host.pipeName);
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  }));
  check(`${label}the pipe serves one control host at a time`, busy !== "", busy);
  const { targetId } = await paired.send("PyprocUserBrowser.openTab", { url: `${origin}/fixture` });
  const { sessionId } = await paired.send("PyprocUserBrowser.attachTab", { targetId });
  const cookies = await refusal(paired.send("Network.getCookies", {}, sessionId));
  const storage = await refusal(paired.send("Storage.getCookies", {}, sessionId));
  const targets = await refusal(paired.send("Target.getTargets", {}, sessionId));
  const outside = await refusal(paired.send("PyprocUserBrowser.attachTab", { targetId: String(Number(targetId) + 1000) }));
  check(`${label}the extension refuses cookies, storage, and browser targets, and tabs outside the task`,
    [cookies, storage, targets].every((message) => /refused in a user browser/.test(message))
      && /not one of this task's tabs/.test(outside), JSON.stringify({ cookies, storage, targets, outside }));
  const evaluated = await paired.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }, sessionId);
  check(`${label}a task tab answers tab-level CDP through the relay`, evaluated.result?.value === "user browser fixture");
  await paired.send("PyprocUserBrowser.endTask");
  const afterEnd = await paired.send("PyprocUserBrowser.listTabs");
  const pageTargets = (await direct.send("Target.getTargets")).targetInfos.filter((info) => info.url.startsWith(origin));
  check(`${label}ending the task leaves no task tab and no fixture page behind`,
    afterEnd.tabs.length === 0 && pageTargets.length === 0, JSON.stringify({ tabs: afterEnd.tabs, pageTargets }));
  paired.close();

  if (kind === BROWSERS[0].kind) {
    // Setting up again while this browser runs the host swaps the file in without stopping the running host.
    const again = await setupUserBrowser(setupOptions);
    const { hostIntact } = await userBrowserInstallStatus({ installRoot });
    const serving = (await listUserBrowserHosts()).some((entry) => entry.profileId === host.profileId);
    check(`${label}setting up again while the host runs replaces its file and leaves the running host serving`,
      again.hostPath === installed.hostPath && hostIntact && serving,
      JSON.stringify({ hostSource: again.hostSource, hostIntact, serving }));
  }

  browser.close();
  browser = null;
  const gone = await waitFor(async () => !(await listUserBrowserHosts()).some((entry) => product.test(entry.product)),
    20000);
  check(`${label}once the browser is gone no host is announced, even when the browser was killed`, gone === true);
  const pairing = (await userBrowserStatus()).pairings.find((entry) => entry.profileId === host.profileId);
  check(`${label}a paired browser that is closed is still reported as paired, not running`,
    pairing?.browser === kind && pairing.running === false, JSON.stringify(pairing));
}

try {
  check("Edge and Chrome are both installed for the gate", BROWSERS.length === 2,
    BROWSERS.map((entry) => entry.kind).join(","));
  const installed = await setupUserBrowser(setupOptions);
  check(`setup installs the ${installed.hostSource} native host and registers it for Chrome and Edge under the given name`,
    installed.hostSource === (setupOptions.hostBinary ? "given" : "cargo") && existsSync(installed.hostPath) && ["Microsoft\\Edge", "Google\\Chrome"].every((vendor) => execFileSync("reg",
      ["query", `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${hostName}`, "/ve"]).toString()
      .includes(installed.manifestPath)));
  await hostChecks(installed.hostPath);
  const app = await installPackedPyProc("pyprocUserBrowser-");
  for (const entry of BROWSERS) {
    try { await journey(entry, installed, app); }
    catch (error) {
      check(`${entry.kind}: user browser journey has no exception`, false, String(error?.stack || error).slice(-1600));
      if (client) await client.close().catch(() => {});
      client = null;
      browser?.close();
      browser = null;
    }
  }
} catch (error) {
  check("user browser gate has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  if (client) await client.close().catch(() => {});
  browser?.close();
  await removeUserBrowser({ installRoot }).catch(() => {});
  await rm(localAppData, { recursive: true, force: true }).catch(() => {});
  await new Promise((resolve) => fixture.close(resolve));
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
