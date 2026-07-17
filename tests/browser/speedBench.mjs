// speedBench.mjs - Speed Lab(S1) 반복 벤치를 headless 브라우저에서 실행하고 JSON 증거를 남긴다.
// 비교 벤치의 raw output은 docs/operations/benchmarking.md 계약을 따른다.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { findBrowser, launchBrowser } from "./harness.mjs";
import { BENCH_ARTIFACT_SCHEMA_VERSION, RAW_OUTPUT_EMBEDDED_REPORT, S1_SCENARIO, normalizeBenchArtifact, scenarioDefinitionFor } from "./benchArtifacts.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_BENCH_TIMEOUT || process.env.PYPROC_GATE_TIMEOUT || 240000);
const DEFAULT_WORKERS = 4;
const DEFAULT_SIZE = 1024;
const DEFAULT_SAMPLES = 3;

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((a) => a.startsWith(name + "="));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}

function intOption(argName, envName, fallback, { min, max }) {
  const raw = argValue(argName) || process.env[envName] || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${argName} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function commandArg(value) {
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value;
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

function browserName(browser) {
  const lower = browser.toLowerCase();
  if (lower.includes("edge") || lower.includes("msedge")) return "Edge";
  if (lower.includes("chrome")) return "Chrome";
  if (lower.includes("chromium")) return "Chromium";
  return null;
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
const benchWorkers = intOption("--workers", "PYPROC_BENCH_WORKERS", DEFAULT_WORKERS, { min: 1, max: 8 });
const benchSize = intOption("--size", "PYPROC_BENCH_SIZE", DEFAULT_SIZE, { min: 128, max: 1536 });
const benchSamples = intOption("--samples", "PYPROC_BENCH_SAMPLES", DEFAULT_SAMPLES, { min: 3, max: 9 });
const browser = findBrowser();
const browserInfo = { name: browserName(browser), path: browser, version: browserVersion(browser), headless: true };

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
const pageParams = new URLSearchParams({
  gate: "1",
  workers: String(benchWorkers),
  size: String(benchSize),
  samples: String(benchSamples),
});
if (process.env.PYPROC_INDEX_URL) pageParams.set("indexURL", process.env.PYPROC_INDEX_URL);
const url = `http://127.0.0.1:${port}/examples/speedLab.html?${pageParams}`;
const startedAt = new Date().toISOString();
const session = launchBrowser(url, { browser, prefix: "pyprocSpeedBench-" });

const result = await new Promise((res) => {
  resolveReport = res;
  setTimeout(() => {
    if (resolveReport === res) { resolveReport = null; res({ ok: false, timedOut: true }); }
  }, TIMEOUT_MS);
});

session.close();
server.close();

const primaryCpu = cpus()[0] || {};
const command = [
  "node",
  "tests/browser/speedBench.mjs",
  "--workers",
  String(benchWorkers),
  "--size",
  String(benchSize),
  "--samples",
  String(benchSamples),
  ...(outPath ? ["--out", outPath] : []),
].map(commandArg).join(" ");
const finishedAt = new Date().toISOString();
const scenarioDefinition = scenarioDefinitionFor(S1_SCENARIO);
const host = {
  platform: platform(),
  release: release(),
  cpuModel: primaryCpu.model || null,
  cpuCount: cpus().length,
  totalMemBytes: totalmem(),
  freeMemBytes: freemem(),
  powerProfile: process.env.PYPROC_POWER_PROFILE || null,
};
const engine = {
  name: "Pyodide",
  indexURL: process.env.PYPROC_INDEX_URL || null,
  selfHosted: !!process.env.PYPROC_INDEX_URL,
  pythonVersion: null,
  numpyVersion: null,
};
const environment = {
  commit: gitCommit(),
  worktreeDirty: gitDirty(),
  browser: browserInfo,
  host,
  engine,
};
const measurement = {
  command,
  startedAt,
  finishedAt,
  profile: scenarioDefinition.profile,
  warmupCount: 0,
  sampleCount: result.bench?.sampleCount || 0,
};
const evidence = {
  source: "examples/speedLab.html gate report",
  rawOutput: RAW_OUTPUT_EMBEDDED_REPORT,
  note: null,
  runner: { workers: benchWorkers, size: benchSize, samples: benchSamples },
  page: url,
  timeoutMs: TIMEOUT_MS,
  report: result,
};
const artifact = {
  schemaVersion: BENCH_ARTIFACT_SCHEMA_VERSION,
  scenario: S1_SCENARIO,
  scenarioDefinition,
  candidate: "pyproc",
  name: scenarioDefinition.name,
  command,
  commit: environment.commit,
  worktreeDirty: environment.worktreeDirty,
  startedAt,
  finishedAt,
  browser: browserInfo,
  host,
  engine,
  measurement,
  environment,
  evidence,
  producer: { name: "speedBench.mjs", schemaVersion: BENCH_ARTIFACT_SCHEMA_VERSION },
  runner: {
    workers: benchWorkers,
    size: benchSize,
    samples: benchSamples,
  },
  page: url,
  timeoutMs: TIMEOUT_MS,
  ok: result.ok === true,
  report: result,
  metrics: result.bench || null,
};

normalizeBenchArtifact(artifact, outPath || "speedBench");

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
