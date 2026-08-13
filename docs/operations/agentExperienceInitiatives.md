# Agent experience initiatives

pyproc을 에이전트가 바로 소비할 수 있는 제품으로 닫은 뒤, browser cognition, 변경 검증, Machine 동면,
실행 기억, one-shot effect transaction, 협력 app state, replay world까지 확장하는 순차 기획이다. 이 문서는
Initiative 0부터 7까지의 지속 계획 정본이고, 현재 능력의 주장은 코드와 gate에만 둔다.

## 결정

여덟 initiative를 직렬로 진행한다.

0. **Machine Entrance**를 먼저 끝낸다. exact package 설치에서 첫 Python 결과와 첫 검증된 browser
   observation까지 deep import, protocol 조립, 수작업 manifest 추측 없이 도달하게 한다.
1. 그 출구 gate가 green인 뒤 **Perception Computer**를 시작한다. 전체 화면이나 전체 tree를 LLM에
   넘기는 대신, 지속 world model에서 목표에 필요한 최소 충분 상태와 다음 관찰 질문을 만든다.
2. 그 출구 gate가 green인 뒤 **Verified Change Loop**를 시작한다. 저장소가 선언한 경험 계약을 실제
   browser에서 재실행하고, 변경 완료 여부를 canonical Evidence Pack과 effect-free replay로 판정한다.
3. **Hibernating Machine Fleet**는 safe generation을 먼저 commit하고 실행 owner를 종료해
   정해진 수의 Machine만 hot으로 유지한다.
4. **Execution Memory Registry**는 Machine generation, branch, situation, replay cursor,
   evidence를 durable session revision으로 연결한다.
5. **Rehearse-Commit Transactions**는 effect-free rehearsal과 exact approval을 거친 intent만
   live provider에 한 번 보내고 결과를 봉인한다.
6. **Transactional AppSpace**는 협력 app의 logical state와 effect outbox를 Machine
   generation에 함께 branch, restore, adopt한다.
7. **ReplayGraph Worlds**는 verified state node와 action edge로 여러 recorded path를 live
   effect 없이 탐색하고 deterministic oracle로 평가한다.

순서를 바꾸지 않는다. 소비 경로가 불안정한 상태에서 perception 표현을 바꾸면 제품 문제와 표현
문제를 분리해 측정할 수 없고, 새로운 구조가 좋아도 실제 사용자가 진입할 수 없다. Perception 없이
change verification을 만들면 screenshot runner로 퇴화하고, 실제 cold lifecycle 없이 Execution Memory를
만들면 metadata registry에 그친다. exact session revision 없이 effect approval을 만들 수 없고, one-shot
effect law 없이 app outbox를 열 수 없으며, paired app state 없이 ReplayGraph를 만들면 linear recording을
갈라 붙인 자료구조일 뿐이다.

모든 initiative는 기존 Machine, state kernel, AutomationSpace, Control surface를 아래층 정본으로
재사용한다. 새 npm root export, 별도 browser 제품 정체성, page나 repository 문서가 권한을 부여하는
우회 통로를 만들지 않는다.

## 조사에서 고정한 기준선

단순한 image 반대만으로는 새 개념이 되지 않는다. 현재 기준선은 이미 다음을 제공한다.

| 기준선 | 실제로 주는 것 | 남는 경계 |
|---|---|---|
| screenshot loop | compositor pixel과 사람에게 익숙한 전체 모양 | 의미, identity, 관계, 권한, 시간 변화, effect 증거가 없다 |
| Playwright MCP | accessibility snapshot, element ref, bounding box, 부분 검색, action, screenshot | 한 시점의 tree가 중심이고 지속 world, conflict, unknown, effect truth가 하나의 perception 계약은 아니다 |
| raw CDP | DOM, accessibility, layout, paint, network, lifecycle의 원천 사실 | driver ID와 원시량이 크고 LLM용 trust, attention, authority 계약이 없다 |
| WebMCP | page가 선언한 구조화 tool과 form capability | opt-in page에만 있고 page가 보고한 설명은 관찰 사실이나 실행 권한이 아니다 |
| APX 1.0 | semantic, spatial, temporal graph, pixel-on-demand, stable identity, ActionEvidence | predicate query는 있지만 목표별 최소 충분 상태, 명시적 conflict와 unknown, 선언 tool 융합은 없다 |

근거는 다음 정본에 둔다.

