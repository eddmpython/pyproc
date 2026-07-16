# Web Machine Hardening

상태: 활성.

Web Machine의 좋은 package 경계는 유지하면서 공개 계약 정합성, durable owner fencing, 원자적 context 교체, generation retention, 장시간 작업 종료 경계를 운영급 불변식으로 닫는다.

## 한 문장

**성공 경로가 아니라 실패 경로에서도 현재 컴퓨터와 마지막 완료 generation을 잃지 않는 Web Machine을 만든다.**

## 왜 지금

Web Computer는 Python OS와 Linux를 실제로 실행하고 저장, 프로세스 재시작 복구, signed image 이동까지 통과했다. 다음 병목은 기능 수가 아니다. 타입 선언과 런타임의 차이, owner epoch와 최종 CAS 사이의 분리, import 중간 실패의 비원자성, 누적 blob 정리 부재, 장시간 작업 취소 계약 부재가 장기 운영 신뢰도를 제한한다.

이 이니셔티브는 새 기능을 추가하지 않는다. 이미 성립한 구조가 실패와 장기 사용에서도 같은 보장을 유지하도록 다듬는다.

## 완료 조건

1. `@web-machine/core`, `@web-machine/browser`, 두 guest package의 공개 타입과 런타임 반환값, 오류 계약이 같은 conformance gate를 통과한다.
2. generation commit은 현재 `OwnerToken`을 필수로 받고, owner record와 HEAD를 같은 IndexedDB readwrite transaction에서 검증한다.
3. successor가 epoch를 올린 뒤 이전 token의 generation publish, HEAD CAS, prune은 모두 `WEB_MACHINE_OWNER_STALE`로 거부된다.
4. import와 restore candidate가 어느 단계에서 실패해도 기존 running context, 화면 구독, block 상태와 HEAD가 그대로 유지된다.
5. HEAD와 PREV가 참조하는 generation과 blob은 절대 삭제하지 않고, 그 밖의 generation과 orphan blob을 원자적으로 정리한다.
6. lock 대기, commit, restore, export, import가 `AbortSignal`과 이름 있는 timeout budget을 받고 종료 결과를 거짓 없이 구분한다.
7. `WebComputerRuntime`은 제품 lifecycle facade로 축소되고 context 생성과 교체가 이름 있는 모듈로 분리된다. v86 adapter의 serial 대기 책임도 별도 port로 분리된다.
8. 구조 gate, store contract, owner race, rollback fault injection, retention, cancellation, 제품 E2E와 전체 browser 회귀가 모두 GREEN이다.

## 비목표

- 새 guest OS, 새 device kind, Linux network 기능을 추가하지 않는다.
- pyproc 공개 API에 Web Machine을 편입하지 않는다.
- Linux image provenance와 공개 재배포 문제를 이 이니셔티브에 섞지 않는다.
- 성능 수치를 위해 durability나 PREV 복구 창을 줄이지 않는다.
- private Web Machine package를 공개 release하지 않는다.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 사용자 결과, 불변식, 성공과 중단 기준.
2. [01-architecture.md](01-architecture.md) - 통합 fenced store, context transaction, retention과 operation control 설계.
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - 구현 순서, 영향 파일, failure injection, 롤백과 완료 gate.
4. [03-progress-ledger.md](03-progress-ledger.md) - 확인된 간극, 결정과 최신 NEXT.

재개 시 [03-progress-ledger.md](03-progress-ledger.md)의 최신 `NEXT`부터 시작한다.
