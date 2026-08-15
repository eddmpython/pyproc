# Initiative 9: agent computer와 웹 표준 후보 준비도

상태: **진행 중, M0부터 M2 완료, M3 진행 중**

이 문서는 agent가 pyproc에 들어와 보고, 행동하고, 계산하고, 세션을 넘겨 계속 일하는 전 과정을
제품 기준으로 끌어올리는 실행 원장이다. 기존 능력 점수와 증거의 정본은
[`tests/northStar.mjs`](../../tests/northStar.mjs)이며, 이 문서는 네 질문을 그 축에 매핑하고 아직 끝나지
않은 작업만 직렬로 관리한다.

## 1. 0.0.22 실사용 판정

환경은 Windows 11, Edge, Node.js 22, 레지스트리에서 새로 설치한 `pyproc@0.0.22`다. 공개
`pyproc-mcp`, `pyproc-control`, `pyproc/control`만 사용했다.

| 질문 | 현재 판정 | 실사용 증거 | 완성까지 남은 것 |
|---|---|---|---|
| agent 진입점 | 매우 강함, 장기 수명주기 검증은 계속 | exact install 뒤 package engine 자동 선택, effect-free doctor, 네 adapter의 같은 CPython 첫 결과가 공개 계약으로 완결 | M3 컴퓨팅 몸체 확대와 독립 구현 conformance |
| 눈과 팔 | 매우 강함, 완성 아님, 북극성 9.5 | APX Situation, 20회 무잔류 수명주기, bounded action 수렴, 실제 hardware compute와 pixel 결과 영수증 | 두 번째 독립 hardware와 browser 구현의 visual conformance |
| 비-agent 컴퓨팅 몸체 | 훌륭한 브라우저 컴퓨터, 로컬 OS 완전 대체는 아님, 북극성 7.8 | owned CPython, worker process, OPFS disk, checkpoint, Machine image, Python과 x86 guest gate, hardware GPU 결과 gate | 임의 native wheel, 넓은 package reach, shared-memory thread, wasm 도구층, Node guest, quota 축출 계약 |
| 단독 자립성 | Python 기본 Machine은 높음, 전체 WebComputer는 미완성 | source-built CPython과 stdlib가 npm에 포함되고 기본 부팅의 제3자 요청은 0 | x86 emulator와 firmware의 독립 재현, 외부 hardware runner 등록, 브라우저 범위 확대 |
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

판정: **완료**

- 완료: exact version 설치 뒤 engine 경로를 사람이 조립하지 않아도 package-owned CPython을 선택한다.
  명시한 `--engine-root`만 override로 사용하며 결과와 생성 README에 선택 출처와 절대 경로를 남긴다.
- 완료: COI bootstrap의 첫 문서 교체를 관찰하고 같은 typed focus의 새 capability를 한 번 재발급한다.
  `notSent` 외에는 재시도하지 않고, 유일성이나 권한이 달라지거나 두 번째 교체가 생기면 중단한다.
- 완료: initializer와 doctor가 같은 구조화된 `next.firstResult`를 반환한다. 부모 의미는
  `machine.run`과 한 입력으로 고정하고 shell argument vector, JavaScript와 Python SDK method, MCP tool을
  adapter로 둔다.

첫 하위 계약 증거:

- `pyproc-mcp init --recipe pythonOnly`가 설치 tarball 내부 owned engine으로 manifest를 만든다.
- 순수 parser는 package 경로를 추측하지 않고 initializer만 설치 경계를 해석한다.
- contract 37 suites, package gate, 전체 13개 게이트, 설치 MCP 제품 gate가 GREEN이다.
- 첫 문서 교체 probe는 수정 전 stale locator와 effect 0을 재현했고, 수정 후 postcondition confirmed와
  effect 정확히 1회로 수렴했다. 설치 MCP 제품 gate도 같은 여정을 고정한다.
- browser control, 3회 48-action stress, APX 11개 실브라우저 게이트가 GREEN이다.
- `PyProcControlClient.doctor()`와 `PyProcClient.doctor()`는 complete doctor와 representable blocking report를
  그대로 반환한다. 기존 `check()`는 startup compatibility surface로 유지한다.
- packed install에서 doctor가 준 exact shell arguments, JavaScript method, Python method, MCP tool이 모두
  canonical `machine.run`으로 42를 반환했다. Control 23개, MCP 22개, Python wheel과 sdist 5개 제품 gate가
  GREEN이다.

