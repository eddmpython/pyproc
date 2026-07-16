<p align="center">
  <img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="132" alt="pyproc">
</p>

<h1 align="center">pyproc</h1>

<p align="center"><b>브라우저 탭에서 도는 진짜 파이썬. 서버 없이.</b></p>

<p align="center">
  AI 에이전트를 위한 상태 보존형 브라우저 Python 런타임: 실행 상태를 살려두고,<br>
  여러 탭에서 공유하고, 리더 탭 종료를 견디며, 분기하고 복원한다. 실행마다 새 컨테이너를 띄우지 않는다.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pyproc"><img src="https://img.shields.io/npm/v/pyproc?label=npm&color=5b8cff&labelColor=0a0f1c" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-7c4dff?labelColor=0a0f1c" alt="license MPL-2.0"></a>
  <img src="https://img.shields.io/badge/dependencies-0-00d4c8?labelColor=0a0f1c" alt="zero dependencies">
  <img src="https://img.shields.io/badge/CPython-3.14%20on%20WebAssembly-5b8cff?labelColor=0a0f1c" alt="CPython 3.14 on WebAssembly">
</p>

<p align="center">
  <a href="https://eddmpython.github.io/pyproc/"><b>라이브 데모</b></a> ·
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#ai-에이전트에서-쓰기">AI 에이전트에서 쓰기</a> ·
  <a href="#기능-상태">상태</a> ·
  <a href="README.md">English</a>
</p>

---

## 무엇을 해결하나

AI 에이전트는 Python을 한 번만 실행하지 않는다. 코드를 생성하고, 실행하고, 실패 원인을 보고, 고친 뒤 다시 실행한다. 여러 접근을 동시에 시험하거나, 마지막에 어질러지기 전의 정상 상태로 되돌아가야 할 때도 있다.

보통의 답은 매 시도마다 서버 컨테이너나 새 Python 환경이다 - 느리게 뜨고, 유지 비용이 들고, 시도 사이에 버려진다. pyproc은 준비된 Python 상태를 **사용자 브라우저에** 살려두고, 그것을 **체크포인트·분기·복원**할 수 있게 한다. 그래서 재시도 루프가 콜드 부팅이 아니라 밀리초로 끝나고, 사용자 데이터는 탭 밖으로 나갈 필요가 없다. 제품 입장에선, 서버에서 돌릴 세션당 샌드박스가 사용자 브라우저로 이동한다: 프로비저닝도 비용도 없는 샌드박스 실행이, 이미 웹 전체에 단련된 경계(Chrome + WASM) 위에서.

## 한 예제로

```js
import { boot } from "pyproc";

const rt = await boot();
rt.run("values = [10, 20, 30]");
console.log(rt.run("sum(values)"));   // 60
```

