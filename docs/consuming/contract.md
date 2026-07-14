# 소비 계약 - 제품이 pyproc을 가져다 쓰는 법

pyproc은 "참조"가 아니라 **실제 import**로만 SSOT가 된다. 이 문서가 소비자(codaro/dartlab/xlpod와 외부 사용자)와의 계약이다.

## 설치 (npm 버전 핀)

```jsonc
// package.json
"dependencies": {
  "pyproc": "0.0.9"
}
```

- **npm 레지스트리에서 정확 버전으로 가져간다.** 플로팅(`^`/`~`/`latest`) 금지 = 정확 버전 + 락파일이 재현성을 보장한다. 올릴 때는 의도적으로 새 릴리즈 버전으로 되핀. 릴리즈는 버전 +1 + 태그 + GitHub Release + npm publish가 한 벌이다([release.md](../operations/release.md)).
- 빌드 단계가 없다(네이티브 ESM). 번들러 없이 `<script type="module">`에서도 동작한다.
- **대안 경로**(선택): 릴리즈 전 커밋을 당기려면 SHA 핀 `"pyproc": "github:eddmpython/pyproc#<commit-sha>"`, 설치 0이면 CDN `https://cdn.jsdelivr.net/npm/pyproc@<version>/index.js`. 단 `PyProc`(프로세스 OS)는 워커 파일이 페이지와 same-origin이어야 하므로(브라우저의 cross-origin worker 차단) npm 설치나 벤더링이 필요하다.

## 공개 표면 (이것만 의존한다)

| export | 무엇 |
| --- | --- |
| `boot(opts)` | Pyodide 런타임 부팅, `Runtime` 반환. `lockFileURL`로 freeze 락 재현, `coreCacheDir`로 코어 오프라인 캐시 |
| `bootEnv(manifest, dirs)` | uv 레인 부팅: bare 스냅샷 + OPFS 휠로 2차 부팅이 복원이 된다(실측 1229ms, 콜드 4.2배) |
| `runScript(rt, src, opts)` | 브라우저판 `uv run`: PEP 723 인라인 의존성 자동 설치 + 실행 |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` / `loadPackagesFromImports` / `setStdout` / `setStderr` / `freeze`(락 고정) / `mountHome` / `fs` + 능력 등록 |
| `MemoryCapability` | WASM 힙 접근을 캡슐화한 능력 계약 |
| `FileSystem` (`Runtime.fs`) | 엔진-무관 일반 파일 IO(소비자가 `raw.FS` 대신): writeFile/readFile(utf8·binary)/mkdir/mkdirTree/readdir/stat/exists/unlink/rmdir. 영속은 `mountHome`, 이건 그 위 파일-op 레이어 |
| `ReactiveController` | 복원 기반 리액티브(체크포인트 / 시간여행) |
| `SyscallBridge` | 빌린 시스템콜 v1: input(동기/JSPI 블로킹), urllib(동기 XHR, proxyUrl), subprocess(자식 워커) |
| `AsgiServer` | 커널 안 ASGI 서버(소켓 0 dispatch) |
| `VirtualOrigin` | 파이썬 서버를 진짜 URL로: SW 자산 `src/capabilities/pyprocSw.js`와 짝(아래 SW 절) |
| `Terminal` | 서버리스 터미널(REPL, `%pip`/`%undo`) |
| `DeviceFs` | 모든 것은 파일: 브라우저 능력을 파이썬 `open()`으로(내장 `/proc/meminfo`·`/dev/clipboard`, 소비자 장치 주입) |
| `Init` | OS의 init: 마운트된 디스크의 `boot.py` 오토스타트 + `cron.py` 주기 틱(파일 주도, 없으면 no-op) |
| `bootSession`/`Session` | 세션 부활: 결정적 리플레이 부팅 + 사용자 델타 OPFS 영속(같은 매니페스트 전제) |
| `PyProc` | 프로세스 OS 커널(스냅샷-fork spawn + `map` 병렬) |
| `SharedKernel` | 탭 밖에서 사는 공유 커널(SharedWorker): 여러 탭 = 한 파이썬 상태. 모든 호출 Promise |
| `PAGE_SIZE` | WASM 페이지 크기 상수(65536) |

### Service Worker 자산 (pyprocSw.js)

`pyprocSw.js`는 import하는 모듈이 아니라 **소비자 오리진에서 등록하는 정적 자산**이다(SW는 same-origin 필수).
자기 배포 경로에 두고 등록하며, 기능은 쿼리로 켠다(조합 가능):

```js
// 오프라인 코어 캐시 + 가상 오리진(파이썬 서버 = 진짜 URL) 동시
await navigator.serviceWorker.register("/pyprocSw.js?cache=1&asgi=/pyproc/");
new VirtualOrigin(asgiServer).bind(); // 이후 fetch("/pyproc/api/...")가 커널로 간다 (왕복 3.4ms)

