# 01. 아키텍처

## 유지할 의존성 방향

```text
apps/webComputer
  -> @web-machine/browser
  -> @web-machine/guest-pyproc
  -> @web-machine/guest-v86
  -> pyproc public root

@web-machine/browser -> @web-machine/core
@web-machine/guest-* -> @web-machine/core contract only
```

core에는 browser storage, owner store, guest 이름을 넣지 않는다. 이번 변경의 중심은 browser package와 product composition이다.

## 공개 계약 정본

`packages/browser/index.d.ts`와 두 store 구현이 다음 계약으로 수렴한다.

```ts
interface GenerationHead {
  head: string;
  prev: string | null;
  ownerEpoch: number;
}

interface MachineStore {
  claimOwner(identity: { groupId: string; ownerId: string; minimumEpoch?: number }): Promise<OwnerToken>;
  releaseOwner(token: OwnerToken): Promise<boolean>;
  assertOwner(token: OwnerToken): Promise<OwnerToken>;
  getBlob(digest: string): Promise<Uint8Array>;
  commitGeneration(value: {
    groupId: string;
    generationId: string;
    expectedHead: string | null;
    ownerToken: OwnerToken;
    blobs: ReadonlyArray<{ digest: string; bytes: Uint8Array }>;
    record: GenerationRecord;
  }): Promise<GenerationHead>;
  readHead(groupId: string): Promise<GenerationHead | null>;
  readGeneration(groupId: string, generationId: string): Promise<GenerationRecord>;
  pruneRecoveryWindow(value: { groupId: string; ownerToken: OwnerToken }): Promise<PruneReport>;
}
```

결정:

- `prev`를 정본으로 유지한다. 현재 persistence 구현과 HEAD/PREV 문서가 같은 이름을 쓴다.
- missing blob과 generation은 `WEB_MACHINE_BLOB_MISSING`, `WEB_MACHINE_GENERATION_MISSING`을 던진다.
- `commitGeneration`은 실제 반환하는 `GenerationHead`를 타입에 명시한다.
- `restoreLatest.machines`는 `ReadonlyMap<string, MachineHandle> | Record<string, MachineHandle>`로 선언한다.
- public type 존재 검사만 하지 않고 같은 fixture가 runtime 반환 key와 오류 code를 실행 검증한다.

## 통합 fenced store

### 배치

```text
packages/browser/src/persistence/
├─ indexedDbMachineStore.js
├─ memoryMachineStore.js
├─ machineCommitCoordinator.js
├─ generationIntegrity.js
└─ generationRetention.js

packages/browser/src/coordination/
└─ webLockOwnerCoordinator.js
```

`IndexedDbMachineStore`가 `blobs`, `generations`, `heads`, `owners` object store를 같은 database에 둔다. `MemoryMachineStore`는 동일 계약의 deterministic fixture다. 기존 `IndexedDbGenerationStore`, `IndexedDbOwnerEpochStore`, `MemoryGenerationStore`의 책임은 새 store로 흡수하고 public export를 한 번에 교체한다. private `0.0.0` package이므로 deprecated alias를 남기지 않는다.

### claim 순서

```text
acquire Web Lock
  -> claimOwner(groupId, ownerId, minimumEpoch)
  -> receive OwnerToken(ownerId, epoch)
  -> machine handles adopt token
  -> publish owned state
```

Web Lock callback 안에서만 durable token을 claim한다. `WebLockOwnerCoordinator`는 `epochStore` 대신 `ownerStore` 계약을 받되 core는 이를 모른다.

`owners[groupId]`는 `{ ownerId, epoch, active }`를 저장한다. claim은 `epoch = max(current.epoch + 1, minimumEpoch)`로 만들고 `active: true`를 기록한다. release는 exact token과 일치할 때만 `active: false`로 바꾼다. commit과 prune은 exact token과 `active: true`를 모두 요구한다.

### commit 선형화

```text
pause guests
  -> flush block devices
  -> snapshot guests and devices
  -> calculate content digests and immutable generation record
  -> begin readwrite(owners, heads, generations, blobs)
       assert owners[groupId] == ownerToken
       assert heads[groupId].head == expectedHead
       add missing content-addressed blobs
       add immutable generation record
       put head { head: next, prev: current, ownerEpoch: token.epoch }
     commit transaction
  -> durable success
```

owner token 불일치는 `WEB_MACHINE_OWNER_STALE`, HEAD 불일치는 `WEB_MACHINE_HEAD_CONFLICT`다. 검증과 모든 durable write가 같은 transaction 안에서 이뤄진다. owner를 별도 database에서 먼저 확인하는 방식과 blob을 먼저 publish하는 방식은 TOCTOU 창을 만들므로 금지한다.

generation manifest에는 `commitFence: { ownerId, epoch }`를 기록한다. portable `.webmachine`에는 local owner identity를 넣지 않는다.

### schema migration

현재 generation database의 version을 1에서 2로 올리고 `owners` store를 추가한다. 기존 `blobs`, `generations`, `heads`는 보존한다.

1. 같은 Web Lock을 획득한 뒤 legacy owner database의 마지막 epoch를 읽는다.
2. generation database v2를 열고 `owners` store를 추가하며 기존 HEAD에는 `ownerEpoch: 0`을 기록해 pre-fence generation임을 표시한다. 다른 탭의 v1 connection 때문에 upgrade가 막히면 `WEB_MACHINE_SCHEMA_UPGRADE_BLOCKED`로 종료하고 다른 제품 탭을 닫으라는 상태를 표시한다.
3. 첫 v2 claim은 `minimumEpoch = legacyEpoch + 1` 이상으로 만든다.
4. v2 database가 열린 뒤 v1 code는 낮은 version open에 실패하므로 새 HEAD를 쓸 수 없다.
5. legacy owner database는 migration 확인 뒤 읽지 않으며 자동 삭제하지 않는다. 데이터 삭제는 별도 운영 작업으로 남긴다.