### M2. Eyes와 Arms 장기 수명주기

판정: **완료**

- 완료: legacy 의미 관찰을 같은 document epoch에 고정된 1,000개 이하 page로 순회한다. single-use
  continuation, 5분 TTL, 10,000 node와 16 MiB 전체 상한, page와 prefix 및 전체 digest, screenshot과 event
  evidence binding을 NativeCdpSpace와 FrameSpace, Control, MCP, JavaScript와 Python SDK에 같은 의미로 둔다.
  문서 교체는 `AUTOMATION_OBSERVATION_CONTINUATION_STALE`로 일부 결과를 complete로 승격하지 않는다.
- 완료: 반복 Situation, screenshot, proof-carrying action, artifact cleanup에서 handle과 process 잔류 0을
  증명한다. 각 owner가 직접 센 자원을 `automation.space.inspect.resources`로 합성하고, 격리 profile의
  packed Control 제품 20회와 NativeCdpSpace, FrameSpace, MCP, Python adapter가 0 수렴을 검증한다.
- 완료: stale, ambiguous, occluded, navigation 교체를 후보 최대 2개, 재관찰 최대 1회, effect retry 0회,
  첫 effect 전 30000 ms로 고정한다. 성공과 안전 거절은 같은 version 1 영수증을 반환한다.
- 완료: installed `pyproc/gpu`의 닫힌 WebGPU provider를 hostcall 경계에 연결하고 실제 nonfallback
  hardware에서 compute와 RGBA8 pixel 결과를 version 1 oracle receipt로 검증한다. adapter, buffer,
  texture, target, process와 임시 profile을 모두 정리하며 software fallback과 결과 불일치는 RED다.

### M3. 컴퓨팅 몸체 확대

- 완료: `packageReach` 기반으로 Requires-Python canonicalization, target-generated WASI sysconfig와
  build details, workspace 경로 canonicalization, 두 격리 build의 byte-identical stdlib를 제품화했다.
- 진행 중: source-pinned native package catalog와 compiled extension 하나의 설치 제품 gate를 먼저 닫고
  scientific SIMD profile로 넓힌다. 이후 `parallelProcesses`, `durableDisk` next를 순서대로 소진한다.
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

## 5. 소비 관찰: 대형 의미 트리의 완전 검수 경로

### 접수 판정

- 관찰한 호출 제품과 목적: 합성 데이터만 쓰는 세무 대시보드에서 데스크톱 전체 화면의 접근성 의미와
  스크린샷을 함께 검수했다.
- pyproc 소유라고 판정한 근거: 공개 `automation.observe`의 `all` 모드는 `maxNodes`를 1,000까지만
  허용하고 잘림을 정확히 보고하지만, 같은 문서 epoch를 완전하게 순회할 공개 continuation 또는
  의미 영역 focus가 없다. 이 경계는 대형 관리 화면과 카탈로그 등 둘 이상의 소비 시나리오에 공통이다.
- 검색한 중복 후보와 차이: `mainPlan`, `skills`, `tests/attempts`, 관련 Git 이력에서 source truncation의
  안전 판정은 확인했으나, 전체 의미 트리를 무손실로 분할 순회하는 이니셔티브는 찾지 못했다. M2의
  장기 Eyes와 Arms 수명주기에 포함한다.
- 현재 직렬 대기열 위치: M1 완료 뒤 M2에서 다룬다. 선행 단계를 건너뛰어 구현하지 않는다.

### 정확한 환경

- 관찰 시각과 시간대: 2026-08-15, Asia/Seoul.
- 소비 저장소 revision: `308d07173806e417eca02672a09f49d6c2900ed6`, 관련 working tree diff digest
  `3833bb16d9f2ef25252083e7261ce329746b3273`.
- 해석된 pyproc 버전, 패키지 무결성 또는 소스 SHA: `pyproc@0.0.20`,
  `sha512-sd/jz2Q9yPjsMuM4gIwYjercCSsMFLdKuYF0vxc5ef5aLqGAtUC2g5reiXJ9cHNS1aBjLfoPnwKK9Eu5d7OfLg==`.
- 운영체제, 브라우저 이름과 정확한 버전, 런타임 버전: Windows 11 Home 10.0.26200,
  Microsoft Edge 151.0.4129.78, Node.js 22.19.0.
