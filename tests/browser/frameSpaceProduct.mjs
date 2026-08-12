// frameSpaceProduct.mjs - 설치 tarball의 Python machine과 cooperative frame 자동화 제품 게이트.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const installed = await installPackedPyProc("pyprocFrameSpace-");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const bridgeSource = await readFile(join(packageRoot, "scripts", "automationSpace", "frameSpaceTarget.js"));
function targetServer(label) {
  let requests = 0;
  let redirectUrl = "";
  const server = createServer((req, res) => {
    requests += 1;
    if (req.url === "/redirect-denied" && redirectUrl) {
      res.writeHead(302, { Location: redirectUrl, "Cache-Control": "no-store" });
      res.end();
      return;
    }
    const headers = { "Cache-Control": "no-store" };
    if (req.url === "/frameSpaceTarget.js") {
      res.writeHead(200, { ...headers, "Content-Type": "text/javascript; charset=utf-8" });
      res.end(bridgeSource);
      return;
    }
    if (req.url === "/bad-png") {
      const badPng = Buffer.from([137, 80, 78, 71, 0, 0, 0, 0]).toString("base64");
      res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><script>
        addEventListener('message',(event)=>{const port=event.ports&&event.ports[0], hello=event.data;
          if(!port||hello.type!=='hello')return; port.onmessage=({data})=>port.postMessage({protocol:'pyproc-frame',version:1,
            type:'response',id:data.id,ok:true,value:{kind:'screenshot',mimeType:'image/png',byteLength:8,
              sha256:'${"0".repeat(64)}',dataBase64:'${badPng}',width:1,height:1}});
          port.start();port.postMessage({protocol:'pyproc-frame',version:1,type:'hello',nonce:hello.nonce,
            url:location.href,title:'bad-png',targetEpoch:crypto.randomUUID(),parentAccessible:false,
            storageAccessible:false,cookieAccessible:false,bridgeVersion:1})});
        addEventListener('load',()=>setTimeout(()=>parent.postMessage({protocol:'pyproc-frame',version:1,type:'ready'},'*'),0));
      </script>`);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${label}</title></head>
      <body><h1>${label}</h1><label>Name <input id="name" value="before"></label>
      <button id="apply">Apply</button><button id="effect-then-throw">Effect then throw</button><output id="result">waiting</output>
      <script>document.querySelector('#apply').addEventListener('click',()=>{document.querySelector('#result').textContent=document.querySelector('#name').value})</script>
      <script>{const button=document.querySelector('#effect-then-throw'), nativeClick=button.click.bind(button);
        button.addEventListener('click',()=>{document.querySelector('#result').textContent='effect-once'});
        button.click=()=>{nativeClick();throw new Error('after effect')};}</script>
      <script>addEventListener('load',()=>{const spam=setInterval(()=>parent.postMessage({protocol:'pyproc-frame',version:1,type:'ready'},'*'),2);
        addEventListener('beforeunload',()=>clearInterval(spam),{once:true})})</script>
      <script>let attacked=false;addEventListener('message',(event)=>{if(attacked||event.data?.type!=='hello')return;
        attacked=true;fetch(event.origin+'/controlReady',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},
          body:JSON.stringify({protocol:'pyproc-control',version:1,pageEpoch:'attacker',spaceId:'machine:attacker'})}).catch(()=>{})})</script>
      <script src="/frameSpaceTarget.js"></script></body></html>`);
  });
  return { server, requests: () => requests, setRedirect: (url) => { redirectUrl = url; } };
}
const targetA = targetServer("frame-a");
const targetB = targetServer("frame-b");
const denied = targetServer("denied");
for (const target of [targetA, targetB, denied]) {
  await new Promise((resolve) => target.server.listen(0, "127.0.0.1", resolve));
}
const originA = `http://127.0.0.1:${targetA.server.address().port}`;
const originB = `http://127.0.0.1:${targetB.server.address().port}`;
const deniedOrigin = `http://127.0.0.1:${denied.server.address().port}`;
targetA.setRedirect(`${deniedOrigin}/redirected`);

