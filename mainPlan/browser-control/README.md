# browser-control - 서버리스 · 프로세스 내 브라우저 자동화 파이썬 런타임

상태: **Phase 1-12 구현 완성 (2026-07-14).** attempts 캠페인 [browserControl](../../tests/attempts/browserControl/README.md)이
링 1(MV3 확장) 게이트 1-24를 브라우저 실측으로 통과했다(**58/58 GREEN**): Phase 1(부팅/격리/CDP왕복/신뢰입력/
조작/다중세션/스텔스/영속세션/세션수명) + Phase 2(고정 화면 non-COI 셸 쿠키·frame-busting / 프로세스 OS 워커
N=세션 N / SW 재attach 복구 / waitForSelector) + Phase 3(Playwright급 조작 표면: 추출·조회/입력 확장/대기/캡처/
에뮬레이션/쿠키) + Phase 4(자동 스크롤 / 다이얼로그 자동 처리 / 파일 업로드 / 쿠키 삭제 / 네트워크 가로채기
route·block·fulfill / 응답 관측) + Phase 5(요청 변조 modify / 콜백형 held routing = 요청을 붙잡아 continue·fulfill·
abort / 응답 바디 캡처 responseBody) + Phase 6(프레임 traversal = same-origin iframe 내부를 isolated world로 드릴다운) + Phase 7(에뮬레이션 심화 =
다크모드 emulateMedia / 타임존 setTimezone / 오프라인 setOffline) + Phase 8(파이썬 워커 N=세션 N 진짜 병렬 =
각 워커가 자기 Pyodide 인터프리터 + run_sync + offscreen 라우터로 자기 세션을 몬다 = 프로세스 OS x 브라우저 컨트롤 융합)
+ Phase 9(다운로드 관측 = enableDownloads/waitForDownload로 무엇이 다운로드되는지 파일명·URL 회수) + Phase 10
(콘솔·에러 캡처 = enableConsole/consoleLogs/waitForConsole로 페이지 console.* + 미처리 예외 관측) + Phase 11
(접근성 트리 = accessibilityTree로 role/name 시맨틱 회수, 에이전트의 의미 네비게이션) + Phase 12(cross-origin
OOPIF 프레임 드릴다운 = getTargets attach로 별 프로세스 iframe 내부까지 조작, Phase 6 벽 돌파).
능력을 `src/capabilities/`로 승격: `Runtime.enableBrowserControl()` -> 파이썬 `pyprocBrowser.tab(url, mode)`가 항법/
입력/조회·추출/대기/캡처·에뮬/쿠키/다이얼로그/네트워크(선언형 + 콜백형)/프레임을 노출한다(script/debugger 두 mode,
영속 세션 + SW 소멸 복구, 정본 타입 index.d.ts BrowserTab/BrowserFrame). 실 src 런타임 게이트(`test:browser:ext`,
픽스처가 실 src import = SSOT) GREEN 6/6 + 확장 소비 계약 문서화(protocol v2). 프로세스 OS 융합(routeBrowserWorker
+ installBrowserWorker)까지 실 src로 검증. 잔여(정직, 전부 실제 벽/수동): 다운로드 저장 경로 지정·지오로케이션
권한·로케일(전부 browser-level/Edge CDP 벽), 실 봇 방어(Cloudflare) 수동, 3PC 쿠키 실배포/수동
([03-progress-ledger](03-progress-ledger.md) NEXT).

## 한 문장

**pyproc의 프로세스 OS를 MV3 확장 안으로 들여, 파이썬이 서버·네트워크 홉 0으로 브라우저 자체를 운전하게 한다.**
페이지(링 0)는 자기 origin이 최대치고 탭/주소창/다른 origin/CDP에 원리적으로 닿지 않는다. 확장(링 1)은
브라우저 안에 있으면서 브라우저에 권한을 갖는 유일한 합법 링이다. 여기에 이미 가진 자산(Chromium 전용 +
SAB + 워커 프로세스 OS + 스냅샷/fork)이 그대로 실려, 기존 자동화 스택(Playwright/browser-use)이 못 하는
축을 연다.

## 왜 pyproc이 이걸 하는가 (자산 재사용이 논거다)

- **프로세스 OS가 그대로 맞물린다**: 워커 N = 독립 인터프리터 N = CDP 세션 N = 탭 N. 스냅샷/fork =
  "자동화 세션을 체크포인트하고 되감기". 이건 Playwright/browser-use가 구조적으로 못 하는 축이다.
- **태생적 스텔스 자산**: 확장은 진짜 사용자 브라우저에 산다 = 실제 프로필/쿠키/세션 + 실제 하드웨어 지문.
  Playwright가 stealth 플러그인으로 흉내 내려는 것을 태생적으로 가진다.
- **정체성 정합**: "서버 없이 브라우저에서 도는 진짜 런타임 파이썬" 그대로. offscreen document는 진짜 DOM
  문서라 코어 `boot()`가 indexURL만 확장 루트로 바꾸면 실린다(실측 확인).

## 정직한 재검 (이건 코어의 격차가 아니라 새 응용 축이다)

numerical-acceleration이 "North Star의 마지막 큰 격차"였던 것과 달리, 이건 코어 런타임 위에 얹는 **새 배포
타겟/능력**이다. 그래서 마찰이 실재한다: 확장은 웹스토어 심사 + 별도 유통, 번들 13MB+, chrome.debugger
인포바 UX, 스텔스 미검증(수동), 새 소비 표면이라 수요 불확실. **그래서 Phase 0이 승패를 가른다**: 스텔스
수동 실측과 코어 재사용 실증을 먼저 깨고, RED면 결론 기록 후 접는다. 상세는 [00-product-vision](00-product-vision.md) ROI 절.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 무엇을/누구를 위해/왜, 링 모델, 정직한 ROI 재검, 성공·실패 기준. **여기부터.**
2. [01-architecture.md](01-architecture.md) - 확장 어댑터 레이어, BrowserControl 능력 계약, 이중 경로(debugger/scripting), 프로세스 OS 대응, 실측 접지.
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - phase 분해, 게이트(스텔스 수동 = 자동 CI 불가라는 제약이 phasing을 지배), 소비 배선, 롤백.
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장, 재개 지점(NEXT).

## 접지 요약 (2026-07-13 실측, attempts/browserControl)

- **게이트 1 (부팅)**: MV3 offscreen에서 vendor 번들 Pyodide 부팅 2.5-3.0s, `runPython(1+1)==2`. 원격 코드 금지는 자산 번들 + `'wasm-unsafe-eval'` CSP로 통과.
- **게이트 2 (격리)**: manifest COEP/COOP 키가 확장 문서를 `crossOriginIsolated===true`로 만든다. SAB + module Worker + Atomics 왕복 + JSPI 전부 실동 = **프로세스 OS가 통째로 실린다**(최대 미검증 지점 해소).
- **게이트 3 (조작)**: 파이썬 -> chrome.debugger로 새 탭 attach -> `Page.navigate` -> `Runtime.evaluate`가 title/DOM/계산값 회수, 왕복 405ms.
- **미결(수동 실측 영역)**: 경로별 스텔스(content script webdriver=false). 자동 하네스는 확장 로드에 CDP가 필수라 webdriver 전역 오염 = GPU 창모드와 같은 계급의 수동 검증.
