# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

### 2026-07-13 조작 능력 체크: 신뢰 입력 + 실제 조작 + 다중 세션 (게이트5-7 GREEN 16/16)

- Phase 1의 핵심 조작 프리미티브를 실측으로 앞당겨 확인했다(구현은 나중에 능력 계약으로 승격).
- **게이트5 신뢰 입력**: chrome.debugger `Input.dispatchMouseEvent`(버튼 중심 좌표 계산 후 press+release)가
  `isTrusted=true` 이벤트 생성 = **봇 방어의 isTrusted 검사 통과**. 가짜 `dispatchEvent`(isTrusted=false)와 격차.
- **게이트6 실제 조작**: `Input.insertText`가 입력칸 값을 실제로 바꿈(hello42). navigate/evaluate를 넘어 쓰기 조작.
- **게이트7 다중 세션 병렬**: 파이썬 `asyncio.gather`로 두 CDP 왕복 동시(각 새 탭) -> 222/444 정확. 프로세스
  OS의 워커 N = 세션 N 기초 실동(물리 chrome.debugger는 SW 큐로 직렬화되나 논리 병렬·결과 정확).
- **의미**: 스텔스(무신호 경로 + 선제 개입) + 신뢰 입력(isTrusted) + 다중 세션이 다 섰다 = "탐지 안 걸리는
  신뢰 입력 자동화 + 프로세스 OS 병렬"의 기술 리스크가 실측으로 제거됨. 남은 자동 체크: 쿠키 분리(non-COI 셸),
  frame-busting 무력화.

### 2026-07-13 iframe 역전 실측 GREEN + COEP 긴장 발견 (bootIsolationRunner 게이트4)

- 고정 화면 층위 C(iframe 역전)를 실측했다. `X-Frame-Options: DENY` 페이지가 규칙 없이는 iframe 차단(false),
  declarativeNetRequest로 헤더 제거 + `credentialless`(COEP 우회) 후 로드 성공(true, 내부 postMessage 수신).
  GREEN 13/13. **임의 cross-origin 사이트를 셸의 iframe 창에 담을 수 있다** = 페이지 navigate와 무관한 고정 셸.
- **실측이 드러낸 핵심 긴장**: 프로세스 OS는 crossOriginIsolated(COEP require-corp) 요구인데 그런 문서의
  cross-origin iframe은 COEP로 막힌다. `credentialless`로 넘었으나 **쿠키 격리**(로그인 세션 미실림) = 스텔스의
  실 프로필 축과 어긋남.
- **해결(설계 확정)**: 셸(iframe 담는 non-COI 문서, sidePanel/탭)과 런타임(프로세스 OS, COI offscreen)을 다른
  문서로 분리. 층위 A(영속 호스트)와 층위 C가 자연히 다른 문서라 정합. Phase 2에서 분리 형태 확정 + 쿠키 실림
  재실측.
- **의미**: browser-os와 browser-control의 융합점을 실측으로 짚었다(셸 고정 + 사이트는 창). 킬러 기능의 기술
  실현성 확인 + 정직한 제약(COEP/쿠키) 발견.

### 2026-07-13 고정 화면(영속 셸) 설계: iframe 역전 + 헤더 제거 (설계 착수)

- "앱이 탭에 살아있으면 페이지가 바뀌어도 고정 화면 유지"를 3층위로 설계했다(01-architecture 영속 셸 절):
  층위 A 영속 호스트(offscreen + sidePanel, 이미 우리 구조) / 층위 B 페이지 위 오버레이(content script 재주입,
  상태는 A에) / 층위 C iframe 역전.
- **킬러 = iframe 역전**: 앱 셸이 최상위, 대상 사이트를 iframe(창)에. 페이지가 iframe 안에서 navigate해도 셸
  불변. 확장 링이라 `X-Frame-Options`/CSP frame-ancestors를 제거할 수 있어(declarativeNetRequest/CDP Fetch)
  임의 사이트를 담는다. Playwright는 브라우저 밖이라 이 역전 불가.
- **관건 실측(Phase 2 게이트)**: `X-Frame-Options: DENY` 사이트가 헤더 제거 후 iframe에 로드되는지 +
  frame-busting JS 무력화. 경계: cross-origin DOM 접근 제한(확장 content script + CDP로 우회), 강방어 사이트는
  온전히 안 담길 수 있음.
- **의미**: browser-os(웹 위 OS)와 browser-control(브라우저 조작)의 융합점. 셸은 고정, 사이트는 그 안의 창.

