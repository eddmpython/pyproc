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

## NEXT

ROI 순이고, 각 항목의 근거는 2차 재심사 목록이다.

1. **오류 메시지 언어 정책 전수 기계화**(DX 최대 항목). 게이트를 `src/**` 기본 RED + 단조 감소
   예산으로 역전하고, 공개 문서가 영문으로 지시하는 경로부터 비운다(session/processOs/runtime/
   state 208개 -> machine 322개). 게이트가 substring을 단정하는 곳은 같은 커밋에서 함께 옮긴다.
2. **웹컴퓨터 네트워크 배선**: 스위치는 완성돼 있고 컴퓨터에 꽂히지 않았다. pyproc guest에
   packet port를 주면 guest 간 IPC도 같은 계약으로 닫힌다(발명이 아니라 배선).
3. **없는 증거 3건**: fork/forkMany 성장 비대칭과 저널 성장 커밋, 가상 origin 경계 3계약
   (cookie/WS upgrade/SSE), GPU 셰이더 바이트 동일성(또는 비출하 결정).
4. **소비자 앱의 수명주기 10벌 제거**: `createWebComputer`에 `adoptMachines` 동사를 주고
   webComputerContext를 위임으로 축소한다(오류 타입이 이미 갈렸다: new Error vs WebMachineError).
5. **`tests/run.mjs` 분해**: fake를 `tests/support/`로, property 5절을 `tests/contracts/`로,
   `[구조]` 641줄을 4분할. 법 게이트 스코프를 tests/apps/scripts로 확장(자기 위반 3곳 해소).
6. **죽은 export 정리와 도달성 게이트**: 완전 죽음 3(requireJspi 포함), 파일 내부 전용 export 11,
   배럴 죽은 re-export 39. `./worker` subpath의 검증 0 지위 결정.
7. **대형 파일 축 단위 분해**(kernelElection 545줄 5관심사, v86GuestAdapter, indexedDbMachineStore).
8. **픽셀 출력 경로**: rgba 프레임을 화면에 그리는 소비 방향 렌더러가 저장소에 없다(캡처 방향만).
9. **워커에 사는 guest**: machine 층에 `new Worker`가 0건이라 두 guest가 한 스레드를 나눈다.
   2차 웹컴퓨터 감사가 "가장 ROI 높은 한 수"로 지목했고, 2·8을 그 뒤에 두면 재작업이 줄어든다.
