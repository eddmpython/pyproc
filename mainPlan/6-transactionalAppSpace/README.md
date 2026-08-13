# Initiative 6: Transactional AppSpace 실행 계획

상태: **착수**

이 문서는 사용자가 소유하거나 협력 가능한 web app의 논리 상태와 pending effect를 Machine transaction에
참여시키는 일곱 번째 이니셔티브의 임시 실행 계획이다.

지속 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-6---transactional-appspace),
실험 원장은 [Initiative 6 attempt](../../tests/attempts/transactionalAppSpace/README.md)가 소유한다.

## 1. 제품 명제

브라우저 renderer의 JavaScript heap, compositor, cookie jar, arbitrary IndexedDB를 외부 API로 완전 snapshot하고
되돌리는 것은 현재 제품 계약이 아니다. 그러나 협력 app이 자기 논리 상태와 외부 effect를 명시적으로
분리하면 Python Machine과 함께 branch, restore, adopt할 수 있다.

> Transactional AppSpace는 browser 전체를 가상화하지 않는다. 협력 app이 선언한 versioned state와
> effect outbox를 pyproc의 generation, branch, approval protocol에 참여시킨다.

임의의 외부 site는 계속 Native CDP와 one-shot verification을 사용한다. AppSpace는 bridge를 설치하고
state contract를 구현한 app만 대상으로 한다.

## 2. FrameSpace와 차이

| FrameSpace | Transactional AppSpace |
|---|---|
| cooperative DOM observation과 typed action | logical application state export, restore, fork, effect staging |
| credentialless sandbox와 ephemeral storage | app-owned state adapter와 exact schema |
| page bridge가 semantic과 geometry를 보고 | app bridge가 declared state와 invariants를 보고 |
| navigation마다 epoch 교체 | transaction epoch와 state revision을 별도 유지 |
| screenshot은 DOM rendering boundary | state snapshot은 pixels나 DOM serialization이 아님 |

FrameSpace target bridge를 무제한 RPC 통로로 넓히지 않는다. AppSpace protocol은 별도 version과 operation
catalog를 갖고, host가 authority와 size를 검증한다.

## 3. App Transaction Contract

### 3.1 app identity

```json
{
  "appId": "com.example.erp",
  "origin": "https://app.example.test",
  "adapterVersion": "1",
  "stateSchema": "erp-state/3",
  "capabilities": ["exportState", "importState", "describeEffects"]
}
```

`appId`, origin, adapter version, state schema가 모두 맞아야 snapshot을 import한다. 다른 origin의 비슷한 app,
새 schema, changed adapter에 자동 migration하지 않는다.

### 3.2 operations

```text
describeApp()
quiesce()
exportState()
validateState(state)
importState(state)
resume()
describeEffects()
stageEffect(intent)
commitEffect(lease)
abortStagedEffect(intent)
inspectTransaction()
```

operation 이름은 attempt에서 축소할 수 있다. app이 arbitrary script를 보내거나 host method를 지정할 수
없다.

### 3.3 exported state

app이 export할 수 있는 것은 자기가 소유한 logical state다.

- router와 selected document identity
- form draft와 validation state
- app store의 domain objects
- explicitly declared IndexedDB records 또는 state archive
- pending local operations
- effect outbox와 idempotency keys
- app state revision과 invariants

다음은 자동 포함하지 않는다.

- JavaScript heap와 closure
- DOM node identity와 event listener
- browser cookie와 credential
- Cache Storage와 Service Worker internal state
- canvas, video, protected media
- cross-origin iframe state
- production server state

## 4. snapshot envelope

```text
app identity and schema
transaction epoch
base revision
canonical logical state bytes
state digest
declared external references
pending effect intents
invariant results
redaction manifest
```

state는 canonical JSON 또는 bounded bytes로 전달한다. transfer byte limit, depth, item count, total artifact quota를
strict하게 적용한다. large blob은 content-addressed sidecar로 분리한다.

page가 계산한 digest를 그대로 믿지 않고 host가 bytes를 다시 digest한다. app-reported invariant는
`reported` provenance이며 host or Python oracle가 재검증한 것만 deterministic pass가 된다.

## 5. coordinated checkpoint

