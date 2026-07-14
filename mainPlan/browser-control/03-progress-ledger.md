# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

### 2026-07-14 Phase 11: 접근성 트리(role/name 시맨틱 회수) 실측 GREEN + src 승격

에이전트가 DOM 셀렉터 대신 의미(role/name)로 페이지를 이해한다. attempts 게이트23, `bootIsolationRunner` **57/57 GREEN**.

- **accessibilityTree**: `Accessibility.getFullAXTree`로 role/name/value 노드 목록을 회수(무-role 노드 제외).
  게이트23: 타깃 페이지가 54노드로 잡히고 role에 button/textbox/combobox/link/form/list/option 등, button 이름
  ["click","dialog","파일 선택","far"]. 시맨틱 네비게이션(button "Submit" 찾기 등)이 성립.
- **src 승격**: protocol/host + browserControl.js + index.d.ts + contract.md. 실 src 픽스처에 접근성 슬라이스
  추가 -> **GREEN 6/6**(axCount=41, axButton=true). `npm test` **568 green**.

### 2026-07-14 Phase 10: 콘솔/에러 캡처(페이지 로그·에러 관측) 실측 GREEN + src 승격

AI 에이전트가 페이지가 무엇을 로그·에러냈는지 본다. attempts 게이트22, `bootIsolationRunner` **56/56 GREEN**.

- **enableConsole/consoleLogs/waitForConsole**: `Runtime.consoleAPICalled`(console.log/warn/error/info) +
  `Runtime.exceptionThrown`(미처리 예외)를 관측한다(Network 응답 로그와 같은 이벤트-버퍼-폴 패턴). 게이트22:
  console.log('pyprocLog', 42) -> "pyprocLog 42", console.error -> type "error", 미처리 throw -> type "exception"
  (세 종류 다 잡힘).
- **미처리 예외 텍스트**: exceptionDetails.text는 보통 "Uncaught"만이고 실제 메시지는 exception.description에
  있어 둘을 합쳐 로그(실측이 드러냄).
- **src 승격**: protocol/host(단일 이벤트 라우터에 두 줄 추가) + browserControl.js + index.d.ts + contract.md.
  실 src 픽스처에 콘솔 캡처 슬라이스 추가 -> **GREEN 6/6**. `npm test` **568 green**.

### 2026-07-14 Phase 9: 다운로드 관측(무엇이 다운로드되는가) 실측 GREEN + src 승격

파일 스크래핑/내보내기 자동화. attempts 게이트21, `bootIsolationRunner` **55/55 GREEN**.

- **enableDownloads/waitForDownload**: `Page.downloadWillBegin`(다운로드 시작 이벤트)로 파일명/URL을 관측한다.
  attachment 링크를 신뢰 클릭 -> downloadWillBegin -> waitForDownload가 {filename, url, state} 회수(게이트21:
  filename=report.txt, url=/downloadFile).
- **정직한 컷(실측이 드러냄)**: `Page.setDownloadBehavior`(저장 경로 지정)는 이제 **browser-level 명령**이라
  chrome.debugger tab-session에서 "Cannot access browser-level commands"로 막힌다(지오로케이션 grantPermissions와
  같은 벽). 그래서 저장 경로는 안 두고 **관측만** 싣는다(무엇이 다운로드되는지 = 파일명/URL은 유용, 실제 저장은
  브라우저 기본 동작). 이벤트는 setDownloadBehavior 없이도 뜬다(실측 확인).
- **src 승격**: protocol/host + browserControl.js(enableDownloads/waitForDownload) + index.d.ts + contract.md.
  실 src 픽스처에 다운로드 관측 슬라이스 추가 -> **GREEN 6/6**. `npm test` **568 green**.

### 2026-07-14 Phase 8: 파이썬 워커 N=세션 N 진짜 병렬(프로세스 OS x 브라우저 컨트롤 융합) 실측 GREEN + src 승격

vision이 지목한 최대 차별점을 **진짜 Pyodide 인터프리터로** 실증. attempts 게이트20, `bootIsolationRunner` **54/54 GREEN**.

- **실증(게이트20)**: 워커 2개가 각자 Pyodide를 부팅(offscreen COI 상속 = SAB/JSPI 생존)하고, run_sync(JSPI)로
  브라우저 op를 블로킹하면서 offscreen 라우터(제약 A 우회: chrome.runtime 대신 postMessage)로 자기 세션을 몬다.
  각 워커가 CPU 연산(total=19999900000, 자기 GIL) + 자기 label을 자기 탭에 쓰고 되읽어 **격리**(workerA/workerB
  안 섞임) + **병렬**(Promise.all 동시 부팅·실행) 확인. 게이트12(plain JS 워커 라우터)를 진짜 파이썬 인터프리터로 격상.
