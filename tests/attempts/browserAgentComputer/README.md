# Browser Agent Computer - 의미 기반 행동과 제한된 trace가 실브라우저에서 성립하는가

## 가설

Chrome과 Edge의 CDP primitive만으로 외부 효과 전 actionability를 판정하고, document가 바뀌어도
semantic locator를 다시 찾으며, screenshot, console, network를 민감 정보 없이 제한된 trace로
수집할 수 있다. effect 이후에는 자동 재시도하지 않아 outcome 법을 보존할 수 있다.

## 졸업 게이트

- animation, overlay, delayed attach, disabled, editable fixture에서 pre-effect actionability 판정이
  Chrome과 Edge 각각 pass한다.
- CSS, role, text, label, testId locator가 같은 element를 유일하게 찾고 duplicate는 fail한다.
- same-origin navigation, allowed cross-origin frame, open Shadow DOM에서 locator 재탐색이 pass한다.
- screenshot, console, network trace가 quota와 redaction fixture를 pass한다.
- popup, dialog, upload, download의 effect와 destination guard가 pass한다.
- cancellation과 browser death 뒤 effect가 자동 재실행되지 않는다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-11 | 기존 browserControl baseline | Chrome, Edge | 고수준 action 8종, locator epoch, outcome 분류 | 기반 통과, actionability와 trace 부족 | fixture와 probe 구현 |
| 2026-08-11 | `probe.mjs` | Chrome, Edge | 브라우저별 11/11 | primitive 가설 통과 | 정식 contract와 browser gate로 졸업 |

## 모듈화 설계

- 의미 해석은 `scripts/browserControl/browserLocator.js`가 소유한다.
- effect 전 판정과 대기는 `scripts/browserControl/browserActionability.js`가 소유한다.
- artifact 수집과 redaction은 `scripts/browserControl/browserObservation.js`가 소유한다.
- step 원장과 quota는 `scripts/browserControl/browserTrace.js`가 소유한다.
- `browserAutomation.js`는 이 모듈을 조합하고 catalog action을 dispatch한다.
- npm 공개 표면은 늘리지 않는다.

## 판정

졸업 -> `scripts/browserControl/` + `tests/browser/`
