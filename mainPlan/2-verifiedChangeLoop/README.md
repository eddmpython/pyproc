# Initiative 2: Verified Change Loop 실행 계획

상태: **구현 중**

이 문서는 브라우저를 관찰하고 조작하는 능력을 저장소 변경의 완료 여부를 판정하는 검증 런타임으로
확장하는 세 번째 이니셔티브의 임시 실행 계획이다. 실행 순서는 Machine Entrance, Perception Computer,
Verified Change Loop로 고정한다. Machine Entrance와 Perception Computer는 졸업했고, 이 계획이 현재
직렬 대기열의 유일한 활성 구현이다.

지속 제품 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-2---verified-change-loop),
현재 관찰 계약은 [APX 1.0](../../docs/specs/apx/README.md), 선행 정식 증거는
[`perceptionComputer` contract](../../tests/contracts/perceptionComputer.mjs), 이 이니셔티브의 실험 원장은
[Initiative 2 attempt](../../tests/attempts/verifiedChangeLoop/README.md)가 소유한다. 이 문서는 구현
순서, 책임 경계, 검증 방법, 문서 정합, 종료 절차만 소유한다.

## 1. 최종 결과

완료된 제품은 screenshot을 모아 보고서를 만드는 도구가 아니다. 저장소가 선언한 사용자 경험을 실제
브라우저에서 재현하고, 각 상태와 행동의 사실 여부를 판정하고, 같은 판정을 다시 확인할 수 있는
**Agent Verification Runtime**이다.

제품 명제는 다음 한 문장으로 고정한다.

> 변경 완료는 코드 수정이나 클릭 전송으로 성립하지 않는다. 선언된 경험 계약을 정확한 환경에서 다시
> 만족했고 그 판정을 재생 가능한 증거로 보존했을 때만 성립한다.

검증 루프는 다음과 같다.

```text
declare -> preflight -> become ready -> observe -> act once -> verify state
        -> compare -> classify -> seal evidence -> replay verdict
```

사용자가 얻는 결과는 다음과 같다.

1. 저장소마다 무엇을 봐야 하는지, 어떤 상태를 거쳐야 하는지, 무엇이 성공인지 명시한다.
2. 실제 browser와 격리 profile에서 desktop, tablet, mobile 상태를 같은 조건으로 재현한다.
3. 클릭 성공과 업무 성공을 구분하고, DOM, layout, lifecycle, console, network 증거를 함께 판정한다.
4. screenshot 전체를 기본 입력으로 쓰지 않고 `SituationCapsule`과 필요한 영역의 visual evidence를 쓴다.
5. 구조 결함, 행동 결함, 회귀, 불확실한 시각 판단을 서로 다른 finding 종류로 보존한다.
6. 변경 전후 상태, repository identity, scenario, browser 환경, artifact digest를 하나의 Evidence Pack에 묶는다.
7. 검증을 완료할 수 없는 경우 성공으로 축약하지 않고 `incomplete`로 끝낸다.
8. 호출자는 Evidence Pack을 읽어 수정하고 같은 scenario를 다시 실행한다. pyproc은 source를 수정하지 않는다.

이 이니셔티브가 해결하는 질문은 “브라우저에서 무엇이 참인가?”가 아니다. 그 질문은 Perception
Computer가 해결한다. 여기서는 “이 변경이 선언된 사용자 경험 계약을 만족했다고 받아들여도 되는가?”를
해결한다.

## 2. 착수 잠금

구현 세션은 다음 조건을 순서대로 확인한다.

1. `CLAUDE.md`, `index.js`, `src/`, `README.md`를 다시 읽는다.
2. `git status --short`로 진행 중인 변경을 확인하고 다른 작업의 파일을 되돌리지 않는다.
3. Machine Entrance의 installed golden journey와 Perception Computer의 모든 졸업 gate가 green인지 확인한다.
4. Perception Computer가 끝나지 않았거나 `SituationCapsule`, proof-carrying action, replay 계약이 아직
   실험 상태면 이 이니셔티브를 시작하지 않는다.
5. `docs/operations/contractReality.md`, 이 계획, attempt README, 당시 APX 정본의 차이를 대조한다.
6. `npm test`와 선행 제품 browser gate를 시작 기준선으로 실행한다.
7. `tests/attempts/verifiedChangeLoop/` 안에서만 첫 코드를 작성한다.
8. 첫 probe 전에 대상 browser, viewport, locale, timezone, color scheme, motion 설정, font 조건, fixture
   digest, repository tree와 diff identity를 exact 값으로 잠근다.

착수 시 현재 코드가 이 계획의 파일 후보와 다르면 코드가 정본이다. 먼저 영향 파일 표를 실제 책임과
이름으로 고친 뒤 진행한다. 이름 차이를 이유로 authority, truth, replay gate를 약화하지 않는다.

## 3. 제품 경계

### 3.1 소유하는 책임

- repository-scoped Experience Contract를 strict schema로 읽고 검증한다.
- target URL이 준비됐는지 관찰하고, 준비 전 상태를 최종 화면으로 오판하지 않는다.
- 고정된 scenario를 현재 browser session에서 실행한다.
- 각 checkpoint에서 목표 조건부 상황, 필요한 visual artifact, diagnostics를 수집한다.
- deterministic oracle과 명시적 comparison policy로 finding을 만든다.
- before와 after의 차이, 새 회귀, 해소된 문제, 남은 불확실성을 분리한다.
- Evidence Pack을 canonical 형식과 content digest로 봉인한다.
- live effect 없이 pack의 판정과 증거 참조를 다시 확인한다.
- JavaScript, Python, MCP, CLI 소비자가 같은 verdict 의미를 받게 한다.

### 3.2 소유하지 않는 책임

- source code를 수정하거나 patch를 생성하지 않는다.
- 문제를 발견한 뒤 자동으로 framework, CSS system, component library를 바꾸지 않는다.
- 저장소 문서에서 임의 shell command를 읽어 실행하지 않는다.
- 사용자의 기본 browser profile, cookie, credential을 묵시적으로 사용하지 않는다.
- 시각적 취향을 제품 결함으로 확정하지 않는다.
- 외부 effect를 검증 편의를 위해 자동 승인하지 않는다.
- 특정 hosted model, prompt, 계정의 응답을 terminal truth로 쓰지 않는다.
- 전체 test framework, cross-browser matrix, code generator를 대체한다고 주장하지 않는다.
- Evidence Pack hash를 서명이나 작성자 신원 증명으로 표현하지 않는다.