const configPath = join(installed.appDir, "pyproc-frame.json");
await writeFile(configPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: TIMEOUT_MS,
  browser: {
    enabled: true,
    provider: "frame",
    ...(process.env.PYPROC_BROWSER ? { executable: process.env.PYPROC_BROWSER } : {}),
    allowedOrigins: [originA, originB],
    maxRisk: "externalEffect",
    actions: ["snapshot", "screenshot", "waitFor", "navigate", "fill", "click"],
    methods: [],
    externalEffects: "acknowledged",
    purpose: "FrameSpace installed product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
  },
}, null, 2));

const cli = binPath(installed.appDir, "pyproc-control");
const report = JSON.parse(run(cli, ["--config", configPath, "--check"], { cwd: installed.appDir }).stdout);
check("preflight selects FrameSpace without raw methods", report.ok === true
  && report.automation.provider === "frame" && report.automation.rawMethods.length === 0);
const mcpCli = binPath(installed.appDir, "pyproc-mcp");
const mcpReport = JSON.parse(run(mcpCli, ["--config", configPath, "--check"], { cwd: installed.appDir }).stdout);
check("MCP preflight reports the same FrameSpace provider", mcpReport.browser.provider === "frame");

const clientFile = join(packageRoot, "scripts", "controlProtocol", "controlClient.js");
const { ControlRemoteError, ControlStdioClient } = await import(pathToFileURL(clientFile).href);
const child = spawn(process.execPath, [join(packageRoot, "scripts", "pyprocControl.mjs"), "--config", configPath], {
  cwd: installed.appDir,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr = (stderr + String(chunk)).slice(-8000);
  process.stderr.write(chunk);
});
const client = new ControlStdioClient({ readable: child.stdout, writable: child.stdin,
  peer: { name: "frame-product-gate", version: "1" } });
let mcpChild = null;

