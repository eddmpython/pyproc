# pyproc

**서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬.**
프로세스, 병렬 실행, 복원 기반 리액티브까지. codaro / dartlab / xlpod 공통 런타임의 SSOT.

브라우저 파이썬을 "노트북 한 셀"이 아니라 **운영체제처럼** 다룬다. Web Worker가 프로세스가 되고, 힙 스냅샷이 프로세스 이미지가 되고, 워커에 주입하는 것이 fork가 된다. 독립 인터프리터 N개 = 독립 GIL N개 = N코어 물리 병렬.

## 지원 환경

**Chromium / Edge 전용.** JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox / Safari 미지원은 결함이 아니라 스코프다. SharedArrayBuffer를 쓰려면 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 설치

```bash
npm install pyproc
```

빌드 단계가 없다(네이티브 ESM). 번들러 없이 `<script type="module">`에서 바로 import 해도 된다.

## 빠른 시작

```js
import { boot, PyProc } from "pyproc";

// 1) 단일 런타임: 파이썬 실행
const rt = await boot();
console.log(rt.run("sum(range(100))"));      // 4950
await rt.loadPackages(["numpy"]);
console.log(rt.run("import numpy as np; int(np.arange(10).sum())"));  // 45

// 2) 프로세스 OS: 진짜 병렬 (독립 GIL N개)
const os = await new PyProc();
await os.boot(4);                             // 워커 4개를 스냅샷-fork로 spawn
const fn = "def _fn(n):\n    return sum(i*i for i in range(n))";
const out = await os.map(fn, [100000, 100000, 100000, 100000]);
console.log(out);                             // 4개가 4코어에서 동시 실행
os.terminate();
```

## 능력 (capabilities)

능력은 opt-in이다. 런타임에서 필요한 것만 켠다. 소비자는 능력 계약만 쓰고 엔진 내부(`HEAPU8` 등)를 직접 만지지 않는다.

### 복원 기반 리액티브

실행 경계마다 힙을 완전 해시로 체크포인트해서 시간여행/재실행을 만든다. WASM은 mprotect/dirty-page가 없어 실행 경계 해시로 델타를 재구성한다. 완전 해시(Uint32 워드 단위)가 soundness의 열쇠다. 샘플링은 불완전 델타를 만들어 복원을 깨뜨린다.

```js
const rt = await boot();
const reactive = rt.enableReactive();
const sp0 = reactive.stackSave();
rt.run("x = 1");
const cp = reactive.checkpoint();             // 상태 저장
rt.run("x = 999")
reactive.restoreLive(cp.index, sp0);          // 라이브-차분 복원(바뀐 페이지만 write)
console.log(rt.run("x"));                      // 1
```

### 빌린 시스템콜 브리지

브라우저에는 socket / subprocess / blocking input이 없다. 이 능력이 그 부재를 각각 프록시 / 자식 워커 / JSPI로 빌려 파이썬 코드가 그대로 돌게 한다. 라이브러리는 계약(무엇을 배선하는지)을 노출하고, 실제 엔드포인트는 소비 제품이 채운다.

```js
const bridge = rt.enableSyscallBridge({ proxyUrl: "/proxy" });
await bridge.install();
```

## 공개 표면

| export | 무엇 |
| --- | --- |
| `boot(opts)` | Pyodide 런타임 부팅 -> `Runtime` |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` + 능력 등록 |
| `MemoryCapability` | WASM 힙 접근을 캡슐화한 능력 계약 |
| `ReactiveController` | 복원 기반 리액티브(체크포인트/시간여행) |
| `SyscallBridge` | socket/subprocess/input 능력 계약 |
| `PyProc` | 프로세스 OS 커널(스냅샷-fork spawn + `map` 병렬) |

세부 하위 경로 import도 지원한다.

```js
import { boot } from "pyproc/runtime";
import { ReactiveController } from "pyproc/reactive";
import { PyProc } from "pyproc/process-os";
```

## 검증된 실측

- **bare 스냅샷 fork**: 자식 부팅 184ms (콜드 2839ms 대비 15.4배), 독립 프로세스.
- **진짜 N코어 병렬**: 독립 인터프리터 워커로 embarrassingly-parallel 작업 실측 speedup.
- **복원 리액티브**: 완전 해시로 성장 자동 처리, 라이브-차분 복원 2.4ms(memcpy 대비 12배).
- **프론티어(오늘 막힘)**: warm-fork / 진짜 스레드 / numpy 제로카피는 전부 하나의 미해결 문제(WASM dlopen)에 걸려 있다. pyproc은 이를 회피(각 워커가 자기 wasmTable/힙/글루 소유)하므로 오늘 가능한 최상단이다.

## 개발

```bash
npm test          # Node 구조/린트 게이트 (의존성 0)
```

브라우저 실측은 `examples/`의 HTML을 crossOriginIsolated 서버로 띄워 확인한다.

기여 규칙: main 전용, 빌드 없는 ESM, camelCase, 능력 계약 경유(엔진 내부 직접 접근 금지), 버전 `0.0.x` 라인.

## 라이선스

미정(사용자 결정 대기). 현재는 저장소 소유자 전용.