### 3.3 `audit`, `verify`, `repair`의 분리

```text
audit   = 현재 경험 계약을 실행하고 독립 Evidence Pack을 만든다
verify  = exact reference pack과 현재 pack을 비교해 변경을 판정한다
repair  = finding을 읽고 source를 고치는 호출자 책임이다
```

공개 제품은 `audit`와 `verify`만 소유한다. `repair`를 넣으면 browser truth runtime이 source editor와
모델별 orchestration framework로 팽창한다. 수정 주체가 누구든 동일한 pack을 소비하고 다시 검증할 수
있도록 경계를 유지한다.

## 4. Repository Experience Contract

### 4.1 폴더 계약

저장소가 선택적으로 제공하는 기본 구조는 다음과 같다.

```text
qa/eyes/
|-- EYES.md
|-- experience.json
|-- scenarios.json
|-- baselines.json
`-- references/
```

파일이 없으면 자동 추측으로 신뢰 가능한 검증을 꾸미지 않는다. 명시적 ad hoc 입력으로 audit를 실행할
수는 있지만, repository verification과 baseline comparison은 strict contract가 없으면 `incomplete`다.

### 4.2 `EYES.md`

`EYES.md`는 사람과 호출자가 제품 의도를 빠르게 이해하는 문서다. 다음 내용을 권장한다.

- product intent와 보존해야 할 정체성
- 주요 surface와 상태
- 사람이 이해할 수 있는 readiness 설명
- design principle과 금지된 재설계
- 알려진 환경 제약
- 수동 검토가 필요한 visual claim

이 파일은 실행 authority가 아니다. 다음 규칙을 강제한다.

1. fenced code, `Start` 절, 자연어 instruction을 shell command로 실행하지 않는다.
2. 이 파일의 selector, URL, permission, expected outcome을 기계 계약으로 승격하지 않는다.
3. 파일 digest는 Evidence Pack에 기록하지만 판정에 사용한 값은 strict JSON에서만 읽는다.
4. page content와 마찬가지로 instruction-shaped text는 untrusted data다.

### 4.3 `experience.json`

이 파일은 검증 실행의 machine-readable manifest다. 최종 schema는 attempt에서 확정하되 최소 필드는
다음 책임을 가진다.

```json
{
  "schemaVersion": "1",
  "project": { "id": "example-product" },
  "target": {
    "baseUrl": "http://127.0.0.1:8000",
    "allowedOrigins": ["http://127.0.0.1:8000"]
  },
  "readiness": {
    "scenarioRef": "readiness",
    "timeoutMs": 30000
  },
  "environments": ["desktop", "tablet", "mobile"],
  "scenarioCatalog": "./scenarios.json",
  "baselineCatalog": "./baselines.json",
  "policy": {
    "console": "rejectUnexpectedError",
    "network": "rejectUnexpectedFailure",
    "visual": "boundedEvidence",
    "externalEffects": "deny"
  }
}
```

실제 schema에는 unknown field 거부, 상대 경로 root confinement, exact version, 크기와 시간 budget,
redaction policy, artifact quota가 들어간다. broad origin, floating baseline, 음수 timeout, path escape,
unknown action, 암묵적 external effect는 browser launch 전에 거부한다.

`baseUrl`은 이미 실행 중인 target을 가리킨다. 개발 서버 시작은 호출자 또는 operator가 소유한다.
repository 문서의 start command를 pyproc이 대신 실행하지 않는다. 후속 process supervision이 필요하면
명시적 CLI argv와 별도 authority 계약을 새로운 attempt에서 검증하고 이 이니셔티브의 필수 범위에는
넣지 않는다.

### 4.4 `scenarios.json`

scenario는 selector macro가 아니라 경험 상태기계다.

```text
fixture -> readiness -> steps -> checkpoints -> oracles -> cleanup
```

각 scenario는 다음을 명시한다.

- stable `scenarioId`와 목적
- 시작 route와 허용 origin
- 필요한 fixture identity와 seed digest
- precondition과 readiness oracle
- 구조화된 action step, risk, expected transition
- checkpoint마다 필요한 facts, unknown 허용 여부, visual question
- console 및 network expectation
- cleanup과 session isolation
- required 또는 advisory 분류

script 문자열과 arbitrary evaluation은 scenario action으로 허용하지 않는다. 행동은 현재
`automation.act` catalog의 typed action만 사용하고 locator는 실행 시점의 SituationCapsule에서 얻는다.
기록된 CSS selector나 과거 `locatorRef`를 authority로 재사용하지 않는다.

### 4.5 `baselines.json`

baseline은 screenshot 파일명 모음이 아니다. 비교 가능한 환경과 reference pack을 exact 값으로 고정한다.

```json
{
  "schemaVersion": "1",
  "references": [{
    "baselineId": "main-ready-desktop",
    "scenarioId": "ready",
    "environmentId": "desktop",
    "evidencePackSha256": "sha256:...",
    "browser": { "family": "chromium", "version": "..." },
    "fixtureSha256": "sha256:..."
  }]
}
```

floating branch name이나 latest artifact만으로는 비교하지 않는다. `--against main` 같은 편의 입력은
호출자가 exact commit, tree, diff, pack digest로 해소한 뒤 core에 전달한다. baseline 환경이 현재 실행과
다르면 `incomplete`이며, 억지로 pixel 또는 geometry 차이를 회귀로 만들지 않는다.

`references/`는 브랜드 screenshot, layout sketch, 승인된 state sample 같은 사람이 제공한 자료를 둔다.
자료의 digest와 사용 목적을 baseline catalog에 명시하며, reference image가 곧 action authority나 업무
성공 oracle이 되지는 않는다.

## 5. 검증 의미론

### 5.1 세 종류의 판정

| 종류 | 입력 | 가능한 자동 판정 |
|---|---|---|
| structural | semantic role, accessible name, state, geometry, occlusion, focus, overflow | pass, fail, incomplete |
| behavioral | precondition, action evidence, DOM와 network postcondition, lifecycle, restore | pass, fail, incomplete |
| perceptual | bounded pixels, brand reference, hierarchy와 balance에 대한 inference | advisory, needsReview, incomplete |

명시적 deterministic comparator가 없는 perceptual finding은 required scenario를 자동 통과시키거나
실패시키지 않는다. inference 결과는 `inferred` provenance, input artifact digest, adapter identity를
보존한다. 단순 취향은 finding이 아니며, 제품 원칙 또는 reference와 연결되지 않은 의견은 보고서에서
제외한다.

### 5.2 상태 truth

검증의 핵심은 보이는 말과 실제 상태가 일치하는지다. 예를 들어 Save scenario는 다음을 별도로 본다.

```text
button actionability before send
-> one-shot effect outcome
-> visible completion state
-> durable application state
-> relevant network result
-> contradictions and unknowns
```

버튼 클릭 command가 성공해도 완료 문구, 저장 상태, relevant response가 기대를 만족하지 않으면
`verified`가 아니다. 반대로 network 요청만 성공하고 사용자에게 오류가 보이면 성공으로 축약하지 않는다.

### 5.3 readiness와 안정화

page open 직후 캡처를 최종 상태로 판정하지 않는다. readiness는 scenario로 표현하고 다음 중 필요한
조건을 묶는다.

- semantic state 또는 status text
- loading indicator 소멸
- document epoch 안정
- 지정한 lifecycle event
- 관련 request 완료
- bounded quiet window
- application-specific durable state

고정 sleep만으로 readiness를 선언하지 않는다. timeout은 `fail`이 아니라 `incomplete`다. 준비되지 않은
화면에서 발견된 layout 문제는 별도 loading-state scenario가 아닌 한 제품 결함으로 확정하지 않는다.

### 5.4 viewport와 rendered state

viewport preset은 width와 height만이 아니라 다음 조건을 포함한다.

- device scale factor
- mobile과 touch mode
- locale와 timezone
- color scheme와 contrast preference
- reduced motion
- font inventory 또는 font readiness
- browser family와 exact version

구조 검사는 overflow, clipping, occlusion, hit target, focus visibility, selected semantics, dialog bounds,
sticky overlap을 typed finding으로 만든다. full screenshot은 page overview가 oracle에 필요한 경우에만
수집한다. 기본값은 SituationCapsule, geometry, paint와 hit-test fact, 문제 entity의 bounded crop이다.

### 5.5 console과 network

console과 network는 보조 로그가 아니라 scenario evidence다. 다만 secret과 무관 request를 그대로
수집하지 않는다.

- console error는 allowlist와 source 범위를 적용한다.
- request와 response는 origin, method, status, timing, redacted header, body digest만 기본 보존한다.
- cookie, authorization, token-shaped query, form secret, response body는 기본 제외한다.
- action evidence는 correlation이 입증된 exchange만 business postcondition에 연결한다.
- 광고, analytics, browser extension noise는 contract에 명시된 경우에만 분리한다.
- unexpected failure와 수집 불능을 서로 다른 상태로 둔다.

### 5.6 issue identity와 수명

finding의 stable identity는 다음 정규화 값에서 계산한다.

```text
project + scenario + checkpoint + rule + logical entity lineage + environment class
```

좌표, DOM node id, 생성 시각, 자연어 메시지는 identity에 넣지 않는다. 같은 문제가 rerender 뒤 다른
좌표에서 나타나도 같은 lineage로 이어지고, document replacement로 의미가 바뀌면 새 issue가 된다.

comparison 결과는 다음으로 분리한다.

- `introduced`: reference에 없고 current에 있음
- `persisting`: 양쪽에 있음
- `resolved`: reference에는 있고 current에는 없음
- `changed`: 같은 identity지만 evidence 또는 severity가 달라짐
- `uncomparable`: 환경, fixture, completeness가 달라 안전하게 비교할 수 없음

### 5.7 severity와 terminal verdict

severity vocabulary는 `blocker`, `major`, `minor`, `advisory`로 고정하고 repository policy가 어떤
severity를 reject할지 정한다. 행동 oracle 반증, authority 위반, wrong-target action, 필수 artifact
누락은 severity 설정과 무관하게 required scenario를 통과할 수 없다.

실행 terminal은 세 개뿐이다.

| terminal | 의미 |
|---|---|
| `verified` | 모든 required scenario가 비교 가능한 환경에서 실행됐고 reject policy 위반과 증거 누락이 없다 |
| `rejected` | 필요한 관찰은 완결됐고 하나 이상의 required oracle 또는 regression policy가 반증됐다 |
| `incomplete` | readiness, environment, authority, provider, artifact, replay 중 하나가 부족해 신뢰 가능한 판정을 못 했다 |

`incomplete`를 success exit로 바꾸는 옵션은 만들지 않는다. advisory-only finding이 있어도 required
contract가 모두 성립하면 `verified`일 수 있지만, 보고서에는 검토할 항목을 그대로 남긴다.

## 6. Evidence Pack

### 6.1 목적

Evidence Pack은 “문제가 있어 보인다”는 설명을 재현 가능한 판정으로 바꾸는 canonical 산출물이다.
사람용 report는 pack에서 파생하며 정본이 아니다.

논리 구조는 다음과 같다.

```text
Evidence Pack
|-- manifest
|-- repository
|-- contract
|-- environments
|-- scenarioRuns
|-- findings
|-- situations
|-- actions
|-- diagnostics
|-- artifacts
|-- comparison
|-- replay
`-- verdict
```

