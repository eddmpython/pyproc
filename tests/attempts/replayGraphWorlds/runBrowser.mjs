import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { connectNodeBrowserControl } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { launchBrowser } from "../../browser/harness.mjs";

let effects = 0;
const server = createStaticServer(async (request, response) => {
  if (new URL(request.url, "http://fixture.invalid").pathname !== "/effect") return false;
  for await (const chunk of request) void chunk;
  effects += 1;
  response.writeHead(201, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ effects }));
  return true;
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let broker;
try {
  browser = launchBrowser("about:blank", { prefix: "pyprocReplayGraphProbe-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  broker = await connectNodeBrowserControl({ profileDir: browser.profile, targetOrigins: [origin],
    methods: ["Runtime.evaluate"], events: [], maxRisk: "externalEffect", timeoutMs: 60000 });
  const target = await broker.openTarget(`${origin}/tests/attempts/replayGraphWorlds/transactionalBranchProbe.html`,
    { waitUntil: "load" });
  const session = await broker.attach(target.targetRef);
  const result = await broker.command(session, { method: "Runtime.evaluate", params: { expression: `
    new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const poll = () => {
      if (globalThis.replayGraphProbe) resolve(globalThis.replayGraphProbe);
      else if (Date.now() >= deadline) reject(new Error("ReplayGraph probe timeout"));
      else setTimeout(poll, 20); }; poll(); })`, awaitPromise: true, returnByValue: true },
  expectedRisk: "externalEffect" });
  const report = result.result.result.value;
  let failed = 0;
  for (const entry of report.checks) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}`);
    if (!entry.pass) failed += 1;
  }
  const noSend = effects === 0;
  console.log(`  ${noSend ? "PASS" : "FAIL"} graph construction and traversal send no external effect`);
  if (!noSend) failed += 1;
  console.log(`ReplayGraph browser probe: ${failed ? "RED" : "GREEN"} (${report.checks.length + 1} checks)`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
} finally {
  try { await broker?.close(); } catch (error) {}
  try { browser?.close(); } catch (error) {}
  await new Promise((resolve) => server.close(resolve));
}
