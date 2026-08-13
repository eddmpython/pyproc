import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { connectNodeBrowserControl } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { launchBrowser } from "../../browser/harness.mjs";

let effects = 0;
const server = createStaticServer(async (request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  if (url.pathname !== "/oneShotEffect") return false;
  for await (const chunk of request) void chunk;
  effects += 1;
  response.writeHead(201, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  response.end(String(effects));
  return true;
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let broker;
let failed = 0;
const check = (name, pass, info = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"} ${name}${info ? ` (${info})` : ""}`);
  if (!pass) failed += 1;
};
try {
  browser = launchBrowser("about:blank", { prefix: "pyprocOneShotProbe-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  broker = await connectNodeBrowserControl({ profileDir: browser.profile, targetOrigins: [origin],
    methods: ["Runtime.evaluate"], events: [], maxRisk: "externalEffect", timeoutMs: 60000 });
  const target = await broker.openTarget(`${origin}/tests/attempts/rehearseCommitTransactions/oneShotLeaseProbe.html`,
    { waitUntil: "load" });
  const session = await broker.attach(target.targetRef);
  const evaluate = async (expression) => (await broker.command(session, { method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true }, expectedRisk: "externalEffect" })).result.result.value;
  await evaluate("new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const poll = () => { if (globalThis.oneShotProbe) resolve(true); else if (Date.now() > deadline) reject(new Error('probe timeout')); else setTimeout(poll, 20); }; poll(); })");
  const race = await evaluate("globalThis.oneShotProbe.race()");
  check("two browser contenders produce one external request", effects === 1
    && race.filter((entry) => entry.sent).length === 1, JSON.stringify({ effects, race }));
  await evaluate("globalThis.oneShotProbe.leaveSending()");
  await evaluate("location.reload(); true");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await evaluate("new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const poll = () => { if (globalThis.oneShotProbe) resolve(true); else if (Date.now() > deadline) reject(new Error('probe timeout')); else setTimeout(poll, 20); }; poll(); })");
  const recovered = await evaluate("globalThis.oneShotProbe.recover()");
  check("reload recovers sending as outcomeUnknown without resend", effects === 1
    && recovered.state === "outcomeUnknown", JSON.stringify({ effects, recovered }));
  await broker.detach(session);
} catch (error) {
  check("browser probe completes", false, String(error?.stack || error).slice(0, 600));
} finally {
  try { await broker?.close(); } catch (error) {}
  try { browser?.close(); } catch (error) {}
  await new Promise((resolve) => server.close(resolve));
}
console.log(`결과: ${failed === 0 ? "GREEN" : "RED"}`);
process.exit(failed === 0 ? 0 : 1);
