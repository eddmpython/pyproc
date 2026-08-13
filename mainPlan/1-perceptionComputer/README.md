# Initiative 1: Perception Computer 실행 계획

상태: **구현 중**

이 문서는 APX를 화면 관찰 형식에서 브라우저 인지 커널로 완성하는 단일 이니셔티브의 임시 실행
계획이다. 아래 종료 조건을 모두 만족할 때까지 다른 이니셔티브로 이동하지 않는다.

지속 제품 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-1---perception-computer),
현재 공개 계약은 [APX 1.0](../../docs/specs/apx/README.md), 실험 원장은
[Initiative 1 attempt](../../tests/attempts/perceptionComputer/README.md)가 소유한다. 이 계획은
그 세 문서를 대체하지 않는다. 구현 순서, 파일 책임, 검증, 문서 정합, 종료 절차를 한 작업 단위로
묶는다.

## 1. 최종 결과

완료된 제품은 LLM에 screenshot이나 전체 accessibility tree를 넘기는 도구가 아니다. 브라우저에서
관측한 사실, 가능한 행동, 불확실성, 시간 변화, 행동 결과를 지속적으로 계산하고 목표에 필요한 최소
충분 상태만 반환하는 **Browser Cognition Kernel**이다.

제품 루프는 다음 한 문장으로 고정한다.

```text
sense -> reconcile -> believe -> focus -> probe -> authorize -> act once -> verify -> remember
```

사용자가 얻는 결과는 다음과 같다.

1. 현재 page 전체가 아니라 질문에 답하는 `SituationCapsule`을 받는다.
2. 관측된 사실, page가 보고한 설명, broker가 부여한 권한, 추론 결과를 구별할 수 있다.
3. 모르는 것과 충돌하는 것을 빈 값이나 confidence 숫자로 숨기지 않는다.
4. 실행 가능한 행동은 현재 session과 document epoch에 묶인 capability로만 받는다.
5. 행동 뒤에는 클릭 성공이 아니라 기대한 상태 전이가 일어났는지 증거와 함께 받는다.
6. 같은 기록을 live provider 호출과 effect 재전송 없이 재생할 수 있다.
7. semantic 정보로 충분할 때 pixel artifact를 만들지 않고, 부족할 때만 좁은 영역을 측정한다.

“브라우저를 이해한다”는 표현은 아래 다섯 능력이 모두 실측됐다는 뜻으로만 사용한다.

- 필요한 사실을 evidence와 provenance가 있는 typed claim으로 반환한다.
- 현재 가능한 행동과 실제 실행 권한을 분리한다.
- `known`, `conflicted`, `unknown`, `stale`을 구분한다.
- 이전 상태와 현재 상태의 변화 및 document replacement를 정직하게 추적한다.
- effect와 business postcondition을 분리하고 terminal truth를 보수적으로 판정한다.

주관적 이해도나 특정 모델의 인상 평가는 제품 계약이 아니다.

### 경쟁 명제

탭에 연결할 수 있다는 사실만으로는 우위가 아니다. 비교 대상도 extension을 통해 기존 browser와
여러 탭을 다룰 수 있다. 이 이니셔티브가 검증할 차이는 **어디에서 조작하는가**가 아니라
**무엇을 지속적으로 계산하고 어떤 증거를 반환하는가**다.

| 외부 자동화 중심 | Perception Computer 목표 |
|---|---|
| 요청 시 page snapshot을 얻음 | observation 사이에도 identity와 transition을 가진 world를 유지 |
| ref로 element를 조작 | epoch와 policy에 묶인 capability로 intent를 실행 |
| tree 또는 screenshot을 소비자가 해석 | typed requirement에 충분한 claim closure를 browser computer가 계산 |
| action 완료를 반환 | business postcondition과 effect causality를 evidence로 판정 |
| 누락 정보를 소비자가 추측 | unknown, conflict, stale과 다음 probe를 계약으로 반환 |
| trace를 사후 조사 | 당시 world와 terminal을 effect 없이 다시 재생 |

따라서 비교에서 이겨야 할 대상은 selector API의 수나 screenshot 품질이 아니다. 같은 task reach를
보존하면서 소비자가 읽어야 할 상태를 줄이고, baseline이 표현하지 않는 truth와 authority를 추가하는
것이다. 이 명제가 반증되면 “탭 안이라서 혁신적”이라는 설명도 폐기한다.

## 2. 착수 잠금

구현 세션은 다음 순서로 시작한다.

1. `CLAUDE.md`, `index.js`, `src/`, `README.md`를 다시 읽는다.
2. `git status --short`로 다른 세션의 잔여 변경을 확인하고 어떤 것도 되돌리지 않는다.
3. `docs/operations/contractReality.md`, 이 계획, attempt README, APX 계약의 차이를 대조한다.
4. Machine Entrance가 당시 계획에 남아 있다면 그 출구 gate와 설치 package golden journey가 green인지
   확인한다. 끝나지 않았다면 이 이니셔티브를 시작하지 않는다.
5. `npm test`를 시작 기준선으로 실행한다. 런타임 변경이 이미 들어왔으면 관련 browser 및 installed
   gate도 먼저 실행한다.
6. Playwright 비교 대상, browser binary, viewport, fixture digest를 exact 값으로 잠근다.
7. `tests/attempts/perceptionComputer/` 안에서만 첫 코드를 작성한다.

착수 시 파일 이름이나 표면이 이 계획 작성 시점과 달라졌다면 최신 코드가 정본이다. 먼저 이 계획의
영향 파일 표를 최신 심볼로 고친 뒤 계속한다. 의미 게이트를 약화해 이름 차이를 해결하지 않는다.

## 3. 현재 기반과 정확한 부족분

| 현재 기반 | 이미 증명된 것 | 이 이니셔티브가 채울 것 |
|---|---|---|
| `PerceptionSpace` | provider fact 정규화, session FIFO, full/delta, rollback | 지속 world commit과 목표별 projection을 별도 책임으로 분리 |
| `PerceptionIdentity` | document epoch 안의 opaque `entityRef` | cross-epoch 동일성 추측 금지와 명시적 replacement 관계 |
| `PerceptionTimeline` | bounded observation ledger, stable digest, changed path | claim, conflict, freshness, transition을 가진 world ledger |
| `perceptionQuery` | 단일 predicate 기반 attention | 여러 typed requirement의 최소 충분 closure |
| `perceptionBudget` | entity, relation, byte 상한과 omitted 보고 | 필수 fact를 조용히 자르지 않는 sufficiency budget |
| `webCdpSensor` | semantic, structure, geometry, interaction, event fact | snapshot reconciliation과 선택적 event feed |
| `frameSensor` | cooperative frame의 provider-neutral fact | 탭 안의 bounded mutation feed와 gap 복구 |
| `ActionEvidenceLoop` | before/effect/after, DOM와 network postcondition | capability와 expected transition을 before world에 묶는 proof |
| `RecordingSpace`와 `ReplaySpace` | canonical terminal 및 artifact replay | capsule과 transition proof의 byte 및 digest 재현 |
| JavaScript/Python facade | observe, query, act, change ergonomics | situate, requirement, unknown, affordance ergonomics |
| MCP `browserObserve` | legacy 및 `apx.graph` opt-in | 같은 tool 안의 `apx.situation` opt-in |

