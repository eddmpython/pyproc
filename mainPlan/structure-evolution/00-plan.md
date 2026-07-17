# 00 - 전수조사와 목표 구조

## 1. 전수조사 결과

src 42파일 5,838줄 + 검증 트리 153파일 전수. 게이트가 못 보던 다중행 import까지 세어
계산했다(그 사각 자체가 첫 발견이었다: `수리: 구조 게이트가 다중행 import를 보게 한다`).

### 1.1 구조: 합성 루트가 반쪽이다 (근본 원인)

| # | 사실 | 근거 |
|---|---|---|
| S1 | `runtimeApi.js`는 registry를 설치하는 합성 루트인데 Layer 0(`src/runtime/`)에 산다 | `runtimeApi.js:6,12` |
| S2 | 그래서 `runtime -> capabilities`와 `capabilities -> runtime`을 게이트가 동시 승인한다 = 폴더 2-순환. CLAUDE.md 코드 규칙이 금지한 것 | `run.mjs:972-974` + `:975-986` |
| S3 | `session.js`는 registry 설치 뒤에만 성립한다(`rt.enableReactive()` 소비). 즉 합성 루트 **위**인데 Layer 1로 분류돼 있다 | `session.js:19,65` |
| S4 | `envManager.js`는 `enable*`를 **한 번도 호출하지 않으면서** 합성 루트를 import한다 = 불필요한 위로 edge | `envManager.js:9`, `enable[A-Z]` 검출 0 |
| S5 | `kernelElection.js`는 `session.js`를 부팅하므로 session과 같은 층인데 `processOs/`에 있다 | `kernelElection.js:150` |

### 1.2 중복과 결함

| # | 사실 | 근거 |
|---|---|---|
| C1 | **실제 결함**: `syscallBridge`가 worker 프로토콜을 손수 재구현. `rpcChannel`을 쓰지 않고 `reqId`를 안 보내며(워커가 `undefined`를 되싣음) 워커가 읽지 않는 `taskId`를 보낸다 | `syscallBridge.js:100-116` vs `rpcChannel.js:15` |
| C2 | `base64FromBytes` 5벌(폴백/청크 처리 제각각), `sha256Sri` 3벌, SRI 파서 3벌, SRI 검증 3벌 | `assets.js:64,74,82` / `runtime.js:18,24,52` / `pyprocSw.js:97,103,109` |
| C3 | `sha256Hex` 4벌(그중 2벌은 바이트 동일) | `machineJournal.js:36` / `session.js:90` / `kernelElection.js:44` / `envManager.js:13` |
| C4 | 힙 성장 루프 3벌(파이썬 소스까지 동형) + `random.seed()` 재시드 2벌(문자열 완전 동일) + `_toSab` 3벌 | `session.js:386` / `machineJournal.js:479` / `worker.js:130` |
| C5 | `runtime.js`가 `assets.js`의 SRI 검증을 중복 구현하며 import하지 않는다 | `runtime.js:24-54` |
| C6 | 델타 unpack(역연산)이 `heapDelta`에 없어 인라인 2벌 | `session.js:404` / `worker.js:151` |
| C7 | 브라우저 실행 루프 5벌(`findBrowser`는 SSOT인데 spawn 루프는 복제) | `run.mjs` / `examples.mjs` / `speedBench.mjs` / `productConsumer.mjs` / `mcpSandboxServer.mjs` |
| C8 | `productConsumer.mjs`가 `createStaticServer`를 쓰지 않고 MIME 표/COOP 헤더/경로 탈출 방어/404를 자체 복제 | `productConsumer.mjs:53` vs `serve.mjs:35` |

### 1.3 다중 책임 파일

