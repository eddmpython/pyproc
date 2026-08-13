# Initiative 3: Hibernating Machine Fleet 실행 계획

상태: **졸업 검증 완료, 삭제 대기**

이 문서는 여러 프로젝트 Machine을 등록해 두되 정해진 수만 실행 상태로 유지하고, 나머지는 durable
generation으로 안전하게 동면시키는 네 번째 이니셔티브의 임시 실행 계획이다.

지속 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-3---hibernating-machine-fleet),
실험 원장은 [Initiative 3 attempt](../../tests/attempts/hibernatingMachineFleet/README.md)가
소유한다.

## 1. 정확한 제품 명제

브라우저 Machine은 host RAM을 사용한다. 목표는 RAM을 쓰지 않는다는 주장이 아니다.

> 사용 중인 Machine만 실행 heap과 Worker를 유지하고, 비활성 Machine은 마지막으로 검증된 generation만
> durable storage에 남긴 뒤 실행 자원을 종료한다.

Fleet은 Machine을 대체하지 않는다. 여러 durable Machine의 lease, hot budget, 동면과 복구 순서를
조정하는 상위 lifecycle이다.

## 2. 현재 기반과 실제 간극

| 현재 기반 | 이미 있는 것 | 남은 간극 |
|---|---|---|
| root `open({ name })` | 명령 뒤 generation 자동 commit과 cold reopen | explicit suspend, hot budget, worker termination 계약 없음 |
| `MachineHandle` | created, running, paused, stopped, failed와 portable restore | stopped가 durable commit을 의미하지 않음 |
| Durable Web Computer | pause, snapshot, fenced generation commit, resume, dispose | save가 다시 resume하며 여러 computer를 예산으로 관리하지 않음 |
| worker-hosted guest | guest 실행을 dedicated Worker에 배치 가능 | 기본 durable Python entrance와 fleet lifecycle로 결합되지 않음 |
| OPFS state kernel | content-addressed generation과 recovery window | fleet registry, lease, storage pressure policy 없음 |
| environment cache | engine과 wheel 재사용 재료 | warm Machine이라는 lifecycle과 memory 보장은 없음 |

현재 root durable leader는 page에서 `bootSession()`을 직접 실행한다. handle의 `leave()`는 election과 channel을
끝내지만 살아 있는 runtime의 메모리 반환을 증명하는 동사가 아니다. 따라서 “leave를 suspend로 이름만
바꾸기”는 실패다. 동면 완료는 dedicated Worker 또는 동등하게 회수 가능한 실행 owner가 종료됐다는
증거까지 포함해야 한다.

## 3. lifecycle

### 3.1 공개 상태

```text
registered
-> waking
-> hot
-> draining
-> committing
-> stopping
-> cold
-> waking

any safe pre-send state -> failed
sent effect with unknown outcome -> outcomeUnknown
```

- `registered`: identity와 persistence 계약만 있음
- `hot`: 명령을 받을 수 있는 live runtime과 owner lease가 있음
- `draining`: 새 명령을 거부하고 이미 받은 명령의 terminal을 기다림
- `committing`: heap, home, outcome, environment를 한 generation에 봉인
- `stopping`: runtime owner와 Worker를 종료하고 device를 회수
- `cold`: live runtime 없음, exact durable generation과 resume contract만 있음
- `waking`: owner를 획득하고 exact environment를 부팅해 generation을 복구 중

`paused`는 hot의 하위 실행 상태이지 cold가 아니다. heap이 resident면 동면이 아니다.

### 3.2 제외하는 warm 상태

엔진 asset, wheel, deterministic base가 cache에 있다는 사실은 `prefetched` resource hint로 기록할 수 있다.
이를 Machine의 `warm` lifecycle로 부르지 않는다. warm이 resident heap인지 disk cache인지 모호해지면
memory budget을 판정할 수 없다.

### 3.3 frozen

서명된 `.pymachine` 또는 `.webmachine` export는 `frozen` 보관 형태로 표현할 수 있다. frozen은 fleet의
active registry와 storage generation이 없어도 이동 가능한 archive다. signature는 permission이 아니며
import 때 trust와 environment를 다시 확인한다.

## 4. Fleet contract 후보

```text
register(machineSpec)
acquire(machineId, purpose)
release(machineId)
suspend(machineId)
resume(machineId)
setHotLimit(limit)
prefetch(machineId)
inspect()
dispose()
```

`evict`는 삭제인지 RAM 회수인지 모호하므로 공개 동사 후보에서 제외한다. RAM 회수는 `suspend`, durable
state 삭제는 별도 destructive operation으로 분리하고 이 이니셔티브 기본 범위에 넣지 않는다.

