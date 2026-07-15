// benchArtifacts.mjs - benchmark artifact schema와 비교 표 렌더러.
import { readFileSync } from "node:fs";

export const BENCH_ARTIFACT_SCHEMA_VERSION = 2;
export const S0_SCENARIO = "S0";
export const S0C_SCENARIO = "S0C";
export const S1_SCENARIO = "S1";
export const S1L_SCENARIO = "S1L";
export const S2_SCENARIO = "S2";
export const S3_SCENARIO = "S3";
export const S4_SCENARIO = "S4";
export const SUPPORTED_SCENARIOS = new Set([S0_SCENARIO, S0C_SCENARIO, S1_SCENARIO, S1L_SCENARIO, S2_SCENARIO, S3_SCENARIO, S4_SCENARIO]);
export const SCENARIO_DEFINITIONS = Object.freeze({
  [S0_SCENARIO]: Object.freeze({
    id: S0_SCENARIO,
    name: "python ready latency",
    profile: "warm",
    primaryMetric: "medianMs",
    sampleSchema: Object.freeze(["latencyMs", "maxErr"]),
    metricUnit: "ms",
  }),
  [S0C_SCENARIO]: Object.freeze({
    id: S0C_SCENARIO,
    name: "python cold ready latency",
    profile: "cold",
    primaryMetric: "medianMs",
    sampleSchema: Object.freeze(["latencyMs", "maxErr"]),
    metricUnit: "ms",
  }),
  [S1_SCENARIO]: Object.freeze({
    id: S1_SCENARIO,
    name: "numpy sharded matmul",
    profile: "warmed",
    primaryMetric: "medianSpeedup",
    sampleSchema: Object.freeze(["singleMs", "parallelMs", "speedup", "maxErr"]),
    metricUnit: "ms",
  }),
  [S1L_SCENARIO]: Object.freeze({
    id: S1L_SCENARIO,
    name: "single-kernel numpy matmul latency",
    profile: "warmed",
    primaryMetric: "medianMs",
    sampleSchema: Object.freeze(["latencyMs", "maxErr"]),
    metricUnit: "ms",
  }),
  [S2_SCENARIO]: Object.freeze({
    id: S2_SCENARIO,
    name: "process map",
    profile: "gate",
    primaryMetric: "medianSpeedup",
    sampleSchema: Object.freeze(["singleMs", "parallelMs", "speedup", "maxErr"]),
    metricUnit: "ms",
  }),
  [S3_SCENARIO]: Object.freeze({
    id: S3_SCENARIO,
    name: "browser server roundtrip",
    profile: "gate",
    primaryMetric: "medianMs",
    sampleSchema: Object.freeze(["latencyMs", "maxErr"]),
    metricUnit: "ms",
  }),
  [S4_SCENARIO]: Object.freeze({
    id: S4_SCENARIO,
    name: "machine resume",
    profile: "gate",
    primaryMetric: "openMedianMs",
    sampleSchema: Object.freeze(["exportMs", "openMs", "machineMB", "resumeRows", "maxErr"]),
    metricUnit: "ms",
  }),
});

export function scenarioDefinitionFor(scenario) {
  const definition = SCENARIO_DEFINITIONS[scenario];
  if (!definition) throw new Error(`지원하지 않는 scenario: ${scenario}`);
  return definition;
}

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
  assertV2Envelope(artifact, file, candidate, notApplicableReason);
  if (notApplicableReason) {
    return baseRow(artifact, file, candidate, { ok: false, notApplicableReason });
  }
  if (!artifact.metrics || typeof artifact.metrics !== "object") throw new Error(`${file}: metrics 객체 누락`);
  if (artifact.scenario === S0_SCENARIO || artifact.scenario === S0C_SCENARIO || artifact.scenario === S3_SCENARIO) return normalizeReadyLatencyArtifact(artifact, file, candidate);
  if (artifact.scenario === S1_SCENARIO || artifact.scenario === S2_SCENARIO) return normalizePairedSpeedArtifact(artifact, file, candidate);
  if (artifact.scenario === S4_SCENARIO) return normalizeMachineResumeArtifact(artifact, file, candidate);
  return normalizeS1LArtifact(artifact, file, candidate);
}

