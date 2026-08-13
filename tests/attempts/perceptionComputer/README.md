# Initiative 1: perceptionComputer - LLM에 page 대신 최소 충분 상황 모델을 줄 수 있는가

## 가설

DOM, accessibility, layout, paint, lifecycle, network, WebMCP declaration, bounded pixel evidence를 지속
`WorldModel`에 융합하고 목표별 `SituationCapsule`을 만들면, full screenshot이나 full accessibility
snapshot을 넘기지 않고도 action reach를 유지하면서 conflict, unknown, authority, effect truth를 더
정확하게 표현할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-1---perception-computer)다.
실행 계획은 [Initiative 1](../../../mainPlan/1-perceptionComputer/README.md)다.
이 폴더는 그 주장을 browser 실측으로 반증하거나 졸업시키는 단일 캠페인이다.

## 기준선 계약

첫 probe는 exact Playwright MCP package version, browser version, snapshot option, viewport를 기록한다.
baseline은 accessibility snapshot, bounding box, find, screenshot을 포함한다. floating version, 다른
profile, 다른 fixture state 결과를 비교하지 않는다.

hosted model은 필수 판정자가 아니다. deterministic task oracle이 필요한 fact, 허용 action, 금지
action, expected transition을 소유한다. model trial은 보조 artifact로만 기록한다.

## 졸업 게이트

아래 fixture와 음성 시험이 모두 browser에서 PASS해야 한다.

1. 큰 semantic fixture에서 task oracle fact와 action을 전부 보존하고, capsule serialized byte는 pinned
   full snapshot보다 작고 visual artifact는 0개다.
2. canvas와 image-only fixture에서 unresolved entity crop만 만들고 full-page artifact는 0개이며, crop
   digest와 inferred claim provenance가 연결된다.
3. duplicate name, overlay, animation, offscreen fixture에서 잘못된 target action은 0회이고 ambiguity를
   명시적으로 반환한다.
4. SPA rerender와 reorder에서 `entityRef`가 유지되고 document replacement 뒤 이전 `locatorRef`와
   capability는 전부 stale이다.
5. 같은 URL의 unrelated response를 effect evidence로 채택한 횟수 0, false `confirmed` 0,
   `outcomeUnknown` effect 재전송 0이다.
6. instruction-shaped page text, accessibility label, WebMCP description, visual inference가 manifest의
   origin, action, risk를 넓힌 횟수 0이다.
7. 일치하는 WebMCP tool은 reported capability로 보존되고 visible UI와 충돌하는 tool은 `conflicted`로
   남으며 자동 실행되지 않는다.
8. replay에서 live provider request 0으로 SituationCapsule, ActionEvidence, attachment byte와 digest가
   일치한다.
9. Native CDP와 FrameSpace가 같은 core type을 반환하고 FrameSpace는 compositor visual claim을 하지
   않는다.
10. baseline이 성공한 fixture action을 전부 성공하고, baseline이 표현하지 않는 unknown, conflict,
    effect proof, replay 축을 모두 반환한다.

## 실행 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `baselineProbe.mjs` | pinned Playwright snapshot과 같은 fixture state를 재현하는가 | option 또는 browser version 불일치 거부 |
| `worldModelProbe.mjs` | claim, conflict, epoch, rollback이 atomic한가 | raw provider ID 주입과 partial commit 거부 |
| `capsuleBudgetProbe.mjs` | large page에서 최소 충분 capsule인가 | oracle fact 누락과 omitted 미보고 거부 |
| `activePerceptionProbe.mjs` | pixel을 unresolved claim에만 쓰는가 | semantic task screenshot 생성 거부 |
| `temporalIdentityProbe.mjs` | rerender, reorder, navigation identity가 정직한가 | old capability 사용 거부 |
| `capabilityFusionProbe.mjs` | observed UI와 reported WebMCP tool을 구분하는가 | conflict 자동 실행 거부 |
| `instructionBoundaryProbe.mjs` | page data가 authority를 오염시키지 않는가 | page instruction effect 0 |
| `transitionProofProbe.mjs` | DOM과 network evidence를 정확히 상관하는가 | unrelated response와 post-send death 오판 거부 |
| `replayCapsuleProbe.mjs` | live effect 없이 같은 상황과 증거를 재현하는가 | digest 또는 input mutation 거부 |

## 모듈화 설계 후보

실측 전 `scripts/perception/` 또는 공개 schema를 바꾸지 않는다. 졸업 시 책임 경계 후보는 다음이다.

- provider sensor는 raw fact만 낸다.
- `WorldModel`은 identity, provenance, conflict, freshness를 소유한다.
- attention compiler는 goal, budget, oracle query에서 `SituationCapsule`을 만든다.
- broker는 locator, WebMCP tool 승격, risk, destination authority를 소유한다.
- evidence loop는 transition correlation과 terminal truth를 소유한다.
- recording은 capsule과 evidence를 canonical terminal로 저장한다.

operation은 기존 `automation.observe`와 `automation.act`를 유지한다. APX version 또는 새 representation
profile 여부는 probe가 wire 호환성을 판정한 뒤 결정한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | 조사와 gate 설계 | Playwright MCP, CDP, WebMCP, APX 1.0 문서 대조 | probe 미실행 | screenshot 또는 tree 확대가 아니라 situation model 가설로 좁힘 | exact baseline pin과 `baselineProbe.mjs` |
| 2026-08-13 | exact Playwright 기준선 | Playwright 1.62.0, Edge 151.0.4129.78, Windows x64, 1280x800 | ARIA+box, role locator, bounding box, element screenshot, click reach PASS, artifact digest 재현 | 약한 대조군 금지, 동일 fixture에서 전체 허용 reach를 기준선으로 고정 | world와 capsule prototype |
| 2026-08-13 | WorldModel과 SituationCompiler | deterministic fixture graph와 120개 noise entity | 8 prototype probe PASS, semantic visual artifact 0, old capability provider call 0 | `apx.situation`을 graph 1.0과 분리한 representation으로 승격 가능 | schema와 본진 승격 |
| 2026-08-13 | authority와 transition 반증 | reported tool, page instruction, document replacement, unrelated response | authority widening 0, weak-only confirmed 0, replay provider call 0 | broker capability와 transition proof를 독립 불변식으로 유지 | installed provider 통합 |

## 판정

Prototype 졸업. exact Playwright 기준선과 deterministic oracle을 고정했고, world atomicity, 최소 충분
projection, active perception, capability boundary, transition proof, replay의 양성 및 음성 probe가 모두
통과했다. 다음 단계는 shortcut 없이 `scripts/perception/` 책임 모듈과 strict schema로 다시 작성하는 것이다.
