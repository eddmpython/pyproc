# 벤치마크 운영 계약

속도는 pyproc의 중간 목표다. 그러나 속도 주장은 데모 문구가 아니라 재현 가능한 측정 계약이어야 한다. 이 문서는 Speed Lab, browser gate, 제품 gate, 외부 비교 표가 따라야 할 공통 규칙이다.

## 원칙

- 실측 없는 속도 문구를 쓰지 않는다. "빠르다", "N배" 같은 표현은 명령, 환경, 샘플, 원시 출력, 기록 위치가 있을 때만 쓴다.
- cold start와 steady state를 섞지 않는다. cold boot, package load, worker pool warmup, warmed compute는 다른 항목이다.
- 단발 wall time으로 판정하지 않는다. steady state는 최소 3회 warmed sample, median, p95, max error를 같이 기록한다.
- 비교 대상이 같은 일을 하지 못하면 0점 처리하지 않는다. `N/A`와 사유를 적고, 가능한 가장 가까운 시나리오를 따로 둔다.
- 외부 제품 또는 외부 런타임과 비교할 때는 같은 브라우저, 같은 머신, 같은 네트워크 조건, 같은 데이터 크기, 같은 Python/NumPy 계열을 우선한다. 맞출 수 없는 조건은 표의 caveat에 남긴다.

## 실측 봉투 필수 필드

벤치 결과를 원장이나 README에 올리려면 schema v2 artifact를 남긴다. v2는 예전의 flat 필드를 호환 목적으로 유지하되, 아래 네 묶음을 필수 봉투로 둔다.

| 필드 | 내용 |
|---|---|
| schemaVersion | 현재 artifact schema. 새 artifact는 `2`여야 한다 |
| scenarioDefinition | canonical scenario ID, 이름, primary metric, sampleSchema, 기본 profile |
| measurement | 실행 명령 전체, startedAt/finishedAt, cold/warm/gate profile, warmupCount, sampleCount |
| environment | commit, worktreeDirty, browser 이름/버전/headless, host OS/CPU/메모리/전원 힌트, engine 이름/Python/NumPy/indexURL |
| evidence | source, rawOutput reference, note, runner config, page URL, timeoutMs, embedded report |
| metrics | sample 배열, median, p95, min/max, error, speedup 계산식 |

외부 비교 artifact는 추가로 `candidate`를 가진다. pyproc의 기준 artifact는 `candidate: "pyproc"`이다.

`evidence.rawOutput`은 자유 문자열이 아니다. 아래 둘 중 하나여야 한다.

- `embedded:report`: browser gate report가 artifact JSON 안에 들어 있는 경우.
- `file:raw/<artifact-name>.txt`: artifact JSON과 같은 `benchmarks/` 디렉터리 아래의 tracked raw sidecar 파일을 가리키는 경우. 경로는 artifact 파일 기준 slash 상대경로이며 `..`와 절대경로는 금지한다.

과거 수동 측정 artifact는 raw sidecar에 command, source, note, sample, metric을 보존한다. 새 측정은 가능하면 실제 콘솔 출력이나 gate report를 `--raw-output` 또는 `--raw-output-file`로 함께 남긴다.

## canonical scenario

| ID | 이름 | pyproc 정본 경로 | 비교 metric | green 기준 |
|---|---|---|---|---|
| S0 | python ready latency | 후보별 artifact note에 기록한 조건의 첫 Python 명령 성공 | ready median, p95, min/max, maxErr | 최소 3회 sample, 실행 성공 |
| S0C | python cold ready latency | cold profile/cache-clear 조건의 첫 Python 명령 성공 | cold ready median, p95, min/max, maxErr | 최소 3회 sample, 실행 성공 |
| S1 | numpy sharded matmul | `examples/speedLab.html`, `npm run bench:speed` | single median, shard median, speedup, shard p95 | `maxErr < 1e-9`, `medianSpeedup >= 2.0`, `shard p95 < single median` |
| S1L | single-kernel numpy latency | `bench:artifact --scenario S1L` | warmed latency median, p95, min/max, maxErr | 최소 3회 sample, `maxErr < 1e-9` |
| S2 | process map | `bench:artifact --scenario S2` | serial median, process pool median, speedup, p95, maxErr | 결과 일치, speedup > 1 |
| S3 | browser server | `bench:artifact --scenario S3` | roundtrip median, p95, min/max, maxErr | 최소 3회 sample, Python ASGI 응답 도달 |
| S4 | machine resume | `bench:artifact --scenario S4` | export median/p95, open median/p95, image MB, resume rows | trusted key open, `resume.py` 재개설 |

S1은 현재 공개 속도 간판이다. S1L은 외부 후보가 S1의 병렬 worker pool 계약을 제공하지 못할 때 쓰는 single-lane 보조 축이다. S0는 기존 Python ready 관측 축이고, S0C는 cold profile/cache-clear 조건만 받는 엄격한 보조 축이다. S2, S3, S4는 "로컬처럼 쓰는 웹 OS"의 체감 속도 축이다.

## 외부 비교 표 규칙

첫 비교 후보는 WebVM, JupyterLite, marimo web runtime이다. 이 문서는 측정된 artifact가 있는 항목만 숫자로 채운다.