| 파일 | 줄 | 한 파일에 든 변경 이유 |
|---|---|---|
| `machineJournal.js` | 558 | 커밋 정책 / CAS blob store / pack 포맷 / GC(prune) / 복원 |
| `session.js` | 413 | 결정적 부팅 / .pymachine 봉투 포맷 / ECDSA 서명(10함수 110줄) / 입력 검증 / 저장·복원 |
| `pyProc.js` | 391 | 프로세스 수명주기 / **수치 커널(26%: mapArray+matmul+MATMUL_FN)** / fork / map 스케줄러 |
| `gpuCompute.js` | 380 | WGSL 셰이더 5종(31%) / 파이프라인 캐시 / 배열 핸들 / 파이썬 FFI 부트스트랩 |

### 1.4 계약이 코드가 아닌 것

| # | 사실 | 근거 |
|---|---|---|
| E1 | **EngineContract가 src에 선언 자체가 없다.** 주석과 attempts README에만 산문으로 존재하고 d.ts는 `constructor(engineOrPyodide: unknown)` | `pyodideEngine.js:1` / `index.d.ts:885` |
| E2 | **1,257줄 d.ts(선언 107개)를 타입체크하는 게이트가 0.** 문자열 검사만 있다 | 저장소 전체에 tsc 없음 |
| E3 | 파일/폴더명 camelCase 규칙에 기계 게이트가 없다([네이밍] 절은 파일 **내용**의 식별자만 본다) | `run.mjs:293-306` |
| G1 | 자산 매니페스트 문서 블록이 존재하지 않는 파일을 계약으로 게시 중(`sharedKernelHost`) | `docs/consuming/contract.md:87` |
| G2 | 링크 게이트는 마크다운 링크만 본다. 코드블록 산문 속 경로는 어느 게이트도 안 잡는다 | `run.mjs:883-912` |

### 1.5 검증 트리

| # | 사실 |
|---|---|
| F1 | `tests/webMachine/`은 계층 분리(contracts/fixtures/browser)인데 `tests/browser/`는 18파일 6종이 평면 동거 = 한 저장소 두 기준 |
| F2 | `tests/run.mjs` [구조] 절 하나가 파일의 35.6%(503줄)이고 그중 18검사가 Web Machine/Web Computer 전용(별도 검증 트리가 이미 있다) |
| F3 | 절 번호 주석이 어긋남: `3.7)`이 2번, `3.8)`이 `3.6)`보다 앞 |

## 2. 목표 구조

```text
src/
├─ runtime/       L0 엔진 core + 교차 관심사. 아무것도 import하지 않는 바닥
├─ capabilities/  L1 능력. (rt, cfg)를 받아 런타임에 얹히는 것들
├─ composition/   L2 조립. core에 능력 registry를 설치하고 public 표면을 낸다
├─ session/       L3 세션. 조립된 런타임을 부팅해 머신 하나의 수명주기와 단독 소유권을 만든다
└─ processOs/     L3 프로세스. 워커 = 프로세스, 스냅샷 = 이미지
```

이동은 **4파일**뿐이다.

| 파일 | 현재 | 이동 후 | 이유 |
|---|---|---|---|
| `runtimeApi.js` | `runtime/` | `composition/` | 합성 루트는 아무도 import하지 않는 꼭대기여야 한다. 이 한 건이 순환 1개를 없앤다 |
| `runtimeBindings.js` | `capabilities/` | `composition/` | registry는 조립이지 능력이 아니다. 능력 8개를 아는 유일한 파일 |
| `session.js` | `capabilities/` | `session/` | `rt.enableReactive()` 소비 = 설치 뒤에만 성립 = 합성 루트 위 |
| `kernelElection.js` | `processOs/` | `session/` | `bootSession`으로 세션을 부팅한다. "누가 그 Session을 소유하는가"가 전부 |

`envManager.js:9`는 이동 없이 import 대상만 `runtime/runtimeApi.js` -> `runtime/runtime.js`로
고친다. `enable*` 호출이 0이고 쓰는 값 3개(`DEFAULT_INDEX`/`ensureEngineScript`/`Runtime`)가
전부 `runtime.js` 원산이므로 합성 루트를 경유할 이유가 없다.

### 새 레이어 규칙

