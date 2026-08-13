# Initiative 6: transactionalAppSpace - 협력 app 상태와 Machine을 한 transaction으로 분기할 수 있는가

## 가설

versioned logical app state, quiesce, paired generation commit, effect outbox를 cooperative bridge로 제공하면
browser 전체를 snapshot하지 않고도 app과 Python Machine을 함께 branch, restore, adopt할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-6---transactional-appspace),
실행 계획은 [Initiative 6](../../../mainPlan/6-transactionalAppSpace/README.md)이다.

## 선행 조건

Initiative 5이 졸업해 effect outbox가 approval과 one-shot CommitLease를 재사용해야 한다.

## 졸업 게이트

1. declared app state round trip이 모든 deterministic invariant를 보존한다.
2. DOM, JS heap, cookie, cross-origin state snapshot claim은 0이다.
3. one-sided app 또는 Machine commit과 adopt는 0이다.
4. revision race와 schema mismatch를 active publish 전에 모두 거부한다.
5. marker 없는 partial candidate active restore는 0이다.
6. sibling branch contamination은 0이다.
7. approval 전 live effect send는 0이다.
8. page capability의 permission 확대는 0이다.
9. secret 원문 export는 0이다.
10. installed client별 paired generation digest 차이는 0이다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `appHandshakeProbe.html` | identity와 sandbox가 정확한가 | forged origin과 parent access 0 |
| `logicalStateProbe.html` | logical state가 왕복하는가 | DOM heap claim 0 |
| `pairedCheckpointProbe.html` | app과 Machine이 함께 닫히는가 | one-sided commit 0 |
| `quiesceRaceProbe.html` | mutation race를 잡는가 | stale revision 거부 |
| `branchAdoptProbe.html` | branch가 격리되는가 | contamination 0 |
| `effectOutboxProbe.html` | stage와 send가 분리되는가 | approval 전 send 0 |
| `crashMarkerProbe.html` | partial commit을 숨기지 않는가 | marker 없는 restore 0 |
| `secretBoundaryProbe.html` | private state가 빠지는가 | 원문 0 |

## 모듈화 설계 후보

- AppSpace protocol은 FrameSpace transport와 분리한다.
- app identity, state schema, revision이 snapshot authority를 소유한다.
- paired coordinator가 app과 Machine commit 순서를 소유한다.
- effect outbox는 Rehearse-Commit transaction을 재사용한다.
- arbitrary site와 generic browser snapshot을 범위 밖에 둔다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | source contract audit | FrameSpace sandbox, Machine generation, transaction 계획 대조 | probe 미실행 | 협력 app의 logical state protocol만 현실적인 transaction 경로 | Initiative 5 졸업 뒤 app contract fixture |

## 판정

후행 대기 중. Initiative 5 졸업 전에는 probe를 실행하지 않는다.
