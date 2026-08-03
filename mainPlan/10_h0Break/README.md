# h0Break

## 판정 정정과 진행 상태(2026-08-03)

**입장 조건 1번("명시 릴리즈 지시")의 해석이 틀렸다.** 절대 게이트가 금지하는 것은 **릴리즈
행위**(버전 +1 + 태그를 같은 커밋에)이지 구현이 아니다. 이 저장소의 모델은 브레이킹이
CHANGELOG Unreleased에 쌓였다가 명시 지시가 있을 때 릴리즈되는 것이고, 0.0.11 절의 Breaking
항목 넷이 그 증거다. 그래서 구현은 착수 가능하고, 릴리즈만 지시를 기다린다.

**착수해서 낸 것**

- 경계 지문 계산 통합(브레이킹 아님, 선행). 저널과 세션이 같은 두 줄을 각자 갖고 있던 것을
  `boundaryDigest` 하나로 모으고 사본 금지 게이트를 냈다.
- **`rebaseTo` + `rebaseLinear`**: 이 캠페인의 머리다. 선형 역사에서 보존 정책이 0바이트를
  회수하던 문제를 고쳤다(공개 표면이 약속한 능력이 실제로는 없었다). 브라우저 게이트 실측으로
  노드 13 -> 2, 델타 저장 86.3MB -> 5.2MB. 경계 이동이라는 대가와 그 거부 코드 둘을 CHANGELOG
  Unreleased와 `index.d.ts` 선언에 함께 적었다. 기본값은 꺼짐이다.
- `boundaryEpoch`로 경계 이동을 관측 가능하게 하고 저널의 h0 캐시가 그 세대를 키로 잡게 했다.

**남긴 것과 이유**

믹서 최적화, 희소 해시, `/home` 파일 단위 CAS, IndexedDB v3는 성격이 다르다. rebase는 **켠
사람만** 경계를 잃지만, 이 넷은 **업데이트하는 순간 모든 사용자의 저장 상태를 무효화한다**
(h0 입력 표현이 바뀌거나 디스크 포맷이 바뀐다). 그 종류의 변경은 Unreleased에 조용히 쌓이면
안 되고, 마이그레이션 안내와 함께 한 릴리즈로 나가야 한다. 이득이 전부 성능이라는 점도 그
판단을 굳힌다: 지금 급한 것은 없고, 잘못 나가면 되돌릴 수 없다.

착수할 때는 순서가 있다. 1) 경계 지문 계산은 이미 한 곳이므로 그날의 diff는 그 함수에서
시작한다. 2) 03이 세운 메모리 예산은 희소 해시가 `stats().totalBytes`를 바꾸므로 같은 커밋에서
재기준화해야 한다(안 하면 거짓 RED). 3) 실측은 새 폴더를 파지 말고 `stateKernel`과
`largeHeapEnvelope` 안의 probe로 늘린다.

## Outcome brief

- 주 축: 속도, 메모리
- 관측된 손실 지점: 체크포인트 비용이 힙 전량에 정비례하고 페이지 건너뛰기가 없다. 노드마다 해시 배열
  전체를 보관한다. 보존 정책이 지배적 사용 모양에서 한 바이트도 회수하지 못한다. `/home`이 커밋마다 전량
  재읽기 대상이다.
- 기대 변화: 경계 비용의 바닥이 내려가고, 장수 세션의 메모리에 실제 상한이 생긴다.
- 롤백 반경: 포맷 브레이킹이라 롤백은 릴리즈 되돌리기다. 그래서 한 번에 모은다.

## 왜 이것이 마지막인가

CLAUDE.md 절대 게이트: "0.0.x 라인에서 명시 지시가 있을 때만 릴리즈한다". 이 캠페인의 모든 항목은
`commit.env.h0` 또는 디스크 포맷을 바꾸고, 그 변경은 이미 저장된 모든 번들과 저널을
`PYPROC_REPLAY_MISMATCH`로 거부하게 만든다(`src/session/session.js:133`의 `expectH0`, `:245-249`).

h0 앵커는 한 곳이 아니다. 착수 전에 셋을 전부 확인한다.

- `src/capabilities/journal/machineJournal.js:124-130` `_boundaryKey()`가 `reactive.hashes[0]`을 SHA-256한다
- `src/session/session.js:182-185` `_cp0Digest()`가 같은 계산을 한 벌 더 갖는다
- `src/machine/composition/workerHostedGuestWorker.js:72,86`도 `hashes[0]`에 묶여 있다

그리고 `hashes[0]`을 만드는 것은 `src/runtime/memoryCapability.js:20-35`의 믹서다. 즉 믹서 변경, 희소 해시,
rebase가 **같은 앵커를 움직인다.**

## 근거

