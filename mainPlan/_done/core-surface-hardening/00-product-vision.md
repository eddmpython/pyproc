# 00. 핵 규명과 제품 방향

## 핵은 무엇인가

pyproc의 핵은 개별 기능이 아니라 단일 메커니즘이다:

**결정적 리플레이 부팅(cp0) + 페이지 해시 델타.**
같은 매니페스트(indexURL/env/packages/setup)로 부팅하면 바이트 동일한 힙 경계(cp0)가
재현되고, 사용자 상태는 그 경계와 다른 64KiB 페이지의 집합으로 완전하게 표현된다.

이 하나가 서로 달라 보이는 차별화 기능 전부의 공통 기저다:

| 얼굴 | 실체 | 위치 |
|---|---|---|
| 시간여행/분기 | cp0 위 페이지 해시 체크포인트 나무 | `src/capabilities/reactive.js` |
| forkLive (N GIL 물리 병렬) | cp0 대비 dirty page 수확 + 자식 드리프트 정화 | `src/processOs/worker.js` harvest/applyDelta |
| 불멸 머신 (탭 죽음 생존) | cp0 델타의 CAS WAL 커밋, 리플레이 + 델타 부활 | `src/capabilities/machineJournal.js`, `src/processOs/kernelElection.js` |
| 이동 가능한 서명 이미지 | 같은 델타를 .pymachine 봉투로 운반 | `src/capabilities/session.js` exportImage |

경쟁(JupyterLite/marimo-wasm/WebVM/순정 Pyodide)은 S2 process map과 S3 browser server
벤치에서 전부 N/A로 실측 기록됐다(같은 API 후보가 없다). 시간여행 분기, live fork,
탭 죽음을 넘는 durable 부활은 이 프로젝트만의 주장이며, 전부 한 메커니즘 위에 서 있다.

제2의 정체성은 기계 게이트 밀도다. 문서 문구, 벤치 수치, 낡은 수치 잔존까지 커밋이
물리적으로 깨지는 설계가 이미 있다. 찬사의 공식은 이 둘의 결합이다:
**핵 하나를 표면의 얼굴로 만들고, 그 주장 전부를 기계로 증명한다.**

## 무엇이 찬사를 막는가 (실측 근거)

1. **핵의 soundness 구멍.** `enableReactive()`가 호출마다 새 컨트롤러를 만들고
   (`src/capabilities/runtimeBindings.js:21`), restore/restoreLive는 힙을 대량으로 쓰면서
   `execSeq`를 올리지 않는다(`reactive.js:57-89`는 읽기만 한다). 컨트롤러 2개가 공존하면
   (bootSession의 reactive + Terminal(timeTravel)의 자체 reactive) 한쪽의 복원이 다른 쪽
   경계 가드에 보이지 않아 낡은 해시로 힙을 조용히 오염시킨다. 여기에 체크포인트 나무는
   해제 API가 전무해 무한 축적된다(base는 힙 전체 사본 상주, `reactive.js:32`).
2. **오류 채널 4종 파편화.** PYPROC_* 코드는 kernelElection(7개)과 machineJournal(1개)에만
   있고, 나머지 21개 파일 150여 throw는 코드 없는 plain Error다. 값 반환 오류({error})와
   boolean false까지 4종이 공존하고, 오류 클래스/코드가 index.d.ts에 하나도 export되지
   않는다. 워커 경계는 오류를 `String(err).slice(-300)`으로 납작하게 만들어(worker.js:168)
   코드가 건너오지 못하고, jobControl.js:48은 그 증상으로 문자열 includes 분류를 한다.
   durable을 파는 저널의 커밋 실패는 console.warn으로 삼켜진다(machineJournal.js:118).
3. **표면 밀도.** 파이썬 실행 컨텍스트 획득 경로 10개, 반환 핸들 7종. CI 런타임 게이트가
   없는 GPU 3종/SocketBridge/SharedKernel/bootEnv가 루트 41개 export에 1급으로 서 있다.
   restoreLive(cp.index, sp) + "닫는 checkpoint" + stackSave 보관이라는 3요소 의식이
   핵심 기능의 공개 계약이다. 동일 동작의 별칭(timeTravel, interrupt)과 벤치 대조군
   (mapSerial)이 표면에 남아 있다.