- **의미**: 워커 N = 독립 인터프리터 N = 독립 GIL N = 세션 N. 파이썬 연산은 물리 병렬, 브라우저-op은 SW 단일
  CDP 큐로 직렬(정직한 천장). Playwright/browser-use가 구조적으로 못 하는 축(인탭·서버리스·N코어 파이썬 자동화).
- **src 승격(재사용 조각)**: `routeBrowserWorker(worker)`(offscreen 릴레이) + `installBrowserWorker(py)`(워커 측
  배선, `_pyprocBrowserSend`를 postMessage로 + pyprocBrowser 모듈 실행)를 browserControl.js에 + index.js/index.d.ts
  공개 표면 + contract.md 융합 패턴. 워커 측 파이썬 조작 모듈은 offscreen과 동일 소스(SSOT). 실 src 픽스처에
  Pyodide 워커(pyWorker.js)가 실 src installBrowserWorker로 자기 세션을 모는 회귀 추가 -> **GREEN 6/6**.
  `npm test` **568 green**(README 공개 표면 게이트 = 두 export 언급).

### 2026-07-14 Phase 7: 에뮬레이션 심화(다크모드·타임존·오프라인) 실측 GREEN + src 승격

페이지가 실제로 관측하는 환경을 스푸핑. attempts 게이트19(a-c), `bootIsolationRunner` **53/53 GREEN**.

- **emulateMedia**: `Emulation.setEmulatedMedia`로 prefers-color-scheme(dark/light) 등. 검증: matchMedia 관측값
  전환(게이트19a).
- **setTimezone**: `Emulation.setTimezoneOverride`. 검증: `Intl.DateTimeFormat().resolvedOptions().timeZone` ==
  Asia/Seoul(게이트19b, 라이브).
- **setOffline**: `Network.emulateNetworkConditions`. 검증: navigator.onLine true<->false 전환(게이트19c).
- **정직한 컷(실측이 드러냄, 안 싣는다)**: (1) **setGeolocation** = `Emulation.setGeolocationOverride`는 좌표를
  덮지만 `Browser.grantPermissions`(권한 부여)가 chrome.debugger tab-session에서 Browser 도메인 미접근이라 안 먹혀
  getCurrentPosition이 PERMISSION_DENIED. 권한 부여 경로가 없으면 무용이라 제거. (2) **setLocale** =
  `Emulation.setLocaleOverride`가 Edge CDP에서 navigator.language/Intl에 반영 안 됨(항법 후에도 ko 유지). 검증
  불가라 제거. 게이트 통과 못 하는 건 승격 안 한다(졸업 게이트 원칙).
- **src 승격**: protocol/host + browserControl.js(emulateMedia/setTimezone/setOffline) + index.d.ts + contract.md.
  실 src 픽스처에 에뮬 슬라이스 추가 -> **GREEN 5/5**. `npm test` **562 green**.

### 2026-07-14 Phase 6: 프레임 traversal(same-origin iframe 내부 조작) 실측 GREEN + src 승격

고정 화면 셸이 사이트를 iframe에 담는 비전과 직결되는 프레임 드릴다운. attempts 게이트18(a-c), `bootIsolationRunner`
**50/50 GREEN**.

- **frames/frame**: `frames()`가 `Page.getFrameTree`로 프레임 목록(톱 + 자식), `frame(url=/name=)`이 프레임 핸들
  (`Frame`)을 돌려준다. Frame op는 `Page.createIsolatedWorld`로 프레임별 isolated world contextId를 즉시 얻어
  (executionContextCreated 이벤트 추적 불필요 = 강건) 그 컨텍스트에서 `Runtime.evaluate`.
- **프레임 내부 표면**: evaluate/text/html/attr/value/exists/count + click(element.click())/type/fill(value setter)/
  waitFor. isolated world는 DOM 공유·페이지 JS 변수 격리라, 클릭 검증은 window 플래그가 아니라 DOM 변경으로 관측
  (게이트18c: 자식 프레임 버튼 클릭 -> cmarker 텍스트 변경). fill/value/text/exists/location.pathname 전부 성립.
- **카빙**: `evaluate(expr, frameId?)`에 frameId 옵션만 추가(기존 호출 무영향), 프레임 문맥 op는 `frameOp` 단일
  진입 + 내부 verb 분기(frameWorlds 캐시). protocol op 2개(frames/frameOp)만 는다.
- **정직한 경계(실측이 드러냄)**: cross-origin iframe은 site isolation으로 **OOPIF(별도 프로세스)** = 메인 세션
  `getFrameTree`에 안 잡히고 createIsolatedWorld 불가(localhost/127.0.0.1 자식 실측: count=1). cross-origin 프레임
  드릴다운은 `Target.setAutoAttach(flatten)` + per-frame 세션이 필요한 별개 축. **현재는 same-origin 프레임 전용**으로
  명시(index.d.ts/contract.md). 대부분의 임베드 앱/에디터는 same-origin이라 실사용 가치 있음.
