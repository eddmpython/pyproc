# commitIncremental

저널 커밋 비용을 "직전 변경분"에 비례하게 만든다. 지금은 "부팅 이후 누적 델타"에 비례하고, 그 비용이
`KernelElection`의 autoCommit 때문에 파이썬 문장마다 곱해진다. 공개 계약은 하나도 바꾸지 않는다.

## Outcome brief

- 주 축: 속도, 메모리(동시)
- 관측된 손실 지점: 페이지 하나만 바뀐 커밋도 누적 델타 전량을 slice 복사하고 SHA-256하고 OPFS에 조회한다.
  그 사본은 커밋이 끝날 때까지 JS 힙에 살아 있다.
- 기대 변화: 쓴 페이지당 커밋 비용이 델타 크기와 무관해지고, 커밋 중 JS 상주가 전체 델타에서 페이지 하나로
  내려간다.
- 롤백 반경: 각 항목이 독립 커밋이라 하나씩 되돌릴 수 있다. 다만 쓰기 순서 법을 건드리므로 크래시 게이트가
  선결이다.

## 근거

- `src/capabilities/journal/machineJournal.js:216-234`가 `collectDelta(0, r.liveIdx, { pack: false })`로 **cp0 대비
  누적** 델타를 받고, `pages.map((p) => [p, mem.slicePage(p)])`로 전량 사본을 만든다.
- `src/capabilities/reactive.js:132`의 `collectDelta`가 `hashDiffPages(this.hashes[0], this.hashes[toIdx])`이므로
  기준이 cp0다. 즉 커밋 N회면 총 비용이 N x 누적델타다.
- `src/state/refProtocol.js:56` `for (const [p, bytes] of pages) table.push([p, await putObject(...)]);` -
  페이지마다 SHA-256과 `hasObject`(OPFS 조회)를 **직렬 await**한다. dedupe는 쓰기만 막고 복사/해시/조회는 그대로다.
- `src/session/kernelElection.js:338-345`가 `action === "run"`마다 `_commitJournal()`을 부른다.
- `src/capabilities/journal/journalBlobStore.js:39-63, 65-78`은 연산마다 `getDirectoryHandle(BLOB_DIR)`을 다시
  해석한다. 같은 저장소에 대조 구현이 있다: `src/state/opfsStateStore.js:24-34`는 디렉터리 핸들을 캐시한다.
- `src/state/refProtocol.js:116`(부활)과 `src/state/bundleFormat.js:134-144`(디코드)도 같은 직렬 await 형태다.
- `src/machine/persistence/indexedDbMachineStore.js:180-191, 213-224`는 `byteLength`만 필요한데 `getAll()`로 blob
  전량을 읽고 `copyGenerationBytes(value)`로 한 번 더 복사한다. 두 감사가 독립적으로 같은 줄을 지목했다.

## 입장 조건

- 04가 끝나 `_liveKeys`가 갈라져 있다. 그러지 않으면 증분화가 legacy 갈래까지 함께 만진다.
- 03의 메모리 예산이 서 있다. 커밋 중 상주 감소를 주장하려면 측정이 먼저다.
- **쓰기 순서 법의 크래시 불변식이 게이트로 고정돼 있다.** `src/state/refProtocol.js:11-13`의
  "blob -> tree -> commit -> PREV -> HEAD"가 지금은 주석으로만 산다. 지점별 크래시 주입 게이트가 이 캠페인의
  첫 커밋이다.

## 범위

포함

- 커밋 페이지 표의 증분화(직전 커밋 대비)
- `JournalBlobStore` 디렉터리 핸들 캐시
- 커밋 페이지 사본의 lazy 이터레이션
- 페이지/오브젝트 단위 bounded concurrency
- IndexedDB의 불필요한 `getAll()`과 복사 제거

제외

- 해시 믹서 변경과 희소 해시는 10이다(h0 지문에 닿는다).
- `/home` 파일 단위 CAS도 10이다(포맷 변경).
- `MemoryStateStore`의 방어적 복사 제거는 소유권 계약 변경이라 08에서 계약과 함께 다룬다.

## 구현 계약

1. `src/state/refProtocol.js`의 페이지 루프를 **bounded concurrency map**으로 바꾼다. 상한은 명명 상수로 두고
   출처를 주석에 남긴다(하드코딩 금지). 같은 주소를 동시에 쓰는 경합은 주소별 in-flight Map으로 합류시킨다.
   `counters`의 `pagesWrote`/`deduped` 합계가 직렬판과 같은지 게이트로 굳힌다.
2. `commitState`가 `pages`를 `[p, bytes]` 배열이 아니라 `Iterable<[number, () => Uint8Array]>`로 받게 한다.
   호출자는 페이지 하나를 만들고 쓰고 놓는다. 동시 상주가 델타 전량에서 페이지 하나로 내려간다.
   힙 뷰(`subarray`)로 바꾸는 것은 **하지 않는다** - 커밋 중 힙 성장으로 detach될 수 있다.