- 사용한 공개 명령 또는 공개 API: `npm exec -- pyproc-control --config <synthetic-manifest>`와
  `automation.observe`의 `mode: all`, `maxNodes: 1000`, screenshot 및 console 포함.
- 권한 manifest와 관련 설정의 비밀 제거 요약: 새 임시 profile, 합성 loopback origin 하나, native CDP,
  읽기와 명시된 합성 페이지 열기만 허용, raw method 없음, 종료 시 browser와 profile 제거.

### 목적과 시작 상태

- 사용자가 달성하려던 결과: 처음 보는 회사도 바로 이해할 수 있는 대시보드의 전체 의미, 콘솔 상태,
  픽셀 결과를 한 검수 실행에서 증명한다.
- 대상 URL 범위, viewport, 페이지 상태, 사전 조건: 합성 loopback URL, 1600 x 1000 viewport, 경영 답변과
  지표 근거가 준비된 데스크톱 화면, 새 browser profile.
- 읽기, 외부 효과, 비가역 작업의 승인 경계: 합성 페이지 open만 외부 효과로 사전 승인했다. 원격 요청,
  자격증명, 사용자 데이터, 비가역 작업은 없었다.

### 실행 기록

| 순서 | 목적 | 실행한 공개 명령 또는 API | 입력 경계 | 관찰 결과 | 증거 |
|---|---|---|---|---|---|
| 1 | 설치본 확인 | `pyproc-control --version` | 로컬 exact install | `0.0.20` | 명령 stdout |
| 2 | 전체 의미와 화면 동시 관찰 | `automation.observe` | `all`, 1,000 nodes, 합성 화면 | 1,071 후보 중 1,000 반환, `truncated: true` | 비식별 오류 요약 |
| 3 | 상호작용 의미로 축소 | `automation.observe` | `interactive`, 같은 화면 | 149개 전부 반환, screenshot과 console 정상 | 소비 검수 receipt digest |

### 첫 불일치

- 처음 기대와 달라진 단계: 전체 의미 관찰 단계.
- 기대 결과: 페이지의 전체 접근성 의미와 같은 시점의 screenshot, console이 잘림 없이 반환된다.
- 실제 결과: `candidateNodes: 1071`, 반환 1,000개, `truncated: true`로 종료됐다.
- 반환 코드, 오류 계약, 완료된 효과의 범위: 관찰 호출 자체는 성공하고 명시적 잘림을 반환했다. 페이지 open
  외 추가 효과는 없었으며, 소비 검수기는 불완전 증거를 성공으로 봉인하지 않고 중단했다.

### 재현성

- 최소 합성 재현 fixture 또는 절차: 접근 가능한 제목, 표, 카드, 정적 설명과 버튼을 합쳐 1,001개 이상의
  의미 후보를 만든 loopback 문서를 새 profile로 열고 `mode: all`, `maxNodes: 1000`으로 관찰한다.
- 반복 횟수와 성공, 실패 횟수: 해당 대시보드 상태에서 1회 실행, 1회 동일 경계 재현. 별도 대형 카탈로그도
  같은 상한을 만났으나 제품이 선택 상세 렌더링으로 정리한 뒤 328개로 줄었다.
- 브라우저 재시작, 새 profile, viewport 등 바꿔 본 조건: 매 실행마다 새 profile을 썼다. 같은 제품의
  390 x 844 축약 화면은 551개로 잘리지 않았다.
- 재현하지 못한 조건과 남은 불확실성: Firefox와 Safari는 지원 범위 밖이라 확인하지 않았다. APX graph의
  byte budget과 legacy semantic node 상한의 최적 통합 계약은 아직 정하지 않았다.

### 증거

- 비식별화한 로그 또는 artifact 경로와 digest: 소비 작업의 성공 screenshot receipt 중 데스크톱 첫 화면
  digest는 `sha256:bb86ec33c961ca40c33de35b970bf33ce68118ab6fac414602110f3b7a5d2631`이다. 원본 artifact와
  로컬 경로는 반입하지 않았다.
- 스크린샷의 대상 상태, viewport, 촬영 단계와 digest: 합성 경영 대시보드, 1600 x 1000, 준비 완료 뒤 첫
  viewport. 위 digest는 픽셀 결과를 입증하지만 1,071개 전체 의미 반환을 입증하지 않는다.
