# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

### 2026-07-13 후속 심화 완료: Python numpy -> GPU 직결 + map 체이닝 (gpuPythonProbe 실 GPU 4/4)

- Phase 2의 후속 심화(파이썬 통합 + 원소별 op)를 실 GPU로 완성했다. **GPU가 파이썬에 실제로 연결됐다 = pyproc 정체성 완성.**
- **`GpuArray.map(expr)`(원소별 잔류)**: WGSL 표현식(x=원소)을 각 원소에 적용한 새 잔류 핸들. matmul 뒤 활성화(`max(x,0)` relu 등)를 **리드백 없이** 잇는다. 표현식별 파이프라인 캐시.
- **`Runtime.enableGpu()` -> `GpuBridge`(Python numpy 직결)**: install()이 GPU 디바이스 확보 + 파이썬 `pyprocGpu` 모듈 배선. `pyprocGpu.matmul(a, b)`가 numpy 배열을 f32로 GPU에서 곱해 numpy로 반환(블로킹 = JSPI run_sync, socketBridge 패턴). numpy 필요, 실 GPU + 창 모드.
- **실측(gpuPythonProbe GREEN 4/4, 실 GPU)**: 파이썬 GPU matmul == CPU numpy **maxerr 0.00**, 1024 f32 **92배**(GPU 84ms vs CPU 7682ms). map 잔류 체이닝 matmul->relu == CPU 참조 maxErr 1.19e-7. 헤드리스는 SKIP.
- **커널 최적화 판정(정직)**: 연구가 "커널 자작 금지"(naive vs 최적 600-1000배 격차, jax-js/WgPy 차용 권장)를 명시했고 이 GPU 하나에서만 검증 가능하므로, **naive 타일드(검증된 92-109배)를 유지하고 프로덕션 타일링/차용은 후속으로 정직하게 둔다**. 위험한 자작 커널이 정공법이 아니다.
- **표면**: index.js/index.d.ts(GpuBridge/map/enableGpu)/run.mjs/README 2종. **Phase 2 = 개념 + src 승격 + 파이썬 통합 + 원소별 op까지 완결.** 잔여(커널 최적화 차용, GPU reduce, worker 내 GPU)는 코어 밖 선택 후속.

### 2026-07-13 Phase 2 완료 + src 승격: GpuCompute WebGPU 잔류 핸들 (실 GPU gpuMatmul 4/4 + gpuSurface 5/5)

- Phase 2(프론티어, GPU)를 실 GPU로 실증하고 `GpuCompute`/`GpuArray`로 src 승격했다. **"GPU 검증 불가"는 헤드리스 한정**이었음이 드러났다.
- **핵심 발견(하네스 PYPROC_HEADED)**: WebGPU는 헤드리스에서 어댑터가 안 뜬다(requestAdapter/forceFallbackAdapter/SwiftShader 3시도 실패). 그러나 **창 모드(실 하드웨어 GPU)에서 어댑터+디바이스+컴퓨트 왕복 실동**(gpuCapProbe headed 7/7). 소켓 릴레이와 같은 계급 = 실 머신 수동 검증. harness.mjs에 PYPROC_HEADED=1(창 모드) 추가, GPU probe는 어댑터 부재 시 SKIP(헤드리스 CI 무해).
- **gpuMatmulProbe(개념, 실 GPU GREEN 4/4)**: naive 타일드 WGSL matmul. 정확성 GPU==CPU 참조 maxErr 3.58e-7(f32), 1024 f32 GPU 종단(업로드+연산+리드백) 65.9ms vs WASM numpy 단일워커 7221ms = **109.6배**. naive 커널로도 109배(최적화 WgPy 340배).
- **src 승격(`GpuCompute`/`GpuArray`, src/capabilities/gpuCompute.js)**: 연구가 설계한 **잔류 핸들 모델**. `GpuCompute.create()`(어댑터 확보, 부재 시 실행 가능 에러) -> `array(f32, rows, cols)`(업로드) -> `GpuArray.matmul(other)`(GPU 잔류 새 핸들, 재업로드 0) -> `toArray()`(리드백 1). 셰이더 1회 컴파일 캐시. f32 한정(WGSL f64 부재 = 경성 벽, 암묵 강등 금지).
- **gpuSurfaceProbe(승격 계약, 실 GPU GREEN 5/5)**: create + array->matmul->toArray == CPU 참조(maxErr 2.38e-7) + **잔류 체이닝 (A@B)@C == 참조**(maxErr 2.68e-7, 중간 리드백 0) + 차원 불일치 에러 + 대형 잔류 matmul 37.1ms. 헤드리스는 SKIP GREEN(CI 무해). index.js/index.d.ts(GpuCompute/GpuArray)/run.mjs/README 2종 표면.
- **정직**: 이 109배는 f32 대규모 matmul(compute-bound + 잔류)의 것. f64/작은 배열/값싼 op는 GPU가 이득 없거나 짐(전송비). 창 모드 필요(헤드리스 불가). numpy 대체가 아니라 좁은 고피크 레인. 후속: worker+JSPI 통합(파이썬 워커가 GPU 구동), 커널 최적화(타일링/jax-js 차용), reduce/fused elementwise op.

