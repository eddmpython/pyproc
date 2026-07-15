// benchArtifact.mjs - 외부 benchmark 후보 측정값을 표준 artifact JSON으로 만든다.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { isLatencyBenchGreen, isShardedSpeedBenchGreen, summarizeLatencyBench, summarizePairedLatencyBench } from "../../examples/benchStats.js";
import { BENCH_ARTIFACT_SCHEMA_VERSION, S0_SCENARIO, S0C_SCENARIO, S1_SCENARIO, S1L_SCENARIO, normalizeBenchArtifact } from "./benchArtifacts.mjs";

function takeArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    const value = process.argv[idx + 1];
    process.argv.splice(idx, 2);
    return value;
  }
  const i = process.argv.findIndex((a) => a.startsWith(name + "="));
  if (i >= 0) {
    const value = process.argv[i].slice(name.length + 1);
    process.argv.splice(i, 1);
    return value;
  }
  return null;
}

function takeArgs(name) {
  const values = [];
  for (let i = 2; i < process.argv.length;) {
    const arg = process.argv[i];
    if (arg === name && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
      process.argv.splice(i, 2);
      continue;
    }
    if (arg.startsWith(name + "=")) {
      values.push(arg.slice(name.length + 1));
      process.argv.splice(i, 1);
      continue;
    }
    i++;
  }
  return values;
}

function fail(msg) {
  console.error("benchArtifact: " + msg);
  process.exit(1);
}

function gitCommit() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function gitDirty() {
  const r = spawnSync("git", ["status", "--short"], { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim().length > 0 : null;
}

function parseSample(text) {
  const parts = text.split(",").map((v) => Number(v.trim()));
  if (parts.length < 2 || parts.length > 3 || parts.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error(`sample 형식 오류: ${text} (singleMs,parallelMs[,maxErr])`);
  }
  const [singleMs, parallelMs, maxErr = 0] = parts;
  if (parallelMs === 0) throw new Error("sample parallelMs는 0일 수 없다");
  return { singleMs, parallelMs, speedup: +(singleMs / parallelMs).toFixed(2), maxErr };
}

function parseLatencySample(text) {
  const parts = text.split(",").map((v) => Number(v.trim()));
  if (parts.length < 1 || parts.length > 2 || parts.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error(`sample 형식 오류: ${text} (latencyMs[,maxErr])`);
  }
  const [latencyMs, maxErr = 0] = parts;
  return { latencyMs, maxErr };
}

const outPath = takeArg("--out");
const scenario = takeArg("--scenario") || S1_SCENARIO;
const candidate = takeArg("--candidate");
const browserVersion = takeArg("--browser-version");
const browserPath = takeArg("--browser-path");
const engineName = takeArg("--engine");
const command = takeArg("--command") || process.env.PYPROC_BENCH_COMMAND || null;
const source = takeArg("--source") || null;
const note = takeArg("--note") || null;
const notApplicableReason = takeArg("--na") || takeArg("--not-applicable");
const sampleTexts = takeArgs("--sample");

if (!candidate) fail("--candidate 필요");
if (![S0_SCENARIO, S0C_SCENARIO, S1_SCENARIO, S1L_SCENARIO].includes(scenario)) fail("--scenario는 S0, S0C, S1 또는 S1L이어야 한다");
if (notApplicableReason && sampleTexts.length) fail("--na와 --sample은 같이 쓸 수 없다");
if (!notApplicableReason && sampleTexts.length < 3) fail("측정 artifact는 --sample을 최소 3개 요구한다");
if (!notApplicableReason && !command && !source) fail("측정 artifact는 --command 또는 --source가 필요하다");

let metrics = null;
if (!notApplicableReason) {
  try {
    metrics = scenario === S1_SCENARIO
      ? summarizePairedLatencyBench(sampleTexts.map(parseSample))
      : summarizeLatencyBench(sampleTexts.map(parseLatencySample));
  } catch (e) {
    fail(e.message);
  }
}

const primaryCpu = cpus()[0] || {};
const startedAt = new Date().toISOString();
const finishedAt = new Date().toISOString();
const artifact = {
  schemaVersion: BENCH_ARTIFACT_SCHEMA_VERSION,
  scenario,
  candidate,
  name: scenario === S0_SCENARIO ? "python ready latency" : (scenario === S0C_SCENARIO ? "python cold ready latency" : (scenario === S1L_SCENARIO ? "single-kernel numpy matmul latency" : "numpy sharded matmul")),
  command,
  commit: gitCommit(),
  worktreeDirty: gitDirty(),
  startedAt,
  finishedAt,
  browser: { path: browserPath || null, version: browserVersion || null },
  host: {
    platform: platform(),
    release: release(),
    cpuModel: primaryCpu.model || null,
    cpuCount: cpus().length,
    totalMemBytes: totalmem(),
    freeMemBytes: freemem(),
  },
  engine: { name: engineName || null },
  source,
  note,
  ok: metrics ? (scenario === S1_SCENARIO ? isShardedSpeedBenchGreen(metrics) : isLatencyBenchGreen(metrics)) : false,
  metrics,
};
if (notApplicableReason) artifact.notApplicableReason = notApplicableReason;

try {
  normalizeBenchArtifact(artifact, outPath || candidate);
} catch (e) {
  fail(e.message);
}

const json = JSON.stringify(artifact, null, 2) + "\n";
if (outPath) {
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), json);
  console.log(resolve(outPath));
} else {
  process.stdout.write(json);
}