### 4.1 lease

`acquire`는 현재 owner epoch에 묶인 lease를 반환한다. command와 release는 fresh lease를 요구한다.
오래된 UI나 다른 tab이 cold Machine을 깨우거나 새 owner의 Machine을 suspend하지 못하게 한다.

### 4.2 hot limit

hot limit은 admission policy다.

1. hot slot이 있으면 target을 wake한다.
2. 없으면 idle이며 safe terminal인 candidate만 고른다.
3. candidate를 drain, commit, stop한 뒤 target을 wake한다.
4. active command, pending approval, sent effect, unsaved state, unknown outcome은 자동 candidate가 아니다.
5. safe candidate가 없으면 다른 Machine을 강제 종료하지 않고 capacity error를 반환한다.

LRU는 후보 선택의 한 정책일 뿐 안전 조건보다 우선하지 않는다. pin과 priority는 caller policy로 주입한다.

## 5. suspend protocol

```text
fence new commands
-> drain accepted commands
-> assert no unresolved external effect
-> checkpoint guest and flush devices
-> commit generation with outcome records
-> verify HEAD and environment fingerprint
-> shutdown adapter and terminate owned Worker
-> release owner and device lease
-> publish cold state
```

실패 의미:

- drain failure: hot 또는 failed, effect terminal 보존
- commit failure: runtime을 종료하지 않고 `unsaved`
- shutdown failure after commit: durable generation은 유효하지만 resource cleanup은 `incomplete`
- owner loss during commit: fenced commit 거부, 새 owner가 HEAD를 확인
- browser process death: 다음 wake가 durable HEAD에서 cold recovery

`saveBase()` 호출은 suspend가 아니다. base와 current heap이 resident인 구조에서는 memory가 줄지 않는다.

## 6. resume protocol

```text
acquire fleet slot and owner fence
-> read exact HEAD
-> verify engine, manifest, asset, guest adapter fingerprint
-> boot owned Worker
-> restore heap and /home/web or machine generation
-> run declared resume hook
-> rebind allowed resources
-> run readiness probe
-> publish hot lease
```

socket, browser session, file descriptor, JS proxy 같은 host resource는 generation byte만으로 살아나지 않는다.
`resume.py`와 resource catalog가 재개를 선언하며, 복구 불가능한 surface는 portable 또는 hibernatable로
거짓 표시하지 않는다.

## 7. resource accounting

Fleet inspect는 다음을 구분한다.

- hot Machine 수와 worker identity
- waking, draining, committing 수
- cold generation 수와 durable byte
- prefetched asset byte
- owned profile과 automation process
- pending command, approval, outcomeUnknown
- last suspend와 resume terminal

browser가 반환한 memory는 host와 GC가 결정하므로 public contract는 특정 MB 감소를 약속하지 않는다.
실험에서는 pinned browser에서 Worker process 종료와 heap reachability 소멸을 우선 gate로 두고, process
memory delta는 보조 evidence로 기록한다.

## 8. 내부 구조 후보

