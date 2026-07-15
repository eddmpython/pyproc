// benchArtifacts.mjs - S1 benchmark artifact schema와 비교 표 렌더러.
import { readFileSync } from "node:fs";

export const BENCH_ARTIFACT_SCHEMA_VERSION = 1;
export const S1_SCENARIO = "S1";

export function readBenchArtifact(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: JSON 파싱 실패: ${e.message}`);
  }
}

function requireFiniteNumber(obj, key, file) {
  if (typeof obj?.[key] !== "number" || !Number.isFinite(obj[key])) throw new Error(`${file}: metrics.${key} 숫자 누락`);
  return obj[key];
}

export function normalizeBenchArtifact(artifact, file = "artifact") {
  if (artifact.schemaVersion !== BENCH_ARTIFACT_SCHEMA_VERSION) throw new Error(`${file}: schemaVersion ${BENCH_ARTIFACT_SCHEMA_VERSION} 필요`);
  if (artifact.scenario !== S1_SCENARIO) throw new Error(`${file}: 현재 비교 schema는 S1만 지원`);
  const candidate = artifact.candidate || artifact.name || file;
  const notApplicableReason = artifact.notApplicableReason || null;
  if (notApplicableReason) {
    return {
      file, candidate, scenario: artifact.scenario, ok: false, notApplicableReason,
      samples: "N/A", singleMedian: "N/A", parallelMedian: "N/A", parallelP95: "N/A",
      medianSpeedup: "N/A", maxErr: "N/A", browser: artifact.browser?.version || "N/A",
      commit: artifact.commit ? String(artifact.commit).slice(0, 8) : "N/A",
      dirty: artifact.worktreeDirty === true ? "dirty" : "",
    };
  }
  if (!artifact.metrics || typeof artifact.metrics !== "object") throw new Error(`${file}: metrics 객체 누락`);
  const sampleCount = requireFiniteNumber(artifact.metrics, "sampleCount", file);
  const singleMedian = requireFiniteNumber(artifact.metrics, "singleMedian", file);
  const parallelMedian = requireFiniteNumber(artifact.metrics, "parallelMedian", file);
  const parallelP95 = requireFiniteNumber(artifact.metrics, "parallelP95", file);
  const medianSpeedup = requireFiniteNumber(artifact.metrics, "medianSpeedup", file);
  const maxErr = requireFiniteNumber(artifact.metrics, "maxErr", file);
  if (!Array.isArray(artifact.metrics.samples) || artifact.metrics.samples.length !== sampleCount) {
    throw new Error(`${file}: samples 길이 불일치`);
  }
  return {
    file,
    candidate,
    scenario: artifact.scenario,
    ok: artifact.ok === true,
    notApplicableReason: "",
    samples: sampleCount,
    singleMedian,
    parallelMedian,
    parallelP95,
    medianSpeedup,
    maxErr,
    browser: artifact.browser?.version || "unknown",
    commit: artifact.commit ? String(artifact.commit).slice(0, 8) : "unknown",
    dirty: artifact.worktreeDirty === true ? "dirty" : "",
  };
}

export function normalizeBenchArtifactFile(file) {
  return normalizeBenchArtifact(readBenchArtifact(file), file);
}

export function markdownCell(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toFixed(4));
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderBenchCompareMarkdown(rows) {
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
    lines.push(`| ${markdownCell(r.candidate)} | ${ok} | ${markdownCell(r.samples)} | ${markdownCell(r.singleMedian)} | ${markdownCell(r.parallelMedian)} | ${markdownCell(r.parallelP95)} | ${markdownCell(r.medianSpeedup)} | ${markdownCell(r.maxErr)} | ${markdownCell(r.browser)} | ${markdownCell(r.commit + (r.dirty ? " dirty" : ""))} | ${markdownCell(source)} |`);
  }
  return lines.join("\n") + "\n";
}
