# Initiative 0: Machine Entrance 실행 계획

상태: **구현 중**

이 문서는 exact package 설치에서 첫 Python 결과와 첫 검증된 browser observation까지 이어지는 제품
입구를 완성하는 첫 번째 이니셔티브의 임시 실행 계획이다. 이 계획을 끝내기 전에는 Initiative 1 이후를
구현하지 않는다.

지속 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-0---machine-entrance),
현재 package 계약은 [package contract](../../docs/usage/contract.md), 실험 원장은
[Initiative 0 attempt](../../tests/attempts/machineEntrance/README.md)가 소유한다.

## 1. 최종 결과

새 소비자는 repository source나 package 내부 경로를 읽지 않고 다음 여정을 완주한다.

```text
install exact package
-> initialize one explicit profile
-> preflight
-> start or connect
-> run Python or observe browser
-> verify output and evidence
-> close and clean up
```

각 단계는 성공 결과와 다음 명령을 함께 제공한다. 실패는 잘못된 field, 찾지 못한 engine 또는 browser,
거부된 authority, 남아 있는 process와 안전한 복구 명령을 알려준다.

완료된 입구는 다음 세 소비자를 같은 계약으로 묶는다.

- Python-only 소비자: browser authority 없이 durable Python 결과까지 도달한다.
- browser observer: exact origin과 read action만 열고 APX observation까지 도달한다.
- authorized actor: explicit risk와 purpose를 선언하고 한 action을 evidence로 검증한다.

## 2. 바닥 사실

이미 있는 기반:

- root `open()`과 `boot()`
- `pyproc/control` JavaScript client
- Python SDK
- `pyproc-mcp`와 `pyproc-control` bin
- strict product manifest와 `--check`
- `pyproc-engine`과 `pyproc-assets`
- Native CDP, FrameSpace, ReplaySpace
- installed package browser gate

남은 문제:

- engine 준비, manifest 작성, client 등록, server readiness, 첫 operation을 사용자가 조립한다.
- Python-only와 browser-enabled profile의 authority 차이를 처음부터 이해해야 한다.
- 오류가 다음 안전한 동작보다 내부 계약 설명에 치우칠 수 있다.
- JavaScript, Python, MCP의 첫 여정이 문서별로 갈라질 수 있다.
- 종료와 artifact cleanup을 처음부터 확인하는 한 golden journey가 없다.

## 3. 제품 경계

### 3.1 기존 identity만 사용

새 root export, 새 npm subpath, 새 bin을 만들지 않는다. 후보 표면은 다음 기존 identity 안에서 검증한다.

```text
pyproc-mcp init
pyproc-mcp --check
pyproc-control doctor
pyproc-control run or invoke
```

exact syntax는 attempt에서 실제 소비 단계 수와 오류 품질을 측정한 뒤 고정한다. 기존 parser에 억지 flag를
누적해야만 성립하면 config compiler를 별도 내부 모듈로 분리한다.

### 3.2 initializer는 policy compiler다

initializer는 permissive sample을 복사하는 도구가 아니다. 선택한 recipe를 완전한 versioned manifest로
컴파일하고 기존 strict validator를 그대로 통과시킨다.

최소 recipe 후보:

| recipe | 기본 authority |
|---|---|
| `pythonOnly` | browser disabled, Python operation만 허용 |
| `observeLocal` | exact local origin, snapshot과 필요한 artifact read만 허용 |
| `authorizedBrowser` | exact origin, 선택 action, max risk, purpose, external effect acknowledgement 명시 |
| `replayPinned` | exact recording identity와 final digest, live provider 없음 |

recipe는 저장된 결과에 남지 않는 shortcut이 아니다. 생성 manifest에는 선택이 완전히 펼쳐져야 한다.

### 3.3 arbitrary shell 금지

