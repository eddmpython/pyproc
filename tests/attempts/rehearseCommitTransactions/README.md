# Initiative 5: rehearseCommitTransactions - 연습한 effect를 승인 뒤 현실에 한 번만 보낼 수 있는가

## 가설

EffectIntent, RehearsalReceipt, ApprovalGrant, one-shot CommitLease, ActionEvidence를 하나의 state machine으로
묶으면 effect-free rehearsal과 live commit을 혼동하지 않고 위험한 external effect의 중복 전송을 막을 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-5---rehearse-commit-transactions),
실행 계획은 [Initiative 5](../../../mainPlan/5-rehearseCommitTransactions/README.md)이다.

## 선행 조건

Initiative 4가 졸업해 intent와 receipt가 exact Execution Session revision에 연결되어야 한다.

## 졸업 게이트

1. 한 CommitLease의 live effect send count는 최대 1이다.
2. post-send failure 뒤 자동 resend는 0이다.
3. changed intent에서 stale approval 수락은 0이다.
4. rehearsal receipt를 live success guarantee로 표시한 횟수 0이다.
5. live precondition mismatch의 effect send는 0이다.
6. page 또는 inference가 approval authority를 만든 횟수 0이다.
7. sealed receipt의 required link 누락 수락은 0이다.
8. outcomeUnknown을 confirmed로 축약한 횟수 0이다.
9. secret 원문 artifact 유출은 0이다.
10. installed client별 terminal과 receipt digest 차이는 0이다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `intentCanonicalProbe.mjs` | exact effect identity인가 | secret과 mutable field 제외 |
| `rehearsalTruthProbe.html` | rehearsal 범위가 정직한가 | live guarantee 0 |
| `approvalBindingProbe.mjs` | grant가 exact intent에 묶이는가 | stale grant 거부 |
| `oneShotLeaseProbe.html` | retry가 send를 늘리지 않는가 | send count 1 초과 0 |
| `livePreflightProbe.html` | page change를 잡는가 | stale action 0 |
| `outcomeUnknownProbe.html` | 불명확 effect를 멈추는가 | resend 0 |
| `effectReceiptProbe.mjs` | 모든 증거가 연결되는가 | missing link 거부 |
| `handoffApprovalProbe.mjs` | trust domain이 재승인을 요구하는가 | imported grant 활성화 0 |

## 모듈화 설계 후보

- intent, approval, lease, receipt는 immutable objects다.
- rehearsal은 coverage와 limitation을 first-class로 보존한다.
- one-shot send는 durable lease가 소유한다.
- external endpoint exactly-once는 별도 capability로만 선언한다.
- existing browser provider와 evidence 계약을 재사용한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | source contract audit | history branches, ReplaySpace, FrameSpace, ActionEvidence 대조 | probe 미실행 | rollback이 아니라 intent와 one-shot effect lifecycle이 제품 축 | Initiative 4 졸업 뒤 intent prototype |

## 판정

후행 대기 중. Initiative 4 졸업 전에는 probe를 실행하지 않는다.
