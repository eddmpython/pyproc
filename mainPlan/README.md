# mainPlan 운영 규칙

`mainPlan/`은 아직 끝나지 않은 제품 이니셔티브만 두는 임시 실행 계획 공간이다. 현재 제품 계약은
`docs/`와 코드가 소유하고, 완료 이력은 Git이 소유한다.

## 실행 규칙

1. 착수할 때 이니셔티브 하나를 큰 작업 카테고리로 고정한다. 내부 구현은 작은 논리 단위로 검증하고
   커밋하되, 그 이니셔티브의 구현과 종료 조건을 모두 끝내기 전에는 다른 이니셔티브로 이동하지 않는다.
2. 저장소 수정, 브라우저 실측, 테스트, probe, 허용된 도구와 공개 API 등 자력으로 수행할 수 있는 모든
   경로를 구체적인 구현 작업과 종료 조건으로 싣고 실제로 소진한다. 남은 자력 경로를 외부 의존,
   운영자 작업, 후속 과제, 차단 상태로 밀어내지 않는다.
3. 모든 자력 경로를 소진한 뒤에도 새 권한, 새 자격증명, 제3자 승인, 시간 경과가 반드시 필요할 때만
   외부 조건으로 기록한다. 독립 수행 가능한 나머지 구현은 계속 끝낸다.
4. 구현, 정식 테스트, 현재 `docs/` 계약이 끝난 이니셔티브는 관련 커밋과 잔여를 확인한 같은 사이클에
   폴더째 삭제한다. 완료 상태, 회고, `_done` 보관 폴더를 남기지 않는다.

## 현재 상태

현재 직렬 실행 순서는 다음과 같다.

2. [Verified Change Loop](2-verifiedChangeLoop/README.md): 착수
3. [Hibernating Machine Fleet](3-hibernatingMachineFleet/README.md): Initiative 2 후행 대기
4. [Execution Memory Registry](4-executionMemoryRegistry/README.md): Initiative 3 후행 대기
5. [Rehearse-Commit Transactions](5-rehearseCommitTransactions/README.md): Initiative 4 후행 대기
6. [Transactional AppSpace](6-transactionalAppSpace/README.md): Initiative 5 후행 대기
7. [ReplayGraph Worlds](7-replayGraphWorlds/README.md): Initiative 6 후행 대기
8. [Proof-Carrying Motor](8-proofCarryingMotor/README.md): Initiative 7 후행 대기

Initiative 2부터 진행한다. 여러 계획 폴더는 직렬 실행 대기열이며, 각 이니셔티브의 구현, browser gate,
정식 문서, attempt와 계획 삭제가 모두 끝난 뒤에만 다음 번호로 이동한다. 둘 이상을 동시에 구현하지
않는다.

이 번호는 agent-computer 포트폴리오의 실행 순서다. North Star ceiling ladder의 기존 번호와 우선순위를
대체하지 않는다.
