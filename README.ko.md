<p align="center"><img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="88" alt="pyproc logo"></p>

# pyproc

**서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬.** 진짜 프로세스와 멀티코어 병렬, 체크포인트 / 시간여행, 커널 안 ASGI 서버, 터미널, 그리고 이동 가능한 머신 이미지(도는 파이썬 컴퓨터를 파일 하나로)를 [Pyodide](https://pyodide.org) / WebAssembly 위 하나의 재사용 런타임으로 묶었다. codaro / dartlab / xlpod가 공유하는 웹 파이썬 런타임의 SSOT.

**라이브 데모**: [eddmpython.github.io/pyproc](https://eddmpython.github.io/pyproc/) - 파이썬 머신, 터미널, 프로세스 OS를 브라우저에서 바로(Chromium/Edge).

언어: [English](README.md) | 한국어

---

## 목표는 하나다

**브라우저에서 파이썬이 로컬처럼 도는 환경을 만든다.** 로컬급 실행 속도, 진짜 프로세스와 병렬, 터미널, 패키지 설치, 나아가 임베디드 파이썬·uv급 환경 관리까지 - 서버 없이 탭 안에서. 로컬에서 되는 것은 브라우저에서도 되게 만드는 것이 이 레포의 유일한 목표이고, 모든 주장은 브라우저 실측으로만 인정한다. 축별 격차와 진행은 [local-parity](mainPlan/local-parity/README.md)가 추적한다.

## 이게 뭔가?

pyproc은 브라우저 파이썬을 "노트북 한 셀"이 아니라 **운영체제처럼** 다룬다.

- Web Worker가 **프로세스**가 된다.
- 힙 스냅샷이 **프로세스 이미지**가 된다.
- 그 스냅샷을 워커에 주입하면 **fork**가 된다.
- 독립 인터프리터 N개 = 독립 GIL N개 = **N코어 물리 병렬**.

내부는 [Pyodide](https://pyodide.org)(WebAssembly로 컴파일된 CPython)를 돌리지만, Pyodide가 기본으로 주지 않는 런타임의 물성을 얹는다: 프로세스를 싸게 생성하고, 병렬로 돌리고, 코드를 재실행하지 않고 인터프리터 상태를 복원한다. 빌드 단계 없는 순수 ESM 라이브러리이고, 진짜 제품이 import해서 쓰라고 만들었다.

## 왜 만들었나?

브라우저에서 파이썬을 돌리는 조각은 이미 있다. 없던 것은 그 조각을 진짜 런타임으로 엮는 **공유 계층**이다. codaro·dartlab·xlpod가 전부 같은 걸 필요로 하는데, 각자 복붙하면 런타임이 3벌로 갈라져 따로 논다. pyproc은 그 계층을 한 번 만들어 버전 고정으로 공유해서, 개선이 한 곳에 모이게 한다. 전체 방향과 정책은 [docs/product/vision.md](docs/product/vision.md).

## 누가 쓰나

- **dartlab** (라이브): DART + SEC 공시 데이터 노트북. 노트북 워커가 자체 부팅한 Pyodide를 `new Runtime(py)`로 채택하고, 커널 안 `AsgiServer`를 browser-as-server 백엔드로 프로덕션 운영한다(`fetch("/pyapi/...")`를 파이썬 앱이 소켓 없이 응답).
- **codaro**: first consumer. 커밋 SHA 핀, `Runtime` + `PyProc` seam 배선.
- **xlpod** (준비 중): 셀 수식 안에서 진짜 파이썬을 부르는 브라우저 스프레드시트(`=PYUDF`). `Runtime`, `setInterruptBuffer`(무한 UDF 취소), PyProxy 값 다리를 쓴다. 자체 SAB 동기 브리지는 xlpod에 잔류.

자체 부팅한 Pyodide가 이미 있으면 `new Runtime(py)`로 채택한다: 두 번째 인터프리터 없이 능력만 얹는다. 상세: [docs/consuming/contract.md](docs/consuming/contract.md).

## 핵심 개념, 쉽게

**1. 스냅샷-fork (빠른 프로세스 생성).** Pyodide 인터프리터를 새로 부팅하면 약 2.8초 걸린다. pyproc은 부모 하나를 부팅해 메모리 스냅샷("프로세스 이미지")을 뜨고, 워커를 그 스냅샷에서 약 184ms에 시작한다. 15.4배 빠른 spawn이고, 각 자식은 독립 프로세스다.

**2. 프로세스 OS (진짜 병렬).** 각 워커가 자기 GIL을 가진 독립 인터프리터라, 같은 함수를 워커들에 돌리면 한 스레드 위의 동시성이 아니라 진짜 멀티코어 실행이 된다. `PyProc.map()`이 워커들이 태스크 큐를 동시에 소진하게 한다.

**3. 복원 기반 리액티브 (재실행 없는 시간여행).** 리액티브 노트북은 보통 상류가 바뀌면 셀을 재실행한다. WebAssembly에는 OS의 dirty-page 추적이 없어서, pyproc은 실행 경계마다 힙을 완전 해시해 바뀐 페이지만 저장하는 방식으로 그걸 재구성한다. 이전 상태로 복원할 땐 재실행 대신 다른 페이지만 되써서(약 2.4ms) 되돌린다. 완전 해시가 soundness의 열쇠다. 샘플링하면 변경을 놓쳐 복원이 깨진다.

**4. 이동 가능한 머신 이미지 (도는 컴퓨터를 파일 하나로).** 결정적 부팅(해시 시드 고정 + 엔트로피·시간 스텁)이 바이트 동일 힙을 재현하므로 base는 옮길 필요가 없다: `Session`은 사용자 작업(리플레이 경계와 다른 페이지, 약 10MB)만 저장하고, `exportImage()`가 그 델타를 `.pymachine` 파일 하나로 packs한다. 다시 열면 같은 base를 리플레이한 뒤 델타를 적용(약 1.5ms)해 파이썬 상태가 되살아난다. VM 이미지는 수 GB인데 이건 살아있는 머신이 수 MB 파일이다. 같은 머신에서 다시 열기는 오늘 증명됐고, cross-machine 결정성("남에게 이메일로" 주장)은 [local-parity](mainPlan/local-parity/README.md)의 열린 probe다.

## 지원 환경

**Chromium / Edge 전용.** JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox / Safari 미지원은 결함이 아니라 의도된 스코프다.

SharedArrayBuffer를 쓰려면 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 설치

npm 레지스트리에서 설치한다([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)):

```sh
npm install pyproc
```

pyproc을 런타임 SSOT로 소비하는 제품은 계속 커밋 SHA 핀을 쓴다(기본 브랜치를 따라가는 플로팅은 금지):

```jsonc
// package.json
"dependencies": {
  "pyproc": "github:eddmpython/pyproc#<commit-sha>"
}
```

빌드 단계가 없다(네이티브 ESM). 설치 없이 CDN에서 바로 import할 수도 있다.

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/gh/eddmpython/pyproc@<commit-sha>/index.js";
</script>
```

CDN 직접 import는 단일 런타임 경로(`boot`/`Runtime`/리액티브)만 지원한다. 프로세스 OS(`PyProc`)는 워커 파일이 페이지와 same-origin이어야 해서(브라우저가 cross-origin worker를 차단) npm 설치나 벤더링이 필요하다.

## 빠른 시작

```js
import { boot, PyProc } from "pyproc";

// 1) 단일 런타임: 파이썬 실행
const rt = await boot();
console.log(rt.run("sum(range(100))"));      // 4950
await rt.loadPackages(["numpy"]);
console.log(rt.run("import numpy as np; int(np.arange(10).sum())"));  // 45

// 2) 프로세스 OS: 진짜 병렬 (독립 GIL N개)
const os = new PyProc();
await os.boot(4);                             // 워커 4개를 스냅샷-fork로 spawn
const fn = "def _fn(n):\n    return sum(i*i for i in range(n))";
const out = await os.map(fn, [100000, 100000, 100000, 100000]);
console.log(out);                             // 4개가 4코어에서 동시 실행
os.terminate();
```

## 능력 (capabilities)

능력은 opt-in이다. 런타임에서 필요한 것만 켠다. 소비자는 능력 계약만 쓰고 엔진 내부(`HEAPU8` 등)를 직접 만지지 않는다.

### 복원 기반 리액티브

```js
const rt = await boot();
const reactive = rt.enableReactive();
const sp0 = reactive.stackSave();
rt.run("x = 1");
const cp = reactive.checkpoint();             // 상태 저장
rt.run("x = 999");
reactive.checkpoint();                        // 실행 경계는 checkpoint로 닫는다 (계약)
reactive.restoreLive(cp.index, sp0);          // 라이브-차분 복원(바뀐 페이지만 write)
console.log(rt.run("x"));                      // 1
```

**실행 경계 계약(기계 강제)**: `restoreLive`는 경계(마지막 `checkpoint()`/복원 이후 실행 없음)를 지키면 저장 해시 비교만으로 즉시 복원한다(재해싱 0, 실측 ~1ms). 경계 위반(실행·예외·전역 변이)은 상태 변이 카운터로 O(1) 자동 감지되어 재해시 경로로 승격되므로 **조용히 틀린 복원은 일어나지 않는다**(실측 ~27ms). 어느 경로였는지는 반환값 `rehashed`로 확인한다.

### 빌린 시스템콜 브리지

브라우저에는 socket / subprocess / blocking input이 없다. 이 능력이 그걸 각각 프록시 / 자식 워커 / JSPI로 빌려 파이썬 코드가 그대로 돌게 한다. 라이브러리는 계약(무엇을 배선하는지)을 노출하고, 실제 엔드포인트는 소비 제품이 채운다.

**v1 범위(정직)**: `input()`(동기 + JSPI `run_sync` 블로킹), `urllib.request.urlopen`(동기 XHR, GET/POST, 바이너리 보존), `subprocess.run(["python","-c",code])`(자식 워커 독립 인터프리터, runAsync 경로). 전부 브라우저 게이트 실측으로 검증된다. requests 계열·저수준 socket은 [local-parity](mainPlan/local-parity/README.md) 진행분이다.

```js
const bridge = rt.enableSyscallBridge({
  input: (p) => window.prompt(p),               // input() 동기 소스
  inputAsync: async (p) => await myUi.ask(p),   // 터미널용: runAsync(JSPI)에서 진짜 블로킹
  proxyUrl: "/proxy",                           // 선택: HTTP를 소비 제품 프록시로 우회
});
await bridge.install();
rt.run('name = input("who? ")');                // 진짜 블로킹 input
rt.run('import urllib.request; body = urllib.request.urlopen(url).read()');  // 진짜 HTTP GET
await rt.runAsync('import subprocess; subprocess.run(["python","-c","print(42)"], capture_output=True).stdout');
```

### 커널 안 ASGI 서버, 그리고 진짜 URL

"로컬 서버"는 TCP 소켓이 아니라 ASGI 인터페이스다. `AsgiServer`는 FastAPI / Starlette 앱을 커널 안에서 소켓 0으로 dispatch한다(요청당 약 3.4ms). 엔드포인트는 `async def` 강제.

```js
rt.run("from fastapi import FastAPI\napp = FastAPI()\n@app.get('/ping')\nasync def ping(): return {'ok': True}");
const server = rt.enableAsgiServer();          // `app` 전역을 읽는다
await server.install();
await server.serve("GET", "/ping");            // { status: 200, headers, body: '{"ok":true}' }
```

동봉된 Service Worker 자산(`src/capabilities/pyprocSw.js`)을 쓰면 파이썬 서버가 **진짜 URL**로도 응답한다: `?asgi=/pyproc/`로 SW를 등록하고 `new VirtualOrigin(server).bind()`를 호출하면, 페이지(또는 iframe)의 `fetch("/pyproc/api/...")`가 FastAPI에 닿는다. 실측 왕복 3.4ms(직접 dispatch와 동일). 같은 자산의 `?cache=1`은 Pyodide CDN 자산 전부를 캐시-우선으로 서빙해서(`coreCacheDir`가 못 덮는 script 경로 포함) 2차 부팅의 CDN 요청이 0이 된다(비행기 모드 부팅).

### 서버리스 파이썬 터미널

탭이 진짜 파이썬 REPL이 된다. `Terminal`은 CPython 정식 `code.InteractiveConsole`을 커널 안에 세운다. syscall 브리지의 JSPI 경로와 조합하면 `input()`이 진짜로 블록된다.

```js
const term = rt.enableTerminal();
await term.install();
await term.push("x = 40");
await term.push("x + 2");                       // { more: false, out: "42\n" }
```

### 세션 부활과 이동 가능한 머신 이미지

결정적 리플레이 + 사용자 델타가 인터프리터를 불멸이자 이동 가능으로 만든다. 매니페스트(환경 선언)로 부팅해 작업한 뒤, 델타만 OPFS에 영속하거나 컴퓨터 전체를 `.pymachine` 파일 하나로 내보낸다.

```js
import { bootSession, openMachine } from "pyproc";

const s = await bootSession({ packages: ["numpy"], setup: "import numpy as np" });
s.rt.run("data = np.arange(1_000_000)");        // 작업
const file = await s.exportImage();             // 도는 컴퓨터를 Blob 하나로(.pymachine)

// 나중에, 새 탭에서: base를 리플레이하고 델타를 적용해 재개
const revived = await openMachine(file, { trust: true });
revived.rt.run("int(data.sum())");              // 상태가 되살아난다
```

머신 파일은 살아있는 상태라 실행 파일과 동급 위험이다: `openMachine`은 SHA-256 무결성 해시를 검증하고, 명시적 `{ trust: true }` 없이는 열지 않는다.

### wheel 캐시 (오프라인, 재다운로드 0 패키지)

`WheelCache`는 설치된 `.whl` 바이트를 OPFS에 저장하고 다음 설치부터 캐시에서 서빙한다. 패키지 로드가 오프라인으로 돌고 재다운로드가 0이 된다. 전역 `fetch`를 상시 오염시키지 않고 `install` / `loadPackages` 구간만 감싼다.

### uv 레인: 즉시 부팅되는 환경, 재현 가능한 락, 자급하는 스크립트

`bootEnv`는 환경의 2차 부팅을 설치가 아니라 복원으로 바꾼다: bare 힙 스냅샷(부팅 ~3.6초 -> ~227ms) + OPFS 휠. 실측: numpy 환경 콜드 5109ms -> 웜 **1229ms**(4.2배). `Runtime.freeze()`는 환경 전체를 pyodide-lock JSON으로 고정하고, `boot({ lockFileURL })`에 되먹이면 해석 0으로 같은 환경이 재현된다. `runScript`는 PEP 723(`# /// script`의 인라인 `dependencies`) 스크립트를 자동 설치 + 실행한다. 브라우저판 `uv run`.

```js
import { bootEnv, runScript } from "pyproc";

const dirs = { snapshots: snapDir, wheels: wheelDir };            // 소비자가 소유한 OPFS 핸들
const rt = await bootEnv({ packages: ["numpy"], setup: "import numpy" }, dirs);
rt.envBoot;                                                       // { lane: "snapshot", totalMs: 1229, ... }
await runScript(rt, "# /// script\n# dependencies = [\"six\"]\n# ///\nimport six\nsix.__version__");
```

### 탭보다 오래 사는 커널

`SharedKernel`은 인터프리터를 SharedWorker에 올린다: 연결한 모든 탭이 같은 파이썬 상태를 보고, 연결이 하나라도 남아 있으면 커널은 계속 돈다. 원격 커널이라 모든 호출이 Promise다. 플랫폼 한계(정직 기록): SharedWorker는 현재 crossOriginIsolated가 안 되므로 SAB 기능(interrupt, 스냅샷-fork)은 탭별 `PyProc` 몫이다.

## 공개 표면

| export | 무엇 |
| --- | --- |
| `boot(opts)` | Pyodide 런타임 부팅, `Runtime` 반환 (`lockFileURL` 락 재현, `coreCacheDir` 코어 오프라인) |
| `bootEnv(manifest, dirs)` | uv 레인: bare 스냅샷 + 휠 캐시 웜 부팅(2차 1229ms vs 콜드 5109ms) |
| `runScript(rt, src, opts)` | 브라우저판 `uv run`: PEP 723 인라인 의존성 자동 설치 + 실행 |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` / `freeze` / `mountHome` + 능력 등록 |
| `MemoryCapability` | WASM 힙 접근을 캡슐화한 능력 계약 |
| `ReactiveController` | 복원 기반 리액티브(체크포인트 / 시간여행) |
| `SyscallBridge` | socket/subprocess/input 능력 계약 |
| `AsgiServer` | 커널 안 ASGI 서버(FastAPI를 소켓 0으로, dispatch 3.4ms) |
| `VirtualOrigin` | 파이썬 서버를 진짜 URL로(`pyprocSw.js` SW 자산과 짝) |
| `Terminal` | 서버리스 파이썬 터미널(REPL, 블로킹 input, `%pip`/`%undo`) |
| `DeviceFs` | 모든 것은 파일: 브라우저 능력을 파이썬 `open()`으로(`/dev/clipboard`, `/proc`) |
| `Init` | OS의 init: `/home/web/boot.py` 오토스타트 + `cron.py` 주기 틱(전부 파일 주도) |
| `MachineJournal` | WAL: 머신이 유휴마다 스스로 체크포인트해서 **탭이 크래시해도 마지막 커밋으로 부팅**된다(hibernate 훅 불필요) |
| `bootSession` / `Session` / `openMachine` | 세션 부활(불멸 커널)과 이동 가능한 `.pymachine` 머신 이미지: 결정적 리플레이 + 사용자 델타를 OPFS에 영속(`save`/`load`)하거나 파일 하나로 내보냄(`exportImage`/`openMachine`) |
| `WheelCache` | 오프라인·재다운로드 0 패키지 설치를 위한 wheel / OPFS 캐시 |
| `PyProc` | 프로세스 OS 커널: 스냅샷-fork spawn, `map` / `mapArray` 병렬, 수명주기(`kill` / `signal` / respawn), 그리고 **`fork(2)`**: 살아있는 프로세스 복제(변수·배열이 자식으로 실린다, 적용 1.4ms) |
| `SIGNAL` | `PyProc.signal(pid, signum)`용 POSIX 시그널 번호: 진짜 `SIGTERM`/`SIGUSR1` 핸들러가 파이썬 안에서 발화한다 |
| `SharedKernel` | 탭보다 오래 사는 공유 커널(SharedWorker): 여러 탭 = 한 파이썬 상태 |
| `bootWasi` / `WasiSession` | Pyodide 아닌 CPython(WASI) 세션, 프리미티브가 엔진 무관임의 실증: async `run` / `get` / `set` + 완전 시간여행(`checkpoint` / `timeTravel`, 복원 후 재개·분기). `installWheel(bytes)`는 순수 파이썬 wheel을 라이브 세션에 설치(브라우저판 pip: 네이티브 unzip -> `/site` -> `import`), C 확장은 불가(WASI 동적 링크 부재). 값 다리는 JSON 한정(WASI엔 FFI 없음), `wasmURL`·wheel은 소비자 제공 |
| `PAGE_SIZE` | WASM 페이지 크기 상수(65536) |

하위 경로 import도 지원한다.

```js
import { boot } from "pyproc/runtime";
import { ReactiveController } from "pyproc/reactive";
import { PyProc } from "pyproc/process-os";
```

## 검증된 실측

- **스냅샷-fork**: 자식 부팅 184ms(콜드 2839ms 대비), 15.4배 빠른 spawn, 독립 프로세스.
- **진짜 N코어 병렬**: 독립 인터프리터 워커로 embarrassingly-parallel 작업 실측 speedup.
- **복원 리액티브**: 완전 해시로 힙 성장 자동 처리, 라이브-차분 복원 약 2.4ms(memcpy 대비 12배), 리액티브 편집 약 9.1배 빠름, 크래시 0.
- **속도 실태**: 순수 파이썬 로직은 로컬과 대등하거나 더 빠름(CPython 3.14 > 3.12). numpy 대규모 산술만 약 86배 느림(WASM 단일스레드·no-AVX BLAS). 서버 / 자동화 / 로직 워크로드는 런타임급.

## 프론티어 (정직하게)

진짜 공유메모리 스레드(nogil)와 numpy 프로세스간 제로카피는 여전히 하나의 미해결 문제에 걸려 있다: **WASM dlopen** + 크로스 인스턴스/스레드 메모리 공유(Pyodide 스레딩 이슈 #237, 2018년부터). pyproc은 각 워커에 자기 wasmTable / 힙 / 글루를 주어 이 문제를 회피한다. 한편 warm-fork(패키지 로드 후 복제)는 이 벽에 걸려 있었으나 **결정적 리플레이 + 사용자 델타로 실용 우회를 달성했다**(`Session`, 실측: 리플레이 부팅이 바이트 동일 힙 재현, 델타 1.5ms 적용). Pyodide 스냅샷의 hiwire 제약(패키지 로드 후 이미지화 불가, upstream #5195)은 그대로이며, 그 벽을 넘은 것이 아니라 돌아간 것이다.

## 아키텍처

```text
Layer 2  process-os   PyProc 커널: 스냅샷-fork spawn, map/mapArray 병렬, 수명주기; 워커 = 프로세스
Layer 1  reactive     복원 리액티브 (체크포인트 / 시간여행)
         syscall      socket / subprocess / input 브리지
         asgi         커널 안 ASGI dispatch
         terminal     서버리스 파이썬 REPL
         session      세션 부활 + .pymachine 머신 이미지
         wheelcache   wheel / OPFS 패키지 캐시
Layer 0  runtime      Pyodide 래퍼(boot/Runtime) + MemoryCapability 계약
         index.js     공개 표면 / index.d.ts 타입 계약
```

## 제품이 소비하는 법

pyproc은 "참조"가 아니라 **실제 import**로만 SSOT가 된다. 소비자는 커밋 SHA를 핀하고, 공개 계약 + 함께 실린 `index.d.ts` 타입에만 의존하며, 역방향으로 import하지 않는다. 전체 정책: [docs/consuming/contract.md](docs/consuming/contract.md).

## 개발

```bash
npm test              # Node 구조/린트 게이트 (의존성 0)
npm run test:browser  # headless Chromium 런타임 게이트: 부팅/리액티브 계약/fork/map 실동작 (의존성 0)
npm run serve         # 수동 실측용 COOP/COEP 정적 서버 (의존성 0)
```

WASM 런타임 특성상 진짜 검증은 브라우저에서만 가능해서, `test:browser`가 로컬 Edge/Chrome을 headless로 띄워 공개 표면의 실동작을 자동 검증한다(CI에서도 동일 게이트). 수동 확인·벤치는 `npm run serve`로 `examples/`를 띄운다. 절차: [docs/operations/testing.md](docs/operations/testing.md).

운영 문서(운영 모델·테스트·릴리즈·소비 계약)는 [docs/](docs/README.md), 설계·로드맵·결정 기록은 [mainPlan/](mainPlan/README.md), 기여 규칙은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)에 있다.

## 라이선스

[Mozilla Public License 2.0](LICENSE). 밑에 깔린 엔진 Pyodide와 같은 라이선스다. Copyright 2026 eddmpython.

MPL-2.0은 파일 단위 카피레프트라서 실질 조건은 이렇다.

- **임베드는 자유다.** 비공개 앱에 pyproc을 import해서 브라우저로 배포하고 판매해도 된다. 내 코드는 내 것으로 남는다.
- **pyproc 자체의 포크는 열려 있다.** 이 라이선스가 덮는 파일을 고치면 그 파일의 소스를 MPL-2.0으로 공개한다. 런타임 개선분은 돌아오고, 포크가 어둠 속으로 가지 못한다.
- **특허는 허여된다.** 각 기여자가 자기 기여분에 대해 특허 라이선스를 준다(2.1(b)절). 통상의 방어적 종료 조항 포함.

기여는 별도 CLA 없이 같은 라이선스로 수락된다. MPL-2.0에서는 기여하는 행위 자체가 그 기여분에 대한 라이선스 허여이므로(2.1절) inbound = outbound가 구조적으로 성립한다. [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md) 참조.
