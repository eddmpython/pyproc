# 03. 진행 원장

## 2026-07-26

- 사용자 우선순위 6개를 단일 안정화 이니셔티브로 개설.
- 기존 미커밋 `toHostValue`와 asset 다중 source 변경을 입력으로 흡수.
- 공개 계약, EngineContract, RuntimeContract, reactive budget, Buildroot recipe, Experimental 동결을 배선.
- Runtime capability 조립을 state/service/environment cluster로 분리하고 중앙 직접 결합을 차단.
- contract suite 자동 발견, 공통 async-safe runner, 브라우저 HTML/실행 모듈 분리를 완료.
- reactive retention 정책과 실행 메커니즘을 분리하고 EngineContract conformance helper를 추가.
- Buildroot Linux 재현 workflow와 artifact 보존 경로를 추가.
- contract 5 suites, Node 구조, 타입, package, 브라우저 core, 제품 consumer, Web Computer gate green.
- Web Computer는 제품 consumer와 로컬 병렬 실행 시 owner wait timeout이 1회 발생했고 단독 재실행은 green. CI는 별도 job 격리를 유지한다.
- 첫 Buildroot workflow는 partial Git checkout 뒤 barebox package macro 평가에서 실패.
- 입력을 공식 release tarball SHA-256 고정으로 교체하고 clean source/output 재현 및 최소 artifact 보존으로 수리.

## 2026-07-26 (2차): 5표면 감사 착수

- 전문 심사관 5명(DX / 아키텍처 / 검증 / 웹컴퓨터 / 문서)에게 저장소 실물 대조를 맡겼다.
  점수와 지적, 실행 판정, 거부한 권고는 [04-audit-and-hardening.md](04-audit-and-hardening.md)가 정본.
- 착수 시점에 구조 게이트가 RED였다. Buildroot 계약 검사가 `upload-artifact@v4` 문자열을
  요구했고 workflow는 v7로 갱신돼 있었다. action major는 갱신되는 값이므로 계약이 아니다:
  검사를 "artifact 보존 배선 존재 + recipe 출력 이름과 workflow cmp 대상 일치"로 바꿨다.

## 2026-07-27: 경화 1~3파(게이트 무결성 -> 공개 표면 -> 정확성 사본)

- **커밋 메시지 규칙을 기계화**했다(사용자 우선순위 3). 판정 정본 `scripts/commitMessage.mjs`,
  집행은 `.githooks/commit-msg`, 이빨 증명은 `tests/run.mjs` `[커밋 규칙]` 절의 양성 2 + 음성 14.
  제목 형식·본문 필수·검증 줄 필수를 코드 있는 위반으로 판정한다. 첫 적용에서 규칙 자신이
  저장소 관례(`CI:` 분류)를 막아 한글 요건을 제목 단위로 좁혔다(과잉 규칙도 위반이다).
- **게이트 층 하한**을 신설했다. 이 층이 없을 때 `[election 프로토콜]` 절 전체를 지워도 GREEN,
  브라우저는 87개 중 80개를 지워도 7/7 GREEN이었다. 이제 섹션별/페이지별 하한이 문다.
- **무효 검사 4건**을 고쳤다. 순회 목록에서 자기를 제외하던 machine 오류 코드 검사, 깨진
  이스케이프 + includes 폴백으로 축소된 d.ts 선언 검사, 접두 substring이라 `openMachine`이
  `open`을 만족시키던 문서 표면 검사, 아무도 다시 타이핑하지 않을 문자열 1개만 보던 수치 검사.
  첫 항목 뒤에는 진짜 공백이 있었다: machine 층 오류 코드가 타입에 열거되지 않아 소비자가
  코드로 분기할 수 없었다 -> 92개 코드를 `WebMachineErrorCode` union으로 열거하고 실제 throw
  집합과 양방향 대조한다.
