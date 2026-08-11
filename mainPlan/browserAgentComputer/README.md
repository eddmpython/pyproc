# Browser Agent Computer 제품화

## 북극성

pyproc은 브라우저를 대신 클릭하는 도구가 아니라 **복구 가능하고 감사 가능한 에이전트 컴퓨터**다.
Python의 지속 상태와 Chromium의 외부 효과를 한 작업 흐름에서 다루되, 되돌릴 수 있는 상태와
되돌릴 수 없는 효과의 경계를 숨기지 않는다. 에이전트는 의미 기반으로 페이지를 관측하고 안정적으로
행동하며, 실패한 이유와 이미 발생한 효과를 하나의 제한된 trace로 설명할 수 있어야 한다.

제품 문장:

> Persistent Python state, reliable browser actions, explicit external effects, and one inspectable trace.

## 제품 경계

- repository MCP의 opt-in capability다. npm root export나 Experimental subpath를 늘리지 않는다.
- broker가 만든 임시 Chrome 또는 Edge profile만 제어한다. 사용자의 기본 profile에는 붙지 않는다.
- CDP endpoint, raw target ID, backend DOM node ID는 broker 밖으로 내보내지 않는다.
- CAPTCHA 우회, stealth, fingerprint 회피, credential 수집은 제품 범위 밖이다.
- Python restore는 browser effect를 되돌렸다고 주장하지 않는다. trace가 그 경계를 보존한다.
- Chromium과 Edge가 지원 범위다. Firefox와 Safari parity는 종료 조건이 아니다.

## 착수 전 게이트

### 이미 있는 것

- `browserControlPort.js`: opaque target/session, origin 재검증, outcome 분류, event fencing
- `browserControlPolicy.js`: origin, CDP method, event, risk 권한의 SSOT
- `browserAutomationCatalog.js`: 고수준 action, schema, risk, required method의 SSOT
- `browserAutomation.js`: accessibility snapshot, locator epoch, bounded action pipeline
- `mcpBrowserControl.js`: opt-in MCP 도구, 환경 설정, 감사 기록
- `tests/contracts/browserAutomation.mjs`: schema, risk, locator, partial completion 계약
- `tests/browser/browserControl.mjs`: Chrome과 Edge 실브라우저 MCP 통합 게이트

### 바꿀 심볼의 참조처

- action catalog는 MCP schema, config allowlist, inspect 출력, automation dispatch가 함께 소비한다.
- `BrowserAutomation` 결과는 MCP text payload와 browser E2E가 소비한다.
- `BrowserControlPolicy` method risk는 raw command와 내부 action method를 함께 판정한다.
- `NodeCdpTransport`의 Page event는 origin 권한과 locator epoch를 함께 무효화한다.
- `mcpSandboxServer.mjs`의 기본 도구 4개는 browser capability가 꺼지면 절대 변하지 않아야 한다.

### 깨질 수 있는 것

- action 재시도가 외부 효과를 중복 실행하거나 `outcomeUnknown`을 안전한 실패로 오인할 수 있다.
- navigation lifecycle 대기가 event를 놓치면 영구 대기 또는 거짓 완료가 생길 수 있다.
- frame과 Shadow DOM 지원이 raw DOM 식별자를 노출하거나 origin 경계를 우회할 수 있다.
- screenshot, console, network가 credential이나 과도한 body를 trace에 담을 수 있다.
- popup, dialog, download가 권한 밖 origin이나 filesystem 효과를 만들 수 있다.
- artifact가 무제한으로 자라 MCP payload와 장기 프로세스 메모리를 압박할 수 있다.

## 목표 구조

```text
scripts/browserControl/
  browserAutomationCatalog.js   action, locator, artifact schema와 고정 risk
  browserControlPolicy.js       origin, method, event, destination 권한
  browserLocator.js             semantic locator 정규화와 document 재탐색
  browserActionability.js       visible, stable, enabled, editable, hit-target 판정
  browserObservation.js         AX, DOM 요약, screenshot, console, network 수집
  browserTrace.js               bounded step, event, artifact, effect 원장
  browserAutomation.js          action orchestration과 외부 효과 경계
  browserControlPort.js         transport 독립 session/outcome/fencing
  nodeCdpTransport.js           CDP adapter
  mcpBrowserControl.js          MCP adapter와 audit
```

같은 사실을 여러 목록으로 복제하지 않는다. action 정의에서 schema, risk, required method,
inspect metadata가 파생되고, artifact 정의에서 quota와 redaction이 파생되어야 한다.

## 실행 단계와 종료 증거

### 1. 실측과 계약 확정

- `tests/attempts/browserAgentComputer/`에서 animation, overlay, delayed attach, disabled control,
  same-origin navigation, iframe, Shadow DOM, popup, dialog, download를 실브라우저로 재현한다.
- CDP만으로 actionability와 semantic re-resolution이 가능한지 Chrome과 Edge에서 확인한다.
- screenshot, console, network의 최소 CDP domain과 redaction 지점을 확인한다.
- 실측 결과와 구현하지 못한 경계는 `contractReality.md`에 먼저 남긴다.

종료: probe 결론 표의 각 행이 pass/fail로 판정되고 구현 계약과 폴더 소유권이 확정된다.

### 2. 신뢰성 엔진