### 2026-07-13 스텔스 심화: 페이지 상위 선제 개입으로 webdriver 덮기 (bootIsolationRunner 오버라이드 GREEN)

- "페이지 JS를 막을 수 있지 않나"라는 방향을 실측으로 확증했다. 정확히는 "막기"가 아니라 **"페이지보다 먼저
  값을 조작하기"**다. 확장은 페이지 JS보다 먼저 실행할 수 있는 위치라 가능하다.
- **실측(bootIsolationRunner 오버라이드)**: 하네스가 포트로 `navigator.webdriver=true`인 최악 조건에서, CDP
  `Page.addScriptToEvaluateOnNewDocument`로 `navigator.webdriver` getter를 페이지의 어떤 스크립트보다 먼저
  undefined로 덮으니 페이지 읽힘값 off=true -> **on=undefined**. 진짜 켜진 표시등을 껐다.
- **의미**: chrome.debugger 경로의 유일한 약점(webdriver 노출)까지 이 선제 개입으로 덮인다 = 신뢰입력이 필요해
  debugger를 써야 할 때도 표시등을 끌 수 있다. content script 경로(baseline false) + 선제 개입 = 이중 방벽.
- **정직한 경계**: 표면 값만 끈 것. 정교한 탐지는 오버라이드 자체를 되검사(네이티브 getter 여부, iframe 원본
  대조)할 수 있고, 서버측(TLS 지문/IP 평판/행동)은 페이지 조작으로 못 넘는다. puppeteer-stealth 동급의 한 수 +
  확장이라 모든 페이지에 영속 적용. 완전 스텔스는 단일 기법이 아니라 층위(선제 조작 + 실 프로필/IP/하드웨어 +
  행동 자연성)로만.

### 2026-07-13 스텔스 인과 격리: content script webdriver 미점화 논리 확정 (webdriverCauseRunner GREEN)

- Phase 0-b(스텔스)가 "수동 전용"인 줄 알았으나, **인과 격리로 핵심을 자동 확정했다**. bootIsolationRunner의
  "두 경로 다 webdriver=true"가 하네스 오염이라는 가설을, 확장·조작 없이 크롬을 조건별로 켜서 직접 검증.
- **실측(webdriverCauseRunner, Edge 150 headless, GREEN)**: 평범 실행 `webdriver=false`, `--remote-debugging-port`
  추가 시 `true`, `--enable-unsafe-extension-debugging`은 추가 영향 0. **범인 = 원격 포트 플래그 단독**(조작
  경로가 아니다).
- **결론(논리 확정)**: webdriver를 켜는 유일 범인이 포트 플래그이고, 실배포(정상 설치)엔 그 플래그가 없으며,
  content script 경로는 CDP를 안 쓰므로 -> **실배포에서 content script 경로는 webdriver를 안 켠다**. 스텔스
  우위의 핵심 근거가 수동 실측 없이 섰다.
- **잔여 수동(축소됨)**: chrome.debugger `attach`가 실배포에서 그 탭 webdriver를 켜는지(포트와 별개인 attach
  자체 효과, 설계상 신뢰입력 전용 경로라 노출 감수 이미 표기) + 실제 봇 방어(Cloudflare/DataDome 등) 통과 여부.
  Phase 0 착수 정당성은 이 자동 확정으로 확보됨(스텔스 논거 붕괴로 접을 리스크 크게 감소).

### 2026-07-13 이니셔티브 개시: attempts 3게이트 GREEN + ROI 재검 + Phase 0 게이트 설정

- attempts 캠페인 [browserControl](../../tests/attempts/browserControl/README.md)이 링 1(MV3 확장)의 세 게이트를
  브라우저 실측으로 통과시킨 뒤, 그 실측을 승격 가능한 이니셔티브로 개설했다.
- **실측 접지(bootIsolationRunner, Edge 150 headless, GREEN 9/9)**:
  - 게이트 1(부팅): offscreen에서 vendor 번들 Pyodide 부팅 2.5-3.0s + `runPython(1+1)==2`. 원격 코드 금지는
    자산 번들 + `'wasm-unsafe-eval'` CSP로 통과. 백채널 포트는 조립 시점 `config.js` 주입(CDP evaluate 주입은
    SW 실행 컨텍스트 불안정로 폐기).
  - 게이트 2(격리): manifest COEP/COOP 키 -> `crossOriginIsolated===true`. SAB + module Worker + Atomics
    왕복(view0=42) + JSPI(`runPythonAsync==42`). **프로세스 OS가 확장에 통째로 실림**(최대 미검증 지점 해소).
  - 게이트 3(조작): 파이썬 -> chrome.debugger 새 탭 attach -> `Page.navigate` -> `Runtime.evaluate`가
    title/DOM marker/계산 42 회수, 왕복 405ms.