console.log("installed FrameSpace product gate");
try {
  await Promise.race([client.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`FrameSpace hello timeout\n${stderr}`)), TIMEOUT_MS))]);
  check("one wire advertises machine plus nine FrameSpace operations",
    client.operations.length === 13 && !client.operations.includes("automation.command"));

  await client.request("machine.run", { code: "frameState = 40" });
  const state = await client.request("machine.run", { code: "frameState + 2" });
  check("Python state remains persistent beside FrameSpace", state.output.value === "42");

  const inspected = await client.request("automation.space.inspect", {});
  check("inspect declares credentialless sandbox and provider boundary",
    inspected.output.space?.providerKind === "frame"
      && inspected.output.space?.capabilities?.join(",") === "dom,target,screenshot,artifact"
      && inspected.output.transport === "messageChannel"
      && inspected.output.sandbox === "allow-scripts allow-forms"
      && inspected.output.credentialless === true);

  const opened = await client.request("automation.target.open", {
    url: `${originA}/first`, expectedRisk: "externalEffect", waitUntil: "load",
  });
  check("allowed target returns an opaque frame reference", typeof opened.output.targetRef === "string",
    JSON.stringify(opened.output));
  if (typeof opened.output.targetRef !== "string") throw new Error(`FrameSpace open output is invalid: ${JSON.stringify(opened.output)}`);
  const attached = await client.request("automation.session.attach", { targetRef: opened.output.targetRef });
  const first = await client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", mode: "interactive",
  });
  check("cooperative target proves it cannot access parent DOM",
    opened.output.parentAccessible === false && opened.output.storageAccessible === false
      && opened.output.cookieAccessible === false && opened.output.credentialless === true
      && first.output.parentAccessible === false && first.output.nodes.some((node) => node.id === "name"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterAttack = await client.request("machine.run", { code: "frameState + 3" });
  check("frame target cannot replace the authenticated control page epoch", afterAttack.output.value === "43");

  let partial = null;
  try {
    await client.request("automation.act", {
      sessionRef: attached.output,
      actions: [
        { kind: "fill", selector: "#name", value: "partial", expectedRisk: "externalEffect" },
        { kind: "click", selector: "#missing", expectedRisk: "externalEffect" },
      ],
    });
  } catch (error) { partial = error; }
  check("partial effect failure preserves completed prefix and applied outcome",
    partial instanceof ControlRemoteError && partial.outcome === "applied"
      && partial.details?.failedActionIndex === 1 && partial.details?.completed?.length === 1);

  let firstUnknown = null;
  try {
    await client.request("automation.act", { sessionRef: attached.output,
      actions: [{ kind: "click", selector: "#effect-then-throw", expectedRisk: "externalEffect" }] });
  } catch (error) { firstUnknown = error; }
  const effectObserved = await client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", mode: "interactive",
  });
  check("first effect failure is outcomeUnknown and the effect is not replayed",
    firstUnknown instanceof ControlRemoteError && firstUnknown.outcome === "outcomeUnknown"
      && firstUnknown.retryable === false
      && effectObserved.output.nodes.some((node) => node.id === "result" && node.text === "effect-once"));

  await client.request("automation.act", {
    sessionRef: attached.output,
    actions: [
      { kind: "fill", selector: "#name", value: "frame-ready", expectedRisk: "externalEffect" },
      { kind: "click", selector: "#apply", expectedRisk: "externalEffect" },
      { kind: "waitFor", selector: "#result", state: "visible", expectedRisk: "read" },
    ],
  });
  const changed = await client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", mode: "interactive",
  });
  check("ordered semantic actions change only the sandbox target",
    changed.output.nodes.some((node) => node.id === "result" && node.text === "frame-ready"));

  const captured = await client.request("automation.act", {
    sessionRef: attached.output,
    actions: [{ kind: "screenshot", expectedRisk: "read" }],
  });
  const attachment = captured.attachments[0];
  const png = Buffer.from(attachment.bytes);
  const descriptor = captured.output.results[0];
  check("screenshot becomes a digest-verified native attachment",
    captured.outcome === "observed" && captured.attachments.length === 1
      && descriptor.artifactRef.startsWith("artifact:")
      && !Object.hasOwn(descriptor, "dataBase64")
      && createHash("sha256").update(png).digest("hex") === attachment.sha256
      && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${png.byteLength} bytes`);

  await client.request("automation.act", {
    sessionRef: attached.output,
    actions: [{ kind: "navigate", url: `${originA}/second`, expectedRisk: "externalEffect" },
      { kind: "navigate", url: `${originB}/cross`, expectedRisk: "externalEffect" }],
  });
  const afterNavigate = await client.request("automation.observe", {
    sessionRef: attached.output, expectedRisk: "read", mode: "interactive",
  });
  check("same-origin and allowed cross-origin navigation keep one session",
    afterNavigate.output.url.startsWith(originB) && afterNavigate.output.parentAccessible === false);

  const beforeDenied = denied.requests();
  let deniedError = null;
  try {
    await client.request("automation.target.open", {
      url: `${deniedOrigin}/blocked`, expectedRisk: "externalEffect",
    });
  } catch (error) { deniedError = error; }
  check("denied origin stops before network or frame creation",
    deniedError instanceof ControlRemoteError && deniedError.code === "FRAME_SPACE_PERMISSION_DENIED"
      && deniedError.outcome === "notSent" && denied.requests() === beforeDenied);

  let redirected = null;
  try {
    await client.request("automation.target.open", {
      url: `${originA}/redirect-denied`, expectedRisk: "externalEffect",
    });
  } catch (error) { redirected = error; }
  check("redirect outside frame-src is blocked after navigation with an applied outcome",
    redirected instanceof ControlRemoteError && redirected.code === "FRAME_SPACE_BRIDGE_UNAVAILABLE"
      && redirected.outcome === "applied", `${redirected?.code}/${redirected?.outcome}`);

  const badOpened = await client.request("automation.target.open", {
    url: `${originA}/bad-png`, expectedRisk: "externalEffect",
  });
  const badSession = await client.request("automation.session.attach", { targetRef: badOpened.output.targetRef });
  let badArtifact = null;
  try {
    await client.request("automation.act", { sessionRef: badSession.output,
      actions: [{ kind: "screenshot", expectedRisk: "read" }] });
  } catch (error) { badArtifact = error; }
  check("invalid PNG signature is rejected before artifact creation",
    badArtifact instanceof ControlRemoteError && badArtifact.code === "FRAME_SPACE_ARTIFACT_INVALID");
  await client.request("automation.session.detach", { sessionRef: badSession.output });

  const chunk = await client.request("artifact.read", { artifactRef: descriptor.artifactRef, maxBytes: 128 });
  check("artifact chunk stays data rather than becoming a second attachment",
    chunk.attachments.length === 0 && chunk.output.offset === 0 && typeof chunk.output.dataBase64 === "string");
  await client.request("artifact.delete", { artifactRef: descriptor.artifactRef });
  await client.request("automation.session.detach", { sessionRef: attached.output });

  mcpChild = spawn(process.execPath, [join(packageRoot, "scripts", "pyprocMcp.mjs"), "--config", configPath], {
    cwd: installed.appDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env },
  });
  let mcpStderr = "";
  mcpChild.stderr.on("data", (chunk) => { mcpStderr = (mcpStderr + String(chunk)).slice(-8000); });
  const mcpWaiters = new Map();
  let mcpSequence = 0;
  createInterface({ input: mcpChild.stdout, crlfDelay: Infinity }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch (error) { return; }
    const waiter = mcpWaiters.get(message.id);
    if (waiter) { mcpWaiters.delete(message.id); waiter(message); }
  });
  const mcpRequest = (method, params = {}) => {
    const id = ++mcpSequence;
    mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { mcpWaiters.delete(id); reject(new Error(`${method} timeout\n${mcpStderr}`)); }, TIMEOUT_MS);
      mcpWaiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
    });
  };
  const callTool = (name, args = {}) => mcpRequest("tools/call", { name, arguments: args });
  const toolText = (response) => JSON.parse(response.result.content[0].text);
  await mcpRequest("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "frame-mcp-gate", version: "1" } });
  mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const mcpTools = (await mcpRequest("tools/list")).result.tools.map((tool) => tool.name);
  const mcpOpened = toolText(await callTool("browserOpen", {
    url: `${originB}/mcp`, expectedRisk: "externalEffect",
  }));
  const mcpSession = toolText(await callTool("browserAttach", { targetRef: mcpOpened.targetRef }));
  const mcpCapture = await callTool("browserAct", { sessionRef: mcpSession,
    actions: [{ kind: "screenshot", expectedRisk: "read" }] });
  const mcpImages = mcpCapture.result.content.filter((entry) => entry.type === "image");
  check("installed MCP adapter keeps the FrameSpace tool and native image contract",
    mcpTools.length === 13 && !mcpTools.includes("browserCommand") && mcpImages.length === 1
      && Buffer.from(mcpImages[0].data, "base64").subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  await callTool("browserDetach", { sessionRef: mcpSession });
} catch (error) {
  check("FrameSpace installed journey has no exception", false, String(error?.stack || error).slice(-1200));
} finally {
  client.close();
  if (mcpChild?.exitCode === null) mcpChild.kill("SIGTERM");
  if (mcpChild) await new Promise((resolve) => mcpChild.exitCode === null ? mcpChild.once("exit", resolve) : resolve());
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => child.exitCode === null ? child.once("exit", resolve) : resolve());
  for (const target of [targetA, targetB, denied]) target.server.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
