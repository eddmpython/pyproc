# latentDefects

지금 트리에 있는 실결함 셋을 닫는다. 세 개 모두 "게이트가 그 조합을 안 돌아서" 살아남았고, 그래서 수리보다
게이트가 본체다. 기능 추가는 없다.

## Outcome brief

- 주 축: 클린코드(계약과 구현의 불일치)
- 관측된 손실 지점: `bootSession({ wheelDir, packages })`를 부르면 응답이 영영 돌아오지 않는다. 머신을
  `dispose()`한 뒤에도 저널 인터벌이 런타임을 붙잡는다. `createWebComputer`가 스폰하는 워커가 무결성 검증
  대상 밖이다.
- 기대 변화: 세 경로 모두 계약대로 동작하고, 같은 종류의 누락이 다시 나면 게이트가 커밋 시점에 막는다.
- 롤백 반경: 셋 다 독립이라 하나씩 되돌릴 수 있다.

## 근거

**(a) WheelCache가 주입받은 `patchScope`를 버린다.**

- `src/capabilities/wheelCache.js:9-13` 생성자는 `_rt`, `_dir`, `hits`, `misses`만 대입한다. `_patchScope` 대입이 없다.
- `src/capabilities/wheelCache.js:24` `const scope = this._patchScope || runWithGlobalPatch;`
- `src/session/session.js:77` `new WheelCache(rt, { dir: manifest.wheelDir, patchScope: reenterPatch })`
- `src/runtime/globalPatch.js:8-9`가 이 실패 모드를 명시한다: "한 창 안에서 다른 패처를 부르는 조립은 대기하면
  자기 창을 기다리는 데드락이다".
- `src/runtime/globalPatch.js:42-47`의 `patchChain.then(exec, exec)` 구조상, 열린 창 안에서 전역 경로로 들어가면
  자기 창의 완료를 기다린다.
- 대조군: `src/runtime/runtime.js:168`은 같은 계약을 `opts.patchScope`로 올바르게 소비한다.

**(b) `dispose()`가 저널 타이머를 회수하지 않는다.**

- `src/machine/composition/pyprocMachine.js:201-215` `dispose()`는 `_procPools`, `_jobControl`, `_containers`,
  `_reactive`만 회수한다. `this.history._journals`(같은 파일 `:66-67`)는 만지지 않는다.
- `src/capabilities/journal/machineJournal.js:154-169`의 `setInterval`은 `stop()` 없이는 계속 돈다.
- 정정된 사실: `:153-159`에서 `idleSince`는 `execSeq` 변화 시에만 세팅되고 커밋 시도 직후 `null`로 돌아간다.
  dispose된 머신은 `execSeq`가 변하지 않으므로 **실패 커밋은 최대 1회**다. 실제 손실은 타이머가 `rt`와
  `reactive`를 붙잡아 GC를 막고 탭이 살아 있는 동안 계속 깨어나는 것이다.
- `stop()` 호출부는 저장소 전체에서 `machineJournal.delete()`와 `src/session/kernelElection.js:620` 둘뿐이다.

**(c) 워커 실행 자산 하나가 공개 매니페스트 밖에 있다.**

- `src/machine/composition/createWebComputer.js:72` `workerURL: new URL("./workerHostedGuestWorker.js", import.meta.url).href`
- `src/machine/guests/workerHostedGuestAdapter.js:138` `new Worker(this._workerURL, { type: "module" })`
- `src/runtime/assets.js:13-46`의 `ASSETS`는 `processWorker`, `machineWorker`, `wasiWorker`, `pyprocServiceWorker` 4개뿐이다.
- `tests/run.mjs:246`은 그 4개 role의 **존재만** 확인한다. 역방향 대조가 없어 누락을 구조적으로 못 본다.

## 입장 조건

없다. 셋 다 독립이고 근거가 코드에서 확인된다.

착수 전 확인 하나: (c)는 `getPyProcAssetManifest`의 반환 내용을 바꾼다. `src/runtime/assets.js`의
`PYPROC_ASSET_MANIFEST_VERSION`이 무엇을 약속하는지 읽고, role 추가가 버전 증가 사유인지 판정한 뒤 착수한다.
판정 결과를 이 문서에 적고 시작한다.

## 범위

포함

- `wheelCache.js` 생성자의 `patchScope` 배선과 `cfg.dir` 필수 검사 위치 정리
- `PyprocHistory`가 저널 수명주기를 소유하도록 만들고 `dispose()`가 그것을 회수
- `workerHostedGuestWorker.js`의 매니페스트 등재
- 위 셋 각각의 게이트

