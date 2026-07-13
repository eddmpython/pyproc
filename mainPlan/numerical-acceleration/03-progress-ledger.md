# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

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