- `src/runtime/memoryCapability.js:20-35`: 워드당 4연산(`Math.imul` 2회 포함)을 페이지 건너뛰기 없이 전수
  수행한다. 비용이 힙 바이트에 정비례하고 "얼마나 변했는가"와 무관하다. 같은 파일 `:6` 주석에 자체 실측이
  남아 있다.
- `src/capabilities/reactive.js:44,105`가 `checkpoint`와 `restoreLive` rehash 경로에서 그것을 부른다.
- 노드당 해시: 페이지당 2워드 = 8바이트. 512MB 힙이면 노드당 64KB이고 1000 노드면 64MB다.
  `stats().hashBytes`가 그 값을 정직하게 보고한다.
- **보존 정책이 선형 역사에서 무력하다.** `src/capabilities/reactive.js:242`가
  `this._retentionPolicy.pruneBranches && before.branches > 0`일 때만 `pruneTo`를 부르는데, 문장마다
  체크포인트를 찍는 지배적 모양은 부모 체인이 선형이라 `branches === 0`이다. 설령 불러도 `pruneTo`의
  keep 집합(`:150-151`)이 루트에서 live까지 전 경로라 `freedNodes === 0`이다.
- 그 결과 `machineJournal.js:250`의 `pruneAfterCommit`도 선형 세션에서 no-op이다. `machineJournal.js:83-85`가
  그것을 "장수 머신의 RAM 배출 밸브"라고 적는데 실제로는 밸브가 아니다.
- base 상주: `src/capabilities/reactive.js:50` `this.base = mem.sliceAll()`이 힙 전체 사본을 만들고
  `:254-255`가 "RAM은 줄지 않는다"고 자백한다. `saveBase()`는 OPFS에 쓰기만 하고 `this.base`를 놓지 않는다.
- `/home`: `src/capabilities/journal/machineJournal.js:218-221`이 커밋마다 `collectMachineHome`으로 전체를
  재귀 순회해 읽고 하나의 연속 버퍼로 합친다. 파일 하나가 1바이트 바뀌어도 전체를 다시 읽고 합치고
  해시하고 쓴다(주소가 바뀌므로 dedupe 무효). `HOME_MAX_BYTES`가 512MB다. `stat()`이 `mtimeMs`를 이미
  노출하는데 쓰이지 않는다.
- IndexedDB 스키마: `src/machine/persistence/indexedDbMachineStore.js:266`의 `onupgradeneeded`가 버전 번호를
  상수로 갖지 않는다. blob 크기 색인을 넣으려면 마이그레이션 경로가 먼저 필요하다.

## 입장 조건

전부 충족해야 착수한다.

1. **명시 릴리즈 지시**가 있다.
2. `tests/attempts/stateKernel`과 `tests/attempts/largeHeapEnvelope` 안에서 브라우저 실측이 끝났다.
   **새 attempts 폴더를 만들지 않는다**(증식 금지). 세부 질문은 그 캠페인 안의 probe 파일로 늘린다.
3. 03의 메모리 예산이 서 있고, 그 예산의 재기준화 항목이 이 캠페인의 커밋 계획에 들어 있다. 희소 해시는
   `stats().totalBytes`를 바꾸므로 예산을 함께 갱신하지 않으면 거짓 RED가 난다.
4. h0 앵커 세 곳을 한 함수로 모으는 선행 리팩터가 끝났다(같은 계산의 두 번째 사본이 `session.js`에 있다).
5. 마이그레이션 동사가 정해졌다. 옛 저널과 이미지를 만난 사용자가 무엇을 하면 되는지가 오류 메시지와
   CHANGELOG에 있다.

## 범위

포함

- 해시 믹서 최적화(같은 완전성, 다른 믹서)
- 노드당 해시의 희소화(변경 페이지의 해시만 저장)
- 선형 역사를 위한 rebase(compact) 동사와 보존 정책 재배선
- base의 lazy 소스화 또는 rebase를 통한 델타 총량 축소
- `/home`의 파일 단위 CAS
- IndexedDB 스키마 v3(blob 크기 색인)

제외

- 샘플링 기반 해시는 채택하지 않는다. `src/capabilities/reactive.js:4`가 완전 해시를 soundness의 열쇠로
  선언하고 있고, 샘플링은 불완전 델타를 만들어 복원을 깨뜨린다. 믹서는 바꾸되 **전수 주사는 유지**한다.
- fork 수확의 판정 강도 변경은 09다.

## 구현 계약

1. h0 계산을 한 함수로 모은다(`_boundaryKey`와 `_cp0Digest`와 워커 경로가 같은 함수를 부른다). **이것이
   첫 커밋이고 브레이킹이 아니다.**
2. 믹서를 4워드 언롤 계열로 바꾼다. 워드당 연산 수를 줄이되 64비트 실효 폭과 전수 주사는 유지한다.
3. `checkpoint()`가 해시 전수 순회와 변경 페이지 복사를 **한 번의 순회**로 합친다(현재는 두 벌).
4. 노드당 해시를 `Map<page, [a, b]>`로 바꾼다. `hashDiffPages`와 `_boundaryKey`가 그 표현을 받게 고친다.
   1000노드 512MB힙에서 64MB가 수 MB로 내려간다.
