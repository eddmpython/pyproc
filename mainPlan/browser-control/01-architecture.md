# 01. 아키텍처 - 레이어, 능력 계약, 이중 경로, 프로세스 OS 대응

## 확장의 두 컨텍스트 (배치의 근원)

MV3 확장은 두 실행 컨텍스트로 갈리고, pyproc은 양쪽에 헬퍼를 제공한다:

- **offscreen document** = 진짜 DOM 문서 = **pyproc 런타임 호스트**. 코어 `boot({ indexURL: 확장루트 })`가
  그대로 실린다(게이트 1 실측). SAB/워커/JSPI 전부 산다(게이트 2). 무거운 파이썬 연산·프로세스 OS가 여기.
- **service worker** = 배경 컨텍스트 = **권한 소유**. `chrome.debugger`/`chrome.scripting`/`chrome.tabs`가
  여기서만 온전하다. offscreen은 이들에 못 닿으므로(제한 API), SW가 브라우저 조작을 대행한다.

브리지: 파이썬(offscreen) -> offscreen JS -> `chrome.runtime` 메시지 -> SW -> `chrome.debugger`/`scripting` ->
결과 역류. 이 왕복이 게이트 3에서 405ms로 실측됐다. 전 구간 프로세스 내부, 네트워크 홉 0.

## 레이어 배치 (단방향 import, 순환 금지)

pyproc이 제공하는 세 조각. 정확한 파일 경계는 Phase 1 승격에서 attempts 실측 형태로 확정하되, 방향은 고정:

- **`src/capabilities/browserBridge.js`** (Layer 1 능력) - `Runtime.enableBrowserControl()` -> `BrowserControl`.
  socketBridge/gpuBridge의 형제. offscreen에서 부팅된 런타임에 붙어 파이썬 `pyprocBrowser` 모듈을 배선한다.
  파이썬이 브라우저 조작을 블로킹 호출로 쓴다(JSPI `run_sync`, socketBridge 패턴 재사용).
- **`src/processOs/browserHost.js`** - SW쪽 브리지 로직(chrome.debugger/scripting 왕복, 탭 수명, load 대기).
  확장 SW가 import하는 계약. 소비자 SW는 이 host를 열기만 한다(sharedKernelHost 선례: 같은 폴더 계약).
- **offscreen 호스트 부트스트랩** - offscreen document가 코어 `boot()` + `enableBrowserControl()`을 켜는 얇은
  진입. 소비자 확장의 offscreen.js가 import한다.

소비자(codaro 등)는 자기 manifest/확장 셸을 소유하고, 위 세 조각을 커밋 SHA 핀으로 import한다. pyproc은
확장 자체를 웹스토어에 내지 않는다(제품 몫). 능력만 제공한다.

## BrowserControl 능력 계약 (파이썬 표면)

```
rt = await boot({ indexURL: chrome.runtime.getURL("/") })   # offscreen에서
bc = rt.enableBrowserControl()                              # SW 브리지에 배선
await bc.install()                                          # 파이썬 pyprocBrowser 모듈 등록
```

파이썬:

```python
import pyprocBrowser as browser
tab = browser.tab("https://example.com", mode="script")  # 또는 mode="debugger"
title = tab.evaluate("document.title")                    # 블로킹(JSPI run_sync)
tab.click("#login"); tab.type("#user", "alice")
snap = tab.snapshot()                                      # 세션 체크포인트(Phase 2)
tab.close()
```

`mode`가 이중 경로를 고른다(아래). 표면은 최소로 시작(tab/navigate/evaluate/click/type/close)하고, 강함은
깎아서 낸다(덕지덕지 금지). screenshot/waitFor 등은 수요 실측 후.

## 이중 경로 (스텔스 vs 신뢰 입력, 정직한 트레이드오프)

한 조작을 두 방식으로 할 수 있고, 각각이 다른 것을 포기한다. 능력이 `mode`로 노출한다:

| mode | 기반 | navigator.webdriver | isTrusted 입력 | 인포바 | 용도 |
|---|---|---|---|---|---|
| `script` | chrome.scripting(content script) | **false 기대**(미검증) | false | 없음 | 스텔스 필요(스크래핑, DOM 읽기/값 설정) |
| `debugger` | chrome.debugger(CDP Input.*) | **true 확정**(실측) | **true** | 있음 | 신뢰 입력 필요(봇 방어가 isTrusted 확인) |

`script`의 webdriver=false는 **Phase 0 수동 실측이 확정**한다(자동 하네스는 webdriver 전역 오염이라 불가).
확정 전까지 스텔스는 "설계 가정"이지 실측 사실이 아니다. 정직하게 표기한다.

## 프로세스 OS 대응 (진짜 차별점, Phase 2 프론티어)

기존 프로세스 OS 자산이 자동화에 그대로 맞물린다:

- **워커 N = 인터프리터 N = 세션 N**: offscreen 안 파이썬 워커 각자가 논리 세션(탭 + 조작 스크립트)을 소유한다.
  물리 `chrome.debugger`는 SW 단일 큐라 조작은 직렬화되지만, 스크립트 진행·상태는 N개 독립 인터프리터에 병렬.
- **스냅샷 = 세션 이미지, fork = 세션 복제**: 파이썬 런타임 상태(자동화 스크립트가 어디까지 갔나)를 완전 해시
  체크포인트한다(reactive 자산). 탭의 DOM 상태는 CDP 조작 로그 재생으로 재구성. = **"로그인까지 한 세션을
  스냅샷하고, 거기서 10갈래로 fork해 각기 다른 경로 탐색"**. Playwright/browser-use가 구조적으로 못 하는 축.

이 대응이 "왜 pyproc이 브라우저 자동화를 하나"의 답이다: 신규 개발이 아니라 소유한 프리미티브의 재사용.

## 실측 접지 (2026-07-13, attempts/browserControl)

| 항목 | 실측 | 의미 |
|---|---|---|
| offscreen Pyodide 부팅 | 2.5-3.0s, `runPython(1+1)==2` | 코어 `boot()` 재사용 성립(레이어 근거) |
| crossOriginIsolated | `true`(manifest COEP/COOP 키) | 프로세스 OS 전제 성립 |
| SAB + Worker + Atomics | 왕복 실동(view0=42) | 워커=프로세스 모델이 확장에 실림 |
| JSPI | `runPythonAsync==42` | 블로킹 브리지(run_sync) 가능 = 능력 계약 전제 |
| 파이썬 -> chrome.debugger CDP | navigate + evaluate 왕복 405ms | 조작 경로 실동 |
| navigator.webdriver(chrome.debugger) | `true` | debugger 경로 스텔스 없음 확정 |
| navigator.webdriver(content script) | 미확정(하네스 오염) | Phase 0 수동 실측 대상 |

## 정직한 벽

- **offscreen 1개 제약**: 확장당 offscreen document 하나. 병렬 세션은 그 안의 워커로 논리 병렬이고, 물리
  chrome.debugger 큐는 SW 단일이라 조작 자체는 직렬화될 수 있다(스루풋 상한).
- **chrome.debugger 인포바**: `debugger` 모드는 지속 UX 비용. `chrome://`·웹스토어엔 attach 불가.
- **스텔스 미검증**: `script` 모드 webdriver=false는 수동 실측 전까지 가정.
- **번들 13MB+**: 원격 코드 금지라 vendor 코어를 확장에 물리 번들. 확장 크기로 흡수.
- **탭 상태 재구성 한계**: 스냅샷 되감기는 파이썬 상태는 완전하나 탭 DOM은 조작 로그 재생 의존(외부 상태 변화,
  서버측 세션은 재생 불가). 정직한 경계.