```text
fence new app commands
-> app quiesce
-> export logical state and outbox
-> APX SituationCapsule capture
-> Python checkpoint or Machine pause
-> verify cross-state invariants
-> commit Machine generation with app snapshot reference
-> resume app and Machine
```

app과 Machine storage를 진짜 한 database transaction으로 묶을 수 없을 수 있다. prepare record와 commit
marker를 사용한다.

```text
prepared(appDigest, machineCandidate)
-> machine generation committed
-> transaction commit marker published
```

crash 뒤 marker가 없으면 candidate를 active HEAD로 읽지 않는다. app이 export 뒤 변경됐으면 revision CAS가
commit을 거부한다.

## 6. restore와 branch

restore 순서:

```text
verify app identity, schema, state digest
-> start isolated app instance
-> quiesce
-> import logical state
-> verify app revision and invariants
-> restore Machine generation
-> restore Situation and pending intent links
-> resume both
-> readiness and consistency check
```

branch는 state snapshot과 Machine generation의 pair를 부모로 가진다. app state만 adopt하거나 Python heap만
adopt해 cross-state invariant를 깨뜨리지 않는다.

merge는 기본 제공하지 않는다. logical app state와 Python heap의 일반 merge는 성립하지 않는다. 후보
adopt가 기본 동사다.

## 7. effect outbox

AppSpace의 힘은 state restore보다 effect 분리에서 나온다.

- app은 external effect를 즉시 보내지 않고 intent로 stage한다.
- `describeEffects()`는 destination, payload digest, risk, precondition을 반환한다.
- Initiative 5 approval과 CommitLease만 `commitEffect`를 열 수 있다.
- stage와 commit 사이 app state revision이 바뀌면 lease는 stale이다.
- sent 뒤 app은 durable outbox terminal을 기록하고 automatic retry를 하지 않는다.
- app이 자체 idempotency를 제공하면 capability와 scope를 선언한다.

page-reported effect description은 authority가 아니다. host policy와 caller approval을 통과해야 한다.

## 8. isolation과 trust

- default FrameSpace sandbox와 credentialless를 유지한다.
- state bridge는 parent DOM, top navigation, popup, download 권한을 얻지 않는다.
- exact origin과 app identity를 handshake 전후로 확인한다.
- import state는 untrusted executable-equivalent data로 취급한다.
- secret field는 app adapter가 schema로 표시하고 export 전에 redact 또는 externalize한다.
- app snapshot signature는 source provenance이며 permission grant가 아니다.
- arbitrary external app을 transactional로 자동 판정하지 않는다.

credentialless storage가 ephemeral이므로 durable app state는 host side snapshot store 또는 app이 명시한
cooperative backend에서 온다. 기존 로그인 session을 transaction에 넣기 위해 sandbox를 약화하지 않는다.

## 9. architecture 후보

