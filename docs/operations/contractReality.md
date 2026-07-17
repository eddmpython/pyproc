# 계약 실태 - 계약 vs 실제 (상시 추적)

"계약이 문서에 있는 것"과 "실제로 그렇게 도는 것"의 간극을 상시 추적하는 살아있는 원장이다. 간극을 발견하면 이 표에 먼저 적고, 메우면 지운다. 개발 원칙(바닥부터: 실측 -> 계약 -> 구현)이 이 표를 가리킨다.

이 문서가 지속 문서(docs)에 사는 이유: mainPlan 이니셔티브는 완료 시 `_done`으로 이관되므로 지속 정책의 정본이 될 수 없다. 이 표는 엔진 버전을 올리거나 능력을 바꿀 때 계속 참조되는 공학 정직성 장치라 여기에 둔다.

## 열린 부채 (지금 메워야 할 것)

| 항목 | 계약 | 실제 | 다음 조치 |
|---|---|---|---|
| 암묵 FFI/fetch 가정 | 엔진 교체·업데이트에 견딤 | `toJs` 덕타이핑 3개소(terminal/worker/sharedKernelHost), latin1 바이트 밀수(syscallBridge), "엔진이 .whl/코어를 전역 fetch로 받는다" 가정(wheelCache/coreCache)은 변환 기본값·fetch 전략 변경 시 예외가 아니라 틀린 데이터/무증상 캐시 무력화로 나타난다 | EngineContract seam이 `toJs`를 계약 메서드로 승격 + dist 서술자로 이동(engine-independence P1에서 착수, 잔여 정리) |
| Web Computer 실행 자산의 단일 출처 | 실행 자산은 재현 가능한 경로에서 온다 | 10MB `buildroot-bzimage68.bin`의 유일한 출처가 `i.copy.sh`(1인 호스팅, mutable URL, 미러 0, 불변성 보증 0)다. 404가 나면 `npm run test:web-computer`가 죽는다. 미러를 저장소에 두는 것은 배포 정책(third-party binary 0)이 금지한다 | 자체 빌드가 진짜 해다. 커널 6.8.12는 bzImage setup header에서 이미 식별되므로 막혀 있지 않다. 상세: [assetProvenance.md](assetProvenance.md) |
| pyproc 게스트 자산 미기술 | 실행 자산은 catalog가 기술한다 | 제품이 부팅하는 9.6MB `pyodide.asm.wasm`을 어떤 asset catalog도 기술하지 않는다. `pyodide-lock.json`의 354개는 선택적 wheel 카탈로그이지 부팅 적재 집합이 아니라서 그 합성 바이너리를 0% 덮는다. 같은 잣대면 `v86.wasm`과 동일 판정(`NOASSERTION`/inventory 미검증)이어야 한다 | 부재를 명시로 싣는 것까지만 닫혔다(`UNDESCRIBED_ASSET_PROVENANCE`). 인벤토리 취득은 wheel `dist-info/METADATA` 추출 경로가 있다(의존성 0, bsdtar 선례) |
| 리액티브/%undo 메모리 | 장시간 사용에도 안전 | base(힙 전체 사본)가 RAM 상주 + 체크포인트 델타가 무한 누적(%undo는 문장마다). 장수 REPL에서 실메모리 성장 | 델타 rebase/prune 설계. `saveBase`(OPFS로 base 이동)가 1차 완화 |

## 상시 재검증 (버전 올릴 때 최우선)

| 항목 | 계약 | 실제 | 재검증 트리거 |
|---|---|---|---|
| Pyodide 스냅샷 API | 스냅샷-fork | `_makeSnapshot`/`_loadSnapshot`/`makeMemorySnapshot`은 Pyodide 밑줄(실험) API. 버전 핀(v314.0.2)으로만 안전. 스냅샷 사전 제조 벽 = 직렬화기의 기대 hiwire 슬롯 0..6 고정([engine-independence P2 실측](../../mainPlan/_done/engine-independence/README.md) 참조 시점의 좌표) | Pyodide 버전 변경 시. 업스트림 #5195(FS 스냅샷 채용)·#5971(draft 해제) 착지가 이 API를 바꿀 수 있다 |
| 자가 호스팅 핀 정합 | fetchEngine 버전 == DEFAULT_INDEX | `scripts/fetchEngine.mjs`의 ENGINE_VERSION과 `src/runtime/runtime.js`의 DEFAULT_INDEX가 같은 값 | `tests/run.mjs`가 기계 검사. 버전 변경 = 릴리즈 사유([release.md](release.md)) |