- **스코프 구멍**을 닫았다. em dash 게이트를 텍스트 표면 8확장자로 넓히고 훅 스코프와 기계로
  묶었다(갈라져 있어서 `scripts/*.mjs` 위반이 훅을 통과했다). 네이밍 검사에 apps/scripts,
  이름 형식 검사에 tests/examples/apps를 넣었다. 링크 게이트의 git 실패를 fail-closed로.
- **CI 배관**을 대칭으로 만들었다. publish가 ci를 `workflow_call`로 호출하고(예전에는 게이트
  8개 중 2개), 태그 검증의 `if` 조건을 제거했다(dispatch가 그 step만 건너뛰고 게시까지 갔고
  v0.0.10이 실제로 그 경로로 나갔다). action major를 저장소 전체에서 통일하고, 증거 유실
  무시와 죽은 워치의 침묵을 막고, pages 배포 앞에 구조 게이트를 세웠다.
- **문서 부패**를 수리했다. 소비자 문서 7곳이 0.0.10에서 사라진 루트 이름을 지시문으로 쓰고
  있었다(trustPermissions의 신뢰 체인 최소 흐름은 복붙하면 실행 불가였다). 부패 위치가 전부
  게이트 스코프 밖이었으므로 `publicSurface` 문서 대조를 추적 문서 전수로 넓히고 은퇴 식별자
  사전을 양방향 닫힘으로 세웠다.
- **`pyproc/runtime`의 `boot` 이름 충돌**을 `bootRuntime`으로 제거했다. 미게시 표면이라 지금
  형상을 바로잡는 비용이 0이었다. api.md는 이 subpath를 "은퇴"로 적고 있었는데 package.json과
  동결 문서는 안정 plumbing으로 두고 있어 문서끼리 반대 방향이었다.
- **공개 표면 정직성**: 상단 불릿에 성숙도 인라인, Delivered에서 게이트 0 표면 분리,
  Web Machine 소유 관계 정정, 설치 정책을 npm 정확 버전 핀으로, 미덕 재포장 3곳 제거,
  contractReality 열린 부채 3행 추가(게이트 0 출하 표면, 삭제 예정 폴더의 유일 증거,
  자동 커버리지 0인 machine owner 경쟁).
- **정확성 임계 경로의 사본**을 수렴했다. worker의 엔진 내부 직접 접근 3곳을 `MemoryCapability`
  뒤로(어댑터의 방어가 워커엔 없어 동작이 이미 갈려 있었다), 힙 물질화 법 4벌을
  `src/capabilities/heapMaterialize.js` 한 곳으로, 바이트/MB 단위 변환 사본 9곳을
  `memoryLayout`의 `bytesToMb`/`mbToBytes`로.
- **구조 게이트가 못 보던 종류를 하나 좁혔다.** 힙 물질화 수렴 중 `bytesToMb` import를
  빠뜨렸고 브라우저 게이트가 `ReferenceError`로 잡았다. "이 게이트는 미정의 식별자를 못 본다"의
  실제 대가였으므로, src가 export하는 이름을 호출하면서 import/선언이 없으면 RED가 되는
  검사를 신설했다(주석·문자열·템플릿 리터럴 제거 후 판정, 오탐 0 확인).

## 2026-07-27 (2): 경화 4파(소비자 진입 표면 + 없던 증거 + 방치 게이트 페이지)

- **진입 표면 수리**: boot의 미지 옵션 키 거부(오타 -> 무증상 비결정 부팅 경로 차단),
  machine.proc 머신당 memoize + machine.dispose() 신설(재마운트가 워커를 쌓던 누수),
  checkEnvironment·requireCoi·porcelain 문장 영문화, requireJspi 신설, IPC 4개 생성 지점과
  bootWasi에 COI 가드. README가 "암호 같은 SharedArrayBuffer 실패 대신 실행 가능한 에러"를
  약속하면서 그 경로들만 약속 밖이었다.