- **스텔스 실측(측정 + 한계)**: chrome.debugger 경로 `navigator.webdriver=true`(Playwright 대표 신호와 동일).
  content script 경로도 하네스 안에선 true = **하네스 오염**(러너가 확장 로드에 쓴 `--remote-debugging-port`가
  webdriver를 브라우저 전역으로 켬, ws close 후에도 유지). **경로별 스텔스 대비는 자동 하네스로 실측 불가** =
  정상 설치 확장 headed 수동 실측 영역(GPU 창모드와 같은 계급). `--load-extension`은 137+ 제거 + headless SW
  미기동이라 자동 스텔스 경로도 없음.
- **사전 게이트 0(로딩 경로)**: `--load-extension` 죽음(Chrome 150 신호 0). 확장 로딩은 CDP
  `Extensions.loadUnpacked` + `--enable-unsafe-extension-debugging` 단일 경로 확정.
- **정합성·ROI 재검(정직)**: 이건 코어 격차가 아니라 **새 응용 축**이다. 마찰 실재(웹스토어 심사, 번들 13MB+,
  인포바 UX, 스텔스 미검증, 새 소비 표면 수요 불확실). 그래도 하는 논거 = 프로세스 OS/스냅샷/SAB/JSPI 자산
  재사용 + 인탭 AI 에이전트 시장 정합 + 유일 포지션("서버리스 · 프로세스 내 · 실 프로필 · 되감기 자동화").
  **판정: 착수하되 Phase 0가 게이트.** 스텔스 RED + 실 프로필 논거도 약하면 접는다. 상세
  [00-product-vision](00-product-vision.md) ROI 절.
- **아키텍처 방향 확정**: offscreen(런타임 호스트) + SW(권한 소유) 두 컨텍스트. pyproc 세 조각 =
  `browserBridge`(능력, enableBrowserControl) + `browserHost`(SW 브리지) + offscreen 부트스트랩. 이중 경로
  (`mode=script` 스텔스 / `mode=debugger` 신뢰입력). 프로세스 OS 대응(워커 N = 세션 N, 스냅샷/fork = 세션
  되감기)이 Phase 2 프론티어 차별점. 상세 [01-architecture](01-architecture.md).
- **문서 상태**: README/00/01/02/03 초안 완비(자기충족 목표). Phase 1 파일 경계(browserBridge/browserHost)는
  Phase 1 승격에서 attempts 실측 형태로 확정(의도적 게이트, placeholder 아님).

### NEXT

1. **Phase 0-b 스텔스**: 핵심(content script webdriver 미점화)은 webdriverCauseRunner로 자동 확정됨. 잔여 =
   chrome.debugger `attach`의 실배포 webdriver 효과 + 실 봇 방어 통과. 이건 정상 설치 확장 수동 검증(선택,
   착수 정당성엔 불필요 = 스텔스 논거는 이미 섰다).
2. **Phase 0-a 마무리**: offscreen 부트스트랩 + SW host 형태로 리팩터해도 부팅 유지되는지(소비자 셸 계약 형태).
3. Phase 0 GREEN -> **Phase 1**: `BrowserControl` 능력 최소 표면(tab/navigate/evaluate/click/type) attempts
   확정 -> `src/capabilities/browserBridge.js` + `src/processOs/browserHost.js` 승격 + index/d.ts/README + `npm test`.
4. Phase 0 RED(스텔스 + 실 프로필 논거 붕괴) -> 결론 원장 기록 + attempts 폴더 삭제 + 이니셔티브 `_done` 이관(폐기).
   스텔스 자동 확정으로 이 경로 리스크는 크게 감소.

## 재개 지침

- 활성 이니셔티브는 이것 하나다. mainPlan 활성 표에 등록됨.
- attempts/browserControl 폴더는 캠페인 살아있는 동안 유지(Phase 0-b 수동 실측 가이드가 여기 붙는다).
- 자동 실측은 `node tests/attempts/browserControl/bootIsolationRunner.mjs`(headless GREEN). 스텔스만 수동.