### 6.2 manifest와 identity

manifest는 최소한 다음을 기록한다.

- pack schema version과 producer exact version
- 생성 시각과 monotonic run identity
- project, contract, scenario catalog digest
- baseline pack과 fixture digest
- repository commit, tree, diff digest 또는 명시적 unavailable state
- browser family, exact version, platform, profile mode
- viewport, locale, timezone, visual preferences, font readiness
- enabled provider와 APX representation version
- redaction policy와 artifact quota
- terminal verdict와 pack content digest

repository source byte나 diff 본문은 기본 pack에 넣지 않는다. identity와 digest만 저장하고, 호출자가
별도로 보존한 source와 연결한다. dirty worktree는 숨기지 않고 base commit, tracked diff digest,
untracked presence를 구분한다.

### 6.3 scenario run

각 run은 다음 순서를 보존한다.

```text
declared precondition
-> actual readiness evidence
-> before SituationCapsule
-> authorized action request
-> ActionEvidence
-> after SituationCapsule
-> oracle evaluations
-> checkpoint verdict
-> cleanup result
```

step이 중간에 실패해도 앞선 evidence를 버리지 않는다. 뒤 step을 실행하지 않았다는 사실과 이유를
기록하고 scenario terminal을 `incomplete` 또는 `rejected`로 닫는다.

