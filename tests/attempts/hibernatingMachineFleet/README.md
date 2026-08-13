# Initiative 3: hibernatingMachineFleet - inactive Machine의 실행 자원을 끝내고 generation만 남길 수 있는가

## 가설

portable worker-hosted guest, fenced generation commit, explicit shutdown, owner lease, hot budget을 결합하면
여러 Machine을 등록하면서 정해진 수만 실행 heap을 유지하고 나머지를 cold generation으로 복구할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-3---hibernating-machine-fleet),
실행 계획은 [Initiative 3](../../../mainPlan/3-hibernatingMachineFleet/README.md)다.

## 선행 조건

Initiative 0, 1, 2가 모두 졸업해야 한다. 이 캠페인은 pause나 `saveBase()`를 hibernation으로 인정하지
않고 worker termination과 cold recovery를 직접 측정한다.

## 졸업 게이트

1. hot limit N에서 live execution owner 수는 N 이하이다.
2. cold Machine의 live Worker, runtime, device lease, timer는 0이다.
3. commit 실패 뒤 shutdown과 unresolved effect 자동 suspend는 0이다.
4. exact generation, environment, home, outcome이 새 Worker에서 복구된다.
5. stale lease mutation, double wake, double owner는 0이다.
6. crash와 cancellation 경계에서 torn generation을 cold success로 판정하지 않는다.
7. cleanup 실패는 incomplete이며 cold success가 아니다.
8. Chrome과 Edge installed package에서 반복 suspend와 resume가 PASS한다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `workerReclaimProbe.html` | live heap owner가 실제 종료되는가 | paused runtime을 cold로 판정 0 |
| `suspendCommitProbe.html` | commit 다음 stop 순서인가 | failed commit 뒤 stop 0 |
| `coldResumeProbe.html` | 새 Worker에서 exact state가 복구되는가 | environment mismatch 거부 |
| `hotLimitProbe.html` | safe candidate만 동면시키는가 | active effect suspend 0 |
| `leaseFenceProbe.html` | owner epoch가 lifecycle을 막는가 | stale lifecycle mutation 0 |
| `crashRecoveryProbe.html` | 모든 경계가 정직한 terminal인가 | torn state success 0 |
| `resourceCleanupProbe.html` | owned resource를 회수하는가 | 잔여 0 |

## 모듈화 설계 후보

- fleet은 Machine 위의 lifecycle coordinator다.
- generation과 recovery는 기존 state kernel이 소유한다.
- worker-hosted guest가 reclaim 가능한 execution owner를 제공한다.
- hot budget은 safe candidate policy와 분리한다.
- memory 수치는 보조 evidence이며 worker ownership이 주 gate다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | source contract audit | root open, worker guest, Durable Web Computer, state kernel | probe 미실행 | explicit worker termination과 fleet lease가 실제 간극 | Initiative 2 졸업 뒤 worker reclaim baseline |
| 2026-08-13 | `fleetPrototype.mjs`, `run.mjs` | Node 24, deterministic injected runtime owner | 16 checks PASS, hot 1/1, commit failure stop 0, unsafe eviction 0, stale lease mutation 0, cleanup failure cold 판정 0 | state, lease, admission, commit-verify-stop 순서가 최소 커널에서 성립 | 실제 Durable Web Computer와 Worker에 결합 |
| 2026-08-13 | `tests/contracts/machineFleet.mjs` | real durable coordinator, MemoryMachineStore, portable guest | contract suites 21개 green, commit failure shutdown 0, runtime와 owner cleanup retry green | 제품 coordinator가 safe terminal, lease, exact HEAD, environment fence를 지킨다 | 실제 Worker와 process restart 반증 |
| 2026-08-13 | `machineFleetProbe.html` | Edge, IndexedDB, Web Locks, real Pyodide Worker, browser process 2회 | 10/10 PASS, hot 1/1, cold owner 0, owner epoch 2에서 3으로 증가 | 새 browser process와 새 Worker가 heap과 `/home/web`을 exact HEAD에서 복구 | Chrome 교차 확인 |
| 2026-08-13 | `machineFleetProbe.html` | Chrome, IndexedDB, Web Locks, real Pyodide Worker, browser process 2회 | 10/10 PASS, cold owner 0, stale lease mutation 0, unresolved effect suspend 0 | Chromium 두 제품에서 같은 hibernation terminal 성립 | packed package 확인 |
| 2026-08-13 | `test:installed` | packed npm artifact, Edge | 38/38 PASS, installed Fleet commit, terminate, cold resume PASS | deep import 없이 `pyproc/machine` 공개 표면으로 조립된다 | 본진과 문서 졸업 |
| 2026-08-13 | `test:installed` | packed npm artifact, Chrome | 38/38 PASS, installed Fleet commit, terminate, cold resume PASS | 두 지원 브라우저의 exact-package 소비 경로가 정합하다 | 본진과 문서 졸업 |

## 판정

졸업 조건을 충족했다. 최소 반증 커널의 순서를 Durable Web Computer와 실제 Worker owner에 결합했고,
Node 계약, Edge와 Chrome의 실제 browser-process restart, packed npm 소비자 게이트가 모두 green이다.
지속 계약은 `docs/specs/machineFleet/`와 `docs/usage/machineFleet.md`로 승격했으며 이 attempt는
Initiative 3 완료 커밋에서 계획 폴더와 함께 삭제한다.