- **src 승격**: protocol/host + browserControl.js `Frame` 클래스 + index.d.ts `BrowserFrame` 인터페이스 + contract.md.
  실 src 픽스처에 프레임 드릴다운(text/fill/value) 회귀 추가 -> **GREEN 5/5**. `npm test` **559 green**.

### 2026-07-14 Phase 5: 네트워크 심화(콜백형 held routing·요청 변조·응답 바디) 실측 GREEN + src 승격

Phase 4 네트워크 가로채기를 요청 단위 동적 제어까지 밀었다. attempts 게이트17(a-e) 신설, `bootIsolationRunner`
**47/47 GREEN**.

- **요청 변조**: `route(pattern, "modify", url=/method=/headers=)`가 나가는 요청의 헤더 주입(원본과 병합)/URL·
  메서드 교체 후 continue. 콜백 없이 선언형으로 요청을 바꾼다(게이트17a: 헤더 주입 서버 반영).
- **콜백형 held routing**: `route(pattern, "hold")`가 매칭 요청을 붙잡아 두고(resolve 안 함), Python이
  `pendingRequests()`로 관측한 뒤 `continueRequest`/`fulfillRequest`/`abortRequest`(요청 id로)로 동적 결정한다.
  이것이 "요청마다 Python이 판단"의 블로킹 모델 정합 실현이다(게이트17b/c/d: continue 실제 응답 / fulfill 정적
  주입 / abort 취소). **정직한 경계**: 단일 스레드라 블로킹 navigate가 기다리는 메인 문서 하위요청을 hold하면
  교착 = held는 비-항법 XHR 대상. 이 제약은 계약/타입에 명시.
- **응답 바디 캡처**: `responseBody(pattern)` = `Network.getResponseBody`(URL 부분일치 최근 응답). 스크래핑에서
  응답 원문 회수(게이트17e).
- **카빙 유지**: `_handleFetch`의 action 분기에 modify/hold 두 줄, held 결정은 driver 메서드 5개(단일 heldRequests
  맵). 헤더 변환/base64는 module 헬퍼(`toHeaderList`/`b64`)로 공유. dispatch에 op 5개 추가.
- **src 승격**: protocol/host + browserControl.js 파이썬 표면 + index.d.ts(held 교착 경계 주석 포함) + contract.md.
  실 src 픽스처에 held fulfill + responseBody 회귀 추가 -> **GREEN 5/5**. `npm test` **559 green**(파이썬 식별자
  camelCase 가드: `waitPending`).

### 2026-07-14 Phase 4: 실전 자동화 강력 배치(다이얼로그·업로드·네트워크 가로채기) 실측 GREEN + src 승격

Phase 3 표면 위에 "실제 사이트에서 진짜 돌아가는" 데 필요한 배치를 더했다. attempts 게이트16(a-g) 신설,
`bootIsolationRunner` **42/42 GREEN**.

- **자동 스크롤**: 좌표 입력(click/hover/dbl/right) 전에 `scrollIntoView`를 내장해 폴드 아래 요소도 신뢰 클릭이
  맞는다(게이트16a: top:2000px 버튼 클릭 성립). 명시 `scrollIntoView(selector)` op도 노출.
- **다이얼로그 자동 처리**: alert/confirm/prompt는 렌더러를 멈춰 자동화를 영구 행시킨다. driver당 단일 이벤트
  라우터(`_onEvent`)가 `Page.javascriptDialogOpening`을 세션 정책(`setDialogHandler(accept, promptText)`)으로
  즉시 응답 + 메시지 기록(`lastDialog`). 게이트16b: accept=true -> confirm true, reject -> false, 메시지 회수.
- **파일 업로드**: `upload(selector, files)` = `DOM.setFileInputFiles`(objectId 지목 후 해제). 호스트 FS 경로
  (자기 기기 자동화 전제). 게이트16c: probe.txt 심어짐(files.length=1, name 일치).
- **쿠키 관리 완성**: `clearCookies`/`deleteCookie`(`Network.deleteCookies`). 게이트16d.
- **네트워크 가로채기(CDP Fetch)**: `route(pattern, "block"|"fulfill", ...)`가 요청을 차단(트래커/광고)하거나 정적
  응답을 주입(API 목킹). 첫 route에서만 `Fetch.enable`(모든 요청 latency 부담 회피), 모든 `requestPaused`는 반드시
  처리(미처리 = 페이지 행). 게이트16f/g: block -> fetch 실패, fulfill -> 정적 응답 주입 확인.
- **응답 관측(CDP Network)**: `waitForResponse(pattern)`/`requests()`가 `Network.responseReceived` 로그를 폴한다
  (동기 블로킹 모델과 정합: 이벤트를 버퍼링하고 Python이 폴). 게이트16e: fetch 후 status=200 회수 + 실제 응답값.