**import는 아래로만. 위로 향하는 module edge 0. 폴더 순환 0.**

L0 `runtime` <- L1 `capabilities` <- L2 `composition` <- L3 `session`/`processOs`.

정확 승인 목록에 남는 유일한 항목: `capabilities/syscallBridge.js -newURL-> processOs/worker.js`.
이건 ESM import가 아니라 Worker 자산 URL이라 모듈 그래프에 들어가지 않는다(게이트의 순환
검사도 `kind`로 이미 배제한다).

`capabilities -> runtime` 정확 목록 10건은 **유지한다.** 그건 예외가 아니라 coupling budget
래칫이다: 능력이 런타임 내부에 새로 손대면 심사에 걸리게 하는 장치이고, 방향 자체는 합법이다.
없애면 집행이 약해진다. 대신 이름과 주석을 정직하게 바꿔 "예외 목록"이 아니라 "예산"임을
드러낸다. 이번 재편이 없애는 것은 **순환을 승인하던 항목**(`runtime -> capabilities`)이다.

## 3. 기각한 설계 (실측 근거)

### 3.1 도메인 이름 10폴더 (machine/ server/ syscalls/ env/ gpu/ shell/ wasi/ ...)

"트리가 정체성을 말하게 한다"는 목표로 먼저 설계했다. 실측이 기각했다.

- **순환 1 -> 9.** 합성 루트를 `runtime/`에 둔 채 아래를 6폴더로 쪼개면, composition이 아래로
  뻗는 edge 전부가 순환을 닫는다(`runtime -> composition -> machine -> runtime` 등 9개).
  고치려던 병을 9배로 늘린다.
- **`machine/`은 어휘 규칙이 막는다.** [glossary](../../docs/product/glossary.md)가
  "Session을 Machine으로 개명하지 않는다. 아래 플랫폼 계층이 Machine 어휘를 선점했다"고
  명시한다. `machine/`에 session.js를 넣는 것이 정확히 그 개명이다.
- **핵은 폴더가 될 수 없다.** `reactive.js`는 registry가 **생성**하므로 합성 루트 아래고
  (`runtimeBindings.js:22`), `session.js`는 `rt.enableReactive()`를 **소비**하므로 합성 루트
  위다(`session.js:65`). 둘을 한 폴더에 담으면 순환이 수학적으로 강제된다. 제품 기둥은
  세로축(가치)이고 폴더는 가로축(의존 방향)이다. 기둥에 폴더를 달라는 요구는 범주 오류이고
  9개 순환이 그 청구서였다.
- 기둥의 가시성은 이미 4곳이 담당한다: CLAUDE.md 정체성 절, capabilityMatrix 행,
  README feature status, `"./reactive"` subpath. 다섯 번째는 필요 없다.

### 3.2 wasi를 `src/wasi/`로 승격

- [클린 아키텍처](../_done/web-machine-platform/04-clean-architecture-and-code-rules.md)가
  "WASI adapter는 제품 지원 범위가 확정될 때 추가한다"고 적었다. capabilityMatrix는 wasi를
  Research preview로 판정했다 = 미확정. 선례가 그대로 적용된다.
- `engines/`는 사고가 아니라 목적지다. 등재된 승격 경로는 "EngineContract에 WasiEngine +
  `boot({engine})` 옵션"이고, `tests/attempts/engineContract`/`enginePort`가 **활성 캠페인**이다.
  폴더로 결론을 선점하는 것은 졸업 게이트 역행이다.
- 대가가 값어치 없다: Research preview 하나를 위해 Stable 표면(`assets.js:31` 자산 매니페스트
  경로)을 바꾸고, 오늘 없는 `wasi -> runtime` 교차 레이어 승인을 **새로 만든다**. 예외를
  줄이자면서 예외를 추가한다.

### 3.3 heapDelta를 핵 폴더로

