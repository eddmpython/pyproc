# Agent Perception Exchange 이니셔티브

PyProc의 기존 브라우저 자동화에 의미, 구조, 공간, 시간, 선택적 픽셀, 행동 증거를 결합한
지속형 지각 계층을 추가한다. 작업명은 APX, 제품 기능명은 PyProc Eyes로 고정한다.

## 북극성

에이전트가 페이지를 매번 처음 보는 평면 snapshot으로 소비하지 않고, bounded perception graph를
관찰하고 질의하며 변화량을 기억하고 행동 결과를 증거로 검증할 수 있어야 한다.

## 불변식

1. 기존 `automation.observe`와 `browserObserve` 호출은 결과 형태와 권한 경계를 그대로 유지한다.
2. APX는 `representation: "apx.graph"` opt-in으로만 활성화한다.
3. `entityRef`는 관찰 identity이고 행동 권한이 아니다. 행동은 현재 observation이 발급한 짧은
   수명의 `locatorRef`로만 수행한다.
4. sensor와 driver의 raw identifier는 wire에 노출하지 않는다.
5. observed, derived, inferred, reported provenance를 혼합하지 않는다.
6. `applied`는 업무 성공이 아니다. 증거가 부족하면 confirmed로 판정하지 않는다.
7. `outcomeUnknown`은 자동 재시도하지 않는다.
8. payload와 sensor 비용은 명시적 budget으로 제한하고 truncation을 숨기지 않는다.
9. APX core는 provider-neutral이며 Native CDP와 Frame provider가 같은 envelope를 사용한다.
10. npm root export는 늘리지 않고 기존 AutomationSpace와 Control Protocol operation을 확장한다.

## 순차 실행

### 1. 측정과 계약

- APX 원문을 현재 코드와 대조한다.
- AX identity, relation, DOMSnapshot geometry, overlay, delta, crop의 실제 Chromium 값을 probe로 측정한다.
- `docs/operations/contractReality.md`에 현재 격차를 유지한다.

종료 조건:

- Chrome 또는 Edge에서 semantic, geometry, temporal, crop probe가 모두 PASS한다.
- raw CDP shape를 공개 payload에 노출하지 않는 모듈 경계가 확정된다.

### 2. APX Core와 Web profile

- APX vocabulary, schema, strict validator, canonical digest를 구현한다.
- AX 관계와 DOMSnapshot을 fused entity graph로 변환한다.
- document epoch 안에서 stable `entityRef`를 유지하고 locator capability와 분리한다.
- full, delta, query, budget, completeness를 구현한다.

종료 조건:

- L0 Core, L1 Semantic, L2 Spatial, L3 Temporal 계약 게이트가 통과한다.
- 기존 legacy observation byte shape 회귀가 없다.

### 3. Pixel-on-demand

- unresolved visual entity와 changed region trigger를 구현한다.
- low-resolution overview와 bounded entity crop을 artifact store에 보존한다.
- 실제 추론 provider 없이도 inferred channel의 권한 한계와 adapter 계약을 고정한다.

종료 조건:

- canvas와 이름 없는 image/control에서만 auto probe가 발생한다.
- 일반 semantic form에서는 visual artifact가 0개다.
- crop descriptor의 MIME, byte length, digest가 검증된다.

### 4. EvidenceLoop

- effect action의 before observation, effect window, after observation, postcondition 판정을 결합한다.
- entity state와 network response 조건을 지원한다.
- confirmed, contradicted, ambiguous, notObserved, outcomeUnknown을 기존 outcome과 분리한다.

종료 조건:

- 성공, 서버 오류, 증거 부족, 전송 후 단절 fixture가 정확히 분리된다.
- effect 재전송 수는 모든 경로에서 0이다.

### 5. 제품 통합과 정본화

- NativeCdpSpace, FrameSpace, recording, replay, MCP, native Control, Python SDK를 같은 의미론으로 맞춘다.
- APX conformance L0부터 L4까지 제품 게이트로 고정한다.
- README, 운영 문서, 사용 문서, schema와 example을 완성한다.
- 설치 tarball과 배포 산출물에서 실제 제품 여정을 검증한다.

종료 조건:

- deliberate negative fixture가 먼저 RED이고 수정 후 GREEN이다.
- `npm test`와 관련 browser, package, MCP, Control, Frame, Replay, Python SDK 게이트가 모두 GREEN이다.
- 공개 문서의 claim이 실제 conformance보다 앞서지 않는다.

### 6. 종료와 릴리즈

- 전체 요구사항과 보안 경계를 독립 재감사한다.
- 우수성 판정이 GREEN이면 버전을 범프하고 main에 커밋, push, tag, npm publish, GitHub release를 완료한다.
- 정본 문서와 코드가 완료된 같은 사이클에 이 폴더와 완료된 attempts 캠페인을 삭제한다.

종료 조건:

- mainPlan에는 이 완료 이니셔티브가 남지 않는다.
- 원격 main, tag, npm, GitHub release가 같은 commit과 version을 가리킨다.
