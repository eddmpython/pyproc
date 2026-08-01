# Benchmark operating contract

Speed is an intermediate goal for pyproc. But speed is something I measure, not something I post. This document is the shared measurement rule the Speed Lab, the browser gate, and the product gates all follow.

## Principles

- **Measurements are never posted on a public surface.** Hang a number on the sign and you owe it forever, and that debt makes the product direction a servant of the benchmark (the no-bragging rule in CLAUDE.md; the performance-claim guard in `tests/run.mjs` blocks it mechanically). Keep measuring, but leave the results only in the progress ledgers and the benchmark artifacts. Give users the Speed Lab so they measure on their own machine instead.
- Never write a speed statement without a measurement. Words like "fast" or "N times" require a command, an environment, samples, raw output, and a recorded location - and that location is a ledger, not a public surface.
- Do not mix cold start with steady state. Cold boot, package load, worker pool warmup, and warmed compute are separate items.
- Do not judge from a single wall-clock reading. For steady state, record at least three warmed samples along with the median, p95, and max error.
- Do not score a comparison target zero when it cannot do the same work. Write `N/A` with the reason and keep the closest possible scenario separately.
- When comparing against an external product or runtime, prefer the same browser, the same machine, the same network conditions, the same data size, and the same Python/NumPy family. Record whatever you could not match as a caveat in the artifact. This comparison exists so I can find direction, not so I can publish it.

## Required fields of the measurement envelope

To put a benchmark result into a ledger, leave a schema v2 artifact. v2 keeps the older flat fields for compatibility but requires the four groups below as an envelope.

| Field | Contents |
|---|---|
| schemaVersion | The current artifact schema. A new artifact must be `2` |
| scenarioDefinition | Canonical scenario ID, name, primary metric, sampleSchema, default profile |
| measurement | The full command, startedAt/finishedAt, the cold/warm/gate profile, warmupCount, sampleCount |
| environment | commit, worktreeDirty, browser name/version/headless, host OS/CPU/memory/power hints, engine name/Python/NumPy/indexURL |
| evidence | source, rawOutput reference, note, runner config, page URL, timeoutMs, embedded report |
| metrics | The sample array, median, p95, min/max, error, and the speedup formula |

An external comparison artifact additionally carries `candidate`. pyproc's own reference artifact is `candidate: "pyproc"`.

`evidence.rawOutput` is not a free-form string. It must be one of these two:

- `embedded:report`: the browser gate report is inside the artifact JSON.
- `file:raw/<artifact-name>.txt`: a tracked raw sidecar file under the same `benchmarks/` directory as the artifact JSON. The path is slash-relative to the artifact file; `..` and absolute paths are forbidden.

Older manual measurement artifacts preserve command, source, note, samples, and metrics in a raw sidecar. For new measurements, capture the actual console output or the gate report with `--raw-output` or `--raw-output-file` whenever possible.

## Canonical scenarios

| ID | Name | Canonical pyproc path | Comparison metric | Green criteria |
|---|---|---|---|---|
| S0 | python ready latency | First successful Python command under the conditions recorded in each candidate's artifact note | ready median, p95, min/max, maxErr | At least three samples, execution succeeds |
| S0C | python cold ready latency | First successful Python command under a cold profile with caches cleared | cold ready median, p95, min/max, maxErr | At least three samples, execution succeeds |
| S1 | numpy sharded matmul | `examples/speedLab.html`, `npm run bench:speed` | single median, shard median, speedup, shard p95 | `maxErr < 1e-9`, `medianSpeedup >= 2.0`, shard p95 below single median |
| S1L | single-kernel numpy latency | `bench:artifact --scenario S1L` | warmed latency median, p95, min/max, maxErr | At least three samples, `maxErr < 1e-9` |
| S2 | process map | `bench:artifact --scenario S2` | serial median, process pool median, speedup, p95, maxErr | Results agree, speedup above 1 |
| S3 | browser server | `bench:artifact --scenario S3` | roundtrip median, p95, min/max, maxErr | At least three samples, the Python ASGI response arrives |
| S4 | machine resume | `bench:artifact --scenario S4` | export median/p95, open median/p95, image MB, resume rows | Trusted-key open, `resume.py` reopens its resources |
| S5 | immortal multi-tab machine | `npm run test:consumer`, `bench:artifact --scenario S5` | initial ready, RPC p50/p90, failover, recovery, cold reopen median/p95 | Three installed-package contexts share state and commit, the leader is force-removed, `failover p95 < 5000ms`, and a cold reopen after every context closes |