// 헤더를 못 다는 호스팅(GitHub Pages 등)에서 SAB(프로세스 OS) 열기: 등록 + 1회 새로고침
await navigator.serviceWorker.register("/pyprocSw.js?coi=1");
```

루트 스코프로 등록하려면 서버가 `Service-Worker-Allowed: /` 헤더를 줘야 한다(examples/serve.mjs 참조).
이 파일은 `virtualOrigin.js`와 같은 폴더에 있는 것이 경로 계약이다.

**가상 오리진 경계 (정직한 벽)**: SW 합성 응답이라 진짜 오리진과 다르다. (1) `Set-Cookie`는 스트립된다(쿠키 세션 불가 = 토큰 방식 사용). (2) WebSocket 업그레이드는 가로채지 않는다(ASGI dispatch는 HTTP 요청/응답 단위). (3) 스트리밍/SSE는 축적 후 일괄 응답이다(청크 스트림 아님). (4) 엔드포인트는 `async def` 강제(동기 dispatch 없음). 부활(저널/세션/openMachine) 후에는 파일 핸들·DB 커넥션 같은 프로세스 자원이 되살아나지 않는다: 리플레이+델타는 파이썬 힙 상태를 복원하지 그 밖의 OS 자원을 복원하지 않으므로, 소비자는 부팅 훅(`boot.py` 또는 `Init`)에서 그런 자원을 재개설한다.

subpath export: `pyproc/runtime`, `pyproc/reactive`, `pyproc/syscall-bridge`, `pyproc/process-os`, `pyproc/worker`, `pyproc/browser-control-host`. **src 내부 경로 deep import 금지** (내부 파일 배치는 릴리즈 간 바뀔 수 있다. 실제로 v0.0.3에서 레이어 폴더로 재배치됐고 subpath 이름은 불변이었다).

### 브라우저 컨트롤 확장 (BrowserControl)

`BrowserControl`은 MV3 확장 안에서만 성립한다(offscreen document = 런타임 호스트, service worker = 권한 소유). 코어의 "단일 import + 버전 핀"과 달리, 확장은 파일이 확장 패키지 안에 물리적으로 있어야 하고 manifest 키의 상당수가 제품 결정이 아니라 pyproc 런타임 요구다. 조립 레퍼런스(실 src를 import하는 최소 픽스처): `tests/browser/runExtension.mjs` + `tests/browser/extensionFixture/`.

**두 절반(같은 핀 강제)**:
- offscreen: `boot()` + `Runtime.enableBrowserControl()` + `install()` (능력, index import). JSPI 필요 = `rt.runAsync` 경로.
- service worker: `openBrowserControlHost()` (subpath `pyproc/browser-control-host`).
- 두 절반은 `browserControlProtocol`의 버전된 메시지로 통신하고(현재 `PROTOCOL_VERSION=2`), `install()`이 핸드셰이크로 버전 불일치를 loud fail한다. **두 절반은 반드시 같은 pyproc 핀**이어야 한다(다른 핀 = 프로토콜 드리프트 = 런타임 파손).

**프로세스 OS 융합(워커 N = 세션 N, 독립 GIL N)**: `install()`은 offscreen 메인 인터프리터를 배선한다. N개 워커가 각자 파이썬으로 브라우저를 몰려면(진짜 병렬), dedicated Worker엔 `chrome.*`이 없으므로(제약 A) offscreen이 라우터가 된다. 워커 측은 `installBrowserWorker(py)`(그 워커 파이썬의 `_pyprocBrowserSend`를 offscreen postMessage로 배선 + `pyprocBrowser` 모듈 실행), offscreen 측은 스폰한 워커마다 `routeBrowserWorker(worker)`(워커 op를 SW 호스트로 릴레이). 워커는 offscreen(COI)에서 스폰돼 crossOriginIsolated를 상속해야 SAB/JSPI(run_sync)가 산다. 파이썬 연산은 워커별 GIL로 물리 병렬, 브라우저-op은 SW 단일 CDP 큐로 직렬(정직한 천장: N배 연산 병렬 + 1배 op 레이트). 실측: 실 src 픽스처가 Pyodide 워커를 이 경로로 몰아 검증.

**조작 표면(`pyprocBrowser.tab(url, mode)` -> `BrowserTab`)**: 항법(navigate/reload/back/forward), 입력(click/doubleClick/rightClick/hover/type/fill/press/select, 좌표 입력은 자동 스크롤 내장 + scrollIntoView/upload), 조회·추출(evaluate/text/html/attr/value/exists/count/texts/boundingBox/title/url/content), 대기(waitFor/waitForFunction), 캡처·에뮬레이션(screenshot/pdf/setViewport/setUserAgent/setHeaders/emulateMedia 다크모드·setTimezone·setOffline·setGeolocation 좌표 스푸핑), 다운로드 관측(enableDownloads/waitForDownload = 무엇이 다운로드되는지 파일명·URL 회수, 저장 경로 지정은 browser-level이라 미지원), 콘솔·에러 캡처(enableConsole/consoleLogs/waitForConsole = 페이지 console.* + 미처리 예외 관측), 접근성 트리(accessibilityTree = role/name 시맨틱으로 페이지 회수), 쿠키(cookies/setCookie/clearCookies/deleteCookie), 다이얼로그(setDialogHandler/lastDialog = alert/confirm/prompt 세션 정책 자동 응답), 네트워크(route/unroute = CDP Fetch 차단·정적 응답·요청 변조·붙잡기, 붙잡은 요청의 콜백형 결정 pendingRequests/continueRequest/fulfillRequest/abortRequest, waitForResponse/requests/responseBody = 응답 관측·바디 캡처), 프레임(frames/frame = iframe 내부 드릴다운. same-origin은 isolated world, cross-origin OOPIF는 chrome.debugger.getTargets에서 이 페이지 iframe src로 스코프해 targetId로 직접 attach = 둘 다 지원). 조작 계열은 핸들을 돌려 체이닝되고, 조회 계열은 JSON-값을 돌려준다(structured clone 경계라 PyProxy 아님). mode="debugger"는 CDP 신뢰 입력(isTrusted=true) + 캡처·에뮬·다이얼로그·네트워크 전 표면, mode="script"는 chrome.scripting 합성 입력(isTrusted=false)이고 CDP 전용 표면은 미지원 예외다. CDP 전용 표면은 추가 권한이 아니라 `debugger`가 여는 CDP Page/Network/Emulation/Fetch/DOM 도메인으로 대행한다. 전 표면은 attempts 게이트(1-16) + 실 src 픽스처로 브라우저 실측 통과(정본 타입: `index.d.ts`의 `BrowserTab`).

**manifest 필수 키(pyproc 런타임 요구, 제품이 못 바꾸는 계약)**:

| 키 | 이유 |
| --- | --- |
| `cross_origin_embedder_policy: require-corp` + `cross_origin_opener_policy: same-origin` | crossOriginIsolated = 프로세스 OS(SAB/워커) 전제 |
| `content_security_policy.extension_pages: "... 'wasm-unsafe-eval' ..."` | 원격 코드 금지 하 Pyodide WASM 구동 조건 |
| `permissions: offscreen, debugger, scripting, tabs` | 능력이 쓰는 chrome API(debugger 모드 = CDP 신뢰입력, script 모드 = chrome.scripting, 탭 수명) |
| `permissions: declarativeNetRequest` | iframe 역전(고정 화면) 헤더 제거. 조작만 쓰면 생략 가능 |
| `permissions: storage` | 세션 메타 storage.session write-through(SW 소멸 후 재attach 복구) |
| `permissions: contentSettings` | setGeolocation 권한 부여. CDP Browser.grantPermissions가 browser-level이라 막혀 chrome.contentSettings.location로 우회. 지오로케이션 안 쓰면 생략 가능 |
| `minimum_chrome_version: 116` | offscreen API 하한 |

제품 결정(소비자 몫): `name`/`description`/`host_permissions` 범위/웹스토어 메타. offscreen이 자기 확장 자산을 로드하는 경로엔 `web_accessible_resources`가 불필요하다(same-origin 확장 문서, 픽스처 실측 확인).

**vendoring(SHA-핀 단일 import로는 부족)**: 확장은 번들러 없이 상대 경로로 로드되므로, pyproc `src` 트리를 구조 보존해 확장에 vendoring한다(offscreen이 `boot()`로 워커를 스폰하면 `worker.js`가 같은 폴더 계약을 확장 안으로 끌고 온다). vendor Pyodide 코어도 확장에 번들(`npm run fetch:engine`). 번들 소비자(Vite)는 subpath export로, 언번들 확장은 구조 보존 vendoring으로 도달한다.

**offscreen 격리 vs iframe 역전(Phase 2)**: 프로세스 OS는 COI(COEP require-corp)를 요구하는데 cross-origin iframe 역전(고정 화면)은 credentialless를 강제해 쿠키/sandbox가 막힌다(실측 3중 확증). 그래서 런타임(COI offscreen)과 iframe 셸(non-COI 문서)은 **다른 문서로 분리**한다. iframe 셸 UI는 제품 몫이고 pyproc은 헤더 제거 프리미티브만 기여한다.

- 타입은 동봉된 `index.d.ts`가 계약이다.
- 엔진 내부(`HEAPU8`, `Runtime.raw` 등)를 직접 만지지 않는다. `raw`는 탈출구이고 계약 밖이다.
- **restoreLive 실행 경계 계약(기계 강제)**: 경계를 지키면 즉시 복원(재해싱 0), 위반은 자동 감지되어 재해시 경로로 승격된다(조용한 오염 없음). 반환값 `rehashed`로 경로 확인. 즉시성이 필요하면 복원 전 `checkpoint()`로 경계를 닫아라.

## 방향과 경계

- 의존은 **products -> pyproc 단방향**. pyproc은 어떤 소비 제품도 import하지 않는다.
- 제품 UI/도메인 로직은 pyproc에 넣지 않는다. pyproc은 런타임/능력만 제공한다.
- 지원: Chromium/Edge 전용(JSPI + SharedArrayBuffer + crossOriginIsolated). 페이지에 COOP/COEP 헤더 필요.

## 런타임 정합 (하드 제약)

- 기본 Pyodide: **v314.0.2 (CPython 3.14)**, 기본은 CDN 로드. 소비 제품이 자체 Pyodide 코드를 병행하는 동안(xlpod)에는 같은 버전을 유지해야 이관이 성립한다.
- **자가 호스팅(유통 독립)**: CDN 가용성·정책은 우리 통제 밖이므로, 배포 지점을 통째로 옮길 수 있다.
  `npm run fetch:engine`이 GitHub Releases의 전체 배포판(코어 + 전 패키지 wheel, 426MB)을 `vendor/pyodide/`로
  준비하고, `boot({ indexURL: "/vendor/pyodide/" })`로 소비한다(패키지 설치·lock 해석까지 CDN 0).
  게이트 전 검사도 같은 스위치로 돈다: `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:browser`
  (실측 2026-07-13: 자가 경로에서 39/39 GREEN + offlineBoot/swOffline 재실측 GREEN). `indexURL`은
  부팅 커널의 속성으로 기록되어 자식 워커(subprocess)도 같은 지점을 쓴다(CDN 누수 없음).
- **WASI 세션(bootWasi/WasiSession)은 별도 async 표면이다.** Pyodide 기반 표면(boot/Runtime/PyProc/ReactiveController)과 무관하게 additive로 추가됐다(기존 소비자 무영향). 엔진 무관 실증용 opt-in이며, `wasmURL`은 소비자가 제공한다(COOP/COEP 하에선 셀프 호스팅). 제약: 값 다리는 JSON 직렬화 한정(FFI 없음), 네이티브 확장 불가(정적 링크), 크로스 엔진 .pymachine 불가. 프로덕션 상용 파이썬은 Pyodide 표면이 정본이다.
- 번들러 계약: `moduleResolution: "Bundler"` + `allowJs: false`에서 타입 해석, Vite가 `new Worker(new URL(...))`를 워커 청크로 emit(codaro에서 3단계 검증 완료).

## 소비자별 배선 상태

| 소비자 | 상태 |
|---|---|
| dartlab | **라이브 소비자.** 노트북 워커가 자체 부팅한 Pyodide를 `new Runtime(py)`로 채택하고 `enableAsgiServer`를 기본 ASGI 커널로 프로덕션 배포(browser-as-server /pyapi). 프로세스 병렬(scan)/시간여행 UI는 후속 채택 후보 |
| codaro | first consumer. SHA 핀 + `browserPythonRuntime.ts` seam. Runtime + PyProc 타입 import |
| xlpod | 준비 중(스프레드시트 =PYUDF 셀 안 파이썬 동기 호출). pyproc 소비를 PRD로 확정. 하드 블로커였던 `setInterruptBuffer`가 공개 표면으로 승격돼 이관 경로가 열림. 자체 SAB 동기 브리지(formualizer 콜백)는 잔류(로드맵 syncUdfBridge가 흡수 예정) |

## 자체 부팅한 Pyodide 채택 (dartlab/xlpod 패턴)

워커에서 자체 부팅한 Pyodide가 이미 있으면 pyproc의 `boot()`을 또 부르지 않고 그 인스턴스를 채택한다:

```js
// 워커: 자체 부팅한 Pyodide(예: dartlab의 노트북 워커)
const py = await loadPyodide({ indexURL });
// pyproc 능력을 그 위에 얹는다(두 번째 인터프리터를 만들지 않는다)
const rt = new Runtime(py);              // Runtime(py)는 Pyodide 인스턴스를 감싼다(하위 호환)
const asgi = rt.enableAsgiServer({ app: "app" });   // 커널 안 서버
rt.setInterruptBuffer(interruptSab);     // 동기 UDF 무한 실행 취소(SIGINT)
const fn = rt.getGlobal("myUdf");        // PyProxy: call/toJs/destroy 재사용(셀마다 재조회 0)
```

- `new Runtime(py)`는 EngineContract가 아니라 로드된 Pyodide를 주면 감싼다(구분: `runSync` 유무). `boot()`을 못 쓰는 워커 소비자의 채택 경로다.
- `setInterruptBuffer(sab)`: 이 SAB의 `[0]`에 시그널 번호(2=SIGINT)를 쓰면 실행 중 파이썬이 취소된다. 엔진 `raw` 없이 계약으로 도달한다.
- `getGlobal(name)`은 엔진 프록시(PyProxy)를 그대로 반환한다. `call`/`toJs`/`destroy`가 계약상 지원된다(재사용 캐시 패턴).
- WASI 세션(`bootWasi`)은 별도 async 표면이며 값 다리 JSON 한정이라, C 확장(polars/pyarrow)에 의존하는 dartlab/xlpod의 정본 경로는 Pyodide다.

배선 로드맵 상세: [mainPlan/_done/web-python-runtime/02-phasing-and-wiring.md](../../mainPlan/_done/web-python-runtime/02-phasing-and-wiring.md)