현재 APX는 이미 좋은 뼈대다. 따라서 새 시스템은 옆에 별도 제품을 만들지 않고 기존 identity,
provenance, budget, evidence, replay 불변식을 아래에서 확장한다.

## 4. 바꾸지 않는 경계

다음은 구현 편의를 위해 희생하지 않는다.

1. Control Protocol operation은 `automation.observe`와 `automation.act` 그대로다.
2. `apx.graph` 1.0의 입력, 출력, digest, replay 의미는 바이트 수준으로 호환한다.
3. 새 npm root export와 새 bin을 추가하지 않는다.
4. 안정 소비 표면은 `pyproc/control`, `pyproc-mcp`, `pyproc-control`이다.
5. provider native node, object, frame, execution context 식별자는 public envelope에 나오지 않는다.
6. `entityRef`는 identity이고 action authority가 아니다.
7. page content, WebMCP declaration, pixel inference는 origin, action, risk, destination 권한을 넓히지
   못한다.
8. `outcomeUnknown` effect는 자동 재전송하지 않는다.
9. Python checkpoint와 browser effect rewind를 같은 것으로 표현하지 않는다.
10. FrameSpace는 credentialless sandbox이고 Native CDP의 compositor 또는 signed-in session 능력을
    주장하지 않는다.
11. Firefox와 Safari 지원을 이 이니셔티브에 끼워 넣지 않는다.
12. hosted model의 성공률을 필수 졸업 판정자로 삼지 않는다.

## 5. 최종 공개 계약

### 5.1 Representation 결정

새 표면은 기존 graph에 optional field를 계속 붙이지 않는다. 다음 opt-in representation을 추가한다.

```json
{
  "operation": "automation.observe",
  "input": {
    "representation": "apx.situation",
    "expectedRisk": "read",
    "focus": {},
    "budget": {},
    "visual": { "mode": "auto" }
  }
}
```

- protocol family는 `apx`다.
- representation은 `apx.situation`이다.
- 첫 schema 세대는 `1.0`이다.
- `apx.graph`와 schema를 공유한다고 가장하지 않는다.
- 공통 provenance, ref, artifact, digest vocabulary만 재사용한다.
- profile에는 `apx-core/1`, `apx-web/1`, `apx-situation/1`을 요구한다.
- action evidence가 가능한 provider는 `apx-action/1`, visual probe가 가능한 provider는
  `apx-visual/1`을 추가한다.

첫 wire probe가 이 결정을 반증하지 않는 한 이 형태로 구현한다. 반증 조건은 같은 입력이
`apx.graph` validator나 기존 recording digest를 바꾸어야만 구현 가능한 경우다. 반증되면 APX major를
올리는 것이 fallback이며, graph 1.0을 느슨하게 만드는 것은 fallback이 아니다.

### 5.2 Focus는 권한이 아니다

자연어 objective만으로 필요한 사실을 자동 결정하면 core가 특정 모델에 종속되고 page instruction과
사용자 intent의 경계가 흐려진다. 따라서 `focus.objective`는 사람이 읽는 맥락으로만 보존하고,
결정적 projection은 typed requirement가 소유한다.

```json
{
  "focus": {
    "objective": "Submit the prepared order and prove that it was accepted",
    "requirements": [
      {
        "requirementRef": "requirement:submit",
        "select": { "role": "button", "name": { "exact": "Submit order" } },
        "need": ["fact", "affordance"],
        "cardinality": "one"
      },
      {
        "requirementRef": "requirement:result",
        "select": { "role": "status" },
        "need": ["change"],
        "cardinality": "oneOrMore"
      }
    ],
    "changedSince": "situation:previous",
    "freshness": { "mode": "live", "maxAgeMs": 1000 }
  }
}
```

v1 requirement는 기존 APX query vocabulary를 재사용한다. 임의 script, CSS selector, raw CDP query,
자연어 실행 명령을 넣지 않는다. optional inference adapter가 objective에서 requirement 후보를 만들 수는
있지만, 그 결과는 `inferred` provenance를 가지며 strict validator와 기존 manifest authority를 다시
통과한다.

`objective`와 requirement value는 target page, reported capability provider, visual inference provider에
암묵적으로 전달하지 않는다. 외부 adapter로 보낼 때는 별도 policy와 redaction을 통과해야 한다.
recording은 input을 보존하므로 objective에 민감 정보가 들어갈 수 있다는 점을 usage와 security 문서에
명시한다.

### 5.3 SituationCapsule

최종 envelope는 다음 의미를 가져야 한다. 예시는 방향이며 JSON Schema와 validator가 정확한 정본이
된다.

```json
{
  "protocol": "apx",
  "version": "1.0",
  "representation": "apx.situation",
  "profile": ["apx-core/1", "apx-web/1", "apx-situation/1"],
  "situationRef": "situation:...",
  "worldRef": "world:...",
  "observationRef": "observation:...",
  "documentEpoch": 7,
  "capturedAt": "...",
  "focus": {},
  "requirements": [],
  "facts": [],
  "affordances": [],
  "changes": [],
  "unknowns": [],
  "suggestedProbes": [],
  "completeness": {},
  "budget": {},
  "integrity": {}
}
```

필드 계약은 다음과 같다.

| 필드 | 계약 |
|---|---|
| `worldRef` | atomic world commit을 가리키는 opaque ref. canonical world digest를 별도 integrity에 보존 |
| `situationRef` | focus와 world를 함께 묶은 immutable projection ref |
| `requirements` | 각 requirement가 `satisfied`, `conflicted`, `unknown`, `stale` 중 어디에 수렴했는지 보고 |
| `facts` | subject, predicate, value, epistemic state, freshness, provenance, evidence refs를 가진 claim |
| `affordances` | 보이는 동작 가능성과 broker-issued capability를 구분한 action 후보 |
| `changes` | before와 after world, changed claims, causality 수준을 가진 transition |
| `unknowns` | missing channel, conflict, stale source, budget, provider gap 중 답하지 못한 이유 |
| `suggestedProbes` | unknown을 줄일 수 있는 read 또는 mutate probe와 비용, 권한, 예상 정보 이득 |
| `completeness` | sensor별 완전성, event gap, reconciliation 여부 |
| `budget` | 사용량, 생략량, 필수 requirement 보존 여부 |
| `integrity` | capsule canonical digest, source world digest, artifact digest 연결 |

### 5.4 Claim과 belief

같은 `(subjectRef, predicate, scope)`에 대한 여러 관측은 덮어쓰지 않고 attestation으로 합친다.

```text
claim key
  -> browser-observed attestation
  -> page-reported attestation
  -> derived attestation
  -> visual-inferred attestation
```

