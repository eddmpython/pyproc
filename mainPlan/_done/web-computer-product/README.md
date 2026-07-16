# Web Computer Product

> ✅ 완료 (2026-07-16): Python OS와 Linux를 한 제품 화면에서 실행하고, 두 guest의 memory·block file을 함께 저장·복구하며 signed `.webmachine`으로 새 browser profile에 이동하는 동선을 닫았다.

상태: 완료.

Web Machine의 검증용 probe를 사용자가 직접 여는 제품 표면으로 연결한다. 제품 코드는 pyproc `src/`와 분리한 `apps/webComputer/`에 두고, 독립 Web Machine package의 공개 root만 소비한다.

## 완료 조건

1. Python OS와 Linux를 한 화면에서 부팅·일시정지·재개·종료한다.
2. Python 코드와 Linux 명령을 실제 guest에 입력하고 결과를 화면에서 확인한다.
3. 두 guest의 memory와 block-backed file을 한 IndexedDB generation으로 저장하고 브라우저 재시작 뒤 복원한다.
4. 두 guest와 disk를 서명된 `.webmachine`으로 내보내고 새 browser profile에서 명시적 trust 뒤 가져온다.
5. engine, firmware, guest image는 해시 고정 catalog에서 준비하며 제품 source와 package에는 binary를 넣지 않는다.
6. 깨끗한 browser profile의 제품 동선 E2E와 전체 회귀 게이트가 통과한다.

완료 실측: 제품 부팅 6,988ms, 첫 사용과 durable commit 707ms, browser process restart 뒤 boot 없는 복원과 export 1,063ms, 65,001,684-byte signed image의 fresh-profile import 4,277ms. 제품 E2E GREEN 9/9.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 사용자 결과와 제품 경계.
2. [01-architecture.md](01-architecture.md) - 제품 조립 계층과 영속·신뢰 흐름.
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - 구현 순서와 기계 게이트.
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정과 실측 원장.
