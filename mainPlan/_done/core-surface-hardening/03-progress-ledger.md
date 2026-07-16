# 03. 진행 원장

## 2026-07-16 - 이니셔티브 개설

확인한 현재 상태:

1. 7개 영역 정밀 독해 + 3개 관점 설계 + 반박 검증(판정 sound 42 / flawed 10 / infeasible 1)
   완료. 핵 = "결정적 리플레이 경계(cp0) + 페이지 해시 델타" 단일 메커니즘으로 확정.
2. 루트 export 41개, 진입점 10개, 핸들 7종 실측. 오류 채널 4종 파편화(PYPROC_* 코드는
   kernelElection/machineJournal에만, 나머지 21파일 150여 throw는 plain Error).
3. soundness 구멍 실측: enableReactive 호출마다 새 컨트롤러(runtimeBindings.js:21),
   restore가 execSeq 미기록(reactive.js), 체크포인트 나무 해제 API 전무,
   워커 오류 경계 납작화(worker.js:168), 저널 커밋 실패 삼킴(machineJournal.js:118).
4. 트랙 A(web-machine-hardening)는 게이트 전수 GREEN 확인(구조 907, browser core,
   webMachine probes 13종, Web Computer 3-process E2E, consumer/package).
   deviceBackedDualBootProbe의 첫 실패는 240s 타임아웃 플레이크(재실행 12/12 GREEN,
   processColdRestoreMs 2849).

결정:

1. Machine 단일 핸들 통합과 Session 개명은 기각한다(00 문서의 기각 목록 참조.
   fork의 워커 대칭 벽, web-machine 어휘 충돌이 근거).
2. 오류 계약은 PyProcError 하나로 수렴하고, 구조 게이트로 `throw new Error`의 재발을
   차단한다. 기존 PYPROC_* 코드 문자열은 전부 보존한다.
3. 컨트롤러는 Runtime당 1개 memoize, restore는 noteStateMutation()으로 경계에 기록한다.
   저널 유휴 커밋과의 상호작용은 게이트로 고정한다.
4. heapDelta는 전략 2개(hashDiffPages/byteDiffPages)의 이름 있는 보관소다. WASI 체크포인트
   내부는 이번 범위 밖(research preview).
5. rpcChannel 공통화는 Worker 3소비자(pyProc, machineContainer, machineWorker)만.
   kernelElection의 outcome-unknown 의미론은 건드리지 않는다.
6. 표면 압축: SharedKernel 삭제, GPU/Socket/WASI subpath 강등, mapSerial/interrupt/
   timeTravel 절삭, README 얼굴 교체. bootSession/openMachine/openPersistentMachine
   3문은 유지하고 결정 트리 문서로 선택 기준을 고정한다.
7. 릴리즈는 하지 않는다. 브레이킹은 CHANGELOG Unreleased에 누적하고 버전/태그는 불변.
8. saveBase의 RAM 오프로드 주장은 미이행이므로 주석을 정정하고 contractReality에
   기록한다. 진짜 배출 밸브는 pruneTo/dispose다.

기각:

- 게이트 0을 근거로 한 WASI 강등(ci.yml에 wasiGate 실재. 강등 근거는 research preview
  지위만 유효).
- mapSerial 즉시 삭제(소비 4곳 재배선이 같은 커밋에 있어야 함).
- "닫는 checkpoint" 의식의 전면 제거(모든 복원의 O(heap) 재해시 승격 = 항구 열화).
- bootEnv의 openMachine 흡수(stubEntropy 없는 레인 = cp0 결정성 비호환).

NEXT:

1. Phase 0a(오류 계약)부터 착수. errors.js 신설 -> src 전체 throw 전환 -> 워커 경계 ->
   구조 게이트.
2. 각 phase 완료 시 이 원장에 기록.

## 2026-07-16 - Phase 0a-0d 구현 완료

