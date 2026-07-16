# 02. 단계와 배선

## 순서 원칙

계약 gate를 먼저 RED로 만들고 구현을 맞춘다. 저장 schema와 context 교체를 안정화한 뒤에만 삭제를 수행하는 retention을 활성화한다. 동작 refactor는 마지막에 한다.

## Phase 0 - 계약 진실성

영향 파일:

- `packages/browser/index.d.ts`
- `packages/core/index.d.ts`
- `packages/browser/src/persistence/memoryGenerationStore.js`
- `packages/browser/src/persistence/indexedDbGenerationStore.js`
- `packages/browser/src/persistence/machineCommitCoordinator.js`
- `tests/run.mjs`
- `tests/packageConsumer.mjs`
- `tests/webMachine/browser/probes/generationContractProbe.html`

작업:

1. `GenerationHead`, missing 오류, `commitGeneration` 반환값, `restoreLatest` collection 입력을 계약 표와 일치시킨다.
2. memory와 IndexedDB store에 같은 behavior suite를 적용한다.
3. `.d.ts` key와 runtime key를 함께 검사하는 구조 gate를 추가한다.
4. 기존 `previous` 소비가 저장소에 없는지 전역 검색하고 `prev`로 단일화한다.

게이트:

- `readHead()`가 정확히 `head`, `prev`, 이후 Phase 1의 `ownerEpoch`만 반환한다.
- missing blob과 generation이 정해진 code로 reject한다.
- 입력 bytes와 반환 bytes mutation이 store 내부를 오염시키지 않는다.
- `npm test`, package consumer GREEN.

롤백:

- storage schema를 아직 바꾸지 않으므로 선언과 gate 변경만 되돌릴 수 있다.

## Phase 1 - owner-fenced machine store

영향 파일:

- `packages/browser/src/persistence/indexedDbMachineStore.js` 신규
- `packages/browser/src/persistence/memoryMachineStore.js` 신규
- `packages/browser/src/persistence/machineCommitCoordinator.js`
- `packages/browser/src/coordination/webLockOwnerCoordinator.js`
- `packages/browser/index.js`
- `packages/browser/index.d.ts`
- `apps/webComputer/webComputerRuntime.js`
- `apps/webComputer/machineConfig.js`
- `tests/webMachine/browser/probes/ownerSuccessorParticipant.html`
- `tests/webMachine/browser/probes/ownerSuccessorProbe.html`
- `tests/webMachine/browser/probes/generationContractProbe.html`

작업:

1. generation과 owner store를 `MachineStore`로 통합한다.
2. database version 2 migration과 blocked upgrade 오류를 구현한다.
3. `MachineCommitCoordinator.commitPaused()`에 `ownerToken`을 필수화한다.
4. owner 검증, expected HEAD 검증, blob add, generation add, HEAD update를 한 transaction으로 묶는다.
5. generation manifest에 local `commitFence`를 기록한다.
6. 기존 store export와 제품 배선을 새 store로 한 번에 교체한다.

failure injection:

| 지점 | 기대 결과 |
|---|---|
| payload digest 준비 뒤 owner successor claim | old publish `WEB_MACHINE_OWNER_STALE`, blob과 HEAD 불변 |
| owner 검증 뒤 HEAD 경쟁 | 정확히 한 CAS 성공 |
| blob과 generation add 뒤 transaction abort | blob, generation, HEAD 모두 미반영 |
| v1 connection이 upgrade 차단 | `WEB_MACHINE_SCHEMA_UPGRADE_BLOCKED`, 기존 data 불변 |
| legacy epoch 7에서 첫 v2 claim | 새 epoch 8 이상 |

게이트:

- 독립 browsing context 네 개에서 owner 하나만 mutation한다.
- successor claim 뒤 old token의 commit과 prune 성공은 0이다.
- process 강제 종료 뒤 successor가 HEAD/PREV를 복원한다.
- 실제 Web Computer의 60MB 이상 blob set을 단일 IndexedDB transaction으로 세 번 연속 commit하고 HEAD/PREV를 복원한다.
- 기존 owner failover와 product save E2E GREEN.

