# 02. Phasing과 배선 - phase 분해, 게이트, 소비, 롤백

## 게이트 제약이 phasing을 지배한다

numerical-acceleration에서 "WebGPU 실 GPU 수동 검증"이 phasing을 지배했듯, 여기선 **확장 로딩 = CDP 필수 =
navigator.webdriver 전역 오염**이 지배한다. 갈래:

- **자동 가능(headless)**: offscreen 부팅, 격리(SAB/워커/JSPI), chrome.debugger CDP 왕복, 능력 계약 왕복.
  `bootIsolationRunner`가 이미 이걸 자동으로 돌린다(GREEN). Phase 1 능력 검증도 이 하네스로 자동화 가능.
- **수동 전용(headed, 정상 설치 확장)**: 경로별 스텔스(content script webdriver=false). 자동 하네스는
  webdriver를 전역으로 켜서 불가. 정상 설치 확장을 개발자모드로 로드(CDP 없이 시작)해야만 실측된다.

이 갈래가 Phase 0를 승패 게이트로 만든다.

## Phase 0 - 승패 게이트 (착수 정당성 확정)

**목적**: Phase 1 착수 전에 이니셔티브의 두 존재 근거를 실측으로 세운다. 무비판 착수 금지의 집행 지점.

- **0-a 코어 재사용 실증** (자동, 절반 done): offscreen에서 코어 `boot()`가 그대로 실림 = 게이트 1에서 확인.
  잔여: 소비자 셸이 import하는 형태(offscreen 부트스트랩 + SW host)로 리팩터해도 부팅 유지되는지.
- **0-b 스텔스** (핵심 자동 확정, 잔여 수동): content script 경로 webdriver 미점화를 인과 격리로 자동 확정했다.
  - **자동 확정(webdriverCauseRunner GREEN)**: webdriver를 켜는 범인이 `--remote-debugging-port` 단독임을
    확장·조작 없이 3조건 대조로 격리(평범 false / +포트 true / +확장디버그 추가영향 0). 실배포엔 포트가 없고
    content script는 CDP를 안 쓰므로 webdriver 미점화가 논리 확정 = **스텔스 우위 핵심 근거 성립**.
  - **잔여 수동(선택, 착수 정당성엔 불필요)**: chrome.debugger `attach`의 실배포 webdriver 효과(포트와 별개인
    attach 자체) + 실 봇 방어(Cloudflare 등) 통과. 정상 설치 확장을 개발자모드로 로드(CDP 없이 시작)해 검증.
  - **RED 처리**: (자동 확정으로 리스크 감소) 잔여 수동에서 실 방어 통과가 전면 실패하고 실 프로필/세션 되감기
    논거도 약하면 가치 축소 또는 접기(결론 원장 기록, attempts 폴더 삭제).

## Phase 1 - 능력 계약 최소 표면 (제품 경로)

**전제**: Phase 0 GREEN. **목적**: `BrowserControl` 능력을 attempts에서 확정하고 src 승격.

- 파이썬 `pyprocBrowser.tab(url, mode).evaluate/navigate/click/type/close`가 offscreen에서 SW 브리지 경유로
  실동. 최소 표면부터(강함은 깎아서).
- **게이트**(자동, bootIsolationRunner 확장): 파이썬발 `tab.navigate -> evaluate`가 페이지 값 회수(게이트 3
  재사용) + `click`/`type`이 대상 페이지 상태를 바꿈(DOM 검증). `mode="debugger"`와 `mode="script"` 둘 다 왕복.
- **승격**: `src/capabilities/browserBridge.js`(enableBrowserControl) + `src/processOs/browserHost.js`(SW 브리지)
  + index.js/index.d.ts/README 표면. `npm test` green(공개 표면·타입·네이밍 가드).

## Phase 2 - 프로세스 OS 통합 (프론티어, 차별점)

**목적**: 워커 N ↔ 세션 N + 스냅샷/fork 세션 되감기. Playwright가 못 하는 축.

