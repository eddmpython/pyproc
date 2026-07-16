# 03. 진행 원장

## 2026-07-16 - 아키텍처 hardening 설계 착수

확인한 현재 상태:

1. Web Machine package 방향과 composition root는 구조 gate로 고정되어 있으며 전체 Node gate 873/873가 통과한다.
2. Web Computer 제품 E2E 9/9와 기본 browser gate 47/47가 통과한 상태다.
3. `packages/browser/index.d.ts`는 `readHead()`의 `previous` key를 약속하지만 memory와 IndexedDB 구현은 `prev`를 반환한다.
4. 타입은 missing blob과 generation에 `null` 가능성을 선언하지만 구현은 `WEB_MACHINE_BLOB_MISSING`, `WEB_MACHINE_GENERATION_MISSING`을 던진다.
5. `MachineCommitCoordinator`는 expected HEAD CAS를 수행하지만 current `OwnerToken`을 store transaction에 전달하지 않는다.
6. owner epoch와 generation HEAD가 다른 database에 있어 최종 CAS와 atomic하게 검증되지 않는다.
7. 제품 import는 검증과 preflight 뒤 기존 machine을 먼저 shutdown하고 candidate restore를 시작하므로 중간 실패 시 기존 실행 context를 보존하지 못한다.
8. content-addressed blob과 immutable generation에는 HEAD/PREV 밖 history와 failed commit orphan을 정리하는 계약이 없다.
9. 설계 규칙은 장시간 operation의 cancellation과 timeout을 요구하지만 lock, commit, restore, export, import public contract에는 공통 control이 없다.
10. `WebComputerRuntime`은 348줄에서 조립, ownership, lifecycle, persistence, context 교체를 함께 담당한다. v86 adapter는 517줄이며 `Draft`, `attempts 전용` 명칭이 남아 있다.

재현:

```text
MemoryGenerationStore.readHead() keys = ["head", "prev"]
hasPrev = true
hasPrevious = false
getBlob("missing") = WEB_MACHINE_BLOB_MISSING
readGeneration("missing") = WEB_MACHINE_GENERATION_MISSING
```

결정:

1. 이 작업은 새 기능이 아니라 운영 불변식 보강이므로 `web-machine-hardening` 단일 이니셔티브로 관리한다.
2. 공개 계약 정합을 Phase 0으로 두고 모든 후속 구현보다 먼저 RED gate를 만든다.
3. owner를 별도 database에서 확인한 뒤 commit하는 방식은 TOCTOU 때문에 기각한다. owner, HEAD, generation, blob을 하나의 `MachineStore` transaction으로 묶는다.
4. import rollback은 guest별 undo가 아니라 격리된 candidate context와 pointer swap으로 해결한다.
5. retention root는 모든 group의 HEAD/PREV로 고정한다. 시간, 개수 임의값, 최근 N 전체 보존은 쓰지 않는다.
6. GC는 dry-run, memory delete, IndexedDB delete, 제품 활성화 순으로 진행한다.
7. operation abort는 성공, aborted, timeout, outcome unknown을 구분하며 자동 replay하지 않는다.
8. 큰 파일 refactor는 behavior가 닫힌 마지막 Phase 5에 수행한다.

기각:

- `.d.ts`만 현재 구현에 맞춰 고치기: 동일 drift가 재발하므로 behavior conformance 없이 허용하지 않는다.
- commit 직전 `assertOwner()` 호출: assert와 CAS 사이 owner 변경을 막지 못한다.
- blob을 별도 transaction으로 먼저 쓰기: 다른 group의 prune이 아직 generation에서 참조되지 않은 in-flight blob을 지울 수 있다.
- candidate restore 전에 old context shutdown: rollback할 실행 상태가 사라진다.
- 생성 시각 기준 blob 삭제: 다른 group이나 PREV의 참조 여부를 증명하지 못한다.
- retention 전에 runtime 파일 분리: 동작과 구조 변경이 섞여 실패 원인을 좁힐 수 없다.
- core에 timeout timer와 IndexedDB fence 넣기: engine-neutral, browser-neutral 경계를 깨뜨린다.

NEXT:

1. Phase 0의 store behavior fixture를 추가하고 현재 type/runtime mismatch를 RED로 고정한다.
2. `GenerationHead`, missing 오류, `restoreLatest` collection 타입을 정본 계약으로 맞춘다.
3. Phase 0 gate가 GREEN이 된 뒤에만 `IndexedDbMachineStore` schema v2와 owner-fenced CAS를 시작한다.

현재 구현 상태: 설계 완료, 코드 미착수.
