# core-surface-hardening - 핵 메커니즘의 soundness와 표면 압축

상태: 활성 (2026-07-16 개설)

pyproc의 핵을 "결정적 리플레이 경계(cp0) + 페이지 해시 델타" 하나로 규명하고,
그 핵의 soundness 구멍을 수리한 뒤, 공개 표면을 핵 중심으로 압축한다.
목표는 "우아하고 정말 잘 만든 라이브러리"라는 평가가 실물에서 성립하는 상태다.

## 배경

7개 영역 정밀 독해와 3개 관점 설계, 설계별 반박 검증(판정 sound 42 / flawed 10 / infeasible 1)을
거쳐 다음이 확정됐다:

1. Session 부활, forkLive, MachineJournal WAL, KernelElection failover, .pymachine 이미지가
   전부 같은 전제(같은 매니페스트 = 바이트 동일 힙 경계)를 공유한다. 이것이 핵이다.
2. 핵 자체에 soundness 구멍이 있다(다중 컨트롤러 오염, restore의 경계 미기록, 체크포인트
   나무 무한 축적).
3. 오류 채널이 4종으로 파편화되어 소비자가 프로그램적 분기를 계약으로 할 수 없다.
4. 진입점 10개 / 핸들 7종 / 게이트 없는 루트 export가 표면 밀도를 희석한다.
5. 영문 API 레퍼런스, CHANGELOG, SECURITY 문서가 없다.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 핵 규명, 성공/실패 기준, 기각된 대안.
2. [01-architecture.md](01-architecture.md) - 오류 계약, 리액티브 soundness, heapDelta,
   processOs 수리, 표면 압축의 설계와 근거.
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - phase 분해, 영향 파일, 게이트, 롤백.
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장과 NEXT.

## 완료 조건

1. src 전체 throw가 PyProcError(code, retryable) 하나로 수렴하고 기계 게이트가 재발을 차단한다.
2. 한 Runtime에 ReactiveController가 하나만 존재하고, restore가 실행 경계에 기록되며,
   체크포인트 나무에 pruneTo/dispose 배출 밸브가 있다.
3. 경계+델타 알고리즘이 heapDelta 한 모듈의 이름 있는 전략 2개로 수렴한다.
4. MachineContainer 사망/중첩, JobControl 강제 회수, map 부분 실패가 명시 계약이 된다.
5. 루트 export가 게이트된 핵 표면으로 압축되고(GPU/Socket/WASI subpath 강등, SharedKernel
   삭제, 별칭 절삭), README 첫 예제가 핵(체크포인트-실패-복원)을 보여준다.
6. 영문 API 레퍼런스/CHANGELOG/SECURITY/용어집이 존재하고 게이트가 표류를 차단한다.
7. npm test, test:package, test:browser, test:examples, test:web-computer 전부 GREEN.
