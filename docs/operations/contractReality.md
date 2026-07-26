# 계약 실태 - 계약 vs 실제 (상시 추적)

"계약이 문서에 있는 것"과 "실제로 그렇게 도는 것"의 간극을 상시 추적하는 살아있는 원장이다. 간극을 발견하면 이 표에 먼저 적고, 메우면 지운다. 개발 원칙(바닥부터: 실측 -> 계약 -> 구현)이 이 표를 가리킨다.

이 문서가 지속 문서(docs)에 사는 이유: mainPlan 이니셔티브는 완료 시 `_done`으로 이관되므로 지속 정책의 정본이 될 수 없다. 이 표는 엔진 버전을 올리거나 능력을 바꿀 때 계속 참조되는 공학 정직성 장치라 여기에 둔다.

## 열린 부채 (지금 메워야 할 것)

| 항목 | 계약 | 실제 | 다음 조치 |
|---|---|---|---|
| 암묵 FFI/fetch 가정 | 엔진 교체·업데이트에 견딤 | 직접 `toJs`는 PyodideEngine 한 곳으로 격리됐고 host 계약은 `proxyMode`/`fallback`이다. EngineContract는 version/kind/capabilities를 생성 시 검증하고 WASI와 Pyodide가 최소 RuntimeContract를 공유한다 | 새 engine은 `tests/contracts/runtimeContract.mjs`와 browser 실측을 함께 통과해야 한다 |
| Web Computer 실행 자산의 단일 출처 | 실행 자산은 재현 가능한 경로에서 온다 | opaque `buildroot-bzimage68.bin`은 아직 개발 fallback이다. 대신 exact Buildroot source/config, legal-info, CycloneDX, build manifest를 내는 자체 recipe가 생겼다 | 독립 build 2회의 byte 동일성과 Web Computer gate를 확인한 뒤 catalog를 `buildroot-pyproc-i686.bin`으로 전환 |
| 리액티브/%undo 메모리 | 장시간 사용에도 안전 | base 상주는 근본 전제다. `history.stats()`와 retention budget이 base/delta/hash/node 압박을 관측하고 off-path branch 자동 prune을 선택할 수 있다. live 경로 자동 rebase는 아직 없다 | 실제 장수 workload의 pressure event를 모아 safe rebase 설계를 별도 이니셔티브로 판단 |
| 출하 표면의 검증 증거 | 출하되는 공개 표면은 자동 게이트를 갖는다 | `pyproc/gpu`와 `pyproc/socket`은 headless CI 게이트가 0이다(GPU는 어댑터 부재, socket은 배송하지 않는 relay 의존). 검증은 수동 probe와 소비 제품 몫이다 | 게이트가 불가능하면 가능한 가장 강한 대조를 명시한다(GPU는 셰이더 바이트 동일성이 상한). 그때까지 두 subpath는 README에서 "출하되나 headless 게이트 없음"으로 표기하고 Experimental 동결 아래 둔다 |
| 힙 성장 복원의 증거 위치 | 복원 경로는 상시 게이트를 갖는다 | 세션 경로의 성장 복원은 브라우저 게이트가 물지만(48MB 성장 후 부활), fork/forkMany의 성장 비대칭과 저널 성장 커밋은 `tests/attempts/runtimeParity/growthRestoreProbe.html`(수명주기상 삭제 예정 폴더)에만 증거가 있다 | 캠페인 종결 전에 `tests/browser` 게이트로 승격한다. 승격 없이 폴더를 지우면 그 경로의 증거가 0이 된다 |
| 멀티탭 owner 경쟁의 자동 증거 | "여러 탭이 한 컴퓨터"의 불변식은 게이트가 지킨다 | `src/session/kernelElection.js`는 Node 프로토콜 게이트 + 브라우저 immortal 게이트가 있으나, machine 층의 `src/machine/coordination/webLockOwnerCoordinator.js`는 자동 커버리지 0이고 경쟁 의미론이 수동 probe(ownerSuccessorProbe)에만 있다 | probe를 정규 게이트로 승격하거나, 같은 계약을 Node fake lock으로 돌려 상태기계를 문다 |
| 체크포인트 경계 해시 비용 | 경계 비용이 워크로드에 견딤 | WASM은 mprotect/dirty-page가 없어 경계마다 힙 전 페이지를 완전 해시한다(그 완전성이 복원 soundness의 조건 - `pageHashes` false-negative 0을 [해시 soundness] fuzz가 문다). 즉 경계 하나의 해시 비용이 O(heap)이고, 이를 지배하는 것은 힙 크기가 아니라 **커밋 빈도**다(churnProbe 법칙). 큰 힙 + 문장마다 커밋 = 매 문장 전 힙 훑기 | 근본 한계(dirty-page 부재의 회피 불가한 대가). 완화는 커밋 빈도 제어(제품이 경계를 성기게)와 힙 규모 설계. 소비자 계약은 [compatibility.md](../consuming/compatibility.md) 자원 특성에 명시. 근본 해는 upstream dirty-page 설비이지 라이브러리 우회가 아니다 |

## 상시 재검증 (버전 올릴 때 최우선)

