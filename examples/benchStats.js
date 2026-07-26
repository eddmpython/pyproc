// benchStats.js - the small benchmark statistics contract shared by the demos and the browser probes.
// Not part of the runtime's public API: an examples-only helper that keeps the measurement surface
// from drifting.

export function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile: values is empty");
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * pct / 100) - 1));
  return sorted[index];
}

export function median(values) {
  return percentile(values, 50);
}

export function summarizePairedLatencyBench(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("summarizePairedLatencyBench: rows is empty");
  const single = rows.map((r) => r.singleMs);
  const parallel = rows.map((r) => r.parallelMs);
  const speedups = rows.map((r) => r.speedup ?? +(r.singleMs / r.parallelMs).toFixed(2));
  return {
    samples: rows,
    sampleCount: rows.length,
    singleMedian: median(single),
    singleP95: percentile(single, 95),
    parallelMedian: median(parallel),
    parallelP95: percentile(parallel, 95),
    medianSpeedup: median(speedups),
    maxErr: Math.max(...rows.map((r) => r.maxErr ?? 0)),
  };
}

export function isShardedSpeedBenchGreen(bench, opts = {}) {
  const minMedianSpeedup = opts.minMedianSpeedup ?? 2.0;
  const maxErr = opts.maxErr ?? 1e-9;
  return bench.maxErr < maxErr
    && bench.medianSpeedup >= minMedianSpeedup
    && bench.parallelP95 < bench.singleMedian;
}

export function isProcessMapBenchGreen(bench, opts = {}) {
  const minMedianSpeedup = opts.minMedianSpeedup ?? 1.01;
  const maxErr = opts.maxErr ?? 1e-9;
  return bench.maxErr < maxErr
    && bench.medianSpeedup >= minMedianSpeedup
    && bench.parallelP95 < bench.singleMedian;
}

export function summarizeLatencyBench(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("summarizeLatencyBench: rows is empty");
  const latencies = rows.map((r) => r.latencyMs);
  return {
    samples: rows,
    sampleCount: rows.length,
    medianMs: median(latencies),
    p95Ms: percentile(latencies, 95),
    minMs: Math.min(...latencies),
    maxMs: Math.max(...latencies),
    maxErr: Math.max(...rows.map((r) => r.maxErr ?? 0)),
  };
}

export function isLatencyBenchGreen(bench, opts = {}) {
  const maxErr = opts.maxErr ?? 1e-9;
  return bench.sampleCount >= 3 && bench.maxErr < maxErr;
}

export function summarizeMachineResumeBench(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("summarizeMachineResumeBench: rows is empty");
  const exportMs = rows.map((r) => r.exportMs);
  const openMs = rows.map((r) => r.openMs);
  const machineMB = rows.map((r) => r.machineMB);
  const resumeRows = rows.map((r) => r.resumeRows);
  return {
    samples: rows,
    sampleCount: rows.length,
    exportMedianMs: median(exportMs),
    exportP95Ms: percentile(exportMs, 95),
    openMedianMs: median(openMs),
    openP95Ms: percentile(openMs, 95),
    machineMBMedian: median(machineMB),
    machineMBMax: Math.max(...machineMB),
    resumeRowsMin: Math.min(...resumeRows),
    resumeRowsMax: Math.max(...resumeRows),
    maxErr: Math.max(...rows.map((r) => r.maxErr ?? 0)),
  };
}

export function isMachineResumeBenchGreen(bench, opts = {}) {
  const maxErr = opts.maxErr ?? 1e-9;
  const expectedResumeRows = opts.expectedResumeRows ?? 2;
  return bench.sampleCount >= 3
    && bench.maxErr < maxErr
    && bench.machineMBMax > 0
    && bench.exportMedianMs >= 0
    && bench.openMedianMs >= 0
    && bench.resumeRowsMin === expectedResumeRows
    && bench.resumeRowsMax === expectedResumeRows;
}

export function summarizeImmortalMachineBench(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("summarizeImmortalMachineBench: rows is empty");
  const summarize = (key) => ({
    median: median(rows.map((r) => r[key])),
    p95: percentile(rows.map((r) => r[key]), 95),
  });
  const initialReady = summarize("initialReadyMs");
  const rpcP50 = summarize("rpcP50Ms");
  const rpcP90 = summarize("rpcP90Ms");
  const failover = summarize("failoverMs");
  const recovery = summarize("recoveryMs");
  const coldReopen = summarize("coldReopenMs");
  return {
    samples: rows,
    sampleCount: rows.length,
    initialReadyMedianMs: initialReady.median,
    initialReadyP95Ms: initialReady.p95,
    rpcP50MedianMs: rpcP50.median,
    rpcP50P95Ms: rpcP50.p95,
    rpcP90MedianMs: rpcP90.median,
    rpcP90P95Ms: rpcP90.p95,
    failoverMedianMs: failover.median,
    failoverP95Ms: failover.p95,
    recoveryMedianMs: recovery.median,
    recoveryP95Ms: recovery.p95,
    coldReopenMedianMs: coldReopen.median,
    coldReopenP95Ms: coldReopen.p95,
    maxErr: Math.max(...rows.map((r) => r.maxErr ?? 0)),
  };
}

export function isImmortalMachineBenchGreen(bench, opts = {}) {
  const maxErr = opts.maxErr ?? 1e-9;
  const maxFailoverP95Ms = opts.maxFailoverP95Ms ?? 5000;
  return bench.sampleCount >= 3
    && bench.maxErr < maxErr
    && bench.failoverP95Ms < maxFailoverP95Ms;
}