판정 규칙은 결정적이어야 한다.

- 같은 값이고 모두 fresh하면 `known`이다.
- 값이 다르고 우선순위만으로 사실을 확정할 수 없으면 `conflicted`다.
- 근거가 없거나 provider completeness가 부족하면 `unknown`이다.
- 근거의 epoch, source lifetime, freshness bound가 끝났으면 `stale`이다.
- confidence 하나로 conflict를 평균내지 않는다.
- `reported`와 `inferred`는 `observed`로 승격하지 않는다.
- page가 보고한 tool description은 content이며 instruction이나 permission이 아니다.
- cross-document navigation 뒤 예전 claim은 새 document의 fact가 아니다.

### 5.5 Affordance와 capability

`affordances`는 다음 네 종류를 구분한다.

1. `observed`: UI가 action처럼 보인다는 sensor fact
2. `derived`: geometry, state, hit test로 actionability를 계산한 결과
3. `reported`: page가 구조화 tool 또는 form capability라고 보고한 내용
4. `authorized`: broker가 현재 session, origin, epoch, action, risk에 대해 발급한 capability

오직 `authorized` 항목만 effect에 사용할 수 있다. 각 authorized affordance는 다음을 가진다.

```text
capabilityRef
entityRef or reportedCapabilityRef
action kind
preconditions
expected transition shape
risk
destination
session binding
document epoch
expiry
broker provenance
```

WebMCP는 실행 시점에 확인한 exact proposal revision과 browser implementation을 기록한다.
`document.modelContext`가 존재하더라도 discovery와 invocation 표면이 확인되지 않으면
`webMcp: unsupported`로 보고한다. cooperative fixture adapter로 reported capability plane을 증명할
수는 있지만 그것을 native WebMCP 지원이라고 문서화하지 않는다.

### 5.6 Proof-carrying action

기존 locator 기반 action은 호환 경로로 유지한다. 새 권장 경로는 capsule의 authorized affordance를
직접 소비한다.

```json
{
  "kind": "click",
  "locatorRef": "locator:...",
  "actionContext": {
    "intent": "Submit the prepared order",
    "situationRef": "situation:...",
    "worldRef": "world:...",
    "capabilityRef": "capability:...",
    "expectedTransition": { "...": "..." }
  },
  "verify": { "...": "..." },
  "expectedRisk": "externalEffect"
}
```

broker는 effect 전에 world와 capability의 session, epoch, expiry, action, risk, destination을 다시
검사한다. 하나라도 stale이면 provider에 도달하기 전에 `notSent`로 끝낸다. effect를 보낸 뒤에는
before world, effect window, correlated events, after world, postcondition을 한 transition proof로 묶는다.

causality는 다음 순서만 허용한다.

1. 같은 broker action 또는 request correlation id가 있으면 `direct`
2. explicit postcondition과 단일 대응 evidence가 있으면 `strong`
3. 시간 창 안의 변화뿐이면 `weak`
4. capture gap, browser death, 다중 후보면 `unknown`

`weak`만으로 business postcondition을 `confirmed`로 만들지 않는다.

### 5.7 JavaScript, Python, MCP 소비 형태

세 client는 같은 Control input과 terminal을 사용한다.

JavaScript의 목표 표면은 다음과 같다.

```js
const eyes = client.perception(sessionRef);
const situation = await eyes.situate({
  objective: "Submit the prepared order and prove acceptance",
  requirements: [
    { requirementRef: "requirement:submit", select: { role: "button", name: "Submit order" },
      need: ["fact", "affordance"], cardinality: "one" },
  ],
});

const submit = situation.requirement("requirement:submit").oneAffordance("click");
const result = await eyes.actAffordance(submit, { verify: {
  entityAppeared: { role: "status", nameContains: "Accepted" },
} });
```

Python은 기존 프로젝트 규칙에 맞춰 같은 camelCase 동사를 제공한다. MCP는 새 tool을 늘리지 않고
`browserObserve`의 `representation`, `focus`, `budget`, `visual`을 사용한다. raw Control 소비자는 같은
JSON을 직접 보낼 수 있다.

추가할 ergonomic value object 후보는 다음으로 제한한다.

- `SituationResult`
- `SituationRequirement`
- `SituationFact`
- `SituationAffordance`
- `SituationUnknown`

wire object를 숨겨 독자적인 의미를 만들지 않는다. 모든 wrapper는 immutable view다.

## 6. 내부 아키텍처

### 6.1 책임 흐름

```text
NativeCdpSpace or FrameSpace
          |
          v
provider sensor capture + optional event feed
          |
          v
PerceptionSpace turn coordinator
          |
          v
WorldModel atomic reconcile
  | world facts
  | capability candidates
  | belief state
  | transition ledger
          |
          v
SituationCompiler
  | requirement matching
  | relation closure
  | sufficiency check
  | probe planning
  | budget pruning
          |
          v
SituationCapsule + broker-issued affordances
```

### 6.2 승격 후 파일 배치

실측이 끝난 뒤에만 다음 형태로 `scripts/perception/`에 승격한다. probe 단계에는 같은 책임을
`tests/attempts/perceptionComputer/prototype/` 아래에서 검증한다.

```text
scripts/perception/
  apxCatalog.js                 기존 graph 1.0 vocabulary 유지
  perceptionSpace.js            turn, sensor, rollback, representation routing
  perceptionIdentity.js         epoch-scoped public identity
  perceptionTimeline.js         graph 1.0 호환 projection과 delta
  worldModel.js                 atomic world state, claim attestations, freshness
  situationCatalog.js           apx.situation constants, strict input/output validators
  situationCompiler.js          focus closure, sufficiency, deterministic projection
  probePlanner.js               unknown별 최소 비용 sensor 계획
  capabilityProjector.js        observed, derived, reported, authorized 분리
  transitionLedger.js           before/after world와 causality level
  actionEvidence.js             기존 terminal을 transition proof에 연결
  postconditionVerifier.js      기존 verdict 의미 유지
  schemas/
    apxSituationSchema.json     공개 wire 정본
    apxFocusSchema.json         focus와 requirement 정본
  profiles/
    webCdpSensor.js             snapshot과 bounded event feed
    frameSensor.js              cooperative snapshot과 bounded event feed
    reportedCapabilitySensor.js provider-neutral reported tool adapter
```

파일 수는 실측 뒤 다시 줄인다. `worldModel.js`와 `transitionLedger.js`가 독립 불변식을 갖지 못하면
합친다. 반대로 catalog와 알고리즘을 한 파일에 몰아넣지 않는다. provider별 policy 사본은 금지한다.

### 6.3 WorldModel atomicity

WorldModel은 session별 FIFO에서만 갱신한다.

1. sensor capture와 event suffix를 임시 상태에 넣는다.
2. document epoch와 sequence gap을 검증한다.
3. identity를 정규화한다.
4. claim attestation, capability candidate, transition을 계산한다.
5. canonical digest를 계산한다.
6. capsule 생성과 schema validation까지 성공한 뒤 commit한다.
7. 어느 단계든 실패하면 identity, locator, world, artifact를 모두 rollback한다.

