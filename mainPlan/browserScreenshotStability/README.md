# Browser Screenshot Stability

## 북극성

지원 action을 누적 실행한 뒤에도 screenshot은 정해진 시간 안에 이미지 또는 판정 가능한 오류를 반환한다.
이미 전송된 외부 효과를 재실행하지 않고 read action만 안전하게 복구할 수 있어야 한다.

## 확인된 결손

Windows Chrome의 정식 66개 브라우저 게이트에서 의미 기반 대기, hydration, 입력, dialog, download,
drag, popup, cookie와 storage가 적용된 뒤 `Page.captureScreenshot`이 240초 동안 응답하지 않았다.
같은 빌드의 설치 제품 게이트는 독립 세션에서 PNG, JPEG, WebP를 반환했고 Edge 종합 게이트도 통과했다.

## 실행 단계

1. Chrome에서 screenshot을 멈추게 하는 최소 action 또는 target 상태를 attempts probe로 찾는다.
2. 무응답 명령 뒤 같은 session이 살아 있는지와 다른 캡처 방식이 완료되는지 실측한다.
3. read action에만 적용되는 bounded 복구 계약을 설계하고 중복 effect가 없음을 증명한다.
4. Chrome와 Edge 정식 게이트, 설치 제품 게이트, 전체 회귀를 통과시킨다.
5. 지속 계약과 정식 테스트로 승격한 뒤 contract reality 행, attempts와 이 폴더를 삭제한다.

## 종료 조건

- 최소 probe가 Chrome와 Edge에서 원인과 복구 결과를 판정한다.
- Chrome와 Edge의 `test:browser-control`이 66개 단정을 모두 통과한다.
- Chrome 설치 제품 screenshot 3종과 artifact fallback이 유지된다.
- timeout, 취소, outcome 표기가 기존 계약보다 약해지지 않는다.
- `npm test`가 GREEN이고 임시 계획과 probe가 삭제된다.