진짜 CPython([Pyodide](https://pyodide.org) / WebAssembly)이 탭 안에서 돌며 진짜 값을 돌려준다.

## 브라우저 Python 샌드박스가 쓸모 있는 곳

| 사용처 | 사용 방식 | pyproc의 이점 |
|---|---|---|
| AI 데이터 분석 | AI가 생성한 pandas / NumPy 코드를 사용자 파일에 실행 | 원본 파일을 서버로 보내지 않고 분석 |
| AI 코딩 도구 | AI 코드 실행 전 체크포인트, 실패하면 복원 | 값싼 시행착오, 환경 초기화 없음 |
| 멀티 에이전트 분석 | 하나의 준비된 상태에서 여러 실행 분기 | 서로 다른 접근을 독립적으로 비교 |
| 브라우저 노트북 | 패키지와 데이터를 로드한 상태 유지 | 재부팅·재설치 없음 |
| 코딩 교육 | 학생 상태를 저장하고 AI 수정안을 별도 분기에서 시험 | 학생 작업을 훼손하지 않고 피드백 |
| 사내 분석 도구 | 민감한 CSV / Excel을 로컬 탭에서 처리 | 데이터 외부 전송 최소화 |
| 오프라인 도구 | 런타임과 패키지를 캐시 | 네트워크가 제한된 환경에서도 실행 |

관통하는 것 하나: **AI 에이전트는 한 번 준비한 뒤 저장·분기·복원할 수 있는 Python 환경이 필요하다** - 그리고 브라우저 샌드박스가 그 과정에서 사용자 데이터를 로컬에 둔다.

## 얻는 것 (내부 원리가 아니라 결과로)

- **사용자 브라우저에서 실행 - 운영하거나 비용 낼 서버 샌드박스가 없다.** Python이 탭 안, Chrome 렌더러 샌드박스 + WASM 격리(웹 전체에 단련된 경계) 안에서 돈다. 샌드박스 코드 실행을 인프라 밖으로 옮기고 사용자 데이터는 로컬에 둔다. (자원·네트워크 한도는 직접 설정한다. 브라우저는 탈출을 막지 자원 고갈을 막지 않는다 - [보안 모델](#보안-모델) 참조. 코드로부터 사용자를 지키지, 사용자로부터 회사 비밀을 지키는 건 아니다.)
- **다시 만들지 않고 복원.** 패키지와 데이터를 이미 로드한 상태를 체크포인트로 저장하고 그 지점으로 되돌린다 - 재실행도, 재설치도 없이.
- **탭을 닫아도 머신은 유지.** 여러 탭이 하나의 논리적 Python 상태를 공유한다. 리더가 닫히면 다른 탭이 OPFS의 마지막 commit에서 메모리와 `/home/web` 파일을 복구해 로컬에서 계속한다.
- **한 상태에서 분기.** 에이전트가 같은 준비 상태에서 여러 코드 후보를 독립적으로 실행하고 결과를 비교한다.
- **데이터는 로컬에.** CSV / Excel / 기업 데이터를 탭에서 처리하고 요약된 결과만 내보낸다.
- **격리된 실행.** Python이 메인 UI 스레드와 분리돼, 관리하는 여러 워커에서 돈다.

## 빠른 시작

```sh
npm install pyproc
```

```js
import { boot } from "pyproc";

const rt = await boot();
await rt.loadPackages(["numpy"]);
console.log(rt.run("import numpy as np; int(np.arange(1_000_000).sum())"));  // 499999500000
```

같은 origin의 여러 탭에서 하나의 지속 머신을 연다:

```js
import { openPersistentMachine } from "pyproc";

const machine = await openPersistentMachine({ name: "workspace" });
await machine.run("counter = globals().get('counter', 40) + 1");
await machine.commit();
console.log(await machine.run("counter")); // 리더 승계 뒤에도 41
```

[Immortal Python Machine 데모](examples/immortal.html)에서 상태 공유, leader identity, 영속 epoch, 강제 승계, 서버 없는 로컬 복구를 직접 시험할 수 있다.

체크포인트와 복원. 리액티브는 `enableReactive`로 opt-in이고, 닫는 `checkpoint()`가 복원을 건전하게 만드는 실행 경계를 표시한다:

```js
const reactive = rt.enableReactive();
const sp = reactive.stackSave();
rt.run("values = [10, 20, 30]");
const cp = reactive.checkpoint();            // 이 상태 저장
rt.run("values.append(999)");
reactive.checkpoint();                        // 실행 경계 닫기(계약)
reactive.restoreLive(cp.index, sp);           // 체크포인트로 복귀 - 바뀐 페이지만 되쓴다
console.log(rt.run("len(values)"));           // 3
```

> 위 기본은 Chromium 브라우저만 있으면 된다. `PyProc`(프로세스 OS)와 소켓은 `crossOriginIsolated`(`COOP: same-origin`, `COEP: require-corp`)와 same-origin 워커도 필요하다 - [셋업](#셋업) 참조. `checkEnvironment()`로 확인하라.

## Web Computer 실행

Web Computer 제품은 한 브라우저 workspace에서 Python OS와 Linux를 부팅한다. 두 guest의 실제 memory와 block-backed file을 하나의 IndexedDB generation으로 저장하고, 브라우저 프로세스를 닫았다 열어도 복구하며, 서명된 `.webmachine` 파일 하나로 함께 옮긴다.

```sh
npm run assets:web-computer
npm run serve
```

Edge 또는 Chromium에서 `http://localhost:8788/apps/webComputer/`를 연다. Python 실행, Linux VGA 화면과 terminal, pause/resume/shutdown, 명령 뒤 자동 영속 저장, 수동 Save, 서명 Export, signer를 명시적으로 승인하는 Import 화면을 제공한다.

현재 Linux 실행 catalog는 hash가 고정된 development channel이다. engine과 image binary는 로컬에 준비되고 git과 npm package에서 제외된다. 전체 source와 license inventory를 재현하기 전에는 공개 재배포하지 않는다.

## AI 에이전트에서 쓰기

**패턴 1 - 실패하면 복원.** 환경을 준비하고, 체크포인트하고, AI가 생성한 코드를 실행한다. 예외가 나거나 인터프리터를 오염시키면 경계로 복원하고 수정본을 실행한다. 되돌아갈 수 없는 상태를 AI가 망칠 수 없다.

```text
환경 준비  ->  체크포인트  ->  AI 코드 실행  ->  (실패)  ->  복원  ->  수정 코드 실행
```

**패턴 2 - 후보 분기.** 공통 데이터와 패키지를 한 번 로드하고, 같은 준비 상태에서 여러 접근을 각각 격리해 실행한다 - `PyProc` 워커로, 또는 한 체크포인트에서 반복 복원으로.

```text
데이터 + 패키지 로드
        |-- pandas 접근
        |-- SQL 접근
        \-- NumPy 접근
```

**패턴 3 - 로컬 우선 데이터.** 사용자 파일은 탭에서 분석되고, 요약만 나간다. 원본 데이터는 모델 서버에 닿지 않는다.

```text
사용자 파일  ->  브라우저 Python  ->  요약만  ->  AI 모델
```

## 기능 상태

브라우저 게이트 커버리지 기준의 정직한 성숙도. 아래는 전부 런타임 게이트가 있고, 라벨은 오늘 얼마나 걸 수 있는지다.

| 영역 | 상태 |
|---|---|
| Python 실행 (`boot` / `run` / `loadPackages`) | Stable |
| 프로세스 OS: 스냅샷-fork 스폰, `map` 병렬 (`PyProc`) | Beta |
| 복원 기반 리액티비티 (`enableReactive`: 체크포인트 / 시간여행) | Beta |
| 커널 내 ASGI (`AsgiServer` - dartlab 프로덕션 사용 중) | Beta |
| uv 레인 (`bootEnv` / `freeze` / `runScript`), wheel 캐시, 터미널, syscall 브리지 | Beta |
| 세션 부활 + `.pymachine` 이미지, 머신 저널(WAL) | Experimental |
| 라이브 프로세스 fork, 장치 FS, init / cron / resume hook, 가상 오리진 URL | Experimental |
| 여러 탭 지속 머신(`openPersistentMachine` / `KernelElection`), 공유 커널 | Experimental |
| non-Pyodide CPython 3.14 (`bootWasi` / `WasiSession`) | Research preview |

## 보장하는 것과 아직 아닌 것

**보장(브라우저 실측):**

- 지원 브라우저에서 Pyodide 기반 Python 실행.
- 명시된 실행 경계에서 WASM 힙 상태 저장.
- 호환되는 런타임 조건에서 상태 복원.
- 워커 기반 실행 격리.

**아직 보장하지 않음:**

- 임의 시점의 완전한 프로세스 복제 - 진행 중인 네트워크 요청과 Promise는 복원되지 않는다.
- 중단된 명령의 조용한 재실행. leader가 RPC 전송 뒤 사라지면 `PYPROC_RPC_OUTCOME_UNKNOWN`을 반환하고 명령을 자동으로 다시 실행하지 않는다.
- 모든 Python 패키지 - 네이티브 C 확장 wheel은 정적 빌드가 필요하다(순수 파이썬 + Pyodide 빌드 패키지는 된다).
- Pyodide 버전 간 snapshot 호환. `.pymachine` 이동성은 같은 엔진/매니페스트와 명시적 신뢰 또는 검증된 서명자를 전제로 한다.
- GPU / 네이티브 Linux 패키지, 완전한 POSIX `fork`, 임의 네이티브 바이너리.

이 제한을 미리 밝히는 건 의도적이다: 숨긴 한계는 나중에 버그로 읽히고, 밝힌 한계는 관리된 경계로 읽힌다.

## 정직한 스코프: 목표는 무한대로, 주장은 증명된 만큼

**상위 North Star: 브라우저를 여러 guest OS가 부팅되는 컴퓨터로 만든다. pyproc은 그 위에 올라가는 첫 Python guest OS다.** 독립 private Web Machine package와 로컬 Web Computer 제품은 이제 한 lifecycle로 pyproc과 Linux를 부팅하고, 두 memory와 disk를 함께 저장하며, browser process 재시작 뒤 복구하고, 새 browser profile에서 signed image를 가져온다. 이것은 공개 `pyproc` package가 범용 hypervisor가 됐다는 뜻도, development Linux image를 재배포할 수 있다는 뜻도 아니다.

그 큰 목표 안에서 pyproc의 호환성 방향은 계속 "로컬에서 되는 모든 파이썬을 언젠가 브라우저에서, 서버 없이"다. 로컬에서 되는 것은 네 상태로 갈리고, pyproc의 일은 이것들을 위 칸으로 밀어 올리는 것과 플랫폼이 벽을 다시 여는 순간 가장 먼저 흡수하는 구조가 되는 것이다:

- **현재 달성**(오늘 실측): 순수 파이썬 + Pyodide 패키지, 멀티코어 프로세스, 체크포인트 / 복원, 커널 내 ASGI, 터미널, 영속 FS, 이동 가능한 이미지, 아웃바운드 Python 소켓.
- **우회 가능**(브라우저 방식): TCP `listen()`은 ASGI 앱으로, `os.fork`는 워커 커널로, 아웃바운드 소켓은 얇은 릴레이로.
- **upstream 대기**(지금 막혔으나 다시 열림): 네이티브 C 확장 wheel(Emscripten 정적 빌드 / WebAssembly 컴포넌트 모델), GPU(WebGPU), 진짜 threading.
- **웹 보안상 영구 벽**: 임의 인바운드 연결과 임의 네이티브 바이너리는 외부 릴레이나 에이전트가 필요하다.

Python 축별 격차는 [local-parity](mainPlan/_done/local-parity/README.md)가 추적한다. 완료된 host 아키텍처와 Dual-Boot 기록은 [web-machine-platform](mainPlan/_done/web-machine-platform/README.md)에 있다.

## 보안 모델

pyproc은 브라우저의 WebAssembly 및 Web Worker 격리 경계 안에서 Python을 실행한다. 이것은 임의의 신뢰할 수 없는 코드에 대한 안전 보장이 아니다: 신뢰할 수 없는 코드를 실행하는 애플리케이션은 자신의 위협 모델에 맞는 네트워크, 저장소, 패키지, 메모리, 실행 시간 정책을 별도로 구성해야 한다. `.pymachine` 파일은 살아있는 상태라 실행 파일과 같은 위험을 진다 - `openMachine`은 SHA-256 봉투를 검증하고, 명시적 `{ trust: true }` 또는 `trustedPublicKeys`로 검증된 signature 없이는 열지 않는다.

## 어떻게 도나 (한 장)

pyproc은 브라우저 Python을 "노트북 한 셀"이 아니라 **OS 같은 프로세스 모델**로 다룬다: Web Worker = 프로세스, 힙 스냅샷 = 프로세스 이미지, 그 스냅샷 주입 = fork, 인터프리터 N개 = GIL N개 = N코어 병렬. [Pyodide](https://pyodide.org)(WebAssembly 위 CPython)를 돌리고, Pyodide만으로는 안 되는 것을 더한다: 값싼 프로세스 스폰, 진짜 병렬, 코드를 다시 안 돌리는 인터프리터 상태 복원.

```text
Application / AI agent
        |
     pyproc API
   +----+----------+
Runtime  Process OS  Capabilities
   |        |        (reactive / syscall / socket / asgi / terminal / session / ...)
Pyodide  Workers
        |
 Snapshot / Journal / Restore
```

네 프리미티브가 건전성을 만든다: 실행 경계마다 완전 힙 해시(샘플링은 변화를 놓쳐 복원을 오염시킨다), 결정적 부팅(바이트 동일 base라 델타만 이동하면 된다), 스냅샷-fork, 엔진 seam(같은 프리미티브가 non-Pyodide CPython 3.14에서도 돌아 Pyodide 내부에 안 묶임을 증명). 상세 설계는 [mainPlan](mainPlan/README.md), 축별 격차는 [local-parity](mainPlan/_done/local-parity/README.md).

## 벤치마크

속도 간판은 "모든 Python이 빠르다"가 아니라 계약별이다. pyproc은 제품이 상태를 한 번 준비하고, 분기하고, 복원하고, 독립 브라우저 프로세스로 일을 쪼갤 수 있을 때 빠르다. 단일 커널 NumPy는 여전히 일반 WebAssembly BLAS다.

아래 수치는 추적 artifact에서 온 것이고 **믿으라는 게 아니라 재현하라는** 것이다. 현재 비교 머신: Edge `150.0.4078.65`, Windows 11, AMD Ryzen 7 8845HS, 별도 표기 없으면 3 samples. 전체 측정 계약은 [benchmarking.md](docs/operations/benchmarking.md)에 있다.

| 축 | 증명하는 것 | pyproc 결과 | 외부 비교 |
|---|---|---|---|
| S0C cold Python ready | 새 브라우저 프로필에서 첫 Python 명령까지 | [median 3660ms](mainPlan/_done/browser-os-north-star/benchmarks/s0c-pyproc-2026-07-15.json) | marimo WASM 10136ms, JupyterLite 11796ms, WebVM 46534ms ([compare](mainPlan/_done/browser-os-north-star/benchmarks/s0c-compare-2026-07-15.md)) |
| S0 warm Python ready | 웜 브라우저 캐시/프로필에서 첫 Python 명령까지 | [median 3471ms](mainPlan/_done/browser-os-north-star/benchmarks/s0-pyproc-2026-07-15.json) | WebVM 3472ms, marimo WASM 8385ms, JupyterLite 12352ms ([compare](mainPlan/_done/browser-os-north-star/benchmarks/s0-compare-2026-07-15.md)) |
| S1 간판: sharded NumPy | 1024x1024 f64 matmul을 4 Python workers로 분할, 같은 run의 단일 worker와 비교 | [median speedup 3.95x](mainPlan/_done/browser-os-north-star/benchmarks/s1-pyproc-2026-07-15.json), shard p95 2606ms < single-worker median 10067ms | WebVM, JupyterLite, marimo WASM은 [같은 4-worker shard 계약에서 N/A](mainPlan/_done/browser-os-north-star/benchmarks/s1-compare-2026-07-15.md) |
| S1L single-kernel NumPy | 같은 1024x1024 f64 matmul을 한 Python kernel에서 측정, S1과 분리 | [median 10067ms](mainPlan/_done/browser-os-north-star/benchmarks/s1l-pyproc-2026-07-15.json) | marimo WASM 9355ms, JupyterLite 10149ms, WebVM 11406ms ([compare](mainPlan/_done/browser-os-north-star/benchmarks/s1l-compare-2026-07-15.md)) |
| S2 process map | 같은 Python 함수를 직렬 실행 vs `PyProc.map` process pool로 실행 | [serial median 73ms, process-pool median 43ms](mainPlan/_done/browser-os-north-star/benchmarks/s2-pyproc-2026-07-15.json), median speedup 1.61x | 외부 후보는 같은 `PyProc.map` API 계약에서 N/A ([compare](mainPlan/_done/browser-os-north-star/benchmarks/s2-compare-2026-07-15.md)) |
| S3 browser server | 설치 패키지 `VirtualOrigin` POST가 Python ASGI app까지 왕복 | [median 18ms, p95 18ms](mainPlan/_done/browser-os-north-star/benchmarks/s3-pyproc-2026-07-15.json) | 외부 후보는 같은 Service Worker URL-to-ASGI 계약에서 N/A ([compare](mainPlan/_done/browser-os-north-star/benchmarks/s3-compare-2026-07-15.md)) |
| S4 machine resume | signed `.pymachine` export/open + `resume.py` SQLite resource reopen | [export median 76ms, trusted-open median 2264ms](mainPlan/_done/browser-os-north-star/benchmarks/s4-pyproc-2026-07-15.json), image 10.8MB, resume rows 2-2 | 외부 후보는 같은 signed machine image + resume hook 계약에서 N/A ([compare](mainPlan/_done/browser-os-north-star/benchmarks/s4-compare-2026-07-15.md)) |
| S5 immortal machine | 설치 패키지 context들이 한 머신을 공유하고 leader 제거 뒤 memory + file을 복구하며 모든 context 종료 뒤 cold reopen | [failover median 2894ms, p95 3025ms](mainPlan/_done/browser-os-north-star/benchmarks/s5-pyproc-2026-07-15.json), recovery median 575ms, cold-reopen median 2681ms | 브라우저 Python 후보에는 같은 설치 패키지 leader fencing + journal recovery 계약이 없음 ([evidence](mainPlan/_done/browser-os-north-star/benchmarks/s5-compare-2026-07-15.md)) |

프리미티브 단위 실측도 맥락으로 남긴다:

- 스냅샷-fork 자식 부팅 ~184-300ms vs 콜드 ~2.8s.
- 복원 기반 리액티비티: 라이브-델타 복원 ~1-2.4ms(바뀐 페이지만 되쓰기, 재실행 없음).
- uv 레인 웜 환경 부팅 ~1229ms vs 콜드 ~5109ms(numpy).
- non-Pyodide CPython 3.14(WASI) 부팅 ~70-120ms.

현실 점검: 순수 파이썬 로직은 로컬 급 이상이고, 대형 단일 커널 NumPy 산술은 WASM 단일 스레드와 no-AVX BLAS의 제한을 받는다. pyproc의 수치 속도 답은 horizontal sharding이고, 더 넓은 브라우저 OS 속도 답은 준비된 상태, 복원, process pool, 탭 안 서버, 이동 가능한 machine image다.

## 공개 표면

능력은 opt-in이다. 필요한 것만 켜고, 엔진 내부(`HEAPU8` 등)가 아니라 능력 계약을 소비한다. 이 README는 공개 표면의 지도이고, 제품 판단 정본은 [능력 매트릭스](docs/consuming/capabilityMatrix.md)에 있다.

| 필요한 것 | 공개 export | 실행 증거 |
| --- | --- | --- |
| 탭 안에서 Python 실행 | `boot`, `Runtime`, `FileSystem`, `MemoryCapability`, `PAGE_SIZE`, `checkEnvironment` | [basic example](examples/basic.html), [browser gate](tests/browser/gate.html) |
| 반복 가능한 환경 준비 | `bootEnv`, `runScript`, `WheelCache` | [env manager probes](tests/attempts/envManager/README.md) |
| 상태 복원, 분기, 시간여행 | `ReactiveController` | [browser gate](tests/browser/gate.html), [reactive probes](tests/attempts/runtimeParity/README.md) |
| 여러 탭에서 하나의 Python 머신 유지 | `openPersistentMachine`, `KernelElection`, `MachineJournal` | [immortal demo](examples/immortal.html), [product consumer gate](tests/browser/productConsumer.mjs), [S5 artifact](mainPlan/_done/browser-os-north-star/benchmarks/s5-pyproc-2026-07-15.json) |
| 브라우저 worker를 프로세스로 사용 | `PyProc`, `SIGNAL`, `MachineContainer`, `JobControl`, `KernelElection`, `SharedKernel` | [process demo](examples/processOs.html), [speed lab](examples/speedLab.html), [S1 artifact](mainPlan/_done/browser-os-north-star/benchmarks/s1-pyproc-2026-07-15.json) |
| Python을 실제 browser URL 뒤에 서빙 | `AsgiServer`, `VirtualOrigin` | [server dev demo](examples/serverDev.html), [S3 artifact](mainPlan/_done/browser-os-north-star/benchmarks/s3-pyproc-2026-07-15.json) |
| 터미널과 빌린 syscall 흐름 구성 | `Terminal`, `SyscallBridge`, `SocketBridge`, `DeviceFs` | [terminal demo](examples/terminal.html), [syscall/socket/device probes](tests/attempts/runtimeParity/README.md) |
| 머신 저장, 전송, 부활 | `bootSession`, `Session`, `openMachine`, `createMachineKeyPair`, `exportMachinePublicKey`, `fingerprintMachinePublicKey`, `Init`, `MachineJournal`, `MachineJail` | [machine demo](examples/machine.html), [S4 artifact](mainPlan/_done/browser-os-north-star/benchmarks/s4-pyproc-2026-07-15.json) |
| 기본 엔진 밖의 가능성 확장 | `GpuCompute`, `GpuArray`, `GpuBridge`, `bootWasi`, `WasiSession` | [GPU probes](tests/attempts/gpuCompute/README.md), [WASI gate](tests/browser/wasiGate.html) |
| worker 기반 능력을 제품에 배포 | `getPyProcAssetManifest`, `verifyPyProcAssetIntegrity`, `registerPyProcServiceWorker`, `PYPROC_ASSET_MANIFEST_VERSION` | [product consumer gate](tests/browser/productConsumer.mjs), [asset CLI](scripts/assetManifest.mjs) |
| 실패를 프로그램적으로 분기 | `PyProcError`, `PYPROC_ERROR_CODES` | [structure gate](tests/run.mjs), [browser gate](tests/browser/gate.html) |

서브패스 import도 지원한다:

```js
import { boot } from "pyproc/runtime";
import { ReactiveController } from "pyproc/reactive";
import { PyProc } from "pyproc/process-os";
import { getPyProcAssetManifest, verifyPyProcAssetIntegrity } from "pyproc/assets";
```

능력별 예제 중심 상세 문서는 [docs/](docs/README.md)에 있다. 이 README는 지도로 둔다. 제품에서 어떤 능력을 켤지 판단할 때는 [능력 매트릭스](docs/consuming/capabilityMatrix.md)를 본다. 각 공개 export를 제품 가치, 상태, 설정 조건, 실행 표면, 게이트, 경계로 묶어 둔다.

배포 자산 manifest:

```bash
npx pyproc-assets --baseURL /vendor/pyproc/ --out public/vendor/pyproc-assets.json --copy-to public/vendor/pyproc
```

CLI는 Worker / SharedWorker / Service Worker import graph를 따라가고, `--copy-to`가 있으면 필요한 파일을 복사하며, 모든 파일에 `sha256-...` integrity를 붙인다. 이 JSON을 worker 기반 능력 spawn 전 `assetIntegrity`로 넘기고, Service Worker 경로도 `registerPyProcServiceWorker(...)`로 검증한다.

## 셋업

**Chromium / Edge 전용.** JSPI(JavaScript Promise Integration, Chrome 137부터 기본), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox / Safari 미지원은 결함이 아니라 의도된 스코프다.

셋업은 두 티어다. "그냥 설치하고 import"는 기본에서 참이지만 전부에서는 아니다:

| 하고 싶은 것 | 필요한 것 |
|---|---|
| `boot` / `run` / `loadPackages`, `enableReactive`(체크포인트·시간여행) | `npm install` + Chromium 브라우저. 헤더 불필요. |
| `PyProc`(fork·`map`·interrupt), IPC, 블로킹 소켓 | 아래 두 헤더 + **same-origin 워커 파일**(= npm 설치/벤더링, CDN 직접 import 불가) |

pyproc을 띄우는 페이지를 다음 헤더로 서빙한다:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`checkEnvironment()`가 지금 무엇이 준비됐고 부족하면 무엇을 어떻게 고칠지 알려준다. 프로세스 OS에 의존하기 전에 한 번 부른다:

```js
import { checkEnvironment } from "pyproc";

const env = checkEnvironment();
if (!env.ok) console.warn(env.issues);   // 각 issue = { code, need, why, fix }
// env.ok true  -> 프로세스 OS 포함 전부 가능
// env.ok false -> 기본은 여전히 동작. issues가 PyProc/소켓을 여는 조건을 알려준다
```

헤더를 빼고 `PyProc`를 쓰면 암호 같은 `SharedArrayBuffer is not defined` 대신 **실행 가능한 에러**(어느 헤더를 달지)가 난다.

헤더 보내는 흔한 방법:

```js
// Vite (vite.config.js)
export default { server: { headers: {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
} } };
```

```text
# _headers 파일을 읽는 정적 호스팅(Netlify, Cloudflare Pages)
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

헤더를 아예 못 다는 호스팅(GitHub Pages 등)이면 `pyprocSw.js?coi=1`로 등록하고 1회 새로고침 - 서비스 워커가 헤더를 주입한다(가상 COI).

## 설치와 핀

npm([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)): `npm install pyproc`. 빌드 단계 없음(네이티브 ESM). pyproc을 런타임 SSOT로 소비하는 제품은 커밋 SHA로 핀한다(기본 브랜치 플로팅 금지):

```jsonc
// package.json
"dependencies": { "pyproc": "github:eddmpython/pyproc#<commit-sha>" }
```

설치 없이 CDN에서 바로 import도 된다(단일 런타임 경로만; 프로세스 OS는 워커 파일이 페이지와 same-origin이라야 한다):

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/gh/eddmpython/pyproc@<commit-sha>/index.js";
</script>
```

## 누가 쓰나

- **dartlab**(라이브): DART / SEC 공시 노트북. 노트북 워커가 자체 Pyodide를 부팅하고 `new Runtime(py)`로 pyproc을 채택, 커널 내 `AsgiServer`를 browser-as-server 백엔드로(`fetch("/pyapi/...")`를 파이썬 앱이 응답, 소켓 없음) 프로덕션 운영 중.
- **codaro**: first consumer, 커밋 SHA 핀, `Runtime`·`PyProc` seam 배선.
- **xlpod**(이관 중): 셀 수식(`=PYUDF`) 안에서 진짜 파이썬을 도는 브라우저 스프레드시트. `Runtime`, `setInterruptBuffer`, PyProxy 값 다리 사용.

pyproc은 "참조"가 아니라 **실제 import**로만 SSOT가 된다: 소비자는 SHA를 핀하고, 공개 표면 + 동봉 `index.d.ts`에 의존하며, 역방향 import는 없다. 상세: [docs/consuming/contract.md](docs/consuming/contract.md).

## 개발

```bash
npm test              # Node 구조 / 린트 게이트 (의존성 0)
npm run test:consumer # 설치 패키지 브라우저 소비자 게이트
npm run test:browser  # headless Chromium 런타임 게이트: 부팅 / 리액티브 / fork / map (의존성 0)
npm run serve         # 수동 검증·벤치용 COOP/COEP 정적 서버
```

WASM 런타임이라 진짜 검증은 브라우저에서만 한다. `test:browser`는 repo 공개 표면을 보고, `test:consumer`는 임시 브라우저 앱 안에서 설치된 npm 패키지와 Service Worker + `VirtualOrigin` URL 동선을 검증한다. 둘 다 CI에서 돈다. 운영 문서는 [docs/](docs/README.md), 설계·결정 기록은 [mainPlan/](mainPlan/README.md), 기여 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md).

## 라이선스

[Mozilla Public License 2.0](LICENSE), 밑의 엔진 Pyodide와 같은 라이선스. Copyright 2026 eddmpython.

MPL-2.0은 파일 단위 카피레프트라 실질 조건은: **임베드는 자유**(비공개 앱에 pyproc을 import하고 배포·판매해도 자기 코드는 자기 것); **pyproc 자체의 포크는 공개 유지**(이 라이선스가 덮는 파일을 수정하면 그 파일 소스를 MPL-2.0으로 공개); **특허 허여**(기여자가 자기 기여분에 대해, 2.1(b)절). 기여는 별도 CLA 없이 같은 라이선스로 수용된다(inbound = outbound). [CONTRIBUTING.md](CONTRIBUTING.md) 참조.
