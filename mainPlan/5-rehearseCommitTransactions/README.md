# Initiative 5: Rehearse-Commit Transactions 실행 계획

상태: **착수**

이 문서는 위험한 외부 effect를 안전한 환경에서 연습하고, exact intent에 대한 승인을 받은 뒤, 현실에는
한 번만 전송하고 결과를 봉인하는 여섯 번째 이니셔티브의 임시 실행 계획이다.

지속 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-5---rehearse-commit-transactions),
실험 원장은 [Initiative 5 attempt](../../tests/attempts/rehearseCommitTransactions/README.md)가
소유한다.

## 1. 제품 명제

일반 browser action loop는 현실에서 직접 시도하고 실패하면 다른 action을 보낼 수 있다. 외부 주문, 지급,
저장, 발송은 되돌릴 수 없고 timeout 뒤 재시도는 중복 effect를 만들 수 있다.

> Rehearse-Commit은 후보 계산과 업무 흐름을 effect-free 환경에서 검증하고, 승인된 exact intent 하나만
> live provider에 전송한 뒤 terminal truth를 증거로 봉인하는 transaction protocol이다.

브라우저나 외부 시스템의 transaction을 마법처럼 rollback하지 않는다. pyproc이 소유하는 것은 intent,
승인, one-shot send, evidence, outcomeUnknown의 수명주기다.

## 2. rehearsal의 정직한 범위

| provider | rehearsal이 증명하는 것 | 증명하지 않는 것 |
|---|---|---|
| ReplaySpace | pinned recording에서 같은 input이 같은 terminal 경로를 밟음 | 현재 live site와 새 input의 결과 |
| FrameSpace | 협력 app의 current logic과 isolated state에서 flow가 성립 | 외부 production service의 실제 수락 |
| Python branch | 계산, payload, rule, invariant가 같은 base에서 성립 | browser target과 live network state |
| Native CDP | live readiness와 현재 target 확인 | effect-free rehearsal이 아님 |

ReplaySpace가 recorded success를 돌려줘도 “live effect가 성공할 것”이라고 말하지 않는다. receipt에는
`recorded`, `cooperative`, `computed`, `liveReadOnly` coverage를 분리한다.

## 3. transaction objects

### 3.1 EffectIntent

```json
{
  "intentId": "intent:...",
  "operation": "submitPayment",
  "destination": { "origin": "https://example.test", "accountDigest": "sha256:..." },
  "payloadSha256": "sha256:...",
  "risk": "externalEffect",
  "preconditions": [],
  "expectedTransition": [],
  "environmentSha256": "sha256:...",
  "sessionRevisionSha256": "sha256:..."
}
```

secret payload 원문은 intent에 넣지 않는다. 실제 fill data는 bounded secret provider가 commit 시점에
주입하고 digest와 field purpose만 남긴다.

### 3.2 RehearsalReceipt

- exact intent digest
- provider kind와 source recording 또는 app state digest
- branch와 checkpoint
- 실행한 precondition과 oracle
- SituationCapsule과 Evidence Pack reference
- coverage와 known limitation
- pass, reject, incomplete terminal

receipt는 authorization이 아니다.

### 3.3 ApprovalGrant

- exact intent digest
- approver kind와 identity reference
- allowed destination, risk, amount 또는 domain constraint
- expiry와 one-shot nonce
- policy version
- signature 또는 trusted local authority evidence

page content, accessibility text, declared tool, inference output은 approver가 될 수 없다. approval 변경 뒤
intent가 바뀌면 grant는 stale이다.

### 3.4 CommitLease

CommitLease는 one-shot send capability다. 다음 state를 가진다.

```text
issued -> reserved -> sent -> confirmed
                         \-> contradicted
                         \-> outcomeUnknown
       \-> expired
       \-> revoked
```

`sent` 이후에는 같은 lease와 intent를 다시 실행하지 않는다. confirmed가 아니어도 자동 재시도하지 않는다.

### 3.5 EffectReceipt

final receipt는 다음을 연결한다.

- EffectIntent
- RehearsalReceipt
- ApprovalGrant
- CommitLease terminal
- before와 after SituationCapsule
- ActionEvidence
- relevant network evidence
- Machine generation before와 after
- Execution Session revision
- Evidence Pack digest

이것이 Initiative 2의 Evidence Pack을 대체하지 않는다. transaction-specific manifest가 pack의 검증된
objects를 참조한다.