### 6.4 artifact

artifact는 content-addressed sidecar다. 각 참조는 media type, byte length, SHA-256, redaction state,
source checkpoint, semantic purpose를 가진다. 기본 우선순위는 다음과 같다.

```text
structured situation
-> geometry and paint evidence
-> entity crop
-> element region
-> full viewport
-> full page
```

낮은 단계로 oracle을 만족하면 뒤 artifact를 만들지 않는다. “모든 화면을 남기기 위해” full screenshot을
수집하지 않는다. 시각 회귀가 전체 composition 자체를 대상으로 선언한 경우에만 full viewport 또는
full page가 required evidence가 된다.

### 6.5 integrity, provenance, signature

pack entry와 sidecar는 canonical order와 digest로 연결한다. 변조, 누락, 순서 변경은 replay preflight에서
거부한다. 이 hash chain이 증명하는 것은 pack 내부 무결성이다. 누가 만들었는지, 누가 승인했는지,
신뢰할 수 있는 runner에서 생성됐는지는 증명하지 않는다.

작성자 또는 CI provenance가 필요하면 기존 state signing 경계를 재사용할 수 있는지 별도 검토하고,
서명과 integrity를 schema에서 분리한다. signature가 없다는 이유로 local pack을 읽지 못하게 하지는
않되, 서명되지 않은 pack을 trusted release evidence로 승격하지 않는다.

### 6.6 replay

replay는 browser effect를 다시 보내지 않고 다음을 확인한다.

1. contract와 scenario digest가 manifest와 일치한다.
2. automation recording chain과 모든 artifact digest가 완전하다.
3. SituationCapsule, ActionEvidence, oracle input이 기록과 일치한다.
4. deterministic oracle을 다시 계산한 terminal이 저장된 verdict와 일치한다.
5. inferred finding은 당시 input과 adapter identity를 보존하되 외부 provider를 다시 호출하지 않는다.
6. reference와 current pack comparison이 같은 issue identity와 분류를 만든다.

replay가 pack을 읽을 수 있다는 사실만으로 live run의 browser truth를 새로 증명하지 않는다. 당시 증거가
현재 판정으로 어떻게 이어졌는지를 재현하는 계약이다.

## 7. 실행 표면 후보

### 7.1 public identity

새 npm root export와 새 Experimental subpath를 만들지 않는다. attempt에서 다음 순서로 소비 표면을
검증한다.

1. 내부 runner가 existing `AutomationSpace`, Perception Computer, ReplaySpace만 소비한다.
2. stable control operation 안에서 audit와 verify를 표현할 수 있는지 검증한다.
3. 기존 `pyproc-control` CLI의 하위 명령 또는 명시적 operation 호출로 노출한다.
4. MCP와 JavaScript, Python client는 같은 terminal과 pack attachment를 받는다.
5. 기존 bin으로 명확한 사용성을 만들 수 없다는 실측이 있을 때만 새 public identity를 재심사한다.

CLI 목표 형태는 다음과 같은 소비 경험이며, exact syntax는 attempt에서 고정한다.

```text
pyproc-control eyes audit --config qa/eyes/experience.json --out .pyproc/evidence/current
pyproc-control eyes verify --config qa/eyes/experience.json --against <exact-pack> --out .pyproc/evidence/current
```

`--against main`을 제공하더라도 floating branch를 core baseline으로 쓰지 않는다. command 시작 시 exact
commit과 pack digest로 해소하고 manifest에 기록한다. `eyes repair`는 만들지 않는다.

### 7.2 exit code

CLI는 terminal을 숨기지 않는 exit contract를 가진다.

- `verified`: 성공 exit
- `rejected`: contract violation exit
- `incomplete`: execution 또는 evidence completeness exit
- malformed contract, authority refusal, internal defect는 별도 stable error code

finding count나 advisory 존재만으로 exit code를 정하지 않는다. 최종 schema와 code는 control error
vocabulary와 충돌하지 않게 attempt에서 확정한다.

### 7.3 caller workflow

호출자 관점의 정상 루프는 다음과 같다.

```text
start app under caller authority
-> run audit
-> inspect Evidence Pack
-> change source outside pyproc
-> run verify against exact reference
-> accept only verified
```

서버가 이미 떠 있지 않으면 preflight는 actionable하게 target URL과 readiness 실패를 반환한다. 그러나
repository 문서의 명령을 대신 실행하지 않는다.

## 8. 내부 아키텍처 후보

### 8.1 책임 흐름

```text
ExperienceContractLoader
          |
          v
ScenarioCompiler -> VerificationPolicy
          |                 |
          v                 v
VerificationRunner -> Situation and Action clients
          |
          +-> CheckpointOracle
          +-> DiagnosticCollector
          +-> VisualEvidencePlanner
          |
          v
IssueLedger -> RegressionComparator -> EvidencePackWriter -> ReplayVerifier
```

contract parser는 browser를 모르고, runner는 report 문장을 만들지 않으며, comparator는 live browser를
열지 않는다. report renderer는 canonical pack만 읽는다.

### 8.2 승격 후 파일 배치 후보

실측 전에는 다음 파일을 만들지 않는다. 졸업한 책임만 `scripts/verification/`에 승격한다.

