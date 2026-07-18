# 03. 진행 원장 - state-kernel

결정 기록은 위가 과거, 아래가 최신. 재개 지점(NEXT)은 항상 마지막 줄.

## 2026-07-18 - 이니셔티브 개설

- 다섯 렌즈(시스템 아키텍처, 라이브러리 표면, 반증, 플랫폼 궤적, 메커니즘 지형)의 독립
  검토 + 상호 반박 + 종합 판정으로 방향 확정. 판정의 하중 지지 사실 3건을 별도
  재검증했다: machine 층 `collectDelta` 호출 0건, ECDSA 스택 2벌
  (session/machineSignature.js, machine/image/webMachineTrust.js), 루트 export 실물 37개.
- 확정 방향: 이중 구역 상태 커널(휘발 index + 내구 CAS 리포, 승격 관문 `collectDelta`
  한 점) + 표면 원자 개편(porcelain 핸들 + plumbing subpath 3+1). 상세는
  [00](00-product-vision.md)/[01](01-architecture.md)/[02](02-phasing-and-wiring.md).
- 기각 13건을 [00-product-vision.md](00-product-vision.md)에 사망 기록으로 보존(재상정 차단).
- 코드 착수 0. 표면·저장 포맷 불변.

NEXT: 착수 전 정합성·ROI 재검(플랜 무비판 실행 금지) -> 통과 시
`tests/attempts/stateKernel/` 캠페인 개설(README에 가설·게이트 명문화, probe 1~3부터).