3. 저널이 `_lastCommitNode`(reactive 인덱스)와 `_lastPageTable`(page -> address)을 들고, 다음 커밋은 직전 커밋
   대비 변경 페이지만 새로 쓰고 나머지는 주소를 상속한다. 상속 tree의 부모 오브젝트도 live로 잡아야 하므로
   `_liveKeys`의 판정을 tree 체인 walk로 확장한다. **이것을 빠뜨리면 pack이 부모 tree를 지워 세대가 끊긴다.**
4. 3이 크면 먼저 **주소 캐시**만 낸다: `page -> { hashWord0, hashWord1, address }`를 저널이 유지하고,
   `hashes[live]`의 두 워드가 직전 커밋과 같으면 SHA-256과 `hasObject`를 건너뛴다. 힙 해시는 이미 계산돼
   있으므로 추가 비용 0이다. 캐시는 `delete()`와 `recover()`에서 반드시 무효화한다.
5. `JournalBlobStore`에 `_blobDir` 캐시를 둔다. `OpfsStateStore._objects(create)`와 같은 규율을 쓴다
   (생성 이후에만 캐시, 없음 판정은 캐시 금지). `journal.delete()`가 blob 디렉터리를 recursive 삭제하므로
   `JournalKernelStore.resetStorage()`에 blob store 무효화를 함께 배선한다. 이것을 빠뜨리면 delete 후 첫
   커밋이 유령 디렉터리로 간다.
6. `src/machine/persistence/indexedDbMachineStore.js`에서 `copyGenerationBytes(value).byteLength`를
   `value.byteLength`로 바꾸고, 크기만 필요한 자리의 `getAll()`을 `getAllKeys()`/`count()`로 대체한다.
   `reclaimedBytes` 리포트 필드를 유지하려면 크기 색인을 먼저 도입한 뒤 제거한다(순서를 뒤집으면 필드가
   조용히 0이 된다).

## 성능과 메모리 계약

- 지표는 절대 시간이 아니라 **기울기**다. `commitMs / wrote`(쓴 페이지당 커밋 비용)가 델타 크기와 무관해져야
  한다. 아무것도 안 바꾼 커밋은 상수 시간이어야 한다.
- 커밋 중 JS 상주 피크가 `heapLen`에 비례하지 않아야 한다(03의 `memoryBudgets`로 판정).
- `inspectStorage()`의 시간과 피크 힙이 저장된 blob 총량과 무관해야 한다.

## 영향 파일

기존: `src/capabilities/journal/machineJournal.js`, `src/capabilities/journal/journalBlobStore.js`,
`src/capabilities/journal/journalKernelStore.js`, `src/state/refProtocol.js`,
`src/machine/persistence/indexedDbMachineStore.js`, `tests/run.mjs`, `tests/browser/gate.js`,
`tests/browser/perfBudget.json`

신규: 없음(기존 파일 내부 재구성)

## 검증

- `npm test`, `npm run test:browser`, `npm run test:installed`
- 크래시 주입 게이트 green, 카운터 동치 게이트 green

음성 시험

- **크래시 주입(선결 게이트)**: fake store로 쓰기 순서의 각 지점에서 중단을 주입하고, 구 HEAD 세대가
  온전한지 단정한다. 순서를 일부러 뒤집은 사본(tree를 blob보다 먼저 쓰기)이 RED가 되는 것을 본다.
- **카운터 동치**: 병렬화 전후로 `pagesWrote`와 `deduped` 합계가 같은지 단정한다. 합류 Map을 빼면 `wrote`가
  부풀어 RED가 되는 것을 본다.
- **delete 경계**: `delete()` 직후 `commit()` -> `recover()`가 green인지 확인한다. blob 캐시 무효화를 빼면
  RED가 되어야 한다.
- **상속 tree의 live 판정**: 증분 tree를 만든 뒤 `pack()`을 돌리고 `recover()`가 성립하는지 본다. tree 체인
  walk를 빼면 부모가 지워져 RED가 되어야 한다.

## 롤백

여섯 항목을 독립 커밋으로 낸다. 3(상속 tree)이 가장 위험하고 4(주소 캐시)가 같은 효과의 저위험 버전이므로,
3이 문제를 내면 3만 되돌리고 4를 남긴다.

## 커밋 분할

1. 쓰기 순서 크래시 주입 게이트(선결)
2. `JournalBlobStore` 디렉터리 핸들 캐시 + delete 경계 무효화
3. IndexedDB `getAll`과 복사 제거
4. 페이지 lazy 이터레이션
5. bounded concurrency + 카운터 동치 게이트
6. 주소 캐시(4번 안), 그 뒤 상속 tree(3번 안)