부분 commit은 허용하지 않는다. 기존 visual 중간 실패 cleanup과 concurrent observe FIFO 시험을
WorldModel에도 그대로 적용한다.

### 6.4 World의 범위와 수명

WorldModel의 소유자는 page도 client wrapper도 아닌 `AutomationSpace`다. 하나의 space 안에서 상태를
다음처럼 분할한다.

```text
space world
  -> target summary와 opener 관계
  -> session world
       -> document epoch
            -> frame, entity, resource, event, claim
       -> capability lease
       -> situation ledger
       -> transition ledger
```

- 기본 capsule은 요청한 session과 현재 target만 투영한다.
- 다른 target의 title, origin, opener, lifecycle은 broker가 이미 관측하고 manifest가 허용한 범위에서만
  관계로 들어온다.
- cross-origin frame의 payload를 같은 world로 합치는 것은 해당 provider와 permission이 명시적으로
  제공할 때만 가능하다. 그렇지 않으면 opaque frame boundary와 unknown을 남긴다.
- target close는 그 target의 claim과 capability를 stale로 만들고, session detach는 locator와
  capability lease를 즉시 폐기한다.
- space close는 live world와 subscription을 지운다. 지속이 필요하면 RecordingSpace의 immutable
  terminal만 남긴다.
- world, situation, transition은 각각 count, canonical bytes, age 상한을 가진다. 상한 초과는 오래된
  capability를 연장하지 않으며, 참조가 사라진 소비자에게 `resyncRequired`를 반환한다.
- client별 사본을 만들지 않는다. 같은 space와 session의 JavaScript, Python, MCP 요청은 같은 FIFO
  world commit을 본다.

브라우저 전체를 이해한다는 말은 모든 origin의 내용을 무제한으로 읽는다는 뜻이 아니다. 권한 안에서
보이는 target, opaque boundary, 모르는 영역까지 하나의 정직한 world로 표현한다는 뜻이다.

### 6.5 탭 내부 event feed

FrameSpace의 강점은 cooperative target 안에서 변화를 감지할 수 있다는 점이다. optional sensor
계약으로 `subscribe(sessionRef, sink)`를 두고 다음 bounded signal만 보낸다.

- document lifecycle과 epoch change
- DOM child, attribute, text의 redacted mutation
- resize, intersection, scroll 위치 변화
- focus, selection, checked, expanded 같은 interaction state
- 등록 및 해제된 reported capability
- broker action과 연결 가능한 request 및 response metadata

password, token, cookie, authorization header, request body, unrestricted input value는 feed에 넣지 않는다.
모든 event는 `sensorSequence`, `documentEpoch`, monotonic capture time을 가진다. queue overflow, bridge
reconnect, sequence gap이 생기면 completeness를 낮추고 다음 situation 요청에서 full reconciliation을
강제한다.

Native CDP도 가능한 lifecycle, DOM, accessibility, network event를 feed로 줄 수 있지만 이벤트가
snapshot보다 진실하다고 가정하지 않는다. 어느 provider든 situation 반환 전 fresh snapshot과 event
suffix를 reconciliation한다. subscription이 없는 provider는 정직하게 `subscriptions: false`를
보고하고 on-demand capture만으로 같은 core type을 반환한다.

event actor attribution도 보수적으로 처리한다.

- broker가 발급한 actionRef와 연결된 input은 `broker`다.
- page lifecycle과 script mutation은 `page`다.
- 브라우저가 관측했지만 broker correlation이 없는 pointer, key, focus 변화는 `externalOrUnknown`이다.
- correlation 없는 입력을 사람의 행동이라고 단정하지 않는다.
- actor label은 evidence provenance이며 permission에 영향을 주지 않는다.

### 6.6 최소 충분 projection

SituationCompiler는 요약문을 생성하지 않는다. 다음 결정 알고리즘을 사용한다.

1. 각 typed requirement로 seed entity와 claim을 찾는다.
2. cardinality를 판정한다. 0개 또는 여러 개가 허용되지 않으면 unknown 또는 conflicted로 남긴다.
3. requested `need`에 해당하는 semantic, geometry, interaction, temporal claim을 선택한다.
4. label, parent, controls, owns, frame, occlusion, network correlation 등 판정에 필요한 relation closure만
   추가한다.
5. action 후보가 있으면 capability plane과 precondition을 추가한다.
6. `changedSince`가 있으면 관련 transition만 추가한다.
7. contradiction, stale source, missing completeness를 항상 포함한다.
8. 불필요한 sibling, unrelated event, raw page text를 제거한다.
9. canonical order와 digest를 계산한다.
10. 필수 requirement가 budget 때문에 빠지면 성공처럼 반환하지 않는다.

budget이 부족할 때의 순서는 고정한다.

```text
optional context 제거
-> unrelated relation 제거
-> weak evidence 요약
-> optional suggested probe 제거
-> required answer를 보존할 수 없으면 APX_BUDGET_EXCEEDED
```

필수 사실 일부를 조용히 잘라 `satisfied`로 반환하는 경로는 없다.

### 6.7 능동 지각

probe planner는 unresolved claim마다 현재 정보로 답하지 못한 이유와 해결 가능한 sensor를 연결한다.

```text
fresh cache
-> accessibility and DOM
-> reported capability
-> layout, paint, hit test
-> lifecycle and redacted network metadata
-> bounded entity crop
-> optional inference adapter
```

이 순서는 무조건 실행하는 pipeline이 아니다. claim 종류, provider support, permission, cost, freshness로
후보를 정렬한다.

- read permission과 request budget 안의 probe만 자동 실행할 수 있다.
- scroll, focus, hover처럼 page state를 바꾸는 probe는 `mutate`로 취급하고 read observe 안에서 자동
  실행하지 않는다.
- full screenshot은 focus가 명시적으로 overview를 요구할 때만 허용한다.
- semantic task에서 visual artifact는 0이어야 한다.
- canvas 또는 image-only task는 unresolved entity crop만 허용한다.
- inference adapter가 없으면 crop과 unknown을 반환한다. 존재하지 않는 이해를 꾸며내지 않는다.
- inference adapter가 있으면 input artifact digest, adapter identity, output claim, provenance를 기록한다.
- inference 결과는 action authority와 독립이다.

기본 제품은 실제 검증되지 않은 OCR 또는 inference provider를 내장했다고 주장하지 않는다. fixture
adapter는 digest와 trust plumbing의 계약 시험일 뿐 실제 시각 정확도 증거가 아니다.

### 6.8 Python Machine과의 연결 경계

Perception Computer가 같은 pyproc 제품 안에 있다는 장점은 Python 계산, browser world, recording을 한
Control journey에서 다룰 수 있다는 것이다. 그러나 v1은 숨은 교차 subsystem commit을 만들지 않는다.

- Python code는 `situationRef`, `worldRef`, `recordingId`, `cursor`, evidence digest를 일반 값으로 자기
  내구 상태에 저장할 수 있다.
