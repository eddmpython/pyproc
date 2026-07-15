# 06. 속도 정면 비교 계약

상태: pyproc S1 기준 artifact 기록. WebVM, JupyterLite, marimo WASM은 같은 S1 계약을 N/A artifact로 봉인. S1L은 pyproc, JupyterLite, marimo WASM을 같은 브라우저에서 측정.

## 목표

웹파이썬의 속도 목표를 "느낌"이 아니라 비교 가능한 숫자로 만든다. pyproc의 간판은 현재 Speed Lab의 4-worker sharded NumPy matmul이지만, Browser Python OS 목표에는 부팅, 병렬 실행, 브라우저 안 서버, machine resume까지 포함된다.

## 비교 원칙

정본 규칙은 [벤치마크 운영 계약](../../docs/operations/benchmarking.md)이다.

- cold boot와 warmed compute를 분리한다.
- 단발 결과가 아니라 최소 3회 warmed sample의 median/p95를 쓴다.
- 외부 런타임이 같은 시나리오를 수행하지 못하면 `N/A`와 사유를 남긴다.
- pyproc 숫자는 gate output이나 원장에 있는 값만 승격한다.

## 현재 pyproc 기준점

| scenario | 현재 증거 | 기준 |
|---|---|---|
| S0 basic boot | `npm run test:browser` | boot ms와 전체 gate GREEN |
| S1 numpy sharded matmul | `examples/speedLab.html`, `npm run bench:speed` | `workers=4`, `size=1024`, `samples=3`, `medianSpeedup >= 2.0`, `shard p95 < single median`, `maxErr < 1e-9` |
| S1L single-kernel numpy latency | `npm run bench:artifact -- --scenario S1L` | warmed latency median, p95, min/max, maxErr |
| S2 process map | `npm run test:browser` | 결과 일치와 worker pool speedup |
| S3 browser server | `npm run test:consumer` | `VirtualOrigin` POST roundtrip |
| S4 machine resume | `npm run test:consumer` | signed `.pymachine` export/open/resume |

## 추적 evidence

| date | scenario | artifact | compare | result |
|---|---|---|---|---|
| 2026-07-15 | S1 pyproc | [s1-pyproc-2026-07-15.json](benchmarks/s1-pyproc-2026-07-15.json) | [s1-compare-2026-07-15.md](benchmarks/s1-compare-2026-07-15.md) | GREEN, `size=1024`, 3 samples, median 3.95x, shard p95 2606ms, maxErr 0 |
| 2026-07-15 | S1 external candidates | [webvm N/A](benchmarks/s1-webvm-na-2026-07-15.json), [jupyterlite N/A](benchmarks/s1-jupyterlite-na-2026-07-15.json), [marimo-wasm N/A](benchmarks/s1-marimo-wasm-na-2026-07-15.json) | [s1-compare-2026-07-15.md](benchmarks/s1-compare-2026-07-15.md) | 같은 4-worker sharded NumPy matmul 계약 없음 |
| 2026-07-15 | S1L pyproc | [s1l-pyproc-2026-07-15.json](benchmarks/s1l-pyproc-2026-07-15.json) | [s1l-compare-2026-07-15.md](benchmarks/s1l-compare-2026-07-15.md) | GREEN, 3 samples, median 10067ms, p95 10073ms, maxErr 0 |
| 2026-07-15 | S1L JupyterLite | [s1l-jupyterlite-2026-07-15.json](benchmarks/s1l-jupyterlite-2026-07-15.json) | [s1l-compare-2026-07-15.md](benchmarks/s1l-compare-2026-07-15.md) | GREEN, 3 samples, median 10149ms, p95 10153ms, maxErr 0 |
| 2026-07-15 | S1L marimo WASM | [s1l-marimo-wasm-2026-07-15.json](benchmarks/s1l-marimo-wasm-2026-07-15.json) | [s1l-compare-2026-07-15.md](benchmarks/s1l-compare-2026-07-15.md) | GREEN, 3 samples, median 9355ms, p95 11424ms, maxErr 0 |

## 외부 비교 matrix

