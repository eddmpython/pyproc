# numericShard - 수치 성능 도약 Phase 1 실측 레인 (mapArray 샤딩 확장)

이니셔티브 [mainPlan/numerical-acceleration](../../../mainPlan/numerical-acceleration/README.md)의 Phase 1 실측 캠페인. runtimeParity(로컬 따라잡기)와 별개: **N인터프리터=N코어로 대규모 수치 커널을 분산해 numpy 86배 격차를 좁힌다.** 세부 질문은 폴더가 아니라 probe 파일로 늘린다.

## 가설

pyproc의 수치 속도 답은 vertical(빠른 단일 인터프리터, 벽에 막힘)이 아니라 horizontal(N인터프리터=N코어, 샤딩)이다. `PyProc.mapArray`의 1D 샤딩(이미 5.28배 실측)을 2D/matmul과 병렬 op로 확장하면 멀티코어 인자(86배 분해의 최대 회수 가능분)를 벽 0으로 회수한다. matmul은 embarrassingly parallel: `C = A@B`를 A의 행블록으로 P분할 -> 워커 p가 `C_p = A_p @ B`(B는 워커당 memcpy 1회 복제) -> 병합. 큰 N에서 연산 N^3/P가 전송 N^2를 압도.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 행블록 샤딩 matmul이 선형 배속을 내나 | [shardMatmulProbe.html](shardMatmulProbe.html) | P워커 speedup(단일워커 대비) >= 0.7P + 샤딩 결과 == 단일워커 결과(수치 동등) + 전송비 정직 보고 |
| 축별 리덕션이 병렬화되나 | shardReduceProbe.html (후속) | sum/mean/std 조각 부분합 + 병합 == 단일, 배속 실측 |
| 원소별 함수 손익분기 | shardUfuncProbe.html (후속) | 큰 배열 배속 + 작은 배열은 전송비로 지는 것을 실측(손익분기 N 문서화) |

승격 조건: 위 게이트 GREEN 후 `PyProc` 표면에 2D/matmul + 병렬 op(mapArray 차원 확장). 정확한 표면은 probe로 확정. 상세: [02-phasing](../../../mainPlan/numerical-acceleration/02-phasing-and-wiring.md).

## 자산 / 재현

- probe는 numpy를 각 워커에 로드한다(`new PyProc({ packages: ["numpy"], setup: "import numpy" })`). 자가 호스팅 경로 실행 권장(CDN 0): `PYPROC_INDEX_URL=/vendor/pyodide/ node tests/browser/run.mjs tests/attempts/numericShard/shardMatmulProbe.html`.
- 무거운 부팅(워커마다 numpy 로드)이라 게이트 타임아웃 연장 가능(`PYPROC_GATE_TIMEOUT`).

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-13 | shardMatmulProbe | Edge headless(자가 호스팅 경로, CDN 0) | 1024^3 f64 matmul. 단일워커 compute **14238ms**(이 환경 numpy 절대 속도 매우 느림 = 속도 벽 실증), 4워커 샤딩 **종단 3.67배**(순수 연산 3.68배, 게이트 0.7P=2.8 크게 상회), **정확성 상대오차 0.00**(샤딩==단일), **전송/병합/스케줄 오버헤드 14ms**(연산 3882ms 대비 무시 가능). GREEN 5/5 | **horizontal 샤딩이 멀티코어 인자를 벽 0으로 회수함을 실증.** 대형 compute-bound 커널에서 near-linear(4워커 92% 효율), memcpy-1 전송비가 무시 가능(14ms). 정직: 이건 샤딩의 최선 케이스(연산 >> 전송). 작은 배열/전송 헤비 op는 배속 낮음(shardUfunc가 손익분기 실측 예정) | Phase 1 핵심 게이트 GREEN. 잔여 probe(reduce/ufunc) 후 src 승격 |