4. **문서 인프라 부재.** README 첫 예제가 커모디티(sum=60)를 보여주고, 영문 API 레퍼런스와
   CHANGELOG, SECURITY(서명/신뢰 모델은 이미 구현돼 있는데 영문 문서가 없다)가 없다.

## 성공 기준

1. soundness: 한 Runtime = 한 컨트롤러가 기계 보장되고, restore가 경계에 기록되며,
   pruneTo/dispose가 존재하고, 이 전부가 브라우저 게이트로 검증된다.
2. 오류: `import { PyProcError } from "pyproc"`이 성립하고, src 전체 throw가 코드를 갖고,
   워커 경계를 코드가 건너오고, 구조 게이트가 `throw new Error`의 재발을 차단한다.
3. 표면: 루트 export가 게이트된 표면으로 압축된다(목표: 30개 이하). 핵심 복원이
   `cp.restore()` 한 호출이 된다.
4. 문서: 영문 api.md가 루트 export 전수를 다루고(게이트로 강제), CHANGELOG/SECURITY/용어집이
   존재하며, README 첫 코드가 핵을 보여준다.
5. 회귀 없음: 전 게이트 GREEN + 성능 예산 게이트(fork/checkpoint 상한) 신설.

## 실패 기준 (이러면 중단하고 원장에 기록)

1. 컨트롤러 memoize 또는 restore의 execSeq 기록이 기존 게이트(저널 유휴 커밋, %undo,
   forkLive)와 화해 불가능한 동작 변화를 낳는 경우.
2. heapDelta 통합이 fork 실측(10.3MB 수확 43.6ms급)을 유의미하게 열화시키는 경우.
3. 표면 강등이 계약 문서(docs/consuming/contract.md)에 기록된 라이브 사용 표면을 깨는
   경우(기록 기준 라이브 표면은 boot/Runtime 계열 + 자산 파이프라인 + AsgiServer +
   setInterruptBuffer라 겹치지 않음을 확인했다).

## 기각된 대안 (반박 검증에서 죽은 것)

1. **Machine 단일 핸들로 전 진입점 통합.** fork는 워커끼리만 성립한다(메인 커널과 워커
   커널의 리플레이는 바이트가 다르다, worker.js:9-11 실측). 메인스레드 Session 핸들에
   fork를 얹으려면 커널의 워커 재배치(JobControl형)가 필요하며 그것은 표면 문제가 아니라
   아키텍처 이동이다. fork/map은 PyProc 축으로 유지한다.
2. **Session을 Machine으로 개명.** 같은 저장소의 web-machine 플랫폼(packages/core의
   machineHandle, webMachineHost 등)이 Machine 어휘를 선점했다. 개명은 은유 혼재를
   오히려 악화시킨다. 용어집으로 경계를 선언한다.
3. **bootEnv를 openMachine 옵션으로 흡수.** bootEnv의 snapshot/coldFill 레인은 stubEntropy
   없이 부팅하므로(envManager.js) cp0 결정성 계약과 비호환이다. 흡수하면 "env로 부팅한
   머신은 부활 불가능한 이미지를 만든다"는 함정이 생긴다. 별도 레인으로 유지한다.
4. **WASI를 "게이트 0" 근거로 강등.** ci.yml이 wasiGate.html을 실행하며(자산 부재 시 SKIP)
   engine-watch가 이 게이트를 엔진 핀 범프 인증 장치로 쓴다. 강등 근거는 게이트가 아니라
   research preview 지위(contract.md의 "프로덕션 정본은 Pyodide 표면")다.
5. **"닫는 checkpoint" 의식의 전면 제거.** restoreLive의 재해싱 0 즉시성은 닫힌 경계 전제
   위에서만 성립한다. 의식 제거는 모든 복원을 O(heap) 재해시로 승격시키는 항구 열화다.
   sp를 노드에 내장하는 additive 개선만 한다.
6. **mapSerial을 곧바로 삭제.** 공개 랜딩(heroConsole)과 예제, gate.html 병렬 정합 대조,
   S2 벤치 계약이 물려 있다. 삭제는 하되 소비 4곳의 재배선(exec 직렬 루프)이 같은
   커밋에 포함되어야 한다.
7. **kernelElection/sharedKernel까지 rpcChannel로 공통화.** kernelElection의 outcome-unknown
   의미론은 전송 후 리더 교체를 다루는 별개 계약이고 전송로도 BroadcastChannel이다.
   Worker 기반 3소비자(pyProc, machineContainer, machineWorker)만 공통화한다.