아래 표는 측정 슬롯이다. 측정 전에는 상대 성능을 주장하지 않는다.

| scenario | pyproc command | WebVM | JupyterLite | marimo web runtime | 판정 |
|---|---|---|---|---|---|
| S0 basic boot | `npm run test:browser` | 미측정 | 미측정 | 미측정 | 보류 |
| S1 numpy sharded matmul | `npm run bench:speed -- --out <path>` | [N/A](benchmarks/s1-webvm-na-2026-07-15.json) | [N/A](benchmarks/s1-jupyterlite-na-2026-07-15.json) | [N/A](benchmarks/s1-marimo-wasm-na-2026-07-15.json) | pyproc만 같은 S1 계약 충족 |
| S1L single-kernel numpy latency | [artifact](benchmarks/s1l-pyproc-2026-07-15.json) | 미측정 | [artifact](benchmarks/s1l-jupyterlite-2026-07-15.json) | [artifact](benchmarks/s1l-marimo-wasm-2026-07-15.json) | WebVM 제외 3자 측정 완료 |
| S2 process map | `npm run test:browser` | 미측정 | 미측정 | 미측정 | 보류 |
| S3 browser server | `npm run test:consumer` | 미측정 | 미측정 | 미측정 | 보류 |
| S4 machine resume | `npm run test:consumer` | 미측정 | 미측정 | 미측정 | 보류 |

`bench:speed`의 기본 S1 조건은 `workers=4`, `size=1024`, `samples=3`이다. 사람용 Speed Lab UI는 반응성을 위해 768 기본값을 쓰지만, runner는 URL query로 canonical 크기를 명시한다.

S1 artifact가 여러 개 생기면 아래 명령으로 표를 만든다.

```bash
npm run bench:artifact -- --candidate jupyterlite --command "manual S1 page run" --sample 1500,1500,0 --sample 1490,1510,0 --sample 1520,1505,0 --out .tmp/jupyterlite-s1.json
npm run bench:artifact -- --candidate webvm --na "S1 sharded worker model 미측정" --out .tmp/webvm-s1-na.json
npm run bench:compare -- .tmp/pyproc-s1.json .tmp/jupyterlite-s1.json --out .tmp/s1-compare.md
```

S1L artifact는 S1을 single-lane으로 바꿔치기하지 않기 위한 보조 축이다. 같은 행렬 크기와 같은 브라우저에서 단일 Python kernel 또는 단일 worker의 warmed NumPy matmul latency만 비교한다.

```bash
npm run bench:artifact -- --scenario S1L --candidate jupyterlite --command "manual single-kernel S1L run" --sample 9844,0 --sample 10149,0 --sample 10153,0 --out .tmp/jupyterlite-s1l.json
npm run bench:artifact -- --scenario S1L --candidate marimo-wasm --command "manual single-kernel S1L run" --sample 11424,0 --sample 9355,0 --sample 9239,0 --out .tmp/marimo-wasm-s1l.json
npm run bench:compare -- .tmp/pyproc-s1l.json .tmp/jupyterlite-s1l.json .tmp/marimo-wasm-s1l.json --out .tmp/s1l-compare.md
```

## 첫 실측 합격 기준

1. 같은 머신, 같은 브라우저, 같은 캐시 정책에서 pyproc과 외부 후보를 연속 측정한다.
2. 각 scenario마다 명령, 브라우저 버전, Pyodide 또는 Python 런타임 버전, sample 수, raw output을 남긴다.
3. S1은 median/p95와 max error를 모두 기록한다.
4. 외부 후보가 병렬 worker 모델을 제공하지 않으면 S1은 `N/A`로 두고, single-lane 비교는 S1L로 분리한다.
5. 결과는 이 파일이 아니라 진행 원장에 append하고, 이 파일에는 최신 matrix만 반영한다.

## 다음 작업

1. WebVM은 Linux VM boot와 Python shell latency로 S0 계열을 분리한다.
2. S1L 표는 단일 커널 비교로만 유지하고, pyproc의 속도 간판은 S1 병렬 worker pool로 유지한다.
3. README 속도 문구는 이 비교 계약을 통과한 숫자만 갱신한다.
