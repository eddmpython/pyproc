# 01. 아키텍처 - 레버 분석, 능력 표면, 정직한 벽

연구 3종(수치 속도 / WebGPU / 임의 패키지) 종합. 2026-07 웹 실측 + 이 환경 접지(gpuCapProbe). 안 되는 건 안 된다고 판정한다.

## 정체성 정합

pyproc은 프로세스 OS = **독립 인터프리터 N개 = N코어 = 실병렬**이다. 그래서 수치 가속의 정답도 정체성에서 나온다: **vertical(빠른 단일 인터프리터)이 아니라 horizontal(N인터프리터로 분산)**. vertical 레버(in-interpreter threads, 커스텀 SIMD 빌드)는 pyproc이 설계로 회피한 벽(WASM dlopen, pthread×dynamic-linking)으로 걸어들어가고 강행규칙(커스텀 Pyodide 빌드 상시 유지 금지)과 충돌한다. horizontal(샤딩)은 각 워커가 자기 wasmTable/힙을 소유해 그 벽이 애초에 없다.

## "86배"의 분해 (핵심 통찰)

86배는 단일 원인이 아니라 곱해지는 인자다(rth DGEMM 벤치 [pyodide#3763] 기반 재구성):

| 인자 | 배율 | 2026 상태 | 회수 주체 |
|---|---|---|---|
| reference BLAS -> OpenBLAS | 2-3배 | **이미 회수**(Pyodide 314가 OpenBLAS 탑재) | upstream(완료) |
| no-SIMD -> WASM SIMD | 2배(f64) ~ 2-4배(f32) | 미회수(Pyodide numpy SIMD 미빌드, 변경로그 0건) | upstream(무기한) |
| 단일스레드 -> 멀티코어 | 4-8배 | 미회수(단일 인터프리터 1코어) | **pyproc 샤딩(부분 회수 = mapArray 5.28배)** |
| 잔여 WASM 세금 | 1.5-2배 | 불가역(WASM 구조) | 없음 |

실측(square matmul ms, native OpenBLAS 1스레드 f64 기준): N=1000 = native 39.7 / Pyodide OpenBLAS no-SIMD 271(**6.8배**). 즉 OpenBLAS 도입 후 **단일스레드 격차는 ~7배**로 좁혀졌고, 나머지 큰 격차는 SIMD(2배) + native 멀티코어(4-8배)다. **멀티코어가 회수 가능분의 최대이고, 그게 정확히 샤딩이 회수하는 인자다.** 이게 경로 선택의 근거다.

## 레버 매트릭스 (2026 현실 + 판정)

| 레버 | 2026 상태 | pyproc 판정 |
|---|---|---|
| **A. WASM SIMD로 numpy 가속** | relaxed-SIMD 브라우저 성숙(2-4배)이나 **Pyodide numpy SIMD 미빌드**(빌드 블로커 수년). 켜려면 upstream 대기(effort 0) 또는 커스텀 빌드(핀 파기 + 상시 유지) | **흡수(upstream 감시).** 커스텀 빌드는 안티추천 #7 위반 + ROI 음수. Pyodide가 켜면 워커마다 공짜 2-4배 |
| **B. WASM threads(PR #6285) + OpenBLAS MT** | draft(2026-07 활동). opt-in 빌드, 스레드는 js/ffi 접근 불가 + `-pthread`는 전 생태계 ABI 재빌드 + pthread×dlopen "느리고 버그투성이"(contractReality 프론티어 벽 그 자체) | **감시.** 회피한 벽 재도입 + 샤딩과 같은 인자 중복. draft 이탈 + 제약 해소 전 대기 |
| **C. mapArray 샤딩 확장** | **오늘 된다.** 핀 엔진, 커스텀 빌드 0, dlopen/pthread 벽 0, memcpy-1 계약 준수. 현재 1D 5.28배 | **1순위 = 제품 경로.** 멀티코어 인자를 벽 없이 회수. 정체성 정합 |
| **D. WASI 정적 fat numpy** | 미성숙(dicej wasi-wheels unmaintained, 프로덕션 numpy.wasm 없음). `blas=none` 참조구현 = **OpenBLAS보다 느림** + WASI 값 다리 JSON 한정 = 대형 배열 실용성 붕괴 | **속도 경로 폐기.** WASI 가치는 결정적 부팅(순수 파이썬)이지 수치 속도 아님. 축 C(커버리지) 실험으로만 잔류 |
| **E. WebGPU 컴퓨트** | **상태2(오늘 실동작)**. 워커 접근(WorkerNavigator.gpu 113+) + COI 양립 + SAB view writeBuffer + JSPI run_sync 동기 구동. 선행자 WgPy(matmul 340배 f32), jax-js(7 TFLOPS/MIT) | **프론티어 레인(Phase 2).** 좁은 고피크(f32 대규모 선형대수). 커널 차용, 실 GPU 수동 검증 |

## 능력 표면 설계

### Phase 1: mapArray 샤딩 확장 (제품 경로, src 후보)

현재 `PyProc.mapArray(fnSrc, typed)`는 1D 조각 샤딩(각 워커가 조각을 numpy 배열로, memcpy 1회). 확장:

- **2D 행블록 matmul**: `C = A@B`를 A의 행블록으로 P분할 -> 워커 p가 `C_p = A_p @ B`(B는 워커당 memcpy 1회 복제). 큰 N에서 연산 N^3/P가 전송 N^2를 압도 = speedup이 P에 근접(embarrassingly parallel).
- **축별 리덕션**: sum/mean/std/min/max를 조각 부분합 -> 커널 병합.
- **원소별 유니버설 함수**: 조각별 적용(전송비 = 연산비라 손익분기 존재, 큰 배열에서만 이득. 정직하게 명시).
- **dtype 확대** + sort/FFT의 조각별 적용.

표면은 mapArray의 차원 확장이지 새 개념이 아니다(덕지덕지 회피). 예: `os.matmul(a, b)` 또는 `mapArray`에 op 힌트. 정확한 표면은 attempts 실측으로 확정.

### Phase 2: gpuArray 잔류 레인 (프론티어, 실 GPU 수동 검증)

GPU는 물리적으로 1개다(N워커 샤딩 불가 = 단일 GPU 축). 정답은 단발 오프로드가 아니라 **잔류 핸들**:

```
// GpuCompute 능력(src/capabilities/, 워커 소유 GPUDevice + JSPI run_sync)
gpuArray(typed)          // TypedArray(f32/i32) -> GPU 상주 핸들(writeBuffer 업로드 1복사)
  .matmul(other)         // 타일드 WGSL matmul(커널 차용: jax-js/WgPy)
  .map(elementwiseSrc)   // WGSL elementwise(여러 개 fuse)
  .reduce(op)            // 병렬 리덕션
  .toNumpy()             // mapAsync + JSPI run_sync -> numpy(리드백 1복사)
```

- **잔류가 설계의 핵심**: 업로드 1 -> GPU 위 연산 체이닝 -> 다운로드 1. arithmetic intensity가 손익분기를 정한다(matmul O(n^3)/O(n^2) = 압승, elementwise 단발 O(n)/O(n) = 전송비가 삼킴). 단발 gpuMap이 아니라 체이닝이 이유.
- **f32/i32 한정(경성)**: WGSL에 f64 없음(gpuweb#2805). numpy 기본이 float64이므로 **소비자가 명시적 f32 캐스팅**(암묵 강등 금지 = 정밀도 손실 숨기지 않음).
- **커널 자작 금지**: naive vs 최적 WGSL matmul 600-1000배 격차. jax-js(700줄/MIT) 또는 WgPy 커널 차용(vendored shim 선례 = browserWasiShim). pyproc은 그 위에 파이썬 능력 계약 + 잔류 핸들 + JSPI 브리지 + SAB 업로드만.
- **샤딩과 합성 안 됨**: 단일 GPU 워커가 큰 커널을 던진다(mapArray식 N샤딩 아님). 혼동하면 덕지덕지.

## 정직한 벽

- **f64 부재(GPU)**: 과학·금융의 f64 정밀도 워크로드는 GPU 경로 배제. numpy 세만틱 완전 재현 불가(dtype 승격/broadcasting/view/수백 ufunc).
- **GPU 손익분기**: 작은 배열은 전송비로 CPU가 이김. 잔류 없으면 이득 증발. 크로스오버 N을 실측·문서화(주장 금지).
- **GPU CI 게이트 불가(접지 실측)**: 헤드리스 CI엔 어댑터 없음(gpuCapProbe: navigator.gpu 존재하나 어댑터 null). WebGPU 검증은 **실 GPU 머신 수동**(소켓 릴레이와 같은 계급). 이 제약이 phasing을 지배한다.
- **샤딩 전송비**: memcpy 1회는 불가피(SAB 제로카피 불가). 큰 배열에서만 이득 = 손익분기 실측.
- **버퍼 상한(GPU)**: f32 ~5793^2(134MB)부터 단일 바인딩 초과 = 타일링 필수. limit 조회해 초과는 CPU 티어 라우팅.

## ROI 순서 + 단일 경로

**SIMD(흡수, 브로드 저비용) < 샤딩(제품 경로, 오늘 됨) < GPU(좁은 고피크, 프론티어).** GPU를 먼저 하면 좁은 이득에 큰 비용을 태우고 넓은 저비용 이득(샤딩+SIMD흡수)을 놓친다.

**단일 경로 = 수치 성능 도약 = horizontal**:
1. **Phase 1(제품)**: mapArray 2D/matmul + 병렬 op 셋. 멀티코어 인자 회수. 오늘 됨.
2. **Phase 2(프론티어)**: gpuArray 잔류 레인. f32 대규모 선형대수 10-100배. 실 GPU 수동 검증. 커널 차용.
3. **교차(감시/흡수)**: SIMD upstream 흡수(공짜 2-4배/코어), threads 감시, WASI 속도 폐기.

축 C(임의 패키지 커버리지)는 이 경로 밖 = **별개 미래 이니셔티브**(Pyodide dlopen 이미 됨, 벽은 pyemscripten 휠 생태계 채택 + ABI 락스텝, micropip PEP 783 흡수가 답). 여기 섞지 않는다.
