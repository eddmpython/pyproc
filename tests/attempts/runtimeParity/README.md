# runtimeParity - 런타임을 로컬 파이썬급으로 (개념 캠페인 하나 = 카테고리 하나)

로컬 parity 발명([mainPlan/local-parity](../../../mainPlan/local-parity/README.md))의 실측 레인. 세부 질문은 **폴더가 아니라 probe 파일로** 늘린다. 이 캠페인이 끝날 때까지 이 폴더 하나에서 운영한다.

## 가설

수명주기(행/죽음 수렴), 복원 soundness, 시스템콜(입력/HTTP/서브프로세스), 터미널까지 갖추면 브라우저 런타임이 로컬 파이썬과 체감 구분이 없어진다. 각 축은 브라우저 실측으로만 판정한다.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 행/죽음에서 유한 수렴 가능한가 | [lifecycleProbe.html](lifecycleProbe.html) | 행 결함 재현 + respawn < 1s + 복구 풀 정상 -> `taskTimeoutMs`/`kill` 승격 |
| 64비트급 해시가 여전히 싼가 | [soundnessProbe.html](soundnessProbe.html) | 이중 해시 비용 <= 단일의 2.2배, 절대치 <= 150ms -> 이중 해시 승격 |
| 시스템콜을 실제로 빌릴 수 있나 | [syscallProbe.html](syscallProbe.html) | 동기 input + urllib 실 GET 필수 PASS -> v1 승격. JSPI/subprocess는 능력 보고 |
| 탭이 진짜 터미널이 되나 | [terminalProbe.html](terminalProbe.html) | REPL 시맨틱 + REPL 안 `input()` 블로킹 재개 -> Terminal 능력 계약으로 승격 |

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-11 | lifecycleProbe | Edge headless | 행 시 map 무한 대기 재현. respawn 302ms. 복구 풀 정상 | 타임아웃 + kill/respawn이 수렴 수단 | 졸업 -> `pyProc.js` (`taskTimeoutMs`/`kill`/`_replace`), 게이트 검사 3종 상시화 |
| 2026-07-11 | soundnessProbe | Edge headless | 30MB 힙: 단일 9.3ms vs 이중 14.3ms(1.54x). 1바이트 변경 감지 | 대역폭 지배 가설 입증 | 졸업 -> `memoryCapability.js`+`reactive.js` 이중 해시(~2^-64) |
| 2026-07-11 | syscallProbe(+임시 diag) | Edge headless | v314엔 `callSyncifying` 없음 -> `pyodide.ffi.run_sync`+`can_run_sync()` 확정. 동기 input PASS, urllib 실 GET(200) PASS, JSPI input 동작, subprocess 2007ms | 3종 전부 실동작 | 졸업 -> `syscallBridge.js` v1. 저수준 socket·requests는 이 캠페인 잔여 |
| 2026-07-11 | terminalProbe | Edge headless | 식 평가 4, 다중행+상태 유지 70, REPL 안 input() 블로킹 재개 24ms | 탭 = 터미널 개념 성립 | 진행 중: `Terminal` 능력 계약 + examples + 게이트 검사로 승격 |

## 판정

진행 중 (수명주기·soundness·시스템콜 v1 졸업 / 터미널 승격, 라이브러리 커버리지, 협조적 취소, requests·socket 잔여)