```text
scripts/appSpace/
|-- appSpace.js
|-- appSpacePage.js
|-- appSpaceTarget.js
|-- appContract.js
|-- appStateEnvelope.js
|-- appCheckpointCoordinator.js
|-- appBranchCoordinator.js
|-- effectOutbox.js
`-- appSpaceErrors.js
```

FrameSpace의 channel과 isolation primitive를 재사용할 수 있지만 protocol identity와 operation catalog는
분리한다. Machine commit, Execution Memory, Rehearse-Commit을 조합하고 구현을 복제하지 않는다.

## 10. public surface 후보

```text
attachApp(target)
inspectApp(appRef)
checkpointPair(sessionRef)
branchPair(sessionRef, name)
restorePair(branchRef)
adoptPair(branchRef)
listEffects(appRef)
stageEffect(appRef, input)
commitEffect(intentRef, approval)
detachApp(appRef)
```

기존 AutomationSpace operation에 억지로 app state를 넣을지, same Control router의 새 stable operation family로
둘지는 attempt에서 wire compatibility를 검증한다. 새 root npm export는 만들지 않는다.

## 11. 실험 캠페인

신규 코드는 [Initiative 6 attempt](../../tests/attempts/transactionalAppSpace/)에서 시작한다.

fixture family:

1. router, form, domain store가 있는 cooperative app
2. declared IndexedDB records와 large sidecar
3. quiesce 중 state mutation
4. schema version mismatch와 migration request
5. app state와 Python computed total의 invariant mismatch
6. three sibling branches and one adopt
7. staged effect, changed state, stale approval
8. crash between prepare, Machine commit, transaction marker
9. credential, cookie, hidden secret fields
10. canvas and cross-origin frame outside state scope

필수 probe:

| probe | 질문 | 음성 시험 |
|---|---|---|
| `appHandshakeProbe.html` | exact app identity와 isolation인가 | forged origin과 parent access 0 |
| `logicalStateProbe.html` | state round trip이 app meaning을 보존하는가 | DOM 또는 JS heap claim 0 |
| `pairedCheckpointProbe.html` | app과 Machine이 같은 transaction인가 | one-sided adopt 0 |
| `quiesceRaceProbe.html` | export 중 mutation을 거부하는가 | stale revision commit 0 |
| `branchAdoptProbe.html` | sibling branch가 서로 오염되지 않는가 | general merge 제공 0 |
| `effectOutboxProbe.html` | stage와 live send가 분리되는가 | approval 전 send 0 |
| `crashMarkerProbe.html` | partial commit이 active로 보이지 않는가 | missing marker restore 0 |
| `secretBoundaryProbe.html` | private state가 안전한가 | cookie와 secret export 0 |

## 12. 실행 단계

1. FrameSpace protocol과 cooperative state boundary를 분리해 측정한다.
2. app identity, schema, state envelope negative fixture를 만든다.
3. quiesce, export, import, invariant round trip을 구현한다.
4. paired Machine generation commit과 crash marker를 구현한다.
5. paired branch, restore, adopt를 구현한다.
6. effect outbox를 Initiative 5 transaction에 연결한다.
7. secret, origin, sandbox, quota 음성 시험을 닫는다.
8. Control, MCP, JavaScript, Python parity를 구현한다.
9. installed package의 cooperative app golden journey를 실행한다.
10. docs, example, security, API, capability matrix를 정합화한다.
11. debt, attempt, mainPlan을 완료 사이클에 삭제한다.

## 13. 문서 정합

- `docs/specs/appSpace/README.md`
- `docs/usage/appSpace.md`
- `docs/usage/frameSpace.md`
- `docs/usage/rehearseCommit.md`
- `docs/usage/executionMemory.md`
- `docs/usage/trustPermissions.md`
- `docs/usage/capabilityMatrix.md`
- `docs/reference/api.md`
- `docs/operations/moduleBoundaries.md`
- `docs/operations/contractReality.md`
- `docs/product/vision.md`
- `README.md`, `README.ko.md`
- `SECURITY.md`

## 14. 졸업 gate

1. app state round trip이 router, form, domain store, declared records, outbox invariant를 보존한다.
2. DOM, JS heap, cookie, cross-origin state를 snapshot했다고 주장한 횟수 0이다.
3. app과 Machine one-sided commit 또는 adopt는 0이다.
4. state revision race와 schema mismatch는 active generation publish 전에 거부된다.
5. crash marker 없는 candidate를 active로 복구한 횟수 0이다.
6. sibling branch 사이 state contamination은 0이다.
7. approval 없는 staged effect live send는 0이다.
8. page-reported capability가 host permission을 넓힌 횟수 0이다.
9. cookie, credential, configured secret 원문 export는 0이다.
10. installed Chrome, Edge와 모든 public client에서 같은 paired generation digest를 반환한다.

## 15. 실패 조건

- DOM serialization을 app state snapshot이라고 부르면 실패다.
- arbitrary site 지원을 위해 sandbox, origin, credential 경계를 약화하면 실패다.
- app-reported invariant를 deterministic truth로 그대로 믿으면 실패다.
- app과 Machine을 atomic하게 묶지 못하면서 paired checkpoint를 주장하면 실패다.
- rollback 불가능한 server effect를 state restore로 되돌렸다고 표현하면 실패다.
- app-specific domain schema를 pyproc core에 넣으면 protocol을 다시 추상화한다.

## 16. 완료 정의

협력 app과 Python Machine이 같은 부모에서 여러 paired branch로 갈라지고, 각 후보를 effect 없이 검증하고,
하나를 adopt하며, external effect는 승인된 outbox intent만 한 번 commit할 때 끝난다.
