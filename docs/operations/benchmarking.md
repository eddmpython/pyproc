# 벤치마크 운영 계약

속도는 pyproc의 중간 목표다. 그러나 속도 주장은 데모 문구가 아니라 재현 가능한 측정 계약이어야 한다. 이 문서는 Speed Lab, browser gate, 제품 gate, 외부 비교 표가 따라야 할 공통 규칙이다.

## 원칙

- 실측 없는 속도 문구를 쓰지 않는다. "빠르다", "N배" 같은 표현은 명령, 환경, 샘플, 원시 출력, 기록 위치가 있을 때만 쓴다.
- cold start와 steady state를 섞지 않는다. cold boot, package load, worker pool warmup, warmed compute는 다른 항목이다.
- 단발 wall time으로 판정하지 않는다. steady state는 최소 3회 warmed sample, median, p95, max error를 같이 기록한다.
- 비교 대상이 같은 일을 하지 못하면 0점 처리하지 않는다. `N/A`와 사유를 적고, 가능한 가장 가까운 시나리오를 따로 둔다.
- 외부 제품 또는 외부 런타임과 비교할 때는 같은 브라우저, 같은 머신, 같은 네트워크 조건, 같은 데이터 크기, 같은 Python/NumPy 계열을 우선한다. 맞출 수 없는 조건은 표의 caveat에 남긴다.

## 실측 봉투 필수 필드

벤치 결과를 원장이나 README에 올리려면 아래 필드를 같이 남긴다.

| 필드 | 내용 |
|---|---|
| commit | pyproc commit SHA |
| command | 실행 명령 전체 |
| browser | 브라우저 이름과 버전, headless 여부 |
| host | OS, CPU 코어 수, 메모리, 전원 상태 |
| engine | Pyodide indexURL, self-hosted 여부, Python/NumPy 버전 |
| scenario | 아래 canonical scenario ID |
| samples | cold/warm 구분, sample 수, warmup 수 |
| metrics | median, p95, min/max, error, speedup 계산식 |
| raw output | 명령 출력 또는 gate report 위치 |

외부 비교 artifact는 추가로 `candidate`를 가진다. pyproc의 기준 artifact는 `candidate: "pyproc"`이다.

## canonical scenario

| ID | 이름 | pyproc 정본 경로 | 비교 metric | green 기준 |
|---|---|---|---|---|
| S0 | basic boot | `npm run test:browser`의 boot 실측 | boot ms | 실행 성공과 기록 |
| S1 | numpy sharded matmul | `examples/speedLab.html`, `npm run bench:speed` | single median, shard median, speedup, shard p95 | `maxErr < 1e-9`, `medianSpeedup >= 2.0`, `shard p95 < single median` |
| S1L | single-kernel numpy latency | `bench:artifact --scenario S1L` | warmed latency median, p95, min/max, maxErr | 최소 3회 sample, `maxErr < 1e-9` |
| S2 | process map | `npm run test:browser`의 `PyProc.map` | serial vs worker pool wall time | 결과 일치, speedup > 1 |
| S3 | browser server | `npm run test:consumer`의 `VirtualOrigin` | POST roundtrip ms | Python ASGI 응답 도달 |
| S4 | machine resume | `npm run test:consumer`의 signed `.pymachine` | export MB/ms, open ms, resume rows | trusted key open, `resume.py` 재개설 |

S1은 현재 공개 속도 간판이다. S1L은 외부 후보가 S1의 병렬 worker pool 계약을 제공하지 못할 때 쓰는 single-lane 보조 축이다. S0, S2, S3, S4는 "로컬처럼 쓰는 웹 OS"의 체감 속도 축이다.

## 외부 비교 표 규칙

첫 비교 후보는 WebVM, JupyterLite, marimo web runtime이다. 이 문서는 측정된 artifact가 있는 항목만 숫자로 채운다.

| 비교 축 | pyproc | WebVM | JupyterLite | marimo web runtime | caveat |
|---|---|---|---|---|---|
| S0 basic boot | 측정 필요 | 측정 필요 | 측정 필요 | 측정 필요 | 같은 브라우저와 캐시 상태 |
| S1 numpy sharded matmul | Speed Lab 반복 봉투 | N/A 가능 | N/A 가능 | N/A 가능 | 병렬 worker 모델이 다르면 single-lane으로 재정의하지 않음 |
| S1L single-kernel numpy latency | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-pyproc-2026-07-15.json) | 측정 필요 | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-jupyterlite-2026-07-15.json) | [측정됨](../../mainPlan/browser-os-north-star/benchmarks/s1l-marimo-wasm-2026-07-15.json) | S1 대체가 아니라 별도 single-lane 보조 축 |
| S2 process map | browser gate | 측정 필요 | 측정 필요 | 측정 필요 | 같은 순수 Python 또는 NumPy 작업 |
| S3 browser server | product consumer gate | 측정 필요 | 측정 필요 | 측정 필요 | URL fetch로 Python까지 가는지 구분 |
| S4 machine resume | product consumer gate | 측정 필요 | 측정 필요 | 측정 필요 | 파일 이미지, persistence, resume hook 동등성 |

## 공개 문구 게이트

- README의 속도 숫자는 진행 원장 또는 gate output에서 온 값만 쓴다.
- 외부 비교 표는 [mainPlan/browser-os-north-star/06-speed-comparison.md](../../mainPlan/browser-os-north-star/06-speed-comparison.md)가 활성 작업 정본이다.
- S1 canonical raw JSON은 `npm run bench:speed -- --out <path>` 또는 `PYPROC_BENCH_OUT=<path> npm run bench:speed`로 남긴다. 기본 조건은 `workers=4`, `size=1024`, `samples=3`이다.
- Speed Lab 사람용 UI의 기본 행렬 크기는 반응성을 위해 768이고, canonical runner는 `?workers=4&size=1024&samples=3`를 URL에 명시한다.
- S1 조건을 바꿀 때는 `--workers`, `--size`, `--samples` 또는 `PYPROC_BENCH_WORKERS`, `PYPROC_BENCH_SIZE`, `PYPROC_BENCH_SAMPLES`를 쓰고, command 필드에 남긴다.
- 외부 S1 후보 raw JSON은 `npm run bench:artifact -- --candidate <name> --command "<command>" --sample singleMs,parallelMs,maxErr --sample ... --out <path>`로 남긴다. 최소 3개 sample이 필요하다.
- 같은 S1을 수행하지 못한 외부 후보도 `npm run bench:artifact -- --candidate <name> --na "<reason>" --out <path>`로 N/A artifact를 남긴다.
- 여러 S1 artifact는 `npm run bench:compare -- <artifact...> --out <path>`로 Markdown 표로 합친다.
- S1L raw JSON은 `npm run bench:artifact -- --scenario S1L --candidate <name> --command "<command>" --sample latencyMs,maxErr --sample ... --out <path>`로 남긴다.
- `bench:compare`는 같은 scenario끼리만 표로 합친다. S1과 S1L을 한 표에 섞으면 실패해야 한다.
- 새 benchmark helper나 runner를 추가하면 `npm test` 구조 가드에 연결한다.