- Python checkpoint restore 뒤 과거 ref를 live capability로 되살리지 않는다.
- recording이 있으면 과거 situation과 evidence를 ReplaySpace로 읽을 수 있다.
- recording이 없고 live ledger retention이 끝났으면 `resyncRequired`다.
- browser effect는 Python heap restore로 취소되거나 되감기지 않는다.
- 향후 machine generation과 recording cursor의 atomic link가 필요해도 별도 attempt와 failure model을
  먼저 만든다. 이 이니셔티브 안에서 느슨한 dual write를 추가하지 않는다.

이 경계는 혁신을 줄이는 것이 아니다. 계산 상태의 시간여행과 외부 세계의 irreversible effect를
구별해야 proof-carrying action의 의미가 유지된다.

## 7. 실험 캠페인

본진 변경 전에 `tests/attempts/perceptionComputer/`에서 아래 구조를 완성한다.

```text
tests/attempts/perceptionComputer/
  README.md
  baselineLock.json
  fixtures/
    semanticForm.html
    ambiguity.html
    geometry.html
    temporal.html
    frames.html
    visual.html
    reportedCapability.html
    transition.html
    instructionBoundary.html
    lifecycle.html
  oracle/
    taskOracle.js
    fixtureCatalog.js
  prototype/
    worldModel.js
    situationCompiler.js
    probePlanner.js
    capabilityProjector.js
  baselineProbe.mjs
  capsuleBudgetProbe.html
  activePerceptionProbe.html
  temporalIdentityProbe.html
  capabilityFusionProbe.html
  instructionBoundaryProbe.html
  transitionProofProbe.html
  replayCapsuleProbe.mjs
```

실제 구현 중 fixture가 늘어도 새 attempt 카테고리를 만들지 않는다.

### 7.1 Baseline lock

`baselineLock.json`은 다음을 exact 값으로 기록한다.

- 비교 package 이름, version, package integrity
- source revision 또는 release tag
- browser family, binary version, channel
- OS, viewport, device scale, locale, timezone
- snapshot mode, depth, boxes, screenshot option
- fixture server revision과 각 fixture digest
- 실행 명령과 결과 artifact digest

floating tag와 설치 시점의 최신 browser를 사용하지 않는다. 비교 package는 pyproc runtime dependency나
일반 devDependency로 넣지 않고 isolated temporary fixture에 exact version으로 설치한다.

baseline은 accessibility snapshot만 고른 약한 대조군이 아니다. 비교 version이 제공하는 find, box,
screenshot, action 도구를 동일 task에서 허용한다. 양쪽은 같은 browser state, viewport, fixture seed,
로그인 상태를 사용한다.

### 7.2 Deterministic task oracle

각 fixture는 다음을 기계 판정하는 oracle을 가진다.

```text
required facts
required relations
allowed actions
forbidden actions
expected ambiguity
expected unknowns
expected transitions
forbidden authority widening
allowed visual artifacts
```

특정 hosted model은 졸업 판정자가 아니다. 선택적인 model trial은 별도 artifact로 남기되, core gate는
동일 입력에서 항상 같은 판정을 내리는 task oracle이 소유한다.

### 7.3 필수 fixture family

1. 큰 semantic form과 virtualized list
2. 같은 accessible name을 가진 여러 control
3. overlay, animation, offscreen, sticky region, pointer interception
4. SPA rerender, reorder, same-document mutation, full document replacement
5. open shadow root, same-origin frame, 허용된 cross-origin cooperative frame
6. canvas chart, label 없는 icon, image-only control
7. 일치하거나 충돌하는 reported capability와 visible UI
8. 같은 URL에서 발생하는 관련 및 무관 network response
9. visible text, hidden text, accessibility label, tool description의 instruction-shaped content
10. cancel, provider death, sequence gap, resync, record, replay
11. password, token, URL query, request body가 있는 민감 정보 fixture
12. 동일한 상태를 반복 capture하는 determinism fixture

### 7.4 졸업 수치

모든 fixture state별로 판정한다. 평균으로 실패를 숨기지 않는다.

| 축 | 필수 결과 |
|---|---|
| required fact recall | 모든 oracle-required fact 보존 |
| allowed action reach | baseline이 성공한 모든 허용 action 보존 |
| wrong target | 0 |
| forbidden action emission | 0 |
| false confirmed | 0 |
| unrelated network correlation | 0 |
| `outcomeUnknown` resend | 0 |
| authority widening | 0 |
| raw provider id leak | 0 |
| secret value leak | 0 |
| document replacement stale escape | 0 |
| replay live provider call | 0 |
| semantic fixture visual artifact | 0 |
| visual fixture full-page artifact | 0 |
| canonical nondeterminism | 같은 상태 반복에서 0 |
| minimality | 지정한 각 large state에서 capsule bytes가 full baseline snapshot보다 작음 |
| provider honesty | Native CDP와 FrameSpace가 같은 core type, 서로 다른 실제 conformance를 보고 |

비교 우위는 다음 좁은 문장으로만 판정한다.

> 동일 fixture와 허용 도구에서 baseline의 성공 가능한 action reach를 잃지 않으면서, 더 작은 목표별
> 상태 안에 baseline이 하나의 계약으로 표현하지 않는 unknown, conflict, authority, temporal transition,
> effect proof, replay를 모두 제공한다.

브라우저 자동화 전체, 속도 전체, 모든 site, 모든 모델에서 일반적으로 우월하다고 확대하지 않는다.

## 8. 실행 단계

각 단계는 이전 단계가 green일 때만 시작한다. probe 단계가 끝나기 전에 `scripts/perception/`이나 공개
schema를 바꾸지 않는다.

### 단계 0. 기준 상태 동결

작업:

- 동시 변경을 모두 읽고 current APX, clients, docs, tests inventory를 갱신한다.
- baseline exact lock과 fixture digest 생성 경로를 만든다.
- 비교 runner가 option 또는 browser mismatch를 RED로 만드는 음성 시험을 추가한다.
- attempt README의 예정 probe와 실제 파일 이름을 일치시킨다.

종료 조건:

- 기존 `npm test` green
- baseline을 같은 fixture에서 두 번 실행해 같은 lock과 canonical result 생성
- floating version 문자열 0
- baseline mismatch 음성 fixture RED 확인

### 단계 1. Fixture와 oracle 완성

작업:

- 12개 fixture family를 하나의 deterministic server와 seed 체계에 넣는다.
- task oracle에 required, allowed, forbidden, transition을 선언한다.
- baseline과 prototype이 같은 fixture lifecycle API를 사용하게 한다.
- fixture 자신이 정답을 누설하는 data attribute를 public observation에서 제외한다.

종료 조건:

- oracle self-test green
- 일부 required fact, forbidden action, expected transition을 고의 변조하면 각각 RED
- Chrome과 Edge에서 같은 logical state digest

### 단계 2. WorldModel prototype

작업:

