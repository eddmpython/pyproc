# browserControl - 확장(MV3) 안에서 파이썬이 브라우저 자체를 조작할 수 있는가

브라우저 안에 있으면서 브라우저에 권한을 갖는 유일한 합법 링은 확장(MV3)이다. 페이지(링 0)는
자기 origin의 웹 플랫폼이 최대치고, 탭 목록/주소창/다른 origin/CDP에는 원리적으로 닿지 않는다
(사이트 격리 + 렌더러 샌드박스 = 크롬 제1 불변식, 우회 축 아님). 확장은 `chrome.tabs`/`chrome.scripting`/
`chrome.debugger`(= CDP를 함수 호출로)를 갖는다. pyproc의 프로세스 OS(워커 N = 인터프리터 N = CDP 세션 N)가
여기 자연스럽게 맞물린다: "서버리스 · 프로세스 내 브라우저 자동화 파이썬 런타임"은 기존 자동화 스택이 못 하는 축이다.

## 가설

MV3 offscreen document는 진짜 DOM 문서이므로 vendor 엔진 자산을 **번들**하면(원격 코드 금지 대응)
Pyodide가 뜬다. manifest의 COEP/COOP 키로 확장 문서를 `crossOriginIsolated`로 만들 수 있으면 SAB/워커/
JSPI가 살아 = 프로세스 OS가 통째로 실린다. 그리고 파이썬 -> JS 브리지 -> `chrome.debugger`로 다른 탭에
붙어 CDP 왕복(`Page.navigate` -> `Runtime.evaluate`)이 서버·네트워크 홉 0으로 된다.

## 실측 환경 (확장 로딩 = CDP 경로 강제)

`--load-extension` 플래그는 Chrome/Edge 137+에서 제거됐다(사전 게이트 0 실측: Chrome 150에서 신호 0).
확장 로딩은 CDP `Extensions.loadUnpacked` + `--enable-unsafe-extension-debugging`으로만 된다(같은 실측에서
확장 ID 반환 + 서비스워커에서 `chrome.debugger` 가시 확인). 이 캠페인 전용 러너가 그 경로로 확장을 띄운다.
엔진 코어(9MB wasm 등)는 커밋하지 않고 러너가 임시 디렉터리로 조립한다(vendor/pyodide -> temp, 자산 0).
백채널 포트는 조립 시점에 `config.js`로 구워 넣는다(CDP evaluate 주입은 서비스워커 실행 컨텍스트가
불안정해 폐기: attach한 SW 세션의 `Runtime.evaluate`가 확장 chrome이 아닌 웹페이지 chrome에서 돌았다).
게이트 셋을 하나의 러너가 통합 실측한다(부팅 -> 격리 -> 파이썬발 CDP 왕복을 한 실행에서):

```
node tests/attempts/browserControl/bootIsolationRunner.mjs
```

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| MV3 offscreen에서 Pyodide가 뜨는가(번들 자산 + wasm CSP) | bootIsolationRunner | `loadPyodide` 성공 + `runPython("1+1")==2`. 실패면 사유 기록 |
| 그 문서가 crossOriginIsolated = 프로세스 OS가 실리는가 | bootIsolationRunner | `crossOriginIsolated===true` + `SharedArrayBuffer` 생성 + module Worker 스폰 + SAB Atomics 왕복 |
| 파이썬에서 chrome.debugger로 다른 탭 CDP 왕복이 되는가 | bootIsolationRunner | 파이썬발 새 탭 attach -> `Page.navigate` -> `Runtime.evaluate`가 페이지 title/DOM/계산값 회수 |

승격 조건(전 게이트 GREEN): `mainPlan/`에 이니셔티브 개설 후 확장 어댑터 능력 설계. 하나라도 RED면
결론 표에 사유 기록하고 접는다(정직한 경계).

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-13 | 사전 게이트 0(로딩 경로) | Chrome 150 headless | `--load-extension` 신호 0 = 죽음. CDP `Extensions.loadUnpacked`(+`--enable-unsafe-extension-debugging`) 확장 ID 반환 + SW에서 `chrome.debugger`=object | 확장 로딩은 CDP 경로 단일 확정. 러너 분기 불필요 | 러너 경로 고정 |
| 2026-07-13 | bootIsolationRunner | Edge 150 headless + vendor 번들 | **게이트 1+2+3 GREEN 9/9.** offscreen `crossOriginIsolated===true`, `SharedArrayBuffer`, module Worker + SAB Atomics 왕복(view0=42), Pyodide 부팅 **2.5-3.0s** + `runPython(1+1)==2`, `runPythonAsync==42`(JSPI 실동작), **게이트3: 파이썬 -> chrome.debugger로 새 탭 attach -> `Page.navigate` -> `Runtime.evaluate`가 title=pyprocCdpTarget + DOM marker=cdpMarkerOk + 계산 42 회수, 왕복 405ms** | **세 게이트 전부 실측 성립.** MV3 offscreen에 프로세스 OS가 통째로 실리고(SAB/워커/JSPI), 파이썬이 서버·네트워크 홉 0으로 브라우저 자체를 조작한다. manifest COEP/COOP 키가 확장 문서를 격리시킨다 = 최대 미검증 지점 해소 | **졸업 -> mainPlan 이니셔티브 개설 대상** |

## 판정

**졸업 (실측 3/3 GREEN, 2026-07-13).** MV3 확장(offscreen document + 서비스워커 chrome.debugger)이
"서버리스 · 프로세스 내 브라우저 자동화 파이썬 런타임"을 실측으로 지탱한다. 다음 수는 `mainPlan/`에
이니셔티브를 열어 승격 형태를 설계하는 것(확장 어댑터 능력: offscreen 런타임 호스트 + chrome.debugger
브리지의 능력 계약화, 프로세스 OS의 워커 N <-> CDP 세션 N 대응). 착수 전 정합성·ROI 재검은 그 PRD에서.