- DOM, 네트워크, console, 실행 receipt 가운데 판정에 사용한 것: semantic `candidateNodes`, 반환 수,
  `truncated`, console error 0, screenshot digest, cleanup receipt를 사용했다.
- 증거가 입증하는 범위와 입증하지 못하는 범위: 공개 상한에서 완전 관찰이 불가능하고 잘림은 정확히
  드러난다는 점을 입증한다. omitted node의 내용과 continuation 설계의 성능은 입증하지 않는다.

### 시도한 대응

- 시도한 진단과 변경: 제품 카탈로그는 모든 레시피 상세를 동시에 렌더링하지 않도록 정보 구조를 고쳤다.
  대시보드는 `interactive` 관찰과 별도 전체 screenshot을 사용하고 모바일 축약 화면은 `all`로 유지했다.
- 각 시도의 결과: 카탈로그 전체 의미는 328개로 줄어 완전 관찰됐다. 데스크톱 대시보드 상호작용 의미는
  149개로 완전 관찰됐지만 정적 설명 전체의 의미 증거는 빠진다.
- 소비 저장소 우회가 근본 해결이 아닌 이유: UI를 상한에 맞춰 임의 축소하면 제품 정보 구조가 도구 예산에
  종속된다. `interactive` 모드는 픽셀과 조작 가능성을 검수하지만 정적 의미 전체를 증명하지 못한다.

### 영향과 안전 경계

- 영향을 받는 제품 흐름과 빈도: 데이터가 많은 대시보드, 관리면, 카탈로그의 전체 화면 접근성 검수마다
  발생할 수 있다.
- 심각도와 사용자가 보게 되는 실패: 제품 런타임은 정상이나 검수 자동화가 불완전 증거를 거부해 출시
  증거 생성이 중단된다.
- 데이터, 권한, 외부 효과, 재시도 위험: 읽기 관찰 경계라 데이터 변형은 없다. continuation이 생겨도 같은
  document epoch, 같은 권한, zero effect를 강제해야 한다.
- 기존 호환성 또는 공개 표면에 미치는 영향: 현재 명시적 truncation은 유지해야 한다. 기존 결과 형태를
  깨지 않는 선택형 continuation 또는 focused observation 계약이 필요하다.

### 제안하는 pyproc 계약

- pyproc이 소유해야 할 동작: 동일 document epoch에서 전체 의미 후보를 안정적으로 분할 순회하고, 각
  조각과 최종 receipt가 중복, 누락, epoch 교체 여부를 검증할 수 있어야 한다. 대안으로 접근성 landmark나
  broker가 발행한 semantic root를 focus로 받되 전체 coverage를 합성할 수 있어야 한다.
- 공개 표면 변경 여부와 비목표: 공개 관찰 입력과 결과에 continuation 또는 focus 계약을 추가할 수 있다.
  무제한 payload, raw DOM selector 권한, 잘림 은폐, 소비 UI 축소는 비목표다.
- 가장 작은 수용 테스트와 음성 시험: 1,001개 합성 후보를 두 개 이상 page로 받아 합집합이 정확히
  1,001개임을 검증한다. 중간에 document epoch가 바뀌면 continuation을 stale로 거부하고 일부 결과를
  complete로 표시하지 않는 음성 시험을 둔다.
- 브라우저 실측 시나리오: Edge 새 profile에서 대형 의미 fixture를 완전 순회하고, screenshot과 console은
  지정된 한 관찰 시점 또는 명시된 시간 범위에 결합하며, 종료 뒤 process와 profile이 남지 않아야 한다.
- 완료 조건, 지속 문서 승격 위치, 계획과 attempt 삭제 조건: public protocol, JavaScript와 Python SDK,
  control 문서, browser product gate가 같은 계약을 통과한다. 음성 시험과 installed product 실측 뒤 관련
  지속 문서로 승격하고 M2의 남은 항목까지 끝난 사이클에 이 계획과 대응 attempt를 삭제한다.

### 다음 행동

- 선행 조건: M1 Machine Entrance 계약 완료.
- 첫 probe: 1,001개 합성 의미 후보에서 cursor 안정성, epoch 교체, screenshot 시간 결합을 실측한다.
- 예상 수정 소유 영역: browser observation catalog와 provider, control protocol과 SDK, browser contract 및
  installed product gate.

### 해결 판정