- 기존 sensor fact를 four-plane world로 ingest한다.
- attestation, conflict, freshness, document epoch, atomic rollback을 구현한다.
- event sequence gap과 full reconciliation을 구현한다.
- provider native id가 prototype output으로 새지 않게 한다.

종료 조건:

- rerender와 reorder identity 유지
- document replacement 뒤 old claim과 capability 모두 stale
- conflict를 known으로 축약한 음성 fixture RED
- 중간 capture 실패 뒤 world, identity, artifact 잔여 0
- 같은 session concurrent ingest가 FIFO

### 단계 3. SituationCompiler prototype

작업:

- typed requirement validator를 만든다.
- seed, relation closure, sufficiency, deterministic order, budget pruning을 구현한다.
- `known`, `conflicted`, `unknown`, `stale` requirement terminal을 만든다.
- capsule canonical digest와 source world digest를 연결한다.

종료 조건:

- required fact recall 전부 통과
- duplicate target을 `one`으로 추측하지 않음
- large semantic fixture 각 상태에서 baseline보다 작은 capsule
- semantic fixture visual artifact 0
- 필수 fact를 budget으로 자르면 성공이 아니라 명시 오류
- 동일 상태 및 focus 반복에서 digest 동일

### 단계 4. Active perception prototype

작업:

- unknown reason과 probe candidate를 연결한다.
- read-only 자동 probe와 mutate probe를 분리한다.
- entity crop lifecycle과 artifact cleanup을 구현한다.
- optional inference adapter의 digest 및 provenance 경계를 구현한다.

종료 조건:

- canvas와 image-only target에서 entity crop만 생성
- overview를 요구하지 않은 full screenshot 0
- crop 실패 및 budget omission에서 artifact 회수
- inference가 권한을 넓히려는 음성 fixture RED
- adapter가 없을 때 unknown이 유지됨

### 단계 5. Capability fusion prototype

작업:

- observed, derived, reported, authorized affordance를 분리한다.
- reported capability의 origin, lifecycle, schema, page trust를 보존한다.
- broker가 manifest action, risk, destination, session, epoch를 모두 확인한 뒤 capability를 발급한다.
- 당시 browser의 WebMCP 구현을 feature-detect하고 exact revision을 기록한다.

종료 조건:

- visible UI와 reported capability가 일치하면 둘을 연결하되 provenance 유지
- 충돌하면 `conflicted`이고 자동 실행 0
- hidden instruction, description, visual inference의 authority widening 0
- capability expiry와 document replacement 뒤 provider call 0
- native WebMCP를 확인하지 못한 환경은 honest unsupported

### 단계 6. Transition proof prototype

작업:

- actionContext를 before world와 capability에 묶는다.
- direct, strong, weak, unknown causality를 구현한다.
- 기존 ActionEvidence verdict를 그대로 보존한다.
- network request와 response를 explicit request ref로 상관한다.

종료 조건:

- 관련 DOM 및 network 전이는 confirmed
- 같은 URL의 무관 response는 confirmed 0
- weak evidence만으로 confirmed 0
- post-send provider death는 `outcomeUnknown`, retryable false, effect call 1회
- stale actionContext는 effect 전 `notSent`

### 단계 7. Record와 replay prototype

작업:

- situation terminal, transition proof, visual attachment가 기존 canonical recording에 들어가는지 확인한다.
- replay는 기록된 terminal을 반환하고 WorldModel이나 postcondition을 다시 계산하지 않는다.
- resume cursor, prefix digest, artifact sidecar 무결성을 situation에도 적용한다.

종료 조건:

- replay live provider call 0
- capsule, evidence, attachment byte와 digest 일치
- input mutation, missing artifact, bad prefix, bad digest 모두 fail closed
- replay effect 재전송 0

### 단계 8. 종합 반증과 wire freeze

작업:

- 모든 prototype probe를 한 runner에서 실행한다.
- baseline 대비 task reach와 최소성 표를 만든다.
- attempt README 결론 표에 날짜, 환경, exact version, 핵심 결과, 다음 결정을 기록한다.
- 실패가 하나라도 있으면 본진 승격 대신 prototype을 단순화하거나 폐기한다.

종료 조건:

- 7.4의 모든 졸업 수치 통과
- `apx.situation` schema 결정 확정
- module responsibility와 public surface 확정
- attempt README 판정이 `졸업 -> scripts/perception`으로 바뀔 근거 확보

### 단계 9. 본진 승격

작업:

- prototype을 6.2의 책임 경계로 다시 작성해 `scripts/perception/`에 배치한다.
- 실험용 shortcut, fixture branch, feature flag를 가져오지 않는다.
- `PerceptionSpace`가 representation에 따라 graph 또는 situation projection을 선택하게 한다.
- Native CDP와 FrameSpace를 같은 WorldModel contract에 연결한다.
- strict validator, JSON Schema, canonical digest를 같은 커밋에서 낸다.

종료 조건:

- `apx.graph` 기존 fixture byte 의미와 tests green
- situation contract suite green
- public schema와 runtime validator의 양성 및 음성 parity
- raw provider id와 unknown key fail closed
- package tarball에 schema와 새 모듈 포함

### 단계 10. Action과 provider 통합

작업:

- broker capability 발급과 `automation.act`의 actionContext 검증을 연결한다.
- event feed와 snapshot reconciliation을 각 provider에 연결한다.
- close, detach, navigation, provider death 때 world, subscription, locator, artifact를 정리한다.
- inspect가 provider별 subscription, situation, visual, inference, reported capability 수준을 정직하게
  보고하게 한다.

종료 조건:

- Native CDP real-browser journey green
- FrameSpace real-browser journey green
- FrameSpace가 compositor, signed-in profile, native WebMCP를 과장하지 않음
- cancel과 shutdown 뒤 process, listener, artifact 잔여 0

### 단계 11. Client 표면

작업:

- `pyproc/control`에 `situate`, `actAffordance`, immutable situation views와 types를 추가한다.
- Python SDK에 같은 wire 의미와 camelCase facade를 추가한다.
- MCP `browserObserve` schema와 description에 situation input을 추가한다.
- raw Control Protocol strict input validation을 갱신한다.

종료 조건:

- JavaScript, Python, MCP가 같은 manifest와 focus로 같은 canonical situation을 받음
- 세 client의 action terminal, attachment digest, error code 일치
- deep import 0
- TypeScript negative fixture가 잘못된 focus와 actionContext를 RED로 만듦
- Python distribution 두 형식의 clean install journey green

### 단계 12. 정식 게이트와 CI

추가하거나 확장할 정식 증거는 다음과 같다.

