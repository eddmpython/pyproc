# 00. 제품 비전 - 무엇을, 누구를 위해, 왜

## 한 문장

**파이썬이 브라우저 자체를 운전하되, 외부 프로세스도 서버도 없이 브라우저 내부에서 한다.** MV3 확장 안에
pyproc 프로세스 OS를 들여, 자동화의 오케스트레이션이 프로세스 내부에서 돌게 한다.

## 링 모델 (조작 권한의 지형)

브라우저에서 파이썬이 닿는 범위는 세 링으로 갈린다. 이 이니셔티브는 링 1이 표적이다.

| 링 | 위치 | 닿는 범위 | pyproc 현재 |
|---|---|---|---|
| 0 페이지 | 탭 안 Pyodide | 자기 origin 웹 플랫폼 전부(DOM/fetch/WebGPU/OPFS/WebUSB) | 오늘 여기(GpuCompute 등) |
| **1 확장(MV3)** | 확장 컨텍스트 | `chrome.tabs`/`chrome.scripting`/**`chrome.debugger`(=CDP를 함수 호출로)** | **이 이니셔티브** |
| 2 임베더 | Electron/CEF | 브라우저·OS 전부 | 스코프 밖(서버리스 정체성 포기) |

링 0의 벽은 크롬이 안 만든 기능이 아니라 크롬의 제1 불변식(사이트 격리 + 렌더러 샌드박스)이다. 페이지 JS가
다른 탭·CDP·다른 origin에 닿는 경로는 전부 샌드박스 탈출(Chrome VRP 대상 취약점)이라 우회 축이 아니다.
링 1은 그 벽을 **정면으로 우회하는 유일한 합법 경로**다: 브라우저가 확장에 부여한 정식 권한을 쓴다.

## 누구를 위해

- **1차 소비자**: pyproc 위에 인탭 AI 에이전트를 얹는 제품(codaro 기함 유스케이스 = 에이전트 데이터 분석/웹 작업).
  에이전트가 "이 페이지 열어서 값 뽑아와"를 서버 없이 사용자의 진짜 브라우저에서 실행한다.
- **2차**: 브라우저 자동화가 필요한데 서버·드라이버·별도 프로세스를 두기 싫은 개발자. Playwright는 별도 런타임 +
  드라이버 + (원격이면) 서버가 필요하다. 여기선 확장 하나가 자기 완결.

## Playwright / browser-use 대비 (정직한 축 분해)

"더 강한가"는 축마다 다르다. 과장 없이:

| 축 | Playwright/browser-use | pyproc 링 1 |
|---|---|---|
| 실행 위치 | 외부 프로세스 + CDP 웹소켓(원격이면 서버) | **브라우저 내부, 홉 0** |
| 프로필/지문 | 깨끗한 자동화 프로필(stealth로 위장) | **진짜 사용자 프로필/쿠키/하드웨어**(태생) |
| 세션 체크포인트 | 없음(스크립트 재실행) | **스냅샷/fork로 되감기**(프로세스 OS 자산) |
| navigator.webdriver | true(자동화 플래그) | 경로 의존: chrome.debugger=true, **content script=false(미검증)** |
| 신뢰 입력(isTrusted) | 있음(CDP Input) | chrome.debugger 경로만. content script는 false |
| 성숙도/API 폭 | 압도적(수년 축적) | 제로부터 |

정직한 결론: **"내부에서 움직인다"는 사실 자체가 스텔스가 아니다**(chrome.debugger는 결국 CDP =
webdriver 노출). 진짜 우위는 (a) content script 경로 + (b) 실 프로필/하드웨어 지문 + (c) 프로세스 OS
세션 되감기에서 나온다. API 폭·성숙도에서는 한참 뒤다. 이 이니셔티브는 "Playwright를 대체"가 아니라
**"Playwright가 구조적으로 못 하는 좁은 고가치 축"**을 노린다.

## 정직한 ROI 재검 (무비판 착수 금지)

numerical-acceleration은 "North Star의 마지막 큰 격차"라 착수가 자명했다. 이건 다르다 = **코어 위에 얹는 새
응용 축**이라 마찰과 수요 불확실이 실재한다. 착수 전 자문:

**진짜 마찰:**
- 확장 = 새 배포 타겟(웹스토어 심사, manifest, 별도 유통). pyproc 코어의 "커밋 SHA 핀 import" 소비 모델과 다르다.
- 번들 13MB+(vendor 코어). 원격 코드 금지라 CDN 회피 불가 = 확장 크기로 흡수.
- chrome.debugger 인포바("디버깅 중") = 지속 UX 비용. `chrome://`·웹스토어엔 attach 불가.
- 스텔스 미검증(수동 실측 영역). content script webdriver=false가 확정 안 되면 스텔스 우위 논거가 약해진다.
- 새 소비 표면이라 수요가 실증 안 됨. codaro가 실제로 인탭 브라우저 자동화를 원하는가는 가설.

**그래도 하는 논거:**
- 자산 재사용이 크다: 프로세스 OS/스냅샷/SAB/JSPI가 신규 개발 없이 자동화에 맞물린다(게이트 2 실측이 증명).
- 시장 정합: 인탭 AI 에이전트가 pyproc 기함 유스케이스고, "에이전트가 사용자 브라우저에서 웹을 조작"은 그 자연 확장.
- 남이 못 하는 물건: "서버리스 · 프로세스 내 · 실 프로필 · 되감기 가능한 브라우저 자동화 파이썬"은 유일 포지션.

**판정**: 착수하되 **Phase 0가 게이트**한다. Phase 0에서 (1) 스텔스 수동 실측으로 content script
webdriver=false를 확정하고 (2) 코어 `boot()`가 확장에서 재사용됨을 실증한다(게이트 1이 절반 확인). 둘 중
스텔스가 RED(webdriver가 어느 경로든 true)면 "실 프로필 지문 + 세션 되감기"로 논거를 좁히고, 그마저 약하면
결론 기록 후 **접는다**. Phase 1(능력 승격) 착수는 Phase 0 GREEN이 조건. 상세 [02-phasing](02-phasing-and-wiring.md).

## 무엇인가 / 무엇이 아닌가

**이 이니셔티브다:**
- pyproc 코어를 확장 offscreen에서 부팅하는 경로 + 파이썬에서 브라우저를 조작하는 **능력 계약**(BrowserControl).
- 프로세스 OS ↔ 탭/세션 대응(워커 N = CDP 세션 N)과 스냅샷/fork를 자동화 세션 관리에 잇는 오케스트레이션.

**이 이니셔티브가 아니다:**
- Playwright의 API 폭을 재현하는 것(수년 축적, 무의미한 추격). 좁은 고가치 축만.
- 확장 제품 자체를 pyproc이 웹스토어에 내는 것(제품 = codaro 등이 자기 manifest로 배포. pyproc은 능력만).
- 탐지 회피를 "무적"으로 파는 것(chrome.debugger는 webdriver 노출 확정. 정직한 이중 경로 트레이드오프).
- `chrome://`·웹스토어·다른 확장 조작(브라우저가 막는 경계. 우회 축 아님).

## 성공 / 실패 기준

- **성공**: 파이썬 한 줄로 확장 안에서 브라우저를 운전한다(navigate/evaluate/click/type). 프로세스 OS의 워커 N이
  탭/세션 N에 1:1 대응하고, 스냅샷으로 자동화 세션을 되감는다. 소비자(codaro)가 능력 계약 하나로 이걸 켠다.
  스텔스 경로(content script)가 수동 실측으로 webdriver=false 확정.
- **실패**: 스텔스가 어느 경로든 webdriver=true로 판명 + 실 프로필 논거도 약해 Playwright 대비 차별이 안 서거나,
  능력이 실측 없이 표면만 늘거나, 인포바 UX가 실사용을 막거나, 아무 소비자도 이 표면을 원하지 않는 것.

## 왜 지금, 왜 이것

- attempts/browserControl 세 게이트가 이미 GREEN이다 = 기술 리스크의 큰 덩어리(offscreen 부팅 + 격리 +
  CDP 왕복)가 실측으로 제거됐다. 남은 건 스텔스 확정과 능력 설계.
- 프로세스 OS 프리미티브(browser-os)와 수치 가속(numerical-acceleration)이 닫혔다. 코어가 성숙했으니 그 위에
  응용 축을 세울 때다.
- 플랫폼이 열려 있다: MV3 offscreen + COEP/COOP manifest 키 + chrome.debugger가 2026 Chromium에서 실재(실측).

상세 설계는 [01-architecture.md](01-architecture.md), phasing은 [02-phasing-and-wiring.md](02-phasing-and-wiring.md), 결정 원장은 [03-progress-ledger.md](03-progress-ledger.md).
