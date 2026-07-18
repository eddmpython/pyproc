# 02. 단계와 배선 - attempts부터 표면 일격까지

원칙: 각 단계는 attempts 졸업 게이트를 따른다(브라우저 실측 -> 음성 시험 RED 증명 ->
구 포맷 동등성 -> 다음 단계). 게이트가 닫히지 않으면 다음 단계 착수 금지(이중 진실 기간
최소화). 캠페인은 `tests/attempts/stateKernel/` **하나**다(카테고리 = 개념 캠페인 하나,
증식 금지). 세부 질문은 probe 파일로 늘린다.

## 0단계: attempts 캠페인 stateKernel (실측 선행)

- **probe 1 - 승격 비용 곡선**: `collectDelta` -> sha256 승격의 힙 크기별(128/256/512MB)
  비용 실측. 통과: 승격 비용이 커밋 시점에만 발생하고 `checkpoint()` 경계 비용 회귀 0.
  기각: 커널 시안이 경계 비용을 5% 이상 올리면 그 시안 폐기.
- **probe 2 - 구 포맷 재구성 리허설**: 기존 `.pymachine` v2/v3 봉투, HEAD.json 저널,
  IndexedDB generation을 신 오브젝트 모델로 읽어 힙 바이트 동일성 대조. 통과: 100%.
  실패한 포맷은 이관 착수 금지.
- **probe 3 - ref CAS 프로토콜**: 쓰기 순서 위반(HEAD 먼저, PREV 미보존)과 fence
  위반(stale epoch 쓰기)을 고의 주입해 시안이 전부 RED로 잡는지 확인.
- **probe 4 (후보, 방향 아님)**: SAB 전용 해싱 워커의 중첩 해싱. 선행 질문은 torn read
  봉쇄(경계 시점 일관성 확보 방법)이며, 이 답 없이는 게이트 진입 불가.

## 1단계: 법 추출 (결합 최소, 의미 불변)

digest 코어 cryptoProvider 매개변수화([contentDigest.js](../../src/runtime/contentDigest.js) +
[generationIntegrity.js](../../src/machine/persistence/generationIntegrity.js) 통합),
verify-on-read 3벌 단일화, 주소 형식 `sha256:<hex>` 통일. machine 배달은 주입.

게이트: `npm test` + `npm run test:browser` green, 기존 저널·봉투가 그대로 열리는 브라우저
실측, 주소 형식 위반 주입 RED.

## 2단계: src/state/ 오브젝트 모델 + ref CAS 신설

blob / tree(타입 엔트리) / commit(환경 지문 포함) / signedTag + fence 선택형 ref CAS.
순수 집합 게이트(브라우저 전역 접근 0)를 machine 순수 게이트와 같은 방식으로 세운다.
결정성 게이트(엔진 자산 digest 핀 + 리플레이 발산 감지)의 커밋 헤더 필드가 여기서 들어간다.

게이트: fence 위반·순서 위반·corruption/mismatch 판정 오류 각각의 음성 시험 RED,
`tests/run.mjs` 레이어 게이트 개정을 같은 커밋에.

## 3단계: 저널 재기초

[machineJournal.js](../../src/capabilities/machineJournal.js)을 OPFS store 드라이버 + 유휴
정책으로 강등.

게이트: 구 HEAD.json 저널 -> 신 경로 recover -> 힙 바이트 대조 100%, churnProbe 재실행으로
커밋 빈도-쓰기량 법칙 보존(총 쓰기 회귀 0), h0 mismatch 즉시 예외 음성 시험. 이 단계부터
headless 게이트에 결정성 검증 상시 편입.

## 4단계: 봉투·신뢰 통합

서명 코어 한 벌 + bundle 한 포맷. **writer는 즉시 단일화**, 구 포맷(.pymachine v2/v3,
.webmachine)은 `open()`의 포맷 감지 이중 reader로 읽기만 지원하고 일몰 기한을 계약에 명시.

게이트: 구 봉투 리플레이 동등성, 변조 3종(헤더 변조·서명 제거·잘못된 키) 주입 전부 RED,
신 bundle 바이트 레이아웃 문서와 실물의 대조.

## 5단계: coordinator 저장 위임

[machineCommitCoordinator.js](../../src/machine/persistence/machineCommitCoordinator.js)가
저장·무결성을 커널에 위임하고 오케스트레이션(pause -> device flush -> snapshot) + fence
발급만 보유. [indexedDbMachineStore.js](../../src/machine/persistence/indexedDbMachineStore.js)가
커널 backend가 된다.

게이트: 멀티탭 경합 시뮬레이션(Web Locks epoch), stale owner 쓰기 거부 음성 시험,
RECOVERABLE_CODES 후퇴 의미론 보존 확인.

## 6단계: gc 통일

ref 도달 가능성 gc + 크래시 안전 순서의 커널 불변식화.

게이트: 각 쓰기 순서 지점 크래시 주입 후 무손실 recover, live blob 오삭제 0.

## 7단계: 표면 원자 개편 + 브레이킹 릴리즈

**내부는 단계, 표면은 일격이다.** 내부 통합 수렴 후 단일 브레이킹 릴리즈(0.0.x) 1회.

### porcelain (루트 `pyproc`)

- 진입 동사 2개: `createWebComputer`(컴퓨터), `boot`(첫 guest 고속 경로). 둘 다 머신 핸들 반환.
- 핸들 네임스페이스: `machine.run`, `machine.history`, `machine.proc`(fork/map/shard),
  `machine.fs`, `machine.term`.