| 책임 | 정식 위치 |
|---|---|
| pure world, belief, projection contract | `tests/contracts/perceptionComputer.mjs` |
| schema와 validator parity | `tests/contracts/perceptionSpace.mjs` 또는 전용 suite |
| Native CDP 제품 journey | `tests/browser/perceptionComputerProduct.mjs` |
| FrameSpace 정직성 | `tests/browser/frameSpaceProduct.mjs` |
| replay 무효과 재현 | `tests/browser/replaySpaceProduct.mjs` |
| MCP surface | `tests/browser/installedMcpProduct.mjs` |
| JavaScript Control surface | `tests/browser/controlProtocolProduct.mjs` |
| Python facade | `tests/pythonSdk/` |
| package file 포함 | `tests/packageGate.mjs` |
| 공개 type | `tests/typeSurface.ts` |
| 구조, 문서, 링크 | `tests/run.mjs` |

필요한 package script 기본안은 `test:perception-computer`다. Chrome Ubuntu와 Edge Windows CI에서 같은
installed product journey를 실행한다. 외부 비교 runner는 runtime dependency로 만들지 않고
`bench:perception` 같은 명시적 검증 도구로 격리한다. 정식 제품 gate는 경쟁 package의 network
가용성 없이 pyproc 자체 불변식을 검증한다.

신설 gate는 반드시 다음 음성 시험으로 이빨을 증명한다.

- required fact 삭제
- conflict를 known으로 변조
- old epoch capability 재사용
- page-reported risk를 broker risk로 승격
- raw driver id 삽입
- secret value 삽입
- unrelated response ref 삽입
- canonical field 순서 또는 digest 변조
- budget omitted 누락
- replay 중 provider call 삽입
- FrameSpace에 compositor capability 허위 선언
- `outcomeUnknown` 자동 retry 삽입

각 음성 fixture가 실제 RED가 된 것을 확인하고 원상 복구한 뒤에만 gate라고 기록한다.

### 단계 13. 문서와 README 정합

문서는 구현 마지막에 한꺼번에 꾸미지 않는다. 각 계약 승격 커밋에서 해당 정본을 갱신하고, 이
단계에서 전체 서술과 링크를 다시 대조한다.

| 문서 | 반드시 반영할 내용 | 정합 증거 |
|---|---|---|
| `docs/specs/apx/README.md` | graph 1.0과 situation 1.0 관계, profiles, invariants, examples | schema examples를 runtime validator로 검사 |
| `docs/specs/apx/examples/` | full situation, conflicted situation, proof action 예제 | canonical digest 재계산 및 contract suite |
| `docs/usage/browserAutomation.md` | raw Control journey, focus, capsule, actionContext, visual 경계 | Native installed journey와 동일 payload |
| `docs/usage/controlProtocol.md` | operation 불변, 새 representation input과 terminal | operation catalog와 문서 대조 gate |
| `docs/usage/automationSpace.md` | WorldModel ownership, subscription, provider conformance | fake provider와 real provider inspect 대조 |
| `docs/usage/frameSpace.md` | 탭 내부 feed, credentialless 한계, unsupported 능력 | FrameSpace negative fixtures |
| `docs/usage/replaySpace.md` | capsule 및 proof terminal replay, live continuation 비보장 | provider call count 0 |
| `docs/usage/javascriptControl.md` | `situate`와 `actAffordance` golden journey | packed `pyproc/control` 실행 |
| `docs/usage/pythonSdk.md` | 같은 golden journey와 error 의미 | clean wheel 및 sdist 실행 |
| `pythonSdk/README.md` | 설치 후 최소 Python 예제 | README payload를 product fixture가 재사용 |
| `docs/usage/trustPermissions.md` | objective, page content, reported tool, inference가 권한이 아님 | authority injection 음성 시험 |
| `docs/usage/capabilityMatrix.md` | shipped level과 provider별 실제 지원 | CI command와 matrix 행 대조 |
| `docs/reference/api.md` | 안정 JavaScript surface와 type 의미 | public surface 및 type gate |
| `docs/operations/contractReality.md` | 열린 debt 종료 또는 남은 실제 한계 | 실행 가능한 evidence 링크 |
| `docs/operations/agentExperienceInitiatives.md` | initiative 결과와 좁은 비교 판정 | attempt 졸업 결과 링크 |
| `docs/product/vision.md` | 현재형 능력만 반영, 입증 전 주장 제거 | North Star evidence 규칙 유지 |
| `docs/README.md` | 새 spec 및 usage routing | 상대 링크 gate |
| `README.md` | 영문 product story, 최소 예제, support boundary | 목차 및 공개 표면 gate |
| `README.ko.md` | 영문 README와 같은 범위의 한국어 설명 | 제목 집합 및 표면 parity |
| `CHANGELOG.md` | 실제 출하된 wire와 client 변화 | release 시 package version과 함께 |
| `SECURITY.md` | page instruction, reported capability, visual inference trust boundary | security negative fixture 링크 |

README의 핵심 문장은 다음 의미를 가져야 한다.

```text
PyProc Eyes does not hand the consumer a page dump. It returns the smallest evidence-linked situation that
answers a typed focus, states what remains unknown, and binds every executable affordance to broker authority.
```

이 문장은 졸업 수치를 통과한 뒤에만 현재형으로 쓴다. 일반적인 Playwright 우월성, 세계 최초,
검증되지 않은 시각 추론 정확도, 공개 성능 숫자는 README에 넣지 않는다.

README와 usage 예제는 복사된 장식 코드가 아니라 정식 installed fixture가 import하거나 동일 payload
fixture를 공유하게 한다. JavaScript, Python, MCP 문서에서 다음 이름이 달라지지 않게 한다.

```text
situate
requirementRef
SituationCapsule
SituationAffordance
actAffordance
actionContext
known | conflicted | unknown | stale
confirmed | contradicted | ambiguous | notObserved | outcomeUnknown
```

### 단계 14. 최종 제품 검증

다음 순서로 실행하고 모두 green이어야 한다.

```text
npm test
npm run test:types
npm run test:contracts
npm run test:package
npm run test:perception-computer
npm run test:apx
npm run test:browser-control
npm run test:mcp-product
npm run test:control-product
npm run test:frame-space
npm run test:replay-space
npm run test:python-sdk
npm run test:installed
```

중복 실행은 실제 package script 구성을 보고 줄일 수 있지만, 어느 책임도 실행되지 않은 채 사라지면
안 된다. Windows에서는 Chrome과 Edge matrix, CI에서는 기존 지원 OS matrix를 확인한다.

최종 수동 감사도 수행한다.

- `git diff --check`
- em dash 0
- 금지 trace term 0
- 문서 상대 링크 생존
- package tarball에 schema, docs에 약속한 파일, d.ts 포함
- `apx.graph` golden fixture 변화 0 또는 의도된 변화의 명시적 major 결정
- public example deep import 0
- 현재형 문장마다 실행 evidence 존재
- 임시 browser profile, process, artifact, recording file 잔여 0

### 단계 15. 원장 종료와 계획 삭제

모든 구현과 문서가 끝난 같은 사이클에 다음을 수행한다.