function baseRow(artifact, file, candidate, extra = {}) {
  const environment = artifact.environment || {};
  return {
    file,
    candidate,
    scenario: artifact.scenario,
    ok: artifact.ok === true,
    notApplicableReason: "",
    browser: environment.browser?.version || artifact.browser?.version || "N/A",
    commit: environment.commit ? String(environment.commit).slice(0, 8) : (artifact.commit ? String(artifact.commit).slice(0, 8) : "N/A"),
    dirty: environment.worktreeDirty === true || artifact.worktreeDirty === true ? "dirty" : "",
    ...extra,
  };
}

function assertSamples(artifact, sampleCount, file) {
  if (!Array.isArray(artifact.metrics.samples) || artifact.metrics.samples.length !== sampleCount) {
    throw new Error(`${file}: samples 길이 불일치`);
  }
}

function assertObject(value, path, file) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}: ${path} 객체 누락`);
  return value;
}

function assertStringOrNull(value, path, file) {
  if (value !== null && typeof value !== "string") throw new Error(`${file}: ${path}는 문자열 또는 null이어야 함`);
}

function assertIsoDate(value, path, file) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${file}: ${path} ISO 날짜 누락`);
}

function assertFiniteOrNull(value, path, file) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${file}: ${path}는 숫자 또는 null이어야 함`);
}

function assertBooleanOrNull(value, path, file) {
  if (value !== null && typeof value !== "boolean") throw new Error(`${file}: ${path}는 boolean 또는 null이어야 함`);
}

function assertSampleField(sample, key, file) {
  if (typeof sample?.[key] !== "number" || !Number.isFinite(sample[key]) || sample[key] < 0) throw new Error(`${file}: sample.${key} 숫자 누락`);
}

function assertSampleSchema(artifact, file) {
  if (!artifact.metrics) return;
  const samples = artifact.metrics.samples;
  if (!Array.isArray(samples)) throw new Error(`${file}: metrics.samples 배열 누락`);
  for (const sample of samples) {
    if (artifact.scenario === S4_SCENARIO) {
      for (const key of ["exportMs", "openMs", "machineMB", "resumeRows", "maxErr"]) assertSampleField(sample, key, file);
      if (!Number.isInteger(sample.resumeRows)) throw new Error(`${file}: sample.resumeRows 정수 아님`);
      continue;
    }
    if (artifact.scenario === S1_SCENARIO || artifact.scenario === S2_SCENARIO) {
      for (const key of ["singleMs", "parallelMs", "speedup", "maxErr"]) assertSampleField(sample, key, file);
      if (sample.parallelMs === 0) throw new Error(`${file}: sample.parallelMs는 0일 수 없음`);
      const expected = +(sample.singleMs / sample.parallelMs).toFixed(2);
      if (Math.abs(expected - sample.speedup) > 0.02) throw new Error(`${file}: sample.speedup 계산 불일치`);
      continue;
    }
    for (const key of ["latencyMs", "maxErr"]) assertSampleField(sample, key, file);
  }
}

function assertV2Envelope(artifact, file, candidate, notApplicableReason) {
  if (!candidate || typeof candidate !== "string") throw new Error(`${file}: candidate 문자열 누락`);
  const expectedDefinition = scenarioDefinitionFor(artifact.scenario);
  const scenarioDefinition = assertObject(artifact.scenarioDefinition, "scenarioDefinition", file);
  if (scenarioDefinition.id !== artifact.scenario) throw new Error(`${file}: scenarioDefinition.id 불일치`);
  if (scenarioDefinition.name !== expectedDefinition.name) throw new Error(`${file}: scenarioDefinition.name 불일치`);
  if (scenarioDefinition.primaryMetric !== expectedDefinition.primaryMetric) throw new Error(`${file}: scenarioDefinition.primaryMetric 불일치`);
  if (scenarioDefinition.profile !== expectedDefinition.profile) throw new Error(`${file}: scenarioDefinition.profile 불일치`);
  if (!Array.isArray(scenarioDefinition.sampleSchema) || scenarioDefinition.sampleSchema.join(",") !== expectedDefinition.sampleSchema.join(",")) {
    throw new Error(`${file}: scenarioDefinition.sampleSchema 불일치`);
  }
  const measurement = assertObject(artifact.measurement, "measurement", file);
  assertIsoDate(measurement.startedAt, "measurement.startedAt", file);
  assertIsoDate(measurement.finishedAt, "measurement.finishedAt", file);
  assertStringOrNull(measurement.command, "measurement.command", file);
  if (typeof measurement.profile !== "string" || !measurement.profile) throw new Error(`${file}: measurement.profile 누락`);
  assertFiniteOrNull(measurement.warmupCount, "measurement.warmupCount", file);
  if (typeof measurement.sampleCount !== "number" || !Number.isInteger(measurement.sampleCount) || measurement.sampleCount < 0) throw new Error(`${file}: measurement.sampleCount 정수 누락`);
  const environment = assertObject(artifact.environment, "environment", file);
  assertStringOrNull(environment.commit, "environment.commit", file);
  assertBooleanOrNull(environment.worktreeDirty, "environment.worktreeDirty", file);
  const browser = assertObject(environment.browser, "environment.browser", file);
  assertStringOrNull(browser.name, "environment.browser.name", file);
  assertStringOrNull(browser.path, "environment.browser.path", file);
  assertStringOrNull(browser.version, "environment.browser.version", file);
  assertBooleanOrNull(browser.headless, "environment.browser.headless", file);
  const host = assertObject(environment.host, "environment.host", file);
  for (const key of ["platform", "release", "cpuModel"]) assertStringOrNull(host[key], `environment.host.${key}`, file);
  for (const key of ["cpuCount", "totalMemBytes", "freeMemBytes"]) {
    if (typeof host[key] !== "number" || !Number.isFinite(host[key])) throw new Error(`${file}: environment.host.${key} 숫자 누락`);
  }
  assertStringOrNull(host.powerProfile, "environment.host.powerProfile", file);
  const engine = assertObject(environment.engine, "environment.engine", file);
  for (const key of ["name", "indexURL", "pythonVersion", "numpyVersion"]) assertStringOrNull(engine[key], `environment.engine.${key}`, file);
  assertBooleanOrNull(engine.selfHosted, "environment.engine.selfHosted", file);
  const evidence = assertObject(artifact.evidence, "evidence", file);
  assertStringOrNull(evidence.source, "evidence.source", file);
  assertStringOrNull(evidence.rawOutput, "evidence.rawOutput", file);
  assertStringOrNull(evidence.note, "evidence.note", file);
  if (!evidence.rawOutput && !evidence.source) throw new Error(`${file}: evidence.rawOutput 또는 evidence.source 필요`);
  assertFiniteOrNull(evidence.timeoutMs, "evidence.timeoutMs", file);
  if (measurement.sampleCount !== (artifact.metrics?.sampleCount || 0)) throw new Error(`${file}: measurement.sampleCount와 metrics.sampleCount 불일치`);
  if (!notApplicableReason && !measurement.command && !evidence.source && !evidence.rawOutput) throw new Error(`${file}: 측정 artifact는 command/source/rawOutput 중 하나 필요`);
  if (notApplicableReason && typeof notApplicableReason !== "string") throw new Error(`${file}: notApplicableReason 문자열 필요`);
  assertSampleSchema(artifact, file);
}

function normalizePairedSpeedArtifact(artifact, file, candidate) {
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

function normalizeReadyLatencyArtifact(artifact, file, candidate) {
  const sampleCount = requireFiniteNumber(artifact.metrics, "sampleCount", file);
  assertSamples(artifact, sampleCount, file);
  const medianMs = requireFiniteNumber(artifact.metrics, "medianMs", file);
  const p95Ms = requireFiniteNumber(artifact.metrics, "p95Ms", file);
  const minMs = requireFiniteNumber(artifact.metrics, "minMs", file);
  const maxMs = requireFiniteNumber(artifact.metrics, "maxMs", file);
  const maxErr = requireFiniteNumber(artifact.metrics, "maxErr", file);
  if (minMs > medianMs || medianMs > p95Ms || p95Ms > maxMs) throw new Error(`${file}: ${artifact.scenario} latency envelope 불일치`);
  return baseRow(artifact, file, candidate, {
    samples: sampleCount,
    medianMs,
    p95Ms,
    minMs,
    maxMs,
    maxErr,
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

function normalizeMachineResumeArtifact(artifact, file, candidate) {
  const sampleCount = requireFiniteNumber(artifact.metrics, "sampleCount", file);
  assertSamples(artifact, sampleCount, file);
  return baseRow(artifact, file, candidate, {
    samples: sampleCount,
    exportMedianMs: requireFiniteNumber(artifact.metrics, "exportMedianMs", file),
    exportP95Ms: requireFiniteNumber(artifact.metrics, "exportP95Ms", file),
    openMedianMs: requireFiniteNumber(artifact.metrics, "openMedianMs", file),
    openP95Ms: requireFiniteNumber(artifact.metrics, "openP95Ms", file),
    machineMBMedian: requireFiniteNumber(artifact.metrics, "machineMBMedian", file),
    machineMBMax: requireFiniteNumber(artifact.metrics, "machineMBMax", file),
    resumeRowsMin: requireFiniteNumber(artifact.metrics, "resumeRowsMin", file),
    resumeRowsMax: requireFiniteNumber(artifact.metrics, "resumeRowsMax", file),
    maxErr: requireFiniteNumber(artifact.metrics, "maxErr", file),
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
  if (scenario === S0_SCENARIO) return renderS0Markdown(rows);
  if (scenario === S0C_SCENARIO) return renderS0CMarkdown(rows);
  if (scenario === S1L_SCENARIO) return renderS1LMarkdown(rows);
  if (scenario === S2_SCENARIO) return renderS2Markdown(rows);
  if (scenario === S3_SCENARIO) return renderS3Markdown(rows);
  if (scenario === S4_SCENARIO) return renderS4Markdown(rows);
  return renderS1Markdown(rows);
}

function renderS1Markdown(rows) {
  return renderPairedSpeedMarkdown(rows, "single median ms", "shard median ms", "shard p95 ms");
}

function renderS2Markdown(rows) {
  return renderPairedSpeedMarkdown(rows, "serial median ms", "process pool median ms", "process pool p95 ms");
}

function renderS3Markdown(rows) {
  return renderReadyLatencyMarkdown(rows, "roundtrip median ms", "roundtrip p95 ms");
}

function renderS4Markdown(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const av = typeof a.openMedianMs === "number" ? a.openMedianMs : Number.POSITIVE_INFINITY;
    const bv = typeof b.openMedianMs === "number" ? b.openMedianMs : Number.POSITIVE_INFINITY;
    return av - bv;
  });
  const lines = [
    "| candidate | ok | samples | export median ms | export p95 ms | open median ms | open p95 ms | image MB median | resume rows | maxErr | browser | commit | source |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---|---|",
  ];
  for (const r of sorted) {
    const ok = r.notApplicableReason ? "N/A" : (r.ok ? "GREEN" : "RED");
    const source = r.notApplicableReason ? r.notApplicableReason : r.file;
    const resumeRows = typeof r.resumeRowsMin === "number" && typeof r.resumeRowsMax === "number"
      ? `${markdownCell(r.resumeRowsMin)}-${markdownCell(r.resumeRowsMax)}`
      : "N/A";
    lines.push(`| ${markdownCell(r.candidate)} | ${ok} | ${markdownCell(r.samples ?? "N/A")} | ${markdownCell(r.exportMedianMs ?? "N/A")} | ${markdownCell(r.exportP95Ms ?? "N/A")} | ${markdownCell(r.openMedianMs ?? "N/A")} | ${markdownCell(r.openP95Ms ?? "N/A")} | ${markdownCell(r.machineMBMedian ?? "N/A")} | ${resumeRows} | ${markdownCell(r.maxErr ?? "N/A")} | ${markdownCell(r.browser)} | ${markdownCell(r.commit + (r.dirty ? " dirty" : ""))} | ${markdownCell(source)} |`);
  }
  return lines.join("\n") + "\n";
}

function renderPairedSpeedMarkdown(rows, singleHeader, parallelHeader, parallelP95Header) {
  const sorted = rows.slice().sort((a, b) => {
    const av = typeof a.medianSpeedup === "number" ? a.medianSpeedup : -1;
    const bv = typeof b.medianSpeedup === "number" ? b.medianSpeedup : -1;
    return bv - av;
  });
  const lines = [
    `| candidate | ok | samples | ${singleHeader} | ${parallelHeader} | ${parallelP95Header} | median speedup | maxErr | browser | commit | source |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|",
  ];
  for (const r of sorted) {
    const ok = r.notApplicableReason ? "N/A" : (r.ok ? "GREEN" : "RED");
    const source = r.notApplicableReason ? r.notApplicableReason : r.file;
    lines.push(`| ${markdownCell(r.candidate)} | ${ok} | ${markdownCell(r.samples ?? "N/A")} | ${markdownCell(r.singleMedian ?? "N/A")} | ${markdownCell(r.parallelMedian ?? "N/A")} | ${markdownCell(r.parallelP95 ?? "N/A")} | ${markdownCell(r.medianSpeedup ?? "N/A")} | ${markdownCell(r.maxErr ?? "N/A")} | ${markdownCell(r.browser)} | ${markdownCell(r.commit + (r.dirty ? " dirty" : ""))} | ${markdownCell(source)} |`);
  }
  return lines.join("\n") + "\n";
}

