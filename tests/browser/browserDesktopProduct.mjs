// browserDesktopProduct.mjs - a headed browser on a private desktop, through the public Control client, on Windows. The
// gate puts its own window in front, then opens, reads, clicks, fills, and captures a page in a Control host whose
// manifest asks for `browser.desktop: "private"`: the foreground never leaves the gate's window and no window of that
// browser appears on the user's desktop, while the page renders, takes input, and captures like a headed one (not a
// headless one: its user agent says so). The same host without a private desktop shows its window on the user's
// desktop, which proves the gate's eyes see a browser window when there is one.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ROOT } from "../packageHarness.mjs";
import { PyProcControlClient } from "../../scripts/controlProtocol/controlApi.js";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const executable = process.env.PYPROC_BROWSER || undefined;
// The Control product launches its browser with a profile named after this prefix, so the watcher can tell it apart.
const PROFILE_MARKER = "pyprocControl-";
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}

if (process.platform !== "win32") {
  console.log("결과: SKIP (a private browser desktop is Windows-only)");
  process.exit(0);
}

function startWatcher() {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    join(ROOT, "tests", "support", "foregroundWatcher.ps1"), "-Marker", PROFILE_MARKER],
  { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const waiting = [];
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    waiting.shift()?.(message);
  });
  const next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the foreground watcher did not answer")), 60000);
    waiting.push((message) => { clearTimeout(timer); resolve(message); });
  });
  return {
    ready: next(),
    mark: (name) => { const answer = next(); child.stdin.write(`mark ${name}\n`); return answer; },
    quit: () => { const answer = next(); child.stdin.write("quit\n"); return answer; },
    kill: () => child.kill(),
  };
}

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><title>private desktop</title><h1>Private desktop</h1>
<button id="press" onclick="this.textContent='pressed'">Press</button><input id="note" aria-label="Note">
<script>window.frames_ = 0; (function tick() { window.frames_ += 1; requestAnimationFrame(tick); })();</script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = await mkdtemp(join(tmpdir(), "pyproc-browser-desktop-"));
const watcher = startWatcher();
let client = null;

async function startHost(desktop) {
  const configPath = join(work, `${desktop}.json`);
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
    browser: { enabled: true, headed: true, ...(desktop === "private" ? { desktop } : {}), allowedOrigins: [origin],
      maxRisk: "externalEffect", actions: ["snapshot", "click", "fill", "screenshot"], methods: ["Runtime.evaluate"],
      externalEffects: "acknowledged", purpose: "Verify the private browser desktop", artifacts: {},
      ...(executable ? { executable } : {}) } }, null, 2));
  return PyProcControlClient.start(configPath, { command: [process.execPath, join(ROOT, "scripts", "pyprocControl.mjs")],
    cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
}

const evaluate = async (session, expression) => (await client.command(session, "Runtime.evaluate",
  { expression, returnByValue: true }, { expectedRisk: "externalEffect" })).output?.result?.result?.value;

try {
  const ready = await watcher.ready;
  check("the gate's own window is in front before anything opens", ready.gateInFront === true, JSON.stringify(ready));

  const started = Date.now();
  client = await startHost("private");
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  const openMs = Date.now() - started;
  const session = (await client.attachSession(opened.output.targetRef)).output;
  const acted = await client.act(session, [
    { kind: "click", selector: "#press", expectedRisk: "externalEffect" },
    { kind: "fill", selector: "#note", value: "typed on a private desktop", expectedRisk: "externalEffect" },
  ]);
  const captured = await client.act(session, [{ kind: "screenshot", expectedRisk: "read" }]);
  const firstFrames = await evaluate(session, "window.frames_");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const page = JSON.parse(await evaluate(session, `JSON.stringify({ pressed: document.getElementById("press").textContent,
    note: document.getElementById("note").value, visible: document.visibilityState, frames: window.frames_,
    userAgent: navigator.userAgent })`));
  const seen = await watcher.mark("private");
  const shot = captured.attachments?.[0]?.bytes?.byteLength || 0;
  check("the page renders, takes a click and typing, and captures on the private desktop",
    acted.output?.actions?.length === 2 && page.pressed === "pressed" && page.note === "typed on a private desktop"
      && page.visible === "visible" && page.frames - firstFrames > 10 && shot > 1000,
    JSON.stringify({ openMs, acted: acted.output?.actions?.length, pressed: page.pressed, note: page.note,
      frames: page.frames - firstFrames, visible: page.visible, shot }));
  check("the browser is headed, not headless", !page.userAgent.includes("HeadlessChrome"), page.userAgent);
  check("the foreground never left the gate's window", seen.left.length === 0 && seen.foreground === ready.start,
    JSON.stringify(seen.left));
  check("no window of the private-desktop browser is on the user's desktop", seen.windows.length === 0,
    JSON.stringify(seen.windows));
  await client.close();
  client = null;

  // The same host without a private desktop shows its window where the user works: the eyes see it.
  client = await startHost("user");
  await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  const control = await watcher.mark("user");
  check("a headed browser on the user's desktop is seen there (the gate's eyes work)", control.windows.length > 0,
    JSON.stringify({ windows: control.windows.length, left: control.left.length }));
  await client.close();
  client = null;
} catch (error) {
  check("browser desktop gate has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  if (client) await client.close().catch(() => {});
  await watcher.quit().catch(() => watcher.kill());
  server.close();
  await rm(work, { recursive: true, force: true });
}
console.log(`\n결과: ${failed ? "RED" : "GREEN"} (${passed}/${passed + failed})`);
process.exit(failed ? 1 : 0);