| 항목 | 계약 | 실제 | 재검증 트리거 |
|---|---|---|---|
| Pyodide 스냅샷 API | 스냅샷-fork | `_makeSnapshot`/`_loadSnapshot`/`makeMemorySnapshot`은 Pyodide 밑줄(실험) API. 버전 핀(v314.0.2)으로만 안전. 스냅샷 사전 제조 벽 = 직렬화기의 기대 hiwire 슬롯 0..6 고정([engine-independence P2 실측](../../mainPlan/_done/engine-independence/README.md) 참조 시점의 좌표) | Pyodide 버전 변경 시. 업스트림 #5195(FS 스냅샷 채용)·#5971(draft 해제) 착지가 이 API를 바꿀 수 있다 |
| 자가 호스팅 핀 정합 | fetchEngine 버전 == DEFAULT_INDEX | `scripts/fetchEngine.mjs`의 ENGINE_VERSION과 `src/runtime/runtime.js`의 DEFAULT_INDEX가 같은 값 | `tests/run.mjs`가 기계 검사. 버전 변경 = 릴리즈 사유([release.md](release.md)) |

## 문서화된 트레이드오프 (의도된 계약)

| 항목 | 트레이드오프 | 명시 조건 |
|---|---|---|
| `PYTHONHASHSEED=0` 상시 고정 | 결정적 부팅 경로(내부 `bootSession`)가 하드코딩하고 CPython은 인터프리터 초기화 때 한 번 읽으므로 **세션 내내 hash randomization이 꺼진다**(CVE-2012-1150의 hash flooding 대응 무력화). V8은 같은 문제를 "빌드 때 고정 + 역직렬화 때 새 시드로 rehash"로 푸는데 CPython엔 rehash 설비가 없어 결정성과 시드 신선함을 동시에 못 가진다 | 위협 모델상 피해는 자기 탭의 자기 세션에 국한(외부 입력을 dict 키로 대량 적재하는 워크로드만 해당). 리플레이 결정성이 이 라이브러리의 핵이라 트레이드오프를 안고 명시한다 |
| 전역 스텁 3종 | entropy/시간(session 부팅), fetch(wheelCache install 구간) 스왑은 finally로 복원되지만 그 창 안의 동시 작업엔 보인다 | 동시 부팅 금지(내부 `bootSession`의 runExclusive가 세션 부팅을 직렬화). 소비자 문서에 명시 |
| ReactiveController.saveBase | base 백업/이동만 하고 RAM은 줄지 않는다(복원 경로가 base 상주 전제). 메모리 밸브는 pruneTo/dispose | 주석/타입을 백업/이동용으로 정정(2026-07-16). 진짜 오프로드(페이지 단위 파일 복원)는 동기 복원 계약과 충돌해 미착수 |
| WASI 세션 값 다리 | JSON 직렬화 한정(FFI 없음). 함수/numpy/live 객체 못 넘김 | 별도 async 표면(bootWasi). 프로덕션 정본은 Pyodide([contract.md](../consuming/contract.md) 런타임 정합) |
| machineJail 부모 격리 | CSP connect-src는 감옥 자신의 네트워크 egress를 막는다. same-origin 감옥은 window.parent 측면통로가 열림 | 완전 격리는 opaque origin(sandbox)이고 그 대가로 crossOriginIsolated 상실 = SAB(fork/interrupt) 포기 = 감옥 머신은 단일 Runtime |
| 공유메모리 memcpy 1회 | SAB를 파이썬 힙에 제로카피로 비출 수 없다(단일 선형 메모리 벽) | `PyProc.shm`/`mapArray`는 "memcpy 1회"를 공개 계약으로 유지 |
| Immortal Python Machine 복구 경계 | 임의 시점의 실행 스택과 외부 요청까지 되살리는 것이 아니라 마지막 완료 commit의 heap + `/home/web`에서 새 leader가 실행을 계속한다 | 전송 뒤 leader가 사라진 RPC는 `PYPROC_RPC_OUTCOME_UNKNOWN`, `retryable=false`로 끝내고 자동 replay하지 않는다. 제품은 명시적 idempotency 정책 없이 같은 명령을 재전송하지 않는다 |

## 프론티어 (정직한 벽 = WASM dlopen)

- warm-fork(패키지 로드 후 재임포트 0으로 복제), 진짜 공유메모리 스레드(nogil), numpy 프로세스간 제로카피 - 이 셋은 전부 하나의 미해결 문제(WASM dlopen + 크로스 인스턴스/스레드 메모리 공유)에 걸려 있다. upstream 연구 문제이지 "몇 주 빌드"가 아니다.
- pyproc(독립 인터프리터 워커 + 메시지 패싱)은 정확히 이 문제를 회피한다. 각 워커가 자기 wasmTable/힙/글루를 소유하므로 dlopen 불일치가 없다. 그래서 오늘 가능한 최상단이고, 프론티어는 발판이 아니라 벽이다.
- 능력별 네 상태(현재 달성 / 우회 가능 / upstream 대기 / 영구 벽) 지도는 [docs/product/vision.md](../product/vision.md)의 "능력의 네 가지 상태"가 정본이다.
