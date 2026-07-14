# numericShard - 수치 성능 도약 Phase 1 실측 레인 (mapArray 샤딩 확장)

이니셔티브 [mainPlan/_done/numerical-acceleration](../../../mainPlan/_done/numerical-acceleration/README.md)의 Phase 1 실측 캠페인. runtimeParity(로컬 따라잡기)와 별개: **N인터프리터=N코어로 대규모 수치 커널을 분산해 numpy 86배 격차를 좁힌다.** 세부 질문은 폴더가 아니라 probe 파일로 늘린다.

## 가설

pyproc의 수치 속도 답은 vertical(빠른 단일 인터프리터, 벽에 막힘)이 아니라 horizontal(N인터프리터=N코어, 샤딩)이다. `PyProc.mapArray`의 1D 샤딩(이미 5.28배 실측)을 2D/matmul과 병렬 op로 확장하면 멀티코어 인자(86배 분해의 최대 회수 가능분)를 벽 0으로 회수한다. matmul은 embarrassingly parallel: `C = A@B`를 A의 행블록으로 P분할 -> 워커 p가 `C_p = A_p @ B`(B는 워커당 memcpy 1회 복제) -> 병합. 큰 N에서 연산 N^3/P가 전송 N^2를 압도.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 행블록 샤딩 matmul이 선형 배속을 내나 | [shardMatmulProbe.html](shardMatmulProbe.html) | P워커 speedup(단일워커 대비) >= 0.7P + 샤딩 결과 == 단일워커 결과(수치 동등) + 전송비 정직 보고 |
| matmul 밖 op는 어디서 이기고 지나(손익분기) | [shardOpsProbe.html](shardOpsProbe.html) | 리덕션·ufunc 정확성(==단일) + compute-bound(sin)는 이김 + 작은 배열은 진다(손익분기 실측·문서화) |

승격 조건: 위 게이트 GREEN 후 `PyProc` 표면에 2D/matmul + 병렬 op(mapArray 차원 확장). 정확한 표면은 probe로 확정. 상세: [02-phasing](../../../mainPlan/_done/numerical-acceleration/02-phasing-and-wiring.md).

## 자산 / 재현

- probe는 numpy를 각 워커에 로드한다(`new PyProc({ packages: ["numpy"], setup: "import numpy" })`). 자가 호스팅 경로 실행 권장(CDN 0): `PYPROC_INDEX_URL=/vendor/pyodide/ node tests/browser/run.mjs tests/attempts/numericShard/shardMatmulProbe.html`.
- 무거운 부팅(워커마다 numpy 로드)이라 게이트 타임아웃 연장 가능(`PYPROC_GATE_TIMEOUT`).

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-13 | shardMatmulProbe | Edge headless(자가 호스팅 경로, CDN 0) | 1024^3 f64 matmul. 단일워커 compute **14238ms**(이 환경 numpy 절대 속도 매우 느림 = 속도 벽 실증), 4워커 샤딩 **종단 3.67배**(순수 연산 3.68배, 게이트 0.7P=2.8 크게 상회), **정확성 상대오차 0.00**(샤딩==단일), **전송/병합/스케줄 오버헤드 14ms**(연산 3882ms 대비 무시 가능). GREEN 5/5 | **horizontal 샤딩이 멀티코어 인자를 벽 0으로 회수함을 실증.** 대형 compute-bound 커널에서 near-linear(4워커 92% 효율), memcpy-1 전송비가 무시 가능(14ms) | Phase 1 핵심 게이트 GREEN |
| 2026-07-13 | shardOpsProbe | Edge headless(자가 호스팅 경로, CDN 0) | 8M f64 배열. 정확성 전부 ==단일. 배속: **reduce 1.45배(memory-bound)**, **sin 대형 1.93배(compute-bound)**, 값싼 op(x*2+1) 1.32배, **sin 소형(20k) 0.04배(손익분기 아래=진다)**. GREEN 8/8 | **정직한 손익분기 지도**: 샤딩은 compute-bound(matmul O(n^3), sin)에서 이기고 memory-bound(reduce/값싼 ufunc, O(n)=전송 O(n))에서 modest, 작은 배열은 진다. 헤드라인은 matmul이지 "numpy 전반 4배"가 아니다 | 손익분기 확정. matmul을 src 승격 헤드라인으로, 1D는 mapArray가 커버 |
| 2026-07-13 | matmulSurfaceProbe | Edge headless(자가 호스팅 경로, CDN 0) | 승격 계약 `PyProc.matmul(a, b, {parts})` 검증. **전체 결과 원소 == JS 참조**(비정사각 37x23x19 + 4로 안 나눠떨어지는 M의 잔여 행블록, maxErr 0.00), 차원 불일치와 잘못된 `parts` 명시적 에러, parts:1 == 전 워커(maxErr 0.00), **공정 종단 배속 2.48배**(1024, parts:1 5366ms vs 4워커 2166ms = SAB 셋업·재구성·결과 조립 오버헤드 포함한 실사용 숫자). GREEN 6/6 | **Phase 1 src 승격 완료.** 공유 출력 SAB에 워커들이 자기 행블록을 assign(파이썬 버퍼 프로토콜)으로 쓰고 main이 조립. 종단 2.48배는 순수 3.67배보다 낮지만(조립 비용 포함) 정직한 사용자 배속 | 승격 -> `PyProc.matmul` + `PyProcMatmulOptions` + Matrix 타입 |
| 2026-07-15 | matmulSurfaceProbe | Edge headless(자가 호스팅 경로, CDN 0) | 반복 surface gate로 조정. 768x768 f64, 3회 warmed sample. 정확성 maxErr 0.00, median speedup **2.22배**(single median 1442ms, shard median 650ms), shard p95 **659ms** < single median 1442ms. GREEN 7/7 | 단발 threshold가 아니라 median/p95 봉투로 public speed surface를 검증한다. 1024급 선형성은 heavy `shardMatmulProbe`가 보존하고, `matmulSurfaceProbe`는 상시 반복 계약과 타입/입력 방어를 맡는다 | 반복 벤치 계약 고정 |