### 2026-07-13 Phase 1 완료 + src 승격: PyProc.matmul + 손익분기 지도 (shardOps 8/8 + matmulSurface 5/5)

- Phase 1(제품 경로)을 실측 완료하고 `PyProc.matmul`로 src 승격했다.
- **shardOpsProbe(손익분기 지도)**: 8M f64. compute-bound(sin) 1.93배 vs memory-bound(reduce 1.45배, 값싼 op 1.32배) vs 작은 배열 0.04배(진다). **헤드라인은 matmul(compute-bound O(n^3))이지 "numpy 전반 4배"가 아니다** - 정직한 경계.
- **src 승격(`PyProc.matmul(a, b, {parts})`)**: A 행블록을 워커수만큼 분산, 각 워커가 A_p @ B를 공유 출력 SAB의 자기 행블록에 assign(pyodide 버퍼 프로토콜)으로 쓰고 main이 조립. `_toSab`(memcpy-1 계약) + `MATMUL_FN`(모듈 상수). opts.parts로 워커수 상한(parts:1 = 공정 baseline). Matrix 타입 = { data: Float64Array, rows, cols }.
- **matmulSurfaceProbe(승격 계약 검증) GREEN 5/5**: 전체 결과 원소 == JS 참조(비정사각 + 잔여 행블록 maxErr 0.00), 차원 불일치 명시적 에러, parts:1==전워커, **공정 종단 배속 2.48배**(1024, 조립 비용 포함한 실사용 숫자. 순수 3.67배보다 낮은 건 SAB 재구성+결과 조립 오버헤드 = 정직). index.js/index.d.ts(Matrix)/run.mjs 표면 가드.
- **정직**: 종단 2.48배는 대형 compute-bound에서의 것. 실환경 numpy 절대 속도가 매우 느려(1024 parts:1 5366ms) 여전히 로컬과 큰 격차 = 샤딩은 "덜 아프게"이지 parity 아님(vision 정합).

### 2026-07-13 Phase 1 착수 실측: 샤딩 matmul near-linear 배속 (shardMatmulProbe GREEN 5/5)

