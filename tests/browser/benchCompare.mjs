// benchCompare.mjs - benchmark JSON artifact들을 검증하고 비교 Markdown 표로 합친다.
// 입력 artifact schema는 docs/operations/benchmarking.md의 raw output 계약을 따른다.
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

function fail(msg) {
  console.error("benchCompare: " + msg);
  process.exit(1);
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { fail(`${file}: JSON 파싱 실패: ${e.message}`); }
}

function requireNumber(obj, key, file) {
  if (typeof obj?.[key] !== "number" || !Number.isFinite(obj[key])) fail(`${file}: metrics.${key} 숫자 누락`);
  return obj[key];
}

function normalizeArtifact(file) {
  const a = readJson(file);
  if (a.schemaVersion !== 1) fail(`${file}: schemaVersion 1 필요`);
  if (a.scenario !== "S1") fail(`${file}: 현재 benchCompare는 S1만 지원`);
  const candidate = a.candidate || a.name || file;
  const notApplicableReason = a.notApplicableReason || null;
  if (notApplicableReason) {
    return {
      file, candidate, scenario: a.scenario, ok: false, notApplicableReason,
      samples: "N/A", singleMedian: "N/A", parallelMedian: "N/A", parallelP95: "N/A",
      medianSpeedup: "N/A", maxErr: "N/A", browser: a.browser?.version || "N/A",
      commit: a.commit ? String(a.commit).slice(0, 8) : "N/A", dirty: a.worktreeDirty === true ? "dirty" : "",
    };
  }
  if (!a.metrics || typeof a.metrics !== "object") fail(`${file}: metrics 객체 누락`);
  const sampleCount = requireNumber(a.metrics, "sampleCount", file);
  const singleMedian = requireNumber(a.metrics, "singleMedian", file);
  const parallelMedian = requireNumber(a.metrics, "parallelMedian", file);
  const parallelP95 = requireNumber(a.metrics, "parallelP95", file);
  const medianSpeedup = requireNumber(a.metrics, "medianSpeedup", file);
  const maxErr = requireNumber(a.metrics, "maxErr", file);
  if (!Array.isArray(a.metrics.samples) || a.metrics.samples.length !== sampleCount) fail(`${file}: samples 길이 불일치`);
  return {
    file,
    candidate,
    scenario: a.scenario,
    ok: a.ok === true,
    notApplicableReason: "",
    samples: sampleCount,
    singleMedian,
    parallelMedian,
    parallelP95,
    medianSpeedup,
    maxErr,
    browser: a.browser?.version || "unknown",
    commit: a.commit ? String(a.commit).slice(0, 8) : "unknown",
    dirty: a.worktreeDirty === true ? "dirty" : "",
  };
}

function cell(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toFixed(4));
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderMarkdown(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const av = typeof a.medianSpeedup === "number" ? a.medianSpeedup : -1;
    const bv = typeof b.medianSpeedup === "number" ? b.medianSpeedup : -1;
    return bv - av;
  });
  const lines = [
    "| candidate | ok | samples | single median ms | shard median ms | shard p95 ms | median speedup | maxErr | browser | commit | source |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|",
  ];
  for (const r of sorted) {
    const ok = r.notApplicableReason ? "N/A" : (r.ok ? "GREEN" : "RED");
    const source = r.notApplicableReason ? r.notApplicableReason : r.file;
    lines.push(`| ${cell(r.candidate)} | ${ok} | ${cell(r.samples)} | ${cell(r.singleMedian)} | ${cell(r.parallelMedian)} | ${cell(r.parallelP95)} | ${cell(r.medianSpeedup)} | ${cell(r.maxErr)} | ${cell(r.browser)} | ${cell(r.commit + (r.dirty ? " dirty" : ""))} | ${cell(source)} |`);
  }
  return lines.join("\n") + "\n";
}

const outPath = takeArg("--out");
const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!files.length) fail("입력 JSON artifact가 필요하다");

const rows = files.map(normalizeArtifact);
const markdown = renderMarkdown(rows);
if (outPath) {
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), markdown);
}
process.stdout.write(markdown);