initializer는 repository README의 start command를 실행하지 않는다. engine과 browser binary 탐색은 고정된
read-only 규칙으로 수행하고, 개발 서버는 caller authority 아래에서 시작한다. command snippet을 출력할
수는 있지만 실행하지 않는다.

### 3.4 한 lifecycle

모든 client가 다음 terminal 의미를 공유한다.

- `completed`: operation과 required attachment가 완결됐다.
- `rejected`: 입력, policy, target, environment가 effect 전에 거부됐다.
- `partial`: ordered action prefix 일부가 완료됐다.
- `outcomeUnknown`: effect 전송 뒤 terminal truth를 확인하지 못했다.
- `cancelled`: effect 전 또는 안전한 cancellation point에서 멈췄다.

client가 오류를 자기 예외 어휘로 바꾸더라도 code, outcome, retryability, completed prefix,
ActionEvidence를 잃지 않는다.

## 4. initializer 산출물

기본 layout 후보:

```text
.pyproc/
|-- manifest.json
|-- client.json
`-- README.md
```

- `manifest.json`: 완전한 runtime, browser, recording, authority 계약
- `client.json`: generic stdio client 등록 재료, secret 없음
- `README.md`: exact 다음 명령과 cleanup, 사람용이며 authority가 아님

경로는 repository root 아래 realpath로 고정하고 기존 파일은 explicit overwrite 없이는 바꾸지 않는다.
absolute engine path와 recording path는 platform 형식으로 정규화한다. secret, cookie, browser profile path는
생성하지 않는다.

## 5. preflight 계약

effect 전에 다음을 모두 확인한다.

1. package와 schema exact version
2. engine root와 필수 asset, integrity manifest
3. supported browser family와 executable
4. isolated profile root와 ownership
5. allowed origin, redirect, frame, action, risk, purpose
6. file root, upload와 download boundary
7. artifact quota와 recording target
8. Control 및 MCP operation catalog
9. target URL readiness 또는 명시적 not-running 상태
10. cleanup 가능한 owned process와 lock

진단 결과는 machine-readable code와 사람용 explanation을 함께 제공한다. warning을 success requirement로
숨기지 않고 blocking과 advisory를 구분한다.

## 6. golden journeys

### 6.1 Python-only

```text
init pythonOnly
-> check
-> open durable Machine
-> run Python
-> checkpoint
-> close
-> cold reopen
-> verify result and /home/web
```

Python Machine host 이외의 automation browser session과 CDP endpoint가 생성되지 않아야 한다.

### 6.2 observation

```text
init observeLocal
-> caller starts fixture
-> check readiness
-> attach isolated browser
-> APX observe
-> bounded screenshot only if requested
-> verify attachment digest
-> detach and close
```

### 6.3 verified action

```text
init authorizedBrowser
-> explicit purpose and effect acknowledgement
-> observe fresh locator
-> send one action
-> verify DOM and network postcondition
-> record ActionEvidence
-> close and remove owned artifact
```

## 7. 실험 캠페인

모든 신규 코드는 [Initiative 0 attempt](../../tests/attempts/machineEntrance/)에서 시작한다.

필수 probe:

| probe | 질문 | 음성 시험 |
|---|---|---|
| `cleanInstallJourney.mjs` | packed package만으로 첫 결과까지 가는가 | repository deep import 0 |
| `recipeCompilerProbe.mjs` | recipe가 strict manifest로 완전히 펼쳐지는가 | unknown field와 broad origin 거부 |
| `pythonOnlyBoundaryProbe.mjs` | 기본 profile이 browser를 열지 않는가 | CDP endpoint와 browser tool 0 |
| `preflightDiagnosticProbe.mjs` | 실패가 다음 안전한 동작을 말하는가 | effect 전 request 0 |
| `clientParityProbe.mjs` | JavaScript, Python, MCP가 같은 terminal을 받는가 | code 또는 outcome 손실 0 |
| `cleanupProbe.mjs` | cancel과 browser death 뒤 owned 자원이 정리되는가 | process, profile, lock, artifact 잔여 0 |

## 8. 실행 단계

### 단계 0. 소비 마찰 계측

- clean directory와 packed package에서 현재 문서만 따라간다.
- 첫 Python 결과, 첫 observation, 첫 verified action까지 필요한 사용자 결정과 명령을 기록한다.
- repository 내부 import와 수작업 JSON 수정 지점을 전부 찾는다.

종료 조건: 현재 마찰을 재현하는 실패 fixture와 기준 단계 수가 attempt에 남는다.

### 단계 1. recipe와 schema

- recipe 입력을 최소 choice로 설계한다.
- 완전한 manifest compiler와 strict negative fixture를 만든다.
- existing product validator와 결과를 대조한다.

종료 조건: shortcut이 policy bypass가 아니며 같은 input이 같은 canonical manifest를 만든다.

### 단계 2. init와 doctor

- 기존 bin 안에 initializer와 preflight를 배치한다.
- dry run, overwrite refusal, platform path, exact next command를 구현한다.
- arbitrary shell과 default profile attach를 막는다.

종료 조건: malformed 환경은 browser launch 전에 actionable error로 닫힌다.

### 단계 3. golden clients

- JavaScript, Python, MCP에 같은 journey를 작성한다.
- operation, outcome, attachment, cancellation naming을 통일한다.
- one-shot action verification과 cleanup을 포함한다.

종료 조건: 세 client의 terminal과 digest가 같다.

### 단계 4. installed product gate

- clean tarball 설치와 engine 준비를 자동화한다.
- Chrome Ubuntu와 Edge Windows에서 Python-only와 browser journey를 실행한다.
- failure, cancel, process death, stale lock 음성 시험을 넣는다.

종료 조건: source checkout에 기대지 않는 installed gate가 green이다.

### 단계 5. 문서 정합

같은 변경에서 다음을 갱신한다.

- `README.md`, `README.ko.md`
- `docs/usage/contract.md`
- `docs/usage/browserAutomation.md`
- `docs/usage/controlProtocol.md`
- `docs/usage/javascriptControl.md`
- `docs/usage/pythonSdk.md`
- `docs/reference/api.md`
- `docs/usage/capabilityMatrix.md`
- `docs/README.md`
- `SECURITY.md`

quick start의 first command, config path, cleanup, terminal이 모든 문서에서 같아야 한다.

### 단계 6. 종료

- contract reality의 Machine Entrance debt를 삭제한다.
- attempt를 폴더째 삭제한다.
- 이 계획을 폴더째 삭제한다.
- mainPlan index의 다음 이니셔티브를 Initiative 1로 이동한다.

## 9. 졸업 gate

1. clean directory에서 packed exact package만 설치하고 세 golden journey를 완주한다.
2. Python-only 생성물은 automation enabled, CDP endpoint, browser action을 포함하지 않는다.
3. browser profile은 broad origin, unknown action, excessive risk, relative file root를 launch 전에 거부한다.
4. JavaScript, Python, MCP가 같은 manifest로 같은 terminal과 attachment digest를 반환한다.
5. public example과 type surface에 package-internal import가 없다.
6. 시작 실패, cancel, post-send disconnect, shutdown 뒤 owned process와 artifact가 남지 않는다.
7. Chrome과 Edge installed gate가 문서의 exact journey를 실행한다.
8. initializer output에 secret, default browser profile, arbitrary shell command가 없다.
9. 신설 gate마다 음성 fixture로 RED를 확인한다.

## 10. 완료 정의

이 이니셔티브는 사용자가 pyproc의 내부 구조를 배우기 전에 첫 유용한 결과를 얻고, 어떤 authority를
열었는지 이해하고, 실패 시 다음 안전한 행동을 알며, 모든 client에서 같은 lifecycle을 경험할 때 끝난다.
완료와 같은 사이클에 attempt와 mainPlan 폴더를 삭제한다.