5. `rebaseTo(j)`를 만든다. 루트에서 j까지의 델타를 base에 순서대로 적용해 base를 전진시키고
   `parents[j] = -1`, `deltas[j] = new Map()`, 그 앞 노드를 해제한다. 잃는 것은 "j 이전으로의 시간여행"이고
   그것은 `PYPROC_CHECKPOINT_PRUNED`로 이미 표현 가능하다.
6. `_applyRetention`의 조건을 `branches > 0`이 아니라 "초과하면 `liveDepth`를 상한까지 rebase"로 바꾼다.
   `stats().liveDepth`가 이미 판정 입력을 준다.
7. `/home`을 파일 단위 엔트리로 커밋한다. `makePageTableTree`의 `files` 배열이 이미 여러 엔트리를 받으므로
   `home` 하나 대신 `home/<path>` N개로 나눈다. 변경 없는 파일은 dedupe로 쓰기가 사라진다.
   `mtimeMs + size` 캐시는 해상도 문제로 같은 초의 동일 크기 변경을 놓칠 수 있으므로 단독으로 쓰지 않는다.
8. IndexedDB 레코드에 blob별 byteLength를 싣고 스키마 버전을 올린다. 마이그레이션 경로를 함께 낸다.

## 성능과 메모리 계약

- 지표는 기울기다. 체크포인트의 `ms/MB`가 내려가야 하고, `stats().hashBytes / activeNodes`가 노드당 상수에서
  변경 페이지 비례로 바뀌어야 한다.
- 선형 세션에서 `setRetentionPolicy({ maxTotalBytes: X })`를 걸면 `stats().totalBytes <= X`가 참이어야 한다.
  **이것이 이 캠페인의 성공 판정이다.**
- 아무것도 안 바꾼 `/home` 커밋은 상수 시간이어야 한다.

## 영향 파일

기존: `src/runtime/memoryCapability.js`, `src/runtime/heapDelta.js`, `src/capabilities/reactive.js`,
`src/capabilities/reactive/retentionPolicy.js`, `src/capabilities/journal/machineJournal.js`,
`src/capabilities/machineHome.js`(06 이후 `capabilities/image/`), `src/session/session.js`,
`src/machine/composition/workerHostedGuestWorker.js`, `src/machine/persistence/indexedDbMachineStore.js`,
`src/state/objectModel.js`, `CHANGELOG.md`, `tests/browser/perfBudget.json`

신규: 없음(기존 계약의 재정의)

## 검증

- 전 게이트: `npm test`, `test:types`, `test:package`, `test:browser`, `test:installed`, `test:golden`,
  `test:web-computer`, `test:examples`, `test:web-machine`
- attempts 실측 기록이 커밋 메시지에 인용된다

음성 시험

- **보존 정책 회수**: 선형 체크포인트 K회 뒤 정책을 걸고 `stats().totalBytes <= X`를 단정한다. rebase를
  no-op으로 만들면 RED가 되어야 한다. 이 단정이 지금은 존재하지 않으므로, 03에서 미리 만들어 둔 자리에
  들어간다.
- **rebase 정확성**: rebase 전후로 임의 (j, page)에 대한 목표 바이트가 같은지 property 시험으로 대조한다.
  병합 방향을 뒤집은 사본이 RED가 되어야 한다(가까운 조상이 이기는 규칙).
- **h0 거부**: 옛 포맷 저널을 새 코드로 열면 `PYPROC_REPLAY_MISMATCH`가 나오고, 그 오류가 무엇을 해야
  하는지 말하는지 확인한다. 조용히 반쯤 읽히면 RED.
- **`/home` dedupe**: 아무것도 안 바꾼 커밋의 `home.wrote`가 0인지, 1바이트 바꾼 커밋이 그 파일만 쓰는지
  단정한다.
- **IDB 마이그레이션**: v2로 쓴 저장소를 v3 코드로 열어 왕복이 성립하는지 본다.

## 롤백

포맷 브레이킹이므로 롤백은 릴리즈 되돌리기다. 그래서 이 캠페인은 한 릴리즈에 모아 내고, CHANGELOG의
Breaking 절에 마이그레이션 지시를 함께 낸다. 커밋 단위 롤백이 가능한 것은 1(h0 계산 통합)뿐이다.

## 커밋 분할

1. h0 계산 통합(브레이킹 아님, 선행)
2. 믹서 최적화 + 단일 순회 통합
3. 희소 해시 + 예산 재기준화
4. `rebaseTo` + 보존 정책 재배선 + 회수 단정
5. `/home` 파일 단위 CAS
6. IndexedDB 스키마 v3 + 마이그레이션
7. 릴리즈 커밋(버전 +1 + 태그, 같은 커밋)
