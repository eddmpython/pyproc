# agentBrowserUse - 제품 학습 여정을 닫힌 루프로 수행할 수 있는가

## 가설

설치 제품의 제한된 browser 도구만으로 공개 Web과 Local 학습 제품에서 같은 학습 과제를 열고, 코드를
수정하고, 실행 결과와 진도 변화를 관찰하고, 화면 증거를 남길 수 있다. raw CDP 명령이 꼭 필요한
단계는 에이전트용 고수준 계약의 결함으로 분류한다.

## 졸업 게이트

- 공개 Web과 Local에서 같은 canonical lesson을 연다.
- 두 환경 모두에서 starter code 수정, 실행, 결과 관찰, 진행 상태 확인을 한 번의 도구 세션으로 끝낸다.
- 각 환경의 최종 화면을 PNG artifact로 저장하고 SHA-256을 검증한다.
- 제품 의미를 확인하기 위해 raw CDP 명령을 사용한 단계가 0개다.
- 실패 시 `failedActionIndex`, `outcome`, 마지막 관찰 snapshot만으로 다음 안전 행동을 결정할 수 있다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-12 | `productLearningProbe.mjs` | 공개 Web, 개선 전 | 512 node 제한에서 editor 누락, 1000 node 관찰 95,142 bytes, contenteditable DOM만 변경 | 실패 | focused 관찰과 trusted 입력 계약 추가 |
| 2026-08-12 | `productLearningProbe.mjs` | 공개 Web, 개선 후 Edge 151 | AX 912개 중 후보 159개, compact 19,611 bytes, raw command 0개, strong 검증 완료, PNG SHA-256 `c99b1d4f58ede0e9d3e116f9fde801044a4a8db5058aae89e1cc0cacbf407594` | Web 졸업 | Local 제품 차단 분리 |
| 2026-08-12 | `productLearningProbe.mjs` | Local Edge 151 | 서버 health 성공, 핵심 JS 4개 404, AX node 2개, 빈 PNG SHA-256 `5174949aa8c450d15c99ba1d0bf15bd8d4256f8bd54eaac56ca8e1ec3a844d8c` | 측정 대상 차단 | 대상 제품 이니셔티브에서 build 원자성 복구 후 재측정 |

## 모듈화 설계

- 관찰 결함은 `scripts/browserControl/`의 semantic observation 계약에서 해결한다.
- 조작 결함은 기존 action catalog에 일반 제품에도 재사용 가능한 최소 action으로만 추가한다.
- MCP 도구 수와 raw method 권한은 늘리지 않고 `browserObserve` 또는 `browserAct`의 버전된 결과로 제공한다.
- 공개 root export와 Experimental subpath는 추가하지 않는다.

Probe의 일곱 번째 인자는 학습 제품에 넣을 코드다. 측정 대상의 이름이나 정답 코드는 repository에
고정하지 않고 실행 시점 인자로만 전달한다.

## 덕지덕지 제거

- 측정 대상 이름, selector, route, 전역 객체를 제품 구현에 넣지 않는다.
- 특정 프레임워크나 편집기 전용 분기를 만들지 않는다.
- 이미 snapshot, locator, ordered action으로 표현되는 동작은 새 action으로 중복하지 않는다.

## 판정

진행 중. Web은 졸업했고 Local은 측정 대상의 정적 bundle 불일치로 차단됐다. pyproc의 동일 Local 입력
경로는 hermetic Edge live gate에서 통과했다.