- **카빙 유지**: 이벤트 소비(다이얼로그/Fetch/Network)를 driver당 **단일 리스너** `_onEvent`가 tabId+method로
  분기(리스너 증식 금지), detach가 제거. dispatch 테이블에 op 9개 한 줄씩 추가(총 42 op). script mode의 CDP 전용
  op는 정직하게 미지원 예외.
- **src 승격**: protocol/host 갱신 + browserControl.js 파이썬 표면 + index.d.ts + contract.md 조작 표면 절 확장.
  실 src 픽스처에 이벤트 리스너 신규 경로(다이얼로그/Fetch/Network) 회귀 게이트 추가 -> **GREEN 5/5**.
  `npm test` **559 green**. **표면은 이제 Playwright 실사용 대비 핵심 격차가 좁다**(잔여: 프레임 traversal, 다운로드,
  콜백형 route는 후속 판단).

### 2026-07-14 Phase 3: 조작 표면 확대(Playwright급) 실측 GREEN + src 승격

MVP 6개 메서드(navigate/evaluate/click/type/waitFor/close)를 실전 자동화 표면으로 확대했다. 지시: MVP에서
멈추지 말고 강력하면 계속 밀 것. attempts 게이트15(a-i) 9개 신설, `bootIsolationRunner` **35/35 GREEN**(첫 실행 통과).

- **추가 표면**: 항법(reload/back/forward), 입력(doubleClick/rightClick/hover/fill/press/select), 조회·추출
  (text/html/attr/value/exists/count/texts/boundingBox/title/url/content), 대기(waitForFunction), 캡처·에뮬레이션
  (screenshot/pdf/setViewport/setUserAgent/setHeaders/cookies/setCookie).
- **카빙(덕지덕지 금지)**: op 33개를 두 부류로 나눴다. evaluate 합성(추출·조회·대기)은 `queryEval`/`waitFor*`
  **driver 무관 단일 구현**, mode별 메커니즘이 다른 것(신뢰 입력·항법·캡처·에뮬)만 Driver 메서드. 새 op는
  `dispatch` 테이블 한 줄로 는다. `press`는 named `KEY_DEFS`+수식키 비트마스크 파서로 "Control+a" 같은 조합 지원.
  캡처·에뮬은 신규 권한이 아니라 `debugger`가 여는 CDP Page/Network/Emulation 도메인으로 대행. script mode의
  캡처·에뮬은 정직하게 미지원 예외(조용한 성공 위장 금지).
- **실측 관통(게이트15)**: 추출/미발견 예외, fill 값 대체+select, 포인터(hover/dbl/ctx) **isTrusted=true**,
  신뢰 키보드(Enter 폼 제출 + Control+a 단축키 isTrusted), waitForFunction, screenshot PNG magic, 에뮬레이션
  (setViewport innerWidth=540 + setUserAgent navigator.userAgent + setHeaders 요청 헤더 에코 반영), 항법 히스토리
  (back/forward/reload URL), 쿠키 왕복(setCookie -> cookies). debugger mode 전 표면 실동.
- **src 승격**: browserControlProtocol(v1 -> **v2** = 표면 확장, 핸드셰이크가 두 절반 v2 강제) + browserControlHost
  (확장 Driver + dispatch) + browserControl.js 파이썬 `BrowserTab` 전 표면 + index.d.ts BrowserTab 갱신 +
  contract.md 조작 표면 절. 실 src 픽스처(`test:browser:ext`)에 확장 표면 회귀 게이트 추가 -> **GREEN 4/4**
  (실 src로 추출/폼/포인터/대기/캡처/에뮬/쿠키 관통). `npm test` **559 green**(네이밍/주체/em-dash/표면 게이트 통과).
- **잔여(정직, 변동 없음)**: 파이썬 워커 Pyodide 통합(라우터 실증됨), 실 봇 방어(Cloudflare) 수동, 3PC 쿠키
  실배포/수동. 표면은 이제 넓다 = 다음은 소비 배선(codaro seam)과 실배포 검증이 값을 만든다.

### 2026-07-14 (d) waitForSelector + Phase 2 완료

(d) waitForSelector(요소 나타날 때까지 폴링, 자동화 안정성) 게이트14 GREEN. Phase 2 (c)(d) + 송신 타임아웃을
src 능력에 승격(browserControlHost/browserControl/protocol, index.d.ts BrowserTab.waitFor, contract.md storage
권한). 실 src 런타임 게이트(test:browser:ext) GREEN 유지.

