// speedBench.mjs - Speed Lab(S1) 반복 벤치를 headless 브라우저에서 실행하고 JSON 증거를 남긴다.
// 비교 벤치의 raw output은 docs/operations/benchmarking.md 계약을 따른다.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createStaticServer } from "../../examples/serve.mjs";
import { findBrowser, headlessArgs } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_BENCH_TIMEOUT || process.env.PYPROC_GATE_TIMEOUT || 240000);

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((a) => a.startsWith(name + "="));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}

function browserVersion(browser) {
  const clean = (text) => (text || "").match(/\b\d+\.\d+\.\d+\.\d+\b/)?.[0] || null;
  if (process.platform === "win32") {
    const quoted = browser.replaceAll("'", "''");
    const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${quoted}').VersionInfo.ProductVersion`], { encoding: "utf8", timeout: 5000 });
    const fromFile = clean(ps.stdout || ps.stderr);
    if (fromFile) return fromFile;
  }
  const r = spawnSync(browser, ["--version"], { encoding: "utf8", timeout: 5000 });
  const fromBrowser = clean(r.stdout || r.stderr);
  if (fromBrowser) return fromBrowser;
  if (process.platform !== "win32") return null;
  const quoted = browser.replaceAll("'", "''");
  const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${quoted}').VersionInfo.ProductVersion`], { encoding: "utf8", timeout: 5000 });
  return clean(ps.stdout || ps.stderr);
}

function gitCommit() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function gitDirty() {
  const r = spawnSync("git", ["status", "--short"], { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim().length > 0 : null;
}

const outPath = argValue("--out") || process.env.PYPROC_BENCH_OUT || null;
const indexQuery = process.env.PYPROC_INDEX_URL ? `&indexURL=${encodeURIComponent(process.env.PYPROC_INDEX_URL)}` : "";
const browser = findBrowser();
const browserInfo = { path: browser, version: browserVersion(browser) };

let resolveReport = null;
const server = createStaticServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/gateReport")) return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(204); res.end();
  const r = resolveReport;
  if (r) { resolveReport = null; try { r(JSON.parse(body)); } catch (e) { r({ ok: false, parseError: String(e) }); } }
  return true;
});

await new Promise((res) => server.listen(0, "127.0.0.1", res));
const port = server.address().port;
const profile = mkdtempSync(join(tmpdir(), "pyprocSpeedBench-"));
const url = `http://127.0.0.1:${port}/examples/speedLab.html?gate=1${indexQuery}`;
const startedAt = new Date().toISOString();
const proc = spawn(browser, [...headlessArgs(profile), url], { stdio: "ignore" });

const result = await new Promise((res) => {
  resolveReport = res;
  setTimeout(() => {
    if (resolveReport === res) { resolveReport = null; res({ ok: false, timedOut: true }); }
  }, TIMEOUT_MS);
});

if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
else proc.kill("SIGKILL");
server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}

const primaryCpu = cpus()[0] || {};
const artifact = {
  schemaVersion: 1,
  scenario: "S1",
  candidate: "pyproc",
  name: "numpy sharded matmul",
  command: `node tests/browser/speedBench.mjs${outPath ? " --out " + outPath : ""}`,
  commit: gitCommit(),
  worktreeDirty: gitDirty(),
  startedAt,
  finishedAt: new Date().toISOString(),
  browser: browserInfo,
  host: {
    platform: platform(),
    release: release(),
    cpuModel: primaryCpu.model || null,
    cpuCount: cpus().length,
    totalMemBytes: totalmem(),
    freeMemBytes: freemem(),
  },
  engine: {
    indexURL: process.env.PYPROC_INDEX_URL || null,
    selfHosted: !!process.env.PYPROC_INDEX_URL,
  },
  page: url,
  timeoutMs: TIMEOUT_MS,
  ok: result.ok === true,
  report: result,
  metrics: result.bench || null,
};

if (outPath) {
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), JSON.stringify(artifact, null, 2) + "\n");
}

const b = artifact.metrics;
console.log(`pyproc Speed Bench S1\n  browser: ${browserInfo.path}\n  version: ${browserInfo.version || "unknown"}\n  url:     ${url}`);
if (b) {
  console.log(`  median:  single ${b.singleMedian}ms, shard ${b.parallelMedian}ms, speedup ${b.medianSpeedup.toFixed(2)}x`);
  console.log(`  p95:     single ${b.singleP95}ms, shard ${b.parallelP95}ms`);
  console.log(`  maxErr:  ${b.maxErr}`);
}
if (outPath) console.log(`  json:    ${resolve(outPath)}`);
if (result.timedOut) console.log(`  FAIL timeout ${TIMEOUT_MS}ms`);
else console.log(`  result:  ${artifact.ok ? "GREEN" : "RED"}`);

process.exit(artifact.ok ? 0 : 1);