- Phase 1의 핵심 가설(horizontal 샤딩이 멀티코어 인자를 벽 0으로 회수)을 브라우저 실측으로 확증했다. 캠페인 `tests/attempts/numericShard/` 개설.
- **실측(자가 호스팅 경로, CDN 0)**: 1024^3 f64 matmul. 단일워커 compute **14238ms**(이 환경 numpy 절대 속도가 매우 느림 = 속도 벽 자체를 실증), 4워커 행블록 샤딩 **종단 3.67배**(순수 연산 3.68배 = 4워커 92% 효율, 게이트 0.7P=2.8 크게 상회), **정확성 상대오차 0.00**(샤딩 결과 == 단일워커, 행블록 분할이라 checksum 보존), **전송+병합+스케줄 오버헤드 14ms**(연산 3882ms 대비 무시 가능).
- **의미**: memcpy-1 계약이 대형 compute-bound 커널에서 실증됐다(전송비 14ms << 연산). horizontal 샤딩 논제가 숫자로 섰다. **정직**: 이건 샤딩의 최선 케이스(연산 N^3 >> 전송 N^2). 작은 배열/전송 헤비 op(elementwise 단발)는 손익분기 아래에서 배속이 낮거나 진다 - shardUfuncProbe가 실측 예정.
- **Phase 1 핵심 게이트 GREEN.** NEXT: shardReduce/shardUfunc probe -> mapArray 2D/matmul + 병렬 op src 승격.

### 2026-07-13 이니셔티브 개시: 문제 재조준 + 접지 실측 + 연구 3종

- browser-os P1~P7 + engine-independence 사다리가 닫힌 뒤, "핵심 진짜 목표"(로컬급 진짜 파이썬)의 최대 남은 격차를 뚫는 단일 경로로 개시했다.
- **문제 재조준(접지로 정정)**: "네이티브 패키지 불가"는 틀렸다. Pyodide 배포판에 pyemscripten(PEP 783) C확장 휠 **158개**(numpy 2.4.3/pandas 3.0.2/scipy/sklearn/matplotlib)가 실려 dlopen으로 실동한다. **진짜 벽은 속도**(numpy 대규모 산술 로컬 대비 86배). 가용성이 아니라 성능이 이 이니셔티브의 표적.
- **접지 실측(gpuCapProbe, 이 환경 헤드리스 Edge report GREEN 5/5)**: WASM SIMD(v128) **지원됨**, WASM threads 전제(SAB+Atomics) **있음**, WebGPU API(navigator.gpu) **존재**, 그러나 **헤드리스 CI엔 GPU 어댑터 없음**(SwiftShader 미활성) = GPU 경로는 자동 게이트 불가, 실 GPU 머신 수동 검증 필요(소켓 릴레이와 같은 계급). 이 제약이 phasing을 지배한다.
- **연구 3종 착수**: (A) 네이티브 수치 속도(SIMD/threads/샤딩 vs WASI 정적빌드) (B) WebGPU 가속 (C) 임의 패키지 동적 로딩.

### 2026-07-13 연구 B(WebGPU) 종합 완료 - 상태2로 재분류 + gpuArray 잔류 모델

- **WebGPU 컴퓨트는 상태3(upstream 대기)이 아니라 상태2(오늘 실동작)**다(vision.md 재분류 대상). Chromium/Edge에서 워커 접근(WorkerNavigator.gpu, 113+) + COI 양립. **SAB 위 TypedArray view는 writeBuffer 허용**(업로드 1복사 + 리드백 1복사 = memcpy 1회의 GPU 확장). **JSPI `run_sync`(pyproc 이미 사용)로 워커가 GPU를 동기 구동** = WgPy의 크로스스레드 Atomics보다 깨끗한 구조적 이점.
- **선행자 실재**: WgPy(Pyodide+WebGPU numpy-like, matmul N=1024 340배 vs CPU, f32 한정), jax-js(WebGPU 백엔드 700줄, 7 TFLOPS, MIT = 차용 후보), transformers.js(10-100배, 잔류가 열쇠). 전부 f32.
- **정답 = numpy 대체가 아니라 `gpuArray` 잔류 핸들**: 업로드 1회 -> GPU 위 연산 체이닝(matmul/reduce/fused elementwise) -> 다운로드 1회. f32/i32 한정(f64는 WGSL 근본 부재 = 경성 벽). 커널은 자작 금지(naive vs 최적 600-1000배 격차) = jax-js/WgPy 차용. **process-OS 샤딩과 합성 안 됨**(GPU는 물리 1개 = N워커 샤딩 불가, 단일 GPU 축).
- **정직한 벽**: f64 부재, 좋은 커널=연구급 엔지니어링, 작은 배열은 GPU가 짐(전송비), 버퍼 상한(f32 ~5793^2부터 타일링), 전송 2복사, numpy 세만틱 재현 불가. GPU는 "numpy 86배의 일반해"가 아니라 "f32 대규모 선형대수라는 좁은 계급의 10-100배 레인".
- **ROI 판정(연구 B)**: SIMD(f32 4레인 2-4배, 브로드·저비용·전송 0 = 최고 ROI/effort) -> 2D 샤딩(matmul, 이미 로드맵) -> **그 다음** GPU(좁은 고피크). GPU 먼저면 좁은 이득에 큰 비용 태우고 넓은 저비용 SIMD를 놓친다.