| 비교 축 | pyproc | WebVM | JupyterLite | marimo web runtime | caveat |
|---|---|---|---|---|---|
| S0 python ready latency | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0-pyproc-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0-webvm-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0-jupyterlite-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0-marimo-wasm-2026-07-15.json) | 페이지 또는 런타임 시작부터 첫 Python 명령 성공까지. 조건은 각 artifact note를 따른다 |
| S0C python cold ready latency | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0c-pyproc-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0c-webvm-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0c-jupyterlite-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s0c-marimo-wasm-2026-07-15.json) | cold profile/cache-clear 조건. warm S0와 한 표에 섞지 않음 |
| S1 numpy sharded matmul | Speed Lab 반복 봉투 | N/A 가능 | N/A 가능 | N/A 가능 | 병렬 worker 모델이 다르면 single-lane으로 재정의하지 않음 |
| S1L single-kernel numpy latency | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-pyproc-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-webvm-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-jupyterlite-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-marimo-wasm-2026-07-15.json) | S1 대체가 아니라 별도 single-lane 보조 축 |
| S2 process map | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s2-pyproc-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s2-webvm-na-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s2-jupyterlite-na-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s2-marimo-wasm-na-2026-07-15.json) | `PyProc.map` process pool 계약. 같은 API 후보가 없으면 N/A |
| S3 browser server | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s3-pyproc-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s3-webvm-na-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s3-jupyterlite-na-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s3-marimo-wasm-na-2026-07-15.json) | pyproc `VirtualOrigin`/ASGI Service Worker URL contract. 같은 계약 후보가 없으면 N/A |
| S4 machine resume | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s4-pyproc-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s4-webvm-na-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s4-jupyterlite-na-2026-07-15.json) | [N/A](../../mainPlan/browser-os-north-star/benchmarks/s4-marimo-wasm-na-2026-07-15.json) | signed `.pymachine`, trusted open, `resume.py` resource reopen. 같은 계약 후보가 없으면 N/A |

## 공개 문구 게이트

- README의 속도 숫자는 진행 원장 또는 gate output에서 온 값만 쓴다.
- 외부 비교 표는 [mainPlan/browser-os-north-star/06-speed-comparison.md](../../mainPlan/browser-os-north-star/06-speed-comparison.md)가 활성 작업 정본이다.
- S1 canonical raw JSON은 `npm run bench:speed -- --out <path>` 또는 `PYPROC_BENCH_OUT=<path> npm run bench:speed`로 남긴다. 기본 조건은 `workers=4`, `size=1024`, `samples=3`이다.
- Speed Lab 사람용 UI의 기본 행렬 크기는 반응성을 위해 768이고, canonical runner는 `?workers=4&size=1024&samples=3`를 URL에 명시한다.
- S1 조건을 바꿀 때는 `--workers`, `--size`, `--samples` 또는 `PYPROC_BENCH_WORKERS`, `PYPROC_BENCH_SIZE`, `PYPROC_BENCH_SAMPLES`를 쓰고, command 필드에 남긴다.
- 외부 S1 후보 raw JSON은 `npm run bench:artifact -- --candidate <name> --command "<command>" --source "<source>" --raw-output "<raw-output-text>" --sample singleMs,parallelMs,maxErr --sample ... --out <path>`로 남긴다. `--out`이 있으면 raw output text는 `raw/<artifact-name>.txt` sidecar로 저장되고 artifact에는 `file:raw/<artifact-name>.txt`가 들어간다. 최소 3개 sample이 필요하다.
- 같은 S1을 수행하지 못한 외부 후보도 `npm run bench:artifact -- --candidate <name> --source "<source>" --na "<reason>" --out <path>`로 N/A artifact를 남긴다.
- 이미 보관한 raw file을 연결할 때는 `--raw-output-file <path>`를 쓴다. 이 파일은 `--out` artifact와 같은 디렉터리 트리 아래에 있어야 한다.
- 여러 S1 artifact는 `npm run bench:compare -- <artifact...> --out <path>`로 Markdown 표로 합친다.
- S0 raw JSON은 `npm run bench:artifact -- --scenario S0 --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`로 남긴다. `latencyMs`는 artifact note에 기록한 조건에서 페이지 또는 런타임 시작부터 첫 Python 명령 성공까지다.
- S0C raw JSON은 `npm run bench:artifact -- --scenario S0C --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`로 남긴다. `latencyMs`는 cold profile/cache-clear 조건에서 페이지 또는 런타임 시작부터 첫 Python 명령 성공까지다.
- S1L raw JSON은 `npm run bench:artifact -- --scenario S1L --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`로 남긴다.
- S2 raw JSON은 `npm run bench:artifact -- --scenario S2 --candidate <name> --command "<command>" --sample serialMs,parallelMs,maxErr --sample ... --out <path>`로 남긴다. `serialMs`는 같은 작업을 같은 process pool에서 직렬로 돌린 wall time이고, `parallelMs`는 worker pool에 분산한 wall time이다.
- S3 raw JSON은 `npm run bench:artifact -- --scenario S3 --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`로 남긴다. pyproc 기준 `latencyMs`는 `npm run test:consumer`의 `timings.virtualOriginMs`, 즉 설치 패키지의 `VirtualOrigin` POST가 Python ASGI 응답까지 왕복한 시간이다.
- S4 raw JSON은 `npm run bench:artifact -- --scenario S4 --candidate <name> --command "<command>" --sample exportMs,openMs,machineMB,resumeRows,maxErr --sample ... --out <path>`로 남긴다. pyproc 기준 값은 `npm run test:consumer`의 `timings.machineExportMs`, `timings.machineOpenMs`, `timings.machineMB`, `timings.machineResumeRows`에서 가져온다.
- `bench:compare`는 같은 scenario끼리만 표로 합친다. S1과 S1L을 한 표에 섞으면 실패해야 한다.
- 새 benchmark helper나 runner를 추가하면 `npm test` 구조 가드에 연결한다.
- `npm test`는 tracked benchmark JSON 전부를 `normalizeBenchArtifactFile()`로 읽어 schema v2 봉투, sampleSchema, rawOutput reference, raw sidecar의 git 추적 상태를 검증한다.