function renderS0Markdown(rows) {
  return renderReadyLatencyMarkdown(rows, "ready median ms", "ready p95 ms");
}

function renderS0CMarkdown(rows) {
  return renderReadyLatencyMarkdown(rows, "cold ready median ms", "cold ready p95 ms");
}

function renderReadyLatencyMarkdown(rows, medianHeader, p95Header) {
  const sorted = rows.slice().sort((a, b) => {
    const av = typeof a.medianMs === "number" ? a.medianMs : Number.POSITIVE_INFINITY;
    const bv = typeof b.medianMs === "number" ? b.medianMs : Number.POSITIVE_INFINITY;
    return av - bv;
  });
  const lines = [
    `| candidate | ok | samples | ${medianHeader} | ${p95Header} | min ms | max ms | maxErr | browser | commit | source |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|",
  ];
  for (const r of sorted) {
    const ok = r.notApplicableReason ? "N/A" : (r.ok ? "GREEN" : "RED");
    const source = r.notApplicableReason ? r.notApplicableReason : r.file;
    lines.push(`| ${markdownCell(r.candidate)} | ${ok} | ${markdownCell(r.samples ?? "N/A")} | ${markdownCell(r.medianMs ?? "N/A")} | ${markdownCell(r.p95Ms ?? "N/A")} | ${markdownCell(r.minMs ?? "N/A")} | ${markdownCell(r.maxMs ?? "N/A")} | ${markdownCell(r.maxErr ?? "N/A")} | ${markdownCell(r.browser)} | ${markdownCell(r.commit + (r.dirty ? " dirty" : ""))} | ${markdownCell(source)} |`);
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
