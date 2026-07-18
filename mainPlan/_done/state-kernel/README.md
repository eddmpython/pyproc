# state-kernel - 이중 구역 상태 커널과 표면 재편

> ✅ **완료 (2026-07-18).** 0~7단계 전부 구현·봉인: 상태 커널 신설, 저널·봉투 재기초, machine 암호 위임, porcelain 표면 일격(루트 6 + pyproc/history), 문서 동시 개정. 게이트 전판 GREEN, 신설 게이트 음성 시험 7건. 잔여 후속 4건(bundle header-target probe 등)은 [03-progress-ledger.md](03-progress-ledger.md) 말미가 정본.

pyproc을 "역사를 가진 브라우저 컴퓨터"라는 단일 개념으로 세우는 이니셔티브.
네 층에 흩어진 저장·복원·이동·신뢰 구현(저널, 세션 이미지, machine generation, 서명 2벌)을
**이중 구역 상태 커널**(휘발 index 층 + 내구 내용주소 리포, 승격 관문은 `collectDelta` 한 점)로
통합하고, 공개 표면을 머신 핸들 하나에서 파생되는 역사 동사(porcelain/plumbing 2층)로 재편한다.

다섯 렌즈(시스템 아키텍처, 라이브러리 표면, 반증, 플랫폼 궤적, 메커니즘 지형)의 독립 검토와
상호 반박을 거쳐 확정한 판정이 원본이며, 기각된 방향 13건은 재상정 차단용으로 본문에 보존한다.

## 문서

- [00-product-vision.md](00-product-vision.md) - 체제 선언, 왜 지금인가(중복 전수 목록), 성공·실패 기준, 기각 기록, 남는 실패
- [01-architecture.md](01-architecture.md) - 이중 구역 상태 커널: 오브젝트 모델, ref 프로토콜, 복구 의미론, 흡수 지도, 경계 규율
- [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - 0~7단계, 단계별 게이트, 표면 원자 개편, 영향 파일, 롤백
- [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장. 재개 지점(NEXT)은 항상 마지막 줄

## 상태

완료(2026-07-18). 마지막 상태와 잔여 후속은 [03-progress-ledger.md](03-progress-ledger.md).