```text
scripts/verification/
|-- experienceContract.js
|-- scenarioCompiler.js
|-- verificationPolicy.js
|-- verificationRunner.js
|-- checkpointOracle.js
|-- visualEvidencePlanner.js
|-- diagnosticCollector.js
|-- issueLedger.js
|-- regressionComparator.js
|-- evidencePack.js
|-- replayVerifier.js
`-- reportRenderer.js
```

다음 기존 책임을 중복 구현하지 않는다.

- browser lifecycle과 action은 `scripts/automationSpace/`와 `scripts/browserControl/`을 쓴다.
- situation과 evidence는 Perception Computer의 public client를 쓴다.
- action terminal은 `ActionEvidence`를 쓴다.
- artifact transport와 digest는 Control Protocol을 쓴다.
- record chain과 effect-free replay는 ReplaySpace를 쓴다.
- content digest와 canonical JSON은 기존 검증된 primitive를 재사용한다.

기존 모듈에 verification-specific flag를 계속 추가하지 않는다. orchestration은 별도 위층 책임으로
두고 아래 계약을 조합한다.

### 8.3 repository context adapter

repository identity 수집은 optional adapter다. 고정된 read-only operation만 허용한다.

- repository root의 realpath 확인
- current commit과 tree identity
- tracked diff digest
- untracked file 존재 여부
- config 파일과 reference pack digest

config가 shell argv를 주입할 수 없게 한다. git command가 필요하면 implementation에 고정된 read-only
argv만 사용하고, 실행 결과와 unavailable reason을 manifest에 기록한다. repository가 아니어도 ad hoc
URL audit는 가능해야 한다.

### 8.4 atomicity와 cancellation

Evidence Pack은 임시 run directory에서 작성하고 terminal과 모든 digest가 닫힌 뒤 final path로
원자적으로 publish한다. cancel, browser death, quota 초과, report rendering 실패 때 다음을 지킨다.

- external effect를 자동 재전송하지 않는다.
- partial pack을 complete pack 이름으로 publish하지 않는다.
- 이미 수집한 evidence는 diagnostic partial로 보존할 수 있지만 terminal은 `incomplete`다.
- browser session, isolated profile, temporary artifacts, file handle을 정리한다.
- final rename 전 abort면 reference catalog를 갱신하지 않는다.
- report 생성 실패는 canonical pack 성공을 뒤집지 않지만 report 상태를 명시한다.

## 9. 보안과 신뢰 경계

### 9.1 위협 모델

1. repository 문서가 실행 명령이나 permission 확대를 유도한다.
2. page text, accessibility label, declared tool이 호출자 instruction처럼 보인다.
3. baseline이 다른 browser 또는 fixture에서 만들어져 정상 차이를 회귀로 위장한다.
4. target page가 credential, cookie, token, 개인 정보를 artifact에 노출한다.
5. external effect scenario가 실제 계정이나 production endpoint를 변경한다.
6. stale locator가 rerender 뒤 다른 control을 가리킨다.
7. browser death 뒤 effect 결과를 모른 채 자동 재시도한다.
8. pack 일부가 삭제되거나 다른 run artifact로 바뀐다.
9. inference 결과가 deterministic oracle처럼 표시된다.
10. report markdown이 canonical JSON과 달라진다.

### 9.2 강제 정책

- isolated browser profile이 기본이고 기본 사용자 profile attach는 금지한다.
- origin, action, risk, purpose, file root, quota를 manifest에서 명시한다.
- external effect는 기본 deny이며 test fixture와 explicit acknowledgement가 모두 있어야 한다.
- page와 repository prose는 data이며 authority를 만들지 않는다.
- secret-shaped field와 header는 capture 전에 redact하고 원문을 sidecar에 쓰지 않는다.
- locator와 capability는 document epoch에 묶고 stale이면 새로 관찰한다.
- `outcomeUnknown` effect를 자동 재전송하지 않는다.
- baseline catalog 변경은 current verification과 같은 run에서 자동 승인하지 않는다.
- report는 pack에서만 생성하고 report 내용을 다시 verdict input으로 사용하지 않는다.

## 10. 실험 캠페인

모든 신규 코드는 [Initiative 2 attempt](../../tests/attempts/verifiedChangeLoop/)에서 시작한다.
Perception Computer가 졸업하기 전에는 probe 파일을 만들지 않는다.

### 10.1 fixture family

1. readiness가 늦고 loading, ready, running, success, error가 분리된 application
2. duplicate accessible name, visual active state, 누락된 selected semantics
3. desktop에서는 정상이고 mobile에서 overflow, clipping, sticky overlap이 생기는 layout
4. modal이 viewport 밖으로 나가거나 overlay가 target을 가리는 상태
5. click command는 성공하지만 durable state 또는 network postcondition은 실패하는 Save flow
6. console error와 unrelated network failure가 섞인 flow
7. SPA rerender, document replacement, stale locator, browser reconnect
8. long output, empty state, permission denial, offline, restore
9. brand reference와 결정적 rule이 없는 주관적 visual 차이
10. baseline browser, viewport, fixture, font, locale가 다른 comparison
11. secret-shaped network와 DOM content가 있는 redaction fixture
12. partial artifact, mutated pack, missing recording, changed oracle

현재 web computer 코드에서 발견되는 가능성은 fixture 아이디어일 뿐 실제 issue가 아니다. 모든 button을
한꺼번에 disable하는 busy state, visual class만 있는 selected state, platform shortcut 안내, boot failure의
복구 경로는 실제 browser scenario와 제품 의도를 확인한 뒤에만 finding으로 기록한다.

### 10.2 예정 probe

| probe | 판정 질문 | 필수 음성 시험 |
|---|---|---|
| `contractBoundaryProbe.mjs` | strict JSON과 사람 문서의 책임이 분리되는가 | `EYES.md` command, unknown field, path escape 실행 0 |
| `readinessProbe.html` | 준비 전 화면과 최종 상태를 구분하는가 | timeout을 verified 또는 product defect로 오판 0 |
| `responsiveTruthProbe.html` | overflow, clipping, occlusion, hit target을 viewport별로 찾는가 | browser 환경 mismatch에서 regression 판정 0 |
| `stateTruthProbe.html` | visible state와 durable state의 모순을 찾는가 | click applied만으로 verified 판정 0 |
| `diagnosticCorrelationProbe.html` | 관련 console과 network evidence만 연결하는가 | unrelated response 오상관 0 |
| `perceptualBoundaryProbe.html` | 주관적 판단을 inferred advisory로 남기는가 | 근거 없는 취향을 required fail로 승격 0 |
| `issueIdentityProbe.html` | rerender 뒤 같은 문제를 이어가는가 | 좌표 변경만으로 introduced finding 생성 0 |
| `baselinePinProbe.mjs` | exact 환경과 pack만 비교하는가 | floating, fixture mismatch, browser mismatch 수락 0 |
| `evidencePackProbe.mjs` | canonical pack과 sidecar가 완결되는가 | byte mutation, missing artifact, report drift 수락 0 |
| `redactionProbe.html` | secret을 capture 전에 제거하는가 | cookie, authorization, token 원문 artifact 0 |
| `authorityBoundaryProbe.html` | page와 repo prose가 권한을 넓히지 않는가 | external effect 자동 승인과 stale locator action 0 |
| `replayVerdictProbe.mjs` | live effect 없이 verdict를 재계산하는가 | provider 호출, effect 재전송, changed oracle 묵인 0 |
| `consumerParityProbe.mjs` | 모든 client가 같은 pack과 terminal을 받는가 | client별 severity 또는 incomplete 축약 0 |

### 10.3 졸업 gate

아래 항목이 전부 green이어야 본진으로 승격한다.

1. required scenario 누락, readiness 미달, 환경 mismatch, artifact 누락이 모두 `incomplete`로 끝난다.
2. false `verified` 0, wrong-target action 0, `outcomeUnknown` 자동 재전송 0이다.
3. click applied와 business postcondition 실패 fixture가 반드시 `rejected`다.
4. baseline과 current의 contract, fixture, browser, viewport identity가 다르면 비교하지 않는다.
5. responsive fixture의 deterministic 결함을 모든 선언 viewport에서 찾고 정상 fixture 오탐은 0이다.
6. perceptual-only claim이 required deterministic verdict를 바꾼 횟수 0이다.
7. full screenshot이 필요하지 않은 semantic scenario의 full-page artifact 수는 0이다.
8. 모든 finding은 scenario, checkpoint, rule, entity lineage, evidence ref로 역추적된다.
9. pack byte mutation, artifact 삭제, recording chain mutation, oracle digest 변경을 모두 거부한다.
10. replay는 live provider request와 browser effect 0으로 같은 deterministic verdict와 issue identity를 낸다.
11. cookie, authorization, token-shaped value, configured secret fixture의 원문 유출은 0이다.
12. cancel, browser death, quota failure 뒤 complete pack 오게시 0, 남은 owned process와 profile 0이다.
13. JavaScript, Python, MCP, CLI가 같은 terminal, finding identity, pack digest를 반환한다.
14. clean installed package에서 example Experience Contract로 audit와 verify를 완주한다.
15. 신설 gate마다 음성 fixture를 주입해 RED를 확인한 뒤 복원한다.

## 11. 실행 단계

### 단계 0. 기준 상태 동결

산출물:

- 선행 이니셔티브 졸업 증거 확인
- `npm test`와 관련 installed browser gate 기준선
- package와 browser exact version
- repository dirty-state 기록
- 현재 공개 operation, error, attachment, replay 계약 목록

종료 조건:

- 기존 능력과 새 orchestration 책임의 중복이 표로 정리된다.
- 변경될 가능성이 있는 public surface의 모든 참조처를 확인한다.
- 선행 이니셔티브 미완료면 여기서 중단한다.

### 단계 1. Experience Contract fixture

작업:

- `EYES.md`, `experience.json`, `scenarios.json`, `baselines.json` fixture를 만든다.
- strict schema와 negative fixture를 먼저 작성한다.
- start command 비실행, path confinement, origin, risk, quota 경계를 고정한다.

종료 조건:

- malformed와 unsafe contract가 browser launch 전에 거부된다.
- human prose가 machine authority로 승격되는 경로가 없다.
- schema 필드마다 consumer와 판정 책임이 하나씩 연결된다.

### 단계 2. Deterministic scenario runner

작업:

- readiness, action, checkpoint, oracle, cleanup state machine을 만든다.
- typed action만 허용하고 live situation에서 locator를 얻는다.
- required, advisory, skipped, incomplete 의미를 고정한다.

종료 조건:

- readiness 지연, action 실패, browser death, cancel이 canonical terminal로 수렴한다.
- fixed sleep이나 screenshot 존재만으로 scenario를 통과시키지 않는다.
- effect를 한 번 넘게 보내는 경로가 없다.

### 단계 3. Structural and responsive oracle

작업:

- overflow, clipping, occlusion, hit target, focus, selected semantics, dialog bounds를 typed rule로 만든다.
- viewport environment identity와 font readiness를 연결한다.
- finding이 APX claim과 bounded evidence를 참조하게 한다.

종료 조건:

- 정상, 결함, 환경 mismatch fixture를 모두 구분한다.
- 좌표 변화가 issue identity를 깨뜨리지 않는다.
- full screenshot 없이 판정 가능한 fixture는 visual artifact를 만들지 않는다.

### 단계 4. Behavioral truth oracle

작업:

- before situation, action effect, visible state, durable state, network postcondition을 한 checkpoint에 묶는다.
- console과 network redaction 및 correlation policy를 구현한다.
- contradictory, ambiguous, notObserved, outcomeUnknown을 보존한다.

종료 조건:

- click applied만으로 verified가 되지 않는다.
- unrelated request, stale state, visible과 durable 모순을 음성 fixture가 잡는다.
- external effect와 자동 재전송이 막힌다.

### 단계 5. Perceptual boundary

작업:

- unresolved visual question만 crop하도록 evidence planner를 만든다.
- reference digest, inferred provenance, adapter identity를 기록한다.
- advisory와 needsReview를 deterministic verdict에서 분리한다.

종료 조건:

- 제품 원칙이나 reference 없는 취향 finding이 생성되지 않는다.
- inference가 locator, permission, business success를 만들지 않는다.
- adapter가 없어도 deterministic audit가 완주한다.

### 단계 6. Issue ledger and comparison

작업:

- stable issue identity와 introduced, persisting, resolved, changed, uncomparable을 구현한다.
- exact baseline pin과 environment comparability를 먼저 검사한다.
- severity와 repository rejection policy를 분리한다.

종료 조건:

- baseline mismatch는 finding diff가 아니라 incomplete다.
- new major regression과 resolved issue를 정확히 분류한다.
- current run이 baseline catalog를 스스로 승인하지 않는다.

### 단계 7. Evidence Pack

작업:

- canonical manifest, scenario runs, findings, sidecar index, verdict를 만든다.
- repository, contract, environment, fixture identity를 기록한다.
- partial directory와 atomic final publish를 구현한다.
- markdown과 선택적 HTML report를 pack에서 파생한다.

종료 조건:

- 같은 logical input은 timestamp와 run identity를 제외한 canonical content에서 안정적이다.
- report를 지워도 pack 판정이 보존된다.
- report를 바꿔도 pack digest와 verdict가 바뀌지 않으며 drift가 탐지된다.
- partial pack이 complete 경로에 나타나지 않는다.

### 단계 8. Replay verification

작업:

- recording, capsule, evidence, artifact, oracle digest를 재검증한다.
- deterministic terminal과 issue identity를 다시 계산한다.
- inferred result는 재호출하지 않고 기록된 provenance만 확인한다.

종료 조건:

- live provider call과 browser effect 없이 동일 verdict가 나온다.
- mutation과 누락 fixture가 모두 거부된다.
- integrity와 signature 설명이 구분된다.

### 단계 9. 종합 반증

작업:

- 전체 fixture family를 pinned environment에서 반복한다.
- 단순 screenshot regression, Playwright baseline, pyproc pack의 task reach와 증거 범위를 비교한다.
- pyproc이 추가한 복잡성이 truth, minimal evidence, replay에서 실제 이득인지 판정한다.

종료 조건:

- baseline이 성공하는 필수 user flow를 잃지 않는다.
- false verified, authority 위반, secret leak이 0이다.
- 이득이 특정 model trial의 인상에만 의존하지 않는다.
- 반증된 축은 삭제하거나 범위를 축소한다.

### 단계 10. 본진 승격

작업:

- 졸업한 모듈만 `scripts/verification/`에 이동한다.
- attempt import와 fixture 전용 branch를 제거한다.
- AutomationSpace와 Perception Computer public client만 소비하게 한다.
- module boundary와 package file 목록을 갱신한다.

종료 조건:

- package-internal deep import가 없다.
- 기존 아래 계층에 verification flag가 흩어지지 않는다.
- package tarball에 필요한 schema, CLI module, example만 포함된다.

### 단계 11. Control, CLI, MCP, SDK

작업:

- audit와 verify operation 또는 기존 operation 조합을 확정한다.
- `pyproc-control` CLI의 config, output, against, exit contract를 구현한다.
- MCP tool과 JavaScript, Python SDK에 같은 typed terminal을 노출한다.
- large pack은 verified attachment로 전송한다.

종료 조건:

- 네 client가 같은 canonical pack digest와 verdict를 받는다.
- malformed input과 incomplete를 client가 success로 축약하지 않는다.
- 새 root export, deep import, model-specific adapter가 없다.
- `repair` operation과 command가 없다.

### 단계 12. 정식 gate와 CI

작업:

- contract, browser, installed package, replay, client parity gate를 등록한다.
- Chrome Ubuntu와 Edge Windows matrix에서 지원 경계를 실측한다.
- 신설 gate의 음성 fixture를 자동으로 검증한다.
- evidence pack을 CI artifact로 보존하되 baseline 자동 갱신은 막는다.

예상 gate:

```text
npm test
npm run test:types
npm run test:contracts
npm run test:apx
npm run test:browser-control
npm run test:replay-space
npm run test:mcp-product
npm run test:control-product
npm run test:python-sdk
npm run test:installed
```

새 script 이름은 실제 runner가 안정된 뒤 정한다. 기존 gate에 책임이 자연스럽게 들어가면 억지로 별도
script를 늘리지 않는다.

종료 조건:

- clean checkout과 packed exact package에서 같은 golden verification이 green이다.
- CI artifact와 local pack의 schema가 같다.
- browser unavailable은 success가 아니라 정확한 incomplete 또는 skip policy로 보인다.
- 음성 fixture가 실제 RED를 만든다.

### 단계 13. 문서와 README 정합

능력 구현과 같은 변경에서 다음 문서를 갱신한다.

| 문서 | 반드시 맞출 내용 |
|---|---|
| `docs/specs/verification/README.md` | Experience Contract, finding, Evidence Pack, terminal, conformance |
| `docs/usage/experienceVerification.md` | repository setup, audit, verify, CI, report 읽기, cleanup |
| `docs/usage/browserAutomation.md` | 단일 action evidence와 repository verification의 경계 |
| `docs/usage/automationSpace.md` | runner가 provider lifecycle을 소비하는 방식 |
| `docs/usage/replaySpace.md` | pack replay와 effect-free 한계 |
| `docs/usage/controlProtocol.md` | operation, attachment, cancellation, error |
| `docs/usage/javascriptControl.md` | JavaScript audit와 verify 예제 |
| `docs/usage/pythonSdk.md` | Python audit와 verify 예제 |
| `docs/usage/capabilityMatrix.md` | 상태, prerequisites, runnable surface, gate, boundary |
| `docs/usage/trustPermissions.md` | repo prose, browser profile, origin, external effect, secret 경계 |
| `docs/reference/api.md` | stable type, operation, CLI, error code |
| `docs/product/vision.md` | 검증된 범위만 현재형으로 이동 |
| `docs/operations/contractReality.md` | 완료된 debt 행 삭제, 새로 발견한 실제 간극 기록 |
| `docs/operations/agentExperienceInitiatives.md` | 종료된 계획을 현재 능력과 다음 frontier로 정리 |
| `docs/README.md` | 새 spec과 usage 문서 routing |
| `README.md`, `README.ko.md` | 같은 quick path, 정확한 경계, 같은 command와 verdict |
| `SECURITY.md` | untrusted repo/page text, redaction, profile, baseline poisoning |
| `CHANGELOG.md` | 실제 출시한 public contract만 기록 |

`EYES.md`와 `qa/eyes/` 예제는 실제 installed package golden journey에서 복사해 실행할 수 있어야 한다.
README에는 아직 구현되지 않은 `audit`, `verify`, Evidence Pack을 현재 능력처럼 미리 쓰지 않는다.
영문과 국문 README의 command, option, error, 지원 범위가 같아야 한다.

종료 조건:

- package usage, spec, API reference, root README 예제가 같은 schema와 command를 쓴다.
- docs index와 모든 상대 링크가 green이다.
- screenshot 기반 일반론, 전체 framework 우월성, 자동 repair 주장이 없다.
- integrity와 signature, verified와 incomplete, deterministic과 inferred가 모든 문서에서 구분된다.

### 단계 14. 최종 제품 검증

최종 golden journey는 clean directory에서 다음을 수행한다.

```text
install exact package
-> prepare isolated browser assets and manifest
-> start fixture under caller authority
-> copy the documented qa/eyes contract
-> audit desktop, tablet, mobile states
-> inspect one deterministic failure and one advisory
-> change fixture to the fixed revision
-> verify against the exact reference pack
-> receive verified terminal and Evidence Pack
-> replay the pack without browser effects
-> confirm cleanup
```

동시에 음성 journey를 실행한다.

- server not ready
- broad origin
- unknown scenario field
- stale locator
- external effect without acknowledgement
- browser version mismatch
- fixture digest mismatch
- console 또는 network contradiction
- secret-shaped content
- missing artifact
- mutated pack
- post-send browser death
- cancellation during pack write

종료 조건:

- 양성 journey는 모든 public client에서 같은 결과다.
- 음성 journey는 false verified 없이 stable terminal과 actionable error를 낸다.
- Evidence Pack은 effect 없이 replay되고 모든 artifact digest가 일치한다.
- 완료 뒤 owned browser, profile, process, temporary pack이 남지 않는다.

### 단계 15. 원장 종료와 계획 삭제

모든 gate가 green이면 같은 종료 사이클에서 다음을 수행한다.

1. `docs/operations/contractReality.md`의 이 debt 행을 삭제한다.
2. 지속 계약과 현재 한계를 정식 docs에 남긴다.
3. `tests/attempts/verifiedChangeLoop/`를 폴더째 삭제한다.
4. `mainPlan/2-verifiedChangeLoop/`를 폴더째 삭제한다.
5. `mainPlan/README.md`에서 다음 활성 이니셔티브를 실제 상태에 맞게 갱신한다.
6. `git status`, package contents, docs links, 전체 gate를 다시 확인한다.

완료 메모나 `_done` 폴더를 남기지 않는다. 실험 과정과 의사결정 이력은 Git이 소유한다.

## 12. 커밋 경계

실행 시 다음 논리 단위를 섞지 않는다.

1. attempt contract와 negative fixture
2. scenario runner와 readiness
3. structural 및 responsive oracle
4. behavioral truth와 diagnostics
5. perceptual boundary
6. issue identity와 comparison
7. Evidence Pack과 replay
8. 본진 승격과 module boundary
9. public client와 type surface
10. 정식 gate와 CI
11. docs와 examples
12. attempt 및 mainPlan 삭제

각 커밋은 관련 gate를 통과하고, 신설 gate는 음성 시험 결과를 커밋 메시지 검증 줄에 기록한다. 릴리즈는
사용자가 별도로 지시하지 않으면 하지 않는다.

## 13. 실패와 축소 조건

다음 중 하나면 현재 설계를 그대로 제품화하지 않는다.

- Perception Computer 없이도 같은 truth와 evidence를 더 단순한 기존 계약으로 만들 수 있다.
- Experience Contract가 사실상 selector script 모음으로 퇴화한다.
- EYES.md 자연어를 실행 또는 permission 입력으로 써야만 사용성이 성립한다.
- deterministic oracle보다 특정 model의 판단이 terminal을 더 많이 결정한다.
- full screenshot 수집이 대부분의 scenario에서 기본값으로 돌아온다.
- baseline 환경 차이를 안정적으로 구분하지 못해 false regression이 생긴다.
- Evidence Pack이 report 파일 모음일 뿐 replay 가능한 canonical truth를 갖지 못한다.
- `incomplete`를 자주 success로 축약해야 product journey가 green이 된다.
- audit와 verify를 만들기 위해 source repair와 agent framework까지 소유해야 한다.
- existing Control, AutomationSpace, ReplaySpace를 우회하는 새 protocol이 필요하다.
- secret redaction 또는 external effect authority를 약화해야 유용해진다.

축소할 때도 유효한 하위 결과만 남긴다. 예를 들어 repository-wide verdict가 실패해도 Evidence Pack
schema나 strict Experience Contract가 독립 가치를 browser gate로 증명하면 해당 계약만 승격할 수 있다.
반대로 pack 없이 report renderer만 남기지 않는다.

## 14. 완료 정의

이 이니셔티브는 다음이 모두 참일 때만 끝난다.

- 저장소가 사람용 의도와 strict machine contract를 안전하게 함께 제공한다.
- 준비 상태, 주요 surface, critical state, viewport가 재현 가능한 scenario로 실행된다.
- 구조, 행동, perceptual finding이 provenance와 판정 권한에 따라 분리된다.
- 클릭 완료가 아니라 업무 postcondition과 상태 truth가 검증된다.
- 필요한 visual evidence만 만들고 semantic scenario는 screenshot 없이 끝난다.
- exact baseline과 비교해 introduced, persisting, resolved, changed, uncomparable을 구분한다.
- false verified, wrong-target action, 자동 effect 재전송, secret leak이 없다.
- Evidence Pack이 repository, contract, environment, scenario, situation, action, artifact, verdict를 연결한다.
- pack mutation과 누락을 거부하고 live effect 없이 deterministic verdict를 replay한다.
- JavaScript, Python, MCP, CLI가 같은 의미를 제공한다.
- clean installed package golden journey와 모든 음성 gate가 green이다.
- 문서, README, examples, package contents, security 설명이 현재 코드와 일치한다.
- attempt와 mainPlan 폴더가 완료 사이클에 삭제된다.

이 조건 전에는 “변경 완료를 증명한다”, “Playwright를 능가한다”, “거짓 완료를 막는다”는 표현을 현재
제품 주장으로 사용하지 않는다. 졸업 뒤에도 우월성은 repository experience verification, state truth,
minimal evidence, replay라는 통과한 축으로만 제한한다.
