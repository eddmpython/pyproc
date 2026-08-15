# Initiative 9: agent computer와 웹 표준 후보 준비도

상태: **진행 중, M0 완료, M1 두 하위 계약 완료**

이 문서는 agent가 pyproc에 들어와 보고, 행동하고, 계산하고, 세션을 넘겨 계속 일하는 전 과정을
제품 기준으로 끌어올리는 실행 원장이다. 기존 능력 점수와 증거의 정본은
[`tests/northStar.mjs`](../../tests/northStar.mjs)이며, 이 문서는 네 질문을 그 축에 매핑하고 아직 끝나지
않은 작업만 직렬로 관리한다.

## 1. 0.0.22 실사용 판정

환경은 Windows 11, Edge, Node.js 22, 레지스트리에서 새로 설치한 `pyproc@0.0.22`다. 공개
`pyproc-mcp`, `pyproc-control`, `pyproc/control`만 사용했다.

| 질문 | 현재 판정 | 실사용 증거 | 완성까지 남은 것 |
|---|---|---|---|
| agent 진입점 | 강함, 완성 아님 | exact install 뒤 `pythonOnly` init, effect-free doctor, CPython 실행이 공개 명령으로 완결되고 현재 main은 package engine을 자동 선택 | client별 다음 명령 의미 통일 |
| 눈과 팔 | 강함, 완성 아님 | APX Situation이 링크를 식별하고 proof-carrying click 뒤 `Smallest start` 출현을 confirmed로 봉인. 현재 main은 첫 문서 교체를 effect 재시도 없이 수렴 | 장기 반복 수명주기와 실제 GPU visual oracle 확대 |
| 비-agent 컴퓨팅 몸체 | 훌륭한 브라우저 컴퓨터, 로컬 OS 완전 대체는 아님 | owned CPython, worker process, OPFS disk, checkpoint, Machine image, Python과 x86 guest gate | 임의 native wheel, shared-memory thread, wasm 도구층, Node guest, quota 축출 계약 |
| 단독 자립성 | Python 기본 Machine은 높음, 전체 WebComputer는 미완성 | source-built CPython과 stdlib가 npm에 포함되고 기본 부팅의 제3자 요청은 0 | x86 emulator와 firmware의 독립 재현, GPU 실기 CI, 브라우저 범위 확대 |
| 웹 표준 후보 가능성 | 기반은 있음, 후보라고 부르기에는 이름 | WebAssembly, Worker, cross-origin isolation, bucket file system 같은 표준 기반 위에 제품 계약이 동작 | vendor-neutral specification, 독립 구현, WPT형 conformance, 공개 incubation과 wide review |

첫 Pages 진입에서는 COI Service Worker가 문서를 실제 교체했다. 기존 affordance 실행은
`BROWSER_AUTOMATION_STALE_LOCATOR`, `retryable: true`, `outcome: notSent`로 안전하게 거부됐고, 안정화 뒤
새 Situation으로 다시 발급한 click은 `confirmed`로 끝났다. 이는 wrong effect를 막은 강점이며, 첫 문서
교체는 현재 main에서 원래 typed focus를 한 번 다시 관찰하는 bounded convergence로 제품화했다.

## 2. 웹 표준 판정 기준

pyproc은 이미 표준 웹 기반을 사용하지만 pyproc 자체가 웹 표준 후보인 것은 아니다. W3C Process의
implementation experience는 독립적이고 상호운용 가능한 구현, 저자 밖 구현, 공개 배포와 실제 소비 경험을
본다. 저장소가 자력으로 준비할 수 있는 종료 조건은 다음과 같다.

1. Python에 종속되지 않은 Web Machine lifecycle, capability, image, effect terminal 명세가 있다.
2. 명세의 normative statement마다 WPT형 testharness 또는 동등한 conformance vector가 있다.
3. pyproc 구현과 분리된 최소 reference implementation이 같은 vector를 통과한다.
4. security, privacy, accessibility, internationalization 고려가 명시돼 있다.
5. 공개 incubation에 제출 가능한 explainer, use cases, alternatives, compatibility 자료가 있다.

독립 제3자 구현과 표준 단체의 채택은 저장소가 스스로 만들 수 없는 외부 조건이다. 그것이 생기기 전에는
`standard-ready product protocol`까지만 주장하고 `web standard`라고 부르지 않는다.

## 3. 직렬 실행 순서

한 단계의 구현, 음성 시험, 정식 게이트, 문서 정합을 끝내기 전 다음 단계로 이동하지 않는다.

### M0. Control 수명주기 무잔류

판정: **완료**

- 성공한 startup, check, request, shutdown의 losing timeout timer를 즉시 취소한다.
- `PyProcControlClient.close()` 뒤 호출자 프로세스가 startup timeout까지 살아 있지 않음을 실제 child
  process gate로 증명한다.
