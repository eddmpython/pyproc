<p align="center">
  <img src="https://raw.githubusercontent.com/eddmpython/pyproc/main/assets/logo.svg" width="132" alt="pyproc">
</p>

<h1 align="center">pyproc</h1>

<p align="center"><b>브라우저에 영속하는 파이썬 컴퓨터.</b></p>

<p align="center">
  Machine 하나를 열고 workspace, environment, processes, history를 유지한다. 잘못된 작업은<br>
  되돌리고, 서명 image로 옮긴다. 진짜 CPython이며 애플리케이션 서버는 필요 없다.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pyproc"><img src="https://img.shields.io/npm/v/pyproc?label=npm&color=5b8cff&labelColor=0a0f1c" alt="npm"></a>
  <a href="https://github.com/eddmpython/pyproc/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eddmpython/pyproc/ci.yml?branch=main&label=ci&labelColor=0a0f1c" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-7c4dff?labelColor=0a0f1c" alt="license MPL-2.0"></a>
  <img src="https://img.shields.io/badge/runtime_npm_dependencies-0-00d4c8?labelColor=0a0f1c" alt="zero runtime npm dependencies">
  <img src="https://img.shields.io/badge/CPython-3.14%20on%20WebAssembly-5b8cff?labelColor=0a0f1c" alt="CPython 3.14 on WebAssembly">
</p>

<p align="center">
  <a href="https://eddmpython.github.io/pyproc/"><b>라이브 데모</b></a> ·
  <a href="#제품-모델">제품 모델</a> ·
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#ai-에이전트에서-쓰기">AI 에이전트에서 쓰기</a> ·
  <a href="#기능-상태">상태</a> ·
  <a href="README.md">English</a>
</p>

---

<details>
<summary><b>목차</b></summary>