1. attempt README의 모든 probe 결과와 최종 판정을 기록한다.
2. 지속되는 설계만 APX spec, usage, operations 문서에 남겼는지 확인한다.
3. `docs/operations/contractReality.md`의 perception debt를 종료하거나 실제 남은 경계로 좁힌다.
4. `tests/attempts/README.md`에서 perceptionComputer 진행 행을 제거한다.
5. `tests/attempts/perceptionComputer/`를 폴더째 삭제한다. probe 과정은 Git 이력이 보존한다.
6. 이 `mainPlan/1-perceptionComputer/` 폴더를 삭제한다.
7. `mainPlan/README.md`의 활성 이니셔티브를 없음으로 되돌린다.
8. 삭제 뒤 `npm test`를 다시 실행해 죽은 링크와 정본 중복이 없는지 확인한다.

완료 계획이나 회고 폴더를 남기지 않는다.

## 9. 커밋 경계

구현 시 다음 논리 단위로 커밋한다. 하나가 RED인 상태에서 다음 단위로 넘어가지 않는다.

1. baseline lock, fixtures, deterministic oracle
2. WorldModel prototype과 음성 시험
3. SituationCompiler prototype과 budget gate
4. active perception과 artifact cleanup
5. capability fusion과 authority 음성 시험
6. transition proof와 false correlation 음성 시험
7. record/replay prototype과 no-provider-call gate
8. 종합 비교 결과와 wire freeze
9. situation schema, catalog, WorldModel 본진 승격
10. Native CDP 및 FrameSpace provider 통합
11. actionContext와 broker capability 통합
12. JavaScript, Python, MCP facade 및 types
13. installed product와 CI gate
14. spec, usage, README, security, contract reality 정합
15. attempts와 mainPlan 삭제 및 최종 green

각 커밋 메시지는 무엇을 바꿨는지, 왜 그 경계가 필요한지, 어느 양성 및 음성 gate가 green인지
기록한다. main 전용 규칙을 유지하고 작업용 branch를 만들지 않는다.

## 10. 위험과 방지책

| 위험 | 방지책 |
|---|---|
| WorldModel이 full DOM 사본으로 비대해짐 | raw DOM 저장 금지, typed claim과 필요한 relation만 canonical state에 유지 |
| 최소화가 사실 누락으로 변함 | requirement sufficiency를 budget보다 우선하고 부족하면 명시 오류 |
| 자연어 objective가 policy가 됨 | objective는 opaque context, typed requirement와 broker manifest만 실행 결정 |
| page instruction이 tool description으로 우회 | reported provenance 고정, authority projector와 분리 |
| event feed 누락이 잘못된 fresh 상태를 만듦 | sequence gap, completeness, snapshot reconciliation |
| navigation 뒤 닮은 element를 같은 것으로 간주 | epoch 교체, old capability 전부 stale, cross-epoch identity 추론 금지 |
| 같은 시간의 network event를 원인으로 오판 | request ref와 explicit postcondition 없으면 weak 또는 unknown |
| visual inference가 클릭 권한을 만듦 | inference output에는 authority field 금지, broker capability 별도 발급 |
| FrameSpace가 Native CDP를 흉내 냄 | provider별 conformance와 unsupported field를 schema 및 gate로 고정 |
| graph 1.0 소비자 회귀 | 새 representation opt-in, 기존 golden fixture와 replay digest 유지 |
| 경쟁 비교가 업데이트마다 표류 | exact baseline lock, 비교 runner 격리, 공개 일반 우월 주장 금지 |
| 특정 model에 과적합 | deterministic oracle이 필수, model trial은 보조 |
| artifact와 world state 누수 | atomic rollback, detach 및 close cleanup, bounded retention |
| 문서가 구현보다 앞섬 | 현재형 문장은 installed evidence 뒤에만 반영 |

## 11. 중단 또는 축소 조건

다음 중 하나라도 남으면 본진으로 승격하지 않는다.

1. baseline이 성공한 허용 action을 capsule 경로가 잃는다.
2. false `confirmed`, wrong target, authority widening, effect resend가 한 번이라도 발생한다.
3. 필수 fact 누락을 `satisfied`로 보고한다.
4. document replacement 뒤 old capability가 provider에 도달한다.
5. replay가 live provider 또는 effect를 호출한다.
6. provider 차이를 숨기기 위해 동일하지 않은 능력을 동일하다고 문서화해야 한다.
7. `apx.graph` 호환을 깨지 않고 새 representation을 만들 수 없다.
8. 같은 fixture state와 focus가 canonical digest를 안정적으로 만들지 못한다.
9. full screenshot을 기본 경로로 되돌려야만 task reach를 유지한다.

축소할 때도 world, belief, authority, transition 중 일부만 이름으로 남겨 완성된 것처럼 출하하지 않는다.
실패 결과를 attempt README에 기록하고 제품 계약은 현재 APX 1.0 수준에 유지한다.

WebMCP native discovery가 당시 browser에 없다는 사실만으로 core initiative를 중단하지는 않는다.
reported capability plane을 provider-neutral하게 완성하고 `webMcp: unsupported`를 정직하게 반환한다.
native 지원 주장은 실제 구현과 browser gate가 생긴 뒤에만 추가한다.

## 12. 완료 정의

아래 체크리스트가 전부 참일 때만 이니셔티브가 끝난다.

- [ ] exact Playwright baseline과 동일 fixture 비교가 재현된다.
- [ ] 모든 deterministic oracle과 졸업 수치가 green이다.
- [ ] `apx.graph` 1.0 호환이 유지된다.
- [ ] `apx.situation` schema, validator, canonical digest가 일치한다.
- [ ] WorldModel 네 plane과 atomic rollback이 정식 코드에 있다.
- [ ] SituationCapsule이 required fact를 보존하며 full dump보다 작다.
- [ ] unknown, conflict, stale, provider gap을 명시한다.
- [ ] semantic task는 visual artifact 0이다.
- [ ] visual task는 bounded crop만 사용한다.
- [ ] reported 및 inferred 정보가 authority를 넓히지 못한다.
- [ ] proof-carrying action이 stale world와 capability를 effect 전에 거부한다.
- [ ] false correlation과 `outcomeUnknown` retry가 0이다.
- [ ] Native CDP와 FrameSpace가 같은 core type과 정직한 conformance를 반환한다.
- [ ] record/replay가 capsule, proof, artifact를 live call 없이 재현한다.
- [ ] JavaScript, Python, MCP가 같은 golden journey와 terminal 의미를 쓴다.
- [ ] types, package, installed, Chrome, Edge, replay, cleanup gate가 모두 green이다.
- [ ] APX spec, usage 문서, reference, security, capability matrix가 구현과 일치한다.
- [ ] `README.md`와 `README.ko.md`가 같은 범위와 실행 가능한 예제를 가진다.
- [ ] 현재형 제품 주장마다 실행 evidence가 있다.
- [ ] contract reality의 열린 debt가 실제 상태로 갱신됐다.
- [ ] attempts와 mainPlan 임시 폴더가 완료 사이클에 삭제됐다.
- [ ] 삭제 뒤 `npm test`가 green이다.

이 체크리스트 중 “나중에”로 남은 항목이 있으면 완료가 아니다.