```text
scripts/fleet/
|-- machineFleet.js
|-- fleetRegistry.js
|-- fleetLease.js
|-- hotBudgetPolicy.js
|-- suspendCoordinator.js
|-- resumeCoordinator.js
|-- resourceAccounting.js
`-- fleetErrors.js
```

실측 전 파일을 만들지 않는다. state kernel, Web Computer commit coordinator, worker-hosted guest를
재사용한다. Machine 내부에 fleet-specific flag를 분산시키지 않는다.

공개 위치 후보는 existing `pyproc/machine` 상세 표면과 Control operation이다. 새 root export나 새 subpath는
만들지 않는다. UI와 project ordering은 consumer 책임이다.

## 9. 실험 캠페인

모든 신규 코드는
[Initiative 3 attempt](../../tests/attempts/hibernatingMachineFleet/)에서 시작한다.

필수 probe:

| probe | 질문 | 음성 시험 |
|---|---|---|
| `workerReclaimProbe.html` | snapshot 후 Worker 종료가 실행 heap owner를 제거하는가 | pause만 한 대조군을 cold로 판정 0 |
| `suspendCommitProbe.html` | generation commit 뒤에만 stop하는가 | commit 실패 뒤 shutdown 0 |
| `coldResumeProbe.html` | exact state, home, outcome이 새 Worker에서 복구되는가 | manifest mismatch 수락 0 |
| `hotLimitProbe.html` | limit 아래로 live worker를 유지하는가 | active와 unknown effect 자동 suspend 0 |
| `leaseFenceProbe.html` | stale owner가 lifecycle을 바꾸지 못하는가 | stale suspend와 double wake 0 |
| `crashRecoveryProbe.html` | 각 protocol 경계의 death가 정직하게 복구되는가 | torn generation을 cold success로 판정 0 |
| `resourceCleanupProbe.html` | worker, profile, device, timer가 회수되는가 | owned resource 잔여 0 |

## 10. 실행 단계

1. current `open`, worker-hosted guest, Durable Web Computer의 memory owner를 계측한다.
2. worker termination이 가능한 최소 portable guest 경로를 attempt에서 만든다.
3. suspend와 resume state machine, lease, failure terminal을 고정한다.
4. hot budget과 safe eviction candidate policy를 구현한다.
5. concurrent wake, suspend, owner loss, browser death를 반증한다.
6. 본진 모듈로 승격하고 existing machine detail surface에 연결한다.
7. Control, MCP, JavaScript, Python 소비 형태를 같은 lifecycle로 맞춘다.
8. installed package에서 여러 project fixture를 cold와 hot 사이로 반복 전환한다.
9. docs, root README, capability matrix, security, API를 정합화한다.
10. contract reality debt, attempt, mainPlan을 같은 완료 사이클에 삭제한다.

## 11. 문서 정합

완료 변경은 다음을 포함한다.

- `docs/specs/machineFleet/README.md`
- `docs/usage/machineFleet.md`
- `docs/usage/contract.md`
- `docs/usage/capabilityMatrix.md`
- `docs/usage/platformRequirements.md`
- `docs/usage/resumeCatalog.md`
- `docs/reference/api.md`
- `docs/operations/moduleBoundaries.md`
- `docs/operations/contractReality.md`
- `docs/product/vision.md`
- `README.md`, `README.ko.md`
- `SECURITY.md`

memory 문구는 “inactive execution owner terminated”로 말하고 “0 MB”, “PC memory를 쓰지 않음”으로 쓰지
않는다.

## 12. 졸업 gate

1. hot limit N에서 runnable execution owner 수가 N을 넘지 않는다.
2. cold Machine은 live Worker, runtime, device lease, timer를 소유하지 않는다.
3. commit 실패 뒤 shutdown 0, unresolved effect가 있는 자동 suspend 0이다.
4. exact generation, environment, home, durable outcome이 새 Worker에서 복구된다.
5. stale lease lifecycle mutation, double owner, double wake가 0이다.
6. crash boundary마다 torn commit을 success로 읽지 않는다.
7. resource cleanup 실패는 cold success가 아니라 incomplete다.
8. multiple tab과 browser process restart 뒤에도 registry와 HEAD가 정합하다.
9. memory 보조 측정은 raw artifact로 남기고 public numeric claim을 만들지 않는다.
10. installed package와 Chrome, Edge browser gate가 green이다.

## 13. 실패 조건

- main-thread runtime 참조를 남긴 채 상태 이름만 cold로 바꾸면 실패다.
- pause 또는 save를 suspend라고 부르면 실패다.
- memory budget을 지키기 위해 active effect를 강제 종료하면 실패다.
- warm, prefetched, cold가 같은 의미로 섞이면 실패다.
- 특정 UI의 project model을 pyproc core에 넣어야만 fleet이 성립하면 범위를 줄인다.
- browser memory 숫자만 좋아지고 worker ownership과 durable recovery gate가 없으면 승격하지 않는다.

## 14. 완료 정의

여러 project Machine이 durable registry에 존재하고, 제한된 수만 live execution owner를 가지며, safe idle
Machine은 commit 뒤 실제로 종료되고, 새 owner가 exact generation에서 다시 작업을 이어갈 때 끝난다.

## 15. 실행 결과

- `createMachineFleet`을 새 root나 subpath 없이 기존 `pyproc/machine` 표면에 승격했다.
- durable Web Computer에 explicit `suspend`, `resume`, cleanup retry, environment fence를 결합했다.
- real Pyodide Worker의 생성과 종료 identity를 계측하고 cold resource owner 0을 확인했다.
- Edge와 Chrome에서 같은 IndexedDB profile로 browser process를 실제 재시작해 새 owner epoch, 새 Worker,
  Python heap, `/home/web`, exact HEAD 복구를 확인했다.
- packed npm artifact에서 공개 subpath만으로 commit, terminate, cold resume를 확인했다.
- executable `createComputer` factory는 직렬화할 수 없으므로 Fleet registry identity는 application
  configuration이 재등록한다. Control, MCP, Python guest가 browser factory를 거짓으로 소유하지 않으며,
  cross-client durable session 연결은 다음 Initiative 4의 Execution Memory Registry가 맡는다.