- **없던 증거 6개**를 브라우저 게이트에 세웠다: 옵션 오타 거부, 비결정 export 거부, 결정적 부팅의
  cp0 경계 동일성, 경계 이후 live 힙 분기, 풀 소진 수렴, mid-flight 워커 사망 수렴.
  cp0 경계로 측정한 근거는 실측이다: 같은 매니페스트 두 부팅의 live 힙 digest는 다르고(재시드가
  cp0 뒤에 도는 설계) 길이는 같았다(31457280B). README 2판의 주장도 경계 표현으로 좁혔다.
- **방치 게이트 페이지 15개**를 실행 경로에 올렸다(test:preflight, test:web-machine + CI 배선,
  x86 자산 레인은 test:web-machine:v86으로 로컬). 그 즉시 두 부패가 드러났다: preflightNoCoi는
  0.0.10 개명 이후 사라진 PyProc을 import해 아예 실행되지 않았고, ownerSuccessorProbe는 generation
  정체가 commit 주소로 바뀐 뒤에도 주입 리터럴을 기대했다. 후자가 죽은 필수 파라미터까지
  드러냈다: MachineCommitCoordinator의 idFactory는 저장만 되고 읽히지 않으면서 필수였다(제거).
- 구조 게이트에 "실행 경로 없는 게이트 페이지 0"을 신설해 이 부류의 재발을 차단했다.
- 전 게이트 상태: npm test 2176, 브라우저 94/94, preflight 5/5, web-machine probe 3/3(30+13+14),
  타입 green.

## 2026-07-27 (3): 2차 재심사와 경화 5파

2차 5표면 재심사(같은 기준, HEAD 실물): DX 58(직전 55), 아키텍처 63, 검증 66(직전 71에서 하락),
문서 64(직전 61), 웹컴퓨터 63(직전 58). 아키텍처와 검증의 하락은 회귀가 아니라 스코프 확대다:
1차가 열지 않은 표면(apps/, tests/run.mjs 내부, export 생존성, 비교자 결정성, CI 실행 순서)이
2차에서 열렸다. 점수와 남은 목록은 [04-audit-and-hardening.md](04-audit-and-hardening.md)에 산다.

- **내 게이트 2건이 죽어 있었다**(2차 감사의 최대 발견). 코덱 법과 결정성 스텁 법의 정규식에
  `\b` 대신 원시 U+0008이 들어가 절반이 아무것도 잡지 못했다. 그 법을 낸 커밋의 음성 시험이
  살아 있는 절반만 건드렸다. 바이트 단위로 수리하고 [제어문자] 절을 신설했다(텍스트 표면에
  TAB/LF/CR 외 제어문자 0). 음성 시험 3방향으로 이빨을 확인했다.
- **숫자 자랑 가드에 방향 편향**이 있었다("배" 뒤에 "빠"를 요구). 금지 표면에 배수 6건이 살아
  있었고(감속·실측·괄호형) 전부 능력·비용 문장으로 바꿨다. 배수 게시 자체가 금지다.
- **CI에서 가장 값비싼 증거가 구조적으로 RED**였다. test:web-machine이 WASI 자산 준비보다 앞에
  있어 실엔진 2종 교차 probe가 자산 없이 돌 상태였다. 순서를 고치고 "자산 요구 게이트는 준비
  step 뒤"를 게이트로 세웠다. 브라우저 하한에 CI 실행 페이지를 전수 등재했다.
- **내용주소 계산의 로케일 의존 비교자를 제거**했다. durable commit 주소가 localeCompare 정렬에
  의존해, 같은 상태가 환경에 따라 다른 주소를 낳을 수 있었다("같은 상태 = 같은 주소" 전제 위반).
  순수 계약(deterministicOrder)으로 옮기고 코덱 법에 localeCompare를 넣었다.
- **장치 열거·분리와 머신 제거 동사**를 host에 세웠다(listDevices/detachDevice/destroyMachine +
  usesDevice). machineId 영구 점유가 끝났고 hostContractProbe가 6검사로 문다(GREEN 36/36).
  createMachines 플래그는 제거를 거부했다: 세 호출부가 "머신은 image manifest에서 온다"는 모드를
  표현하고, destroyMachine으로 대체하면 어댑터를 만들어 버리는 낭비가 된다(근거를 주석에 남겼다).
