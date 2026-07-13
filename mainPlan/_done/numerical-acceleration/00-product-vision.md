# 00. 제품 비전 - 무엇을, 누구를 위해, 왜

## 한 문장

**브라우저 파이썬의 마지막 큰 격차 - 수치 연산 속도 - 를 뚫어, "돌긴 도는" numpy를 "쓸 만한" numpy로 만든다.** 가용성(패키지가 있느냐)이 아니라 성능(빠르냐)이 진짜 벽이다.

## 문제의 정직한 재조준 (접지 실측, 2026-07-13)

이전까지 "네이티브 패키지는 브라우저에서 안 된다"고 벽으로 적었으나, 실측이 이를 정정한다:

- **가용성은 대체로 해결됐다.** Pyodide v314.0.2 배포판에 **pyemscripten(PEP 783) C확장 휠 158개**가 실린다: numpy 2.4.3, pandas 3.0.2, scipy 1.17/1.18, scikit-learn 1.8.0, matplotlib 3.10.8 등. Pyodide는 이 .so들을 **dlopen으로 로드한다**(Emscripten 동적 링킹). 즉 numpy/pandas/scipy/sklearn은 pyproc에서 **이미 실동한다**. "동적 C확장 불가"는 WASI 레인과 Pyodide 미빌드 패키지에만 국한된 이야기였다.
- **진짜 벽은 속도다.** numpy 대규모 산술이 로컬 대비 **86배 느리다**(01-architecture 실측). 근원: WASM 단일 스레드 + no-SIMD BLAS. 즉 "진짜 파이썬"이 부족한 지점은 "numpy가 없다"가 아니라 "numpy가 느려서 실용 임계 아래"다.

이 재조준이 이 이니셔티브의 존재 이유다: **North Star("로컬에서 되는 파이썬을 브라우저에서")의 가장 큰 남은 격차는 수치 성능**이고, 그걸 좁히는 것이 다음 도약이다.

## 접지된 플랫폼 사실 (이 환경 실측, gpuCapProbe report GREEN)

한발 더 도약하는 데 쓸 수 있는 플랫폼 능력을 실제 헤드리스 Edge(COOP+COEP)에서 확인:

| 능력 | 이 환경 | 의미 |
|---|---|---|
| WASM SIMD (v128) | **지원됨** | CPU측 벡터화 속도 레버가 오늘 열려 있다 |
| WASM threads 전제(SAB+Atomics) | **있음**(crossOriginIsolated) | 멀티스레드 BLAS/커널의 전제가 성립 |
| WebGPU API(navigator.gpu) | **존재** | 브라우저에 컴퓨트 셰이더 경로가 있다 |
| WebGPU 어댑터 | **헤드리스 CI엔 없음** | GPU 경로는 **자동 게이트 불가** = 실 GPU 머신 수동 검증(소켓 릴레이와 같은 계급). 이 제약이 phasing을 지배한다 |
| pyproc mapArray 샤딩 | 4워커 **5.28배** 실측 | CPU측 병렬은 이미 우리 소유(확장 가능) |

## 무엇인가 / 무엇이 아닌가

**이 이니셔티브다:**
- 이미 실동하는 수치 스택(numpy/pandas)을 **빠르게** 만드는 가속 레인.
- pyproc이 소유·측정 가능한 것(mapArray 샤딩 확장, SIMD 활용, WebGPU 컴퓨트 오프로드 능력)에 집중.

**이 이니셔티브가 아니다:**
- numpy를 처음부터 재구현하는 것(방대한 API, 무의미).
- Pyodide가 안 빌드한 임의 C확장을 pyproc이 빌드하는 것(upstream 몫. 별개 격차, 여기 스코프 밖).
- GPU를 "만병통치"로 파는 것(작은 배열은 전송비가 이득을 초과. 정직한 손익분기 명시).
- torch CUDA/네이티브 드라이버(영구 벽, 소비 제품 로컬 티어 몫).

## 성공 / 실패 기준

- **성공**: pyproc이 대규모 수치 커널(matmul/reduce/elementwise)을 로컬에 **근접하거나 초월**하는 속도로 돌린다(GPU 경로) + CPU측 기본선이 SIMD/threads/샤딩으로 유의미하게 빨라진다. 소비자는 능력 표면 하나로 가속을 켠다.
- **실패**: 가속이 실측 배속 없이 주장만 늘거나, 전송비/셰이더 복잡도가 이득을 먹어 실사용에서 안 빨라지거나, WebGPU 경로가 "실 GPU에서만 되고 아무도 못 재현"하는 유령이 되는 것.

## 왜 지금, 왜 이것

- browser-os 프리미티브(P1~P7)와 engine-independence 사다리가 닫혔다. 남은 "핵심 진짜 목표"의 최대 격차가 수치 성능이다(실측 86배).
- 플랫폼이 우리 편이다: SIMD·threads·WebGPU가 2026 Chromium에서 실재(위 접지 표). "몇 년 뒤"가 아니라 오늘 시작할 수 있는 레버다.
- 시장 정합: pyproc의 기함 유스케이스(AI 에이전트 인탭 데이터 분석)가 정확히 numpy/pandas 워크로드다. 그게 느리면 가치가 반감한다. 속도가 곧 제품 가치다.

상세 설계(레버별 ROI·능력 표면·게이트)는 [01-architecture.md](01-architecture.md), phasing은 [02-phasing-and-wiring.md](02-phasing-and-wiring.md), 결정 원장은 [03-progress-ledger.md](03-progress-ledger.md). 착수 전 ROI 재검은 phasing 문서가 게이트한다.