**Phase 2 전체 실측 완료**: (a) 고정 화면 non-COI 셸(게이트11) + (b) 프로세스 OS 워커 N=세션 N(게이트12) +
(c) SW 재attach 복구(게이트13) + (d) waitForSelector(게이트14). 파이썬 `pyprocBrowser` 표면 =
navigate/evaluate/click/type/waitFor/close, script/debugger 두 mode, 영속 세션 + SW 소멸 복구 + 고정 화면 셸.
잔여(정직): 파이썬 워커 Pyodide 통합(라우터 메커니즘은 실증됨), 실 봇 방어(Cloudflare 등) 수동, 3PC 쿠키 실배포
/수동. 게이트12는 첫 실행 flaky(워커/SW 콜드 경합), 재실행 안정 GREEN = 수동 실측 레인.

### 2026-07-14 (c) SW keep-alive/재attach 복구 실측 GREEN (게이트13)

MV3 SW 30초 소멸/크래시 대응. 세션 메타를 `storage.session`에 write-through + op 진입 시 lazy 재attach.
러너가 CDP `Target.closeTarget`으로 확장 SW를 강제종료한 뒤, offscreen sendMessage가 SW를 깨우고 재attach로
세션 복구(recovered=pyprocCdpTarget, ok=true). **발견**: 확장 debugger attach는 SW death에 살아남으므로
재attach는 "Another debugger already attached"를 기존 attach 재사용으로 처리 + Page.enable/WEBDRIVER_MASK
재등록. 탭은 렌더러 소유라 SW가 죽어도 살아있다. 30초 자연 소멸은 CDP 강제종료로 대체 검증(자연 타이밍은 환경 의존).

### 2026-07-14 (b) 프로세스 OS 워커 N=세션 N 실측 GREEN (게이트12)

워커(dedicated Worker, `chrome` 미접근 = 제약 A)가 offscreen 라우터를 거쳐 브라우저를 조작한다(4-홉:
워커 -> offscreen chrome.runtime -> SW chrome.debugger -> 역류). 워커 2개가 각자 세션을 열고 자기 label을
페이지에 쓰고 되읽어 세션 격리 확인(A=workerA, B=workerB, 안 섞임). 제약 A를 라우터로 우회 = 워커 N =
세션 N의 핵심 기술 리스크 해소. 파이썬 워커 통합(각 워커 Pyodide)은 후속(라우터 메커니즘은 실증됨).
정직한 천장(설계): 물리 chrome.debugger는 SW 단일 큐 = N배 파이썬 연산 병렬 + 1배 브라우저-op 레이트.

### 2026-07-14 (a) 고정 화면 실측 GREEN: non-COI 셸에서 쿠키 실림 + frame-busting 방어 (게이트11)

iframe 셸의 남은 축을 non-COI 셸(A안)에서 실증했다. 확장이 localhost(COEP 없음 = non-COI) 셸 탭을 열고,
그 안에 cross-site iframe(127.0.0.1)을 credentialless 없이 담는다.
- **credentialless-free 로드**: XFO를 declarativeNetRequest로 제거하면 cross-site iframe이 로드된다(GREEN).
- **쿠키 실림**: `SameSite=None; Secure`는 cross-site iframe 요청에 실리고(noneSess, 서버측 Cookie 헤더로 확인),
  `SameSite=Lax`는 차단(differential). 로그인 세션이 창에 산다.
- **sandbox frame-busting 방어**: `sandbox`(allow-top-navigation 제외)로 top 이탈이 막히고 셸이 유지(shellPath 불변).
- 게이트4/8(COI offscreen이 credentialless 강제 -> 쿠키/sandbox 막힘)의 반대 = non-COI 셸에서 전부 풀림.
  셸(non-COI localhost 탭)/런타임(COI offscreen) 문서 분리가 실측으로 닫힘. 셸 게이트는 offscreen 게이트 완료
  후 실행(헤더 제거 전제 오염 방지). **"앱 셸은 고정, 사이트는 그 안의 창(로그인 세션까지)"이 섰다.**
- 3PC 벽(정직): headless 기본 3PC 허용에서 실림. 실배포 3rd-party 쿠키 phaseout/유저 설정은 chrome.contentSettings
  완화 + 수동.

### 2026-07-14 Phase 2 착수: 설계 확정 + 구현

Phase 2 각 축의 기술 설계를 확정했다. 구현으로 간다.

- **(a) iframe 셸(고정 화면)**: non-COI 셸 = 확장이 여는 http 탭 + content script(A안). 확장 페이지는 COEP
  전역이라 non-COI 불가(후보 B 원천봉쇄, 후보 C 열등). localhost/127.0.0.1 cross-site 쌍으로 헤더 제거 +
  credentialless-free iframe 로드 + 쿠키 실림(SameSite None vs Lax differential) + sandbox frame-busting을
  자동 게이트. 3PC 쿠키 벽(first-party 세션 -> 3rd-party 변환, Chrome phaseout)은 실배포/수동.