- timer 정리를 하더라도 timeout, cancel, SIGTERM, SIGKILL 의미론은 그대로 유지한다.

완료 조건:

- 구 구현이면 제한 시간에 걸리는 음성 fixture가 수정 뒤 즉시 종료한다.
- `npm test`, `npm run test:control-product`, `npm run test:mcp-product`가 green이다.
- 새 설치본에서 성공 여정 뒤 Node process 잔류가 없다.

완료 증거:

- 배포된 0.0.22 최소 lifecycle은 startup timeout timer 때문에 약 5.3초 뒤 종료됐다.
- 수정 소스의 같은 fixture는 약 0.7초에 종료됐다.
- 이전 구현이면 1.5초에 걸리는 process 음성 gate를 `tests/fixtures/controlLifecycleProbe.mjs`와
  `tests/contracts/controlJsSdk.mjs`에 상시화했다.
- `npm test`, `npm run test:control-product` 22개, `npm run test:mcp-product` 20개가 GREEN이다.

### M1. Machine Entrance 첫 결과 수렴

판정: **진행 중**

- 완료: exact version 설치 뒤 engine 경로를 사람이 조립하지 않아도 package-owned CPython을 선택한다.
  명시한 `--engine-root`만 override로 사용하며 결과와 생성 README에 선택 출처와 절대 경로를 남긴다.
- 완료: COI bootstrap의 첫 문서 교체를 관찰하고 같은 typed focus의 새 capability를 한 번 재발급한다.
  `notSent` 외에는 재시도하지 않고, 유일성이나 권한이 달라지거나 두 번째 교체가 생기면 중단한다.
- doctor의 다음 명령이 shell, JavaScript, Python, MCP에서 같은 의미를 가진다.

첫 하위 계약 증거:

- `pyproc-mcp init --recipe pythonOnly`가 설치 tarball 내부 owned engine으로 manifest를 만든다.
- 순수 parser는 package 경로를 추측하지 않고 initializer만 설치 경계를 해석한다.
- contract 36 suites, package gate, 전체 12개 게이트, 설치 MCP 제품 21개가 GREEN이다.
- 첫 문서 교체 probe는 수정 전 stale locator와 effect 0을 재현했고, 수정 후 postcondition confirmed와
  effect 정확히 1회로 수렴했다. 설치 MCP 제품 gate도 같은 여정을 고정한다.
- browser control, 3회 48-action stress, APX 11개 실브라우저 게이트가 GREEN이다.

### M2. Eyes와 Arms 장기 수명주기

- 반복 Situation, screenshot, proof-carrying action, artifact cleanup에서 handle과 process 잔류 0을 증명한다.
- stale, ambiguous, occluded, navigation 교체를 wrong effect 없이 자동 수렴시키는 상한을 고정한다.
- hardware GPU runner에서 pixel 결과 oracle을 추가해 수동 증거 상한을 제거한다.

### M3. 컴퓨팅 몸체 확대

- `tests/northStar.mjs`의 `localPythonParity`, `parallelProcesses`, `durableDisk` next를 순서대로 소진한다.
- upstream이 열어 주는 thread와 dynamic linking은 capability detection과 exact failure로 받는다.
- wasm 도구층을 먼저 넣고 Node guest는 같은 Machine lifecycle과 image 계약을 통과시킨다.

### M4. 전체 자립 공급망

- emulator, firmware, guest image의 source, lock, license, SBOM, 두 번 build byte 대조를 완결한다.
- 기본 Python, optional x86, GPU 경로별 외부 요청과 자산 출처를 설치 제품 gate가 전수 판정한다.
- 브라우저 또는 OS가 제공하는 표준 substrate와 pyproc이 배송하는 byte를 명확히 구분한다.

### M5. 표준 후보 자료와 conformance

- vendor-neutral Web Machine explainer와 normative protocol을 분리한다.
- WPT형 test suite와 별도 최소 reference implementation을 만든다.
- W3C Process의 implementation experience 항목을 채우는 공개 readiness report를 생성한다.
- 외부 incubation 전까지 제품 표면을 동결하고 명세와 구현의 drift를 기계 차단한다.

## 4. 세션 재개 규칙

1. 이 파일의 가장 앞선 미완료 단계만 연다.
2. `git status`, `tests/northStar.mjs`, 관련 정식 gate와 마지막 커밋을 읽는다.
3. 실사용에서 새 간극을 찾으면 같은 단계의 첫 불일치와 재현으로 기록한다.
4. 단계 완료 시 구현 결과는 정식 tests와 지속 문서로 옮기고 이 원장에는 다음 미완료 단계만 남긴다.
5. M0부터 M5까지 자력 종료 조건을 모두 만족하면 이 폴더를 물리 삭제하고 `npm test`를 다시 통과한다.
