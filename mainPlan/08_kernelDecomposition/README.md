# kernelDecomposition

최대 파일을 책임별로 가르고, 그 과정에서 이미 두 벌로 갈린 커밋 정책을 하나로 만든다. 오류 계약도 여기서
기계 검사 대상으로 올린다.

## Outcome brief

- 주 축: 클린코드
- 관측된 손실 지점: `KernelElection` 676줄이 다섯 책임을 겹치고 있고, `durabilityUnknown` 처리가 두 곳에
  각각 있다. 한쪽만 고치면 조용히 갈린다. `map()`은 타임아웃과 레인 전멸과 파이썬 예외를 전부 문자열
  접두사로만 구분하게 한다.
- 기대 변화: 각 조각이 자기 상태만 갖고, 정확히 한 번 보증의 정책이 한 자리에 산다. 오류는 code로 구분된다.
- 롤백 반경: 분할은 동작 무변경이 목표라 회귀가 나면 그 자체가 신호다.

## 근거

**KernelElection의 다섯 책임** (`src/session/kernelElection.js`, 676줄)

- presence/heartbeat: `_heartbeat:217`, `_onChannel:248`, `_participants`
- 선출과 epoch fence: `join:111`, `_nextEpoch:135`, `_becomeLeader:154`, `_acceptLeader:283`
- RPC 전송/상관/타임아웃/park-resend: `_request:464`, `_acceptResponse:396`, `_parkOrRejectPending:411`,
  `_resendParkedPending:432`, `_rejectPendingOutcomeUnknown:456`
- 서버측 정확히 한 번: `_serve:307`, `_execute:363`
- 저널 커밋 정책과 명령 직렬화: `_commitJournal:382`, `_enqueueCommand:390`
- **갈라진 정책**: `_request:466-481`의 "리더면 로컬 실행" 분기와 `_serve:327-348`이 같은 커밋 정책을 각자
  구현한다.
- 상태 필드가 28개이고 한 메서드가 여러 축을 동시에 만진다(`_serve:327-348`이 실행, 결과기록, 저널커밋,
  응답캐시, 전송을 전부 한다).

**두 coordinator의 60줄 중복** (`src/machine/persistence/`)

- `lookup`: `machineCommitCoordinator.js:23-25` == `machineEnvelopeCoordinator.js:7-9` (바이트 동일)
- `sortedMachines`, `sortedDevices`, `_assertBlockDevice`도 각각 두 벌
- paused 서두(`commit:60-75`, `envelope:42-61`)가 같은 순서를 반복한다
- 이미 갈라졌다: `exportPaused`는 device 스냅샷에 `kind`/`byteLength`를 싣고 `commitPaused`는 `meta`에 싣는다

**오류 계약**

- `src/runtime/errors.js:25`의 `PYPROC_TASK_TIMEOUT`은 src 전체에서 **한 번도 throw되지 않는다**. 선언만 있고
  `index.d.ts:24`의 공개 union까지 오염시킨다.
- 실제 생산 지점은 `src/processOs/pyProc.js:278` `{ error: \`timeout: exceeded ${timeoutMs}ms\` }`이고
  `:294`의 레인 전멸도 문자열이다. 대조군: `src/processOs/jobControl.js:40`은 같은 상황에
  `PYPROC_POOL_EXHAUSTED`를 제대로 던진다.
- `pyProc.js:281`은 워커에서 code와 pyExcType까지 실어 온 `PyProcError`를 메시지 문자열로 납작하게 만든다.
- `src/runtime/errors.js:49` `this.code = CODE_SET.has(code) ? code : "PYPROC_INTERNAL";` - 미등록 코드를 조용히
  강등한다. 오타나 등록 누락이 신호 없이 통과한다.
- `src/machine/contracts/operationControl.js:20`은 한 템플릿 리터럴 안에서 영어와 한국어가 섞인다
  (`${label}: ${timedOut ? "timeout" : "취소"}`). 오류 메시지는 소비자가 읽는 공개 표면이라 CLAUDE.md 언어
  절의 영문 우선 대상이다.

## 입장 조건

- 04가 끝나 저널 legacy가 갈라져 있다.
- 05가 끝나 커밋 경로가 안정돼 있다. 커밋 정책 통합은 그 정책이 변하는 중에 하면 안 된다.
- `tests/run.mjs`의 `[election 프로토콜]` 절이 이 리팩터의 안전망이다. 착수 전에 그 절이 무엇을 덮고
  무엇을 못 덮는지 읽고 이 문서에 적는다.

## 범위

포함

- `KernelElection` 3분할과 커밋 정책 단일화
- 두 coordinator의 공통 절차 추출
- `map()` 결과에 code 부여
- `PyProcError` 미등록 코드의 관측 가능화 + 정적 게이트
- 오류 메시지 언어 통일

제외

- `MachineJournal`의 pack/prune/delete 분리는 필요하면 여기 포함하되, 04에서 legacy가 이미 갈라진 뒤라
  범위가 작다.
- `map()` 오류 **문구** 변경은 하지 않는다(기각 항목). 필드만 더한다.

## 구현 계약

1. `src/session/kernel/`을 만들고 세 파일로 가른다.
   - `kernelMembership.js`: `BroadcastChannel` 배선, presence/heartbeat, `_participants`, hello/presence/bye
     분기. 밖으로는 `onLeaderState`, `onRequest`, `onResponse` 콜백만 낸다.
   - `kernelRpcClient.js`: `_pending`, `_seq`, 타임아웃, park/resend, `_acceptResponse`, `hostProxySurfaces` 판정.
   - `kernelRpcServer.js`: `_served`, `_outcomes`, `_serve`, `_execute` + **하나로 합친**
     `runCommand(action, payload)`. `_request`의 리더 로컬 경로와 `_serve`가 같은 함수를 부른다.
