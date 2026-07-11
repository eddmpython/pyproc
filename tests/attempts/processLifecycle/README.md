# processLifecycle - 프로세스 OS가 죽음·행(hang)에서 유한 시간 안에 수렴할 수 있나

## 가설

워커의 죽음/행은 이벤트로 감지할 수 없고(Worker `terminate`/`self.close()`는 error 이벤트를 내지 않으며, 행은 아무 신호도 없다), 커널 주도 타임아웃 + 스냅샷 respawn이 유일하게 건전한 수렴 수단이다. respawn은 스냅샷-fork 덕에 수백 ms라 실용적이다.

## 졸업 게이트

1. 결함 재현: 행 태스크에서 `map()`이 무한 pending임을 실측으로 확인.
2. respawn 실측: 죽은 워커를 기존 스냅샷에서 1초 미만에 재생성, 재생성 풀에서 map 정상.
3. 승격 형태: `map(fnSrc, args, { taskTimeoutMs })`(타임아웃 시 해당 태스크 `{error}`, 행 워커 kill + 자동 respawn, 나머지 태스크 계속) + `kill(pid)`. 승격 후 브라우저 게이트에 수렴 검사 추가, GREEN.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-11 | probe.html | Edge headless | 행 시 map 무한 대기 재현. respawn 302ms(<1s). 복구 풀 map 정상 | 가설 입증: 타임아웃 + kill/respawn이 수렴 수단 | src 승격 |
| 2026-07-11 | tests/browser/gate.html | Edge headless | 승격 후 행 수렴 1786ms(타임아웃 1500 + respawn), 자동 복구·kill dead 전이 확인, 게이트 13/13 GREEN | 승격 완료 | 협조적 취소(SIGINT, setInterruptBuffer)는 별도 카테고리 후보 |

## 판정

졸업 -> `src/processOs/pyProc.js`: `map(fnSrc, args, { taskTimeoutMs })` + `kill(pid)` + `_spawn`/`_replace`(스냅샷 respawn). 브라우저 게이트가 상시 검증.
