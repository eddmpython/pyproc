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
- **0-b 스텔스 수동 실측** (수동, 미착수): 정상 설치 확장 + headed 크롬(CDP 없이 시작)에서 content script 경로
  `navigator.webdriver` 측정.
  - **게이트**: `script` 경로 webdriver=false 확정 -> 스텔스 우위 실측 성립.
  - **RED 처리**: 어느 경로든 true면 스텔스 논거를 버리고 "실 프로필/하드웨어 지문 + 세션 되감기"로 가치
    축소. 그마저 Playwright 대비 차별이 약하면 **이니셔티브 접기**(결론 원장 기록, attempts 폴더 삭제).

절차(0-b): attempts/browserControl에 수동 실측 가이드를 추가한다. 확장 폴더를 조립(vendor 코어 포함)해두고,
크롬 개발자모드 "압축해제된 확장 로드"로 넣은 뒤, offscreen이 백채널로 신호를 보고하게 한다(GPU 창모드
`PYPROC_HEADED` 절차와 같은 계급의 수동 게이트).

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
| 0-b 스텔스 | content script webdriver=false | **수동**(headed 정상 설치) |
| 1 능력 표면 | 파이썬 tab/navigate/evaluate/click/type 왕복 | 자동 |
| 2 프로세스 OS | N세션 병렬 + 스냅샷 되감기 | 자동 |
| 3 신뢰 입력/폭 | Input.* isTrusted + 소비 배선 | 자동 + 수동(UX) |