- **문서 사실 오류**를 고쳤다. vision.md가 북극성 표면(createWebComputer)의 존재를 부정하고
  있었고, 레이어 모델이 세 문서에서 2세대 전 값(state·machine 없는 4층)이었고, bundleFormat이
  commit 필드를 "must be present"와 "is optional"로 동시에 규정했다. src 파일 헤더의 Layer 라벨
  24벌도 rank 맵으로 정렬하고 두 대조를 게이트로 세웠다.
- **병렬 동사의 _fn 계약**을 타입과 레퍼런스에 박았다(출하 문서만 보고 map을 쓸 수 없었다).
  게이트는 이름을 하드코딩하지 않고 worker.js에서 추출해 문서와 대조한다.
- **게이트 사각 2건**: contract suite가 개수만 세서 4개를 지워도 통과했고, 실행 경로 판정이
  주석도 실행으로 셌다. 목록 고정 + 실행 줄 한정으로 좁히고, "모든 test:* 레인은 CI에서 돌거나
  로컬 전용으로 근거와 함께 승인"을 신설했다.
- 진입 표면 메시지 영문화를 시작했다(preflight, porcelain, session 부활 거부, runtime 부팅 실패,
  fileSystem). 남은 약 500개는 NEXT에 있다: 게이트를 전수 기본 RED + 단조 감소 예산으로 역전하는
  것이 2차 감사의 권고이고 그 방향이 옳다.

## 2026-07-31: NEXT 1~3 처리와 성장 경로 게이트

- **1(오류 메시지 언어)과 2(웹컴퓨터 네트워크 배선)는 이미 처져 있었다.** 실물 확인: 언어 게이트는
  예산 단계를 끝내고 `src` 전수 하드 0이고(메시지·d.ts·채택 문서·데모 주석 4표면), 스위치는
  `createWebComputer`가 두 guest에 `packetDeviceName`으로 꽂는다. 목록이 실물보다 뒤처져 있었다.
- **3(없는 증거 3건)을 닫았다.** 힙 성장 경로 3검사(fork 성장 비대칭 2 + 자란 세대 커밋 1),
  가상 origin 경계 3계약(cookie/WS upgrade/SSE), WGSL 셰이더 바이트 동일성 10검사. 전부 음성
  시험으로 이빨을 확인했다(growHeapTo 제거, dedup 분기 제거, 타일 상수 변경, 미등재 커널 추가).
- 가상 origin의 세 경계는 전부 **거짓으로 밝혀진 소비자 전제**였다: 쿠키는 저장되지 않고,
  WebSocket은 커널에 닿지 않으며, SSE는 스트리밍이 아니라 핸들러가 끝난 뒤 통째로 온다.
  capabilityMatrix의 "별도 검증 필요" 문장을 그 실측으로 바꿨다.
- GPU는 헤드리스에 어댑터가 없어 바이트 동일성이 상한이다. 그 한계를 절 머리에 명시했다:
  잡는 것(커널 무단 변경·치환 회귀·미등재 커널)과 못 잡는 것(GPU에서의 값 정확성)을 나눠 적었다.
- 전 게이트 상태: npm test 3504, 브라우저 108/108, 소비자 33/33, web-machine 5/5 probe, 타입 green.

- **NEXT 1(소비자 앱 수명주기 10벌)과 3(죽은 export)을 닫았다.** 전자는 createWebComputer에
  adoptMachines를 주고 앱을 위임으로 줄였다(동사 하나의 부재가 사본 아홉을 낳고 있었다). 후자는
  14건 중 10건을 un-export, 2건 삭제, 2건은 사본의 증거였다(JSPI 판정이 두 곳). 둘 다 재발
  차단 게이트를 함께 냈다: [컴퓨터 조립] 4검사, [export 도달성] 1검사, 각각 음성 시험 통과.

