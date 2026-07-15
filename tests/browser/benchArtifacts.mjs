// benchArtifacts.mjs - benchmark artifact schema와 비교 표 렌더러.
import { readFileSync } from "node:fs";

export const BENCH_ARTIFACT_SCHEMA_VERSION = 1;
export const S1_SCENARIO = "S1";
export const S1L_SCENARIO = "S1L";
export const SUPPORTED_SCENARIOS = new Set([S1_SCENARIO, S1L_SCENARIO]);

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
  if (!SUPPORTED_SCENARIOS.has(artifact.scenario)) throw new Error(`${file}: 지원하지 않는 scenario: ${artifact.scenario}`);
  const candidate = artifact.candidate || artifact.name || file;
  const notApplicableReason = artifact.notApplicableReason || null;
  if (notApplicableReason) {
    return baseRow(artifact, file, candidate, { ok: false, notApplicableReason });
  }
  if (!artifact.metrics || typeof artifact.metrics !== "object") throw new Error(`${file}: metrics 객체 누락`);
  if (artifact.scenario === S1_SCENARIO) return normalizeS1Artifact(artifact, file, candidate);
  return normalizeS1LArtifact(artifact, file, candidate);
}

function baseRow(artifact, file, candidate, extra = {}) {
  return {
    file,
    candidate,
    scenario: artifact.scenario,
    ok: artifact.ok === true,
    notApplicableReason: "",
    browser: artifact.browser?.version || "N/A",
    commit: artifact.commit ? String(artifact.commit).slice(0, 8) : "N/A",
    dirty: artifact.worktreeDirty === true ? "dirty" : "",
    ...extra,
  };
}

function assertSamples(artifact, sampleCount, file) {
  if (!Array.isArray(artifact.metrics.samples) || artifact.metrics.samples.length !== sampleCount) {
    throw new Error(`${file}: samples 길이 불일치`);
  }
}

function normalizeS1Artifact(artifact, file, candidate) {
  const sampleCount = requireFiniteNumber(artifact.metrics, "sampleCount", file);
  assertSamples(artifact, sampleCount, file);
  return baseRow(artifact, file, candidate, {
    samples: sampleCount,
    singleMedian: requireFiniteNumber(artifact.metrics, "singleMedian", file),
    parallelMedian: requireFiniteNumber(artifact.metrics, "parallelMedian", file),
    parallelP95: requireFiniteNumber(artifact.metrics, "parallelP95", file),
    medianSpeedup: requireFiniteNumber(artifact.metrics, "medianSpeedup", file),
    maxErr: requireFiniteNumber(artifact.metrics, "maxErr", file),
  });
}

function normalizeS1LArtifact(artifact, file, candidate) {
  const sampleCount = requireFiniteNumber(artifact.metrics, "sampleCount", file);
  assertSamples(artifact, sampleCount, file);
  const medianMs = requireFiniteNumber(artifact.metrics, "medianMs", file);
  const p95Ms = requireFiniteNumber(artifact.metrics, "p95Ms", file);
  const minMs = requireFiniteNumber(artifact.metrics, "minMs", file);
  const maxMs = requireFiniteNumber(artifact.metrics, "maxMs", file);
  const maxErr = requireFiniteNumber(artifact.metrics, "maxErr", file);
  if (minMs > medianMs || medianMs > p95Ms || p95Ms > maxMs) throw new Error(`${file}: S1L latency envelope 불일치`);
  return baseRow(artifact, file, candidate, {
    samples: sampleCount,
    medianMs,
    p95Ms,
    minMs,
    maxMs,
    maxErr,
  });
}

export function normalizeBenchArtifactFile(file) {
  return normalizeBenchArtifact(readBenchArtifact(file), file);
}

export function markdownCell(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toFixed(4));
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderBenchCompareMarkdown(rows) {
  if (!rows.length) throw new Error("비교할 artifact row가 없다");
  const scenario = rows[0].scenario;
  if (rows.some((r) => r.scenario !== scenario)) throw new Error("서로 다른 scenario artifact는 한 표로 합칠 수 없다");
  if (scenario === S1L_SCENARIO) return renderS1LMarkdown(rows);
  return renderS1Markdown(rows);
}

function renderS1Markdown(rows) {
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
    lines.push(`| ${markdownCell(r.candidate)} | ${ok} | ${markdownCell(r.samples ?? "N/A")} | ${markdownCell(r.singleMedian ?? "N/A")} | ${markdownCell(r.parallelMedian ?? "N/A")} | ${markdownCell(r.parallelP95 ?? "N/A")} | ${markdownCell(r.medianSpeedup ?? "N/A")} | ${markdownCell(r.maxErr ?? "N/A")} | ${markdownCell(r.browser)} | ${markdownCell(r.commit + (r.dirty ? " dirty" : ""))} | ${markdownCell(source)} |`);
  }
  return lines.join("\n") + "\n";
}

function renderS1LMarkdown(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const av = typeof a.medianMs === "number" ? a.medianMs : Number.POSITIVE_INFINITY;
    const bv = typeof b.medianMs === "number" ? b.medianMs : Number.POSITIVE_INFINITY;
    return av - bv;
  });
  const lines = [
    "| candidate | ok | samples | median ms | p95 ms | min ms | max ms | maxErr | browser | commit | source |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|",
  ];
  for (const r of sorted) {
    const ok = r.notApplicableReason ? "N/A" : (r.ok ? "GREEN" : "RED");
    const source = r.notApplicableReason ? r.notApplicableReason : r.file;
    lines.push(`| ${markdownCell(r.candidate)} | ${ok} | ${markdownCell(r.samples ?? "N/A")} | ${markdownCell(r.medianMs ?? "N/A")} | ${markdownCell(r.p95Ms ?? "N/A")} | ${markdownCell(r.minMs ?? "N/A")} | ${markdownCell(r.maxMs ?? "N/A")} | ${markdownCell(r.maxErr ?? "N/A")} | ${markdownCell(r.browser)} | ${markdownCell(r.commit + (r.dirty ? " dirty" : ""))} | ${markdownCell(source)} |`);
  }
  return lines.join("\n") + "\n";
}
