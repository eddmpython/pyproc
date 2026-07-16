# pyproc vs other browser Python runtimes

How pyproc compares to [WebVM](https://webvm.io), [JupyterLite](https://jupyterlite.readthedocs.io),
and the [marimo web runtime](https://marimo.io) on measured, reproducible scenarios - and
where a comparison is honestly impossible because no other candidate ships the same contract.

Two rules keep this page honest (the full measurement contract lives in
[benchmarking.md](../operations/benchmarking.md), Korean):

1. **Numbers live in artifacts, not prose.** Every cell links a tracked JSON artifact with
   the full command, environment, samples, and raw output sidecar. This page never states a
   number an artifact does not carry.
2. **A candidate that cannot do the job is N/A, not zero.** When no public API of a
   candidate can express the scenario, we record an N/A artifact with the reason instead of
   penalizing it with a made-up number.

## Scenarios

| ID | What it measures | Why it matters to an agent product |
|---|---|---|
| S0 | Warm "python ready" latency: page start to first successful Python statement | How long a returning user waits |
| S0C | Cold python ready latency (cache-clear profile) | First-visit cost |
| S1 | Sharded NumPy matmul across a worker pool vs a single kernel | Real multi-core speedup (N interpreters = N GILs) |
| S1L | Single-kernel NumPy latency | Fallback axis when a candidate has no worker-pool contract |
| S2 | Process-pool `map` vs serial on the same pool | True parallel task fan-out |
| S3 | `fetch()` round trip into an in-tab Python ASGI server | Serving Python behind a real URL, no backend |
| S4 | Signed `.pymachine` export, trusted open, `resume.py` resource reopen | Moving a live machine between profiles |
| S5 | Multi-tab immortal machine: leader failover, journal recovery, cold reopen | Surviving tab death without a server |

## Results (2026-07-15 measurement set)

| Axis | pyproc | WebVM | JupyterLite | marimo web runtime |
|---|---|---|---|---|
| S0 warm ready | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0-pyproc-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0-webvm-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0-jupyterlite-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0-marimo-wasm-2026-07-15.json) |
| S0C cold ready | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0c-pyproc-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0c-webvm-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0c-jupyterlite-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s0c-marimo-wasm-2026-07-15.json) |
| S1 sharded NumPy | [Speed Lab envelope](../../examples/speedLab.html) | N/A (no worker-pool NumPy contract) | N/A (same) | N/A (same) |
| S1L single-kernel NumPy | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s1l-pyproc-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s1l-webvm-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s1l-jupyterlite-2026-07-15.json) | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s1l-marimo-wasm-2026-07-15.json) |
| S2 process map | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s2-pyproc-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s2-webvm-na-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s2-jupyterlite-na-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s2-marimo-wasm-na-2026-07-15.json) |
| S3 browser server | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s3-pyproc-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s3-webvm-na-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s3-jupyterlite-na-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s3-marimo-wasm-na-2026-07-15.json) |
| S4 machine resume | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s4-pyproc-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s4-webvm-na-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s4-jupyterlite-na-2026-07-15.json) | [N/A + reason](../../mainPlan/_done/browser-os-north-star/benchmarks/s4-marimo-wasm-na-2026-07-15.json) |
| S5 immortal machine | [artifact](../../mainPlan/_done/browser-os-north-star/benchmarks/s5-pyproc-2026-07-15.json) | N/A (no equivalent public contract) | N/A (same) | N/A (same) |

The pattern to read: on the axes every candidate shares (S0/S0C/S1L - boot and run one
kernel), the candidates are comparable and each artifact carries its own numbers. On the
axes that define pyproc (S2 parallel process pool, S3 in-tab ASGI URL, S4 signed portable
machine, S5 multi-tab failover), the other candidates have **no public API that expresses
the scenario at all** - that is the product thesis, recorded as N/A artifacts with reasons
rather than as claimed victories.

## Reproduce it yourself

```sh
git clone https://github.com/eddmpython/pyproc && cd pyproc
npm run bench:speed              # S1: measures and writes a schema v2 artifact
npm run test:browser             # runtime gate with timings (boot, restoreLive, fork, map)
npm run test:consumer            # S3/S5 paths on the installed npm tarball
node tests/browser/run.mjs examples/speedLab.html   # human-visible S1 run
```

External candidates: run the closest equivalent in the candidate's own UI, then record
with `npm run bench:artifact -- --candidate <name> --command "..." --sample ... --out <path>`
(or `--na "<reason>"` when the scenario is inexpressible). The schema forces command,
environment, at least 3 samples, and a raw output reference.

## Honest caveats

- Only S1 has a fully automated measure-and-record pipeline (`bench:speed`). S0/S0C and
  S2-S5 artifacts are recorded through `bench:artifact`, which validates and stores
  operator-entered samples with raw sidecars - the numbers are real measurements, but the
  pipeline does not re-measure them on every CI run.
- All 2026-07-15 artifacts share one machine/browser/network; the environment block inside
  each artifact is the authority on conditions.
- pyproc is Chromium/Edge only (JSPI + SharedArrayBuffer + crossOriginIsolated) by scope.
  Candidates that run on more browsers win that axis by default.
- Speed claims are contract-specific. Single-kernel NumPy in pyproc is ordinary
  WebAssembly BLAS - the speedups come from the process pool (S1/S2), not from magic.
