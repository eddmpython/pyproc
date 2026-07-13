# web-python-runtime - 브라우저 파이썬 런타임 (개발 계획)

> ✅ 완료 (2026-07-13): 코어 런타임 + 운영 체계 + 소비 성립(dartlab 라이브, codaro SHA 핀, xlpod 경로 개방). 계약 실태 표는 [docs/operations/contractReality.md](../../../docs/operations/contractReality.md)로 승격. 진행 원장은 이 폴더의 03-progress-ledger.md가 세션 간 마지막 상태 기록.

상태: 운영 체계 수립 + src 레이어 재구조화 (2026-07-11, v0.0.3). 이 폴더는 pyproc의 제품 방향과 개발 계획의 SSOT다. 공개 문서(README)가 아니라 개발자가 착수 전 읽는 내부 기획이다. 코드가 바뀌면 이 문서도 같은 변경에서 갱신한다.

기원: codaro `mainPlan/codaro-anywhere`의 웹 파이썬 방향에서 런타임 조각을 별도 레포로 분리한 것이 pyproc이다. 그 PRD가 여기로 이관됐다(구 `docs/PRD.md` 포함).

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 이 이니셔티브의 범위와 소비자 실태. (제품 방향의 정본은 [docs/product/vision.md](../../../docs/product/vision.md). 지속 문서는 docs, 여기는 완료 시 `_done`으로 빠지는 개발 계획.)
2. [01-architecture.md](01-architecture.md) - 레이어, 능력, 발명 계보(검증조각 + 실측), 계약 실태(계약 vs 실제), 프론티어(정직한 벽).
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - 소비 정책·배선, 로드맵(승격 후보 + 졸업 게이트 초안), 거버넌스, 롤백.
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장, 세션 간 재개 지점(NEXT). **재개 시 여기부터.**

## 한 줄

**서버 없이 브라우저 탭에서 파이썬을 "노트북 한 셀"이 아니라 운영체제처럼 돌린다. 프로세스·병렬·복원 리액티브를 하나의 재사용 런타임으로 묶어, codaro/dartlab/xlpod가 공유하는 웹 파이썬 런타임의 SSOT가 된다.**
