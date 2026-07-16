# 03. 진행 원장

## 2026-07-16 - 이니셔티브 개설

확인한 현재 상태:

1. 7개 영역 정밀 독해 + 3개 관점 설계 + 반박 검증(판정 sound 42 / flawed 10 / infeasible 1)
   완료. 핵 = "결정적 리플레이 경계(cp0) + 페이지 해시 델타" 단일 메커니즘으로 확정.
2. 루트 export 41개, 진입점 10개, 핸들 7종 실측. 오류 채널 4종 파편화(PYPROC_* 코드는
   kernelElection/machineJournal에만, 나머지 21파일 150여 throw는 plain Error).
3. soundness 구멍 실측: enableReactive 호출마다 새 컨트롤러(runtimeBindings.js:21),
   restore가 execSeq 미기록(reactive.js), 체크포인트 나무 해제 API 전무,
   워커 오류 경계 납작화(worker.js:168), 저널 커밋 실패 삼킴(machineJournal.js:118).
4. 트랙 A(web-machine-hardening)는 게이트 전수 GREEN 확인(구조 907, browser core,
   webMachine probes 13종, Web Computer 3-process E2E, consumer/package).
   deviceBackedDualBootProbe의 첫 실패는 240s 타임아웃 플레이크(재실행 12/12 GREEN,
   processColdRestoreMs 2849).

결정:

1. Machine 단일 핸들 통합과 Session 개명은 기각한다(00 문서의 기각 목록 참조.
   fork의 워커 대칭 벽, web-machine 어휘 충돌이 근거).
2. 오류 계약은 PyProcError 하나로 수렴하고, 구조 게이트로 `throw new Error`의 재발을
   차단한다. 기존 PYPROC_* 코드 문자열은 전부 보존한다.
3. 컨트롤러는 Runtime당 1개 memoize, restore는 noteStateMutation()으로 경계에 기록한다.
   저널 유휴 커밋과의 상호작용은 게이트로 고정한다.
4. heapDelta는 전략 2개(hashDiffPages/byteDiffPages)의 이름 있는 보관소다. WASI 체크포인트
   내부는 이번 범위 밖(research preview).
5. rpcChannel 공통화는 Worker 3소비자(pyProc, machineContainer, machineWorker)만.
   kernelElection의 outcome-unknown 의미론은 건드리지 않는다.
6. 표면 압축: SharedKernel 삭제, GPU/Socket/WASI subpath 강등, mapSerial/interrupt/
   timeTravel 절삭, README 얼굴 교체. bootSession/openMachine/openPersistentMachine
   3문은 유지하고 결정 트리 문서로 선택 기준을 고정한다.
7. 릴리즈는 하지 않는다. 브레이킹은 CHANGELOG Unreleased에 누적하고 버전/태그는 불변.
8. saveBase의 RAM 오프로드 주장은 미이행이므로 주석을 정정하고 contractReality에
   기록한다. 진짜 배출 밸브는 pruneTo/dispose다.

기각:

- 게이트 0을 근거로 한 WASI 강등(ci.yml에 wasiGate 실재. 강등 근거는 research preview
  지위만 유효).
- mapSerial 즉시 삭제(소비 4곳 재배선이 같은 커밋에 있어야 함).
- "닫는 checkpoint" 의식의 전면 제거(모든 복원의 O(heap) 재해시 승격 = 항구 열화).
- bootEnv의 openMachine 흡수(stubEntropy 없는 레인 = cp0 결정성 비호환).

NEXT:

1. Phase 0a(오류 계약)부터 착수. errors.js 신설 -> src 전체 throw 전환 -> 워커 경계 ->
   구조 게이트.
2. 각 phase 완료 시 이 원장에 기록.

현재 구현 상태: 설계 완료, 코드 미착수.