- [Playwright MCP](https://github.com/microsoft/playwright-mcp)는 accessibility snapshot과 box, find를
  agent 관찰 표면으로 사용하고 screenshot을 별도 표면으로 둔다.
- [CDP DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/)과
  [CDP Accessibility](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/)는 DOM,
  layout, paint order, 접근성 의미를 서로 다른 원천으로 제공한다.
- [WebMCP proposal](https://github.com/webmachinelearning/webmcp)는 page 기능을 구조화 tool로
  선언하는 경로를 제안한다. 선언은 유용한 sensor지만 broker authority를 대신할 수 없다.
- [BrowserGym](https://arxiv.org/abs/2412.05467)은 observation과 action space를 명시적으로 분리해
  비교 가능한 web-agent 환경을 만든다.
- [WebLINX](https://arxiv.org/abs/2402.05930)는 전체 page를 그대로 소비하지 못하는 문제를
  관련 element 검색으로 줄인다.
- [AgentOccam](https://arxiv.org/abs/2410.13825)은 model보다 observation과 action 표현의 정렬이
  결과를 크게 움직일 수 있음을 보인다.
- [StepJack](https://arxiv.org/abs/2608.06477)은 page 안의 자연어를 instruction으로 받아들이는
  경로가 여러 단계에 걸쳐 effect authority를 오염시킬 수 있음을 측정한다.

여기서 도출되는 기회는 sensor를 더 쌓는 것이 아니다. 관찰한 사실, page가 보고한 capability,
broker가 부여한 authority, 아직 모르는 것, 행동 뒤 입증된 변화를 서로 다른 종류로 보존하는
**지속 상황 모델**이다. 이 결론은 조사에서 얻은 설계 가설이며, 세계 최초나 우월성 주장은 아래
비교 gate가 끝날 때까지 금지한다.

## 아이디어 채택 판정

새 제안은 현재 source와 제품 정본에 다음처럼 흡수한다.

| 아이디어 | 판정 | 이유와 위치 |
|---|---|---|
| invisible browser execution | 이미 있음 | Native CDP의 isolated headless profile, cooperative FrameSpace, effect-free ReplaySpace를 새 initiative의 provider로 재사용 |
| 전체 screenshot 대신 변화 지각 | Initiative 1에 흡수 | WorldModel, SituationCapsule, bounded visual evidence가 정확한 책임 |
| repository 변경 검증과 Evidence Bundle | Initiative 2에 흡수 | Experience Contract와 Evidence Pack이 before, after, diagnostics, replay verdict를 소유 |
| inactive Machine의 RAM 0 | 문구 폐기, Initiative 3로 교정 | host RAM 0은 약속할 수 없고, safe commit 뒤 live Worker와 runtime owner를 종료하는 계약만 채택 |
| 여러 project의 hot, cold 관리 | Initiative 3로 채택 | current Machine lifecycle 위의 lease, hot budget, suspend, resume가 실제 신규 간극 |
| 대화가 아닌 실행 기억 | Initiative 4로 채택 | generation, branch, situation, recording, evidence를 durable revision으로 연결 |
| portable Agent Capsule | Initiative 4에 흡수 | 새 상태 포맷을 복제하지 않고 existing image와 evidence의 signed handoff descriptor로 검증 |
| rehearse, approve, commit, verify | Initiative 5으로 채택 | browser rollback이 아니라 exact intent와 one-shot send lifecycle로 제한 |
| signed Evidence Bundle | Initiative 2과 06으로 분리 | change verdict는 Evidence Pack, live effect receipt는 transaction이 소유. integrity와 signature 분리 |
| app state checkpoint와 effect outbox | Initiative 6로 채택 | arbitrary browser snapshot이 아니라 cooperative logical state protocol로 제한 |
| branched replay world | Initiative 7로 채택 | graph에 실제 recorded 또는 transactional edge만 허용하고 없는 transition은 생성하지 않음 |
| server 없는 local cloud | 이미 있음 | ASGI, VirtualOrigin, OPFS의 shipped 조합이며 Machine Entrance와 Fleet golden workload로 사용 |
| 살아 있는 program file | 이미 있음, Initiative 4에 연결 | `.pymachine`과 `.webmachine`이 state를 나르고 Execution Memory가 handoff index를 추가 |
| 완전한 virtual Chromium | 폐기 | browser engine과 renderer state를 이중 가상화하며 현재 authority와 memory 목표를 악화 |
| 기존 native editor와 model process 동결 | 범위 밖 | pyproc이 소유하지 않는 native process의 heap과 extension state를 얼릴 권한과 format이 없음 |
| WASM tool layer와 Node guest | 기존 frontier 유지 | North Star 사다리 6단과 7단의 정본을 중복하지 않으며 앞선 transport와 memory prerequisite를 재정렬하지 않음 |

initiative 번호는 이 agent-computer 실행 포트폴리오의 직렬 순서다. North Star의 ceiling ladder 번호를
대체하지 않는다. WASM tools와 Node guest는 그 사다리의 기존 조건이 열릴 때 별도 실행 계획을 만든다.

## Initiative 0 - Machine Entrance

상태: 구현됨. 설치 package의 initializer, effect-free doctor, JavaScript, Python, MCP parity와 Chrome 및
Edge 제품 gate가 아래 출구 조건을 집행한다.

### 사용자 결과

사용자는 exact-version package와 한 설정 파일로 다음 여정을 완주한다.

```text
install -> initialize -> preflight -> connect -> run or observe -> verify -> close
```

각 단계는 다음 단계에 필요한 한 명령을 반환한다. 오류는 실패한 사실만 말하지 않고 잘못된 field,
찾지 못한 engine 또는 browser, 권한이 부족한 action, 다음에 실행할 안전한 명령을 함께 말한다.

### 범위

1. **안정 client 표면**
   - `pyproc/control`, `pyproc-mcp`, `pyproc-control`, Python SDK가 같은 operation, outcome,
     cancellation, attachment 의미를 쓴다.
   - public client는 제품 동사와 APX query를 제공하고 deep path를 요구하지 않는다.
2. **기존 CLI의 initializer**
   - 새 bin을 만들지 않고 `pyproc-mcp`의 init 경로가 engine 위치, exact package, manifest skeleton,
     generic stdio client snippet을 만든다.
   - 기본값은 browser authority가 닫힌 Python-only profile이다.
   - browser profile은 exact origin, action, risk, purpose를 사용자가 명시해야만 열린다.
3. **recipe 기반 manifest**
   - `pythonOnly`, `observeLocal`, `authorizedBrowser`처럼 authority 차이가 보이는 recipe를 쓰되,
     결과는 언제나 완전한 versioned manifest다.
   - recipe는 shortcut이지 policy bypass가 아니다. 생성 뒤 기존 strict validator를 그대로 통과한다.
4. **한 golden journey**
   - Python 실행, checkpoint, APX query, 증거가 붙은 action, 필요한 경우에만 screenshot, artifact
     digest 확인, detach와 close까지 한 예제가 수행한다.
   - MCP, JavaScript, Python 문서는 같은 journey와 같은 이름을 사용한다.
5. **진단과 cleanup**
   - preflight는 engine, browser family, protocol, profile ownership, origin, file root, artifact quota를
     effect 전에 확인한다.
   - interrupt, browser death, partial completion 뒤 살아 있는 process, profile, artifact가 남지 않는다.

### 출구 gate

Initiative 0은 다음이 모두 green일 때만 끝난다.

1. clean directory에서 packed exact package만 설치하고 문서의 첫 명령부터 golden journey를 완주한다.
2. initializer가 만든 Python-only config는 CDP endpoint와 browser tool을 열지 않는다.
3. browser를 켠 config는 broad origin, 미승인 external effect, 상대 file root, unknown field를 browser
   launch 전에 거부한다.
4. MCP, JavaScript, Python이 같은 manifest로 같은 terminal outcome과 attachment digest를 반환한다.
5. public example과 type surface에 package-internal import가 없다.
6. 시작 실패, cancel, post-send disconnect, shutdown 각각에서 process와 artifact cleanup을 확인한다.
7. Chrome과 Edge installed gate가 문서의 exact journey를 실행한다.

### 범위 밖

- 사용자의 기본 browser profile attach
- 외부 effect의 묵시적 승인
- site별 자동화 recipe
- 새 npm root value export
- engine 또는 browser binary를 package 안에 복제

## Initiative 1 - Perception Computer

### 제품 명제

LLM에 page를 보여주는 대신, 브라우저가 **무엇이 존재하고, 무엇을 할 수 있고, 무엇이 바뀌었고,
무엇을 아직 모르는지** 계산하게 한다.

내부에는 provider-neutral `WorldModel`이 살고, 소비자에게는 목표별 `SituationCapsule`만 나간다.
image는 world가 아니다. semantic sensor로 해소되지 않은 visual claim을 입증하는 마지막 evidence다.

```text
browser facts + declared capabilities + event history + policy
                         |
                         v
                    WorldModel
                         |
               goal + budget + freshness
                         |
                         v
                 SituationCapsule
       facts + affordances + changes + unknowns + probes
```

### WorldModel의 네 plane

1. **World plane**
   - entity, region, document, frame, resource, event를 typed node로 둔다.
   - parent, label, owns, overlaps, occludes, controls, requested, responded 같은 relation을 둔다.
   - DOM 재렌더와 visual 유사성을 identity로 착각하지 않고 document epoch과 sensor identity를 쓴다.
2. **Capability plane**
   - observed affordance, derived actionability, page-reported WebMCP tool, broker-issued action capability를
     분리한다.
   - 각 action은 precondition, risk, destination, expected transition, expiry를 가진다.
   - 설명이 같은 두 control도 authority token과 world epoch이 다르면 다른 capability다.
3. **Belief plane**
   - claim은 `observed`, `derived`, `reported`, `inferred` provenance를 잃지 않는다.
   - 단일 confidence 숫자로 모호함을 숨기지 않는다. `known`, `conflicted`, `unknown`, `stale` 상태와
     completeness mask를 사용한다.
   - page text와 tool description은 untrusted data다. instruction이나 policy가 될 수 없다.
4. **Transition plane**
   - action 전후 graph delta, browser event, network exchange, one-shot effect outcome을 한 transition에
     묶는다.
   - 시간상 함께 일어났다는 이유만으로 causality를 확정하지 않는다. broker correlation 또는
     postcondition match가 있는 관계만 confirmed evidence다.

### SituationCapsule

`SituationCapsule`은 full tree 요약문이 아니다. 목표와 질문을 만족하는 최소 충분 subgraph다.

```json
{
  "situationRef": "situation:...",
  "worldRef": "world:...",
  "focus": { "goal": "...", "freshness": "live" },
  "facts": [],
  "affordances": [],
  "changes": [],
  "unknowns": [],
  "suggestedProbes": [],
  "completeness": {},
  "evidenceRefs": []
}
```

LLM은 `unknowns`를 추측하지 않는다. 필요한 정보가 없으면 `suggestedProbes` 중 가장 싼 sensor를
요청한다. sensor 순서는 고정 우선순위가 아니라 claim별 비용과 trust로 결정하지만 기본 ladder는
다음과 같다.

```text
fresh cached fact
  -> accessibility and DOM
  -> page-reported WebMCP capability
  -> layout, paint, hit-test and actionability
  -> lifecycle and redacted network evidence
  -> bounded entity crop
  -> OCR or model inference adapter
```

뒤 단계는 앞 단계의 authority를 넓히지 않는다. pixel 또는 inference가 button이라고 판단해도
broker가 locator capability를 발급하지 않았다면 action할 수 없다.

### Proof-carrying action

action request는 target만 전달하지 않는다.

```text
intent + world epoch + capability + preconditions + expected transition + permission
```

result는 click 완료가 아니라 transition proof를 반환한다.

```text
before capsule -> authorize -> send once -> observe delta -> verify -> evidence
```

`confirmed`, `contradicted`, `ambiguous`, `notObserved`, `outcomeUnknown`의 의미는 APX 1.0을 유지한다.
새 구조는 상태를 더 많이 수집하는 것이 아니라 어떤 claim이 그 판정을 지지했는지를 직접 연결한다.

### WebMCP와 visual의 위치

- WebMCP tool은 capability plane의 `reported` 후보로 들어온다. schema와 page origin을 보존하고,
  manifest action과 risk가 허용할 때만 broker capability로 승격한다.
- semantic과 layout으로 충분한 task는 visual artifact를 만들지 않는다.
- canvas, chart, image-only control처럼 unresolved claim이 남은 영역만 crop한다.
- full screenshot은 overview가 실제 질문일 때만 사용한다. action grounding의 기본값이 아니다.
- inference adapter는 OCR 또는 model 종류, input artifact digest, output claim을 기록하고 policy에서
  독립한다.

### 지속성과 복원 경계

WorldModel, SituationCapsule, evidence는 recording에 담겨 replay할 수 있다. Python checkpoint 옆에는
world ref와 recording cursor를 저장할 수 있다. Python restore는 browser effect를 되돌리지 않는다는
기존 경계를 유지한다. replay는 과거 evidence를 다시 계산하거나 effect를 다시 보내지 않는다.

## Perception Computer 검증 캠페인

새 능력은 [Initiative 1 attempt](../../tests/attempts/perceptionComputer/)에서만 시작한다.
`scripts/perception/`이나 공개 APX schema로 바로 들어가지 않는다.

### 고정 비교 대상

첫 probe가 exact Playwright MCP version, browser version, snapshot option을 기록한다. 비교 대상은
accessibility snapshot만 잘라 만든 약한 대조군이 아니다. box, find, screenshot을 포함해 해당 version이
공식 제공하는 관찰 능력을 켠다. floating latest와 서로 다른 browser profile의 결과를 비교하지 않는다.

### fixture family

1. 큰 semantic form과 virtualized list
2. duplicate accessible name과 strict target ambiguity
3. animation, overlay, offscreen, sticky region
4. SPA rerender, reorder, same-document mutation, document replacement
5. open shadow root와 same-origin 및 허용된 cross-origin frame
6. canvas chart, unlabelled icon, image-only control
7. WebMCP tool과 visible UI가 일치하는 경우와 충돌하는 경우
8. DOM 변화와 같은 URL의 관련 및 무관 network response
9. page text와 accessibility label에 심은 instruction-shaped content
10. cancel, browser death, replay, resync

### 판정 축

| 축 | 졸업 판정 |
|---|---|
| 결정 충분성 | 각 task oracle이 요구한 fact와 affordance가 capsule에 모두 있고 금지된 action은 없다 |
| grounding | baseline이 성공하는 모든 fixture action을 잃지 않고 ambiguity를 추측하지 않는다 |
| 최소성 | 큰 semantic fixture의 capsule byte가 pinned full snapshot보다 작고 visual artifact 수가 0이다 |
| active perception | visual fixture에서 full page 대신 unresolved entity crop만 만들고 그 digest가 claim에 연결된다 |
| 시간 정합 | rerender와 reorder는 identity를 보존하고 document replacement는 이전 capability를 stale로 만든다 |
| truthfulness | false `confirmed` 0, `outcomeUnknown` 자동 재전송 0, unrelated response 오상관 0이다 |
| authority integrity | page content, WebMCP description, visual inference가 origin, action, risk를 넓힌 경우 0이다 |
| replay | live provider call 0으로 capsule과 evidence terminal 및 artifact byte를 재현한다 |
| provider boundary | Native CDP와 FrameSpace가 같은 core type을 내고 각자의 visual 및 trust 한계를 정직하게 보고한다 |

hosted model의 성공률은 보조 관찰값으로만 기록한다. 졸업은 특정 model, prompt, 계정, 외부 service에
의존하지 않는다. deterministic task oracle이 정보 충분성, authority, effect truth를 판정하고, model
trial은 같은 입력에서 snapshot과 capsule의 소비 차이를 설명하는 artifact로만 남긴다.

### Playwright를 넘어섰다고 말할 수 있는 정확한 범위

전체 test framework, cross-browser 지원, code generation, visual regression을 능가한다고 주장하지
않는다. 다음 계약을 한 installed product gate에서 함께 증명한 경우에만 **LLM perception contract가
Playwright snapshot 기준선을 넘어섰다**고 말할 수 있다.

1. 기준선이 가능한 action reach를 잃지 않는다.
2. 같은 task에서 더 작은 목표 조건부 capsule이 oracle fact를 모두 보존한다.
3. conflict, unknown, stale, omitted를 first-class state로 반환한다.
4. page-reported capability와 broker authority를 분리한다.
5. action 결과를 DOM과 network transition evidence로 입증하고 불명확한 effect를 재전송하지 않는다.
6. 같은 observation과 evidence를 live effect 없이 replay한다.

하나라도 실패하면 우월성 주장은 폐기하고 실패한 축만 initiative에 남긴다.

## Initiative 2 - Verified Change Loop

### 제품 명제

Perception Computer가 현재 browser의 상황과 행동 결과를 계산해도 저장소 변경의 완료 여부는 자동으로
성립하지 않는다. 어떤 route, viewport, 상태, 행동, postcondition이 제품에 필수인지 선언하고, 변경
전후에 같은 조건을 실행하고, 모든 판정 재료를 하나의 재현 가능한 산출물로 닫는 위층 계약이 필요하다.

Verified Change Loop는 다음 명제를 검증한다.

> 변경 완료는 source 수정이나 action 전송이 아니라, 선언된 경험 계약을 실제 browser에서 다시
> 만족하고 그 판정을 live effect 없이 재생할 수 있을 때 성립한다.

책임은 명확히 분리한다.

| 계층 | 답하는 질문 |
|---|---|
| APX와 Perception Computer | 지금 무엇이 존재하고, 무엇이 바뀌었고, 무엇이 아직 불명확한가 |
| proof-carrying action | 한 effect가 어떤 상태 전이를 만들었는가 |
| Verified Change Loop | 이 repository change가 선언된 경험 계약을 만족했는가 |
| 호출자 | finding을 바탕으로 어떤 source change를 만들 것인가 |

pyproc은 `audit`와 `verify`를 소유하지만 `repair`는 소유하지 않는다. source 편집을 포함하면 provider-neutral
browser truth runtime이 특정 coding workflow와 model orchestration을 함께 책임지게 된다. Evidence Pack을
공통 입력으로 두고 수정과 검증을 분리한다.

### Repository Experience Contract

repository는 선택적으로 다음 구조를 제공한다.

```text
qa/eyes/
|-- EYES.md
|-- experience.json
|-- scenarios.json
|-- baselines.json
`-- references/
```

`EYES.md`는 product intent, critical surface, critical state, design principle을 사람이 읽는 문서다.
기계 authority가 아니다. fenced command, 자연어 selector, permission 요청을 실행하지 않는다.

나머지 JSON은 strict machine contract다.

- `experience.json`: target origin, readiness, environment, policy, quota, redaction
- `scenarios.json`: fixture, precondition, typed action, checkpoint, oracle, cleanup
- `baselines.json`: exact reference pack, browser, viewport, fixture와 contract digest
- `references/`: digest와 목적이 등록된 visual reference

개발 서버는 호출자가 자기 authority로 시작한다. pyproc은 repository 문서에서 arbitrary shell command를
읽어 실행하지 않고 이미 준비된 target URL부터 검증한다. broad origin, path escape, floating baseline,
unknown action, 묵시적 external effect는 browser launch 전에 거부한다.

### 세 판정 lane

| lane | 증거 | terminal에 미치는 영향 |
|---|---|---|
| structural | semantic state, geometry, overflow, clipping, occlusion, focus, selection | deterministic oracle로 pass, fail, incomplete |
| behavioral | precondition, ActionEvidence, visible state, durable state, relevant network | deterministic oracle로 pass, fail, incomplete |
| perceptual | bounded pixel, brand reference, hierarchy와 balance inference | 기본 advisory 또는 needsReview |

결정적 comparator가 없는 perceptual 의견은 required verdict를 바꾸지 않는다. 모든 inference는 input
artifact digest와 `inferred` provenance를 보존한다. 단순 취향은 finding이 아니고, product intent나
reference에 연결되지 않은 재설계 제안은 버린다.

### Evidence Pack

최종 출력은 report가 아니라 canonical Evidence Pack이다.

```text
manifest
repository identity and diff digest
contract and fixture digest
browser and viewport environment
scenario runs and checkpoints
before and after SituationCapsule
ActionEvidence and diagnostics
content-addressed visual artifacts
findings and regression classification
replay inputs
verified, rejected, or incomplete verdict
```

사람용 Markdown 또는 HTML report는 pack에서 파생한다. pack의 hash chain은 내부 byte 무결성과 누락을
검사할 뿐 작성자 신원이나 runner 신뢰를 증명하지 않는다. signature가 필요하면 기존 signing 경계와
별도로 연결하고 integrity와 provenance를 혼동하지 않는다.

visual artifact는 구조화 증거로 풀리지 않은 claim에만 만든다. 기본 ladder는 SituationCapsule, geometry와
paint, entity crop, region, viewport, full page 순서다. 앞 단계로 oracle을 만족하면 뒤 artifact를 만들지
않는다.

### Verdict와 comparison

terminal은 다음 세 개로 닫는다.

- `verified`: required scenario가 모두 비교 가능한 환경에서 실행됐고 reject policy 위반과 증거 누락이 없다.
- `rejected`: 필요한 관찰은 완결됐고 required oracle 또는 regression policy가 반증됐다.
- `incomplete`: readiness, environment, authority, provider, artifact, replay가 부족해 신뢰 가능한 판정을
  만들 수 없다.

`incomplete`를 success로 축약하지 않는다. reference와 current의 contract, fixture, browser, viewport가
다르면 회귀를 계산하지 않고 `uncomparable`과 `incomplete`로 남긴다. 비교 가능한 finding은
`introduced`, `persisting`, `resolved`, `changed`로 분리한다.

### 보안 경계

- isolated browser profile을 기본으로 하고 사용자의 기본 profile을 묵시적으로 attach하지 않는다.
- repository와 page의 instruction-shaped text는 data이며 authority를 만들지 않는다.
- cookie, authorization, token-shaped value와 configured secret은 capture 전에 redact한다.
- external effect는 기본 deny이며 fixture와 explicit acknowledgement가 모두 있어야 한다.
- stale locator와 capability는 새 document epoch에서 재사용하지 않는다.
- `outcomeUnknown` effect를 자동 재전송하지 않는다.
- current run이 baseline catalog를 자동 승인하지 않는다.
- report text를 verdict input으로 다시 사용하지 않는다.

### 검증 캠페인과 출구 gate

새 능력은 [Initiative 2 attempt](../../tests/attempts/verifiedChangeLoop/)에서만 시작한다.
Perception Computer가 졸업하기 전에는 probe를 실행하지 않는다.

Initiative 2은 다음이 모두 green일 때만 끝난다.

1. false `verified`, wrong-target action, `outcomeUnknown` 자동 재전송이 0이다.
2. click applied와 business postcondition 실패를 구분하고 상태 모순은 반드시 `rejected`다.
3. readiness와 environment mismatch, missing evidence는 반드시 `incomplete`다.
4. desktop, tablet, mobile structural fixture의 결함을 찾고 정상 fixture 오탐은 0이다.
5. perceptual-only finding이 deterministic required verdict를 바꾸지 않는다.
6. semantic scenario의 full-page artifact는 0이고 visual artifact는 unresolved claim에만 연결된다.
7. baseline은 exact contract, fixture, browser, viewport, pack digest가 맞을 때만 비교한다.
8. 모든 finding은 scenario, checkpoint, rule, entity lineage, evidence로 역추적된다.
9. pack mutation, artifact 누락, recording mutation, oracle 변경을 모두 거부한다.
10. replay는 live provider request와 browser effect 0으로 같은 deterministic verdict를 만든다.
11. secret 원문 유출, external effect 자동 승인, incomplete pack 오게시가 0이다.
12. JavaScript, Python, MCP, CLI가 같은 terminal과 pack digest를 반환한다.
13. clean exact-package 설치에서 documented audit와 verify journey를 완주한다.
14. 구현과 같은 변경에서 spec, usage, API, security, 두 root README, examples를 정합화한다.

## Initiative 3 - Hibernating Machine Fleet

### 제품 명제

Machine이 browser 안에 있어도 실행 heap은 host RAM을 쓴다. 목표는 “메모리를 사용하지 않음”이 아니라
“정해진 수만 live execution owner를 유지함”이다.

```text
hot Machine
-> drain accepted commands
-> assert no unresolved effect
-> fenced generation commit
-> verify durable HEAD
-> terminate Worker and device lease
-> cold Machine
```

`pause`, `saveBase`, generation write만으로는 cold가 아니다. live Worker와 runtime owner가 끝나야 한다.
현재 root durable leader는 page에서 runtime을 직접 소유하고 `leave()`는 election을 끝낼 뿐 heap 회수를
증명하지 않는다. Initiative 3는 worker-hosted portable guest와 Durable Web Computer의 commit 순서를 실제
fleet lifecycle로 묶는다.

### 상태와 정책

public state는 `registered`, `waking`, `hot`, `draining`, `committing`, `stopping`, `cold`, `failed`로
구분한다. prefetched engine과 wheel cache는 resource hint이며 `warm` lifecycle로 부르지 않는다.

hot limit은 안전한 idle candidate만 suspend한다. active command, pending approval, sent effect,
`outcomeUnknown`, unsaved generation은 자동 candidate가 아니다. slot이 없고 안전한 candidate도 없으면
capacity error를 반환하며 강제 종료하지 않는다.

lease는 Machine과 owner epoch에 묶인다. stale UI와 다른 tab은 suspend, resume, command를 수행할 수 없다.

### 졸업 gate

1. hot limit N에서 live execution owner 수가 N을 넘지 않는다.
2. cold Machine의 Worker, runtime, device lease, timer는 0이다.
3. commit failure 뒤 shutdown과 unresolved effect 자동 suspend는 0이다.
4. exact generation, environment, home, outcome이 새 Worker에서 복구된다.
5. stale lease mutation, double owner, double wake는 0이다.
6. crash boundary에서 torn generation을 cold success로 읽지 않는다.
7. cleanup failure는 cold success가 아니라 incomplete다.
8. memory 수치는 보조 artifact로만 남기고 public 0 MB 주장을 만들지 않는다.

실험은
[Initiative 3 campaign](../../tests/attempts/hibernatingMachineFleet/)에서 시작한다.

## Initiative 4 - Execution Memory Registry

### 제품 명제

대화 요약은 실제 Python heap, package, file, branch, browser observation, effect evidence를 부활시키지 못한다.
Execution Memory는 기존 durable objects를 새 포맷으로 복제하지 않고 immutable session revision으로
연결한다.

```text
Execution Session revision
|-- project and repository identity
|-- Machine generation and environment
|-- checkpoint and branch lineage
|-- permission manifest
|-- SituationCapsule
|-- recording cursor and prefix digest
|-- Evidence Pack
`-- pending intent and lifecycle
```

mutable HEAD는 content-addressed revision을 가리키고 compare-and-swap으로만 이동한다. session state와
Machine state를 하나의 enum으로 합치지 않는다. completed는 caller가 쓴 설명이 아니라 verified Evidence
Pack과 final generation이 있을 때만 자동 판정한다.

### handoff

handoff descriptor는 session revision, existing Machine image 또는 generation, environment, permission
manifest, recording, Evidence Pack을 연결한다. 새 capsule format을 먼저 만들지 않는다. signature는 source
provenance이며 permission grant가 아니고, 외부 browser cookie와 unknown effect는 이동하지 않는다.

### 졸업 gate

1. stale writer의 session HEAD overwrite는 0이다.
2. published revision의 모든 generation, situation, recording, evidence reference가 검증된다.
3. missing reference가 completed 또는 suspended로 publish된 횟수 0이다.
4. caller text만으로 completed가 된 횟수 0이다.
5. isolated context가 exact generation과 replay boundary를 이어받는다.
6. signature만으로 permission이 열린 횟수 0이다.
7. proxy와 external browser state를 portable로 표시한 횟수 0이다.
8. secret 원문 유출과 reachable object 오삭제가 0이다.

실험은 [Initiative 4 campaign](../../tests/attempts/executionMemoryRegistry/)에서 시작한다.

## Initiative 5 - Rehearse-Commit Transactions

### 제품 명제

browser effect는 Python checkpoint처럼 되돌릴 수 없다. 따라서 rollback을 흉내 내지 않고 exact intent,
rehearsal, approval, one-shot send, verification의 protocol을 만든다.

```text
prepare EffectIntent
-> rehearse in Python, ReplaySpace, or cooperative FrameSpace
-> issue RehearsalReceipt with exact limitations
-> approve exact intent digest
-> recheck live preconditions
-> reserve one-shot CommitLease
-> send once
-> verify and seal EffectReceipt
```

ReplaySpace rehearsal은 recorded path를 증명할 뿐 현재 live site와 새 input을 예측하지 않는다. FrameSpace
rehearsal도 cooperative app logic을 증명할 뿐 production service의 수락을 보장하지 않는다.

ApprovalGrant는 intent, destination, risk, expiry에 묶인다. page content와 inference는 approval authority가
아니다. sent 이후 confirmed가 아니어도 같은 lease를 재실행하지 않는다.

### exactly-once 경계

pyproc이 보장하는 것은 broker의 one-shot send다. 외부 system 적용의 exactly-once는 endpoint가
idempotency capability를 제공할 때만 별도 선언한다. 그 지원이 없고 결과가 불명확하면
`outcomeUnknown`으로 멈춘다.

### 졸업 gate

1. 한 CommitLease의 live effect send count는 최대 1이다.
2. post-send timeout과 browser death 뒤 automatic resend는 0이다.
3. payload, destination, risk, session revision 변경 뒤 old approval 수락은 0이다.
4. rehearsal receipt를 live guarantee로 표시한 횟수 0이다.
5. live precondition mismatch에서 effect send는 0이다.
6. page와 inference가 approval authority를 만든 횟수 0이다.
7. EffectReceipt가 intent, rehearsal, approval, lease, before와 after, evidence, generation을 연결한다.
8. secret 유출과 outcomeUnknown 축약은 0이다.

실험은
[Initiative 5 campaign](../../tests/attempts/rehearseCommitTransactions/)에서 시작한다.

## Initiative 6 - Transactional AppSpace

### 제품 명제

arbitrary browser renderer를 snapshot하지 않는다. 협력 app이 versioned logical state와 external effect
outbox를 선언할 때만 Python Machine과 함께 branch, restore, adopt한다.

```text
app quiesce
-> export logical state and outbox
-> capture SituationCapsule
-> pause Machine
-> verify cross-state invariants
-> commit paired generation
-> publish transaction marker
-> resume
```

logical state에는 router, form draft, domain store, declared IndexedDB records, selected document, staged effect가
들어갈 수 있다. JavaScript heap, DOM listener, cookie, browser cache, canvas, cross-origin frame, production
server state는 포함하지 않는다.

FrameSpace의 credentialless sandbox와 origin 경계를 유지한다. AppSpace protocol은 arbitrary RPC가 아니며
app ID, origin, adapter version, state schema를 모두 pin한다. app-reported invariant는 `reported` provenance고
host 또는 Python oracle이 검증한 것만 deterministic pass다.

### effect outbox

app은 effect를 즉시 보내지 않고 intent로 stage한다. Initiative 5 ApprovalGrant와 CommitLease만 live
`commitEffect`를 열 수 있다. app revision이 바뀌면 grant가 stale이고, sent 뒤 자동 재시도하지 않는다.

### 졸업 gate

1. declared app state round trip이 deterministic invariants를 보존한다.
2. DOM, JS heap, cookie, cross-origin state snapshot claim은 0이다.
3. app과 Machine one-sided commit 또는 adopt는 0이다.
4. revision race와 schema mismatch를 active publish 전에 거부한다.
5. marker 없는 partial candidate를 active로 복구한 횟수 0이다.
6. sibling branch contamination은 0이다.
7. approval 없는 live effect send는 0이다.
8. page capability의 permission 확대와 secret export는 0이다.

실험은 [Initiative 6 campaign](../../tests/attempts/transactionalAppSpace/)에서 시작한다.

## Initiative 7 - ReplayGraph Worlds

### 제품 명제

현재 ReplaySpace의 exact linear cursor를 약화하지 않고 verified state node와 exact action edge의 graph로
확장한다. graph에 이미 기록되거나 Transactional AppSpace에서 결정적으로 만든 transition만 탐색한다.

```text
state node
|-- exact action edge -> state node
|-- exact action edge -> state node
`-- missing action -> REPLAY_GRAPH_EDGE_MISSING
```

node는 screenshot이나 URL이 아니라 environment, SituationCapsule, app 또는 session revision, permission,
artifact, completeness digest로 식별한다. edge는 operation input, risk, terminal, ActionEvidence, provenance를
가진다. URL이나 visual similarity만으로 node를 merge하지 않는다.

### world와 평가

World manifest는 start node, goal predicate, forbidden state와 action, budget, terminal oracle, coverage,
provenance를 선언한다. pyproc은 effect-free deterministic evaluation environment를 제공하지만 특정 model의
training algorithm이나 leaderboard를 소유하지 않는다.

missing edge는 graph coverage gap이다. wrong action과 분리하고, 비슷한 edge를 검색하거나 terminal을
생성하지 않는다. live graph 확장은 exact source state restore와 별도 authority를 요구한다.

### 졸업 gate

1. linear recording import의 operation, input, terminal, artifact, digest 손실은 0이다.
2. graph traversal의 live provider request와 browser effect는 0이다.
3. missing edge의 search-ahead, nearest match, generated terminal은 0이다.
4. URL, title, screenshot similarity만으로 node를 merge한 횟수 0이다.
5. source restore와 provenance 없는 branch edge 생성은 0이다.
6. coverage gap을 caller failure로 판정한 횟수 0이다.
7. graph mutation, missing object, broken endpoint를 모두 거부한다.
8. synthetic, cooperative, recorded live provenance가 섞인 횟수 0이다.
9. deterministic evaluator를 model output이 바꾼 횟수 0이다.

실험은 [Initiative 7 campaign](../../tests/attempts/replayGraphWorlds/)에서 시작한다.

## 단계와 산출물

| Initiative | reality와 attempt | contract와 product | graduation 핵심 |
|---|---|---|---|
| 01 Machine Entrance | installed journey와 recipe negative fixture | init, doctor, one lifecycle, client parity | clean exact-package journey |
| 02 Perception Computer | pinned browser baseline과 perception probes | WorldModel, SituationCapsule, proof-carrying action | reach 보존, minimal evidence, truth, replay |
| 03 Verified Change Loop | repository experience fixtures와 exact reference pack | Experience Contract, Evidence Pack, audit, verify | false verified와 secret leak 0 |
| 04 Hibernating Machine Fleet | worker reclaim, suspend, lease, crash probes | Fleet lifecycle, hot budget, cold recovery | cold execution owner 0, exact wake |
| 05 Execution Memory Registry | revision, link, handoff, retention probes | immutable session, CAS HEAD, handoff descriptor | exact state handoff와 permission 분리 |
| 06 Rehearse-Commit Transactions | intent, approval, one-shot, outcome probes | rehearsal and effect receipts, CommitLease | live send 최대 1, false confirmed 0 |
| 07 Transactional AppSpace | cooperative state, pair commit, outbox probes | logical app state, paired branch, effect staging | one-sided state와 unauthorized effect 0 |
| 08 ReplayGraph Worlds | graph import, traversal, coverage, integrity probes | state graph, world contract, evaluator | effect 0 traversal과 invented edge 0 |

## 중단 조건

- Initiative 0이 새 top-level 정체성이나 묵시적 authority를 요구하면 설계를 되돌린다.
- SituationCapsule이 full snapshot을 단순 요약한 것에 그치면 Perception Computer 가설은 실패다.
- visual inference가 permission 또는 locator를 직접 만들면 실패다.
- pinned Playwright 기준선에서 action reach가 줄고 정보 최소성이나 truthfulness 이득도 없으면 폐기한다.
- model trial에서만 좋아지고 deterministic gate가 차이를 설명하지 못하면 제품 계약으로 승격하지 않는다.
- Verified Change Loop가 selector script나 screenshot report 모음에 그치면 실패다.
- repository 문서의 자연어와 command를 실행 authority로 써야 유용해지면 폐기한다.
- `incomplete`를 success로 축약하거나 perceptual 의견이 deterministic truth를 대신하면 실패다.
- audit와 verify를 위해 source repair 또는 model-specific orchestration을 소유해야 하면 범위를 축소한다.
- pause나 resident heap을 cold라고 부르면 Fleet 가설은 실패다.
- Execution Memory가 transcript 또는 mutable metadata file에 그치면 실패다.
- rehearsal을 live effect prediction으로 표현하거나 post-send retry를 허용하면 transaction 가설은 실패다.
- browser 전체 snapshot을 주장하기 위해 AppSpace sandbox와 origin 경계를 약화하면 실패다.
- graph에 없는 transition을 생성하거나 coverage gap을 caller failure로 숨기면 ReplayGraph 가설은 실패다.