- 해결 시각과 제품: 2026-08-15 Asia/Seoul, packed `pyproc@0.0.22` source product, Edge headless.
- 공개 계약: 첫 호출은 기존 `maxNodes` 상한을 page 크기로 유지하고 `continuationRef`와
  `pyproc.semanticInventory` version 1 receipt를 추가한다. 후속 호출은 session, read risk, continuation만
  받는다. `truncated`는 기존 한 page 의미를 유지하고 전체 완료는 `inventory.complete`만 말한다.
- 무손실 증거: NativeCdpSpace는 접근성 node 2,009개를 6 page로 합쳐 합성 버튼 1,001개를 정확히 한 번씩
  확인했다. 설치 MCP는 2,010개를 6 page로 합쳤고 첫 native screenshot digest와 마지막 evidence binding이
  일치했다. FrameSpace는 node 1,006개를 3 page로 합쳐 합성 버튼 1,001개를 확인했다.
- 독립 소비 증거: clean wheel Python SDK가 FrameSpace 전체 배열을 canonical sorted-key JSON으로 다시
  직렬화하고 제품의 `nodesSha256`과 같은 SHA-256을 계산했다. Python SDK에는 target cleanup의 대칭 공개
  메서드 `closeTarget()`도 추가했다.
- 음성 증거: consumed token, TTL 만료, item 상한, 다른 document epoch를 모두 고유 오류로 거부한다.
  navigation 뒤 continuation은 NativeCdpSpace와 FrameSpace 설치 제품 모두 stale, `notSent`, 비재시도로
  종결되고 retained inventory state는 0이다.
- 정식 게이트: contract 36 suites, FrameSpace 24개, JavaScript Control 26개, 설치 MCP 25개, Python wheel과
  source distribution 5개가 GREEN이다. 전체 `npm test` 13개와 package gate 7개 파일도 GREEN이다.
- 후속 판정: 반복 Situation, screenshot, proof-carrying action과 artifact cleanup의 장기 무잔류는 아래
  6절에서 완료했다. 다음 직렬 작업은 wrong-effect 없는 자동 수렴 상한이다.

## 6. 해결 판정: automation 장기 수명주기 무잔류

- 첫 불일치: 기존 `browserInspect.sessions`는 연결된 session만 세어 detach 뒤 0을 반환했지만,
  `BrowserControlPort._sessions`와 `NodeCdpTransport._sessions`에는 이미 detach된 session handle이 남았다.
  perception identity, timeline, world, Situation history와 capability, CDP pending과 listener도 공개
  inspect에서 보이지 않아 기존 stress green은 무잔류 증거가 아니었다.
- 실측 순서: exact packed `pyproc@0.0.22` source product, Windows 11, Edge 151, Node.js 22에서 공개
  `pyproc/control`만 사용했다. 매 회 새 target을 열고 Situation과 native visual screenshot을 얻어 artifact를
  삭제하고, broker capability로 click한 뒤 DOM postcondition을 confirmed로 봉인했다. action screenshot도
  digest 검증 뒤 삭제하고 detach와 target close를 수행했다.
- 첫 실행: effect와 두 artifact cleanup까지 성공했으나 기존 공개 inspect에 완전한 `resources`가 없어
  첫 회 0/20에서 RED였다.
- 수정: detach event와 명시적 detach가 port와 transport Map에서 session을 즉시 삭제한다. perception
  identity, timeline, world, capability와 sensor, CDP connection, transport, port, broker, artifact,
  observation, lifecycle owner가 자기 bounded count만 보고하고 NativeCdpSpace와 FrameSpace가 같은
  provider-neutral receipt로 합성한다.
- 무손실 증거: 정식 `test:automation-lifecycle`은 packed 제품 20/20회에서 target, session, locator,
  continuation, watcher, artifact, perception ledger, transport session, pending command와 listener를 매 회
  0으로 되돌렸다. client close 뒤 Control process가 종료됐고 새 임시 browser profile도 0개였다.
- 게이트 이빨: `BrowserControlPort`의 session 삭제 한 줄을 제거한 음성 변형은 첫 회에
  `sessions=1`을 보고 0/1 RED였다. 정리 코드를 복원하면 같은 설치 제품 20/20이 GREEN이다.
