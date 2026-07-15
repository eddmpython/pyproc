// benchStats.js - 데모와 browser probe가 공유하는 작은 벤치 통계 계약.
// 런타임 공개 API가 아니라 측정 표면의 드리프트를 막는 examples 전용 helper다.

export function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile: values가 비었다");
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * pct / 100) - 1));
  return sorted[index];
}

export function median(values) {
  return percentile(values, 50);
}

export function summarizePairedLatencyBench(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("summarizePairedLatencyBench: rows가 비었다");
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

export function summarizeLatencyBench(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("summarizeLatencyBench: rows가 비었다");
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
