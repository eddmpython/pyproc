// benchArtifact.mjs - 외부 benchmark 후보 측정값을 표준 artifact JSON으로 만든다.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { isLatencyBenchGreen, isMachineResumeBenchGreen, isProcessMapBenchGreen, isShardedSpeedBenchGreen, summarizeLatencyBench, summarizeMachineResumeBench, summarizePairedLatencyBench } from "../../examples/benchStats.js";
import { BENCH_ARTIFACT_SCHEMA_VERSION, S0_SCENARIO, S0C_SCENARIO, S1_SCENARIO, S1L_SCENARIO, S2_SCENARIO, S3_SCENARIO, S4_SCENARIO, normalizeBenchArtifact, scenarioDefinitionFor } from "./benchArtifacts.mjs";

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

function parseBoolean(value, name) {
  if (value === null) return null;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  fail(`${name}는 true/false 필요`);
}

function parseOptionalInt(value, name) {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`${name}는 0 이상 정수 필요`);
  return n;
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

function parseMachineResumeSample(text) {
  const parts = text.split(",").map((v) => Number(v.trim()));
  if (parts.length < 4 || parts.length > 5 || parts.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error(`sample 형식 오류: ${text} (exportMs,openMs,machineMB,resumeRows[,maxErr])`);
  }
  const [exportMs, openMs, machineMB, resumeRows, maxErr = 0] = parts;
  if (!Number.isInteger(resumeRows)) throw new Error(`sample resumeRows는 정수여야 한다: ${text}`);
  return { exportMs, openMs, machineMB, resumeRows, maxErr };
}

const outPath = takeArg("--out");
const scenario = takeArg("--scenario") || S1_SCENARIO;
const candidate = takeArg("--candidate");
const browserVersion = takeArg("--browser-version");
const browserPath = takeArg("--browser-path");
const browserName = takeArg("--browser-name");
const browserHeadless = parseBoolean(takeArg("--browser-headless"), "--browser-headless");
const engineName = takeArg("--engine");
const command = takeArg("--command") || process.env.PYPROC_BENCH_COMMAND || null;
const source = takeArg("--source") || null;
const rawOutput = takeArg("--raw-output") || null;
const note = takeArg("--note") || null;
const profileArg = takeArg("--profile");
const warmupCount = parseOptionalInt(takeArg("--warmup-count"), "--warmup-count");
const notApplicableReason = takeArg("--na") || takeArg("--not-applicable");
const sampleTexts = takeArgs("--sample");

if (!candidate) fail("--candidate 필요");
if (![S0_SCENARIO, S0C_SCENARIO, S1_SCENARIO, S1L_SCENARIO, S2_SCENARIO, S3_SCENARIO, S4_SCENARIO].includes(scenario)) fail("--scenario는 S0, S0C, S1, S1L, S2, S3 또는 S4여야 한다");
const scenarioDefinition = scenarioDefinitionFor(scenario);
if (notApplicableReason && sampleTexts.length) fail("--na와 --sample은 같이 쓸 수 없다");
if (!notApplicableReason && sampleTexts.length < 3) fail("측정 artifact는 --sample을 최소 3개 요구한다");
if (!notApplicableReason && !command && !source && !rawOutput) fail("측정 artifact는 --command, --source 또는 --raw-output이 필요하다");

let metrics = null;
if (!notApplicableReason) {
  try {
    metrics = scenario === S4_SCENARIO
      ? summarizeMachineResumeBench(sampleTexts.map(parseMachineResumeSample))
      : (scenario === S1_SCENARIO || scenario === S2_SCENARIO
        ? summarizePairedLatencyBench(sampleTexts.map(parseSample))
        : summarizeLatencyBench(sampleTexts.map(parseLatencySample)));
  } catch (e) {
    fail(e.message);
  }
}

const primaryCpu = cpus()[0] || {};
const startedAt = new Date().toISOString();
const finishedAt = new Date().toISOString();
const browser = { name: browserName || null, path: browserPath || null, version: browserVersion || null, headless: browserHeadless };
const host = {
  platform: platform(),
  release: release(),
  cpuModel: primaryCpu.model || null,
  cpuCount: cpus().length,
  totalMemBytes: totalmem(),
  freeMemBytes: freemem(),
  powerProfile: process.env.PYPROC_POWER_PROFILE || null,
};
const engine = { name: engineName || null, indexURL: null, selfHosted: null, pythonVersion: null, numpyVersion: null };
const measurement = {
  command,
  startedAt,
  finishedAt,
  profile: profileArg || scenarioDefinition.profile,
  warmupCount,
  sampleCount: metrics?.sampleCount || 0,
};
const evidence = {
  source,
  rawOutput: rawOutput || source || command || notApplicableReason || null,
  note,
  runner: null,
  page: null,
  timeoutMs: null,
  report: null,
};
const environment = {
  commit: gitCommit(),
  worktreeDirty: gitDirty(),
  browser,
  host,
  engine,
};
const artifact = {
  schemaVersion: BENCH_ARTIFACT_SCHEMA_VERSION,
  scenario,
  scenarioDefinition,
  candidate,
  name: scenarioDefinition.name,
  command,
  commit: environment.commit,
  worktreeDirty: environment.worktreeDirty,
  startedAt,
  finishedAt,
  browser,
  host,
  engine,
  measurement,
  environment,
  evidence,
  producer: { name: "benchArtifact.mjs", schemaVersion: BENCH_ARTIFACT_SCHEMA_VERSION },
  source,
  note,
  ok: metrics ? (scenario === S1_SCENARIO ? isShardedSpeedBenchGreen(metrics) : (scenario === S2_SCENARIO ? isProcessMapBenchGreen(metrics) : (scenario === S4_SCENARIO ? isMachineResumeBenchGreen(metrics) : isLatencyBenchGreen(metrics)))) : false,
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
