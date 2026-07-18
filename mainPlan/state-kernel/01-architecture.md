# 01. 아키텍처 - 이중 구역 상태 커널

## 층 배치

`src/state/`를 **runtime과 capabilities 사이**에 신설한다. runtime 구역(rank 0-1) 배치는
기각됐다: ref/fencing이 플랫폼 관심사와 접촉하므로 엔진 core 구역에 살 수 없다.
커널은 두 부분으로 갈라진다:

- **순수 오브젝트 모델**: 순수 함수, 브라우저 전역 접근 0, cryptoProvider 매개변수화.
- **store 계약 위의 ref 프로토콜**: backend(OPFS/IndexedDB/기타)는 전부 주입.

커널 자신이 machine 순수 게이트와 같은 규율을 받는다. 이 불변식을 구조 게이트로 세우지
않으면 통합이 결합으로 역전된다(god layer의 기계 차단).

## 내구 구역: 오브젝트 4종

- **blob**: sha256 내용주소 바이트. 모양 불문이다 - 균일 64KiB 힙 페이지, homePack,
  machine device payload, guest 스냅샷이 전부 같은 blob이다. 주소 형식은 `sha256:<hex>`
  하나로 통일(알고리즘 자기 기술형이 공개 파일 포맷의 장기 계약에 강하다). store 내부
  파일명 인코딩(`blob/<hex>` 등)은 주소가 아니라 드라이버 세부로 격하한다. 현재의
  bare hex / `sha256:` 접두 2벌은 종료.
- **tree**: 타입 있는 엔트리 `page | file | payload`. pageTable(pageIndex -> digest +
  heapLen/sp)은 힙 커밋 전용이고, machine generation은 payload 엔트리로 기술된다.
  machine 층이 `collectDelta`를 소비하지 않는다는 확인 사실이 타입 분화의 근거다:
  한 오브젝트 모델이지만 한 모양이 아니다. 타입으로 가르지 않으면 tree가 특수 케이스
  덕지덕지의 새 서식지가 된다.
- **commit**: `{parents[], tree, 환경 지문, fence, createdAt}`. 환경 지문 = h0(리플레이
  경계 지문) + engineAssetDigest(엔진 자산 sha256 핀) + 결정성 모드. 이로써 fork·부활
  결정성은 upstream 우연에서 "커밋 헤더에 핀되고 open/fork 선행 검증 + 리플레이 발산
  게이트로 감지되는 계약"이 된다. 해결이 아니라 감지다. 커밋 스키마는 **변경 페이지
  집합만 가정하고 해시 배열의 존재를 가정하지 않는다**(감지기는
  [MemoryCapability](../../src/runtime/memoryCapability.js) 뒤에서 교체 가능해야 한다).
- **signedTag**: ECDSA P-256 서명 = 출처. 서명·검증 코드는 cryptoProvider 매개변수화된
  한 벌로 통합하고 현행 2벌([machineSignature.js](../../src/session/machineSignature.js),
  [webMachineTrust.js](../../src/machine/image/webMachineTrust.js))과 키 API 2벌을 종료한다.
  적대 입력 파서 2벌 = 취약면 2배는 `.pymachine` v1 헤더 변조 적발 이력이 실증한다.

## ref 층: fence 선택형 ref CAS 하나

쓰기 순서 법(payload 먼저, 인덱스 다음, ref 마지막, ref 갱신 전 PREV 보존)과 후퇴
판정(corruption만 PREV 후퇴, environment mismatch는 즉시 예외)을 커널 불변식으로 소유한다.

- 단일 탭 저널은 fence 없이 쓴다([kernelElection.js](../../src/session/kernelElection.js)의
  Web Locks가 이미 단일 컨트롤러를 구조 보장).
- 멀티탭 machine group은 ownerId/epoch fence를 ref 갱신 전제조건 훅으로 쓴다.
- 원자성 구현(OPFS 원자 파일 교체 vs IndexedDB 트랜잭션 CAS)은 backend 책임(누수 추상화 방지).
- **PREV는 깊이 2 고정.** reflog window 일반화는 기각(측정된 필요 없음).

## 복구 의미론 2축 (1급 의미)

- **corruption**: digest 불일치. PREV 후퇴 가능.
- **environment mismatch**: h0/엔진 지문 불일치. `PYPROC_REPLAY_MISMATCH`, 후퇴 금지 즉시 예외.

