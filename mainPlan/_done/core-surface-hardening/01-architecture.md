# 01. 아키텍처

레이어 배치 원칙: 공통 프리미티브는 Layer 0(`src/runtime/`)에 산다. 상위(capabilities,
processOs)는 Layer 0을 import할 수 있고 역방향은 금지(기존 레이어 규칙 그대로).

## 1. 오류 계약: PyProcError 하나

### 위치와 형태

`src/runtime/errors.js` (Layer 0, 의존성 0):

```js
export class PyProcError extends Error {
  constructor(code, message, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "PyProcError";
    this.code = code;                       // PYPROC_* 문자열. 프로그램적 분기의 축.
    this.retryable = opts.retryable === true; // 재시도 가능성(outcome unknown은 항상 false)
    if (opts.context) this.context = opts.context; // 부가 정보(pid, path, pyExcType 등)
  }
}
export function toErrorPayload(error) { ... }   // postMessage 경계용 { error, code, retryable, pyExcType }
export function fromErrorPayload(payload, fallbackCode) { ... } // 경계 수신측 복원
```

코드 카탈로그(이 표가 정본, d.ts의 union과 일치해야 한다):

| 코드 | 의미 | retryable |
|---|---|---|
| PYPROC_ENV_UNSUPPORTED | COI/JSPI/SAB 등 환경 전제 미충족 | false |
| PYPROC_INPUT_INVALID | 공개 API 입력 형식 위반 | false |
| PYPROC_BOOT_FAILED | 엔진/워커 부팅 실패 | true |
| PYPROC_ASSET_INTEGRITY | 자산 SRI/manifest 검증 실패 | false |
| PYPROC_MACHINE_FORMAT_INVALID | .pymachine/저장 메타 형식 위반 | false |
| PYPROC_MACHINE_INTEGRITY | .pymachine 봉투 해시/서명 검증 실패(손상 또는 변조) | false |
| PYPROC_MACHINE_UNTRUSTED | trust 게이트 미승인 | false |
| PYPROC_REPLAY_MISMATCH | cp0/h0 리플레이 결정성 불일치 | false |
| PYPROC_HEAP_GROW_FAILED | 파이썬 할당 경로 힙 성장 실패 | false |
| PYPROC_CHECKPOINT_PRUNED | prune/dispose된 노드 복원 시도 | false |
| PYPROC_PROCESS_UNAVAILABLE | pid/cid 부재, dead, 준비 안 됨 | false |
| PYPROC_FORK_UNAVAILABLE | replay 풀 아님 등 fork 전제 미충족 | false |
| PYPROC_WORKER_CRASHED | 워커 크래시/메시지 역직렬화 실패 | true |
| PYPROC_WORKER_TASK_ERROR | 워커 안 파이썬 실행 예외 | false |
| PYPROC_TASK_TIMEOUT | map 태스크 타임아웃 | true |
| PYPROC_POOL_EXHAUSTED | 레인 전멸로 미실행 태스크 발생 | true |
| PYPROC_JOURNAL_CORRUPT | 저널 blob/세대 파손 | false |
| PYPROC_JOURNAL_IO | 저널 저장소 IO 실패(커밋 실패 관측 채널) | true |
| PYPROC_RPC_OUTCOME_UNKNOWN | 전송 후 결과 불명(자동 재실행 금지) | false |
| PYPROC_LEADER_UNAVAILABLE | 리더 부재/타임아웃 | true |
| PYPROC_SPLIT_BRAIN | 같은 epoch에 리더 둘 | false |
| PYPROC_LEADER_LOCK_FAILED | leader lock 실패 | true |
| PYPROC_RPC_ACTION_INVALID | 알 수 없는 RPC action | false |
| PYPROC_PARTICIPANT_LEFT | participant 이탈 | false |
| PYPROC_KERNEL_EXECUTION_ERROR | 리더 실행 일반 오류(레거시 기본값) | false |
| PYPROC_GPU_UNAVAILABLE | GPU 어댑터/디바이스 부재 | false |
| PYPROC_INTERNAL | 그 밖의 내부 불변식 위반 | false |

설계 규칙:

1. src의 모든 throw는 PyProcError(또는 그 인스턴스 재던짐)다. `throw new Error(`는
   구조 게이트가 차단한다(tests/run.mjs 신설 검사, 대상 src/**/*.js).