- N개 파이썬 워커가 각자 논리 세션(탭+스크립트)을 구동, 물리 chrome.debugger는 SW 큐로 직렬화.
- 자동화 세션 스냅샷(파이썬 상태 완전 해시) + fork(한 세션에서 N갈래).
- **게이트**(자동): 2세션 병렬 조작 + 한 세션 스냅샷 후 되감기(파이썬 상태 복원 + 탭 조작 로그 재생) 실측.
- **정직**: 탭 DOM 재구성은 조작 로그 재생 의존(서버측 세션·외부 상태는 재생 불가). 경계 명시.
- **영속 셸(고정 화면)**: iframe 역전으로 사이트를 셸의 창에 담는다(01-architecture 영속 셸 절). 관건 =
  `X-Frame-Options` 제거로 cross-origin 사이트가 iframe에 로드되는지 + frame-busting JS 무력화.
- **게이트**(자동): `X-Frame-Options: DENY` 페이지가 규칙 없이는 iframe 차단(postMessage 미수신), declarativeNetRequest
  규칙 적용 후 로드 성공(iframe 내부 postMessage 수신) 실측.

## Phase 3 - 선택 후속 (수요 실측 후)

- 신뢰 입력 심화(chrome.debugger `Input.dispatchMouseEvent`/`dispatchKeyEvent`, isTrusted=true).
- 예제 확장 셸(examples/ 또는 소비자 배선 가이드): codaro가 자기 manifest에 pyproc 세 조각을 얹는 레퍼런스.
- screenshot/waitForSelector/네트워크 인터셉트 등 API 폭(수요가 실증되면).

## 소비 배선 (products -> pyproc, 단방향)

- 소비자(codaro)가 **자기 확장을 소유**한다: manifest(권한 `offscreen`/`debugger`/`scripting`/`tabs` +
  COEP/COOP 키 + `'wasm-unsafe-eval'` CSP), SW 셸, offscreen 셸.
- pyproc에서 커밋 SHA 핀으로 세 조각 import: offscreen 부트스트랩, `browserHost`(SW), `browserBridge`(능력).
- vendor 코어(Pyodide 자산)는 소비자가 확장에 번들(원격 코드 금지). pyproc은 재현 레시피만(`npm run fetch:engine`).
- 브레이킹은 릴리즈 노트에 명시. 소비 계약은 [docs/consuming/contract.md](../../docs/consuming/contract.md) 갱신.

## 롤백

- 능력 계약이라 격리가 자연스럽다: `enableBrowserControl()` 미호출 = 코어 런타임 영향 0. src 추가분은
  opt-in Layer 1 능력(gpuBridge/socketBridge와 동일 패턴)이라 기존 소비자 무영향.
- Phase 0 RED면 attempts 폴더 삭제 + 원장에 접은 사유 기록. src 오염 0(승격 전이라).
- Phase 1+ 이후 문제면 해당 능력 파일 제거 + index 표면 롤백(단일 커밋 되돌림). 코어는 불변.

## 자동/수동 게이트 요약

| Phase | 게이트 | 자동/수동 |
|---|---|---|
| 0-a 코어 재사용 | offscreen boot() 유지(소비자 셸 형태) | 자동(bootIsolationRunner) |
| 0-b 스텔스(핵심) | webdriver 범인=포트 격리(content script 미점화 확정) | 자동(webdriverCauseRunner) |
| 0-b 잔여(선택) | attach 실배포 효과 + 실 봇 방어 통과 | 수동(headed 정상 설치) |
| 1 능력 표면 | 파이썬 tab/navigate/evaluate/click/type 왕복 | 자동 |
| 2 프로세스 OS | N세션 병렬 + 스냅샷 되감기 | 자동 |
| 2 영속 셸 | X-Frame-Options 제거로 cross-origin iframe 로드 성공 | 자동 |
| 3 신뢰 입력/폭 | Input.* isTrusted + 소비 배선 | 자동 + 수동(UX) |