롤백:

- database v2 open 전까지는 Phase 0으로 되돌릴 수 있다.
- v2 open 뒤에는 v1 code를 다시 열지 않는다. 문제는 v2 호환 forward patch로 고친다.

## Phase 2 - transactional context swap

영향 파일:

- `apps/webComputer/webComputerContext.js` 신규
- `apps/webComputer/webComputerContextSwap.js` 신규
- `apps/webComputer/webComputerPersistence.js` 신규
- `apps/webComputer/webComputerRuntime.js`
- `packages/browser/src/image/machineEnvelopeCoordinator.js`
- `packages/browser/src/persistence/machineCommitCoordinator.js`
- `tests/webMachine/browser/probes/machineEnvelopeProbe.html`
- `tests/browser/webComputerProduct.mjs`
- `apps/webComputer/gate.js`

작업:

1. context 생성, output buffering, activation, idempotent dispose를 분리한다.
2. import를 verify/preflight, candidate restore, candidate resume, pointer swap, old dispose 순서로 바꾼다.
3. candidate 실패 시 partial machine과 device subscription을 정리하고 기존 running set을 복구한다.
4. startup restore도 disposable candidate context에서 수행한다.
5. import 성공 뒤 첫 fenced save가 실패하면 새 context는 유지하되 storage 상태를 `unsaved`로 표시하고 성공으로 위장하지 않는다.

failure injection:

| 지점 | 기존 context | candidate | HEAD |
|---|---|---|---|
| device restore 실패 | 원래 상태로 resume | dispose | 불변 |
| 첫 machine restore 실패 | 원래 상태로 resume | partial dispose | 불변 |
| 둘째 machine restore 실패 | 원래 상태로 resume | partial dispose | 불변 |
| candidate resume 실패 | 원래 상태로 resume | dispose | 불변 |
| activation 전 abort | 원래 상태로 resume | dispose | 불변 |
| old dispose 실패 | 새 context 유지 | active | import save 전까지 불변 |

게이트:

- 각 실패 뒤 Python memory/file, Linux memory/file, display subscription, input endpoint가 원래 값과 같다.
- listener, waiter, emulator instance 누수가 0이다.
- 정상 import는 fresh profile과 기존 active context 양쪽에서 통과한다.

롤백:

- storage schema와 독립된 제품 composition 변경이므로 이전 runtime 조립으로 되돌릴 수 있다.

## Phase 3 - HEAD/PREV retention

영향 파일:

- `packages/browser/src/persistence/generationRetention.js` 신규
- `packages/browser/src/persistence/indexedDbMachineStore.js`
- `packages/browser/src/persistence/memoryMachineStore.js`
- `packages/browser/src/persistence/machineCommitCoordinator.js`
- `packages/browser/index.d.ts`
- `apps/webComputer/webComputerPersistence.js`
- `tests/webMachine/browser/probes/generationContractProbe.html`

작업:

1. pure reachability 계산과 dry-run report를 만든다.
2. 고유 payload 20회, shared blob, v1 orphan fixture로 retained set을 검증한다.
3. owners, heads, generations, blobs 단일 transaction sweep을 구현한다.
4. commit 뒤 prune과 startup retry를 연결한다.
5. 제품 inspect에 retained generations, reclaimed bytes, cleanup pending을 노출한다.

활성화 순서:

1. dry-run과 예상 delete set 비교.
2. memory store 실제 delete.
3. IndexedDB fault injection과 transaction abort 검증.
4. 제품 자동 Save 뒤 실제 prune 활성화.

게이트:

