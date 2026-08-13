# Initiative 0: machineEntrance - exact package에서 첫 유용한 결과까지 조립 없이 도달할 수 있는가

## 가설

기존 bin 안의 strict recipe compiler, initializer, actionable preflight, client 공통 golden journey를
제공하면 새 소비자가 deep import, 수작업 protocol 조립, permission 추측 없이 Python 결과와 선택적인
browser evidence까지 도달할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-0---machine-entrance),
실행 계획은 [Initiative 0](../../../mainPlan/0-machineEntrance/README.md)이다.

## 졸업 게이트

1. clean directory와 packed exact package만으로 Python, observation, verified action journey를 완주한다.
2. Python-only profile의 browser process, CDP endpoint, browser operation은 0이다.
3. broad origin, unknown action, excessive risk, relative file root는 launch 전에 거부된다.
4. JavaScript, Python, MCP의 terminal, error code, attachment digest가 같다.
5. public example의 package-internal import는 0이다.
6. failure, cancel, disconnect, shutdown 뒤 owned process, profile, lock, artifact 잔여는 0이다.
7. initializer는 existing file을 explicit overwrite 없이 바꾸지 않고 repository command를 실행하지 않는다.
8. Chrome과 Edge installed journey가 같은 문서 입력으로 PASS한다.

## 실행 probe

| probe | 질문 | 음성 시험 |
|---|---|---|
| `cleanInstallJourney.mjs` | source checkout 없이 첫 결과에 도달하는가 | deep import 0 |
| `recipeCompilerProbe.mjs` | recipe가 완전한 strict manifest인가 | unknown field와 broad origin 거부 |
| `pythonOnlyBoundaryProbe.mjs` | browser authority가 기본 닫힘인가 | browser launch 0 |
| `preflightDiagnosticProbe.mjs` | 실패가 안전한 다음 동작을 주는가 | effect 전 request 0 |
| `clientParityProbe.mjs` | 세 client가 같은 의미를 받는가 | outcome 손실 0 |
| `cleanupProbe.mjs` | owned resource를 모두 회수하는가 | 잔여 0 |

## 모듈화 설계 후보

- recipe compiler는 완전한 manifest만 출력한다.
- initializer는 path와 file lifecycle만 소유한다.
- doctor는 read-only environment fact와 actionable result만 반환한다.
- client examples는 public surface만 소비한다.
- existing Control과 MCP validator가 최종 authority를 소유한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | 기획과 gate 설계 | package bin, Control, MCP, SDK, installed gate 대조 | probe 미실행 | 새 identity가 아니라 existing entrance를 하나의 lifecycle로 닫는 문제로 고정 | clean install 기준선 |
| 2026-08-13 | recipe compiler | strict validator 대조 | 4 recipe와 broad-origin, unknown-field, authority-leak 음성 fixture PASS | recipe를 권한 shortcut이 아닌 완전한 manifest compiler로 확정 | initializer |
| 2026-08-13 | clean initializer와 doctor | packed npm, project-local output, full engine digest | package gate와 3 probe PASS | overwrite, path escape, secret, arbitrary shell, effectful preflight를 차단 | installed clients |
| 2026-08-13 | client parity | JavaScript, Python wheel, MCP adapter | Control 17항목, MCP 13항목, Python 5항목 PASS | success와 오류 terminal, outcome, attachment digest가 세 client에서 보존됨 | cleanup과 졸업 |
| 2026-08-13 | cleanup | 실제 Edge owned profile과 installed product shutdown | profile 잔여 0, artifact 명시 삭제, product temp root 삭제 PASS | transient owned resource lifecycle이 닫힘 | 정식 문서와 plan 삭제 |

## 판정

졸업 가능. recipe는 이름만으로 권한을 열지 않고 완전히 펼친 manifest를 기존 strict validator에
전달한다. packed package의 Python-only, observeLocal, authorized browser 흐름과 JavaScript, Python, MCP
terminal parity가 실제 Edge에서 통과했고, Chrome과 Edge CI가 같은 installed gate를 실행한다.
