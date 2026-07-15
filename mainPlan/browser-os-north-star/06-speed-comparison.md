# 06. 속도 정면 비교 계약

상태: 계약 고정. 외부 런타임 실측은 아직 미기록.

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
| S1 numpy sharded matmul | `examples/speedLab.html`, `tests/attempts/numericShard/matmulSurfaceProbe.html` | `medianSpeedup >= 2.0`, `shard p95 < single median`, `maxErr < 1e-9` |
| S2 process map | `npm run test:browser` | 결과 일치와 worker pool speedup |
| S3 browser server | `npm run test:consumer` | `VirtualOrigin` POST roundtrip |
| S4 machine resume | `npm run test:consumer` | signed `.pymachine` export/open/resume |

## 외부 비교 matrix

아래 표는 측정 슬롯이다. 측정 전에는 상대 성능을 주장하지 않는다.

| scenario | pyproc command | WebVM | JupyterLite | marimo web runtime | 판정 |
|---|---|---|---|---|---|
| S0 basic boot | `npm run test:browser` | 미측정 | 미측정 | 미측정 | 보류 |
| S1 numpy sharded matmul | `npm run bench:speed -- --out <path>` | 미측정 | 미측정 | 미측정 | 보류 |
| S2 process map | `npm run test:browser` | 미측정 | 미측정 | 미측정 | 보류 |
| S3 browser server | `npm run test:consumer` | 미측정 | 미측정 | 미측정 | 보류 |
| S4 machine resume | `npm run test:consumer` | 미측정 | 미측정 | 미측정 | 보류 |

S1 artifact가 여러 개 생기면 아래 명령으로 표를 만든다.

```bash
npm run bench:artifact -- --candidate jupyterlite --command "manual S1 page run" --sample 1500,1500,0 --sample 1490,1510,0 --sample 1520,1505,0 --out .tmp/jupyterlite-s1.json
npm run bench:artifact -- --candidate webvm --na "S1 sharded worker model 미측정" --out .tmp/webvm-s1-na.json
npm run bench:compare -- .tmp/pyproc-s1.json .tmp/jupyterlite-s1.json --out .tmp/s1-compare.md
```

## 첫 실측 합격 기준

1. 같은 머신, 같은 브라우저, 같은 캐시 정책에서 pyproc과 외부 후보를 연속 측정한다.
2. 각 scenario마다 명령, 브라우저 버전, Pyodide 또는 Python 런타임 버전, sample 수, raw output을 남긴다.
3. S1은 median/p95와 max error를 모두 기록한다.
4. 외부 후보가 병렬 worker 모델을 제공하지 않으면 single-lane 비교와 `N/A`를 분리한다.
5. 결과는 이 파일이 아니라 진행 원장에 append하고, 이 파일에는 최신 matrix만 반영한다.

## 다음 작업

1. S1부터 외부 후보별 실행 가능한 최소 페이지나 절차를 `tests/attempts/`에 만든다.
2. 외부 후보도 `bench:artifact`로 S1 raw JSON 또는 N/A JSON을 만들고 `bench:compare`로 표를 만든다.
3. README 속도 문구는 이 비교 계약을 통과한 숫자만 갱신한다.
