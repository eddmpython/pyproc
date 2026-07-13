# 02. Phasing과 배선 - phase 분해, 게이트, 롤백

착수 전 ROI 재검(mainPlan 규칙)과 phase 게이트를 여기서 소유한다. 비전과 구현이 충돌하면 이 문서의 게이트가 우선한다.

## 착수 전 재검 (ROI + 정합성)

- **정합성**: Phase 1(샤딩)은 `PyProc.mapArray`의 차원 확장이라 공개 표면·엔진 핀 불변, 소비자 무영향. Phase 2(gpuArray)는 별도 능력(opt-in)이라 기존 표면 무영향. 강행규칙(커스텀 Pyodide 빌드 금지, memcpy-1, deep-import 금지) 준수.
- **ROI**: Phase 1은 오늘 되는 유일한 옵션이고 멀티코어 인자(회수 가능분의 최대)를 벽 없이 회수한다(effort 2-4주, low risk). Phase 2는 최고 피크(f32 10-100배)지만 좁은 계급 + 커널 엔지니어링 비용 + 실 GPU 수동 검증 제약. 따라서 Phase 1 먼저, Phase 2는 Phase 1 게이트 후 착수 결정.
- **롤백**: Phase 1은 mapArray 확장 커밋 단위 revert(기존 1D 샤딩 불변). Phase 2는 별도 능력이라 export 제거로 롤백. 둘 다 핀·기존 게이트에 무영향.

## 신규 능력 게이트 (강행규칙)

수치 가속은 신규 능력이므로 **src 직행 금지**. 각 phase는 `tests/attempts/<카테고리>/`에서 개념 확립 -> 브라우저 실측 -> 게이트 -> 모듈화 -> 덕지덕지 제거 -> 계약 확정 **후에만** src 승격. 캠페인 = 개념 1개(증식 금지, 세부는 probe 파일로).

## Phase 1: mapArray 샤딩 확장 (제품 경로)

캠페인 `tests/attempts/numericShard/`(neighboring runtimeParity 패턴). probe로 개념 확립:

- **shardMatmulProbe**: `C = A@B`를 A 행블록 P분할 -> 워커 p가 `A_p @ B`(B 워커당 memcpy 1회) -> 병합. numpy 필요(`new PyProc({ packages: ["numpy"], setup: "import numpy" })`).
- **shardReduceProbe**: 축별 sum/mean/std를 조각 부분합 + 커널 병합.
- **shardUfuncProbe**: 원소별 함수 조각 적용 + 손익분기 N 실측(작은 배열은 지는 것을 정직하게 보임).

**게이트(GREEN 조건, 자가 호스팅 경로 = CDN 0)**:
- **선형성**: P워커 matmul speedup >= 0.7P(예: 4워커 >= 2.8배).
- **native 배율 추적**: 4워커로 대형 matmul이 단일워커 대비 유의 배속(예: "86배 격차 -> ~20배대"로 좁힘 실측 수치 기록).
- **정확성**: 샤딩 결과 == 단일워커 결과(수치 동등, 부동소수 허용오차 내).
- **손익분기 정직성**: ufunc 단발이 특정 크기 아래에서 지는 것을 실측(전송비 계약 증명).

게이트 GREEN 시 승격: `PyProc` 표면에 2D/matmul + 병렬 op(정확한 표면은 probe로 확정, mapArray 차원 확장). index.js/index.d.ts/run.mjs/README 반영. `tests/browser` 게이트에 편입(무거우면 전용 probe 유지).

## Phase 2: gpuArray 잔류 레인 (프론티어)

**전제**: Phase 1 게이트 GREEN + Phase 2 착수 결정(ROI 재검). 캠페인 `tests/attempts/gpuCompute/`.

