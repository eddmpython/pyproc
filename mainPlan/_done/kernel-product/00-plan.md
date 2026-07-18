# 00. 계획 - 하나의 커널, 하나의 제품

## 무엇을, 왜

state-kernel이 세운 커널은 저널·세션·표면까지 내려왔지만 machine 지속층은 절반(암호 법)만
내려왔고, 봉투는 둘(.pymachine측 bundle, .webmachine 자기 포맷)이며, VirtualOrigin은 표면
밖으로 밀려 드리프트 위험을 남겼다. 이 이니셔티브는 그 미해결을 정면으로 닫고, 닫힌 체제
전체를 소비하는 제품 하나(Web Computer v2)로 통합을 실증한다. 판정 기준은 물건 자체다:
계약이 지켜지는가, 비용이 측정되는가, 구조가 원칙대로 서는가.

## 단계와 게이트

### P1. bundle header-target 서명 (설계 긴장의 해소)

- 문제: 현 bundle tag는 전신(unsigned body) 서명이라 신뢰 거부 전에 전체 판독이 필요하다.
  .webmachine의 계약(payload 접촉 전 신뢰 거부, probe가 slice 수로 증명)과 충돌한다.
- 해소: tag.target = canonical 헤더(tag=null, 오브젝트 주소·길이 색인 포함)의 다이제스트.
  내용주소가 오브젝트를 개별 봉인하므로 헤더 서명으로 충분하다(git tag 동형). 봉투
  다이제스트(전신)는 무결성 축으로 유지한다. PYBUNDLE1은 미게시(npm 0.0.9에 없음)라
  포맷 변경에 legacy 부담이 없다.
- 게이트: attempts/stateKernel probe 5 - 헤더만 읽고(접두 슬라이스) 신뢰 거부가 성립하고
  payload 바이트를 읽지 않았음을 slice 계수로 실측. 변조 3종(헤더·오브젝트·tag) 전부 거부.
  기각 기준: 헤더 서명이 오브젝트 치환을 못 잡는 시나리오가 하나라도 실증되면 전신 서명 유지.

### P2. machine generation = 커널 commit (스키마 통일)

- coordinator의 자기 manifest 스키마를 커널 오브젝트로 교체한다: 스냅샷 payload = blob,
  머신·장치 레코드(adapterId 등 도메인 메타) = payloadTree 엔트리 meta, generation record =
  commit(fence + parents = 직전 generation). store의 단일 트랜잭션 CAS(owner + expectedHead)는
  backend 원자성으로 그대로 두고(원자성은 backend 책임), 저장·무결성 판정은 커널 문법이 한다.
- retention(gc)은 commit -> tree 걷기로 blob 도달 가능성을 계산한다(법은 동일, 입력만 커널).
- 게이트: machineStoreContract·generationContract probe 전부 GREEN(검사 의미 보존),
  torn commit·CAS 경쟁·stale fence·RECOVERABLE_CODES 후퇴 의미론 보존, 제품 게이트 GREEN.
  구 generation 스키마의 recover 호환은 두지 않는다(.webmachine과 달리 IndexedDB generation은
  제품 로컬 상태이고 미게시 표면이다 - 브레이킹 릴리즈 범위 내. 단 제품 게이트로 신 스키마
  저장·복구 E2E를 실증한다).

### P3. .webmachine = 단일 bundle

- webMachineFile의 writer를 bundle 인코딩(주입 코덱: machineCryptoProvider 확장)으로 교체.
  reader는 P1의 헤더 선행 검증으로 payload 접촉 전 신뢰 거부를 보존하고, 구 WEBMACHINE1은
  감지형 reader로 읽기만 지원(일몰 명시). manifest content = bundle meta, blob = 오브젝트.
- 게이트: machineEnvelopeProbe의 전 검사(조기 거부 slice 계수 포함) GREEN, 제품 export/import
  E2E GREEN, 구 .webmachine fixture reader 호환.

### P4. VirtualOrigin 재노출

- runtimeBindings에 enableVirtualOrigin을 추가해 `machine.runtime.enableVirtualOrigin(...)`로
  공개 도달 경로를 복원한다. 예제(serverDev)와 소비자 게이트의 SW 내부 프로토콜 인라인을
  공개 경로 소비로 되돌린다(드리프트 위험 제거).
- 게이트: serverDev 예제·productConsumer의 해당 검사 GREEN, d.ts·api.md 동기.

### P5. 통합 제품 - Web Computer v2

- 하나의 앱이 전 산물을 소비한다: porcelain 파이썬 머신(핸들 run + history 체크포인트/undo +
  proc 병렬 실행 패널 + term 터미널), Linux dual-guest, durable commit(P2 커널 스키마),
  signed 단일 bundle export/import(P3), 멀티탭 단일 owner. 제품 코드는 공개 표면
  (루트 + pyproc/history + pyproc/machine + pyproc/assets)만 소비한다.
- 게이트: webComputerProduct E2E(기존 13 검사 + 신설: python history undo, proc 병렬,
  터미널 왕복, bundle 이동), 제품 소비 경계 게이트(공개 표면만) GREEN.

## 기각·중단 기준

- P1 기각 시 P3은 전신 서명 유지로 축소 진행(조기 거부 계약은 구 포맷 유지로만 성립).
- P2에서 store 트랜잭션 원자성과 커널 문법이 충돌하는 실측이 나오면 스키마 통일을 기각하고
  근거를 원장에 남긴다(암호 법 위임까지가 상한).

## 영향 파일(전수)

P1: src/state/bundleFormat.js, src/session/session.js, tests/run.mjs, tests/browser/gate.html,
docs/reference/bundleFormat.md, tests/attempts/stateKernel/(probe 5).
P2: src/machine/persistence/{machineCommitCoordinator,generationRetention,indexedDbMachineStore,
memoryMachineStore}.js, src/state/objectModel.js(payloadTree meta), machine/index.d.ts,
tests/webMachine/(contracts, generationContract probe), apps/webComputer.
P3: src/machine/image/{webMachineFile,machineEnvelopeCoordinator}.js,
src/machine/composition/machineCryptoProvider.js, machineEnvelopeProbe, apps/webComputer.
P4: src/composition/runtimeBindings.js, src/composition/runtimeApi.js, index.d.ts,
examples/serverDev.html, tests/browser/productConsumer.mjs, docs.
P5: apps/webComputer/*, tests/browser/webComputerProduct 관련.
