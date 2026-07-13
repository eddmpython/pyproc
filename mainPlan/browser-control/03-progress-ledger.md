# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

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

1. **Phase 0-b 스텔스 수동 실측**: attempts/browserControl에 수동 실측 가이드 추가(확장 조립 + 개발자모드
   로드 + offscreen 백채널 신호). 정상 설치 확장 headed 크롬에서 content script `navigator.webdriver=false`
   확정. 이 게이트가 이니셔티브 착수 정당성을 가른다.
2. **Phase 0-a 마무리**: offscreen 부트스트랩 + SW host 형태로 리팩터해도 부팅 유지되는지(소비자 셸 계약 형태).
3. Phase 0 GREEN -> **Phase 1**: `BrowserControl` 능력 최소 표면(tab/navigate/evaluate/click/type) attempts
   확정 -> `src/capabilities/browserBridge.js` + `src/processOs/browserHost.js` 승격 + index/d.ts/README + `npm test`.
4. Phase 0 RED(스텔스 + 실 프로필 논거 붕괴) -> 결론 원장 기록 + attempts 폴더 삭제 + 이니셔티브 `_done` 이관(폐기).

## 재개 지침

- 활성 이니셔티브는 이것 하나다. mainPlan 활성 표에 등록됨.
- attempts/browserControl 폴더는 캠페인 살아있는 동안 유지(Phase 0-b 수동 실측 가이드가 여기 붙는다).
- 자동 실측은 `node tests/attempts/browserControl/bootIsolationRunner.mjs`(headless GREEN). 스텔스만 수동.