2. 기존 kernelElection의 kernelError(code, retryable)와 machineJournal의
   JournalCorruptionError는 PyProcError로 승계한다. 코드 문자열은 전부 유지한다
   (PYPROC_RPC_OUTCOME_UNKNOWN 등 기존 게이트가 검사하는 값 불변).
3. 입력 검증 예외는 PYPROC_INPUT_INVALID로 수렴하되 메시지는 기존 문구를 유지한다
   (게이트/문서가 메시지에 결박된 곳이 있으면 메시지 우선).

### 워커 경계

worker.js/machineWorker.js의 오류 응답은 `toErrorPayload(err)`를 싣는다. Pyodide의
PythonError는 `err.type`에 파이썬 예외 클래스명이 온다: payload.pyExcType으로 운반한다.
수신측(pyProc.js 라우터, machineContainer.js 라우터)은 `fromErrorPayload`로 PyProcError를
복원한다. jobControl의 잡 종료 분류는 문자열 includes를 버리고
`error.context.pyExcType`(KeyboardInterrupt/SystemExit) 기반으로 바꾼다.

### 저널 관측 채널

MachineJournal에 `cfg.onStatus(event)` 콜백을 추가한다.
event = `{ kind: "commit" | "commitError" | "recover" | "pack", ...상세 }`.
유휴 커밋 실패는 onStatus({ kind: "commitError", error })로 관측 가능해지고, onStatus가
없으면 기존 console.warn을 유지한다(동작 보존). 실패 오류는 PYPROC_JOURNAL_IO로 감싼다.

## 2. 리액티브 soundness

### 컨트롤러 단일화 (memoize)

`runtimeBindings.js`의 enableReactive를 Runtime 인스턴스당 1개로 memoize한다:

```js
enableReactive: { value() {
  return (this[REACTIVE_CONTROLLER] ||= new ReactiveController(this));
} },
```

근거: 다중 컨트롤러는 서로의 복원을 경계 가드로 볼 수 없어 조용한 오염이 된다.
Terminal(timeTravel)과 bootSession이 이제 한 나무를 공유한다. Session._collectDelta는
hashes[0] 즉 cp0 대비라 마크 공존과 무관하게 안전하고, Terminal의 _marks는 자기 인덱스만
참조하므로 공유 나무에서도 성립한다.

### restore의 경계 기록

Runtime에 `noteStateMutation()`(execSeq 증분)을 추가하고, ReactiveController의
restore/restoreLive가 힙을 쓴 뒤 이를 호출한 다음 `_seqAt = rt.execSeq`로 자기 경계를
닫는다. 효과: 컨트롤러 밖의 관찰자(저널의 유휴 감시, 미래의 다른 소비자)가 복원을
상태 변이로 본다. 저널은 복원 뒤 유휴가 지나면 복원된 상태를 커밋한다(durable 의미론상
올바른 방향). 이 동작 변화는 브라우저 게이트에 시나리오로 고정한다.

### PyProxy 구멍의 정직한 계약

getGlobal이 준 라이브 PyProxy 호출은 힙을 바꾸지만 execSeq가 오르지 않는다. 값싼 완전
해결은 없다(모든 프록시 호출 계측은 비용/침습 과대). 계약으로 다룬다:

1. `ReactiveController.markDirty()` 신설: 소비자가 외부 변이를 알리는 신호.
   구현 = rt.noteStateMutation() 호출(다음 restoreLive가 자동 재해시 경로로 승격).
2. d.ts와 README에 경계 계약을 명시한다: PyProxy로 파이썬을 호출했다면 markDirty()
   또는 opts.rehash 없이 restoreLive의 즉시 경로를 신뢰하지 마라.

### Checkpoint 핸들 (3요소 의식 제거, additive)

checkpoint()가 sp(스택 포인터)를 노드에 함께 저장하고(`this.sps[]`), 반환 객체에
`restore(opts)` 메서드를 얹는다:

```js
const cp = reactive.checkpoint();   // { index, changedPages, deltaBytes, kind, parent, sp, restore }
...실행...
reactive.checkpoint();              // 경계 닫기(기존 계약 유지)
cp.restore();                       // == reactive.restoreLive(cp.index, cp.sp)
```