schema v2 open은 forward-only 경계다. 이후 rollback은 v1 code 재실행이 아니라 v2 호환 patch로 수행한다.

## 원자적 context 교체

### 제품 모듈

```text
apps/webComputer/
├─ webComputerRuntime.js       # 사용자 verb와 lifecycle facade
├─ webComputerContext.js       # host, devices, adapters, machines 생성과 dispose
├─ webComputerContextSwap.js   # candidate stage, activate, rollback
├─ webComputerPersistence.js   # save, startup restore, retention 호출
└─ machineConfig.js            # asset, schema, timeout budget
```

`webComputerContext`는 다음 수명주기를 가진다.

- `create`: 독립 host와 devices를 만들되 UI output은 buffer에 둔다.
- `restore`: machine을 paused 상태까지 복원한다.
- `activate`: output subscription과 active pointer를 연결한다.
- `resume`: 원래 running set 또는 candidate 전체를 실행한다.
- `dispose`: machine, port, subscription을 idempotent하게 정리한다.

### import transaction

```text
inspect untrusted header
  -> verify signature and every blob
  -> preflight adapter, permission, capability
  -> remember current running set
  -> pause current context
  -> create isolated candidate
  -> restore candidate devices and machines
  -> resume candidate while output remains buffered
  -> synchronously swap active pointer and subscriptions
  -> dispose old context
  -> fenced save of imported context
```

candidate resume까지 실패하면 candidate를 dispose하고 기존 pointer를 유지한 채 원래 running set을 resume한다. pointer 교체 뒤 old dispose가 실패하면 새 context는 유지하고 cleanup 오류를 상태에 기록한다. 이미 활성화된 새 컴퓨터를 다시 old로 되돌리지는 않는다.

`MachineEnvelopeCoordinator.importVerified`는 내부에서 만든 machine 목록을 `try/finally`로 추적해 partial candidate를 정리할 수 있어야 한다. guest별 rollback 분기는 두지 않는다.

## generation retention

`generationRetention.js`는 pure reachability 계산만 담당한다. IndexedDB 순회와 delete는 store가 담당한다.

roots:

- 모든 group의 `head`
- 모든 group의 `prev`

한 group의 prune도 blob 삭제 전 모든 group의 retained generation을 검사한다. 동일 digest를 다른 group이나 PREV가 참조하면 보존한다.

```text
begin readwrite(blobs, generations, heads, owners)
  -> assert current owner token for target group
  -> read all heads and generations
  -> compute retained generation keys and blob digests
  -> delete target group generations outside HEAD/PREV
  -> delete blobs referenced by no remaining generation
commit transaction
```

v2 commit과 prune은 모두 `blobs`, `generations`, `heads`, `owners`를 포함하는 readwrite transaction을 사용한다. IndexedDB가 두 transaction을 직렬화하므로 아직 generation이 참조하지 않는 in-flight blob 상태가 존재하지 않는다. v1에서 남은 orphan blob은 첫 v2 prune이 정리한다.

첫 wiring은 `dryRunRecoveryWindow()`로 delete 후보와 retained digest를 보고한다. 동일 fixture에서 결과가 맞은 뒤 `pruneRecoveryWindow()`를 활성화한다. 성공한 commit 뒤 prune을 실행하되 prune 실패는 `cleanupPending`으로 기록하고 startup 또는 다음 commit에서 재시도한다.

## operation control

긴 public operation은 마지막 options에 다음을 받는다.

```ts
interface OperationControl {
  signal?: AbortSignal;
  deadlineAt?: number;
}
```

core는 timer를 만들지 않는다. caller가 signal을 공급하며 core와 adapter는 queue 진입 전, engine 호출 전, blob loop 사이, transaction 시작 전에 중단을 확인한다. browser product는 `AbortSignal.timeout()`과 page lifecycle controller를 결합한다.

제품 budget은 `machineConfig.js` 한 곳에 둔다.

| operation | budget |
|---|---:|
| owner wait | 15초 |
| save | 120초 |
| startup restore | 180초 |
| export | 180초 |
| import | 180초 |

transaction이 `complete`된 뒤에는 abort보다 성공이 우선한다. transaction 결과를 확인할 수 없으면 `WEB_MACHINE_OUTCOME_UNKNOWN`이다. 단순 timeout을 자동 replay하지 않는다.

## hotspot 정리

### WebComputerRuntime

runtime에는 `initialize`, `runPython`, `runLinux`, machine lifecycle verb, `save`, `exportImage`, `importImage`, `inspect`, `dispose`만 남긴다. device 생성, adapter 등록, candidate 교체, retention은 위의 이름 있는 모듈로 이동한다.

### v86 adapter

- `V86GuestAdapterDraft`를 `V86GuestAdapter`로 바꾸고 attempts 전용 주석을 제거한다.
- serial buffer, pattern waiter, timeout, shutdown reject를 `v86SerialPort.js`의 `V86SerialPort`로 이동한다.
- engine lifecycle과 device port wiring은 adapter에 유지한다. port별 모듈이 이미 있으므로 추가 manager 계층은 만들지 않는다.
- refactor 전후 모든 v86 lifecycle, display/input, packet, clock/entropy gate 결과가 같아야 한다.