- adapter 증거: 설치 MCP와 FrameSpace는 detach와 target close 뒤 같은 resource vector를 0으로 확인한다.
  clean wheel과 source distribution의 Python SDK도 `closeTarget()` 뒤 top-level, transport, perception count
  전체를 독립 확인한다.
- adapter 첫 RED: 기존 설치 MCP 여정은 읽고 남겨 둔 APX와 PNG, JPEG, WebP artifact 네 개 때문에
  24/25에서 `artifacts=4`, `artifactBytes=83069`를 보고 실패했다. 모든 소유 artifact를 명시 삭제한 뒤
  전체 resource vector가 0이 되어 25/25 GREEN이 됐다.
- 원장 무결성: `tests/northStar.mjs`에 눈과 팔 축을 8.8로 추가하고 다음 수를
  `wrongEffectFreeConvergence`로 고정했다. 삭제된 과거 probe 여덟 경로는 현재 정식 gate로 교체했으며,
  전체 axis의 score, next, browser lane, 실행 lane, evidence 실존과 사다리 연속성을 `npm test`가 검사한다.
- 원장 gate 이빨: 새 축의 lifecycle evidence를 존재하지 않는 `.missing` 경로로 바꾼 음성 변형은
  `agentBrowserAutomation: missing evidence`를 보고 12/13 RED였고, 복원 뒤 13/13 GREEN이다.
- action 수렴 첫 RED: 같은 문서에서 분리된 target을 5.09초 동안 60회 확인한 뒤 재관찰 없이
  actionability timeout으로 끝났다. ambiguous도 effect 0회로 안전했지만 모호함을 판정하지 못했고,
  다섯 시나리오 모두 공통 영수증이 없었다.
- action 수렴 제품 증거: packed Control과 Edge에서 first-effect 시간은 같은 문서 stale 259 ms,
  ambiguous 172 ms, 일시 가림 1288 ms, 지속 가림 711 ms, navigation 교체 201 ms였다. effect 횟수는
  각각 1, 0, 1, 0, 1이며 terminal PNG 756x488을 직접 확인했다. FrameSpace도 stale, 일시 가림,
  지속 가림과 outcome unknown 1회 무재시도를 같은 영수증으로 증명한다.
- action 수렴 gate 이빨: `ACTION_CONVERGENCE_MAX_ATTEMPTS`를 2에서 3으로 바꾼 음성 변형은
  `3 !== 2`를 보고 RED였고, 2로 복원한 같은 계약 gate는 GREEN이다.
- 다음 직렬 작업: 아래 7절의 hardware 결과 oracle을 완료한 뒤 M3 `packageReach`로 이동한다.

## 7. 해결 판정: hardware visual과 compute 결과 oracle

- 첫 불일치: exact packed `pyproc@0.0.22`의 `pyproc/gpu`는 기존 주입 adapter만 내보냈고
  `createWebGpuHostAdapter`가 없었다. 반면 headed Edge의 raw WebGPU는 AMD RDNA 3 nonfallback adapter에서
  vector `[5,2,5,1]`과 RGBA8 `[64,128,191,255]`를 오차 0으로 반환했다. 기존 수동 GPU probe 일곱 개는
  삭제된 `GpuCompute`와 `enableGpu()`를 import했고 `tests/shaderDigests.json`은 어떤 gate도 읽지 않았다.
- 제품 계약: `src/runtime/gpuOracle.js`가 등록된 WGSL, CPU expected value, digest와 typed mismatch를
  소유한다. `src/capabilities/webGpuHostAdapter.js`는 `vectorAdd`와 `solidRgba8`만 받고 device, pipeline,
  buffer, texture와 readback 수명을 소유한다. `pyproc/gpu`는 새 root나 subpath 없이 둘을 조립한다.
- 설치 제품 증거: 빈 app에 설치한 tarball의 bare `pyproc/gpu`와 `pyproc/wasi`만 import했다. 공개 Control이
  연 headed Edge에서 AMD RDNA 3, `isFallbackAdapter: false`, hostcall 2회를 확인했다. compute expected와
  actual digest는 모두 `sha256:f30cec7be08a06afc4c889f52d2d8bcfb66cc66328187ce9bf30ced10e670fa8`,
  pixel digest는 모두 `sha256:048402e9c4d980772355b55651974f77b1eca456a62116b54bfce1871d725ff1`,
  두 결과 오차는 0이었다.