제외

- `runtime.boot()`의 patchScope 계약 통합은 07이다. 여기서는 배선 한 줄만 고친다.
- `KernelElection`의 저널 수명주기는 08이 3분할하면서 함께 본다. 여기서는 `PyprocMachine` 경로만.
- 매니페스트 스키마 변경(role 메타 확장)은 하지 않는다. 항목 하나만 더한다.

## 구현 계약

1. `src/capabilities/wheelCache.js` 생성자에 `this._patchScope = cfg.patchScope || null;`을 더한다.
   `src/runtime/runtime.js:168`과 같은 형태를 쓴다.
2. 같은 파일에서 `cfg.dir` 필수 검사를 `_withCache`(현재 `:21`)에서 생성자로 올린다. 옵션을 읽는 곳과
   검증하는 곳을 한 자리로 모은다.
3. `src/machine/composition/pyprocMachine.js`의 `PyprocHistory`에 `disposeJournals()`를 만든다.
   `_journals`의 각 저널에 `stop()`을 부르고 Map을 비운다. in-flight 커밋이 있으면 완료를 기다린다
   (`MachineJournal._busy`를 Promise로 승격해야 한다).
4. `dispose()`가 `this._reactive.dispose()` **앞에서** `disposeJournals()`를 부른다. 순서가 뒤집히면 진행 중
   커밋이 파손된 컨트롤러를 읽는다.
5. `src/runtime/assets.js`의 `ASSETS`에 `workerHostedGuestWorker` role을 더한다. `kind`는 기존 module worker
   항목과 같은 값을 쓴다.
6. `tests/run.mjs`의 role 목록 검사를 역방향 대조로 바꾼다: `src` 전체에서 `new URL(<리터럴>.js, import.meta.url)`로
   워커 자산이 되는 파일 집합을 만들고 `ASSETS`와 양방향 비교한다. 한쪽만 늘어나면 RED.

## 영향 파일

기존

- `src/capabilities/wheelCache.js`
- `src/machine/composition/pyprocMachine.js`
- `src/capabilities/journal/machineJournal.js` (`_busy`의 Promise 승격)
- `src/runtime/assets.js`
- `tests/run.mjs` (역방향 대조 게이트)
- `tests/browser/gate.js` (dispose 회수 단정)

신규

- `tests/contracts/nestedPatchScope.mjs` (Node, fake dir와 fake `rt.loadPackages`로 중첩 창 판정)

## 검증

- `npm test`: 자산 역방향 대조 게이트 green
- `npm run test:browser`: dispose 회수 단정 green
- `npm run test:types`, `npm run test:package`
- `node tests/contracts/run.mjs`: 중첩 patchScope suite green

음성 시험(이것을 보고서야 게이트다)

- (a) `patchScope` 대입 줄을 지우면 중첩 suite가 **타임아웃으로 RED**가 되어야 한다. 통과 확인만으로는
  부족하다. 데드락은 실패가 아니라 정지로 나타나므로 suite에 유한 예산을 두고 초과를 실패로 판정한다.
- (b) `disposeJournals()` 호출을 지우면 브라우저 게이트가 RED. 판정은 "dispose 후 `_journals.size === 0`" 과
  "dispose 후 N x idleMs 동안 `onStatus` 호출 0" 둘 다.
- (c) `ASSETS`에서 아무 role이나 한 줄 지우면 역방향 대조가 RED. 반대로 `src`에 새 워커 파일을 하나 심으면
  역시 RED(양방향 확인).

## 롤백

셋을 독립 커밋으로 낸다. (a)가 새 경로를 처음 실제로 열기 때문에(지금까지 데드락으로 아무도 도달하지 못한
`_withCacheInWindow`의 fetch 스왑이 중첩 창 안에서 처음 돈다) 회귀가 나면 (a)만 되돌린다. LIFO 복원이
성립하는지(안쪽이 원복할 때 바깥 스텁이 살아남는지)를 (a)의 검증 항목에 포함한다.

## 커밋 분할

1. `patchScope` 배선 + 중첩 suite + 음성 시험
2. 저널 수명주기 소유권 + dispose 회수 + 브라우저 단정
3. 자산 등재 + 역방향 대조 게이트 (버전 판정 결과를 커밋 메시지에 명시)