- 20회 unique commit 뒤 target group generation 수 2.
- HEAD/PREV cold restore 둘 다 성공.
- reachable blob deletion 0, unreachable blob 0.
- 다른 group이 공유하는 digest 보존.
- concurrent v2 commit의 in-flight blob 삭제 0.
- prune 도중 context 강제 종료 뒤 HEAD/PREV와 blob 전부 복구.

롤백:

- dry-run 단계는 delete가 없어 즉시 되돌릴 수 있다.
- delete 활성화 뒤 rollback은 코드를 되돌리는 것이 아니라 HEAD/PREV 복구 gate로 안전성을 증명한다. 삭제된 비-root history는 복원 대상으로 약속하지 않는다.

## Phase 4 - cancellation과 timeout

영향 파일:

- `packages/core/index.d.ts`
- `packages/core/src/host/commandQueue.js`
- `packages/core/src/host/machineHandle.js`
- `packages/browser/src/coordination/webLockOwnerCoordinator.js`
- `packages/browser/src/persistence/machineCommitCoordinator.js`
- `packages/browser/src/image/machineEnvelopeCoordinator.js`
- `packages/guest-pyproc/src/pyprocGuestAdapter.js`
- `packages/guest-v86/src/v86GuestAdapter.js`
- `apps/webComputer/app.js`
- `apps/webComputer/machineConfig.js`
- `tests/webMachine/browser/probes/hostContractProbe.html`
- `tests/webMachine/browser/probes/ownerSuccessorProbe.html`
- `tests/webMachine/browser/probes/machineEnvelopeProbe.html`

작업:

1. `OperationControl`을 긴 lifecycle, persistence, image operation에 추가한다.
2. queue 시작 전과 각 mutation 경계에 abort checkpoint를 둔다.
3. pagehide가 active controller를 abort하고 dispose로 이어지게 한다.
4. product timeout budget을 한 곳에 고정하고 UI에 aborted, timeout, outcome unknown을 구분한다.
5. adapter가 취소할 수 없는 engine 호출은 성공으로 위장하지 않고 fence 변화와 함께 outcome unknown으로 종료한다.

게이트:

- lock, commit, restore, export, import delayed fixture가 abort 뒤 250ms 안에 종료.
- abort 뒤 pending timer, waiter, IndexedDB transaction, device subscription 0.
- transaction complete 뒤 abort는 durable success를 유지.
- outcome unknown 자동 replay 0.

롤백:

- options는 additive지만 private package 전체를 같은 변경에서 이동한다. 일부 adapter만 이전 signature로 남기는 부분 롤백은 금지한다.

## Phase 5 - hotspot 정리와 완료

영향 파일:

- `apps/webComputer/webComputerRuntime.js`
- `packages/guest-v86/src/v86GuestAdapter.js`
- `packages/guest-v86/src/v86SerialPort.js` 신규
- `tests/run.mjs`
- `README.md`
- `README.ko.md`
- `docs/consuming/capabilityMatrix.md`
- `docs/product/vision.md`
- `mainPlan/README.md`
- `mainPlan/_done/README.md`

작업:

1. `WebComputerRuntime`에서 context 생성, persistence, swap 세 책임을 제거한다.
2. v86 serial port를 분리하고 Draft와 attempts 명칭을 제거한다.
3. 새 import graph cycle, deep import, ambient global, 이름 없는 common 폴더를 차단한다.
4. public 문서의 durability와 rollback 주장을 실제 gate 수준으로 갱신한다.
5. 모든 완료 조건 통과 뒤 이 폴더를 `_done/web-machine-hardening/`으로 이동한다.

최종 gate:

- `npm test` GREEN.
- package consumer GREEN.
- 기본 browser gate GREEN.
- Web Machine browser probe 전체 GREEN.
- Web Computer 3-process 제품 E2E GREEN.
- unique 20-generation retention과 stale-owner delayed commit gate GREEN.
- import failure matrix 전부 GREEN.
- staged diff의 문서 링크, public type, import graph 검사 GREEN.