restoreLive(j, savedSP, opts)와 restore(j, savedSP)의 savedSP는 null/undefined 허용으로
완화한다(생략 시 노드 저장 sp 사용). 기존 명시 sp 호출은 전부 그대로 동작한다(additive).
선례: session.js의 meta.sp 저장이 정확히 이 패턴이다.

### 수명주기: pruneTo / dispose

- `pruneTo(j)`: 루트에서 j까지의 부모 체인 밖 노드의 델타와 해시를 해제한다(배열 길이는
  유지, 내용만 null = 인덱스 안정). 해제된 노드로의 restore/restoreLive는
  PYPROC_CHECKPOINT_PRUNED로 던진다. liveIdx가 경로 밖이면 PYPROC_INPUT_INVALID.
- `dispose()`: base/deltas/hashes 전부 해제. 이후 모든 호출은 PYPROC_CHECKPOINT_PRUNED.
- storageMB()는 해제 노드를 건너뛴다.
- MachineJournal에 `cfg.pruneAfterCommit`(기본 false)을 추가: true면 커밋 직후
  `reactive.pruneTo(liveIdx)`로 나무를 라이브 경로만 남긴다. 공유 나무(Terminal 마크)와
  충돌할 수 있으므로 기본 꺼짐, 소비자 결정.
- saveBase의 "RAM 부담을 옮긴다" 주석은 삭제한다(base 해제 경로가 없어 주장 불이행).
  saveBase/loadBase는 백업/이동용으로 재서술하고, RAM 밸브는 pruneTo/dispose가 정본이다.
  이 간극은 docs/operations/contractReality.md에 행으로 기록한다.

## 3. heapDelta: 핵 알고리즘의 단일 보관소

`src/runtime/heapDelta.js` (Layer 0, 순수 함수, 의존성 0):

```js
export function hashDiffPages(fromHashes, toHashes)        // 해시 비교 전략(페이지당 2워드 interleave)
export function byteDiffPages(current, baseline, pageSize) // 바이트 비교 전략(8바이트 성긴 기각 + 확정)
export function packPages(source, pages, pageSize)         // pages -> 연속 bin
```

소비 재배선:

1. reactive.checkpoint()의 델타 수집 루프 -> hashDiffPages.
2. `ReactiveController.collectDelta(fromIdx, toIdx = liveIdx)` 공개 메서드 신설:
   `{ pages, bin, sp, heapLen }` 반환. session._collectDelta와 machineJournal.commit의
   복붙 5줄 루프(비선언 필드 hashes/liveIdx 직접 접근)를 이것으로 대체한다.
3. worker.js harvest의 성긴+확정 비교와 applyDelta의 드리프트 복원 비교 -> byteDiffPages.
   worker.js의 지역 PAGE=65536 재선언은 유지한다(워커 번들 자기충족 계약이 아니라
   상대 import가 이미 있으므로 `../runtime/memoryLayout.js`의 PAGE_SIZE로 통일한다.
   워커 import graph가 바뀌므로 자산 manifest 재생성이 동반된다).
4. WASI(wasiWorker의 전체 slice 체크포인트)는 이번 범위 밖이다(research preview,
   원장에 기록).

성능 계약: fork 수확 경로는 알고리즘 동일 이동이다(전략 자체를 바꾸지 않는다).
브라우저 게이트의 fork 시나리오가 상한 예산(Phase 2 예산 게이트) 안에서 GREEN이어야 한다.

## 4. processOs 수리

### rpcChannel (Worker RPC 공통화)

`src/processOs/rpcChannel.js`: reqId 발급 + pending 맵 + 사망 시 전건 명시 reject를
한 곳에 둔다. 소비자는 pyProc.js, machineContainer.js, machineWorker.js(자식 라우팅)의
Worker 3종. kernelElection(BroadcastChannel + outcome unknown)과 sharedKernel(Phase 1에서
삭제)은 대상이 아니다.

```js
export function createRpcPort(worker, { label, onDead } = {})
// -> { call(msg, transfer): Promise, fail(err), isDead(), pendingCount() }
```

의미론(pyProc의 검증된 계약을 그대로 승계): 응답의 reqId로 상관, 모르는 응답은 폐기,
fail(err) 시 pending 전건 reject + 이후 call 즉시 reject(PYPROC_PROCESS_UNAVAILABLE).

