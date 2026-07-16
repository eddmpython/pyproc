# 00. 제품 비전

## 문제

현재 Web Machine은 정상 동선에서 강하다. 두 guest의 lifecycle, content-addressed generation, single owner, signed image와 fresh-profile import가 실제 브라우저에서 성립한다. 그러나 운영급 컴퓨터는 정상 동작보다 다음 질문에 답해야 한다.

1. 타입을 믿고 구현한 소비자가 런타임에서 같은 값을 받는가.
2. owner가 바뀌는 정확한 순간에도 이전 탭이 HEAD를 전진시킬 수 없는가.
3. 새 image가 절반만 복원되면 사용 중이던 컴퓨터가 그대로 남는가.
4. 수백 번 저장해도 복구 가능한 두 generation만 남기고 안전하게 정리되는가.
5. 페이지 종료와 timeout이 긴 작업을 중단할 때 결과를 성공, 취소, 불명으로 정확히 말하는가.

현재 답은 부분적이다. 구조는 올바르지만 일부 보장이 문서나 주변 조정에만 있고 최종 mutation 계약에는 박혀 있지 않다.

## 사용자 결과

완료 뒤 사용자는 다음을 얻는다.

- 다른 탭이 owner를 승계한 뒤 이전 탭의 늦은 저장이 현재 컴퓨터를 덮어쓰지 않는다.
- 손상되거나 호환되지 않는 image뿐 아니라 restore 도중 engine이 실패해도 원래 컴퓨터로 즉시 돌아간다.
- 자동 Save를 오래 사용해도 IndexedDB가 과거 전체 snapshot으로 무한히 증가하지 않는다.
- 닫기, timeout, 명시적 취소 뒤 저장 여부를 추측하지 않고 정확한 상태를 확인한다.
- 타입 선언을 보고 작성한 소비 코드가 런타임의 key와 오류 의미를 그대로 받는다.

## 절대 불변식

### 계약 진실성

- 공개 타입, 런타임 반환 형태, 오류 code 중 하나만 바뀌는 변경은 허용하지 않는다.
- `GenerationHead`의 정본 key는 `head`, `prev`, `ownerEpoch`다.
- 존재해야 하는 content-addressed blob이나 generation이 없으면 `null`이 아니라 구조화 오류를 던진다.
- collection 입력은 실제 지원하는 `ReadonlyMap` 또는 record로만 선언한다. 임의 `Iterable`을 약속하지 않는다.

### durable owner fencing

- Web Lock은 실행 owner를 하나로 만드는 liveness 장치다.
- IndexedDB의 owner record는 durable mutation 권한의 정본이다.
- owner token 검증과 HEAD CAS가 다른 transaction이나 다른 database에 있으면 합격이 아니다.
- v2 commit은 blob, generation, HEAD를 같은 transaction에서 publish한다. 현재 token이 아닌 caller는 어느 것도 publish하지 못한다.

### context 원자성

- untrusted header inspection, signature와 blob integrity 검증, capability preflight는 현재 context를 건드리지 않는다.
- candidate는 별도 host, device, machine, output sink를 가진다.
- candidate가 paused restore와 resume readiness를 모두 통과하기 전에는 active context pointer를 바꾸지 않는다.
- 교체 실패 시 candidate만 정리하고 기존 context의 원래 running set과 UI subscription을 복구한다.

### retention 안전성

- 모든 group의 HEAD와 PREV는 root다.
- root generation이 참조하는 blob은 공유 여부와 관계없이 삭제하지 않는다.
- generation과 blob sweep은 HEAD 조회와 같은 IndexedDB readwrite transaction 안에서 수행한다. commit도 같은 object store 집합을 잠그므로 in-flight blob을 sweep할 수 없다.
- 정리 실패는 이미 성공한 commit을 실패로 바꾸지 않는다. 다음 startup 또는 commit이 정리를 재시도한다.

### 종료 결과 진실성

- mutation 시작 전에 중단되면 `WEB_MACHINE_OPERATION_ABORTED`다.
- 이름 있는 budget이 만료되면 `WEB_MACHINE_OPERATION_TIMEOUT`이다.
- side effect의 선형화 여부를 증명할 수 없으면 기존 `WEB_MACHINE_OUTCOME_UNKNOWN`을 사용하며 자동 replay하지 않는다.
- CAS transaction 완료 뒤 들어온 abort는 성공한 commit을 취소로 바꾸지 않는다.

## 성공 지표

1. store contract fixture가 memory와 IndexedDB 구현에 같은 suite를 적용하고 반환 key, 오류 code, 복사 격리를 모두 통과한다.
2. delayed old-owner commit과 successor claim을 경쟁시켜 old commit 성공 0, stale 오류 1, successor HEAD 보존 1을 확인한다.
3. import의 device restore, 첫 machine restore, 둘째 machine restore, candidate resume, context activation 각 지점에 실패를 주입해 기존 Python/Linux 값과 generation이 모두 유지됨을 확인한다.
4. 고유 payload로 20회 commit한 뒤 group별 generation은 HEAD/PREV 두 개만 남고 unreachable blob은 0이며 두 generation 모두 cold restore된다.
5. lock, commit, restore, export, import의 지연 fixture가 abort 뒤 250ms 안에 정해진 오류로 종료되고 pending operation과 listener가 0이 된다.
6. Web Computer의 boot, run, save, process restart, export, fresh-profile import 9개 제품 check와 전체 browser 회귀가 그대로 통과한다.

## 실패 또는 축소 기준

다음 중 하나가 발생하면 완료로 판정하지 않는다.

1. epoch fencing을 위해 core가 IndexedDB나 Web Lock을 알아야 한다.
2. context rollback을 위해 guest별 분기가 제품 runtime 또는 browser package에 들어간다.
3. retention이 HEAD 또는 PREV 복구 가능성을 줄인다.
4. timeout을 구현하면서 성공한 CAS를 취소로 보고하거나 불명 결과를 자동 재시도한다.
5. hotspot 분리가 이름 없는 `utils`, `helpers`, `manager` 모듈을 늘린다.