2. `kernelElection.js`에는 선출(`join`, `_nextEpoch`, `_becomeLeader`, `_acceptLeader`)과 세 조각의 배선,
   `status()`만 남긴다(200줄 이하 목표).
3. `status()`의 필드 집합(`:574-595`)이 바이트 동일하게 유지되도록, 각 조각이 `inspect()`를 내고 `status()`가
   합친다.
4. `src/session/kernelElection.js:18`의 `SERVED_CACHE_MAX = 256`을 삭제하고 `src/state/outcomeLog.js`의
   `OUTCOME_LOG_MAX_RECORDS`를 import한다. 두 값이 같아야 한다는 사실이 이미 주석으로만 살아 있다
   (`outcomeLog.js:16-18`). import edge는 이미 존재하는 방향이다.
5. `src/machine/persistence/pausedCapture.js`를 신설하고 두 심볼을 만든다.
   - `assertPausedComputer({ machines, devices, stateErrorCode, deviceKindCode, deviceInvalidCode })`
   - `capturePaused({ machineList, deviceEntries, control })`
   오류 코드는 호출자가 주입해 두 도메인의 코드 어휘를 그대로 유지한다.
6. `lookup`을 `src/machine/contracts/`로 올려 한 벌만 둔다.
7. `map()` 결과 원소를 `{ error, code, retryable, pyExcType? }`로 넓힌다. 기존 `error` 키와 문구는 유지한다.
   타임아웃은 `PYPROC_TASK_TIMEOUT`, 레인 전멸은 `PYPROC_POOL_EXHAUSTED`, 워커 예외는 `outcome.err.code`.
   `errors.js`에 `toResultError(error, fallbackCode)`를 두어 `toErrorPayload`와 같은 규율을 쓴다.
8. `errors.js:49`의 강등을 유지하되 `this.context.unregisteredCode`에 원래 값을 남긴다.
9. `tests/run.mjs`에 정적 게이트를 신설한다: `src/**/*.js`의 `new PyProcError("<리터럴>"`과
   `new WebMachineError("<리터럴>"`을 뽑아 각 카탈로그와 대조한다. 리터럴이 아닌 전달 지점은 검사 대상이
   아니므로 **그 한계를 게이트 이름과 커밋 메시지에 명시한다.**
10. 도달성 게이트를 더한다: `PYPROC_ERROR_CODES`의 각 코드가 src에서 최소 1회 생산되는지. 지금
    `PYPROC_TASK_TIMEOUT`이 그 검사를 RED로 만들 것이고, 7이 그것을 green으로 만든다.
11. 오류 메시지와 API 반환 문자열은 영어로 통일한다. 판정선("`Error.message`와 API 반환 문자열은 영어,
    코드 주석은 한국어")을 `docs/operations/`에 적고 정적 가드를 낸다. 파이썬 부트스트랩 소스 안의 문자열
    같은 정당한 한글 자리를 먼저 조사해 오탐을 없앤다.

## 영향 파일

기존: `src/session/kernelElection.js`, `src/state/outcomeLog.js`, `src/machine/persistence/machineCommitCoordinator.js`,
`src/machine/persistence/machineEnvelopeCoordinator.js`, `src/machine/contracts/`, `src/processOs/pyProc.js`,
`src/runtime/errors.js`, `src/machine/contracts/operationControl.js`, `index.d.ts`, `tests/run.mjs`

신규: `src/session/kernel/kernelMembership.js`, `src/session/kernel/kernelRpcClient.js`,
`src/session/kernel/kernelRpcServer.js`, `src/machine/persistence/pausedCapture.js`

## 검증

- `npm test`(정적 오류 게이트 + 도달성 게이트), `npm run test:browser`, `npm run test:types`,
  `npm run test:installed`(다중 탭 선출 경로)

음성 시험

- 정적 오류 게이트: `new PyProcError("PYPROC_NOT_A_CODE", ...)`를 주입해 RED 확인.
- 도달성 게이트: 카탈로그에 쓰이지 않는 코드를 하나 더해 RED 확인.
- 커밋 정책 단일화: `runCommand`를 우회하는 두 번째 경로를 되살린 사본이 `[election 프로토콜]` 절에서
  RED가 되도록 정책 사본 금지 검사를 함께 낸다.
- `status()` 동치: 분할 전후의 필드 집합을 대조하는 단정을 넣고, 필드 하나를 빼면 RED가 되게 한다.
- 언어 가드: 오류 메시지에 한글을 주입해 RED 확인.

## 롤백

분할 커밋은 동작 무변경이 목표다. 브라우저 게이트나 installed 레인이 RED면 그 분할만 되돌린다.
7(map code)은 공개 반환 형태를 넓히므로 독립 커밋으로 내고 `index.d.ts`와 함께 되돌릴 수 있게 한다.

## 커밋 분할

1. `SERVED_CACHE_MAX` 상수 통합(3줄, 위험 0)
2. `pausedCapture.js` 추출 + `lookup` 승격
3. `KernelElection` 분할 1: membership
4. `KernelElection` 분할 2: rpc client
5. `KernelElection` 분할 3: rpc server + 커밋 정책 단일화 + 정책 사본 금지 검사
6. 오류 계약(map code + 미등록 코드 관측 + 정적 게이트 + 도달성 게이트)
7. 메시지 언어 통일 + 가드
