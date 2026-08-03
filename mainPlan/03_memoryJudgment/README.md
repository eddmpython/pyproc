# memoryJudgment

메모리를 기계가 판정하게 만든다. 다섯 축 중 메모리만 자동 판정이 하나도 없다. 힙을 체크포인트하는 것이
이 제품의 정체성인데, 힙이 커지는 회귀만 무방비다.

## Outcome brief

- 주 축: 메모리(판정 인프라)
- 관측된 손실 지점: 브라우저 게이트가 MB 값을 여러 개 재서 문자열로 인쇄하지만 아무것도 단정하지 않는다.
  델타 페이지 수집이 조용히 두 배가 되거나 저널 loose가 pack되지 않거나 이미지가 두 배로 불어도 시간 예산
  여유 안에 전부 숨는다.
- 기대 변화: 메모리 회귀가 커밋 시점에 RED가 된다. 09와 10이 "줄었다"를 주장이 아니라 측정으로 말할 수 있다.
- 롤백 반경: 예산 파일과 게이트 단정뿐이라 제품 코드 0.

## 근거

- `tests/browser/perfBudget.json:3-10`의 budgets 6키는 전부 시간이다. 메모리 키가 없다.
- 측정은 이미 있는데 단정이 없다: `tests/browser/gate.js:698`(`fk.mb`), `:745`, `:862`(`sv.mb`), `:931`(저장/부활 MB),
  `tests/browser/installedPackageGate.mjs:487`(`timings.machineMB`). 전부 info 문자열로만 인쇄된다.
- `tests/run.mjs` 전체에서 `heapMB|usedJSHeap|performance.memory` 검색 결과 0건.
- `reactive.stats()`는 이미 정확한 바이트 계측기다(`src/capabilities/reactive.js:183-217`이
  `baseBytes`, `deltaBytes`, `hashBytes`, `totalBytes`, `activeNodes`, `prunedNodes`, `liveDepth`를 낸다).
  그런데 `tests/browser`와 `tests/support` 어디에서도 호출되지 않는다.
- `crossOriginIsolated`가 전제이므로 `performance.measureUserAgentSpecificMemory()`를 쓸 수 있고, 그 결과의
  attribution이 워커별 분해를 준다.
- `src/capabilities/reactive.js:167-171` `dispose()`가 `base`, `deltas`, `hashes`, `sps`를 null로 놓는 것은 이미
  참이라, 회수 단정은 지금 바로 쓸 수 있다.

## 입장 조건

- 02의 러너 판정 수렴이 끝나 있다. 새 단정을 넣기 전에 판정자가 페이지의 self-ok를 믿지 않아야 한다.
- 브라우저 게이트 출력을 전량 파일로 남기는 규율이 로컬에도 적용돼 있다.

## 범위

포함

- `perfBudget.json`에 `memoryBudgets` 절 신설과 대조 로직 재사용
- `reactive.stats()`를 브라우저 게이트의 앵커로 심기
- dispose와 terminate 후 자원 회수 단정
- installed 레인의 `machineMB` 예산

제외

- 회수 경로 자체를 고치는 것은 09(워커 cp0)와 10(rebase)이다. 여기서는 **현재 값을 못 박는 것**까지다.
- 시간 예산의 installed/golden/webMachine 레인 확장은 이 캠페인에 포함하되, 새 측정을 만들지는 않는다
  (측정은 이미 전부 있다).
- 메모리 절감 목표 수치를 미리 적지 않는다. 09와 10이 그 값을 내리는 커밋에서 함께 내린다.

## 구현 계약

1. `tests/browser/perfBudget.json`에 `memoryBudgets` 절을 만든다. 초기 키:
   `bootHeapBytes`(부팅 직후 `rt.memory.byteLength()`), `forkDeltaMb`, `sessionDeltaMb`, `journalPackMb`,
   `reactiveTotalMb`(= `stats().totalBytes`).
2. 대조는 `tests/browser/run.mjs:186-206`의 기존 over/absent 로직을 그대로 재사용한다. 특히 "예산 키가
   측정에 없다" 경로(`:199-205`)를 메모리 키에도 적용한다. 예산이 조용히 죽는 유일한 경로가 그것이다.
3. `tests/browser/gate.js`에 `reactive.stats()` 앵커를 심는다. 최소 세 지점: 부팅 직후, 체크포인트 K회 뒤,
   `pruneTo` 뒤. 각각 `totalBytes`를 `timings`에 싣는다.
4. 회수 단정을 넣는다.
   - `pool.terminate()` 후 스냅샷 SAB가 놓였는지(`src/processOs/pyProc.js:317-322`가 `_snapshot`을 null로
     놓지 않는 현재 상태를 이 단정이 드러낸다. 수리는 09지만 **판정은 여기서 먼저 선다**)
   - `machine.dispose()` 후 `reactive.stats().totalBytes`가 0에 수렴
   - `history.watch()` 후 `dispose()`에서 저널 타이머가 0 (01이 고친 것을 여기서 예산으로 굳힌다)
5. installed 레인에 `machineMB` 예산을 건다. 이 값은 사용자가 실제로 내려받는 산출물 크기다.
6. 예산 값은 이번 캠페인에서 실측한 값의 여유 배수로 정하고, 그 근거(언제 어디서 잰 값인지)를 JSON의
   `comment`에 남긴다. `perfBudget.json:2`가 이미 그 규율을 쓰고 있다.

## 성능과 메모리 계약

- 측정 자체는 이미 계산된 값을 읽는 것이라 게이트 시간 증가 0을 목표로 한다.
  `measureUserAgentSpecificMemory()`는 비동기 비용이 있으므로 호출 지점을 3개 이하로 제한한다.

## 영향 파일

기존: `tests/browser/perfBudget.json`, `tests/browser/run.mjs`, `tests/browser/gate.js`,
`tests/browser/installedPackageGate.mjs`, `tests/gateFloor.json`

신규: 없음(전부 기존 레인 확장)

## 검증

- `npm run test:browser` green, `npm run test:installed` green
- `npm test` green(게이트 층 하한 갱신 포함)

음성 시험

- **실제 팽창 주입이 정본이다.** 예산값을 낮춰 RED를 보는 것은 약한 증명이다. `gate.js`의 측정 직전에
  `rt.run("_pad = bytearray(64 * 1024 * 1024)")`를 넣어 `bootHeapBytes`가 상한을 넘고 RED가 되는 것을 본다.
- `memoryBudgets`의 키 이름 하나를 바꿔 "예산 키가 측정에 없다" 경로로 RED가 되는 것을 본다.
- 회수 단정: `dispose()` 호출을 빼면 `totalBytes` 단정이 RED가 되는 것을 본다.

## 롤백

예산이 거짓 RED를 내면 그 키만 제거하고 사유를 커밋 메시지에 남긴다. 예산을 올려서 통과시키는 것은
금지한다. 값을 올리려면 왜 그 크기가 정당한지를 같은 커밋에 적는다.

## 커밋 분할

1. `memoryBudgets` 절 + 대조 로직 재사용 + `stats()` 앵커
2. 회수 단정 3종
3. installed 레인 `machineMB` 예산
