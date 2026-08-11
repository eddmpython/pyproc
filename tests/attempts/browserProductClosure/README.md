# browserProductClosure - 실제 제품 점검에 필요한 브라우저 관측이 한 흐름으로 성립하는가

## 가설

Chromium target을 about:blank에서 먼저 attach하면 viewport와 Runtime, Network 계측을 첫 navigation 전에
고정할 수 있다. 같은 session에서 사용자 표시 상태와 bounded scroll sweep을 판정하면 별도 raw script 없이
준비 완료와 lazy asset 적재를 재현할 수 있고, screenshot base64는 MCP image content로 직접 전달할 수 있다.

## 졸업 게이트

실제 Chrome 또는 Edge에서 390x844, DPR 3 적용, attached이면서 hidden인 overlay 구분, scroll 전 lazy
요청 0과 bounded hydration 뒤 1, 첫 document request와 초기 console 각각 1개 이상, 유효 PNG signature를
모두 한 실행에서 확인한다. 이후 정식 설치 E2E가 native image content와 artifact digest 동일성을 확인한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-11 | productClosureProbe | Edge headless, 로컬 정적 서버 | GREEN 7/7. 390x844@3, hidden overlay, lazy 0 -> 1 request, 6 scroll, 초기 33 events, PNG 14,079B | 다섯 primitive가 한 session에서 성립 | config, broker, action, MCP composer와 정식 gate로 승격 |

## 판정

졸업 -> `scripts/browserControl/`, MCP result composer, config와 정식 browser gate로 승격한다.