- `machine.history`는 이중 구역을 어휘로 가른다: `checkpoint/restore`(휘발) vs
  `commit/checkout/open/push/export({sign})`(내구). 휘발 checkpoint 핸들과 내구 commit ref는
  **다른 타입**이고 승격 함수가 명시적이다. 두 구역의 비용 차이를 타입으로 드러낸다.
- `open(source)` 하나로 통합(openMachine/openPersistentMachine/session 로드 소멸). 단
  의미론 평탄화 금지: 소스 종별 trust 계약이 타입으로 갈라진다(자기 OPFS = verify-on-read,
  외부 bundle = 힙 접촉 전 봉투 해시 + 서명 검증 선행, corruption = PREV 후퇴 가능,
  mismatch = 즉시 예외). 이 의미론 보존 자체를 게이트로 세운다.
- 결정적 리플레이 부팅은 **opt-in**이며 선택이 커밋 헤더 환경 지문에 기록된다. 비결정 출신
  커밋에 리플레이 보증이 없음을 open/export가 계약으로 드러낸다. 조용한 보증 소실 금지.
- **비용 영수증**: 모든 상태 동사는 명명된 receipt(`{pages, mb, rehashed, fallback}` 계열)를
  반환한다. 제거 불가능한 O(heap) 비용을 다루는 유일하게 정직한 방법. receipt는
  additive-only 규약이고 `test:types`가 형태를 잠근다.
- 루트 export 37 -> 한 자릿수. `(rt, cfg)` 생성자 클래스 직수출은 폐지하고 핸들로 이사
  (생성자 직수출은 내부 레이어링의 소비자 전가다).
- 적재 비용: 루트 배럴은 얇게(진입 함수 + 타입 + 오류 레지스트리), 능력·machine·guest는
  이미 비동기인 `boot()`/`createWebComputer()` 내부 dynamic import. 부팅 후 핸들 접근은 동기.

### plumbing (subpath 3+1)

- `pyproc/history`: 커널 계약. commit 문법, Store 드라이버 인터페이스 + OPFS/IndexedDB
  드라이버 실물, 신뢰(signedTag). 소비 제품이 자기 저장소를 꽂는 지점.
- `pyproc/machine`: 장치 + guest 어댑터.
- `pyproc/worker`: 워커 자산 URL 계약(번들러 계약상 별도 유지).
- 강등 gpu/socket은 exports 지도에서 내리고 [계약 실태 표](../../docs/operations/contractReality.md)로.
  `./reactive`, `./syscall-bridge`, `./wasi` 등 레이어 폴더 누설 subpath는 소멸.

### 표면 게이트

- index.js 실물 export와 index.d.ts 선언의 1:1 패리티 게이트 + 고의 표류 주입 RED
  (표류 전과 8건이 근거).
- 실행 경계·fork 경로 암호 해시 금지 텍스트 가드.
- 무코드 오류 출하 차단의 전 층 확장.
- Chromium 전용 표기를 브라우저 이름이 아니라 능력 preflight(JSPI + SAB +
  crossOriginIsolated) 계약으로 재작성.

게이트: 패리티 표류 주입 RED, `test:types` green, headless 전 시나리오(boot -> checkpoint ->
commit -> export -> open -> fork -> map) green, index.d.ts·api.md·capabilityMatrix·소비 계약
동시 개정. 릴리즈는 버전 +1 + 태그 동일 커밋(명시 지시 하에).

## 롤백

- 0~1단계: 의미 불변 리팩터라 git revert로 즉시 복귀. 저장 포맷 불변.
- 2단계 이후 각 단계: 구 포맷 reader가 남아 있는 동안은 신 경로 비활성화로 복귀 가능.
  단계 게이트의 "구 포맷 동등성 100%"가 롤백 가능성의 담보다.
- 7단계(표면 일격): 릴리즈 전 커밋까지는 표면 불변이므로 롤백 = 릴리즈 안 함. 릴리즈 후는
  브레이킹 노트가 정본이며 되돌리지 않는다(이중 표면 금지).

## 영향 파일 (전수)

커널 신설: `src/state/`(신규). 강등·재기초:
[reactive.js](../../src/capabilities/reactive.js),
[machineJournal.js](../../src/capabilities/machineJournal.js),
[journalBlobStore.js](../../src/capabilities/journalBlobStore.js),
[session.js](../../src/session/session.js),
[machineImage.js](../../src/session/machineImage.js),
[machineSignature.js](../../src/session/machineSignature.js),
[contentDigest.js](../../src/runtime/contentDigest.js),
[machineCommitCoordinator.js](../../src/machine/persistence/machineCommitCoordinator.js),
[generationIntegrity.js](../../src/machine/persistence/generationIntegrity.js),
[generationRetention.js](../../src/machine/persistence/generationRetention.js),
[indexedDbMachineStore.js](../../src/machine/persistence/indexedDbMachineStore.js),
[webMachineTrust.js](../../src/machine/image/webMachineTrust.js),
[webMachineFile.js](../../src/machine/image/webMachineFile.js).
표면: [index.js](../../index.js), [index.d.ts](../../index.d.ts), `package.json` exports.
게이트: `tests/run.mjs`(레이어·표면·오류·해시 가드), `tests/browser/gate.html`(시나리오),
`tests/webMachine/`(store 계약).
