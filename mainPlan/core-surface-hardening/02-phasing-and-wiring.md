# 02. 단계와 배선

## 순서 원칙

비파괴(Phase 0a-0d)를 먼저 완성해 핵의 soundness와 오류 계약을 닫고, 브레이킹(Phase 1)은
한 커밋 묶음으로 수행한다. 문서/운영 인프라(Phase 2)는 표면이 확정된 뒤에 쓴다(개념 수가
줄어든 시점이 유지비 최소). 각 phase 커밋 전 `npm test` GREEN, 런타임 동작을 바꾼 phase는
`npm run test:browser`와 관련 게이트도 GREEN.

릴리즈는 하지 않는다(버전/태그 불변, 명시 지시 대기). 브레이킹은 CHANGELOG Unreleased에
누적한다.

## Phase 0a - 오류 계약

영향 파일:

- `src/runtime/errors.js` 신규
- `src/**/*.js` 전체(throw 전환. 특히 session.js 43건, runtime/, capabilities/, processOs/,
  runtime/engines/wasi/)
- `src/processOs/worker.js`, `src/processOs/machineWorker.js` (오류 payload에 code/pyExcType)
- `src/processOs/pyProc.js`, `src/processOs/machineContainer.js` (수신측 복원)
- `src/processOs/jobControl.js` (pyExcType 기반 분류)
- `src/processOs/kernelElection.js` (kernelError -> PyProcError 승계)
- `src/capabilities/machineJournal.js` (JournalCorruptionError 승계 + onStatus)
- `index.js` (PyProcError export), `index.d.ts` (클래스 + 코드 union + payload 타입)
- `tests/run.mjs` (구조 게이트: src에서 `throw new Error(` 0건, 코드 카탈로그와 d.ts union
  일치)
- `tests/browser/gate.html` (오류 코드 실동작 체크 소수 추가: 워커 태스크 예외의 code,
  jobControl kill 분류)

작업:

1. errors.js를 01 문서의 코드 카탈로그 그대로 구현한다.
2. src 전체 throw를 PyProcError로 전환한다. 메시지 문자열은 유지한다(게이트/문서 결박).
3. 워커 경계 payload와 수신측 복원을 배선한다. jobControl 분류를 pyExcType으로 바꾼다.
4. 저널 onStatus를 추가하고 커밋 실패를 PYPROC_JOURNAL_IO로 관측 가능하게 한다.
5. 구조 게이트를 추가한다(재발 차단이 이 phase의 산출물이다).

게이트:

- `npm test`: throw new Error 0건 검사 GREEN, d.ts union = errors.js 카탈로그 일치.
- `npm run test:browser`: 기존 47+ 체크 GREEN + 신규 오류 코드 체크.
- 기존 오류 코드 값(PYPROC_RPC_OUTCOME_UNKNOWN 등) 불변 확인(immortal 게이트 GREEN).

롤백: errors.js 도입은 additive, throw 전환은 메시지 보존이라 커밋 단위 revert로 복귀
가능하다.

## Phase 0b - 리액티브 soundness

영향 파일:

- `src/capabilities/runtimeBindings.js` (enableReactive memoize)
- `src/runtime/runtime.js` (noteStateMutation)
- `src/capabilities/reactive.js` (restore 경계 기록, sp 저장 + cp.restore, markDirty,
  pruneTo/dispose, saveBase 주석 정정)
- `src/capabilities/machineJournal.js` (pruneAfterCommit)
- `index.d.ts`, `docs/operations/contractReality.md`
- `tests/browser/gate.html` (시나리오 추가: 컨트롤러 동일성, cp.restore() 왕복,
  restore 후 저널 유휴 커밋, pruneTo 후 경로 밖 복원 거부, markDirty 후 재해시 승격)

작업: 01 문서 2절 그대로.

게이트:

- enableReactive() 2회 호출이 같은 인스턴스를 반환한다.
- cp.restore()가 sp 명시 없이 정확히 복원한다(기존 restoreLive(j, sp) 경로도 GREEN).
- restore 직후 저널 유휴 커밋이 발생하고 복원 상태가 커밋된다.
- pruneTo(j) 후 경로 밖 노드 복원이 PYPROC_CHECKPOINT_PRUNED로 거부되고, 경로 안 복원과
  이어지는 checkpoint가 정상 동작한다. dispose() 후 전 호출 거부.
- %undo(Terminal)와 Session save/load, forkLive 게이트 GREEN(공유 나무 회귀 없음).

롤백: 전부 additive 또는 내부 동작이라 커밋 revert로 복귀 가능. memoize가 문제면
그 커밋만 되돌려도 Phase 0a와 독립.

## Phase 0c - heapDelta 통합

영향 파일:

- `src/runtime/heapDelta.js` 신규
- `src/capabilities/reactive.js` (checkpoint 루프 + collectDelta 공개)
- `src/capabilities/session.js` (_collectDelta -> reactive.collectDelta)
- `src/capabilities/machineJournal.js` (commit 루프 -> reactive.collectDelta)
- `src/processOs/worker.js` (harvest/applyDelta 비교 -> byteDiffPages, PAGE 상수 통일)
- `index.d.ts` (collectDelta 선언)
- `tests/run.mjs` (worker import graph 승인 목록 갱신 필요 시)

게이트:

- `npm run test:browser` GREEN(리액티브/fork/저널/세션 시나리오 전부).
- fork 시나리오의 측정치가 기존과 동급(예산 게이트는 Phase 2에서 상한 고정).
- `npm test`의 자산 graph 검사 GREEN(assetManifest 재계산 정합).