- locator를 `css`, `role`, `text`, `label`, `testId`의 tagged union으로 만든다.
- opaque locator는 session, target, context epoch에 귀속하고 action 직전에 다시 찾는다.
- frame은 명시적인 frame locator chain으로만 건너가며 각 document origin을 재검증한다.
- open Shadow DOM은 semantic 탐색에 포함하고 closed shadow root는 명시적 미지원으로 판정한다.
- click은 unique, visible, stable, enabled, hit-target를 만족한 뒤 한 번만 effect를 보낸다.
- fill은 unique, visible, enabled, editable을 만족하고 input/change event 결과를 검증한다.
- actionability 재시도는 effect 전 판독만 반복한다. effect 전송 뒤에는 자동 재실행하지 않는다.
- navigate와 페이지 전환은 명시된 wait state와 timeout을 가진다.

종료: 경쟁 기준 fixture가 Chrome과 Edge에서 반복 실행되어 flake 없이 통과하고,
pre-send retry와 post-send no-retry가 음성 시험으로 증명된다.

### 3. 관측성과 trace

- compact semantic snapshot에 frame과 locator provenance를 포함한다.
- screenshot은 크기 상한과 MIME을 가진 bounded artifact로 제공한다.
- console은 수준, timestamp, 축약된 인자만 수집하고 execution object ID를 노출하지 않는다.
- network는 method, redacted URL, resource type, status, timing만 기본 수집한다.
- authorization, cookie, body, query secret은 기본 trace에 싣지 않는다.
- 각 action은 precondition, command request ID, outcome, context epoch, duration, artifact ref를 남긴다.
- 실패는 completed prefix, failed index, failure artifact를 같은 trace에서 반환한다.

종료: 성공, protocol rejection, timeout, cancellation, browser death 모두 bounded trace로 설명되고
민감 정보 fixture가 redaction gate를 통과한다.

### 4. 제품 자동화 범위

- hover, check, uncheck, focus, drag, viewport scroll을 action catalog에 추가한다.
- frame과 popup은 opaque target/frame ref로만 선택한다.
- dialog는 명시적 accept/dismiss action 없이는 자동 처리하지 않는다.
- upload는 operator가 허용한 절대 경로 안의 파일만 가능하게 한다.
- download는 metadata와 제어된 임시 경로를 반환하고 overwrite를 금지한다.
- cookie와 storage는 별도 고위험 action과 destination guard 아래 둔다.
- 새 창과 redirect의 최종 origin을 다시 권한 검사한다.

종료: 각 효과가 allowlist, expectedRisk, audit, outcome, destination guard를 통과하며 권한 밖
fixture가 전송 전에 실패한다.

### 5. 제품화와 운영

- MCP tool 설명과 schema를 catalog에서 파생하고 기본 4도구 계약을 보존한다.
- 환경 변수 파싱은 fail-closed이며 잘못된 조합을 시작 시점에 거부한다.
- protocol version과 trace schema version을 고정하고 호환성 검사를 둔다.
- Chrome과 Edge의 지원 버전 및 CDP mismatch 진단을 문서화한다.
- 설치, authorized-use, troubleshooting, observability, checkpoint law 예제를 완성한다.
- public package에는 repository-only broker가 우연히 포함되거나 export되지 않음을 gate로 증명한다.

종료: 새 환경에서 문서 절차만으로 opt-in 서버를 시작하고 fixture workflow를 완료할 수 있다.

### 6. 출시 품질 게이트

- contract, MCP default, Chrome, Edge, package, type, docs, public surface를 모두 실행한다.
- actionability fixture를 반복 실행하고 장기 session의 listener, locator, trace 정리를 검사한다.
- 신설 gate마다 의도적 위반을 주입해 RED를 확인한 뒤 복원한다.
- 전체 `npm test`와 영향받은 모든 browser gate가 green이어야 한다.
- 코드, 문서, schema, tests가 같은 action 및 artifact 계약을 가리키는지 역방향 감사한다.

종료: 아래 완료 행렬의 증거가 모두 현재 worktree에서 직접 확인된다.

## 완료 행렬

| 요구 | 권위 있는 증거 | 완료 조건 |
|---|---|---|
| 의미 기반 locator | catalog contract + 실브라우저 fixture | CSS, role, text, label, testId와 stale 거부 |
| actionability | actionability unit + Chrome/Edge E2E | effect 전 자동 대기, effect 후 무재시도 |
| frame과 shadow | cross-document fixture | 허용 origin만 통과, closed root 명시 오류 |
| 관측 artifact | trace contract + redaction E2E | bounded screenshot, console, network |
| 외부 효과 | policy negative tests | 목적, 위험, destination, audit 누락 시 notSent |
| 실패 설명성 | cancellation/death fixture | outcome과 completed prefix와 trace 일치 |
| 제품 범위 | effect fixture matrix | popup, dialog, upload, download 포함 |
| 회귀 방지 | CI와 음성 시험 | Chrome, Edge, default MCP, package 모두 green |
| 문서 정합 | docs gate와 수동 설치 절차 | 설정, 경계, 예제, 문제 해결이 코드와 일치 |

## 종료 절차

완료 행렬을 요구별로 다시 감사한다. 증거가 약하거나 간접적이면 완료로 보지 않는다. 모든 행이
직접 증명되면 `tests/attempts/browserAgentComputer/`를 먼저 삭제하고 정식 tests와 docs가 지속
계약을 소유하는지 확인한다. 같은 사이클에 이 이니셔티브 폴더도 삭제하고 `mainPlan/README.md`를
활성 이니셔티브 없음으로 되돌린다.