- **(b) 프로세스 OS 워커 N=세션 N + 스냅샷/fork**: dedicated Worker엔 `chrome`이 없어(제약 A) offscreen 메인이
  유일 chrome.runtime 채널 = 라우터(4-홉: 워커->offscreen->SW->CDP). 정직한 천장: 물리 chrome.debugger는 SW
  단일 큐 = "N배 파이썬 연산 병렬 + 1배 브라우저-op 레이트". 워커 N이 이기는 곳 = op 사이 CPU 연산(N GIL) +
  격리 + 스냅샷/fork 단위. vision이 지목한 차별점.
- **(c) SW keep-alive**: offscreen 소유 Port keepalive(세션>0일 때만) 주 + storage.session 메타 + lazy
  재attach(WEBDRIVER_MASK 재등록 필수) + `_pyprocBrowserSend` 타임아웃 필수(무타임아웃이면 SW 죽을 때 run_sync
  영구 행). onDetach를 복구가능(SW-death) vs terminal(onRemoved/attach 실패)로 분리. CDP `ServiceWorker.stopAllWorkers`
  강제종료 -> 재attach 자동 게이트.
- **(d) API 폭**: waitForSelector/screenshot 등 조작 편의.

구현 순서: (a) iframe 셸 -> (b) 워커 N=세션 N -> (c) SW keep-alive -> (d) API 폭. 각 축 attempts 실측 후 src 승격.

### NEXT

1. (a) iframe 셸 non-COI 자동 실측 착수(진행 중).
2. (b) 워커 N=세션 N.
3. (c) SW keep-alive.
4. (d) API 폭.

### 2026-07-14 Phase C 완료: 확장 소비 계약 문서화 -> Phase 1(조작 능력) 구현 완성

- **소비 계약(docs/consuming/contract.md BrowserControl 절)**: 두 절반(offscreen 능력 + SW 호스트, 같은 핀
  강제 + 프로토콜 핸드셰이크) + manifest 필수 키(COEP/COOP/CSP wasm-unsafe-eval/permissions/minimum_chrome_version
  = pyproc 요구, name/host_permissions = 제품) + vendoring(src 트리 구조 보존, 번들 소비자는 subpath) +
  offscreen(COI)/iframe 셸(non-COI) 분리. 조립 레퍼런스 = tests/browser/runExtension.mjs + extensionFixture
  (실 src import). **examples 별도 스캐폴드는 sns-links 가드 충돌 + 픽스처와 중복이라 픽스처 포인터로 대체**
  (덕지덕지 금지). package.json exports에 `./browser-control-host` 추가.
- **Phase 1(조작 능력) 구현 완성**: attempts 졸업(게이트1-10: 부팅/격리/CDP왕복/iframe역전/신뢰입력/실제조작/
  다중세션/스텔스/영속세션/세션수명) -> src 승격(browserControl 능력 + host + protocol) -> 공개 표면 ->
  실 src 런타임 게이트(SSOT) -> 소비 계약. `npm test` green + `test:browser:ext` GREEN. 능력이 브라우저에서
  실동 검증됨. 파이썬 `pyprocBrowser.tab(url, mode).navigate/evaluate/click/type/close`(script/debugger 두 mode).
- **남은 것(Phase 2, 별도 착수)**: iframe 역전 non-COI 셸 분리(쿠키/frame-busting 재측정, 셸 UI는 제품 몫) +
  프로세스 OS 워커 N=세션 N 병렬(블로킹 표면은 한 인터프리터 순차) + MV3 SW keep-alive(alarms/port, 실배포) +
  신뢰입력 API 폭(waitForSelector/screenshot, 수요 실측 후) + 실 봇 방어(Cloudflare 등) 수동 통과.
- **수요(정직 유지)**: codaro의 browserControl 실제 seam은 아직 미배선. Phase 2 착수는 소비자가 Phase 1을 실제
  import한 뒤가 정합(product-vision 실패 기준). 사용자 지시로 Phase 1은 완성했다.

### 2026-07-14 Phase B 완료: src 승격 + 실 src 런타임 게이트 GREEN -> Phase C(소비 계약) 착수

- **src 배치**: browserControl 능력(`enableBrowserControl`) + browserControlHost + browserControlProtocol을
  `src/capabilities/`에(한 능력=한 폴더). runtime.js 등록. 공개 표면: index.js export `BrowserControl`,
  index.d.ts(`BrowserControl`/`BrowserTab`/`enableBrowserControl`), README 2종(영문 우선), package.json
  exports `./browser-control-host`(SW 절반 subpath). 능력 install()에 chrome.runtime 전제 가드 + 프로토콜
  버전 핸드셰이크. `npm test` 542 green.
- **실 src 런타임 게이트(tests/browser/runExtension.mjs + extensionFixture, `test:browser:ext`)**: 픽스처
  확장이 **사본이 아니라 실 src를 import**(SSOT). src 트리 구조보존 vendoring + vendor 코어 조립 -> CDP
  loadUnpacked. GREEN 3/3: boot()가 offscreen에서 실 src로 부팅(리스크 실증) + enableBrowserControl().install()
  + 핸드셰이크 + pyprocBrowser 왕복(tab/evaluate/type/close, field=srcPromoted).