- **커널 조달 먼저**: jax-js(MIT, 700줄) 또는 WgPy 커널을 vendored shim으로 차용(browserWasiShim 선례 = 라이선스 고지 후 추적). 자작 금지(600-1000배 격차).
- **gpuSpikeProbe**: 워커 Pyodide가 GPUDevice 획득(WorkerNavigator.gpu) + HEAPU8 view writeBuffer 업로드 + 타일드 matmul 커널 1개 + mapAsync 리드백 + JSPI run_sync 동기 회수. 4096 f32 matmul 측정.

**게이트(실 GPU 머신 수동 = CI 자동 불가, 접지 실측으로 확정된 제약)**:
- **G1 정합성**: COI 워커 Pyodide가 GPUDevice 획득 + 1M f32 왕복 항등(업로드-리드백 바이트 동일).
- **G2 승리**: 4096x4096 f32 matmul 종단(업로드+연산+리드백)이 pyproc WASM numpy matmul 대비 >= 10배 + mapArray 샤딩 matmul 대비 >= 5배.
- **G3 손익분기 정직성**: GPU가 CPU를 이기는 크로스오버 N을 측정·문서화. elementwise 단발이 특정 크기 아래 지는 것 실측(잔류가 진짜 설계임 증명).
- **G4 잔류**: 체인 연산(fused elementwise 10회 + matmul 1회)이 업로드 1 + 리드백 1로 per-op CPU를 연산비만큼 앞섬.

**GPU 게이트는 실 GPU 머신에서만 재현**되므로 probe는 어댑터 부재 시 SKIP(green)로 CI 무해, README에 "실 GPU 수동 검증" 명기(소켓 릴레이/브라우저 실측과 같은 계급). G2/G4 GREEN 시 승격: `GpuCompute`/`gpuArray` 능력. **G2가 실패하면(전송비가 이득 초과) 코어 승격 대신 examples/문서 패턴으로 강등**(정직한 조건부).

## 교차 관심사 (감시/흡수, 별도 phase 아님)

- **SIMD 흡수**: Pyodide numpy가 SIMD 빌드로 릴리즈되면(변경로그 감시) 핀 이동 + dot-product ms 재측정(f64 2배/f32 2-4배 확인). effort 0, 워커마다 공짜로 곱해짐. engine-watch가 감시 창구.
- **threads 감시**: PR #6285 draft 이탈 + ffi/ABI 제약 해소 시 재평가. 현재는 채택 안 함(회피한 벽 재도입 + 샤딩 중복).
- **vision.md 정정(즉시 산출물)**: (1) GPU 상태3 -> 상태2("우회 가능/오늘 라이브러리로 됨"). (2) numpy 정적빌드(WASI) "우회 가능" 유지 + "속도 이득 없음, 오히려 느림" 단서. 이 이니셔티브 개시와 함께 반영.

## 축 C 분리 (이 경로 아님, 별개 미래 이니셔티브)

임의 패키지 커버리지는 속도와 직교한다. Pyodide dlopen은 이미 됨(C확장 148개 실동), 벽은 pyemscripten(PEP 783) 휠 생태계 채택(~28개, 완만 증가) + ABI 락스텝. pyproc 최선 = 자체 빌드팜이 아니라 micropip PEP 783 레인을 1급으로 흡수(생태계 성장 자동 상속). 착지 = 신규 이니셔티브 `arbitrary-packages`(effort LOW-MEDIUM, attempts `pep783Wheels` 캠페인). **이 이니셔티브(numerical-acceleration)에 섞지 않는다** = 하나의 길 유지.

## NEXT (재개 지점)

1. vision.md 정정 반영(GPU 상태, WASI 단서) + mainPlan 활성 표에 이 이니셔티브 등록.
2. Phase 1 착수: `tests/attempts/numericShard/` 개설 + shardMatmulProbe 실측(4워커 대형 matmul speedup + native 배율).
3. Phase 1 게이트 GREEN -> mapArray 확장 src 승격 -> Phase 2 착수 결정(ROI 재검).
