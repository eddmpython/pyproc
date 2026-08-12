# agentPerceptionExchange - 브라우저 사실을 지속형 지각 그래프로 만들 수 있는가

## 가설

Chromium의 AX tree와 DOMSnapshot을 provider 내부에서 결합하면 raw driver identifier를 노출하지 않고도
의미, 관계, geometry, document epoch를 가진 bounded graph를 만들 수 있다. 같은 document 안에서는
identity를 유지하고, visual probe와 행동 증거는 구조 센서가 부족할 때만 추가할 수 있다.

## 졸업 게이트

실제 Chrome 또는 Edge에서 다음을 모두 만족해야 한다.

1. AX의 parent, child, relation과 DOMSnapshot backend node join 정확도 100%.
2. visible, offscreen, overlay 대상의 geometry와 viewport 판정 정확도 100%.
3. 같은 document의 비변경 entity identity 유지율 100%, 교체 node 오동일성 0건.
4. delta를 이전 full graph에 적용한 결과와 새 full graph의 canonical digest가 동일.
5. semantic form visual probe 0건, canvas와 이름 없는 image/control의 bounded crop은 기대 수와 일치.
6. before/after entity와 network postcondition의 confirmed, contradicted, ambiguous 판정이 fixture와 100% 일치.
7. 기존 legacy observe 결과의 필드와 의미론이 변하지 않음.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-12 | 설계 대조 | source contract | 평면 AX 목록, 관계 및 지속 identity 없음 | 진행 | 실제 CDP sensor probe |
| 2026-08-12 | `sensorProbe.mjs` | Chrome 151 headless | 9/9 PASS, AX 23, DOM 54, identity 유지 및 교체 구분, canvas crop 423 bytes | 졸업 전제 충족 | APX core와 정식 제품 게이트 |
| 2026-08-12 | `npm run test:apx` | Chrome 151 headless | legacy 호환, occlusion, full graph, crop, raw ID 비노출, EvidenceLoop, delta 7/7 PASS | 졸업 | 정식 gate와 docs가 계약 소유 |

## 판정

졸업. 실측 fixture와 제품 경로는 `tests/browser/apxProduct.html` 및 `tests/browser/apxProduct.mjs`로
승격했고, 지속 계약은 `docs/specs/apx/README.md`가 소유한다. 이 캠페인은 릴리즈 종료 커밋에서
폴더째 삭제한다.
