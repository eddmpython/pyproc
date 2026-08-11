# Browser Automation Product - screenshot과 artifact를 설치형 제품으로 전달할 수 있는가

## 가설

Chrome과 Edge의 CDP primitive만으로 viewport, full-page, clip screenshot을 PNG, JPEG, WebP로
일관되게 캡처할 수 있다. content size를 먼저 읽고 capture 범위를 제한하면 제품 artifact quota를
capture 전에 적용할 수 있다. 이 primitive를 broker-owned store와 npm CLI에 결합하면 repository
checkout 없이도 bounded artifact 자동화를 제공할 수 있다.

## 졸업 게이트

- Chrome과 Edge에서 viewport PNG, full-page PNG, clip PNG, JPEG, WebP signature가 모두 pass한다.
- full-page content height가 viewport height보다 크고 CDP layout metric으로 capture 범위를 정한다.
- screenshot byte가 base64에서 정확히 복구되고 각 format의 최소 signature를 만족한다.
- 승격 구조가 product launcher, artifact store, screenshot action, installed CLI gate로 분리된다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-11 | 기존 `browserObserve` | Chrome, Edge | viewport PNG와 bounded base64 | primitive 일부 통과, 설치와 artifact 수명 없음 | format과 full-page probe 실행 |
| 2026-08-11 | `probe.mjs` 1차 | Chrome | CDP 응답 envelope 오판으로 0/2 | probe 판독 오류, 제품 primitive 판정 전 | 실제 `CdpConnection` 반환 계약으로 수정 |
| 2026-08-11 | `probe.mjs` 2차 | Chrome | 7/7, PNG/JPEG/WebP와 full-page/clip | Chrome primitive 통과 | Edge 대조 |
| 2026-08-11 | `probe.mjs` 2차 | Edge | load 대기 deadline 공유로 0/2 | 느린 시작에서 probe가 조기 진행 | 독립 load와 30초 command deadline 적용 |
| 2026-08-11 | `probe.mjs` 3차 | Edge | 7/7, PNG/JPEG/WebP와 full-page/clip | 양 브라우저 primitive 통과 | 정식 제품 구조로 승격 |

## 모듈화 설계

- process와 profile은 `browserLauncher.mjs`가 소유한다.
- capture parameter와 format 검증은 `browserScreenshot.js`가 소유한다.
- bytes, quota, TTL, chunk와 delete는 `browserArtifactStore.js`가 소유한다.
- ordered action과 MCP tool은 catalog와 `mcpBrowserControl.js`가 조합한다.
- 공개 JS root/subpath는 늘리지 않고 npm bin `pyproc-mcp`가 설치 실행 표면이 된다.

## 판정

졸업 자격 확보, 정식 제품 게이트 구현 중