- **졸업 게이트 ⑦계약 + ⑧src 배치 완료.** 능력이 브라우저에서 실동 검증됨.
- **Phase C 착수**: docs/consuming에 확장 manifest 요구 계약(COEP/COOP/CSP/permissions/minimum_chrome_version는
  pyproc 런타임 요구) + vendoring 계약(SHA-핀 단일 import 불가, src 트리 구조보존) + examples 레퍼런스 확장
  스캐폴드(codaro 복붙용, 실 src import).

### 2026-07-13 Phase A 실측 완료: 영속 세션 모델 GREEN (게이트9/10) -> Phase B(src 승격) 착수

- **게이트9(영속 세션 모델)**: 파이썬 `pyprocBrowser.tab(url, mode).evaluate/type/click/close`가 한 핸들로
  op 사이에 탭/attach를 유지하며 실동. debugger+script 두 mode GREEN. **offscreen 메인스레드에서 블로킹
  `run_sync` 실동**(설계 검토가 지목한 최대 리스크 해소). TabSession(수명) + Driver(전략, 생성 시 1회 선택) +
  프로토콜 계약(버전 필드)의 깎인 형태가 섰다.
- **게이트10(세션 수명)**: 탭 외부 종료 -> `onDetach` -> 세션 무효화 -> 이후 op가 `SessionLost: debugger
  detached` 예외로 깨끗이 실패(행 금지). 설계 검토가 지목한 최대 파손 지점(onDetach 미배선) 해결.
- **블로킹 표면 순차성(정직)**: pyprocBrowser 블로킹 표면은 한 offscreen 인터프리터에서 **순차**다(게이트7의
  async gather 병렬과 다름). 진짜 세션 병렬(세션 N 동시)은 Phase 2 워커 N = 인터프리터 N에서. 블로킹 표면의
  순차는 설계 정합(한 인터프리터 = 한 실행 흐름).
- **미검증(테스트 재현 난이)**: MV3 SW 30초 소멸 -> keep-alive(alarms/port) + 재attach. 게이트로 재현 어려워
  Phase B 구현 + 실배포 검증. onDetach 경로는 게이트10으로 확증됨(SW 소멸도 같은 onDetach를 탄다).
- **졸업 게이트 진척**: ④모듈화 설계 + ⑤덕지덕지 제거(TabSession+Driver, per-verb 플래그 0) + ⑥클린코드를
  실측으로 채웠다. -> Phase B = ⑦계약 확정(index.d.ts/README) + ⑧src 배치.
- **Phase B 착수**: src/capabilities에 browserControlProtocol.js + browserControlHost.js + browserControl.js
  (enableBrowserControl 능력, 핸드셰이크 + chrome.runtime 전제 가드). runtime.js 등록, index/d.ts/README 표면.
  러너 승격(tests/browser, 픽스처가 실 src import)은 후속 단계.

### 2026-07-13 Phase 1 승격 설계 토론 -> 정공법 확정: 승격 전 영속 세션 모델 실측

승격 설계를 아키텍처/소비계약/구현리스크 세 각도로 검토해 합의에 이르렀다.

- **핵심 결론(공통)**: 현재 attempts는 **일회성 probe**(탭 생성->조작->즉시 detach/close, 핸들러 3개 복붙)인데
  승격 대상은 **영속 세션 핸들**(`tab().navigate().click().close()` 한 핸들). 이 간극에 미검증 축 셋 = MV3 SW
  소멸(~30초 유휴 사망 -> attach 풀림), 영속 탭/attach 수명(onDetach/onRemoved 미배선, load 대기가 실패를
  성공 위장), 블로킹 JSPI 동시성(게이트7 병렬이 run_sync 표면서 죽을 수 있음). **바로 src 승격 = 졸업 게이트
  (④모듈화⑤덕지덕지⑥클린코드) 위반.** 정공법 = attempts에서 깎인 영속 세션 모델 먼저 실측.
- **배치 정정**: `browserHost`를 processOs가 아니라 **`src/capabilities/browserControlHost.js`**로(한 능력=한 폴더,
  `pyprocSw.js` 선례. processOs는 프로세스 추상만). 짝 이름: `browserControl.js`(능력) + `browserControlHost.js`(SW).
- **mode 깎기**: per-verb 플래그(`override`/`trusted`) 금지. `tab(url, mode)` 생성 시 `ScriptDriver`/`DebuggerDriver`
  1회 선택. `TabSession`(수명, mode-무관, 3중 복붙 제거) + Driver(전략, `{ok,value,error}` 균일 반환) 분리.