- **프록시 한계를 근본 원인까지 몰았다.** revivedSurfaceProbe 열 케이스 이분: 내보낸 커널이 cp0
  이후 JS 프록시를 하나라도 만들면 그 이미지로 부활한 커널의 프록시 경로가 전부 트랩한다. 표면
  제거·유지·재컴파일·재설치 어느 것도 안 듣고, 트랩은 이미지가 나른 핸들을 덮어쓰는 순간 난다.
  브라우저 게이트가 이 한계를 고정하고(풀리면 RED) 계약 실태 표에 부채로 올렸다. 가장 유력했던
  수리안(cp0 이전 설치)은 실측으로 기각했다: 부기는 실제로 일치했는데도 트랩은 남았다.
- **NEXT 3(픽셀 출력 경로)을 닫았다.** CanvasRgbaFrameSink로 소비 방향을 열고 무자산 CI 레인
  (hostContractProbe)에 3검사를 세웠다. 프레임버퍼가 "만들어지지만 아무도 못 보는" 장치를 벗어났다.

- **프록시 한계의 수리안을 실측으로 확정했다(2026-08-01).** 케이스 M: 이미지가 프록시를 나르면
  부활 커널이 **다른 이름으로 새로 만든** 프록시조차 트랩한다(hiwire_get is falsy). 이미지가
  Pyodide 핸들 할당기 상태를 통째로 나르기 때문이고, 그래서 "이미지 것은 안 건드린다"는 싼 규율은
  없다. 케이스 O: 프록시 0인 값 경계 표면(순수 파이썬 큐 + run 인자/반환값)은 이미지를 그대로
  건넌다. 장치 표면을 프록시에서 값으로 옮기는 것이 남은 유일한 길이고 NEXT 1번이 됐다.

## 2026-08-01: 프록시 한계를 정면으로 닫았다

- **옮길 수 있는 표면은 옮겼다.** packet port와 권한 감옥이 값 경계가 됐다: 파이썬은 순수
  자료구조만 들고, 바이트는 run()의 인자와 반환값으로, 정책은 소스에 구운 리터럴로 건넌다.
  부활한 guest가 자기 packet 장치를 그대로 쓰는 것을 CI가 문다(guestNetworkProbe 12검사).
- **못 옮기는 표면은 경계를 명시했다.** 블로킹 표면(input() 뒤의 syscall 다리, socket, GPU)은
  파이썬을 JS 응답에 걸어 세우는 것이 목적이라 핸들이 구성상 필요하다. 그래서 exportImage와
  save가 그런 힙을 거부하고(PYPROC_IMAGE_PROXY_SURFACE) 어느 표면이 핸들을 심었는지 이름으로
  말한다. { allowHostProxies: true }가 명시 승인이고, 랜딩 데모가 그 첫 소비자다.
- **엔진 층 한계 자체는 게이트가 지킨다.** 트랩이 사라지면(엔진이 고쳐지면) 그 게이트가 RED가
  되어 문서와 주장을 함께 고치게 만든다. 계약 실태 표의 행도 그 형태로 다시 썼다.
- 전 게이트: npm test 3525, 브라우저 110/110, 예제 10/10, 소비자 33/33, web-machine 5/5,
  웹컴퓨터 13/13, MCP 7/7, 타입 green.

## 2026-08-01 (2): 외부 감사가 이식성 계약의 구멍 셋을 잡았다

전문 에이전트에게 세 주장을 반증하라고 맡겼고, 셋 다 부분 반증됐다. 고친 것과 남긴 것을 나눈다.

- **고쳤다(내가 만든 회귀 3건).** 저널 WAL이 판정 없이 커밋했다(recover가 새 커널로 되살리므로
  같은 전제가 필요하다) -> 판정을 `src/capabilities/imagePortability.js` 한 곳으로 모으고 세
  입구가 전부 그것을 쓴다. 감옥 리터럴이 `String()` 강제로 JS 판정과 갈라졌다(net: [8080]에서
  JS는 거부, 파이썬은 허용) -> 판정 대상을 그대로 굽는다. 랜딩 데모의 export 버튼이 승인 없이
  던졌다(잠들기만 고쳤다) -> 같은 승인 경로를 탄다.