파일이 스스로 반대한다. `heapDelta.js:6-7`: "워커(processOs/worker.js)도 이 파일을
import하므로 여기의 import는 0개를 유지한다(워커 자산 graph 최소화 계약)". 실측 매니페스트에서
heapDelta의 유일한 role은 `processWorker`다. 옮기면 워커 자산 graph가 2폴더에서 3폴더로 늘고,
`worker.js`가 나란히 import하는 `memoryLayout`(PAGE_SIZE + 페이지 산술 = 한 개념)과 갈라진다.
두 레이어의 두 소비자가 만나는 지점 = Layer 0의 정의다.

### 3.4 `shell/`(terminal + jobControl)

거짓 공통화다. `terminal.js`는 `new Terminal(rt, cfg)` = L1 런타임 플러그인이고,
`jobControl.js`는 `new PyProc(...)`으로 L2 풀을 직접 소유한다. **상호 import 0**이고 `push()`는 이름만
같지 반환 계약이 다르다. 제품 SSOT는 정반대로 묶는다: capabilityMatrix는
{Terminal, SyscallBridge} 한 행, {MachineContainer, JobControl} 한 행이다.

### 3.5 기타

| 제안 | 기각 근거 |
|---|---|
| `index.d.ts`를 `types/` 폴더로 분해 | 절 재정렬 + 주석으로 같은 가독성을 훨씬 싸게 얻는다 |
| 파이썬 소스를 `.py` 파일로 분리 | 빌드 단계가 없어 import 불가이고, 네이밍 가드가 `.py`를 안 봐서 camelCase 강제가 깨진다(`wasiReplDriver.js:1-5`가 이미 명문화) |
| `tests/run.mjs` 전면 분해 | 의존성 0 단일 진입점의 미덕이 있다. 제품 전용 18검사 이관만으로 35.6% 비대가 해소된다 |
| `capabilities -> runtime` 10건 삭제 | 예외가 아니라 coupling budget이다. 삭제 = 집행 약화 |

## 4. 단계

| # | 단계 | 계약 |
|---|---|---|
| 0 | 게이트 사각 수리 | 다중행 import를 보게 한다. 이게 없으면 이후 구조 검증이 부분맹 (완료: `c878880`) |
| 1 | 이니셔티브 개설 | 이 문서 |
| 2 | 의존 그래프 정화 | 4파일 이동 + envManager 1줄. **폴더 순환 1 -> 0, 위로 module edge 2 -> 0** |
| 3 | 규칙 = 집행 | CLAUDE.md 레이어 절, 게이트 승인 목록, docs를 한 문장으로. 파일명 게이트 신설 |
| 4 | C1 결함 수리 | syscallBridge -> rpcChannel 수렴 |
| 5 | C2/C3/C5/C6 | `runtime/contentDigest.js` 단일 정본 + `heapDelta.unpackPages` |
| 6 | C4 | 힙 성장 루프 3벌 -> 1 |
| 7 | C7/C8 | 브라우저 spawn 루프 5벌 -> 1, 정적 서버 복제 제거 |
| 8 | 다중 책임 분해 | 558/413/391/380 -> 변경 이유별 |
| 9 | 계약을 코드로 | EngineContract 타입 선언 + d.ts 타입체크 게이트 |
| 10 | 검증 트리 | `tests/browser/` 계층화, 제품 전용 18검사 이관, 문서 표류 수리 |

## 5. 게이트

각 커밋 전 `npm test`. 런타임 동작을 건드리는 커밋은 `npm run test:browser`도.
자산/SW/표면을 건드리는 커밋은 `test:package` + `test:consumer`.

2단계의 합격 기준은 특별하다: **이동만 했으므로 전 게이트 GREEN이 곧 "동작을 바꾸지 않았다"의
증거**다. 여기에 폴더 순환 0을 강제하는 게이트가 3단계에서 붙는다.

## 6. 롤백

각 단계가 독립 커밋이고 `git revert` 가능하다. 2단계는 `git mv` 기반이라 rename 보존
(`git show --stat`의 `R100`이 순수 이동의 증거)이고, 되돌려도 공개 표면에 영향이 없다.
