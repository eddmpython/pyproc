# terminal - 브라우저 탭이 진짜 파이썬 터미널이 될 수 있나 (로컬 parity 발명 1호)

## 가설

`code.InteractiveConsole`(정식 CPython REPL 기계) + syscallBridge의 JSPI 블로킹 `input()` + stdout 캡처를 합치면, 서버 없이 브라우저 탭 안에서 "로컬 파이썬 터미널과 구분 불가능한" 세션이 된다. 셸이 별도 발명이 아니라 파이썬 그 자체가 셸이다.

## 졸업 게이트

1. REPL 시맨틱: 식 평가(`2+2` -> `4`), 다중행 정의(continuation), 상태 유지(변수 지속)가 실측 PASS.
2. 블로킹 input: REPL 라인 실행 중 `input()`이 JS 비동기 소스(사용자 타이핑 등가)에서 값을 받아 재개.
3. 승격 형태: `Terminal` 능력(계약: `push(line) -> {more, out}`)으로 src/capabilities 배치 + examples 터미널 페이지 + 게이트 검사.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-11 | probe.html | Edge headless | 식 평가 4, 다중행 정의 + 상태 유지 70, REPL 안 `input()` 블로킹 -> "hi kim" 재개(24ms) | 게이트 1·2 입증. 탭 = 터미널 개념 성립 | 게이트 3: Terminal 능력 계약 설계 + examples 페이지 + 승격 |

## 판정

진행 중 (게이트 1·2 통과, 3 남음: 승격 형태. `push(line) -> {more, out}` 계약으로 src/capabilities 배치 예정)