이 구분을 한 오류 축으로 뭉개면 다른 엔진의 저널로 부활하는 힙 오염이 복구로 위장된다.
[machineJournal.js](../../src/capabilities/machineJournal.js)에 이미 실재하는 이 구분을
커널 계약으로 승격한다.

## gc

"ref 도달 가능성 = liveness" 단일 gc.
[journalBlobStore.js](../../src/capabilities/journalBlobStore.js) `packLive`의 크래시 안전
순서(데이터 먼저, 인덱스 교체, loose 삭제 마지막)를 커널 불변식으로 승격하고,
[generationRetention.js](../../src/machine/persistence/generationRetention.js)을 같은 gc의
정책 파라미터로 흡수한다.

## 휘발 구역: 커널의 index 층

[reactive.js](../../src/capabilities/reactive.js)의 체크포인트 나무는 커밋이 아니라 git의
index/working tree다. 이 위상 정정이 이번 검토의 가장 중요한 단일 결론이다.

- 정체성 주소(인덱스) + 64비트 interleave 페이지 해시로 산다. sha256을 모른다.
  `restoreLive`의 재해싱 0 경로와 `execSeq` 경계 계약은 그대로다.
- **`collectDelta`가 유일한 승격 관문이다.** 이미
  [session.js](../../src/session/session.js)와 machineJournal이 정본으로 공유 호출하는
  실물 구조를 계약 + 음성 시험 게이트로 명문화한다: 힙 델타를 독자 수집하는 코드 출현 시
  RED, 실행 경계·fork 경로에 암호 해시 유입 시 RED. sha256은 승격(내구 경계 진입)
  시점에만 lazy 계산한다. churnProbe 실측(커밋 빈도가 총 쓰기량을 지배, 유휴 배치로 총
  쓰기 88% 감소)이 이 경계의 물리적 근거다.
- **fork/forkMany는 커널 밖이다.** harvest 델타의 SAB N레인 방송은 내구성 이득 0인 RAM
  핫패스이며 `packPages` 인코딩만 커널과 공유한다. "fork = commit의 clone" 표현은 통합의
  함정으로 판정됐다.

## 흡수 지도 (삭제가 아니라 강등)

| 현행 | 통합 후 정체 |
|---|---|
| reactive (base + deltas + parents[]) | 커널의 휘발 index 층 + 경계 정책. 코드 대부분 불변, 위치만 계약화 |
| journalBlobStore + machineJournal | OPFS store 드라이버 + 유휴 커밋 정책(idleMs/execSeq). CAS·ref·verify는 커널로 하강 |
| session (.pymachine, 리플레이) | bundle 입출력 + 리플레이 정책. 봉투는 "base commit(h0 루트) + 델타 오브젝트 + signedTag"의 bundle 동형 |
| machineCommitCoordinator + indexedDbMachineStore | IndexedDB store 드라이버 + paused-commit 정책 + fence 발급. 오케스트레이션만 보유 |
| machineSignature + webMachineTrust | signedTag 서명 코어 한 벌의 두 호출부, 이후 한 벌 |
| generationIntegrity + contentDigest | cryptoProvider 매개변수화된 digest 코어 하나(verify-on-read 포함) |

machine 층의 정체는 "v86 통합"에서 **"커널의 guest 일반화"**로 재정의한다:
[adapterContract.js](../../src/machine/contracts/adapterContract.js)의 snapshot()/restore()가
커널의 port이고, 어떤 guest든 그 port만 내면 같은 커밋 그래프·같은 bundle·같은 fencing에
들어온다. v86 어댑터 17파일은 글루다.

## machine 경계와 배달 방식

machine 경계 게이트(밖으로의 import는 composition 한 점, 내부는 주입 관용구)는 유지한다.
machine이 커널을 import하는 것이 아니라, **composition이 machine의 store를 커널의 backend로
꽂는다.** 의존 방향이 역전되므로 inner platform이 되지 않는다. machine 내부가 필요로 하는
순수 기능(digest 코어, 서명 코어, ref 순서 법)은 기존 cryptoProvider 관용구의 확장인
함수 크기 주입으로 배달한다.

## 오류 계약

클래스 병합과 상속 병합 모두 기각. 확정:

- 클래스는 층별 2벌 유지(PyProcError, WebMachineError - 레이어 계약 문면 보존).
- code 공간은 단일 레지스트리: index.d.ts 유니온 + 전 코드 표 1개(docs/reference) +
  무코드 오류 출하 게이트의 전 층 확장.
- machine이 하위 능력을 감쌀 때의 code 변환 지점은 레지스트리 표에 매핑 규칙으로 명시한다.