## 4. state machine

```text
draft
-> prepared
-> rehearsing
-> rehearsed
-> awaitingApproval
-> approved
-> preflightLive
-> reserved
-> sent
-> confirmed | contradicted | outcomeUnknown
```

역방향 전이는 새 revision과 새 intent를 만든다. approved intent를 수정해서 같은 approval을 재사용하지
않는다.

### 4.1 prepare

- Python branch에서 payload와 invariants를 계산한다.
- destination과 effect class를 분류한다.
- current Execution Session revision을 pin한다.
- expected transition을 machine-readable predicate로 만든다.

### 4.2 rehearse

- ReplaySpace와 FrameSpace에서 가능한 coverage를 실행한다.
- production effect endpoint는 deny한다.
- 후보 branch를 같은 base에서 비교한다.
- receipt의 limitation을 숨기지 않는다.

### 4.3 approve

- 사람이든 policy engine이든 exact intent digest를 승인한다.
- page와 model output은 승인 자료일 수 있지만 grant issuer가 아니다.
- expired, changed destination, changed payload는 새 approval을 요구한다.

### 4.4 commit

- live target을 새로 관찰하고 precondition을 확인한다.
- intent와 approval을 다시 digest 대조한다.
- one-shot lease를 durable하게 reserve한다.
- action을 한 번 전송한다.
- send boundary를 기록한 뒤 결과가 불명확해도 lease를 소비한다.

### 4.5 verify and seal

- DOM, application durable state, network response를 함께 본다.
- unrelated response를 effect evidence로 연결하지 않는다.
- confirmed, contradicted, ambiguous, notObserved, outcomeUnknown을 보존한다.
- final Machine generation과 session revision에 receipt를 연결한다.

## 5. exactly-once의 정확한 의미

인터넷의 외부 service까지 exactly-once를 보장한다고 주장하지 않는다. 보장 범위는 다음이다.

1. pyproc broker는 한 CommitLease로 effect command를 한 번만 보낸다.
2. sent boundary가 durable하면 client retry가 같은 effect를 다시 보내지 않는다.
3. external endpoint가 idempotency key를 지원하면 exact intent ID를 사용하도록 adapter가 선언할 수 있다.
4. endpoint의 idempotency가 없으면 outcomeUnknown을 사람이 조사해야 한다.

“한 번만 전송”과 “외부 시스템에 한 번만 적용”을 문서에서 분리한다.

## 6. authority와 policy

- external effect는 default deny다.
- rehearsal provider는 live effect authority를 가질 필요가 없다.
- approval과 action capability는 origin, destination, risk, purpose에 묶인다.
- secret provider는 commit 시점에만 bounded value를 제공한다.
- approval grant를 Machine image에 넣어 이동시키지 않는다. 새 trust domain에서는 재승인한다.
- policy engine은 deterministic rule과 signed version을 가진다.
- hosted inference는 approval issuer가 아니다.

## 7. internal architecture 후보