1. 0a 오류 계약: errors.js(코드 28종: 설계 27 + 구현 중 추가한 PYPROC_MACHINE_INTEGRITY =
   봉투 해시/서명 검증 실패를 형식 위반과 구분), src 전체 오류 생성 약 170지점 전환
   (throw 150 + reject 20), 워커 payload에 code/retryable/pyExcType, 수신측
   fromErrorPayload 복원, jobControl 분류를 pyExcType 기반으로 전환. pyprocSw는 SW
   자기충족 계약이라 로컬 swError 헬퍼로 재현(구조 게이트에 1건 예외 명시).
   구조 게이트 2종 신설: src 코드 없는 Error 0건, 카탈로그-d.ts union 삼자 일치.
   레이어 게이트는 errors.js를 전 레이어 공용 Layer 0 계약으로 보편 허용.
2. 0b 리액티브 soundness: enableReactive memoize(런타임당 1개), restore/restoreLive가
   noteStateMutation으로 경계 기록, checkpoint()가 sp 내장 복원 핸들 반환(cp.restore()),
   markDirty, pruneTo/dispose. 설계 조정: dispose는 영구 사망이 아니라 "나무 해제 +
   재시작 가능"(memoize와 정합: 영구 사망이면 그 런타임은 리액티브를 영영 못 쓴다).
   saveBase 주석을 백업/이동용으로 정정하고 contractReality에 간극 행 기록.
   MachineJournal에 onStatus(커밋 실패 = PYPROC_JOURNAL_IO)와 pruneAfterCommit.
3. 0c heapDelta: hashDiffPages/byteDiffPages/samePage/packPages 순수 모듈로 수렴,
   reactive.collectDelta(pack:false 옵션 = 저널의 델타 재할당 회피) 신설, session과
   journal의 복붙 수집 루프 제거, worker.js 수확/정화가 같은 판정 소비.
4. 0d processOs: rpcChannel(Worker 3소비자), MachineContainer 사망 즉시 거부 + 경로
   라우터(route)로 중첩 깊이 임의의 run/heapLen/kill/spawn, PyProc.respawn 공개,
   JobControl.killHard(설계의 kill force 옵션 대신 이름 있는 별도 메서드: boolean
   옵션 금지 규칙), map 레인 전멸 시 {error} 채움.
5. 게이트: 구조 GREEN + 브라우저 게이트 62/62(신설 체크 14종 포함: memoize,
   cp.restore, 복원 경계 이벤트, 복원 후 저널 유휴 커밋, markDirty 재해시 승격,
   pruneTo 거부 코드, collectDelta, 워커 예외 코드/pyExcType 경계 통과, dead pid
   거부 코드, killHard 회수+레인 재사용, 컨테이너 중첩 라우팅/사망 즉시 거부,
   openMachine 신뢰 거부 코드). restoreLive 실측 0.91-1.11ms(회귀 없음).

## 2026-07-16 - Phase 1 구현 완료

1. 강등: GPU 3종 -> pyproc/gpu, SocketBridge -> pyproc/socket, WASI 2종 -> pyproc/wasi.
   runtimeBindings의 static import와 enableGpu/enableSocketBridge 제거(진짜 그래프 분리,
   구조 게이트가 루트 잔존과 Runtime 팩토리 잔존을 차단). d.ts는 루트 선언을 제거하고
   declare module 블록으로 이동.
2. 삭제: SharedKernel + sharedKernelHost(파일/asset role/게이트/문서 전부). 절삭:
   ReactiveController.timeTravel, PyProc.interrupt, PyProc.mapSerial. 소비 4곳(랜딩
   히어로 콘솔, processOs 예제, gate.html, 벤치 S2 산출 경로)을 exec 순차 루프로 재배선.
3. README 얼굴 교체: 첫 예제 = 준비 1회 + 체크포인트 + 실패 시 cp.restore() 에이전트
   루프. 진입점 결정 트리(6문 1답) 신설, Web Computer 절 하단 이동, 표면 지도 갱신.
4. 계획 대비 조정: 루트 export는 41 -> 36(제거 7, PyProcError 계열 +2 후 실측)이다. 계획의 "30개 이하" 상한은 근거 없는 숫자였다: 강등의 근거는
   게이트 부재/research preview이고, 나머지는 전부 CI 게이트가 커버하는 표면이라
   추가 강등이 오히려 열화다. 상한 게이트 대신 "루트 잔존 금지 목록" 게이트로
   등식(루트 = 게이트된 표면)을 직접 강제한다.

