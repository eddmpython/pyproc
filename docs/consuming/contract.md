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
| `getPyProcAssetManifest` | 제품 배포가 같은 오리진에 둬야 하는 Worker/SharedWorker/Service Worker 실행 자산 manifest. stable role과 경로를 제공해 복사/SRI 파이프라인의 정본으로 쓴다 |
| `verifyPyProcAssetIntegrity` | `pyproc-assets`가 만든 SRI manifest를 실제 배포 바이트와 대조한다. Worker/SharedWorker/WASI worker는 `assetIntegrity` 옵션으로 spawn 전 graph 검증을 수행한다 |
| `registerPyProcServiceWorker` | `pyproc-assets` manifest의 `pyprocServiceWorker` graph를 SRI 검증한 뒤, 그 manifest URL로만 `pyprocSw.js`를 등록한다. `cache`/`asgi`/`coi`/`coreIntegrity` query를 안전하게 조립한다 |
| `boot(opts)` | Pyodide 런타임 부팅, `Runtime` 반환. `lockFileURL`로 freeze 락 재현, `coreCacheDir`로 코어 오프라인 캐시, `engineScriptIntegrity` / `coreIntegrity`로 부트 자산 SRI 검증 |
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
| `Init` | OS의 init: 마운트된 디스크의 `boot.py` 오토스타트, `cron.py` 주기 틱, `resume.py` 부활 hook(파일 주도, 없으면 no-op). `resume(reason)`은 `Session.load`/`MachineJournal.recover`/`openMachine` 뒤 fd/socket/DB connection을 재개설하는 계약이다 |
| `bootSession`/`Session` | 세션 부활: 결정적 리플레이 부팅 + 사용자 델타 OPFS 영속(같은 매니페스트 전제). `.pymachine`은 힙 델타와 `/home/web` 파일 트리를 함께 싣고, WebCrypto signature가 있으면 검증된 공개키로 `openMachine`을 승인한다 |
| `MachineJournal` | WAL: 유휴 커밋 + `recover()` 강제종료 부활. `pack()`/`prune()`은 장수 OPFS blob 저장소를 live HEAD/PREV 기준으로 압축·정리한다. `autoPack`은 loose blob 개수 또는 용량 임계값에 도달한 커밋 직후 pack을 실행한다 |
| `PyProc` | 프로세스 OS 커널(스냅샷-fork spawn + `map` 병렬) |
| `SharedKernel` | 탭 밖에서 사는 공유 커널(SharedWorker): 여러 탭 = 한 파이썬 상태. 모든 호출 Promise |
| `PAGE_SIZE` | WASM 페이지 크기 상수(65536) |

### Service Worker 자산 (pyprocSw.js)

`pyprocSw.js`는 import하는 모듈이 아니라 **소비자 오리진에서 등록하는 정적 자산**이다(SW는 same-origin 필수).
자기 배포 경로에 두고 등록하며, 기능은 쿼리로 켠다(조합 가능):

```js
import { registerPyProcServiceWorker } from "pyproc";

const assetIntegrity = await fetch("/vendor/pyproc-assets.json").then((r) => r.json());

// 오프라인 코어 캐시 + 가상 오리진(파이썬 서버 = 진짜 URL) 동시
await registerPyProcServiceWorker(assetIntegrity, {
  cache: true,
  asgi: "/pyproc/",
  coreIntegrity: "/vendor/pyodide-integrity.json",
  scope: "/",
});
new VirtualOrigin(asgiServer).bind(); // 이후 fetch("/pyproc/api/...")가 커널로 간다 (왕복 3.4ms)

// 헤더를 못 다는 호스팅(GitHub Pages 등)에서 SAB(프로세스 OS) 열기: 등록 + 1회 새로고침
await registerPyProcServiceWorker(assetIntegrity, { coi: true, scope: "/" });
```

`asgi`는 URL 문자열 포함이 아니라 `pathname` prefix로만 매칭한다. 루트 스코프에서는 `asgi: "/pyproc/"`가 `/pyproc/api/...`만 가로채며, 하위 스코프에서는 그 스코프 아래의 `pyproc/...`도 지원한다. `/node_modules/pyproc/...` 같은 패키지 자산 경로는 건드리지 않는다. 루트 스코프로 등록하려면 서버가 `Service-Worker-Allowed: /` 헤더를 줘야 한다(examples/serve.mjs 참조).
이 파일은 `virtualOrigin.js`와 같은 폴더에 있는 것이 경로 계약이다. 직접 `navigator.serviceWorker.register()` 문자열을 조합하지 않는다. 그러면 검증한 manifest 파일과 실제 등록 파일이 갈라질 수 있다.

### same-origin 실행 자산 manifest

