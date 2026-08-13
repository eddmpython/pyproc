# Initiative 4: executionMemoryRegistry - 대화가 아니라 실행 상태를 durable session으로 이어받을 수 있는가

## 가설

Machine generation, branch, environment, SituationCapsule, replay cursor, Evidence Pack을 immutable revision과
CAS HEAD로 연결하면 호출자가 바뀌어도 검증된 safe point에서 작업을 계속할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-4---execution-memory-registry),
실행 계획은 [Initiative 4](../../../mainPlan/4-executionMemoryRegistry/README.md)다.

## 선행 조건

Initiative 3가 졸업해 session의 suspended state가 실제 cold Machine과 연결되어야 한다.

## 졸업 게이트

1. stale writer session HEAD overwrite 0이다.
2. published revision의 모든 content reference가 존재하고 digest가 일치한다.
3. missing reference를 completed 또는 suspended로 publish한 횟수 0이다.
4. caller text만으로 completed가 된 횟수 0이다.
5. isolated context handoff가 exact generation과 replay boundary를 복구한다.
6. signature만으로 permission grant 0이다.
7. proxy와 external browser state를 portable하다고 표시한 횟수 0이다.
8. secret 원문 registry와 handoff 유출 0이다.
9. retention의 reachable object 삭제 0이다.
10. client별 revision digest와 lifecycle 차이 0이다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `sessionRevisionProbe.mjs` | immutable CAS chain인가 | stale overwrite 0 |
| `machineLinkProbe.html` | generation과 session이 정합하는가 | missing generation publish 0 |
| `situationLinkProbe.mjs` | world epoch와 cursor가 맞는가 | forged cursor 거부 |
| `completionTruthProbe.mjs` | Evidence Pack이 completion을 소유하는가 | caller declaration 무시 |
| `coldHandoffProbe.html` | isolated handoff가 가능한가 | mismatch와 untrusted import 거부 |
| `permissionBoundaryProbe.html` | trust와 permission이 분리되는가 | signer grant 0 |
| `retentionProbe.mjs` | reachability가 안전한가 | live state 삭제 0 |
| `redactionProbe.mjs` | secret이 빠지는가 | 원문 0 |

## 모듈화 설계 후보

- immutable session revision과 mutable HEAD를 분리한다.
- 기존 state objects를 digest로 참조하고 byte를 복제하지 않는다.
- completion은 verified evidence만 소비한다.
- handoff는 trust와 permission을 별도 단계로 둔다.
- model과 editor identity는 core 바깥 annotation이다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | source contract audit | generation, branch, recording, Evidence Pack 계획 대조 | probe 미실행 | 실행 상태 사이의 durable index가 실제 간극 | Initiative 3 졸업 뒤 revision prototype |

## 판정

진행 중. Initiative 3의 cold Machine과 exact generation 계약이 졸업했으므로 immutable revision,
reference verification, CAS HEAD의 최소 반증 커널부터 실행한다.
