// browserControlStress.mjs - semantic actionability와 remote object 수명주기의 반복 실브라우저 게이트.
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { connectNodeBrowserControl } from "../../scripts/browserControl/browserControlBroker.mjs";
import { BrowserAutomation } from "../../scripts/browserControl/browserAutomation.js";
import { BROWSER_AUTOMATION_ACTIONS } from "../../scripts/browserControl/browserAutomationCatalog.js";
import { launchBrowser } from "./harness.mjs";

const ROUNDS = Math.max(1, Math.min(20, Number(process.env.PYPROC_BROWSER_CONTROL_STRESS_ROUNDS || 3)));
const ACTIONS_PER_ROUND = 16;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createStaticServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const targetUrl = `${origin}/tests/browser/browserControlTarget.html`;
let browser = null;
let broker = null;
let automation = null;

try {
  browser = launchBrowser(targetUrl, {
    prefix: "pyprocBrowserControlStress-",
    extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
  });
  broker = await connectNodeBrowserControl({
    profileDir: browser.profile,
    targetOrigins: [origin],
    methods: BROWSER_AUTOMATION_ACTIONS.focus.methods,
    maxRisk: "externalEffect",
    timeoutMs: 30000,
  });
  let target = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !target) {
    target = (await broker.listTargets()).find((entry) => entry.url === targetUrl);
    if (!target) await delay(50);
  }
  if (!target) throw new Error("stress target did not become ready");
  const sessionRef = await broker.attach(target.targetRef);
  automation = new BrowserAutomation({ port: broker.port, actions: ["focus"] });
  let completed = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const run = await automation.run(sessionRef, Array.from({ length: ACTIONS_PER_ROUND }, () => ({
      kind: "focus",
      locator: { by: "label", value: "Work email" },
      timeoutMs: 10000,
      expectedRisk: "externalEffect",
    })));
    if (run.actions.length !== ACTIONS_PER_ROUND
      || !run.actions.every((action) => action.result?.actionability?.polls >= 3)
      || !run.trace.steps.every((step) => step.commands.some((command) => command.method === "Runtime.releaseObject"))) {
      throw new Error(`stress round ${round + 1} returned an incomplete action or release trace`);
    }
    completed += run.actions.length;
  }
  automation.dropSession(sessionRef);
  const resources = automation.inspect();
  await broker.detach(sessionRef);
  if (resources.locators !== 0 || resources.lifecycle.sessions !== 0 || resources.observation.sessions !== 0) {
    throw new Error(`stress cleanup failed: ${JSON.stringify(resources)}`);
  }
  console.log(`browser control stress green: ${completed} actions across ${ROUNDS} rounds`);
} catch (error) {
  const detail = {
    code: error?.code || null,
    outcome: error?.outcome || null,
    failedActionIndex: error?.failedActionIndex ?? null,
    actionability: error?.actionability || null,
    trace: error?.trace?.steps?.at(-1) || null,
  };
  console.error(`browser control stress red: ${error?.message || error} ${JSON.stringify(detail)}`);
  process.exitCode = 1;
} finally {
  try { automation?.close(); } catch (error) {}
  try { await broker?.close(); } catch (error) {}
  try { browser?.close(); } catch (error) {}
  await new Promise((resolve) => server.close(resolve));
}