### MachineContainer

1. reqId 카운터를 cid 카운터(_seq)와 분리한다(현재 혼용: machineContainer.js:63,89).
2. 워커 error/messageerror에서 컨테이너를 dead로 기록하고 pending 전건 reject, 이후
   _call은 PYPROC_PROCESS_UNAVAILABLE 즉시 reject(영원 pending 금지 계약을 pyProc과
   동일하게).
3. 중첩 라우팅을 경로 배열로 일반화한다: cid "m1/c2/c1"을 ["c2","c1"]로 분해해 최상위
   워커에 `{ type: "route", path, op, ... }`로 보내고, machineWorker가 첫 세그먼트의
   자식에게 재귀 전달한다. run/heapLen/kill/spawnChild 전부 같은 라우터를 탄다
   (현재는 run만 1단 childCid를 지원하고 heapLen/spawnChild/kill 심층 경로가 파손).
   깊이 2 이상을 브라우저 게이트로 고정한다.

### PyProc.respawn(pid)

kill + 같은 부팅 방식(snapshot/replay)으로 대체 spawn하는 공개 메서드.
반환 `{ oldPid, pid, bootMs }`. map의 _replace를 이것으로 수렴하고, JobControl의
강제 회수가 소비한다.

### JobControl 강제 회수

`kill(jobId, { force: true })` (기본 force 없음 = 기존 시그널 경로):
협조 시그널이 통하지 않는 잡(interrupts 미지원 워커, KeyboardInterrupt 삼키는 루프)을
os.respawn(pid)으로 회수한다. 잡 상태는 "killed", 레인은 새 pid로 자유 큐에 복귀.
주의: fork 대칭이 깨지지 않도록 respawn은 반드시 같은 replay 매니페스트로 부팅한다.

### map 부분 실패의 정직화

모든 레인이 respawn 실패로 소진되면 미실행 태스크가 undefined 구멍으로 남는 현재
동작을 제거한다: lane 전멸 후 남은 슬롯을
`{ error: "pool exhausted: 모든 레인이 죽어 태스크가 실행되지 않았다" }`로 채운다
(map의 기존 오류 표현 {error: string}과 동형).

## 5. 표면 압축 (Phase 1, 브레이킹 1회 묶음)

### 제거

| 대상 | 근거 | 재배선 |
|---|---|---|
| SharedKernel (파일 2개 + export) | contract.md가 "제품 정본이 아니다"라고 자인, CI 게이트 0, 소비 증거 0, KernelElection이 동일 목표의 정본 | capabilityMatrix 행 제거, contract.md 절 제거, README 표 갱신, 자산 manifest sharedWorker role 제거 |
| PyProc.mapSerial | 벤치 대조군이 공개 표면에 노출 | heroConsole.js, examples/processOs.html, tests/browser/gate.html을 exec(pid) 직렬 루프로 재배선. 벤치 계약(timings.mapSerialMs 키)은 유지하되 산출 경로만 교체 |
| PyProc.interrupt | signal(pid, SIGNAL.INT)의 별칭 | 호출처를 signal로 |
| ReactiveController.timeTravel | restoreLive의 1줄 별칭 | 호출처를 restoreLive로 |
| index.js 헤더의 표면 목록 주석 | 실물과 8개 어긋난 표류 상태 | d.ts와 capabilityMatrix 포인터로 대체 |

### 강등 (루트 -> subpath)

| 대상 | 새 위치 | 근거 |
|---|---|---|
| GpuCompute, GpuArray, GpuBridge | `pyproc/gpu` | CI 런타임 게이트 0(헤드리스 GPU 불가), 내부 의존 0 |
| SocketBridge | `pyproc/socket` | 외부 릴레이 필수, CI 게이트 0 |
| bootWasi, WasiSession | `pyproc/wasi` | research preview 지위(프로덕션 정본은 Pyodide 표면) |

package.json exports에 "./gpu", "./socket", "./wasi"를 추가한다(기존 kebab-case 관례:
"./process-os", "./syscall-bridge"와 동렬). 진짜 그래프 분리를 위해 runtimeBindings의
SocketBridge/GpuBridge static import와 enableSocketBridge/enableGpu 팩토리를 제거한다.
subpath 소비는 `import { GpuCompute } from "pyproc/gpu"` 후 직접 생성이다.
d.ts는 루트 선언에서 제거하고 `declare module "pyproc/gpu"` 블록으로 이동한다.