### 2026-07-13 연구 A(수치 속도) + C(임의 패키지) 종합 -> 단일 경로 확정

- **연구 A(수치 속도)**: "86배"를 분해 = OpenBLAS(이미 회수) x SIMD(2-4배, 미회수) x 멀티코어(4-8배) x WASM세금(불가역). OpenBLAS 후 단일스레드 격차 ~7배로 좁혀짐. **회수 가능분의 최대 = 멀티코어 = 정확히 샤딩이 회수하는 인자.** 판정: (c) mapArray 샤딩 확장 = **1순위 제품 경로**(오늘 됨, 벽 0, 정체성 정합). (a) SIMD = 흡수(커스텀 빌드는 안티추천 #7 위반). (b) threads(PR #6285 draft) = 감시(dlopen×pthread 벽 재도입 + 샤딩 중복). (d) WASI 정적 numpy = **속도 경로 폐기**(참조 BLAS = OpenBLAS보다 느림 + JSON 다리 실용성 붕괴). vertical(빠른 단일 인터프리터)은 벽에 막히고 horizontal(N인터프리터=N코어)이 정답.
- **연구 C(임의 패키지)**: **벽 인식 교정 - Pyodide는 이미 dlopen을 한다**(C확장 148개 실동). 벽은 "dlopen 부재"가 아니라 "pyemscripten(PEP 783) 휠의 존재 + ABI 락스텝"이다. PEP 783 Accepted(2026-04) + PyPI 밸리데이터 라이브지만 자가 발행은 ~28개(numpy 등 대형은 여전히 pyodide-lock 경유). pyproc 최선 = 자체 빌드팜이 아니라 micropip PEP 783 레인 1급 흡수(생태계 자동 상속). **이건 속도(축 B)와 직교한 커버리지(축 C) = 별개 미래 이니셔티브 `arbitrary-packages`로 분리**(이 경로에 안 섞음).
- **세 연구 합의**: 벽은 가용성이 아니라 속도. pyproc 정답은 horizontal 샤딩(코어) + GPU 잔류 레인(프론티어) + SIMD 흡수. GPU는 상태2(오늘 됨)로 재분류, WASI numpy는 "느림" 단서 필요(vision 정정 산출물).
- **단일 경로 확정 = 수치 성능 도약**: Phase 1 mapArray 2D/matmul 샤딩(제품) -> Phase 2 gpuArray 잔류 레인(프론티어, 실 GPU 수동 검증) -> 교차 SIMD 흡수. 상세 [01-architecture](01-architecture.md) + [02-phasing](02-phasing-and-wiring.md).

### NEXT

1. vision.md 정정(GPU 상태3 -> 상태2, WASI numpy "느림" 단서) + mainPlan 활성 표에 이 이니셔티브 등록. (이 세션에 반영)
2. Phase 1 착수: `tests/attempts/numericShard/` 개설 + shardMatmulProbe(4워커 대형 matmul speedup >= 0.7P + native 배율 좁힘 실측).
3. Phase 1 게이트 GREEN -> mapArray 확장 src 승격 -> Phase 2(gpuArray) 착수 결정(ROI 재검). 축 C는 별개 이니셔티브로.
