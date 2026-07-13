# gpuCompute - 수치 성능 도약 Phase 2 실측 레인 (WebGPU 컴퓨트 오프로드)

이니셔티브 [mainPlan/numerical-acceleration](../../../mainPlan/numerical-acceleration/README.md) Phase 2(프론티어). numericShard(CPU 샤딩)와 별개: **f32 대규모 선형대수를 WebGPU 컴퓨트 셰이더로 오프로드해 10-100배를 노린다.** 좁은 고피크 레인(f32 한정, 잔류 모델).

## 가설

WebGPU 컴퓨트는 상태2(오늘 실동작). f32 대규모 matmul은 GPU에서 CPU 대비 10-100배(선행자 WgPy 340배, jax-js 7 TFLOPS). pyproc의 정답은 numpy 대체가 아니라 잔류 핸들(업로드 1 -> GPU 위 연산 체이닝 -> 다운로드 1). f64는 WGSL 근본 부재라 경성 벽(f32/i32 한정).

## 실측 환경 (중요: 실 GPU 머신 수동 = CI 자동 불가)

WebGPU는 **헤드리스에서 어댑터가 안 뜬다**(gpuCapProbe 실측: navigator.gpu 존재하나 requestAdapter null, forceFallbackAdapter/SwiftShader도 실패). **창 모드(하드웨어 GPU)에서만 어댑터 확보**(gpuCapProbe headed GREEN 7/7: 어댑터+디바이스+컴퓨트 왕복). 소켓 릴레이와 같은 계급 = 실 머신 수동 검증. 실행:

```
PYPROC_HEADED=1 node tests/browser/run.mjs tests/attempts/gpuCompute/gpuMatmulProbe.html
```

헤드리스(어댑터 없음)에선 probe가 SKIP(green)한다 = CI 무해.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| WGSL matmul이 정확하고 numpy보다 빠른가 | [gpuMatmulProbe.html](gpuMatmulProbe.html) | (실 GPU) 결과 == CPU 참조(f32 허용오차) + GPU 종단이 WASM numpy 대비 >= 10배. 어댑터 없으면 SKIP |
| 승격 계약(GpuCompute/GpuArray 잔류)이 정확한가 | [gpuSurfaceProbe.html](gpuSurfaceProbe.html) | array->matmul->toArray == CPU 참조 + 잔류 체이닝 (A@B)@C 정확 + 차원 에러 |
| Python numpy가 GPU를 쓰고 map 체이닝이 되나 | [gpuPythonProbe.html](gpuPythonProbe.html) | enableGpu -> pyprocGpu.matmul(numpy)==CPU numpy + 속도 + GpuArray.map(matmul->relu)==CPU 참조 |

승격 조건(G2 실 GPU GREEN): worker 소유 GPUDevice + JSPI 잔류 핸들로 `GpuCompute`/`gpuArray` 능력 승격. G2 실패(전송비 이득 초과) 시 examples/문서 패턴으로 강등(정직한 조건부).

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-13 | gpuMatmulProbe | Edge **창 모드(실 GPU)** + 자가 호스팅 경로 | 정확성 GPU matmul == CPU 참조 **maxErr 3.58e-7**(f32), 대형 1024 f32 GPU 종단(업로드+연산+리드백) **65.9ms**, WASM numpy 단일워커 7221ms = **GPU 109.6배**. GREEN 4/4(헤드리스는 SKIP) | **Phase 2 개념 성립**: naive 타일드 WGSL matmul로도 109배(최적화 커널 WgPy 340배). f32 정밀도 정확, 종단 전송비 포함해도 압도. GPU 벽(f64 없음, 창 모드 필요)은 정직한 경계 | 승격 -> `GpuCompute`/`gpuArray` 잔류 핸들 능력 |
| 2026-07-13 | gpuSurfaceProbe | Edge **창 모드(실 GPU)** | 승격 계약 `GpuCompute`/`GpuArray` 검증: create -> `array(f32)` -> `matmul` -> `toArray` == CPU 참조 **maxErr 2.38e-7**, **잔류 체이닝 (A@B)@C == 참조 maxErr 2.68e-7**(중간 리드백 0 = 재업로드 없음), 차원 불일치 명시적 에러, 대형 잔류 matmul **37.1ms**. GREEN 5/5(헤드리스 SKIP) | **Phase 2 src 승격 완료.** 잔류 핸들 모델(업로드1/GPU 체이닝/다운로드1)이 실 GPU에서 정확·동작. 셰이더 1회 컴파일 캐시 | 승격 -> `GpuCompute`/`GpuArray` |
| 2026-07-13 | gpuPythonProbe | Edge **창 모드(실 GPU)** + 자가 호스팅 | **Python numpy -> GPU 직결(pyproc 정체성 완성)** + map 체이닝. `Runtime.enableGpu().install()` -> 파이썬 `pyprocGpu.matmul(numpy a, b)`(JSPI run_sync)가 GPU에서 곱해 numpy로 반환 == CPU numpy **maxerr 0.00**, 1024 f32 **92배**(GPU 84ms vs CPU 7682ms). **GpuArray.map 잔류 체이닝**: matmul -> relu(`max(x,0)`) 리드백 없이 == CPU 참조 maxErr 1.19e-7. GREEN 4/4(헤드리스 SKIP) | **후속 심화 완료**: 파이썬이 GPU를 쓴다(numpy 배열 한 줄로 92배). map으로 matmul 뒤 활성화를 리드백 없이 잇는다 | 승격 -> `GpuBridge`(enableGpu) + `GpuArray.map`. 커널 최적화(자작 금지 = jax-js/WgPy 차용)는 후속 |