롤백: 순수 이동이므로 커밋 revert로 복귀.

## Phase 0d - processOs 수리

영향 파일:

- `src/processOs/rpcChannel.js` 신규
- `src/processOs/pyProc.js` (rpcChannel 소비, respawn 공개, map 구멍 채움)
- `src/processOs/machineContainer.js` (rpcChannel, reqId 분리, dead 기록, 경로 라우팅)
- `src/processOs/machineWorker.js` (route 재귀 전달)
- `src/processOs/jobControl.js` (kill force)
- `index.d.ts`
- `tests/browser/gate.html` (컨테이너 사망 즉시 reject, 중첩 깊이 2 run/heapLen/kill,
  jobControl force 회수, map 레인 전멸 시 {error} 채움)

게이트:

- 죽인 컨테이너에 대한 _call이 영원 pending이 아니라 즉시 reject된다.
- "m1/c1" 깊이의 run/heapLen/kill과 깊이 3 spawn이 동작한다.
- kill(jobId, { force: true })가 행 잡을 회수하고 레인이 재사용된다.
- 기존 processOs 게이트(맵/fork/시그널) GREEN.

롤백: 내부 파일 한정이라 커밋 revert로 복귀.

## Phase 1 - 표면 압축 (브레이킹 묶음, 커밋 분할은 의도별)

영향 파일:

- 삭제: `src/processOs/sharedKernel.js`, `src/processOs/sharedKernelHost.js`
- `index.js`, `index.d.ts`, `package.json` (exports 3개 추가)
- `src/capabilities/runtimeBindings.js` (SocketBridge/GpuBridge 결합 제거)
- `src/processOs/pyProc.js` (mapSerial/interrupt 제거), `src/capabilities/reactive.js`
  (timeTravel 제거)
- `examples/heroConsole.js`, `examples/processOs.html`, `tests/browser/gate.html`
  (mapSerial 재배선), `tests/browser/speedBench.mjs`와 벤치 문서(mapSerialMs 산출 경로)
- `scripts/assetManifest.mjs` 또는 role 정의(sharedWorker role 제거 위치 확인)
- `README.md`, `README.ko.md`, `tests/run.mjs`(README/표면 게이트 동기화)
- `docs/consuming/capabilityMatrix.md`, `docs/consuming/contract.md`(행 제거/강등/결정 트리)
- `tests/packageConsumer.mjs`, `tests/browser/productConsumer.mjs`(표면 검사 갱신,
  subpath 소비 검사 추가)
- `tests/browser/gate.html` (bootEnv 최소 실동작 체크 추가)

작업 순서(커밋 분할):

1. 강등: gpu/socket/wasi subpath 신설 + runtimeBindings 결합 해제 + d.ts 이동.
2. 절삭: SharedKernel 삭제, mapSerial/interrupt/timeTravel 제거 + 소비 4곳 재배선.
3. README/문서 얼굴 교체 + 게이트 문자열 동기화 + 결정 트리.

게이트:

- `npm test` GREEN(표면/타입/README 게이트 갱신 포함).
- `npm run test:browser`, `npm run test:examples`, `npm run test:consumer`,
  `npm run test:package` GREEN.
- 루트 export 수가 30개 이하로 떨어진다(구조 게이트로 상한 고정).
- 레포 전역에서 SharedKernel/mapSerial/timeTravel/interrupt(별칭 의미) 참조 0
  (mainPlan/_done과 CHANGELOG 제외).

롤백: 강등/절삭은 export와 파일 단위라 커밋 revert로 복귀. README 게이트와 문서는
같은 커밋에 묶여 있어 부분 롤백 없음.

## Phase 2 - 문서/운영 인프라

영향 파일:

- `docs/reference/api.md` 신규(영문), `CHANGELOG.md` 신규, `SECURITY.md` 신규,
  `docs/product/glossary.md` 신규
- `src/runtime/globalPatch.js` 신규 + `src/capabilities/session.js`,
  `src/capabilities/wheelCache.js`, `src/runtime/runtime.js` (fetch/전역 패치 직렬화 합류)
- `.github/workflows/ci.yml` (web-computer job, wasi 자산 캐시)
- `tests/browser/perfBudget.json` 신규 + `tests/browser/run.mjs` (예산 대조)
- `tests/run.mjs` (api.md 앵커 게이트, CHANGELOG/SECURITY 존재 게이트)
- `README.md` (공급망 절)

게이트:

- api.md가 index.js 루트 export 전수를 앵커로 포함(기계 검사).
- 전역 패치 직렬화 후 test:browser GREEN(동시 boot/bootSession/wheelCache 경쟁 시나리오
  1개 추가).
- perfBudget: gate 측정치가 상한 안(상한은 로컬 실측의 3배 이상 여유로 고정, 목적은
  자릿수 회귀 차단).
- CI 변경은 로컬 검증 불가: 원장에 "push 후 CI 확인 대기"로 기록한다.

롤백: 문서와 게이트는 커밋 revert로 복귀. globalPatch 합류는 세 파일 한정.

## 완료 절차

1. 전 phase 게이트 GREEN 재확인(npm test, test:package, test:browser, test:examples,
   test:web-computer).
2. 원장에 최종 상태 기록, README(이 폴더) 배너 갱신.
3. 폴더째 `mainPlan/_done/core-surface-hardening/`으로 이동, `mainPlan/README.md`와
   `mainPlan/_done/README.md` 갱신, 저장소 내 참조 경로 갱신.