`PyProc`, `SharedKernel`, `MachineContainer`, `WasiSession`, `VirtualOrigin`은 브라우저가 직접 여는
Worker/SharedWorker/Service Worker 엔트리포인트를 갖는다. 이 파일들은 CDN cross-origin URL로만
두면 실패하므로, 제품은 패키지의 `src/` 상대 import 구조를 보존해 같은 오리진에 배포한다.

```js
import { getPyProcAssetManifest } from "pyproc";

const manifest = getPyProcAssetManifest({ baseURL: "/vendor/pyproc/" });
// manifest.assets:
// - processWorker        src/processOs/worker.js
// - sharedKernelHost     src/processOs/sharedKernelHost.js
// - machineWorker        src/processOs/machineWorker.js
// - wasiWorker           src/runtime/engines/wasi/wasiWorker.js
// - pyprocServiceWorker  src/capabilities/pyprocSw.js
```

이 manifest는 실행 자산 경로의 정본이다. 배포 파이프라인은 이 목록을 복사 대상, same-origin 점검,
SRI/해시 manifest 생성에 사용한다. 현재 v1은 경로/역할/정책 계약이고, 실제 worker import graph는
아래 `pyproc-assets` 산출물과 `assetIntegrity` 옵션으로 런타임 preflight까지 연결한다.

Node 배포 파이프라인에서는 동봉 CLI를 쓰면 entrypoint뿐 아니라 상대 import graph까지 따라가
파일별 `sha256-...` SRI를 계산한다.

```bash
npx pyproc-assets --baseURL /vendor/pyproc/ --out public/vendor/pyproc-assets.json --copy-to public/vendor/pyproc
```

출력 JSON의 `entrypoints[].graph`는 각 Worker/SW가 실제로 가져가는 로컬 import graph이고,
`files[]`는 복사 대상 파일과 SRI다. `--copy-to`는 해당 graph 파일을 상대 경로 그대로 복사한다.

런타임에서는 이 JSON을 그대로 넘겨 worker 생성 전에 해당 role의 graph를 fetch + SHA-256으로 검증한다.

```js
import { boot, PyProc, verifyPyProcAssetIntegrity } from "pyproc";

const assetIntegrity = await fetch("/vendor/pyproc-assets.json").then((r) => r.json());
await verifyPyProcAssetIntegrity(assetIntegrity, { roles: ["processWorker"] }); // 직접 preflight

const rt = await boot({ assetIntegrity });
const os = new PyProc({ assetIntegrity });
await os.boot(4);
```

`boot({ assetIntegrity })`는 Runtime에 manifest를 보관하고, 그 Runtime에서 만든 `SyscallBridge`와
`MachineContainer`가 상속한다. Runtime 없이 쓰는 `PyProc`, `SharedKernel`, `JobControl`,
`bootWasi`는 자기 옵션에 `assetIntegrity`를 직접 받는다. 브라우저는 module Worker의 하위 import에
SRI 속성을 직접 걸 수 없으므로, 이 검증은 spawn 전 preflight다. 같은 오리진의 불변 배포 자산을
전제로 한다. Service Worker는 `registerPyProcServiceWorker()`로 `pyprocServiceWorker` graph를 먼저 검증하고,
`pyprocSw.js?cache=1&coreIntegrity=<manifest>`가 script/module/wasm/zip fetch를 SW 계층에서 다시 검증한다.

**가상 오리진 경계 (정직한 벽)**: SW 합성 응답이라 진짜 오리진과 다르다. (1) `Set-Cookie`는 스트립된다(쿠키 세션 불가 = 토큰 방식 사용). (2) WebSocket 업그레이드는 가로채지 않는다(ASGI dispatch는 HTTP 요청/응답 단위). (3) 스트리밍/SSE는 축적 후 일괄 응답이다(청크 스트림 아님). (4) 엔드포인트는 `async def` 강제(동기 dispatch 없음). 부활(저널/세션/openMachine) 후에는 파일 핸들·DB 커넥션 같은 프로세스 자원이 힙 델타만으로 보장되지 않는다: `.pymachine`은 파이썬 힙과 `/home/web` 파일 바이트를 복원하지만 열린 fd, 소켓, DB 커넥션은 다시 열어야 하므로, 소비자는 `Init.resume(reason)`으로 `/home/web/resume.py`를 실행해 그런 자원을 재개설한다. signature는 출처 검증이지 sandbox 권한 허가가 아니므로, 제품은 공개키 배포와 권한 UI를 별도로 관리한다.