```text
scripts/transactions/
|-- effectIntent.js
|-- rehearsalCoordinator.js
|-- rehearsalReceipt.js
|-- approvalGrant.js
|-- commitLease.js
|-- oneShotCommitter.js
|-- effectReceipt.js
|-- transactionPolicy.js
`-- transactionErrors.js
```

ActionEvidence, AutomationSpace, ReplaySpace, Execution Memory, Evidence Pack, state kernel을 재사용한다. browser
provider에 transaction flag를 퍼뜨리지 않고 upper coordinator가 existing operation을 조합한다.

## 8. public surface 후보

```text
prepare(intentInput)
rehearse(intentRef, providers)
requestApproval(intentRef)
approve(intentRef, grant)
commit(intentRef, grant, liveTarget)
inspect(transactionRef)
seal(transactionRef)
```

MCP에서는 prepare, rehearse, inspect는 read 또는 local mutation으로 분리하고, commit은 가장 높은 risk와
explicit acknowledgement를 요구한다. `commit`이라는 이름이 Machine generation commit과 충돌하면 product
probe에서 `commitEffect`로 좁힌다.

## 9. 실험 캠페인

모든 신규 코드는
[Initiative 5 attempt](../../tests/attempts/rehearseCommitTransactions/)에서 시작한다.

fixture family:

1. payment-like effect with amount and account digest
2. email send with recipient and body digest
3. ERP record save with visible success but durable failure
4. live page changed after approval
5. post-send browser death
6. duplicate client retry
7. stale approval and changed payload
8. ReplaySpace success but live precondition mismatch
9. FrameSpace simulated success with production endpoint denied
10. endpoint with and without idempotency key

필수 probe:

| probe | 질문 | 음성 시험 |
|---|---|---|
| `intentCanonicalProbe.mjs` | 같은 effect가 stable intent를 만드는가 | secret 원문과 mutable field 포함 0 |
| `rehearsalTruthProbe.html` | coverage와 limitation이 정직한가 | recorded success를 live guarantee로 표시 0 |
| `approvalBindingProbe.mjs` | approval이 exact intent에 묶이는가 | payload 변경 뒤 grant 재사용 0 |
| `oneShotLeaseProbe.html` | client retry가 effect를 다시 보내지 않는가 | send count 1 초과 0 |
| `livePreflightProbe.html` | approval 뒤 바뀐 page를 거부하는가 | stale situation action 0 |
| `outcomeUnknownProbe.html` | post-send death가 자동 재시도되지 않는가 | second effect 0 |
| `effectReceiptProbe.mjs` | intent부터 evidence까지 연결되는가 | missing grant 또는 evidence seal 0 |
| `handoffApprovalProbe.mjs` | trust domain 변경이 재승인을 요구하는가 | imported grant 자동 활성화 0 |

## 10. 실행 단계

1. external effect와 current ActionEvidence boundary를 inventory한다.
2. pure EffectIntent와 approval schema를 만든다.
3. ReplaySpace, Python branch, FrameSpace rehearsal receipt를 구현한다.
4. one-shot durable CommitLease와 crash fixture를 구현한다.
5. live preflight와 ActionEvidence verification을 묶는다.
6. EffectReceipt와 Execution Session revision을 연결한다.
7. installed Control, MCP, JavaScript, Python surface를 통일한다.
8. payment, email, ERP fixture를 end-to-end 반증한다.
9. docs, security, permission UI, API, README를 정합화한다.
10. debt, attempt, mainPlan을 완료 사이클에 삭제한다.

## 11. 문서 정합

- `docs/specs/rehearseCommit/README.md`
- `docs/usage/rehearseCommit.md`
- `docs/usage/browserAutomation.md`
- `docs/usage/replaySpace.md`
- `docs/usage/trustPermissions.md`
- `docs/usage/executionMemory.md`
- `docs/usage/controlProtocol.md`
- `docs/usage/javascriptControl.md`
- `docs/usage/pythonSdk.md`
- `docs/usage/capabilityMatrix.md`
- `docs/reference/api.md`
- `docs/product/vision.md`
- `docs/operations/contractReality.md`
- `README.md`, `README.ko.md`
- `SECURITY.md`

## 12. 졸업 gate

1. 한 CommitLease의 live effect send count는 최대 1이다.
2. post-send failure와 timeout 뒤 자동 resend는 0이다.
3. changed payload, destination, risk, session revision은 old approval을 전부 stale로 만든다.
4. recorded 또는 cooperative rehearsal이 live guarantee로 표시된 횟수 0이다.
5. live precondition mismatch에서 effect send는 0이다.
6. page text, inference, imported image가 approval authority를 만든 횟수 0이다.
7. effect receipt가 intent, rehearsal, approval, lease, before와 after, evidence, generation을 모두 연결한다.
8. missing evidence와 outcomeUnknown이 confirmed로 축약된 횟수 0이다.
9. secret 원문이 intent, approval, receipt, recording에 유출된 횟수 0이다.
10. client parity와 installed Chrome, Edge gate가 green이다.

## 13. 실패 조건

- replay success를 production prediction으로 팔면 실패다.
- browser rollback을 지원하지 않으면서 transaction rollback을 주장하면 실패다.
- approval을 natural language 한 줄이나 page-reported capability로 대신하면 실패다.
- timeout 뒤 retry를 허용해야 journey가 green이면 실패다.
- external exactly-once를 endpoint 지원 없이 주장하면 실패다.
- provider 내부에 transaction-specific branch를 흩뿌리면 upper orchestration을 다시 설계한다.

## 14. 완료 정의

같은 prepared state에서 후보를 검증하고, exact intent가 승인되고, live precondition을 다시 확인하고, effect를
한 번만 보내고, 결과가 generation과 evidence에 봉인되며, 불명확한 결과는 재시도되지 않을 때 끝난다.