- **고쳤다(포트 3건).** 표면 설치를 멱등으로 만들어 재부착이 이미지가 나른 큐를 지우지 않게,
  펌프가 성공한 뒤에 큐를 비우게(던지면 프레임이 사라졌다), 시간여행이 설치 이전으로 되감겨도
  펌프가 모든 요청을 죽이지 않게(표면이 없으면 다시 심는다).
- **남겼다(부채로 등재).** 핸들은 `setGlobal` 밖으로도 들어온다(`import js`, `rt.raw()`,
  워커의 직접 `globals.set`): 지금 계수는 바닥이지 증명이 아니다. 감옥의 이미지 왕복에는 아직
  CI 증거가 없다: 브라우저 게이트 페이지가 시간 예산 끝이라(부팅 둘을 더하니 240s 러너 타임아웃)
  전용 probe가 필요하다. 둘 다 계약 실태 표에 행으로 올렸다.
- 트랩 단정도 좁혔다: 아무 예외나 통과하던 것을 함수 테이블/hiwire 서명으로 못 박았다.

## 2026-08-01 (3): 워커 guest가 졸업 게이트 다섯을 전부 통과했다

- 값 경계 이전 뒤 캠페인 probe가 **17/17 GREEN**이다. in-process 통제군 둘도 통과한다: 부활한
  guest가 packet 표면을 그대로 쓴다(이 캠페인이 열어젖힌 그 결함이 src에서 닫혔다).
- 워커도 턴 경계 펌프를 배웠다. 값 경계는 바이트를 턴 경계에서 옮기고, 워커에도 같은 두 모서리가
  있으므로 in-process 어댑터와 같은 자리다(정직한 대칭이지 특수 케이스가 아니다).
- **src 배치의 형태는 정해졌다(열린 질문 아님).** 후보가 `createRpcPort`를 import하는데 machine
  층 법이 그것을 금지한다(guest는 순수 계약만, machine 밖 import는 composition만). 그래서 형태는
  이미 출하 어댑터가 쓰는 것과 같다: **composition이 platform 조각을 주입한다**
  (`createPyprocGuestFactory`가 bootSession/openMachine을 받는 것과 같은 패턴). 졸업 커밋은
  `createWorkerHostedGuestFactory({ createPort, workerURL })` + 워커 파일 동거(같은 폴더 자산 URL)
  + CI 레인 probe다.
- 이식성 계약의 남은 부채도 하나 닫고 하나 좁혔다: 전용 probe(imagePortabilityProbe, CI 레인
  6/6)가 감옥의 이미지 왕복을 물고, 핸들 유입구는 승인 지점 표로 고정됐다(우회가 새로 생기면 RED).

## NEXT

ROI 순이다. 파일 분해류가 뒤인 이유는 그것이 유지보수이고, 앞의 하나는 북극성 축과 최고 ROI
캠페인을 동시에 막고 있던 능력 문제의 마지막 조각이기 때문이다.

1. **워커 guest를 src로 배치**: 행동은 전부 증명됐다(17/17). 남은 것은 층 법 아래 놓는 일이다:
   composition 주입 형태로 어댑터를 옮기고, 워커 파일을 같은 폴더에 두고, CI 레인 probe로 캠페인
   probe의 단정을 옮긴 뒤 캠페인 폴더를 지운다.
2. **`tests/run.mjs` 분해**: fake를 `tests/support/`로, property 5절을 `tests/contracts/`로,
   `[구조]` 641줄을 4분할. 법 게이트 스코프를 tests/apps/scripts로 확장(자기 위반 3곳 해소).
3. **대형 파일 축 단위 분해**(kernelElection 545줄 5관심사, v86GuestAdapter, indexedDbMachineStore).