### 유지 (검증에서 확정)

- boot / new Runtime(py): 라이브 사용 레인. 저수준 Runtime 레인으로 문서상 위치만 명확화.
- bootSession / openMachine / openPersistentMachine: 머신 레인 3문. 진입점 결정 트리
  문서(1페이지)로 선택 기준을 고정한다. 통합은 기각(00 문서 참조).
- bootEnv/runScript: 루트 유지. gate.html에 최소 실동작 게이트를 추가한다
  (bootEnv 부팅 + 1식 평가). 게이트가 물리적으로 불가능해지면 다음 이니셔티브에서
  강등을 재론한다(원장 기록).
- Session: 머신 핸들 타입으로 유지(개명 기각).

### README 얼굴 교체

1. 첫 코드 = 체크포인트 -> 실행 -> 실패 -> cp.restore() 밀리초 복원(에이전트 재시도 루프).
2. 둘째 = openPersistentMachine 탭 생존, 셋째 = fork 물리 병렬.
3. Web Computer 섹션은 하단으로 이동.
4. 진입점 결정 트리(단일 탭 일회성 = boot / 부활 필요 = bootSession / 다중 탭 =
   openPersistentMachine / 기존 Pyodide 채택 = new Runtime(py) / 파일 = openMachine).
5. tests/run.mjs의 README 문자열 게이트를 같은 커밋에서 동기화한다.

## 6. 문서/운영 인프라 (Phase 2)

1. `docs/reference/api.md` (영문): 루트 export 전수의 함수 단위 시그니처/오류 코드/경계.
   파이썬 쪽 제2 표면(pyprocMachine, pyprocIpc, pyprocJail, pyprocGpu 전역 모듈,
   pyprocResumeReason 전역)의 정본 명세 포함. 구조 게이트: index.js의 모든 루트 export
   이름이 api.md에 앵커로 존재해야 커밋 가능.
2. `CHANGELOG.md` (루트): Unreleased 절에 이번 브레이킹 전수 목록(마이그레이션 지시 포함).
   릴리즈는 별도 명시 지시 전까지 하지 않는다(버전/태그 불변).
3. `SECURITY.md` (영문): .pymachine = 코드 실행과 동급 위험, ECDSA P-256 서명/신뢰 게이트,
   stubEntropy 부팅 창(전역 crypto/Date/performance 패치), SRI 부팅 체인, 보고 경로.
4. `docs/product/glossary.md`: Session(pyproc 머신 핸들) vs Machine(web-machine 플랫폼
   어휘) vs Kernel(다중 탭 리더) vs Journal/Image 용어 경계 선언.
5. 전역 패치 직렬화: `src/runtime/globalPatch.js`의 runExclusive 하나로 session.js의
   부팅 체인, runtime.js boot의 fetch 랩, wheelCache의 fetch 스왑을 같은 체인에서
   직렬화한다(동시 진입 시 서로의 전역 복원이 꼬이는 창 제거).
6. CI: test:web-computer job 신설(자산 준비 포함), wasiGate 자산 fetch+cache 스텝
   (fetch:engine 재사용), 성능 예산 게이트(tests/browser/run.mjs가 gate 측정치를
   tests/browser/perfBudget.json 상한과 대조, 여유 계수는 CI 분산을 감안해 크게).
7. README 공급망 절: npm Trusted Publishing(OIDC) + provenance + SRI 체인 서술.

## 의존성/그래프 영향

- worker.js가 `../runtime/memoryLayout.js`와 `../runtime/heapDelta.js`를 import하게 되면
  processWorker 자산 그래프가 바뀐다. scripts/assetManifest.mjs는 게이트 실행 시마다
  재계산하므로 로컬은 자동 정합, 소비자 배포는 pyproc-assets CLI 재실행으로 갱신된다
  (manifest 포맷 버전 PYPROC_ASSET_MANIFEST_VERSION은 불변).
- machineWorker.js도 rpcChannel/errors import가 추가되므로 machineWorker role 그래프가
  같은 방식으로 갱신된다.
- capabilities -> processOs 방향 import는 계속 0이다(레이어 게이트 불변).