S1 is the canonical axis for speed measurement today - an internal baseline, not a sign. S1L is the single-lane auxiliary axis for when an external candidate cannot provide S1's parallel worker-pool contract. S0 is the existing Python-ready observation axis, and S0C is the stricter auxiliary axis that accepts only a cold profile with caches cleared. S2, S3, S4, and S5 are the perceived-speed axes of "a web OS you use like a local one".

## Recording gates

- Measurements are recorded only in progress ledgers and benchmark artifacts. They are never posted on a public surface (no bragging with numbers).
- Past external comparisons remain in git history. They are historical decision evidence, not current product claims, and are not revived or republished.
- Leave the canonical S1 raw JSON with `npm run bench:speed -- --out <path>` or `PYPROC_BENCH_OUT=<path> npm run bench:speed`. The default conditions are `workers=4`, `size=1024`, `samples=3`.
- The Speed Lab's human UI defaults to a matrix size of 768 for responsiveness; the canonical runner states `?workers=4&size=1024&samples=3` in the URL.
- To change the S1 conditions use `--workers`, `--size`, `--samples` or `PYPROC_BENCH_WORKERS`, `PYPROC_BENCH_SIZE`, `PYPROC_BENCH_SAMPLES`, and record them in the command field.
- Leave an external S1 candidate's raw JSON with `npm run bench:artifact -- --candidate <name> --command "<command>" --source "<source>" --raw-output "<raw-output-text>" --sample singleMs,parallelMs,maxErr --sample ... --out <path>`. With `--out`, the raw output text is stored as a `raw/<artifact-name>.txt` sidecar and the artifact records `file:raw/<artifact-name>.txt`. At least three samples are required.
- An external candidate that cannot perform the same S1 still gets an N/A artifact through `npm run bench:artifact -- --candidate <name> --source "<source>" --na "<reason>" --out <path>`.
- To link an already-stored raw file, use `--raw-output-file <path>`. That file must live under the same directory tree as the `--out` artifact.
- Merge several S1 artifacts into one Markdown table with `npm run bench:compare -- <artifact...> --out <path>`.
- Leave S0 raw JSON with `npm run bench:artifact -- --scenario S0 --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`. `latencyMs` runs from page or runtime start to the first successful Python command, under the conditions recorded in the artifact note.
- Leave S0C raw JSON with `npm run bench:artifact -- --scenario S0C --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`. `latencyMs` runs from page or runtime start to the first successful Python command under a cold profile with caches cleared.
- Leave S1L raw JSON with `npm run bench:artifact -- --scenario S1L --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`.
- Leave S2 raw JSON with `npm run bench:artifact -- --scenario S2 --candidate <name> --command "<command>" --sample serialMs,parallelMs,maxErr --sample ... --out <path>`. `serialMs` is the wall time of the same work run serially in the same process pool; `parallelMs` is the wall time when it is spread across the worker pool.
- Leave S3 raw JSON with `npm run bench:artifact -- --scenario S3 --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`. For pyproc, `latencyMs` is `timings.virtualOriginMs` from `npm run test:consumer`: the round trip of the installed package's `VirtualOrigin` POST to the Python ASGI response.
- Leave S4 raw JSON with `npm run bench:artifact -- --scenario S4 --candidate <name> --command "<command>" --sample exportMs,openMs,machineMB,resumeRows,maxErr --sample ... --out <path>`. For pyproc the values come from `timings.machineExportMs`, `timings.machineOpenMs`, `timings.machineMB`, and `timings.machineResumeRows` in `npm run test:consumer`.
- Leave S5 raw JSON with `npm run bench:artifact -- --scenario S5 --candidate pyproc --command "npm run test:consumer" --sample initialReadyMs,rpcP50Ms,rpcP90Ms,failoverMs,recoveryMs,coldReopenMs,maxErr --sample ... --out <path>`. The values come from mutually independent GREEN runs of `npm run test:consumer`, each of which includes the real installed package, three browsing contexts, a forced leader removal, and a cold reopen after every context is gone.
- `bench:compare` merges only artifacts of the same scenario into a table. Mixing S1 and S1L in one table must fail.
- When you add a new benchmark helper or runner, wire it into the `npm test` structure guard.
- `npm test` reads every tracked benchmark JSON through `normalizeBenchArtifactFile()` and verifies the schema v2 envelope, the sampleSchema, the rawOutput reference, and the git-tracked status of the raw sidecar.