- **프로토콜 계약**: offscreen<->SW 메시지를 named 모듈 `browserControlProtocol.js`로 뽑아 양쪽이 함께 import +
  버전 핸드셰이크(두 절반 SHA 드리프트 시 loud fail). 전송 타입 분기(`type:"cdp"/"contentScript"`) 대신
  `{op, mode, sessionId, args}` 스키마(Phase 2 target 확장 forward-compat).
- **세션 수명 계약**: load 대기 타임아웃 = **reject**(resolve 금지, SPA는 loadEventFired 안 옴 -> readyState 폴링
  병용), onEvent 리스너 finally 제거 + sessionId 디스패치, onDetach -> `SessionLost` 파이썬 예외(행 금지),
  SW keep-alive(alarms/port) + 재attach. named config 타임아웃(하드코딩 10s 금지).
- **JSPI 가드**: `run_sync`는 runAsync/JSPI 경로에서만 동작 -> 동기 경로면 명확한 에러. sendMessage reject를
  typed 파이썬 에러로 전파. SW 리스너 무조건 `return true` 버그(미처리 메시지 채널 닫힘 reject) 수정.
- **script 경로 함정**: MAIN world `eval`은 페이지 CSP(unsafe-eval)로 차단 -> `func` 주입/ISOLATED world.
  script click/type은 isTrusted=false(native setter 필수, React 제어입력). mode 자동 폴백 금지(정직).
- **러너 승격**: `tests/browser/runExtension.mjs`(run.mjs는 `--disable-extensions`라 확장 불가, 별 파일). 픽스처
  확장이 **실 src를 import**(복제 금지 = SSOT). vendor 런타임 조립. `npm test`는 구조/표면만, `test:browser:ext` 추가.
  webdriverCauseRunner는 발견 기록으로 충분(승격 대상 아님).
- **공개 표면**: `enableBrowserControl` + `BrowserControl`/`BrowserTab`(index.js/d.ts/README 2종 + Runtime 메서드
  게이트 + camelCase `_pyprocBrowser`). `browserControlHost`는 별도 subpath export(`./browser-control-host`).
  offscreen 부트스트랩은 export 말고 examples 스캐폴드 몇 줄. 프로토콜 타입 d.ts 노출.
- **소비 계약(Phase C)**: manifest 필수 키(COEP/COOP + CSP wasm-unsafe-eval + permissions + minimum_chrome_version
  + **web_accessible_resources 누락 발견**)는 제품 몫이 아니라 pyproc 런타임 요구 -> docs/consuming에 확장 manifest
  요구 계약 + vendoring 계약(확장은 SHA-핀 단일 import 불가, src 트리 구조보존 vendoring 필요, deep-import 규칙과
  충돌 해소). examples 레퍼런스 스캐폴드. contract.md 핀 모델은 npm 버전 핀 정본(문서 정합).
- **수요(정직)**: codaro의 browserControl 수요는 여전히 가설(product-vision 실패 기준). 사용자 지시가 "구현 완성"
  이라 진행하되, 수요 미확인을 원장에 유지. Phase 2(프로세스 OS 통합/셸)는 소비자가 Phase 1을 실제 import한 뒤.

**정공법 계획**: Phase A(attempts 영속 세션 모델 실측: TabSession+Driver+protocol+수명) -> Phase B(src 승격
+ 러너 승격 + 표면) -> Phase C(소비 계약 문서 + examples 스캐폴드). Phase A가 졸업 게이트의 ④~⑥을 실측으로 채운다.

### 2026-07-13 iframe 역전 부가 축 체크: non-COI 셸 필요 3중 확증 (게이트8 관측)

- frame-busting 무력화(sandbox로 top 이탈 차단)를 체크했으나, COI offscreen이 강제하는 credentialless와
  sandbox가 충돌해 iframe 로드 자체가 실패했다. 게이트4의 쿠키 격리와 **같은 뿌리**다.
- **결론(3중 확증)**: iframe 역전의 세 축이 갈린다. (1) **로드**는 credentialless로 COI offscreen에서도 됨
  (게이트4 GREEN). (2) **sandbox frame-busting 방어**는 credentialless 충돌로 COI서 불가(게이트8). (3) **쿠키
  실림**도 credentialless라 불가. 즉 **iframe 역전을 온전히(쿠키 + frame-busting 방어) 하려면 non-COI 셸이
  필수**임이 로드/sandbox/쿠키 세 각도에서 확증됐다.
- **아키텍처 확정**: 셸(non-COI 문서, iframe 역전 온전) / 런타임(COI offscreen, 프로세스 OS)의 **문서 분리가
  iframe 역전의 전제**다. 층위 A(영속 호스트)와 층위 C(iframe 역전)가 다른 문서라는 설계가 이래서 정합. non-COI
  셸에서 sandbox·쿠키 재측정은 Phase 2 셸 분리 구현과 함께.

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