subpath export: `pyproc/assets`, `pyproc/runtime`, `pyproc/reactive`, `pyproc/syscall-bridge`, `pyproc/process-os`, `pyproc/worker`. **src 내부 경로 deep import 금지** (내부 파일 배치는 릴리즈 간 바뀔 수 있다. 실제로 v0.0.3에서 레이어 폴더로 재배치됐고 subpath 이름은 불변이었다).

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
- **부트 자산 SRI(v2)**: `engineScriptIntegrity`는 pyproc이 삽입하는 `pyodide.js` script 태그에 표준
  `sha256-...` SRI를 붙인다. `coreIntegrity`는 fetch 경로의 indexURL 자산(wasm/stdlib/lock/휠 등)을
  같은 SRI manifest로 검증하고, strict 모드(기본)에서 manifest 누락이나 OPFS 캐시 변조를 부팅 실패로
  수렴시킨다. `assetIntegrity`는 pyproc Worker/SharedWorker/WASI worker의 로컬 import graph를 spawn 전
  fetch + SHA-256으로 검증한다. `registerPyProcServiceWorker()`는 Service Worker 등록 파일을 같은 manifest로 묶고,
  `pyprocSw.js`의 `coreIntegrity` 모드는 브라우저 동적 import가 JavaScript `fetch` wrapper 밖에서 가져가는 Pyodide 내부 모듈까지 SW fetch 이벤트에서 검증한다. 실측: `runtimeIntegrityProbe.html` GREEN 6/6, Node gate의
  `asset integrity preflight`와 `assetManifest CLI` GREEN, 브라우저 게이트의 Service Worker 등록 경로와 SW `coreIntegrity` 검증 GREEN.
- **WASI 세션(bootWasi/WasiSession)은 별도 async 표면이다.** Pyodide 기반 표면(boot/Runtime/PyProc/ReactiveController)과 무관하게 additive로 추가됐다(기존 소비자 무영향). 엔진 무관 실증용 opt-in이며, `wasmURL`은 소비자가 제공한다(COOP/COEP 하에선 셀프 호스팅). 제약: 값 다리는 JSON 직렬화 한정(FFI 없음), 네이티브 확장 불가(정적 링크), 크로스 엔진 .pymachine 불가. 프로덕션 상용 파이썬은 Pyodide 표면이 정본이다.
- 번들러 계약: `moduleResolution: "Bundler"` + `allowJs: false`에서 타입 해석, Vite가 `new Worker(new URL(...))`를 워커 청크로 emit(codaro에서 3단계 검증 완료).

## 소비자별 배선 상태

| 소비자 | 상태 |
|---|---|
| dartlab | **라이브 소비자.** 노트북 워커가 자체 부팅한 Pyodide를 `new Runtime(py)`로 채택하고 `enableAsgiServer`를 기본 ASGI 커널로 프로덕션 배포(browser-as-server /pyapi). 프로세스 병렬(scan)/시간여행 UI는 후속 채택 후보 |
| codaro | first consumer. `a7fc83906cfa7bf24c009c8631043738423fa84a` SHA 핀 + `browserPythonRuntime.ts` seam. Runtime + PyProc 타입 import + `Runtime.fs`와 `AsgiServer` 제품 소비. codaro seam은 Vite `BASE_URL` 기준 `pyproc-assets.json`을 읽어 `boot({ assetIntegrity })`로 넘긴다. editor build 후처리는 설치된 pyproc 패키지에서 실행 자산 graph/SRI를 뽑아 `webBuild/pyproc-assets.json`과 `webBuild/vendor/pyproc/**`로 쓴다. 실측: codaro editor build가 25개 파일 graph와 5개 entrypoint role을 산출했고, `pyproc-assets-browser` product gate가 실제 브라우저에서 `/pyproc-assets.json`과 `/vendor/pyproc/**`를 fetch해 `sha256-...` SRI를 검증한다. codaro `e862593f090e471f4bc0345a6c7fefc1c0e91576`의 `pyproc-runtime-fs-browser` gate는 build된 editor가 실제 pyproc을 boot한 뒤 `Runtime.fs`로 `/home/web/codaro`에 셀 소스와 실행 기록을 쓰고, 다음 셀이 같은 기록을 Python `open()`으로 읽는지 확인한다. codaro `527e0e26`의 `pyproc-asgi-browser` gate는 같은 editor build에서 `rt.enableAsgiServer({ app })`를 호출하고 `POST /codaro/pyproc-asgi?value=41`의 method/path/query/body/header가 Python ASGI 앱까지 도달한 뒤 `207` + `x-codaro-runtime: pyproc-asgi` 응답으로 돌아오는지 확인한다. 제품 UI는 `data-runtime-artifacts`로 브라우저 파일 산출물을 노출하고, quality cycle은 `pyproc-assets-report.json`, `pyproc-runtime-fs-report.json`, `pyproc-asgi-report.json`을 freshness evidence로 대조한다 |
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
