// consoleDiagnosticsProduct.mjs - the console channel through the public Control client. A page that throws an uncaught
// exception and fails to load a resource while it loads shows both, each with the time it happened, beside the page's
// own console call, once an observation asks for console events; URLs in their text lose their query. A session that never
// asks turns on neither the Runtime nor the Log domain and gets no console events.
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../packageHarness.mjs";
import { PyProcControlClient } from "../../scripts/controlProtocol/controlApi.js";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const executable = process.env.PYPROC_BROWSER || undefined;
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}

const page = `<!doctype html><title>diagnostics</title><p>diagnostics</p>
<script>console.warn("before the failure");</script>
<script>setTimeout(() => { throw new Error("broke at https://api.example/data?token=secret-value"); }, 0);</script>
<img src="/missing.png?session=secret-value" alt="missing">`;
const server = createServer((req, res) => {
  if (req.url.startsWith("/missing.png")) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("none"); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(page);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = await mkdtemp(join(tmpdir(), "pyproc-console-diagnostics-"));
const configPath = join(work, "manifest.json");
await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
  browser: { enabled: true, allowedOrigins: [origin], maxRisk: "externalEffect", externalEffects: "acknowledged",
    actions: ["snapshot"], methods: ["Runtime.evaluate"], purpose: "Verify console diagnostics", artifacts: {},
    ...(executable ? { executable } : {}) } }, null, 2));

let client = null;
const commandsOf = (output) => (output.trace?.steps || []).flatMap((step) => step.commands || [])
  .map((command) => command.method);
try {
  client = await PyProcControlClient.start(configPath, { command: [process.execPath, join(ROOT, "scripts",
    "pyprocControl.mjs")], cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const open = async () => {
    const target = (await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" })).output;
    return (await client.attachSession(target.targetRef)).output;
  };

  // A session that never asks for console events.
  const quiet = await open();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const unasked = (await client.observe(quiet, { expectedRisk: "read", maxNodes: 50 })).output;
  const unaskedCommands = commandsOf(unasked);
  check("a session that does not ask turns on neither the Runtime nor the Log domain and gets no console events",
    !unaskedCommands.includes("Log.enable") && !unaskedCommands.includes("Runtime.enable")
      && unasked.result?.console === undefined, JSON.stringify(unaskedCommands));

  // A session that asks: the page already threw and failed to load an image while it loaded.
  const loud = await open();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const asked = (await client.observe(loud, { expectedRisk: "read", maxNodes: 50, includeConsole: true,
    maxEvents: 20 })).output;
  const events = asked.result?.console || [];
  const sources = events.map((event) => event.source);
  const exception = events.find((event) => event.source === "exception");
  const missing = events.find((event) => event.source === "network");
  const warned = events.find((event) => event.source === "consoleApi");
  check("asking turns on Runtime and Log", ["Runtime.enable", "Log.enable"].every((method) =>
    commandsOf(asked).includes(method)), JSON.stringify(commandsOf(asked)));
  check("the uncaught exception comes in with its message and place",
    exception?.level === "error" && /broke at https:\/\/api\.example\/data/.test(exception.text || "")
      && exception.url === `${origin}/` && Number.isInteger(exception.line), JSON.stringify(exception));
  check("the resource that failed to load comes in from the browser's log",
    missing?.level === "error" && /404/.test(missing.text || "") && missing.url === `${origin}/missing.png`,
    JSON.stringify(missing));
  check("the page's own console call comes in beside them", warned?.level === "warning", JSON.stringify(warned));
  check("each carries the time it happened, so they can be put in order",
    events.length >= 3 && events.every((event) => Number.isFinite(event.timestamp) && event.timestamp > 0),
    JSON.stringify(sources));
  const text = JSON.stringify(events);
  check("no query or secret value leaves in their text or URLs", !text.includes("secret-value")
    && !text.includes("token=") && !text.includes("session="), text.slice(0, 400));

  // Later events come in the next observation, once each.
  await client.command(loud, "Runtime.evaluate", { expression: "setTimeout(() => { throw new Error('later'); }, 0)" },
    { expectedRisk: "externalEffect" }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  const next = (await client.observe(loud, { expectedRisk: "read", maxNodes: 50, includeConsole: true,
    maxEvents: 20 })).output;
  const nextExceptions = (next.result?.console || []).filter((event) => event.source === "exception");
  check("a later exception comes in the next observation", nextExceptions.some((event) => /later/.test(event.text)),
    JSON.stringify(next.result?.console));
} catch (error) {
  check("console diagnostics gate has no exception", false, String(error?.stack || error).slice(-1500));
} finally {
  if (client) await client.close().catch(() => {});
  server.close();
  await rm(work, { recursive: true, force: true });
}
console.log(`\n결과: ${failed ? "RED" : "GREEN"} (${passed}/${passed + failed})`);
process.exit(failed ? 1 : 0);