- [제품](#제품)
- [제품 모델](#제품-모델)
- [하나의 Machine 생명주기](#하나의-machine-생명주기)
- [Machine의 가치가 드러나는 곳](#machine의-가치가-드러나는-곳)
- [Machine이 제공하는 결과](#machine이-제공하는-결과)
- [빠른 시작](#빠른-시작)
- [진입점 고르기](#진입점-고르기)
- [AI 에이전트에서 쓰기](#ai-에이전트에서-쓰기)
- [AI 에이전트에 꽂기 (MCP)](#ai-에이전트에-꽂기-mcp)
- [기능 상태](#기능-상태)
- [보장하는 것과 아직 아닌 것](#보장하는-것과-아직-아닌-것)
- [스코프와 플랫폼 방향](#스코프와-플랫폼-방향)
- [보안 모델](#보안-모델)
- [어떻게 도나 (한 장)](#어떻게-도나-한-장)
- [형태가 값을 하는 자리](#형태가-값을-하는-자리)
- [Web Computer 실행](#web-computer-실행)
- [공개 표면](#공개-표면)
- [의존성 경계](#의존성-경계)
- [셋업](#셋업)
- [설치와 핀](#설치와-핀)
- [북극성](#북극성)
- [개발](#개발)
- [라이선스](#라이선스)

</details>

## 제품

pyproc은 하나의 제품이다. **브라우저에 영속하는 Python 컴퓨터**다. 서로 무관한 runtime
helper 모음이 아니다. 공개 명사는 `Machine` 하나이며 실행, 파일, 프로세스, 내구 history,
image, permission은 모두 그 Machine의 일부다.

약속은 단순하다. Python을 한 번 준비하고, 살아 있는 상태를 유지하고, 분기하거나 되돌리고,
탭을 닫아도 이어가며, 검증된 파일로 Machine을 옮긴다. 기본 제품 경로는 Python Machine이다.
Linux, WASI, GPU, socket, MCP는 같은 계약 주변의 선택 guest 또는 capability이지 별도 정체성이
아니다.

## 제품 모델

| 제품 개념 | 현재 계약 | 소유하는 것 |
|---|---|---|
| **Machine** | 기본 `open()`, 명시적 휘발 kernel은 `boot()` | 단일 내구 root와 생명주기 |
| **Workspace** | `open({ name })` + `/home/web` | 다시 열어도 남는 파일과 작업 |
| **Environment** | deterministic manifest + 정확한 engine version | package, setup, replay 경계 |
| **Processes** | `machine.proc()` | 독립 worker interpreter, fork, signal, 병렬 작업 |
| **History** | 자동 Machine generation + 명시적 휘발 checkpoint | checkpoint, branch, restore, journal, recovery |
| **Image** | 서명된 `.pymachine` / `.webmachine` | 무결성과 명시적 trust gate를 가진 이동 상태 |
| **Permissions** | capability contract + permission jail | network, storage, device, memory, 실행 정책 |

이것들은 서로 경쟁하는 최상위 API 일곱 개가 아니라 제품 개념이다. Machine handle이 root로
남고, 그 동사가 필요한 capability만 드러낸다. 내부 engine object는 이 경계 뒤에 둔다.

## 하나의 Machine 생명주기

```text
create / open  ->  work  ->  checkpoint / commit  ->  branch / restore  ->  export / reopen
      Machine      Workspace + Environment     History + Processes           Image + Trust
```

기본 Machine은 완료된 명령마다 Promise가 끝나기 전에 commit한다. `commit()`은 강제 경계
동사로 남고, `boot()`은 checkpoint와 branch 실험을 위한 명시적 휘발 작업대다. commit 실패는
outcome-unknown이며 자동 재시도를 허용하지 않는다.

명시적 휘발 되감기 세션은 다음처럼 쓴다:

```js
import { boot } from "pyproc";

const machine = await boot();
await machine.loadPackages(["numpy"]);   // 한 번 준비(패키지, 데이터)
const cp = machine.history.checkpoint(); // 준비된 상태 저장

const attempts = [
  "import numpy as np; float(np.arange(10).men())",
  "import numpy as np; float(np.arange(10).mean())",
];

for (const code of attempts) {
  try {
    console.log(machine.run(code));      // 되는 시도에서 4.5
    break;
  } catch (error) {
    machine.history.restore(cp);         // 준비 상태 복귀
  }
}
```

`checkpoint`와 `restore`가 옮기는 것은 일부 변수를 직렬화한 사본이 아니라 interpreter
상태다. 준비된 environment가 재import와 재설치 없이 돌아온다.

## Machine의 가치가 드러나는 곳

| 작업 | 일어나는 일 | Machine의 이점 |
|---|---|---|
| AI 데이터 분석 | AI가 생성한 pandas / NumPy 코드를 사용자 파일에 실행 | 원본 파일을 서버로 보내지 않고 분석 |
| AI 코딩 도구 | AI 코드 실행 전 체크포인트, 실패하면 복원 | 값싼 시행착오, 환경 초기화 없음 |
| 멀티 에이전트 분석 | 하나의 준비된 상태에서 여러 실행 분기 | 서로 다른 접근을 독립적으로 비교 |
| 브라우저 노트북 | 패키지와 데이터를 로드한 상태 유지 | 재부팅·재설치 없음 |
| 코딩 교육 | 학생 상태를 저장하고 AI 수정안을 별도 분기에서 시험 | 학생 작업을 훼손하지 않고 피드백 |
| 사내 분석 도구 | 민감한 CSV / Excel을 로컬 탭에서 처리 | 데이터 외부 전송 최소화 |
| 오프라인 도구 | 런타임과 패키지를 캐시 | 네트워크가 제한된 환경에서도 실행 |

관통하는 것은 한 번 준비한 뒤 저장, 분기, 복원할 수 있는 장수 Python Machine 하나다.
fail-closed network policy를 적용하면 선택한 데이터도 code 실행 중 로컬에 둘 수 있다.

## Machine이 제공하는 결과

- **브라우저에서 실행 - 애플리케이션 서버가 필요 없다.** Python이 Chromium renderer
  sandbox와 WebAssembly 경계 안에서 돈다. resource와 network policy는 명시적으로 설정한다.
  자세한 경계는 [보안 모델](#보안-모델)에 있다.
- **다시 만들지 않고 복원.** 패키지와 데이터를 이미 로드한 상태를 체크포인트로 저장하고 그 지점으로 되돌린다 - 재실행도, 재설치도 없이.
- **탭을 닫아도 머신은 유지**(`open()` / `open({ name })`). 여러 탭이 하나의 논리적 Python 상태를 공유한다. 완료된 명령마다 메모리, `/home/web`, 전달된 결과가 반환 전에 자동 commit되고, 리더가 닫히면 다른 탭이 그 OPFS generation에서 계속한다.
- **한 상태에서 분기**(Beta - `machine.history` + `machine.proc()`). 에이전트가 같은 준비 상태에서 여러 코드 후보를 독립적으로 실행하고 결과를 비교한다.
- **fail-closed 정책 아래 데이터는 로컬에 둘 수 있다.** 데이터를 탭에서 처리하고 선택한
  결과만 내보낸다. 로컬 실행만으로는 no-exfiltration 경계가 되지 않는다.
- **격리된 실행.** Python이 메인 UI 스레드와 분리돼, 관리하는 여러 워커에서 돈다.

## 빠른 시작

```sh
npm install pyproc
npx pyproc-engine --out public/vendor/pyodide
```

```js
import { open } from "pyproc";

const machine = await open();
console.log(await machine.run("sum(range(1_000_000))")); // 499999500000
```

같은 origin의 여러 탭에서 하나의 지속 머신을 연다:

```js
import { open } from "pyproc";

const persistentMachine = await open({ name: "workspace" });
await persistentMachine.run("counter = globals().get('counter', 40) + 1");
console.log(await persistentMachine.run("counter")); // 리더 승계 뒤에도 41
```

[Immortal Python Machine 데모](examples/immortal.html)에서 상태 공유, leader identity, 영속 epoch, 강제 승계, 서버 없는 로컬 복구를 직접 시험할 수 있다.

체크포인트와 복원. 핸들의 `history`가 두 구역을 어휘로 가른다. 닫는 `checkpoint()`가 복원을 건전하게 만드는 실행 경계를 표시한다:

```js
machine.run("values = [10, 20, 30]");
const cp = machine.history.checkpoint();      // 이 상태 저장
machine.run("values.append(999)");
machine.history.checkpoint();                 // 실행 경계 닫기 -> 즉시 복원 경로
machine.history.restore(cp);                  // 체크포인트로 복귀 - 바뀐 페이지만 되쓴다
console.log(machine.run("len(values)"));      // 3
```

경계를 닫지 못했다면(실행 중 예외, 흘러간 변이) `cp.restore()`가 이를 감지해 자동으로
전체 재해시 경로로 복원한다 - 느려질 뿐 조용히 오염되지 않는다. 라이브 프록시 핸들로
파이썬을 호출했다면 `machine.markDirty()`로 신고한다.

> 위 기본은 Chromium 브라우저만 있으면 된다. `PyProc`(프로세스 OS)와 소켓은 `crossOriginIsolated`(`COOP: same-origin`, `COEP: require-corp`)와 same-origin 워커도 필요하다 - [셋업](#셋업) 참조. `checkEnvironment()`로 확인하라.

## 진입점 고르기

한 번에 한 질문, 명백한 문 하나:

| 필요한 것 | 진입점 | 얻는 것 |
|---|---|---|
| 내구 Python Machine | `open()` 또는 `open({ name })` | 멀티탭 Machine 핸들. 완료된 run은 settle 전에 commit |
| 이 탭에서 파이썬 실행(부활 불요) | `boot()` | 머신 핸들 (`run`/`fs`/`history`/`proc`, `runtime` 탈출구) |
| 저장·내보내기·부활하는 상태 | `boot({ deterministic: true, ...manifest })` | 같은 핸들. `history.export`/`history.save`가 성립 |
| 이동 가능한 머신 파일 열기 | `open(blob, { trustedPublicKeys })` | 무결성/신뢰 검증 뒤 머신 핸들 |
| 저장한 세션의 부활 | `open({ dir, name })` | 머신 핸들(같은 매니페스트 리플레이 + 델타) |
| 진짜 병렬 / 라이브 fork | `await machine.proc({ lanes, replay })` | 워커 프로세스 풀 (`map`/`fork`/`signal`) |

공통 기반은 결정적 리플레이다: `boot({ deterministic: true })`가 부팅 엔트로피를 고정해 같은
매니페스트가 리플레이 경계(cp0)에서 바이트 동일한 메모리를 재현하고, 그것이 델타 저장/저널 부활/워커 간 `fork`를
건전하게 만든다. 이 선택은 모든 내구 커밋의 환경 지문에 기록되며, 비결정 머신은
`history.export`를 명시적으로 거부한다(리플레이 보증의 조용한 소실 금지).

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

**패턴 3 - 로컬 우선 데이터.** 사용자 파일은 탭에서 분석되고, 요약만 나간다. 에이전트 코드를 실행하기 전에 fail-closed CSP를 적용해 코드가 외부 endpoint를 열지 못하게 하고, 신뢰한 agent 제어 채널이 돌려주는 값도 제한한다.

```text
사용자 파일  ->  브라우저 Python  ->  요약만  ->  AI 모델
```

## AI 에이전트에 꽂기 (MCP)

레포에 추가 runtime npm package가 없는 MCP 서버가 들어 있다. 지속 pyproc Machine을 도구 4개
(`pythonRun`, `checkpointSave`, `checkpointRestore`, `sandboxReset`)로 노출한다.
COOP/COEP 서버 뒤에 headless Chromium 머신 페이지를 띄우고 stdio로 MCP를 말하므로,
위의 재시도 루프가 그대로 도구 호출이 된다:

```sh
git clone https://github.com/eddmpython/pyproc && cd pyproc
# MCP 클라이언트 등록(claude CLI 예시):
claude mcp add pyproc-sandbox -- node scripts/mcpSandboxServer.mjs
# 또는 직접 실행해 stdio로 newline-delimited JSON-RPC를 말한다:
npm run mcp:sandbox
```

에이전트는 상태를 한 번 준비하고(`pythonRun`), 핸들을 저장하고(`checkpointSave`),
위험한 시도를 돌린 뒤 밀리초에 되돌린다(`checkpointRestore`). 환경 재구축이 없다.
신뢰한 엔진 부팅을 먼저 끝낸 뒤 에이전트 코드는 fail-closed 외부 네트워크 CSP 아래에서 돌고,
same-origin MCP 제어 트래픽만 열린다. 부팅 자체도 CDN 요청이 없어야 한다면 엔진을 자체 호스팅한다.
도구 결과는 의도적으로 MCP 채널을 건너므로 호출 애플리케이션이 출력 검토와 인가를 계속 소유한다.
`npm run test:mcp`가 전체 왕복과 통제 수신기를 향한 `import js` / `fetch` 외부 전송 시도를 CI에서 검증한다.

## 기능 상태

브라우저 게이트 커버리지 기준의 정직한 성숙도. 아래는 전부 런타임 게이트가 있고, 라벨은 오늘 얼마나 걸 수 있는지다.

| 영역 | 상태 |
|---|---|
| Python 실행 (`boot` / `run` / `loadPackages`) | Stable |
| 프로세스 OS: 스냅샷-fork 스폰, `map` 병렬 (`PyProc`) | Beta |
| 복원 기반 리액티비티 (`enableReactive`: 체크포인트 / 시간여행) | Beta |
| 커널 내 ASGI (`AsgiServer`) | Beta |
| 선언 환경 레인 (`boot` 매니페스트: `packages` / `env` / `setup` / `wheelDir`), wheel 캐시, 터미널, syscall 브리지 | Beta |
| 세션 부활 + `.pymachine` 이미지, 머신 저널(WAL) | Experimental |
| 라이브 프로세스 fork, 장치 FS, init / cron / resume hook, 가상 오리진 URL | Experimental |
| 기본 내구 Machine(`open()` / `open({ name })` -> `KernelElection`) | Beta |
| non-Pyodide CPython 3.14 (`bootWasi` / `WasiSession`) | Research preview |

## 보장하는 것과 아직 아닌 것

**보장(브라우저 실측):**

- 지원 브라우저에서 Pyodide 기반 Python 실행.
- 명시된 실행 경계에서 WASM 힙 상태 저장.
- 호환되는 런타임 조건에서 상태 복원.
- 워커 기반 실행 격리.

**아직 보장하지 않음:**

- 임의 시점의 완전한 프로세스 복제 - 진행 중인 네트워크 요청과 Promise는 복원되지 않는다.
- 효과를 확인할 수 없는 조용한 재실행. 일반 follower는 leader의 heap을 검사할 수 없으므로 전송된 호출이 승계 중 끊기면 `PYPROC_RPC_OUTCOME_UNKNOWN`을 반환하고 다시 보내지 않는다. 자기 session에 JS proxy가 없음을 증명할 수 있는 durable caller controller만 같은 request ID를 대기시켰다가 승계자에게 한 번 묻는다. 살아 있는 leader의 timeout과 caller 소멸은 다시 보내지 않는다. 정본은 [durable RPC 상태표](docs/consuming/contract.md#durable-rpc-state-table-normative)다.
- 모든 Python 패키지 - 네이티브 C 확장 wheel은 정적 빌드가 필요하다(순수 파이썬 + Pyodide 빌드 패키지는 된다).
- Pyodide 버전 간 snapshot 호환. `.pymachine` 이동성은 같은 엔진/매니페스트와 명시적 신뢰 또는 검증된 서명자를 전제로 한다.
- GPU / 네이티브 Linux 패키지, 완전한 POSIX `fork`, 임의 네이티브 바이너리.

## 스코프와 플랫폼 방향

pyproc은 위 [북극성](#북극성)이 말하는 persistent Python computer다. Python이 기본
Machine이다. Web Machine host는 package 안에서 나가고(`src/machine`, 진입은
`createWebComputer`) 같은 lifecycle을 Linux까지 확장한다. 두 guest의 memory와 disk를 함께
저장하고, browser process 재시작 뒤 복구하며, 새 browser profile에서 signed image를 연다.
재현 가능한 Buildroot Linux guest는 source, legal material, SBOM, config, 독립 빌드 증거와
함께 hash-pinned project release로 별도 출하한다. x86 emulator와 남은 firmware는 외부 공급
asset이며 npm에는 들어가지 않는다.

그 큰 목표 안에서 Python 도달 범위에는 상한을 두지 않는다. 로컬에서 되는 모든 Python을
언젠가 애플리케이션 서버 없이 브라우저에서 돌린다. 로컬에서 되는 것은 네 상태로 갈리고,
pyproc의 일은 이것들을 위 칸으로 밀어 올리는 것과 platform이 벽을 다시 여는 순간 가장 먼저
흡수하는 구조가 되는 것이다:

- **현재 달성**(CI 브라우저 게이트가 도는 것): 순수 파이썬 + Pyodide 패키지, 멀티코어 프로세스, 체크포인트 / 복원, 커널 내 ASGI, 터미널, 영속 FS, 이동 가능한 `.pymachine`·`.webmachine` 이미지.
- **출하되나 headless CI 게이트 없음**: `pyproc/socket`(아웃바운드 소켓은 이 패키지가 배송하지 않는 WS-TCP 릴레이가 필요하다), `pyproc/gpu`(headless에 WebGPU 어댑터가 없다). 둘 다 제품 안에서 직접 검증해야 하는 opt-in subpath이고, 이 공백은 [계약 실태](docs/operations/contractReality.md)가 기록한다.
- **우회 가능**(브라우저 방식): TCP `listen()`은 ASGI 앱으로, `os.fork`는 워커 커널로, 아웃바운드 소켓은 얇은 릴레이로.
- **upstream 대기**(지금 막혔으나 다시 열림): 네이티브 C 확장 wheel(Emscripten 정적 빌드 / WebAssembly 컴포넌트 모델), 진짜 threading.
- **웹 보안상 영구 벽**: 임의 인바운드 연결과 임의 네이티브 바이너리는 외부 릴레이나 에이전트가 필요하다.

현재 격차 지도는 [능력 매트릭스](docs/consuming/capabilityMatrix.md)다. host 아키텍처의 정본은 출하되는 [`src/machine`](src/machine/) 계약이고, Dual-Boot 증거는 실행 가능한 [북극성 원장](tests/northStar.mjs)과 [Web Machine 브라우저 게이트](tests/webMachine/)에 등록돼 있다.

## 보안 모델

**공급망**: npm 릴리즈는 Trusted Publishing(OIDC) + provenance(손 게시 금지)로 나가고, `pyproc-assets` CLI가 worker/SW import graph의 SRI manifest를 만들며 `verifyPyProcAssetIntegrity`가 워커 spawn 전에 강제한다. 엔진 부팅은 fail-closed SRI(`engineScriptIntegrity`/`coreIntegrity`)와 재검증 OPFS 오프라인 캐시를 지원한다. 위협 모델: [SECURITY.md](SECURITY.md).

pyproc은 브라우저의 WebAssembly 및 Web Worker 격리 경계 안에서 Python을 실행한다. 이것은 임의의 신뢰할 수 없는 코드에 대한 안전 보장이 아니다: 신뢰할 수 없는 코드를 실행하는 애플리케이션은 자신의 위협 모델에 맞는 네트워크, 저장소, 패키지, 메모리, 실행 시간 정책을 별도로 구성해야 한다. `.pymachine` 파일은 살아있는 상태라 실행 파일과 같은 위험을 진다 - `open(blob, trustOpts)`은 SHA-256 봉투를 검증하고, 명시적 `{ trust: true }` 또는 `trustedPublicKeys`로 검증된 signature 없이는 열지 않는다.

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

네 프리미티브가 건전성을 만든다: 실행 경계마다 완전 힙 해시(샘플링은 변화를 놓쳐 복원을 오염시킨다), 결정적 부팅(바이트 동일 base라 델타만 이동하면 된다), 스냅샷-fork, 엔진 seam(같은 프리미티브가 non-Pyodide CPython 3.14에서도 돌아 Pyodide 내부에 안 묶임을 증명). 지속 설계는 [제품 방향](docs/product/vision.md)과 [모듈 경계](docs/operations/moduleBoundaries.md), 실행 가능한 축별 격차는 [`tests/northStar.mjs`](tests/northStar.mjs)가 정본이다.

## 형태가 값을 하는 자리

pyproc은 "그냥 더 빠른 파이썬"이 아니다. 프로세스 모델을 가진 파이썬이고, 이득은 산술이 아니라
계약에서 온다: 상태를 한 번 준비해 분기하고, 재실행 대신 복원하고, 독립 인터프리터로 일을 쪼개고
(인터프리터 N개 = GIL N개 = 진짜 병렬), 탭 안에서 서빙하고, 살아있는 머신을 서명된 이미지로 옮긴다.
단일 커널 NumPy는 일반 WebAssembly BLAS이며 그렇지 않은 척하지 않는다.

`npm run serve`로 [Speed Lab](examples/speedLab.html)을 띄워 각자의 기계에서 직접 재라.
측정 계약은 [benchmarking.md](docs/operations/benchmarking.md)에 있다.

## Web Computer 실행

다중 guest Web Computer 표면은 같은 Machine 생명주기를 한 브라우저 workspace의 Python과
Linux로 확장한다. 두 guest의 실제 memory와 block-backed file을 하나의 IndexedDB
generation으로 저장하고, 브라우저 프로세스를 닫았다 열어도 복구하며, 서명된 `.webmachine`
파일 하나로 함께 옮긴다. Machine 계약이 Python 밖도 host할 수 있음을 증명하지만 pyproc의
기본 제품 경로인 persistent Python Machine을 대체하지 않는다.

```sh
npm run assets:web-computer
npm run serve
```

Edge 또는 Chromium에서 `http://localhost:8788/apps/webComputer/`를 연다. Python 실행, Linux VGA 화면과 terminal, pause/resume/shutdown, 명령 뒤 자동 영속 저장, 수동 Save, 서명 Export, signer를 명시적으로 승인하는 Import 화면을 제공한다.

Linux 실행 catalog는 프로젝트가 재현 빌드한 guest image를 가리킨다. image, exact source,
전체 legal-info, SBOM, config와 재현 manifest를 한 자산 릴리즈에서 제공하며, image binary는
git과 npm package에서 계속 제외된다.

## 공개 표면

능력은 opt-in이다. 필요한 것만 켜고, 엔진 내부(`HEAPU8` 등)가 아니라 능력 계약을 소비한다. 이 README는 공개 표면의 지도이고, 제품 판단 정본은 [능력 매트릭스](docs/consuming/capabilityMatrix.md)에 있다.

루트 표면은 명사 하나와 그 동사들이다: **역사를 가진 머신**. 진입 동사 둘이 머신 핸들을 돌려주고, 부활 동사 하나가 어디서 왔든 머신을 되살리며, 나머지는 전부 핸들의 어휘다.

| 필요한 것 | 공개 export | 실행 증거 |
| --- | --- | --- |
| Python 머신 부팅과 실행 | `boot` (머신 핸들 반환: `machine.run`, `machine.runAsync`, `machine.fs`, `machine.term`, 탈출구 `machine.runtime`) | [basic example](examples/basic.html), [browser gate](tests/browser/gate.html) |
| 시간여행·분기·내구 커밋 | `boot` 핸들의 `machine.history` (`checkpoint`/`restore`/`tree`는 휘발, `commit`/`recover`/`watch`/`export`/`save`는 내구·내용주소) | [browser gate](tests/browser/gate.html), [machine demo](examples/machine.html) |
| 브라우저 worker를 프로세스로(독립 GIL) | `boot` 핸들의 `machine.proc` (풀 동사: `map`, `fork`, `forkMany`, `mapArray`, `matmul`) | [process demo](examples/processOs.html), [speed lab](examples/speedLab.html) |
| 파일·저장 세션·다른 탭에서 머신 부활 | `open` (기본/이름 있는 Machine, 서명 bundle blob, `{ dir, name }` 세션) | [immortal demo](examples/immortal.html), [machine demo](examples/machine.html) |
| 브라우저 컴퓨터 조립(다중 guest OS host) | `createWebComputer` | [웹 컴퓨터 앱](apps/webComputer/index.html), [웹 컴퓨터 게이트](tests/browser/webComputerProduct.mjs) |
| 부팅 전 플랫폼 준비 확인 | `checkEnvironment` | [browser gate](tests/browser/gate.html) |
| 실패를 프로그램적으로 분기 | `PyProcError`, `PYPROC_ERROR_CODES` | [structure gate](tests/run.mjs), [browser gate](tests/browser/gate.html) |

핸들 아래의 계약은 plumbing 서브패스가 나른다:

```js
// 자체 부팅한 Pyodide 인스턴스를 pyproc에 넘기는 채택 이음새.
import { Runtime, bootRuntime, checkEnvironment } from "pyproc/runtime";
// 내구 상태 커널: 오브젝트 모델, commit/open 프로토콜, store, 서명 bundle.
import { commitState, openState, OpfsStateStore, decodeStateBundle } from "pyproc/history";
// 브라우저 컴퓨터 내부(호스트, 장치, guest 어댑터, 머신 store).
import { createMachineCryptoProvider, MachineCommitCoordinator } from "pyproc/machine";
// 배포 자산: manifest, SRI 검증, Service Worker 등록.
import { getPyProcAssetManifest, verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "pyproc/assets";
// 강등 표면(headless CI 게이트 불가 또는 research preview) - 의도적으로 루트 밖:
import { GpuCompute } from "pyproc/gpu";
import { SocketBridge } from "pyproc/socket";
import { bootWasi } from "pyproc/wasi";
```

능력별 예제 중심 상세 문서는 [docs/](docs/README.md)에 있다. 이 README는 지도로 둔다. 제품에서 어떤 능력을 켤지 판단할 때는 [능력 매트릭스](docs/consuming/capabilityMatrix.md)를 본다. 각 공개 export를 제품 가치, 상태, 설정 조건, 실행 표면, 게이트, 경계로 묶어 둔다.

배포 자산 manifest:

```bash
npx pyproc-assets --baseURL /vendor/pyproc/ --out public/vendor/pyproc-assets.json --copy-to public/vendor/pyproc
```

CLI는 Worker / SharedWorker / Service Worker import graph를 따라가고, `--copy-to`가 있으면 필요한 파일을 복사하며, 모든 파일에 `sha256-...` integrity를 붙인다. 이 JSON을 worker 기반 능력 spawn 전 `assetIntegrity`로 넘기고, Service Worker 경로도 `registerPyProcServiceWorker(...)`로 검증한다.

## 의존성 경계

**runtime npm 의존성 0은 정확한 package 사실이지 컴퓨터에 의존성이 없다는 주장이 아니다.**
pyproc은 출하하는 JavaScript runtime graph를 직접 소유한다. 작동하는 Machine은 여전히
engine, browser primitive, 명시적으로 켠 외부 capability 위에 선다.

| 층 | 현재 경계 | 제거 가능한가 |
|---|---|---|
| Runtime npm graph | `dependencies` 아래 package 없음. native ESM source 그대로 출하 | 이미 0 |
| Python engine asset | 검증된 same-origin `/vendor/pyodide/`가 기본인 Pyodide v314.0.2 | 제3자 유통은 기본 경로에 없음. CPython을 대체하지 않고 engine 자체를 제거할 수는 없음 |
| Browser platform | Chromium/Edge, WebAssembly, Worker, OPFS. blocking/process 경로는 JSPI와 COOP/COEP | 제거 불가. 이것이 hardware와 security boundary |
| 선택 capability | raw outbound socket relay, WebGPU hardware, 주입하는 x86 emulator, firmware, Linux image | 제거 가능. capability를 빼도 Python Machine은 온전함 |

따라서 가장 강한 배포는 존재하지 않는 무의존 컴퓨터가 아니라 **소유하고 검증하는 의존성
chain**이다. pyproc 정확 버전을 pin하고 `pyproc-engine`으로 engine을 준비하며, JavaScript asset
SRI manifest를 생성·검증하고, 검증한 asset을 OPFS에 cache한다. CDN `indexURL`은 명시적 평가
경로일 뿐 기본값이 아니다.

## 셋업

**Chromium / Edge 전용**이고, 요구는 패키지 단위가 아니라 능력 단위다. 부팅, 코드 실행, 패키지 설치, `machine.history` 전부는 브라우저 말고 아무것도 요구하지 않는다(헤더 없음, 번들러 설정 없음). JSPI(Chrome 137부터 기본)는 블로킹 경로가, COOP/COEP를 통한 SharedArrayBuffer는 프로세스 OS가 요구한다. `checkEnvironment()`가 페이지가 어디 서 있는지 정확히 보고하고, 각 능력은 조용히 실패하는 대신 실행 가능한 오류를 던진다. Firefox / Safari 미지원은 결함이 아니라 의도된 스코프다.

셋업은 두 티어다. "그냥 설치하고 import"는 기본에서 참이지만 전부에서는 아니다:

| 하고 싶은 것 | 필요한 것 | 엔진 자산 |
|---|---|---|
| `open` / `run`, 또는 휘발 `boot` / 패키지 / `machine.history` | `npm install`, `npx pyproc-engine --out <static-root>/vendor/pyodide`, Chromium. 헤더 불필요. | 검증된 same-origin `/vendor/pyodide/` 배포판 |
| `machine.proc()`(fork·`map`·interrupt), IPC, 블로킹 소켓 | 아래 두 헤더 + **same-origin 워커 파일**(= npm 설치/벤더링, CDN 직접 import 불가) | 같고, 워커 파일도 same-origin이어야 한다 |


**엔진 자산은 npm tarball 안에 넣지 않고 배포할 때 준비한다.** 게시된 `pyproc-engine` CLI가
exact release를 받고, 여섯 boot anchor를 pyproc catalog와 대조한 뒤 모든 package 파일을 pin된
lock과 검증해서 기본 `/vendor/pyodide/` URL 아래에 둔다.

```sh
npx pyproc-engine --out public/vendor/pyodide
```

```js
// 기본값이 /vendor/pyodide/의 pyodide.js와 fetch되는 core 바이트를 검증한다.
await boot();
// 선택: 검증한 core를 OPFS에 캐시해 두 번째 부팅부터 fetch 계층 네트워크 0.
await boot({ coreCacheDir: await navigator.storage.getDirectory() });
// 평가 전용: 다른 배포 지점을 명시적으로 선택한다.
await boot({ indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/" });
```

기본 runtime은 fetch되는 core 바이트를 다시 검증한다. custom engine loader는 자기 trust policy를
소유한다. pin 버전과 배포 경계가 package 계약이다:
[docs/consuming/contract.md](docs/consuming/contract.md).

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

npm([npmjs.com/package/pyproc](https://www.npmjs.com/package/pyproc)): `npm install pyproc`. 빌드 단계 없음(네이티브 ESM). 정확한 버전으로 핀한다 - 플로팅 범위(`^`, `~`, `latest`)는 지원하지 않는다. 상태 커널의 리플레이 보장은 버전에 묶여 있다:

```jsonc
// package.json
"dependencies": { "pyproc": "0.0.11" }
```

`pyproc/runtime`과 typed API subpath 항목은 0.0.11에 출하된다. 아직 릴리즈하지 않은 커밋을
소비할 때는 SHA 핀(`github:eddmpython/pyproc#<commit-sha>`)을 쓴다. 전체 정책:
[docs/consuming/contract.md](docs/consuming/contract.md).

설치 없이 CDN에서 바로 import도 된다(단일 런타임 경로만; 프로세스 OS는 워커 파일이 페이지와 same-origin이라야 한다):

```html
<script type="module">
  import { boot } from "https://cdn.jsdelivr.net/npm/pyproc@0.0.11/index.js";
</script>
```

## 북극성

**브라우저를 영속하는 컴퓨터로 만들고, Python을 기본 Machine으로 삼으며, 그 컴퓨터를 pyproc 자신으로 만든다.**

점수의 근거는 CI에서 실제로 도는 게이트다. 자동으로 실행되지 않는 경로는 구현이 아무리 완성돼 있어도 점수로 세지 않고, 증거에 수동 probe가 섞인 축은 9점 아래로 묶인다. 10점은 그 축이 끝난 상태다: 실제 브라우저에서 반복 검증됐고 공개 표면에 우회로가 남지 않았다.

지금 총점은 **103.7 / 120, 평균 8.6 / 10**이다.

| 축 | 현재 점수 | 지금 서 있는 자리 | 도달해야 하는 자리 | 다음 수 |
|---|---:|---|---|---|
| 탭 안의 진짜 파이썬 | 9.7 | `open`은 내구 Machine이고 `boot`은 휘발 작업대이며 둘 다 WebAssembly 위 CPython을 몬다. 게시된 무의존 CLI가 pin된 engine을 준비하고, same-origin에서 catalog와 lock hash를 검증한 뒤 브라우저가 core를 다시 검증하며 제3자 요청은 0이다. 브라우저, 설치 패키지, 데모, 에이전트 게이트가 이를 돌린다. 플랫폼은 Chromium과 Edge뿐이다. | 로컬 인터프리터가 돌리는 파이썬을 서버도 준비 의식도 없이 탭에서 그대로 돌린다. | Machine 계약을 약화하거나 없는 능력을 숨기지 않고 브라우저 플랫폼 범위를 넓힌다 |
| 되감을 수 있는 상태 | 9.0 | 체크포인트, 복원, 분기, 가지치기가 완전 힙 해시 위에서 실행 경계마다 돈다: 전 바이트 동일 full-heap 왕복, 분기 나무의 형제 델타 격리, 경계를 어겼을 때 오염된 복원 대신 전체 재해시로 물러나는 경로까지 게이트가 문다. 델타 건전성과 나무 무결성은 Node property/fuzz 게이트가 덮는다. 임의 순간의 포획은 아직 아니다: 진행 중인 promise와 네트워크 요청은 경계 밖에 산다. | 떠날 때 진행 중이던 작업까지 포함해 과거의 어느 상태든 즉시 돌아온다. | 실행 경계가 아니라 임의 순간을 포획한다: 진행 중인 promise와 요청을 경계 안으로 들인다 |
| 프로세스와 진짜 병렬 | 8.5 | 워커가 프로세스다: 스냅샷 fork 생성, `map`, `forkMany`, 시그널 표, kill, 잡 컨트롤, 중첩 컨테이너, 풀 소진, mid-flight 워커 사망까지 브라우저 게이트에서 수렴한다. 독립 인터프리터 N개 = 독립 GIL N개라 병렬성이 스케줄이 아니라 구조에서 나온다. 공유 메모리 스레딩과 임의의 POSIX 프로세스 트리는 없다. | 진짜 운영체제의 어휘를 가진 프로세스 모델. 플랫폼이 허락하는 순간 스레드까지. | nogil과 WASM 스레드가 upstream에 착륙하는 순간 프로세스 어휘를 바꾸지 않은 채 공유 메모리 스레딩을 받는다 |
| 살아남는 디스크 | 9.0 | 상태 커널이 내용 주소 세대를 쓰기 순서 법 아래 OPFS에 커밋한다: 변조된 blob은 적발되고, 파손된 HEAD는 첫 부팅을 위장하지 않고 PREV로 후퇴하며, 저널은 pack되고, 바뀐 것이 없는 재커밋은 0바이트를 쓴다. 브라우저 컴퓨터가 프로세스 재시작 뒤 복원하는 것이 바로 그 내구 세대다. 디스크 위 포맷은 이제 하나다: 구 봉투 reader를 일몰했고, 옛 버전이 쓴 파일은 반쯤 읽히는 대신 무엇을 해야 하는지와 함께 거부된다. | 진짜 파일시스템의 보장을 가진 내구성: 찢어진 커밋 없음, 조용한 손실 없음, 포맷은 하나. | OPFS quota 축출을 찢어진 커밋만큼 명시적으로 다룬다: 지금 지속성은 best-effort 요청이고 거절은 브라우저 휴리스틱이다 |
| 탭보다 오래 사는 머신 | 9.7 | 인자 없는 `open()`이 휘발 kernel 대신 이름 있는 OPFS Machine으로 들어간다. 명령과 commit은 직렬화되고, 완료된 run은 heap, `/home/web`, 전달된 outcome을 실은 generation에 도달한 뒤 settle된다. 설치 package는 수동 commit 없이 그 상태를 cold reopen한다. leader 선출이 동일 origin tab을 가로지르고 반복 request ID는 durable record로 답하며 commit 실패는 non-retryable outcome-unknown이다. 일반 follower는 끊긴 leader heap의 이식성을 증명할 수 없으므로 in-flight failover는 여전히 `PYPROC_RPC_OUTCOME_UNKNOWN`이다. 전체 규칙은 [durable RPC 상태표](docs/consuming/contract.md#durable-rpc-state-table-normative)다. | 탭이 하나라도 열려 있는 동안 머신은 계속 살고, 받아들인 명령은 정확히 한 번 수렴한다. | fenced portability fact를 일반 follower에게 전달해 outcome-record 경로를 안전하게 쓰게 한다. proxy-bearing heap은 outcome-unknown으로 남는다 |
| 들고 다니는 머신 | 9.0 | `.pymachine`과 `.webmachine`은 서명된 내용 주소 봉투다: 서명과 신뢰 공개키 검증, 바이트 변조 거부, 레이아웃 독립 재파싱, 워커 사이 부활, 문맥을 건너는 이식은 조용히 열리는 대신 `h0` 불일치로 거부된다. 제품 게이트가 서명 이미지를 내보내고 새 브라우저 프로필에서 명시적 서명자 신뢰 화면을 거쳐 가져온다. 이식성은 아직 같은 엔진과 같은 매니페스트를 전제하고, JS 프록시 핸들은 이미지를 건너지 못해서, 프록시를 심는 표면은 부활 커널의 프록시 경로 전부를 오염시킨다. packet 장치와 권한 감옥은 값 경계로 옮겨 부활 뒤에도 살아나는 것을 CI가 물지만, 블로킹 표면(input() 뒤의 syscall 다리, socket, GPU)은 구조상 옮길 수 없어 이미지를 뜰 때 명시 승인 없이는 거부된다. | 머신 파일이 검증된 서명자에게서 왔다면 엔진 버전을 건너서도 호환 프로필 어디서나 열린다. | 물질화 뒤 핸들을 다시 묶는 엔진 층 길이나 핸들 없는 블로킹 기전을 찾아, input()을 쓴 머신도 이식 가능한 이미지를 내게 한다; 매니페스트 정확 일치를 요구하는 대신 협상해서 엔진 버전을 건너 이미지를 연다 |
| guest를 부팅하는 컴퓨터 | 9.0 | Web Machine host가 `createWebComputer` 뒤에서 이 패키지 안에 실려 나가고, Python guest와 x86 Linux guest가 같은 lifecycle, 장치, 세대, 봉투 계약을 소비한다. host 계약, dual-engine, owner 승계, 내구 세대, guest 네트워크 probe가 CI에서 돌고, 제품 게이트는 두 guest를 부팅해 브라우저 프로세스 재시작을 견디고 둘을 한 서명 이미지로 옮긴다. x86 레인은 실제 Python과 Linux guest를 한 switch에 올린다. Linux가 Python을 ping하고 Python이 보낸 Ethernet frame이 Linux NIC 수신 계수를 올리며, 양방향이 한 세대 commit과 process cold restore 뒤에도 살아난다. guest를 자기 워커에 얹는 길도 있어 CPU 바운드 guest가 다른 guest를 멈추지 않는다. 프레임을 캔버스에 올리는 경로도 CI가 문다. 기본 Linux image는 프로젝트 재현 빌드이며 exact source, 전체 legal material, SBOM, config, 독립 빌드 영수증을 함께 제공하는 release에 hash 고정된다. | 어댑터를 가진 guest는 무엇이든 브라우저 컴퓨터에서 부팅하고, 그 이미지는 host만큼 자유롭게 나간다. | 5단: memory64를 채택해 큰 guest가 가장 먼저 부딪히는 모듈별 힙 상한을 올린다; 7단: Python과 Linux 옆에 Node guest를 부팅해 JavaScript CLI 도구를 이 컴퓨터의 거주자로 만든다 |
| 엔진보다 오래 사는 프리미티브 | 7.0 | 비 Pyodide 레인이 브라우저에서 WASI 위 CPython 3.14.6을 부팅하고, 체크포인트, 시간여행, 반복 분기, 순수 파이썬 wheel 설치를 같은 계약으로 통과한다. 프리미티브가 Pyodide 내부가 아니라는 증명이 이것이다. 그 레인에는 `dlopen`이 없어 동적 C 확장을 못 싣고, 값 다리는 JSON뿐이다. | 모든 프리미티브가 어떤 CPython-on-WebAssembly 엔진에서도 돌고, 패키지 도달 범위도 같다. | WASI 격차를 닫는다: C 확장을 위한 동적 링킹(cpython#142234)과 JSON만이 아닌 값 다리 |
| 브라우저 방식의 네트워크 | 8.0 | 커널 내 ASGI 서버가 파이썬으로 `fetch`에 답하고 동시 요청이 서로를 덮지 않는다. 가상 오리진이 설치 패키지에서 그것을 서빙하고, `urllib`이 syscall 다리로 진짜 HTTP를 하며, 권한 감옥이 host별 `connectSrc`를 가른다. Python-to-Python 통신은 무자산 레인이, 실제 교차 엔진 경로는 x86 레인이 증명한다. Linux가 Python을 ping하고 Python이 보낸 Ethernet frame이 process cold restore 전후 Linux NIC에 도착한다. 아웃바운드 raw 소켓은 여전히 이 패키지가 배송하지 않는 WS-TCP 릴레이를 요구하지만, 밀폐 레인이 저장소 안 릴레이와 로컬 TCP 오리진을 띄우고 Python `urllib`로 바이트를 읽는다. | 파이썬 네트워크 코드가 고쳐지지 않고 돌고, 읽는 사람이 알아야 할 것은 릴레이 경계 하나뿐이다. | 1단: 탭 안에서 TLS를 종단해 릴레이가 읽지 못하는 암호문만 나르게 하고 신뢰를 요구하지 않게 한다; 2단: WebSocket 하나가 소켓 여럿을 나르게 한다(Wisp 계열 릴레이 강화); 3단: 표면 동결이 풀리는 대로 WebRTC 위에 탭 사이 직접 전송을 opt-in subpath로 연다; 4단: Direct Sockets가 진짜 인바운드 listen을 여는 날을 위해 Isolated Web App 패키징 레인을 준비해 둔다 |
| 로컬 파이썬이 하는 전부 | 7.5 | Pyodide의 `dlopen`이 이미 네이티브 C 확장 wheel(numpy, pandas, scipy 등)을 싣고, 패키지가 캐시에서 설치되고, 머신 안에서 `%pip`과 `freeze`가 돌고, WASI 레인이 순수 파이썬 wheel을 설치한다. 없는 것은 롱테일이다: 임의 패키지는 게시된 pyemscripten wheel을 요구하고, numpy에는 SIMD 빌드가 없고, 스레딩은 upstream 대기이며, GPU 레인은 헤드리스 어댑터가 없어 CI가 무는 것은 통합 경로가 컴파일에 넘기는 WGSL의 바이트 동일성이지 GPU에서의 결과가 아니다. | 로컬 인터프리터에서 도는 것은 무엇이든 탭에서 돌고, 그 속도에 변명이 필요 없다. | 얇은 곳의 패키지 도달 범위를 넓힌다: 롱테일의 pyemscripten wheel과 SIMD numpy 빌드; 6단: 일하는 머신이 전제하는 도구(git·ripgrep 급)를 wasm 거주자로 안에 들여 셸 호출이 진짜가 되게 한다 |
| 안정 커널 표면 하나 | 8.5 | 공개 표면은 명사 하나와 그 동사들이고 구조, 타입, 설치 package gate, 실제 브라우저 실행이 고정한다. packed artifact가 root와 subpath import, 동봉 선언, worker emit, runtime asset을 package 내부 경로 없이 증명한다. | 지원하는 모든 import 패턴이 gate 아래 있고 deep path가 없는 exact-version 공개 표면과 동봉 타입 계약 하나. | 지원하는 모든 공개 import 패턴을 installed-package와 browser gate 아래 둔다; 8단: 브라우저 밖에 남는 몫을 위해 로컬 에이전트 경계(페어링·인가·능력 목록)를 한 번 명세한다 |
| 검증 가능한 공급망 | 8.8 | 게시된 무의존 engine CLI가 catalog에 pin된 boot anchor와 lock이 등재한 package 354개를 전수 검증한 뒤 same-origin에 배포하고, runtime은 script SRI와 fetch된 core를 다시 검증하며 브라우저 gate는 제3자 요청 0을 증명한다. 자산 CLI는 worker와 Service Worker graph를 별도로 봉인하고 나쁜 hash는 spawn을 거부한다. npm은 OIDC provenance로 게시되고 Machine image는 import 전에 서명자를 검증한다. 기본 Linux guest는 독립 빌드 둘의 byte-identical 결과와 source, legal material, SBOM, config, manifest를 hash-pin된 project release에 둔다. | 실행되는 모든 바이트가 남이 다시 빌드하고 검증할 수 있는 출처로 이어진다. | 남은 firmware와 emulator 자산도 같은 프로젝트 통제 release 규율로 재현한다 |

축 원장은 [tests/northStar.mjs](tests/northStar.mjs)다: 축마다 그 뒤에 선 실행 가능한 산출물을 등재하고, 등재된 게이트가 사라지거나 어떤 러너도 열지 않거나 CI에서 돌지 않으면 구조 게이트가 RED가 된다. 위 표는 그 원장에서 렌더한 것이라 문서를 고쳐서 점수를 올릴 수 없다. 각 축이 무엇을 뜻하고 무엇이 그 점수를 움직이는지는 [제품 방향](docs/product/vision.md#north-star-axes)에 있다.

### 천장이 다음에 움직이는 곳

남은 거리는 운명이 다른 두 벽이다. 전송 벽(탭이 인바운드 연결을 받는 것)은 열리는 중이라 순서대로 오른다. 네이티브 벽(웹 콘텐츠가 네이티브 프로세스를 띄우는 것)은 웹 자체의 설계상 열리지 않으니, 로컬 머신만 돌리는 것은 대신 안으로 옮긴다. 모든 단은 자기가 움직이는 축을 밝힌다:

1. 탭 안에서 TLS를 종단해 릴레이가 읽지 못하는 암호문만 나르게 하고 신뢰를 요구하지 않게 한다 (움직이는 축: 브라우저 방식의 네트워크)
2. WebSocket 하나가 소켓 여럿을 나르게 한다(Wisp 계열 릴레이 강화) (움직이는 축: 브라우저 방식의 네트워크)
3. 표면 동결이 풀리는 대로 WebRTC 위에 탭 사이 직접 전송을 opt-in subpath로 연다 (움직이는 축: 브라우저 방식의 네트워크)
4. Direct Sockets가 진짜 인바운드 listen을 여는 날을 위해 Isolated Web App 패키징 레인을 준비해 둔다 (움직이는 축: 브라우저 방식의 네트워크)
5. memory64를 채택해 큰 guest가 가장 먼저 부딪히는 모듈별 힙 상한을 올린다 (움직이는 축: guest를 부팅하는 컴퓨터)
6. 일하는 머신이 전제하는 도구(git·ripgrep 급)를 wasm 거주자로 안에 들여 셸 호출이 진짜가 되게 한다 (움직이는 축: 로컬 파이썬이 하는 전부)
7. Python과 Linux 옆에 Node guest를 부팅해 JavaScript CLI 도구를 이 컴퓨터의 거주자로 만든다 (움직이는 축: guest를 부팅하는 컴퓨터)
8. 브라우저 밖에 남는 몫을 위해 로컬 에이전트 경계(페어링·인가·능력 목록)를 한 번 명세한다 (움직이는 축: 안정 커널 표면 하나)

순서가 왜 이 순서인지와 우선순위를 재배열할 외부 트리거는 [제품 방향](docs/product/vision.md#where-the-ceiling-moves-next)에 있다. 단은 축 원장에 등재되므로, 자기가 움직인다고 주장한 점수에서 떨어져 나갈 수 없다.

## 개발

```bash
npm test              # Node 구조 / 린트 게이트 (runtime npm 의존성 없음)
npm run test:installed # 설치 패키지 브라우저 게이트
npm run test:browser  # headless Chromium 런타임 게이트: 부팅 / 리액티브 / fork / map (runtime npm 의존성 없음)
npm run serve         # 수동 검증·벤치용 COOP/COEP 정적 서버
```

WASM 런타임이라 진짜 검증은 브라우저에서만 한다. `test:browser`는 repo 공개 표면을 보고, `test:installed`는 격리 브라우저 fixture에서 설치된 npm 패키지와 Service Worker + `VirtualOrigin` URL 동선을 검증한다. 둘 다 CI에서 돈다. 지속되는 제품·운영 결정은 [docs/](docs/README.md), 실행 정본은 `src/`와 `tests/`, 과거 결정은 git 이력, 기여 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있다.

## 라이선스

[Mozilla Public License 2.0](LICENSE), 밑의 엔진 Pyodide와 같은 라이선스. Copyright 2026 eddmpython.

MPL-2.0은 파일 단위 카피레프트라 실질 조건은: **임베드는 자유**(비공개 앱에 pyproc을 import하고 배포·판매해도 자기 코드는 자기 것); **pyproc 자체의 포크는 공개 유지**(이 라이선스가 덮는 파일을 수정하면 그 파일 소스를 MPL-2.0으로 공개); **특허 허여**(기여자가 자기 기여분에 대해, 2.1(b)절). 기여는 별도 CLA 없이 같은 라이선스로 수용된다(inbound = outbound). [CONTRIBUTING.md](CONTRIBUTING.md) 참조.
