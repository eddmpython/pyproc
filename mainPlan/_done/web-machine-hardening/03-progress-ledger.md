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

## 2026-07-16 - 전 phase 구현 완료와 최종 게이트 통과

구현 결과(Phase 0-5 전부 반영):

1. Phase 0/1: memory와 IndexedDB를 `MachineStore` 단일 계약으로 통합하고 owner 검증,
   expected HEAD CAS, blob/generation add, HEAD update를 한 transaction으로 묶었다.
   public type과 runtime store 의미 일치는 구조 게이트("Web Machine public type와
   runtime store 의미 일치")와 `tests/webMachine/contracts/machineStoreContract.mjs`가
   고정한다.
2. Phase 2: 제품 import/startup restore를 candidate context + pointer swap으로 바꿨다.
   실패 지점별 rollback은 `tests/webMachine/contracts/contextSwapContract.mjs`
   (구조 게이트 "Web Computer context swap rollback matrix")가 검증한다.
3. Phase 3: `generationRetention.js`의 HEAD/PREV reachability retention과 commit 뒤
   prune, startup retry를 연결했다. 정리 상태는 제품 inspect(persistence.cleanupPending,
   lastPrune)로 노출된다.
4. Phase 4: `OperationControl`(signal + deadlineAt)을 lock/commit/restore/export/import
   경로에 배선했다. 제품 timeout budget은 `apps/webComputer/machineConfig.js`
   WEB_COMPUTER_TIMEOUTS 한 곳이다.
5. Phase 5: `WebComputerRuntime`에서 context 생성(webComputerContext.js), 교체
   (webComputerContextSwap.js), persistence(webComputerPersistence.js)를 분리했고
   v86 serial 대기는 `packages/guest-v86/src/v86SerialPort.js`로 분리했다.

마감 수리 2건(이관 직전 발견):

1. `apps/webComputer/gate.js` import phase가 리팩토링 이전 표면
   (runtime.commitCoordinator)을 참조해 TypeError로 죽는 문제를
   `runtime.persistence.readHead`로 정정.
2. 복원 후 정리 재시도가 runtime에서 persistence 내부 필드(lastPrune/cleanupPending)를
   직접 mutate하며 save()의 prune 처리와 중복되던 것을
   `WebComputerPersistence.pruneRecoveryWindow()` 한 곳으로 수렴.

최종 게이트(2026-07-16 실행):

- `npm test` 907/907 GREEN(이후 이니셔티브 문서 추가로 922/922).
- `node tests/packageConsumer.mjs` GREEN.
- 기본 browser gate GREEN, Web Machine browser probe 13종 GREEN
  (deviceBackedDualBootProbe는 첫 실행 240s 타임아웃 플레이크였고 단독 재실행 12/12
  GREEN, processColdRestoreMs 2849).
- Web Computer 3-process 제품 E2E GREEN(초기 부팅/콜드 복원/새 프로필 import).

완료 조건 1-8 전부 충족. 폴더를 `mainPlan/_done/web-machine-hardening/`으로 이관한다.

현재 구현 상태: 완료.

## 2026-07-16 - 완료 이관 뒤 엄격 재감사와 보강 마감

완료 조건 1-8을 현재 worktree와 실제 브라우저 결과에 다시 대조했다. 기존 완료 판정을
뒤집는 구조 결함은 없었지만, 간접 증거로 남아 있던 실패 경계 네 곳을 직접 계약으로
보강했다.

보강 결과:

1. startup boot/restore는 비활성 candidate context 안에서 끝내고, restore와 resume가
   모두 성공한 뒤에만 active pointer와 output subscription을 연결한다. 실패한 candidate는
   폐기하고 부분 초기화 context를 공개하지 않는다.
2. import 뒤 첫 fenced save를 `WebComputerRuntime.importImage()`의 한 operation으로
   묶었다. save 실패는 성공으로 반환하지 않으며 새 active context를 유지하고 durability를
   `unsaved`로 노출한다. 수동 재시도 성공 뒤에만 `clean`으로 돌아간다.
3. `MachineStore` behavior suite를 memory와 실제 IndexedDB 구현에 동일하게 적용했다.
   schema v1 연결이 upgrade를 막는 경우, v1 HEAD/blob migration, pre-fence HEAD의
   `ownerEpoch: 0`, legacy owner epoch 승계를 실제 IndexedDB에서 검증한다.
4. `MachineEnvelopeCoordinator.importVerified()`의 owner/control type 위치와 preflight
   반환 타입을 runtime에 맞췄다. stale owner release의 readwrite transaction은 오류 시
   명시적으로 abort한다.
5. 제품 UI는 timeout, abort, outcome unknown, schema blocked, stale owner, HEAD conflict,
   image 오류를 제품 문장으로 구분한다. event boundary의 rejected operation도 한 곳에서
   관찰해 조용히 삼키지 않는다.

완료 조건별 최종 증거:

1. 공개 계약 정합: shared memory/IndexedDB store suite, `npm test`의 public type/runtime
   구조 gate, 설치 package consumer가 모두 통과했다.
2. owner와 HEAD의 단일 transaction: generation probe 25/25가 owner-fenced commit,
   CAS race, abort rollback과 schema migration을 통과했다.
3. stale token 차단: 4-context owner successor probe 14/14가 publish와 prune 모두
   `WEB_MACHINE_OWNER_STALE`임을 확인했다.
4. context 원자성: context swap failure matrix와 Web Computer 제품 E2E 13/13이 candidate
   rollback, active import 첫 save 실패의 HEAD 불변, 두 guest와 display/input 지속,
   수동 durability 회복을 확인했다.
5. retention: IndexedDB에 고유 generation 20개를 commit한 뒤 HEAD/PREV 두 개와 그
   payload만 남고 old generation/orphan blob이 제거됨을 확인했다.
6. 종료 결과: host 30/30, owner 14/14, image 20/20, generation 25/25 probe가 queue
   abort, started-operation outcome unknown, lock timeout, image read timeout, transaction
   abort와 listener/lock 정리를 확인했다.
7. 책임 분리: runtime facade, context, context swap, persistence, machine config와
   `V86SerialPort` 경계를 구조 gate와 import graph gate가 통과했다.
8. 최종 회귀: Web Machine 실제 Edge probe 13종 208 checks, Web Computer 13/13,
   기본 browser 63/63, 설치 소비자 28/28, 공개 example 10/10, package 18 files,
   v86 provenance가 모두 GREEN이다.

현재 구현 상태: 엄격 재감사와 보강까지 완료.