## 문서화된 트레이드오프 (의도된 계약)

| 항목 | 트레이드오프 | 명시 조건 |
|---|---|---|
| `PYTHONHASHSEED=0` 상시 고정 | `bootSession`이 하드코딩하고 CPython은 인터프리터 초기화 때 한 번 읽으므로 **세션 내내 hash randomization이 꺼진다**(CVE-2012-1150의 hash flooding 대응 무력화). V8은 같은 문제를 "빌드 때 고정 + 역직렬화 때 새 시드로 rehash"로 푸는데 CPython엔 rehash 설비가 없어 결정성과 시드 신선함을 동시에 못 가진다 | 위협 모델상 피해는 자기 탭의 자기 세션에 국한(외부 입력을 dict 키로 대량 적재하는 워크로드만 해당). 리플레이 결정성이 이 라이브러리의 핵이라 트레이드오프를 안고 명시한다 |
| 전역 스텁 3종 | entropy/시간(session 부팅), fetch(wheelCache install 구간) 스왑은 finally로 복원되지만 그 창 안의 동시 작업엔 보인다 | 동시 부팅 금지(bootSession의 runExclusive가 세션 부팅을 직렬화). 소비자 문서에 명시 |
| ReactiveController.saveBase | base 백업/이동만 하고 RAM은 줄지 않는다(복원 경로가 base 상주 전제). 메모리 밸브는 pruneTo/dispose | 주석/타입을 백업/이동용으로 정정(2026-07-16). 진짜 오프로드(페이지 단위 파일 복원)는 동기 복원 계약과 충돌해 미착수 |
| WASI 세션 값 다리 | JSON 직렬화 한정(FFI 없음). 함수/numpy/live 객체 못 넘김 | 별도 async 표면(bootWasi). 프로덕션 정본은 Pyodide([contract.md](../consuming/contract.md) 런타임 정합) |
| machineJail 부모 격리 | CSP connect-src는 감옥 자신의 네트워크 egress를 막는다. same-origin 감옥은 window.parent 측면통로가 열림 | 완전 격리는 opaque origin(sandbox)이고 그 대가로 crossOriginIsolated 상실 = SAB(fork/interrupt) 포기 = 감옥 머신은 단일 Runtime |
| 공유메모리 memcpy 1회 | SAB를 파이썬 힙에 제로카피로 비출 수 없다(단일 선형 메모리 벽) | `PyProc.shm`/`mapArray`는 "memcpy 1회"를 공개 계약으로 유지 |
| Immortal Python Machine 복구 경계 | 임의 시점의 실행 스택과 외부 요청까지 되살리는 것이 아니라 마지막 완료 commit의 heap + `/home/web`에서 새 leader가 실행을 계속한다 | 전송 뒤 leader가 사라진 RPC는 `PYPROC_RPC_OUTCOME_UNKNOWN`, `retryable=false`로 끝내고 자동 replay하지 않는다. 제품은 명시적 idempotency 정책 없이 같은 명령을 재전송하지 않는다 |

## 프론티어 (정직한 벽 = WASM dlopen)

- warm-fork(패키지 로드 후 재임포트 0으로 복제), 진짜 공유메모리 스레드(nogil), numpy 프로세스간 제로카피 - 이 셋은 전부 하나의 미해결 문제(WASM dlopen + 크로스 인스턴스/스레드 메모리 공유)에 걸려 있다. upstream 연구 문제이지 "몇 주 빌드"가 아니다.
- pyproc(독립 인터프리터 워커 + 메시지 패싱)은 정확히 이 문제를 회피한다. 각 워커가 자기 wasmTable/힙/글루를 소유하므로 dlopen 불일치가 없다. 그래서 오늘 가능한 최상단이고, 프론티어는 발판이 아니라 벽이다.
- 능력별 네 상태(현재 달성 / 우회 가능 / upstream 대기 / 영구 벽) 지도는 [docs/product/vision.md](../product/vision.md)의 "능력의 네 가지 상태"가 정본이다.