## 2026-07-16 - Phase 2 구현 완료

1. 문서: docs/reference/api.md(영문, 루트 export 전수 앵커를 구조 게이트로 강제),
   CHANGELOG.md(Unreleased 절, 브레이킹 전수 + 마이그레이션), SECURITY.md(영문 위협
   모델: 머신 파일 = 실행 파일, 서명/신뢰, 결정적 부팅 창, 공급망), docs/product/
   glossary.md(pyproc과 Web Machine 플랫폼의 이름 소유권 경계).
2. 전역 패치 직렬화: src/runtime/globalPatch.js 한 체인으로 bootSession 엔트로피 스텁,
   boot 코어 캐시 fetch 랩, wheelCache fetch 스왑을 직렬화. 중첩 조립(bootSession ->
   boot/wheelCache)은 fn(reenter)의 patchScope 전달로 데드락 없이 같은 창에 중첩
   (엄격 LIFO는 안전).
3. 성능 예산: tests/browser/perfBudget.json 상한(로컬 실측의 5-10배 = 자릿수 회귀
   차단 목적)을 러너가 기본 게이트 측정치와 대조, 초과 시 RED.
4. CI: wasiGate를 SKIP green에서 실제 GREEN으로(scripts/fetchWasiAssets.mjs +
   actions/cache, 릴리즈 zip -> python.wasm + stdlib zip 레시피의 기계화),
   web-computer 3-process E2E job 신설(자산 catalog hash 키 캐시). CI 배선은 로컬
   검증 불가: push 후 CI 확인 대기 항목이다.
5. README 공급망 절(Trusted Publishing/OIDC + provenance + SRI 체인) 양 언어 추가.

## 2026-07-16 - 완결

최종 게이트(전부 GREEN, 로컬 실행):

1. `npm test` 구조 게이트 980/0 (신설: 오류 계약 2종, 강등 잔존 금지, api.md 앵커
   전수, 문서 인프라 존재, subpath 메서드 계약).
2. `npm run test:browser` 63/63 (신설 체크 15종 + bootEnv 콜드 레인 + 성능 예산 통과.
   restoreLive 0.86-1.11ms, fork 부팅 평균 177-210ms, map 병렬 23-29ms = 회귀 없음).
3. `npm run test:examples` GREEN (랜딩 히어로 콘솔/processOs 예제의 직렬 exec 재배선 포함).
4. `npm run test:package` GREEN, `npm run test:consumer` GREEN (설치 tarball 소비).
5. `npm run test:web-computer` 9/9 GREEN (3-process E2E: 초기 부팅 5042ms,
   콜드 복원+export 468ms, 새 프로필 import 2373ms).

완료 조건 대조(README 7항):

1. PyProcError 단일 수렴 + 재발 차단 게이트: 충족.
2. 컨트롤러 memoize + 복원 경계 기록 + pruneTo/dispose: 충족.
3. heapDelta 이름 있는 전략 2개 수렴: 충족(WASI 내부는 범위 밖 명시).
4. processOs 사망/중첩/강제 회수/부분 실패 명시 계약: 충족.
5. 표면 압축(강등 3계열 + SharedKernel 삭제 + 별칭 절삭 + README 얼굴): 충족
   (수치 상한은 근거 부족으로 기각하고 등식 게이트로 대체, Phase 1 조정 기록 참조).
6. 영문 api.md/CHANGELOG/SECURITY/용어집 + 표류 차단 게이트: 충족.
7. 전 게이트 GREEN: 충족.

남는 후속(이니셔티브 밖, 차기 재개 지점):

1. push 후 CI 확인: wasiGate 실 GREEN 전환과 web-computer job이 러너에서 도는지
   (자산 다운로드/캐시 경로). 실패 시 forward patch.
2. 릴리즈는 명시 지시 대기(CHANGELOG Unreleased가 브레이킹 전수와 마이그레이션 보유).
3. WASI 체크포인트 내부의 heapDelta 합류(research preview 승격 논의 시).

현재 구현 상태: 완료. 폴더를 mainPlan/_done/core-surface-hardening/으로 이관한다.
