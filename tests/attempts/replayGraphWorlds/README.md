# Initiative 7: replayGraphWorlds - recorded state graph에서 여러 선택을 effect 없이 탐색할 수 있는가

## 가설

verified state node와 exact action edge를 content-addressed graph로 만들면 linear ReplaySpace의 안전성을
유지하면서 이미 기록되거나 transactional하게 생성된 여러 업무 경로를 live effect 없이 탐색하고 평가할
수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-7---replaygraph-worlds),
실행 계획은 [Initiative 7](../../../mainPlan/7-replayGraphWorlds/README.md)이다.

## 선행 조건

Initiative 6이 졸업해 exact source state를 restore한 뒤 안전하게 branch edge를 만들 수 있어야 한다.

## 졸업 게이트

1. recording import의 operation, terminal, artifact, digest 손실은 0이다.
2. graph traversal의 live provider request와 effect는 0이다.
3. missing edge의 search-ahead와 generated terminal은 0이다.
4. URL 또는 screenshot만으로 node merge한 횟수 0이다.
5. source restore와 provenance 없는 edge 생성은 0이다.
6. coverage gap을 caller failure로 판정한 횟수 0이다.
7. graph mutation과 missing object를 모두 거부한다.
8. synthetic, cooperative, live provenance 혼합은 0이다.
9. model output이 deterministic evaluation을 바꾼 횟수 0이다.
10. installed client별 graph root, cursor, verdict digest 차이는 0이다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `linearImportProbe.mjs` | recording을 보존하는가 | state invent 0 |
| `branchTraversalProbe.mjs` | exact edge를 effect 없이 걷는가 | provider call 0 |
| `missingEdgeProbe.mjs` | 없는 선택을 거부하는가 | generated terminal 0 |
| `nodeIdentityProbe.mjs` | state와 policy를 구분하는가 | visual merge 0 |
| `transactionalBranchProbe.html` | restored app branch를 기록하는가 | source 없는 edge 0 |
| `coverageProbe.mjs` | unexplored를 정직하게 말하는가 | caller 오판 0 |
| `integrityProbe.mjs` | mutation을 막는가 | broken endpoint 거부 |
| `evaluationProbe.mjs` | oracle가 deterministic한가 | model text 영향 0 |
| `retentionProbe.mjs` | reachable object를 보존하는가 | pinned run 삭제 0 |

## 모듈화 설계 후보

- node와 edge는 immutable content-addressed objects다.
- linear recording importer는 없는 state를 만들지 않는다.
- traversal은 current node의 exact input edge만 허용한다.
- live graph 확장은 별도 authorized adapter다.
- World evaluator는 deterministic goal과 forbidden predicates를 소유한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | source contract audit | ReplaySpace linear cursor, APX, AppSpace 계획 대조 | probe 미실행 | 가상 인터넷이 아니라 verified transition graph 가설로 제한 | Initiative 6 졸업 뒤 linear import |

## 판정

후행 대기 중. Initiative 6 졸업 전에는 probe를 실행하지 않는다.
