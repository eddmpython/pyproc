import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { connectNodeBrowserControl } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { launchBrowser } from "../../browser/harness.mjs";

const server = createStaticServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let broker;
try {
  browser = launchBrowser("about:blank", { prefix: "pyprocMotorProbe-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  broker = await connectNodeBrowserControl({ profileDir: browser.profile, targetOrigins: [origin],
    methods: ["Runtime.evaluate"], events: [], maxRisk: "externalEffect", timeoutMs: 60000 });
  const target = await broker.openTarget(`${origin}/tests/attempts/proofCarryingMotor/activateWindowProbe.html`,
    { waitUntil: "load" });
  const session = await broker.attach(target.targetRef);
  const result = await broker.command(session, { method: "Runtime.evaluate", params: { expression: `
    new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const poll = () => {
      if (globalThis.motorProbe) resolve(globalThis.motorProbe);
      else if (globalThis.motorError) resolve({ error: globalThis.motorError });
      else if (Date.now() >= deadline) resolve({ error: "Motor probe timeout", href: location.href,
        title: document.title, readyState: document.readyState, body: document.body?.innerText });
      else setTimeout(poll, 20); }; poll(); })`, awaitPromise: true, returnByValue: true },
  expectedRisk: "externalEffect" });
  const report = result.result.result.value;
  if (!Array.isArray(report?.checks)) throw new Error(`Motor page probe did not return checks: ${JSON.stringify(result)}`);
  let failed = 0;
  for (const entry of report.checks) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}`);
    if (!entry.pass) failed += 1;
  }
  console.log(`Proof-Carrying Motor browser probe: ${failed ? "RED" : "GREEN"} (${report.checks.length} checks)`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
} finally {
  try { await broker?.close(); } catch {}
  try { browser?.close(); } catch {}
  await new Promise((resolve) => server.close(resolve));
}
