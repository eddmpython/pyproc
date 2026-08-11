# browserScreenshotStability - 장기 Chrome session의 screenshot 무응답을 복구할 수 있는가

## 가설

이미지 인코딩이 아니라 특정 target 상태와 surface capture의 결합이 무응답을 만든다. 최소 prefix를 찾고
read-only capture를 별도 bounded 경로로 다시 시도하면 외부 효과 중복 없이 제품 deadline 안에 끝낼 수 있다.

## 졸업 게이트

Chrome와 Edge에서 baseline과 최소 trigger 뒤 PNG 캡처를 각각 수행한다. trigger가 Chrome 무응답을 재현하고,
수정 뒤 두 브라우저 모두 30초 안에 유효 PNG 또는 판정 가능한 오류를 반환해야 한다. 정식 66개 게이트도
같은 Chrome에서 GREEN이어야 한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-12 | 정식 browser-control gate | Chrome Windows | action prefix 뒤 capture 240초 timeout, 설치 제품 3종 GREEN | 장기 session 전용 결손 재현 | 최소 trigger 이분 탐색 |
| 2026-08-12 | screenshotStabilityProbe | Chrome Windows | 허용 popup 생존 + 거부 popup close 뒤 10초 timeout, 둘 중 하나를 빼면 PNG | 두 popup 수명주기 조합이 trigger | opener 복원 실측 |
| 2026-08-12 | screenshotStabilityProbe | Chrome Windows | 거부 popup close 뒤 opener activate, PNG 276ms | popup 거부 정리에 opener 복원이 필요 | transport 계약과 정식 게이트로 승격 |
| 2026-08-12 | screenshotStabilityProbe | Edge Windows | 같은 전체 prefix, 복원 없이 PNG 231ms | Edge는 허용하지만 공통 복원 계약이 안전 | Chrome와 Edge 정식 게이트 |

## 판정

졸업 -> 거부 popup cleanup이 opener target을 다시 활성화하는 transport 계약과 정식 게이트로 승격한다.
