# pyproc

**서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬.** 프로세스, 병렬 실행, 복원 기반 리액티브를 하나의 재사용 런타임으로 묶었다. codaro / dartlab / xlpod가 공유하는 웹 파이썬 런타임의 SSOT.

언어: [English](README.md) | 한국어

---

## 이게 뭔가?

pyproc은 브라우저 파이썬을 "노트북 한 셀"이 아니라 **운영체제처럼** 다룬다.

- Web Worker가 **프로세스**가 된다.
- 힙 스냅샷이 **프로세스 이미지**가 된다.
- 그 스냅샷을 워커에 주입하면 **fork**가 된다.
- 독립 인터프리터 N개 = 독립 GIL N개 = **N코어 물리 병렬**.

내부는 [Pyodide](https://pyodide.org)(WebAssembly로 컴파일된 CPython)를 돌리지만, Pyodide가 기본으로 주지 않는 런타임의 물성을 얹는다: 프로세스를 싸게 생성하고, 병렬로 돌리고, 코드를 재실행하지 않고 인터프리터 상태를 복원한다. 빌드 단계 없는 순수 ESM 라이브러리이고, 진짜 제품이 import해서 쓰라고 만들었다.

## 왜 만들었나?

브라우저에서 파이썬을 돌리는 조각은 이미 있다. 없던 것은 그 조각을 진짜 런타임으로 엮는 **공유 계층**이다. codaro·dartlab·xlpod가 전부 같은 걸 필요로 하는데, 각자 복붙하면 런타임이 3벌로 갈라져 따로 논다. pyproc은 그 계층을 한 번 만들어 버전 고정으로 공유해서, 개선이 한 곳에 모이게 한다. 전체 방향과 정책은 [mainPlan/web-python-runtime/](mainPlan/web-python-runtime/README.md).

## 핵심 개념, 쉽게

**1. 스냅샷-fork (빠른 프로세스 생성).** Pyodide 인터프리터를 새로 부팅하면 약 2.8초 걸린다. pyproc은 부모 하나를 부팅해 메모리 스냅샷("프로세스 이미지")을 뜨고, 워커를 그 스냅샷에서 약 184ms에 시작한다. 15.4배 빠른 spawn이고, 각 자식은 독립 프로세스다.

**2. 프로세스 OS (진짜 병렬).** 각 워커가 자기 GIL을 가진 독립 인터프리터라, 같은 함수를 워커들에 돌리면 한 스레드 위의 동시성이 아니라 진짜 멀티코어 실행이 된다. `PyProc.map()`이 워커들이 태스크 큐를 동시에 소진하게 한다.

**3. 복원 기반 리액티브 (재실행 없는 시간여행).** 리액티브 노트북은 보통 상류가 바뀌면 셀을 재실행한다. WebAssembly에는 OS의 dirty-page 추적이 없어서, pyproc은 실행 경계마다 힙을 완전 해시해 바뀐 페이지만 저장하는 방식으로 그걸 재구성한다. 이전 상태로 복원할 땐 재실행 대신 다른 페이지만 되써서(약 2.4ms) 되돌린다. 완전 해시가 soundness의 열쇠다. 샘플링하면 변경을 놓쳐 복원이 깨진다.

## 지원 환경

**Chromium / Edge 전용.** JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox / Safari 미지원은 결함이 아니라 의도된 스코프다.

SharedArrayBuffer를 쓰려면 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 설치

```bash
npm install pyproc
```

빌드 단계가 없다(네이티브 ESM). 번들러 없이 `<script type="module">`에서 바로 import 해도 된다.

제품은 기본 브랜치를 따라가지 말고 커밋 SHA로 핀한다.

```jsonc
// package.json
"dependencies": {
  "pyproc": "github:eddmpython/pyproc#<commit-sha>"
}
```

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

**실행 경계 계약**: `restoreLive`는 저장된 해시끼리만 비교한다(재해싱 0 = 즉시성의 근거). 그래서 파이썬을 실행했다면 복원 전에 반드시 `checkpoint()`로 경계를 닫아야 한다. 경계를 보장할 수 없으면 `restore()`(전체 복원, 안전 기준선)를 쓴다.

### 빌린 시스템콜 브리지

브라우저에는 socket / subprocess / blocking input이 없다. 이 능력이 그걸 각각 프록시 / 자식 워커 / JSPI로 빌려 파이썬 코드가 그대로 돌게 한다. 라이브러리는 계약(무엇을 배선하는지)을 노출하고, 실제 엔드포인트는 소비 제품이 채운다.

**현재 상태(정직)**: 계약 단계 스텁이다. `install()`은 배선 선언을 반환할 뿐 아직 실제 몽키패치를 하지 않는다. 실배선은 [로드맵](mainPlan/web-python-runtime/02-phasing-and-wiring.md)의 attempts 졸업 대상이다.

```js
const bridge = rt.enableSyscallBridge({ proxyUrl: "/proxy" });
await bridge.install();
```

## 공개 표면

| export | 무엇 |
| --- | --- |
| `boot(opts)` | Pyodide 런타임 부팅, `Runtime` 반환 |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` + 능력 등록 |
| `MemoryCapability` | WASM 힙 접근을 캡슐화한 능력 계약 |
| `ReactiveController` | 복원 기반 리액티브(체크포인트 / 시간여행) |
| `SyscallBridge` | socket/subprocess/input 능력 계약 |
| `PyProc` | 프로세스 OS 커널(스냅샷-fork spawn + `map` 병렬) |
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

warm-fork(패키지 로드 후 복제), 진짜 공유메모리 스레드(nogil), numpy 프로세스간 제로카피는 전부 하나의 미해결 문제에 걸려 있다: **WASM dlopen** + 크로스 인스턴스/스레드 메모리 공유. Pyodide 스레딩 이슈 #237은 2018년부터 열려 있다. pyproc은 각 워커에 자기 wasmTable / 힙 / 글루를 주어 이 문제를 회피하고, 그래서 오늘 가능한 최상단이다. 프론티어는 발판이 아니라 벽이다.

## 아키텍처

```text
Layer 2  process-os   PyProc 커널(스냅샷-fork spawn + map 병렬), 워커 = 프로세스
Layer 1  reactive     복원 리액티브 (능력)
         syscall      socket/subprocess/input 브리지 (능력 계약)
Layer 0  runtime      Pyodide 래퍼(boot/Runtime) + MemoryCapability 계약
         index.js     공개 표면 / index.d.ts 타입 계약
```

## 제품이 소비하는 법

pyproc은 "참조"가 아니라 **실제 import**로만 SSOT가 된다. 소비자는 커밋 SHA를 핀하고, 공개 계약 + 함께 실린 `index.d.ts` 타입에만 의존하며, 역방향으로 import하지 않는다. 전체 정책: [docs/consuming/contract.md](docs/consuming/contract.md).

## 개발

```bash
npm test          # Node 구조/린트 게이트 (의존성 0)
npm run serve     # 브라우저 실측용 COOP/COEP 정적 서버 (의존성 0)
```

브라우저 실측은 `npm run serve`로 `examples/`의 HTML(`basic.html`, `processOs.html`)을 crossOriginIsolated 상태로 띄워 확인한다. WASM 런타임 특성상 진짜 검증은 브라우저에서만 가능하다. 절차: [docs/operations/testing.md](docs/operations/testing.md).

운영 문서(운영 모델·테스트·릴리즈·소비 계약)는 [docs/](docs/README.md), 설계·로드맵·결정 기록은 [mainPlan/](mainPlan/README.md), 기여 규칙은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)에 있다.

## 라이선스

미정(소유자 결정 대기). 현재는 저장소 소유자 전용. 라이선스 확정 전 기여 조건은 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md) 참조.
