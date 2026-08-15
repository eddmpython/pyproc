// coiDocumentReplacementProbe.mjs - 첫 load 뒤 문서가 교체돼도 proof-carrying action이 한 번에 수렴하는지 실측한다.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, run } from "../../packageHarness.mjs";

const expectStale = process.argv.includes("--expect-stale");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let effects = 0;

const initialHtml = `<!doctype html><html><body><button>Continue</button><script>
  addEventListener("load", () => setTimeout(() => location.replace("/final"), 1000));
</script></body></html>`;
const finalHtml = `<!doctype html><html><body><button id="continue">Continue</button><output role="status">ready</output><script>
  document.querySelector("#continue").addEventListener("click", async () => {
    const response = await fetch("/effect", { method: "POST" });
    document.querySelector("output").textContent = response.ok ? "done" : "failed";
  });
</script></body></html>`;

const server = createServer((request, response) => {
  if (request.url === "/effect" && request.method === "POST") {
    effects += 1;
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ effects }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(request.url === "/final" ? finalHtml : initialHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const installed = await installPackedPyProc("pyprocCoiDocumentReplacementProbe-");
const configPath = join(installed.appDir, ".pyproc", "manifest.json");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const cli = binPath(installed.appDir, "pyproc-mcp");
let client = null;
let targetRef = null;
let sessionRef = null;

try {
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--origin", origin, "--action", "snapshot", "--action", "click",
    "--max-risk", "externalEffect", "--purpose", "COI document replacement convergence probe",
    "--acknowledge-effects"], { cwd: installed.appDir });
  const publicRequire = createRequire(join(installed.appDir, "package.json"));
  const { PyProcControlClient } = await import(pathToFileURL(publicRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, {
    command: [process.execPath, join(packageRoot, "scripts", "pyprocControl.mjs")],
    cwd: installed.appDir,
    startupTimeoutMs: 120000,
  });
  const opened = await client.openTarget(`${origin}/initial`, {
    expectedRisk: "externalEffect", waitUntil: "load", timeoutMs: 30000,
  });
  targetRef = opened.output.targetRef;
  const attached = await client.attachSession(targetRef);
  sessionRef = attached.output;
  const perception = client.perception(sessionRef);
  const situation = await perception.situate({ requirements: [{
    requirementRef: "requirement:continue",
    select: { role: "button", name: "Continue", actionable: true },
    need: ["fact", "affordance"], cardinality: "one",
  }] }, { visual: { mode: "off" } });
  const beforeEpoch = situation.situation.documentEpoch;
  const affordance = situation.requirement("requirement:continue").oneAffordance("click");
  await delay(1500);
  let error = null;
  let result = null;
  try { result = await perception.actAffordance(affordance, {
    verify: { entityAppeared: { role: "status", name: "done" }, withinMs: 5000 },
  }); }
  catch (caught) { error = caught; }
  const report = Object.freeze({
    beforeEpoch,
    terminal: result?.terminal || null,
    error: error ? { code: error.code, outcome: error.outcome, retryable: error.retryable } : null,
    effects,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const stale = error?.code === "BROWSER_AUTOMATION_STALE_LOCATOR"
    && error.outcome === "notSent" && error.retryable === true && effects === 0;
  const converged = !error && result?.terminal === "completed"
    && result.output?.actions?.[0]?.result?.evidence?.verification?.state === "confirmed" && effects === 1;
  if (expectStale ? !stale : !converged) process.exitCode = 1;
} finally {
  if (client && sessionRef) await client.detachSession(sessionRef).catch(() => {});
  if (client && targetRef) await client.closeTarget(targetRef).catch(() => {});
  await client?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(installed.tmp, { recursive: true, force: true });
}