- 시각 검수: terminal 화면 PNG는 922 x 920이고 adapter, compute error 0, pixel error 0, hostcall 2와
  expected color swatch를 직접 확인했다. artifact SHA-256은
  `ba2933ed74bfb66e8304c4cf32deb77b331d638b0427cb8be752c94451d8043a`다. 제품 gate는 Control artifact를
  삭제하고 detach, target close, adapter close와 임시 profile 정리를 검증한다.
- 지속 실행 경계: `.github/workflows/hardware-gpu.yml`은 `pyproc-webgpu` label의 interactive Windows
  self-hosted runner에서 수동 dispatch하고 screenshot과 JSON을 artifact로 남긴다. 현재 증거는 로컬 MSI
  hardware 실행이며 외부 self-hosted runner의 등록이나 workflow 실행은 아직 증거로 주장하지 않는다.
- gate 이빨: expected pixel 첫 channel을 64에서 67로 바꾼 음성 변형은
  `PYPROC_GPU_RESULT_MISMATCH`, `stage: pixel`, `maxChannelError: 3`으로 RED였다. 64로 복원한 같은
  hardware oracle 계약은 GREEN이다.
- 다음 직렬 작업: M3 `localPythonParity.packageReach`다. GPU 축 자체의 다음 ceiling은 두 번째 독립
  hardware와 browser 구현에서 같은 receipt를 통과시키는 `multiVendorVisualConformance`로 남긴다.

## 8. 진행 판정: owned WASI package reach 기반

- 계획 현실화: 과거 `pyemscripten`과 Emscripten 전제를 현재 owned `wasm32-wasip1` 엔진에 그대로
  적용하지 않는다. 첫 목표를 pure wheel 설치와 target ABI metadata의 신뢰 가능한 배포로 다시 측정했다.
- 첫 RED: exact packed Edge에서 `six==1.17.0`의 index와 wheel이 의미상 같은 Requires-Python을 다른
  순서와 공백으로 표현해 `PYPROC_PACKAGE_INTEGRITY`가 났다. specifier를 canonicalize한 뒤 통과했다.
- 두 번째 RED: pure wheel 뒤 `sysconfig`가 `_sysconfigdata__wasi_wasm32-wasi`를 찾지 못했다. 기존 Windows
  builder는 `python.wasm`만 만들고 generated platform data를 stdlib에 넣지 않았다.
- build 계약: Windows host Python은 target POSIX 문맥으로 sysconfig를 생성하고, 실제 WASI runtime이
  `build-details.json`을 만든다. Git Bash의 prefix 변환을 제한하고 build workspace는 `/build/pyproc`으로
  canonicalize한다. Linux builder도 같은 target build-details 계약을 쓴다.
- 재현성: `a4`와 `b4` 독립 build의 6개 declared output이 byte-identical이다. engine은 7,731,137 bytes,
  `sha256:9cf100f0ee12eb0cbce3396f1649f3cd26e17d482dc2ac982fce3d7927d2081d`, stdlib은
  2,773,481 bytes, `sha256:297e22960319563421b9dcbed67dc7c43e42e456fcc01447ceb4de335ce5a236`다.
- 설치 제품 실측: 공개 Control이 연 Edge에서 `six 1.17.0`을 설치하고 import했다. runtime은
  `wasi-0.0.0-wasm32`, `.cpython-314-wasm32-wasi.so`, `.abi3.so`, `.so`를 보고했다.
- 현재 정확한 RED: NumPy 2.5.2는 허용 tag가 `py3-none-any`뿐인 core resolver에서
  `PYPROC_PACKAGE_RESOLUTION`로 멈춘다. screenshot은 922 x 920으로 직접 확인했고 SHA-256은
  `16ce862b69982ce556a0b1a7c5e7bb4daa3d83775d2701e6a2982b8d7d7b1c0f`다.
- gate 이빨: workspace 치환을 무력화한 음성 변형은
  `generated _sysconfigdata__wasi_wasm32-wasi.py does not expose a canonicalizable build root`로 RED였다.
  복원 뒤 engine builder 계약과 설치 Edge 20/20은 GREEN이다.
- 다음 직렬 작업: source-pinned native package catalog를 정의하고 가장 작은 compiled extension을
  profile build, lock, resolver, transactional install, browser import까지 관통시킨다. 그 뒤 SIMD
  scientific profile을 추가하며 임의 PyPI native wheel 지원을 먼저 주장하지 않는다.
