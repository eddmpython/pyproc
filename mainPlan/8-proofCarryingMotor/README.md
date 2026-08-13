# Initiative 8: Proof-Carrying Motor 제품 요구사항과 실행 계획

상태: **Initiative 7 후행 대기**

이 문서는 APX가 이해한 대상에 같은 의미 행동을 cooperative app, browser input, Windows accessibility,
OS input 중 적합한 경로로 수행하고, 사용자 제어권과 effect 경계를 지키며, 실제 결과를 증명하는 아홉 번째
이니셔티브의 PRD이자 임시 실행 계획이다.

지속 제품 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-8---proof-carrying-motor),
실험 원장은 [Initiative 8 attempt](../../tests/attempts/proofCarryingMotor/README.md)가 소유한다. 이 문서는
원본 `PyProc Motor 차세대 에이전트 운동 시스템 기획서`를 현재 pyproc 계약과 Initiative 1부터 7까지의
책임에 맞게 재설계한 결과다.

## 1. 최종 제품 결과

현재 제품은 browser entity를 관찰하고 `click`, `fill`, `drag` 같은 action을 안전하게 실행할 수 있다.
Initiative 1부터 7까지가 끝나면 목표별 world, proof-carrying action, one-shot effect, cooperative app state,
verified replay world도 갖는다. 남는 간극은 손의 경로다.

> Proof-Carrying Motor는 provider 명령을 늘리는 자동화 계층이 아니다. 하나의 desired-state intent를 현재
> world와 authority에 묶어 불변 ActuationPlan으로 컴파일하고, 적합한 actuator에서 한 번의 bounded effect
> window로 실행한 뒤, 같은 terminal truth와 evidence로 봉인하는 컴퓨터 actuation kernel이다.

제품 루프는 다음으로 고정한다.

```text
situate
-> compile desired-state intent
-> bind exact target
-> enumerate eligible actuators
-> choose deterministic route
-> rehearse when policy requires
-> acquire physical control when required
-> live preflight
-> execute one bounded effect window
-> verify transition
-> seal receipt
-> remember
```

사용자가 얻는 결과는 다음과 같다.

1. browser button, cooperative app capability, Windows control을 같은 `activate` intent로 다룬다.
2. `toggle`처럼 현재 상태에 따라 뜻이 뒤집히는 명령 대신 원하는 최종 상태를 요청한다.
3. 어떤 actuator가 왜 선택됐고 다른 후보가 왜 거부됐는지 결정적으로 읽는다.
4. target이 움직이거나 가려지면 effect 전에 보정하고, effect 뒤에는 새 시도를 만들지 않는다.
5. drag와 text composition은 미리 승인된 한 gesture 안에서만 완결하고 재시작하지 않는다.
6. 실제 사용자 입력이 나타나면 물리 제어권이 즉시 사용자에게 돌아간다.
7. 명령 전송 성공이 아니라 기대한 semantic transition과 업무 postcondition을 받는다.
8. 같은 receipt와 terminal을 live provider 호출 없이 replay한다.
9. 실패 지점과 effect 전 복구 지점을 episode로 축적하고, 다음 교정 후보를 effect 없이 검증한다.
10. 검증된 전술 revision만 다음 실행에 적용하며 안전 불변식은 학습으로 바꾸지 않는다.

짧은 제품 문장은 다음이다.

> **One intent, the right arm, one effect window, proof of result.**

## 2. 원안 분석과 채택 판정

원안은 `affordance-first`, multi-plane actuation, closed-loop control, delegated authority, evidence를 하나의
운동 시스템으로 본 점이 강하다. 그대로 구현하면 이미 계획된 계약을 중복하거나 서로 충돌하는 지점이
있다. 아래 판정이 Initiative 8의 범위를 고정한다.

| 원안 요소 | 판정 | Initiative 8 결정 |
|---|---|---|
| semantic intent | 채택 후 축소 | relative verb를 버리고 absolute desired-state intent를 canonical로 둔다 |
| affordance overlay | 기존 계약 재사용 | Initiative 1 capability plane이 소유하고 Motor는 actuator reach만 계산한다 |
| multi-plane broker | 채택 | cooperative, browser input, accessibility, OS input을 같은 conformance로 묶는다 |
| weighted actuator score | 폐기 | hard constraint 뒤 versioned lexicographic rule로 결정한다 |
| visual fallback actuator | 폐기 | pixel은 target claim을 보강하는 sensor이며 실제 손은 browser 또는 OS input이다 |
| InputLease | 재정의 | effect 승인과 분리한 물리 장치 점유권 `ControlLease`로 좁힌다 |
| ServoLoop | 채택 후 교정 | pre-contact correction과 bounded committed gesture를 분리한다 |
| effect 이후 보정 금지 | 폐기 | drag를 불가능하게 하므로 plan 변경 금지와 gesture envelope 제한으로 바꾼다 |
| MotorReceipt | 합성 receipt로 채택 | 기존 ActionEvidence와 EffectReceipt를 복제하지 않고 참조한다 |
| MotorBridge | 기존 계약 재사용 | Initiative 6 AppSpace와 effect outbox를 다시 만들지 않는다 |
| Windows UIA와 SendInput | 채택 | 첫 native provider로 제한하고 optional sidecar로 둔다 |
| DelegatedTabSpace | 채택 | `activeTab` user gesture와 origin epoch에 묶인 bounded provider로 만든다 |
| macOS AX와 Linux AT-SPI | 후속 | adapter contract는 열어 두되 Initiative 8 종료 조건에서는 제외한다 |
| Playwright facade | 제외 | 제품 차이를 흐리고 외부 API 수명주기에 종속되므로 이 이니셔티브에서 만들지 않는다 |
| DelegationProof 인터넷 표준 | 후속 | cooperative app identity에 필요한 extension point만 남기고 새 표준을 선언하지 않는다 |
| anti-detection | 폐기 | stealth, CAPTCHA 우회, 지문 위장, 사용자 행동 위조를 제품 목표로 두지 않는다 |

가장 중요한 교정은 세 가지다.

1. **Pixels are eyes, not hands.** 화면 좌표를 pixel에서 얻더라도 effect를 보내는 actuator는 browser input
   또는 OS input이다.
2. **Authority is not a score.** 관측 품질이나 weighted score가 permission, target uniqueness, effect
   approval을 대신하지 않는다.
3. **Closed loop is not retry.** effect 전에 자유롭게 보정하되, effect 뒤에는 미리 고정한 한 gesture만
   완결하고 새 시도를 만들지 않는다.

## 3. 선행 조건과 직렬 순서

Initiative 8은 Initiative 7 졸업 뒤에만 시작한다.

| 선행 Initiative | 재사용하는 정본 | Motor가 다시 만들지 않는 것 |
|---|---|---|
| 1 Perception Computer | SituationCapsule, affordance, action capability, transition proof | 별도 world model과 confidence 기반 target 추론 |
| 2 Verified Change Loop | Experience Contract, Evidence Pack, deterministic verdict | screenshot report와 독자 audit format |
| 3 Hibernating Machine Fleet | owner lifecycle, wake, lease, cold recovery | native host를 resident fleet로 위장하는 수명주기 |
| 4 Execution Memory Registry | exact session revision, handoff, evidence links | mutable motor session registry |
| 5 Rehearse-Commit Transactions | EffectIntent, ApprovalGrant, CommitLease, EffectReceipt | effect approval, idempotency, one-shot send protocol |
| 6 Transactional AppSpace | cooperative action, logical state, outbox, receipt | 별도 MotorBridge와 business action RPC |
| 7 ReplayGraph Worlds | exact state node, action edge, rehearsal coverage | 결과를 생성하는 simulated UI world |

이 순서는 단지 번호를 맞춘 것이 아니다. 먼저 Motor를 만들면 affordance, lease, receipt, replay를 다시
정의하게 되고 provider마다 다른 truth contract가 생긴다. Initiative 8은 앞선 능력을 한 동작으로 합성하는
마지막 orchestration layer다.

## 4. 제품 차별화 명제

경쟁력은 OS 마우스를 움직이는 데 있지 않다. OS input 도구와 browser automation 도구는 이미 존재한다.
차이는 같은 intent를 여러 plane에서 실행하면서 다음 불변식을 한 번도 버리지 않는 데 있다.

```text
same desired state
+ same world-bound target
+ same authority lineage
+ deterministic route decision
+ one bounded effect window
+ same terminal vocabulary
+ replayable evidence
```

| 일반 실행기 | Proof-Carrying Motor |
|---|---|
| selector 또는 coordinate가 target | world와 surface epoch에 묶인 TargetBinding이 target |
| click, key, mouse move가 public action | desired semantic state가 public intent |
| 실패하면 다른 selector나 input으로 재시도 | pre-contact `notSent`에서만 같은 권한 안의 fallback |
| driver 응답이 성공 | transition evidence와 업무 postcondition이 terminal |
| browser와 desktop API가 분리 | 같은 plan과 receipt를 provider adapter가 구현 |
| 사용자가 개입하면 입력 경합 | ControlLease가 회수되고 safety release만 허용 |
| replay가 action mock을 반환 | exact plan digest와 recorded terminal을 effect 없이 반환 |

`Playwright보다 모든 면에서 우월하다`, `사람처럼 보인다`, `모든 앱을 제어한다`는 주장은 하지 않는다.
증명할 차이는 semantic continuity, authority continuity, effect safety, cross-plane conformance다.

## 5. 범위

### 5.1 반드시 완성할 것

1. strict desired-state intent schema와 canonical digest
2. world-bound TargetBinding과 cross-plane binding proof
3. hard eligibility와 deterministic route selection
4. ActuationPlan과 actuator-specific effect window
5. `activate`, `focus`, `setValue`, `setSelected`, `setExpanded`, `scrollTo`, `dragTo`
6. Native CDP Browser Input Actuator
7. AppSpace Cooperative Actuator adapter
8. ReplayGraph effect-free actuator
9. Windows UIA semantic actuator
10. Windows `SendInput` physical actuator
11. ControlLease와 user preemption
12. DelegatedTabSpace의 `activeTab` extension path
13. ActuationReceipt, ActionEvidence, EffectReceipt 연결
14. ActuationEpisode, failure attribution, CorrectionProposal, versioned policy promotion
15. Control, JavaScript, Python, MCP parity
16. optional native host의 설치, integrity, update, removal 경로

### 5.2 명시적 범위 밖

- macOS AX와 Linux AT-SPI production provider
- mobile OS와 remote desktop 전체 지원
- CAPTCHA, stealth, fingerprint evasion, bot identity 위장
- 사용자 default browser profile에 대한 무단 debugger attachment
- raw coordinate, raw key sequence, arbitrary process handle의 public API
- browser chrome 전체 제어
- OS 전역 input 차단
- arbitrary JavaScript heap, cookie, server state rollback
- app-specific private API 추출
- Playwright API 호환 layer
- hosted inference를 target 또는 authority oracle로 사용
- 상대 동사 `toggle`, `increment`, `decrement`를 canonical intent로 추가
- 새 npm root export, subpath, bin

## 6. Canonical ActuationIntent

### 6.1 absolute verb

v1 intent는 최종 의미 상태가 명시되는 작은 집합으로 고정한다.

| Intent | 요청하는 결과 | 허용 target 예 |
|---|---|---|
| `activate` | 대상의 primary action을 한 번 시작 | button, link, menu item |
| `focus` | target이 현재 입력 focus를 소유 | textbox, editor |
| `setValue` | semantic value가 exact expected value와 같음 | text, number, range |
| `setSelected` | selected 또는 checked 상태가 exact boolean 또는 item set과 같음 | checkbox, option, list |
| `setExpanded` | expanded 상태가 exact boolean과 같음 | tree item, disclosure |
| `scrollTo` | target region 또는 semantic item이 requested visibility 상태에 도달 | document, list, region |
| `dragTo` | source가 exact target 또는 semantic value에 도달 | card, drop zone, slider |

`toggle`은 현재 값을 잘못 읽으면 반대 결과를 만든다. `increment`와 `decrement`도 stale base에 의존한다.
편의 facade가 필요하면 실행 직전 live state에서 absolute intent로 컴파일하며 wire에는 relative verb를 남기지
않는다.

`submit`, `purchase`, `approveInvoice`, `transferFunds`는 motor verb가 아니다. 이들은 Initiative 5의
EffectIntent 또는 Initiative 6 outbox가 소유하는 business effect다. UI의 submit button을 누르는 운동은
`activate`지만, 업무 승인은 별도 authority를 요구한다.

### 6.2 요청 envelope

```json
{
  "intent": "setSelected",
  "target": {
    "spaceRef": "space:browser-1",
    "entityRef": "entity:shipping-option",
    "worldRef": "world:81",
    "surfaceEpoch": "document:18"
  },
  "desired": {
    "selected": true
  },
  "preconditions": [],
  "expectedTransition": [],
  "authority": {
    "actionCapabilityRef": "capability:...",
    "approvalGrantRef": null,
    "commitLeaseRef": null,
    "controlLeaseRef": null
  },
  "policy": {
    "allowedActuatorKinds": ["cooperative", "browserInput", "accessibility"],
    "allowPreContactFallback": true
  }
}
```

unknown key, relative state, raw coordinate, raw provider handle, undeclared actuator kind는 fail-closed다. secret
value는 envelope에 넣지 않고 bounded value provider가 effect window 직전에 공급한다.

## 7. TargetBinding

### 7.1 목적

`entityRef`는 관찰 identity일 뿐 provider handle이나 permission이 아니다. Motor는 실행 직전에 entity를
특정 surface의 reachable target과 묶은 단명 `TargetBinding`을 만든다.

```text
space identity
+ world and surface epoch
+ entity semantic invariants
+ provider-local candidate set
+ geometry and hierarchy evidence
+ window, process, origin fence
+ uniqueness verdict
= TargetBinding
```

TargetBinding은 다음을 가진다.

```json
{
  "bindingRef": "binding:...",
  "spaceRef": "space:...",
  "worldRef": "world:...",
  "entityRef": "entity:...",
  "surfaceEpoch": "...",
  "actuatorKind": "windows.uia",
  "invariants": [],
  "uniqueness": "unique",
  "freshUntil": "...",
  "bindingSha256": "sha256:..."
}
```

OS runtime handle, UIA pointer, CDP node ID, browser session ID는 내부 adapter 밖으로 나오지 않는다.

### 7.2 cross-plane binding law

APX entity와 Windows UIA object를 이름 하나나 rectangle 겹침만으로 묶지 않는다. role/control type,
accessible name, semantic state, hierarchy, window/process identity, screen region, current foreground, temporal
epoch을 모두 후보 축으로 사용한다. 선언된 invariant를 모두 만족하는 candidate가 정확히 하나일 때만
`unique`다.

다음은 effect를 보내지 않는다.

- 같은 이름과 role의 candidate가 둘 이상 남음
- browser content와 browser chrome 경계가 불명확함
- window가 바뀌거나 foreground identity가 다름
- geometry와 semantic hierarchy가 충돌함
- surface epoch 이후 navigation 또는 app revision 변경
- visual inference만 target을 지지함
- provider가 stale element 또는 permission denial을 보고함

pixel crop과 OCR은 불명확한 claim을 해소할 수 있지만 `unique` verdict나 permission을 단독으로 만들지 못한다.

## 8. Actuator model과 deterministic broker

### 8.1 actuator 종류

| Actuator | 실제 effect path | 필요한 기반 | 기본 간섭 |
|---|---|---|---|
| `cooperative` | AppSpace의 typed state/action contract | Initiative 6 adapter | shared physical input 없음 |
| `browserInput` | CDP mouse, keyboard, touch, wheel | Native CDP session | isolated browser surface |
| `accessibility` | Windows UIA control pattern | optional native host | target app semantic surface |
| `osInput` | Windows `SendInput` | native host, foreground, ControlLease | shared physical device |
| `replay` | recorded receipt와 terminal 반환 | Initiative 7 exact edge | live effect 없음 |

visual은 actuator 목록에 없다. accessibility action과 OS input도 하나로 합치지 않는다. UIA `Invoke`와
`SendInput`은 effect boundary, user interference, evidence strength가 다르다.

### 8.2 eligibility

후보는 다음 hard constraint를 모두 통과해야 한다.

```text
intent supported
AND exact target binding is unique and fresh
AND provider is installed and healthy
AND origin, process, window, action, risk are allowed
AND required authority references are active
AND required evidence channel is available
AND effect window can be represented
AND provider-specific preconditions hold
```

하나라도 실패하면 점수를 낮추는 것이 아니라 후보에서 제거한다.

### 8.3 선택 규칙

eligible candidate는 공개된 versioned tuple로 정렬한다.

```text
1. exact semantic state operation 가능 여부
2. 추가 authority 없이 실행 가능 여부
3. required postcondition evidence 제공 여부
4. shared user input 비점유 여부
5. configured provider preference
6. stable provider identifier
```

가중치 합산, model confidence, page가 보고한 reliability, 임의 latency 추정은 선택 authority가 아니다.
receipt는 `decisionRuleVersion`, ordered candidates, exclusion reason을 기록한다.

### 8.4 fallback law

fallback은 다음 조건을 모두 만족할 때만 가능하다.

- effect window가 아직 `preContact`다.
- 이전 actuator가 provider effect를 하나도 보내지 않았음을 증명했다.
- intent digest, desired state, entity, world, surface epoch가 같다.
- 기존 ActionCapability, ApprovalGrant, CommitLease, ControlLease 범위를 넓히지 않는다.
- 새 target binding도 exact unique다.
- configured fallback budget 안이다.

`committedGesture`, `applied`, `outcomeUnknown`, changed target, changed origin, user preemption에서는 fallback을
금지한다.

## 9. Authority composition

Motor는 하나의 만능 lease를 만들지 않는다.

| Authority | 소유 Initiative | 답하는 질문 | Motor의 역할 |
|---|---|---|---|
| `ActionCapability` | Initiative 1 | 이 world의 이 entity에 이 intent가 허용됐는가 | exact ref와 epoch 검증 |
| `ApprovalGrant` | Initiative 5 | 이 consequential effect를 누가 승인했는가 | exact intent digest 검증 |
| `CommitLease` | Initiative 5 | live effect를 한 번 보낼 수 있는가 | send boundary에서 소비 |
| `ControlLease` | Initiative 8 | 이 shared input surface를 지금 점유할 수 있는가 | foreground와 user preemption 집행 |

`ControlLease`가 있어도 payment 승인이나 origin permission은 생기지 않는다. 반대로 ApprovalGrant가 있어도
사용자 마우스와 키보드를 점유할 권리는 생기지 않는다.

### 9.1 ControlLease

ControlLease scope는 다음을 포함한다.

- `spaceRef`, application, process, window, target surface
- allowed intent digest 또는 intent class
- exclusive physical device set
- foreground requirement
- origin 또는 app identity fence
- expiry
- cancel-on-user-input
- holder session revision

상태는 `requested`, `active`, `suspended`, `revoked`, `expired`로 제한한다. `suspended`에서 자동 복귀하려면
같은 foreground와 surface epoch를 다시 증명해야 한다. 고위험 effect는 새 live preflight도 통과한다.

### 9.2 user always wins

OS 전역 input을 차단하지 않는다. 실제 사용자 mouse, keyboard, focus change를 감지하면 다음을 수행한다.

```text
preContact
-> stop queued input
-> terminal notSent
-> revoke lease

committedGesture
-> stop new effect segments
-> send only required key-up or pointer-up safety release
-> terminal outcomeUnknown unless evidence proves narrower
-> revoke lease
```

injected event와 physical user event를 구별할 수 없는 환경에서는 user preemption 지원을 주장하지 않고
`osInput` actuator를 disabled로 보고한다.

## 10. ActuationPlan과 effect window

### 10.1 immutable plan

broker는 effect 전에 불변 `ActuationPlan`을 만든다.

```text
intent digest
target binding digest
selected actuator and adapter version
authority refs and expiry
preflight predicates
approach steps
effect boundary definition
committed gesture envelope
safety release
verification predicates
budgets
decision rule version
```

plan을 바꾸면 새 digest와 새 authority validation이 필요하다. effect가 시작된 plan은 수정하거나 재사용하지
않는다.

### 10.2 세 구역

| 구역 | 허용 | 금지 |
|---|---|---|
| `preContact` | observe, align, scroll approach, reacquire same entity, replan, eligible fallback | provider effect |
| `committedGesture` | frozen envelope 안의 remaining segments, bounded feedback, safety release | new target, new actuator, restart, risk escalation |
| `postContact` | settle, observe, verify, seal | 모든 추가 input |

effect boundary는 actuator가 effect를 일으킬 수 있는 첫 provider call 직전 durable하게 기록한다. transport가
끊겨 call delivery를 증명하지 못하면 outcome은 보수적으로 `outcomeUnknown`이다.

### 10.3 intent controller

#### activate

```text
resolve fresh contact region
-> approach without press
-> recheck top target and binding
-> record boundary
-> press
-> release tail
-> observe transition
```

press 이후 target이 바뀌어도 다른 target을 누르지 않는다. release만 수행한다.

#### setValue

semantic setter가 exact value를 제공하면 우선한다. physical typing은 focus, selection, composition strategy,
value redaction, chunk envelope를 effect 전에 고정한다. 첫 mutation 가능 input부터 plan은 frozen이다. 입력 중
observed value를 읽어 남은 승인된 chunk를 줄이거나 일찍 멈출 수는 있지만 clear-and-retype, 다른 input
strategy 전환, target 변경은 새 시도다.

#### setSelected와 setExpanded

live preflight에서 desired state와 이미 같으면 effect 없이 `alreadySatisfied` terminal을 반환한다. 다르면
exact semantic pattern을 우선하고, physical activation은 상태 전이가 evidence로 확인될 때만 confirmed다.

#### scrollTo

실제 scroll owner와 target visibility를 정하고 bounded wheel 또는 gesture envelope를 만든다. scroll은 lazy
network request나 observer effect를 일으킬 수 있으므로 첫 scroll input이 effect boundary다. 이후에는 같은
owner와 direction envelope 안에서만 진행하고 다른 container로 갈아타지 않는다.

#### dragTo

source, destination, path corridor, maximum movement segments, release predicate를 effect 전에 고정한다.
pointer-down 뒤 feedback으로 같은 corridor 안의 step 크기를 조절할 수 있다. 이것은 같은 gesture의 완결이며
fallback이 아니다. source identity, target identity, lease가 깨지면 safety release 뒤 outcomeUnknown으로 끝난다.

slider는 좌표가 아니라 semantic value 오차를 feedback으로 사용한다. drop operation은 exact drop target의
state와 final source relation을 검증한다.

## 11. Provider profiles

### 11.1 Browser Input Actuator

기존 Native CDP actionability, locator, APX geometry, action evidence를 감싼다. 별도 browser driver를 만들지
않는다.

- selector 대신 current TargetBinding을 소비한다.
- center point가 아니라 hit-test를 통과한 bounded contact region을 사용한다.
- nested frame, transform, zoom, viewport scroll을 current geometry에서 계산한다.
- browser protocol과 executable version을 capability report에 기록한다.
- experimental CDP method는 pin과 probe 없이 required path로 사용하지 않는다.
- direct DOM `element.click()`과 raw evaluate는 Motor 기본 actuator가 아니다.
- legacy action은 그대로 유지하며 semantic intent와 fixture reach를 비교한다.

CDP Input은 key, mouse, touch, wheel event와 viewport CSS pixel 좌표를 제공한다. 정확한 method와 experimental
상태는 [Chrome DevTools Protocol Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)을
pin한 browser version과 함께 다시 측정한다.

### 11.2 Cooperative Actuator

Initiative 6 AppSpace adapter가 제공하는 typed state operation을 소비한다.

- 별도 MotorBridge protocol을 만들지 않는다.
- page-reported capability는 candidate일 뿐 authority가 아니다.
- business effect는 outbox, ApprovalGrant, CommitLease를 우회하지 않는다.
- app receipt만으로 confirmed를 만들지 않고 SituationCapsule과 deterministic invariant를 함께 본다.
- Replay에서는 app live method를 호출하지 않는다.

### 11.3 Windows Accessibility Actuator

Windows UIA control pattern을 semantic actuator로 사용한다. Invoke, Value, Toggle, Selection,
ExpandCollapse, RangeValue, Scroll 지원 여부는 control마다 동적일 수 있으므로 action 직전에 다시 묻는다.
공식 control pattern 설명은 [Microsoft UI Automation control patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview)을
기준으로 한다.

- UIA pattern을 Motor intent와 완전히 같은 의미라고 가정하지 않는다.
- pattern call 전후 accessibility state와 APX 또는 provider observation을 대조한다.
- browser page content와 browser chrome의 UIA subtree를 분리한다.
- duplicate name, virtualized item, custom canvas, stale object는 fail-closed다.
- elevated target과 permission denial을 success로 축약하지 않는다.

### 11.4 Windows OS Input Actuator

`SendInput`은 선택된 plan의 physical segments만 전달한다. 공식 API는 input event를 keyboard 또는 mouse
stream에 삽입하고 UIPI 때문에 더 높은 integrity level target으로 보낼 수 없다. 이 경계는
[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)을
정본으로 삼고 실제 Windows fixture로 다시 확인한다.

필수 계약:

- foreground window, process identity, integrity boundary, DPI, monitor, keyboard state를 preflight한다.
- raw coordinate와 raw key sequence를 public caller에게 받지 않는다.
- ControlLease와 exact ActuationPlan 없이는 input을 거부한다.
- multi-monitor와 negative origin을 포함한 coordinate transform을 host가 소유한다.
- event batch 사이 physical user input을 감지한다.
- failure와 cancellation에서 pressed key와 pointer를 release한다.
- UIPI 원인을 직접 판별할 수 없으면 정확한 원인을 꾸미지 않고 provider rejection으로 남긴다.

### 11.5 DelegatedTabSpace

사용자가 실제로 연 현재 tab은 Manifest V3 extension과 native host를 통해서만 bounded provider가 된다.

- `activeTab`과 `scripting`만 기본으로 요구한다.
- extension action, context menu, keyboard shortcut 같은 user gesture가 lease를 연다.
- same-origin navigation에서는 epoch을 갱신하고 재검증한다.
- 다른 origin navigation과 tab close에서 authority를 revoke한다.
- `<all_urls>`와 `debugger` permission을 기본 요구하지 않는다.
- network body, cookie value, credential, browser chrome을 수집하지 않는다.
- extension content는 untrusted sensor이며 host policy를 넓히지 않는다.

Chrome은 `activeTab`을 user invocation 뒤 현재 tab에 임시 부여하고 다른 origin navigation 또는 tab close에서
회수한다. 세부 경계는 [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)을
따른다.

## 12. Native host 제품 경계

native host는 기본 npm runtime의 일부가 아니다. `pyproc-control`의 명시적 setup command가 platform release
asset을 설치하고 digest, signature, version, supported protocol을 검증한다. 새 npm bin은 추가하지 않는다.

권장 구현은 작은 Rust executable과 platform adapter다. 언어 선택보다 다음 contract가 우선한다.

```text
no network listener
one parent-owned stdio or native-messaging channel
single-use bootstrap capability
strict length-prefixed messages
unknown field and operation rejection
exact process and window allowlist
plan digest and lease verification
no arbitrary shell, file, registry, clipboard, raw input RPC
bounded shutdown and pressed-input cleanup
signed release asset and pinned digest
```

native host는 Machine guest가 아니며 Machine image에 포함되지 않는다. Execution Memory handoff는 required
provider capability와 version만 기록하고, 새 device에서는 설치와 permission을 다시 확인한다.

기본 browser-only profile은 host를 download, install, spawn하지 않는다. host 제거 뒤 stale registration과
extension mapping도 정리한다.

## 13. ActuationReceipt와 replay

ActuationReceipt는 기존 evidence를 복사한 큰 log가 아니다. plan에서 terminal까지의 lineage manifest다.

```json
{
  "protocol": "pyproc-actuation",
  "version": 1,
  "actuationRef": "actuation:...",
  "intentSha256": "sha256:...",
  "bindingSha256": "sha256:...",
  "planSha256": "sha256:...",
  "authorityRefs": {},
  "decision": {
    "ruleVersion": 1,
    "selectedActuator": "windows.uia",
    "excluded": []
  },
  "effectWindow": {
    "boundary": "uia.invoke",
    "crossed": true,
    "completedSegments": []
  },
  "terminal": "confirmed",
  "actionEvidenceRef": "evidence:...",
  "effectReceiptRef": null,
  "replayEdgeRef": null,
  "receiptSha256": "sha256:..."
}
```

terminal vocabulary는 기존 `confirmed`, `contradicted`, `ambiguous`, `notObserved`, `outcomeUnknown`과 transport
outcome을 잃지 않는다. `alreadySatisfied`는 effect를 보내지 않은 semantic terminal이며 receipt에
`effectWindow.crossed: false`를 기록한다.

기록 금지:

- password, payment card, credential, cookie, authorization value
- raw request와 response body
- OS handle, UIA pointer, CDP object와 node ID
- unredacted local path와 window content
- native bootstrap capability
- typed secret value와 clipboard content

ReplaySpace와 ReplayGraph는 exact intent, binding, plan digest가 맞을 때 recorded receipt와 terminal을 반환한다.
native host spawn, browser provider call, AppSpace live call, OS permission prompt는 모두 0이어야 한다. graph에
없는 plan result를 생성하지 않는다.

## 14. Evidence-backed self-correction과 성장

### 14.1 성장의 정확한 의미

Motor의 성장은 실행 도중 임의로 코드를 바꾸거나 다음 action을 즉흥적으로 시도하는 것이 아니다. 두 개의
시간축을 분리한다.

```text
한 실행 안
= current observation으로 preContact 오차를 보정
+ frozen committedGesture를 안전하게 완결

실행 사이
= immutable episode를 축적
+ 반복 실패와 robustness pattern을 분류
+ correction candidate를 effect 없이 비교
+ 검증된 policy revision만 다음 실행에 적용
```

한 execution이 시작되면 `ActuationPolicyRevision`을 pin한다. 실행 중 새 evidence가 들어와도 global policy를
바꾸지 않는다. preContact replan은 pinned revision의 허용 범위에서만 일어나며, episode에서 만든 새 교정은
다음 execution부터 적용할 수 있다.

runtime은 설치된 자기 source, native binary, extension을 스스로 수정하거나 배포하지 않는다. code-level
결함은 `EngineeringFinding`과 Evidence Pack으로 내보내 Initiative 2의 Verified Change Loop가 source change,
negative gate, release를 담당한다. runtime policy 성장과 제품 코드 진화를 같은 권한으로 섞지 않는다.

### 14.2 ActuationEpisode

성장의 원재료는 자유 형식 log가 아니라 canonical `ActuationEpisode`다. 성공, `notSent`, `rejected`,
`ambiguous`, `outcomeUnknown`, user preemption을 모두 남긴다.

```json
{
  "episodeRef": "episode:...",
  "intentSha256": "sha256:...",
  "worldRef": "world:...",
  "bindingSha256": "sha256:...",
  "planSha256": "sha256:...",
  "policyRevisionSha256": "sha256:...",
  "provider": {
    "kind": "browserInput",
    "version": "...",
    "environmentSha256": "sha256:..."
  },
  "timeline": [],
  "corrections": [],
  "terminal": "confirmed",
  "failurePoint": null,
  "robustnessSignals": [],
  "evidenceRefs": [],
  "receiptSha256": "sha256:...",
  "redactionManifestSha256": "sha256:...",
  "episodeSha256": "sha256:..."
}
```

episode는 ActuationReceipt를 복사하지 않고 참조한다. timeline은 phase, invariant verdict, bounded feature,
provider call boundary, correction type을 기록하며 raw DOM, raw accessibility tree, full screenshot, input value,
window content를 기본 저장하지 않는다.

### 14.3 실패 지점

실패를 마지막 error code 하나로 남기지 않는다. `failurePoint`는 처음 관찰된 divergence를 보존한다.

```json
{
  "phase": "preContact",
  "component": "targetBinding",
  "invariant": "singleTopHitTarget",
  "expectedDigest": "sha256:...",
  "observedDigest": "sha256:...",
  "evidenceRef": "evidence:...",
  "causeState": "observed",
  "recoverability": "replanBeforeEffect"
}
```

분류 vocabulary:

| component | 대표 실패 |
|---|---|
| `perception` | required fact unknown, stale, conflicted |
| `binding` | duplicate candidate, epoch change, hierarchy mismatch |
| `broker` | eligible actuator 없음, evidence capability 부족 |
| `authority` | expired capability, approval mismatch, revoked ControlLease |
| `alignment` | occlusion, coordinate drift, wrong foreground |
| `controller` | correction budget 소진, gesture envelope 위반 위험 |
| `provider` | CDP, UIA, OS call rejection 또는 capability loss |
| `environment` | browser death, native host crash, permission change |
| `verification` | transition contradicted, ambiguous, not observed |

처음 어긋난 지점은 자동으로 root cause라고 부르지 않는다. 직접 evidence가 있으면 `observed`, 여러 증거로
규칙 기반 attribution을 통과하면 `attributed`, 그렇지 않으면 `unknown`이다. 시간상 먼저 일어났다는 이유로
page mutation이나 network event를 원인으로 확정하지 않는다.

### 14.4 강화 지점

평범한 성공을 모두 강화 신호로 세면 쉬운 journey가 policy를 지배한다. `RobustnessSignal`은 실제 perturbation
또는 대안과의 대조가 있었고 안전 invariant를 지킨 경우만 기록한다.

예:

- target이 effect 전에 이동했고 같은 entity를 exact하게 reacquire함
- overlay가 contact를 막아 effect를 보내지 않고 다른 safe region을 찾음
- preferred actuator가 `notSent`로 끝나 같은 authority 안의 fallback이 성공함
- desired state가 이미 만족돼 provider effect를 생략함
- user preemption에서 새 effect를 멈추고 required safety release만 보냄
- stronger evidence path가 false confirmation을 막음
- ReplayGraph 대조에서 candidate policy가 같은 terminal을 더 작은 probe set으로 증명함

각 signal은 perturbation, preserved invariant, alternative plan digest, evidence ref를 가진다. 단순 completion,
짧은 latency, page가 보고한 success, `outcomeUnknown`은 positive label이 아니다.

### 14.5 학습 가능한 것과 고정할 것

| 영역 | 자동 교정 후보 | 제한 |
|---|---|---|
| probe scheduling | 같은 required evidence를 얻는 sensor 순서 | trust와 completeness 하한 유지 |
| actuator ordering | hard eligibility를 모두 통과한 후보의 tie-break | semantic fidelity, authority, evidence 선행 순서 유지 |
| approach | contact region과 preContact path heuristic | TargetBinding과 top-hit invariant 유지 |
| gesture segmentation | drag step과 text chunk envelope | plan 최대 범위와 safety release 유지 |
| budget allocation | probe, correction, settle budget 배분 | manifest 상한과 effect window 유지 |
| provider capability cache | version별 support와 rejection history | live preflight 생략 금지 |
| failure probe | 반복 failure cluster의 추가 read-only 진단 | secret capture와 authority 확대 금지 |

다음은 immutable safety constitution이며 학습 대상이 아니다.

- allowed origin, process, window, action, risk
- ActionCapability, ApprovalGrant, CommitLease, ControlLease 요구
- TargetBinding exact uniqueness와 stale 판정
- effect boundary와 post-send non-retry
- user always wins와 safety release
- secret redaction과 artifact retention ceiling
- Replay의 live effect 0
- native host operation allowlist와 listener 금지

학습 가능한 항목도 manifest 범위를 넓히지 못한다. 기존 required invariant를 제거하거나 threshold를 느슨하게
하는 proposal은 schema 단계에서 거부한다. 더 엄격한 read-only probe를 추가하는 것은 허용할 수 있다.

### 14.6 CorrectionProposal

episode miner는 실패를 바로 policy로 만들지 않고 immutable proposal을 만든다.

```json
{
  "proposalRef": "correction:...",
  "basePolicySha256": "sha256:...",
  "scope": {
    "providerKind": "browserInput",
    "providerVersion": "...",
    "appIdentitySha256": "sha256:..."
  },
  "triggerEpisodeRefs": [],
  "hypothesis": {
    "changeKind": "probeOrder",
    "fromSha256": "sha256:...",
    "toSha256": "sha256:..."
  },
  "expectedImprovement": "avoidOccludedContact",
  "protectedInvariants": [],
  "evaluationManifestSha256": "sha256:..."
}
```

natural language explanation은 사람이 읽는 부가 정보이며 실행 가능한 change가 아니다. 실행 후보는 strict
typed patch만 허용한다. page content, model output, single episode는 스스로 proposal을 promote하지 못한다.

scope는 provider kind와 exact version, app identity 또는 fixture family, environment boundary에 묶인다.
한 origin에서 얻은 heuristic을 다른 origin이나 native application에 기본 전파하지 않는다. cross-scope
promotion에는 공통 invariant fixture가 별도로 필요하다.

### 14.7 Policy Lab과 promotion

```text
collect redacted episodes
-> cluster by exact failure vocabulary and scope
-> produce typed CorrectionProposal
-> reject constitution changes
-> replay exact historical episodes
-> traverse relevant ReplayGraph branches
-> run adversarial and negative fixtures
-> compare against pinned base policy
-> publish immutable candidate revision
-> run effect-free shadow evaluation
-> promote or reject with canonical verdict
```

evaluation은 성공 episode만 다시 재생하지 않는다. proposal의 scope와 맞는 failure, success, ambiguity,
outcomeUnknown, user preemption episode를 모두 포함한다. graph coverage gap은 candidate failure와 분리한다.

promotion class:

1. `localTactic`: read-only probe order와 effect 전 approach처럼 provider effect 의미를 바꾸지 않는 교정이다.
   complete replay와 negative fixture가 green이면 자동 promotion할 수 있다.
2. `effectTactic`: gesture segmentation, actuator tie-break처럼 실제 provider call sequence를 바꿀 수 있다.
   installed provider conformance와 signed repository policy revision이 필요하다.
3. `constitution`: authority, target uniqueness, effect boundary, non-retry, user precedence, redaction 변경이다.
   runtime proposal과 자동 promotion을 모두 금지한다. 명시적 제품 설계 변경과 전체 security review만 가능하다.

새 revision은 previous revision, proposal set, episode corpus manifest, evaluation result, gate digest를 연결한다.
mutable HEAD는 CAS로만 이동하며 evaluation 중 base가 바뀌면 promotion을 다시 시작한다.

### 14.8 deterministic growth와 rollback

같은 canonical episode corpus, base policy, evaluation manifest는 같은 proposal input과 promotion verdict digest를
만들어야 한다. optional model이 failure explanation이나 candidate를 제안할 수는 있지만 output은 `inferred`
provenance를 가지며 typed compiler, replay, negative gate를 모두 통과해야 한다. model text 자체는 policy가
아니다.

promotion 뒤 regression이 관찰되면 current execution을 중간에 바꾸지 않는다. 새 effect를 멈출 수 있는
기존 안전 규칙을 지키고, 다음 execution의 policy HEAD를 last-known-good revision으로 CAS rollback한다.
rollback 이유와 affected episode를 새 revision event로 남기며 과거 log를 덮어쓰지 않는다.

### 14.9 poisoning, privacy, retention

- positive signal은 verified evidence와 deterministic oracle가 있는 episode에서만 온다.
- `contradicted`, `ambiguous`, `notObserved`, `outcomeUnknown`을 성공으로 학습하지 않는다.
- page text, accessibility label, cooperative description, visual inference가 label이나 policy를 만들지 못한다.
- corpus는 origin, app identity, user trust domain, provider version별로 격리한다.
- secret은 episode 생성 전에 redact하며 hash만으로 low-entropy secret을 보존하지 않는다.
- screenshot과 crop은 default corpus에 넣지 않고 explicit artifact policy와 TTL을 따른다.
- user가 삭제한 episode와 artifact는 future corpus manifest에서 제외하고 reachable retention을 다시 계산한다.
- imported episode는 provenance와 signature를 검증해도 local authority나 automatic promotion 권한을 얻지 않는다.
- 한 source가 반복 event를 보내 support를 부풀리지 못하게 source와 journey identity를 보존한다.

### 14.10 성장 결과의 공개 형태

사용자에게는 막연한 "더 똑똑해짐" 대신 다음을 보여준다.

```text
failure cluster
affected provider and scope
first divergence and evidence
proposed tactical change
replay and fixture coverage
protected invariant verdict
base and candidate policy digest
promotion, rejection, rollback reason
```

성능 수치와 raw episode corpus는 test artifact에 둔다. 공개 제품 문서는 capability만 말한다. 즉 Motor는
실패를 기억하고 검증된 전술을 승격할 수 있지만, permission이나 안전 경계를 경험적으로 타협하지 않는다.

## 15. Public surface 후보

공개 root는 계속 `Machine`이고 installed entrance는 `pyproc/control`, `pyproc-control`, `pyproc-mcp`다.
Initiative 8은 새 npm root value export, subpath, executable identity를 만들지 않는다.

browser milestone은 기존 operation을 사용한다.

```text
automation.observe
automation.act
```

두 live provider가 같은 intent와 receipt conformance를 통과한 뒤 다음 optional operation family를 attempt에서
최종 판정한다.

```text
actuation.space.inspect
actuation.observe
actuation.lease.acquire
actuation.perform
actuation.lease.release
```

성장 상태는 effect authority와 분리한 read-only diagnostic 후보로 둔다.

```text
actuation.experience.list
actuation.experience.inspect
actuation.policy.inspect
actuation.policy.evaluate
```

일반 action caller와 page는 policy HEAD를 promote하지 못한다. `localTactic` promotion은 strict local policy
engine만 수행하고 `effectTactic`은 signed repository policy revision을 요구한다. episode를 보거나 삭제할
권한도 execution authority와 별도 manifest scope다.

wire를 고정하기 전 필수 질문:

1. 기존 `automation.act`에 intent action을 넣어도 browser client compatibility가 보존되는가.
2. desktop observation이 APX SituationCapsule을 그대로 사용할 수 있는가, 별도 profile이 필요한가.
3. Control Protocol v1의 operation discovery로 additive operation을 안전하게 표현할 수 있는가.
4. MCP에서 새 tool 없이 기존 action input을 확장할 수 있는가, 아니면 computer-wide tool 하나가 더
   정직한가.
5. JavaScript와 Python facade가 wire terminal과 error detail을 손실 없이 보존하는가.

provider가 하나뿐인 동안 범용 `MotorSpace` wire를 stable로 선언하지 않는다. 그러나 internal pure schema와
conformance는 첫 probe부터 provider-neutral하게 만든다.

## 16. 오류와 outcome

오류 문구보다 `code`, `outcome`, `retryable`, `effectWindow.crossed`, `safetyRelease.sent`가 정본이다.

| 오류 family | 의미 | 기본 outcome |
|---|---|---|
| `ACTUATION_INTENT_INVALID` | intent 또는 desired state가 strict schema를 위반 | `notSent` |
| `ACTUATION_TARGET_STALE` | world, surface epoch, binding이 바뀜 | `notSent` |
| `ACTUATION_TARGET_AMBIGUOUS` | exact unique target을 만들 수 없음 | `notSent` |
| `ACTUATION_AUTHORITY_REQUIRED` | capability, approval, commit, control authority 부족 | `notSent` |
| `ACTUATION_ACTUATOR_UNAVAILABLE` | eligible actuator가 없음 | `notSent` |
| `ACTUATION_PREFLIGHT_FAILED` | foreground, state, geometry, policy 불일치 | `notSent` |
| `ACTUATION_CONTROL_REVOKED` | user input 또는 surface change로 lease 회수 | 단계별 |
| `ACTUATION_GESTURE_ABORTED` | committed gesture를 완결할 수 없음 | `outcomeUnknown` |
| `ACTUATION_PROVIDER_REJECTED` | provider가 effect call을 거부 | `rejected` |
| `ACTUATION_OUTCOME_UNKNOWN` | boundary 뒤 결과를 증명할 수 없음 | `outcomeUnknown` |
| `ACTUATION_VERIFICATION_AMBIGUOUS` | observed evidence가 postcondition을 닫지 못함 | `applied`와 `ambiguous` 보존 |
| `ACTUATION_NATIVE_INTEGRITY` | host digest, signature, protocol 불일치 | `notSent` |
| `ACTUATION_POLICY_STALE` | plan 전에 pinned policy HEAD가 바뀜 | `notSent` |
| `ACTUATION_POLICY_REJECTED` | correction candidate가 constitution 또는 evaluation gate를 위반 | live effect 없음 |

boundary 뒤 오류는 retryable이 아니다. caller가 새 intent를 만들려면 먼저 external state를 조사하고 별도
approval policy를 통과해야 한다.

episode 저장 실패는 이미 일어난 effect outcome을 바꾸지 않는다. original terminal을 보존하고
`experienceState: "incomplete"`와 저장 오류를 함께 반환하며, 불완전 episode는 학습 corpus에 들어가지 않는다.
logging failure를 이유로 action을 다시 보내지 않는다.

## 17. 보안 모델

### 17.1 위협

1. page text와 accessibility label이 instruction 또는 authority처럼 보임
2. overlay와 duplicate control이 target을 바꿈
3. browser content 대신 chrome 또는 다른 window가 선택됨
4. fallback이 더 높은 risk 또는 더 넓은 OS authority로 상승함
5. physical user input과 injected input이 충돌함
6. effect가 적용됐지만 transport가 끊겨 재시도됨
7. cooperative app이 capability나 receipt를 위조함
8. native host가 raw input daemon 또는 arbitrary RPC bridge로 악용됨
9. extension이 persistent host permission 또는 signed-in data를 과도하게 수집함
10. receipt와 trace에 secret, local path, screen content가 남음
11. replay가 live actuator를 다시 호출함
12. imported Machine 또는 handoff가 native permission을 함께 옮김
13. malicious page 또는 반복 journey가 positive episode와 support를 위조함
14. correction proposal이 안전 invariant를 optimization 대상으로 바꿈
15. live execution 중 policy가 교체돼 plan 의미가 달라짐

### 17.2 방어

- page와 visual claim을 untrusted evidence로 유지한다.
- TargetBinding uniqueness와 authority를 분리한다.
- hard eligibility 실패를 score로 상쇄하지 않는다.
- cross-plane escalation은 explicit allowlist와 새 authority 없이는 금지한다.
- effect 전에 plan과 boundary를 durable하게 고정한다.
- CommitLease와 ControlLease를 서로 대체하지 않는다.
- user input을 막지 않고 preemption과 safety release를 구현한다.
- native host에 network listener, shell, raw input RPC를 두지 않는다.
- extension은 `activeTab` user gesture와 exact origin epoch에 묶는다.
- provider handle과 secret을 public receipt에서 제거한다.
- replay provider는 live adapter dependency를 가지지 않는다.
- installed asset digest와 protocol version mismatch를 실행 전에 거부한다.
- positive signal은 verified evidence와 deterministic oracle에서만 만든다.
- experience corpus를 origin, app, trust domain, provider version으로 격리한다.
- constitution validator가 authority와 effect safety field의 proposal patch를 거부한다.
- execution 시작 시 policy revision을 pin하고 promotion은 다음 execution에만 적용한다.

## 18. 폴더와 모듈 책임 후보

신규 구현은 먼저 `tests/attempts/proofCarryingMotor/`에서만 작성한다. 졸업 전 본진 후보는 다음과 같다.

```text
scripts/
`-- actuation/
    |-- actuationIntent.js
    |-- targetBinding.js
    |-- actuationPlan.js
    |-- actuatorBroker.js
    |-- controlLease.js
    |-- effectWindow.js
    |-- servoController.js
    |-- actuationReceipt.js
    |-- actuationErrors.js
    |-- experience/
    |   |-- actuationEpisode.js
    |   |-- experienceLedger.js
    |   |-- failureClassifier.js
    |   |-- correctionProposal.js
    |   |-- policyRevision.js
    |   `-- policyLab.js
    `-- adapters/
        |-- browserInputActuator.js
        |-- appSpaceActuator.js
        |-- replayActuator.js
        `-- nativeHostActuator.js

native/
`-- motorHost/
    |-- Cargo.toml
    |-- Cargo.lock
    `-- src/
        |-- main.rs
        |-- protocol.rs
        |-- lease.rs
        |-- safetyRelease.rs
        `-- windows/
            |-- accessibility.rs
            |-- input.rs
            |-- window.rs
            |-- coordinate.rs
            `-- userActivity.rs

extensions/
`-- delegatedTab/
    |-- manifest.json
    |-- serviceWorker.js
    |-- contentSensor.js
    `-- nativeBridge.js
```

dependency 방향:

```text
pure intent, binding, plan, receipt
<- injected actuator interfaces
<- provider adapters
<- Control and MCP facade
```

pure broker는 CDP, UIA, extension, native process를 import하지 않는다. adapter가 기존 Perception,
AutomationSpace, AppSpace, Rehearse-Commit, ReplayGraph 계약을 주입받는다. provider별 flag를 transaction이나
perception core에 퍼뜨리지 않는다. experience layer는 receipt와 evidence를 읽을 수 있지만 provider effect를
호출하거나 source와 installed asset을 쓸 수 없다.

## 19. 구현 단계

### M0. Contract audit와 negative schema

- 기존 browser action catalog와 ActionEvidence effect boundary inventory
- Initiative 1과 5의 authority object 매핑
- absolute intent, TargetBinding, ActuationPlan, ActuationReceipt, ActuationEpisode pure schema
- weighted score와 relative verb rejection fixture
- 기존 action reach baseline lock

완료 조건:

- 중복 소유 object 0
- unknown key, raw coordinate, raw handle 수락 0
- canonical digest nondeterminism 0
- 기존 APX와 Control wire 변경 0

### M1. Browser activate와 deterministic broker

- Browser Input adapter
- exact contact region과 live top target preflight
- hard eligibility와 deterministic decision tuple
- activate effect window
- legacy click parity fixture

완료 조건:

- pinned baseline action reach 손실 0
- stale 또는 ambiguous target effect 0
- press 뒤 fallback과 second press 0
- receipt decision과 provider trace 재현

### M2. Desired-state controllers

- `setValue`, `setSelected`, `setExpanded`
- already-satisfied no-effect terminal
- controlled input, contenteditable, range, masked value fixture
- secret redaction

완료 조건:

- relative-state wire 0
- already-satisfied provider effect 0
- observed final semantic state mismatch confirmed 0
- sensitive value receipt와 recording 유출 0

### M3. Scroll과 drag effect window

- scroll owner resolution
- bounded scroll envelope
- drag path corridor와 feedback
- pointer and key safety release
- user cancellation state machine simulator

완료 조건:

- wrong scroll owner effect 0
- pointer-down 뒤 actuator switch와 gesture restart 0
- aborted gesture의 stuck pointer와 key 0
- target drift outcome 축약 0

### M4. Experience ledger와 Policy Lab

- content-addressed ActuationEpisode와 redaction manifest
- first divergence와 failure taxonomy
- evidence-backed RobustnessSignal
- typed CorrectionProposal
- policy constitution validator
- ReplayGraph와 fixture evaluation manifest
- immutable ActuationPolicyRevision과 CAS HEAD
- deterministic promotion, rejection, rollback receipt

완료 조건:

- 모든 terminal의 episode 누락 0
- secret, raw provider handle, raw page content의 episode 유출 0
- normal success와 outcomeUnknown positive label 0
- safety constitution을 바꾸는 proposal 수락 0
- same corpus, base, evaluation manifest의 verdict digest 차이 0
- replay coverage gap을 candidate failure로 축약 0
- runtime source와 installed asset 자기 수정 0

### M5. Cooperative와 Replay conformance

- AppSpace adapter
- Rehearse-Commit authority composition
- ReplayGraph exact plan edge
- cross-provider receipt conformance

완료 조건:

- AppSpace가 approval과 outbox를 우회한 effect 0
- cooperative self-report only confirmed 0
- replay live call 0
- same intent terminal vocabulary divergence 0

### M6. Windows read-only binding

- native host framing과 bootstrap integrity
- UIA tree와 control pattern discovery
- process, window, foreground, DPI, monitor report
- APX to UIA cross-plane TargetBinding
- duplicate, virtualized, elevated target negative fixture

완료 조건:

- native network listener와 arbitrary RPC 0
- ambiguous binding effect capability 발급 0
- raw OS handle public leak 0
- unsupported pattern을 available로 보고한 횟수 0

### M7. Windows semantic accessibility action

- Invoke, Value, Selection, ExpandCollapse, RangeValue, Scroll adapter
- dynamic pattern recheck
- accessibility before and after evidence
- browser page와 native app same-intent journey

완료 조건:

- pattern mismatch confirmed 0
- stale UIA object automatic retry 0
- browser와 Windows terminal envelope 차이 0
- permission denial 축약 0

### M8. Windows physical input와 ControlLease

- `SendInput` segments
- coordinate transform과 calibration proof
- physical user activity detection
- foreground loss와 window substitution
- safety release

완료 조건:

- ControlLease 없는 input 0
- stale calibration과 wrong foreground input 0
- user preemption 뒤 새 effect segment 0
- required safety release 누락 0
- UIPI failure를 success로 보고한 횟수 0

### M9. DelegatedTabSpace

- Manifest V3 extension
- `activeTab` user gesture
- origin and tab epoch lease binding
- content sensor와 native host handshake
- signed-in bounded fixture journey

완료 조건:

- gesture 전 tab access 0
- cross-origin navigation과 tab close 뒤 access 0
- `<all_urls>`와 debugger 기본 permission 0
- extension content가 host authority를 넓힌 횟수 0

### M10. Product entrance와 installed gates

- optional manifest와 doctor report
- existing `pyproc-control` setup and removal command
- Control, JavaScript, Python, MCP parity
- native asset provenance, signature, digest, SBOM
- browser-only no-native golden journey
- Windows installed Motor golden journey

완료 조건:

- 새 root export, subpath, bin 0
- default install의 native spawn과 permission prompt 0
- client별 receipt digest 차이 0
- stale 또는 tampered native asset 실행 0
- uninstall 뒤 registration과 host residue 0

## 20. 실험 캠페인

모든 신규 코드는
[Initiative 8 attempt](../../tests/attempts/proofCarryingMotor/)에서 시작한다.

### 20.1 fixture family

1. moving target, overlay, tooltip, rerender, duplicate accessible name
2. nested frame, shadow root, transform, zoom, nested scroll owner
3. pointer-down 즉시 effect와 post-send transport loss
4. controlled input, contenteditable, format mask, composition, secret field
5. checkbox, list selection, disclosure, range, already-satisfied state
6. moving drop zone, slider, drag cancellation, pointer release
7. cooperative app capability, outbox, forged receipt, stale app revision
8. ReplayGraph exact plan, missing plan edge, coverage gap
9. Win32, WPF, browser UIA, virtualized list, custom canvas
10. high DPI, multi-monitor, negative origin, moved window, stolen foreground
11. physical user mouse and keyboard between effect segments
12. UIPI-denied elevated target and native host crash
13. activeTab same-origin navigation, cross-origin navigation, tab close
14. forged extension message, stale bootstrap capability, tampered native asset
15. repeated occlusion, provider rejection, false confirmation, user preemption, poisoned episode corpus

### 20.2 필수 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `intentSchemaProbe.mjs` | absolute intent가 canonical한가 | relative verb와 raw input 수락 0 |
| `brokerDecisionProbe.mjs` | 같은 후보가 같은 route를 고르는가 | weighted score authority 0 |
| `targetBindingProbe.mjs` | cross-plane target이 exact unique한가 | name 또는 rect 단독 binding 0 |
| `activateWindowProbe.html` | contact 전 보정과 contact 후 동결이 지켜지는가 | second press와 fallback 0 |
| `valueStateProbe.html` | desired state를 exact하게 닫는가 | stale toggle 0 |
| `dragEnvelopeProbe.html` | 한 gesture 안에서만 feedback하는가 | restart와 new target 0 |
| `controlLeaseProbe.mjs` | user가 physical control을 회수하는가 | preemption 뒤 effect segment 0 |
| `safetyReleaseProbe.mjs` | 중단이 stuck input을 남기지 않는가 | key-up 또는 pointer-up 누락 0 |
| `cooperativeAdapterProbe.html` | AppSpace authority를 재사용하는가 | approval 우회 0 |
| `replayActuatorProbe.mjs` | exact receipt를 effect 없이 재생하는가 | provider call 0 |
| `windowsUiaProbe.mjs` | semantic Windows action이 같은 intent인가 | unsupported pattern success 0 |
| `windowsInputProbe.mjs` | foreground input이 lease와 plan에 묶이는가 | raw coordinate RPC 0 |
| `coordinateTransformProbe.mjs` | monitor와 DPI 변환이 exact한가 | stale transform input 0 |
| `delegatedTabProbe.mjs` | user gesture와 origin epoch가 권한인가 | cross-origin access 0 |
| `nativeIntegrityProbe.mjs` | host와 protocol provenance가 검증되는가 | tampered binary 실행 0 |
| `clientParityProbe.mjs` | 모든 client가 같은 receipt를 보존하는가 | digest와 outcome 차이 0 |
| `episodeLedgerProbe.mjs` | 모든 terminal과 correction을 보존하는가 | missing terminal과 secret 원문 0 |
| `failureAttributionProbe.mjs` | first divergence와 root cause를 구분하는가 | temporal correlation을 observed cause로 승격 0 |
| `policyPromotionProbe.mjs` | candidate가 replay와 음성 시험을 통과하는가 | safety regression promotion 0 |
| `experiencePoisoningProbe.mjs` | untrusted corpus가 policy를 오염시키지 않는가 | page label과 imported authority 0 |
| `policyRollbackProbe.mjs` | regression 뒤 last-known-good로 돌아가는가 | active execution policy 교체 0 |

실제 native effect가 필요한 probe는 explicit test fixture process와 isolated test account만 대상으로 한다.
임의 desktop application과 실제 consequential endpoint를 시험 대상으로 사용하지 않는다.

## 21. 졸업 gate

1. pinned browser baseline의 fixture action reach 손실은 0이다.
2. cooperative, browser input, Windows accessibility, Windows OS input이 같은 absolute intent와 semantic
   terminal을 반환한다.
3. ambiguity, stale binding, window substitution 뒤 wrong target effect는 0이다.
4. visual, page content, accessibility label, weighted score가 target uniqueness나 authority를 만든 횟수는 0이다.
5. effect window 뒤 actuator fallback, new target, gesture restart는 0이다.
6. 한 CommitLease의 consequential live send는 최대 1이다.
7. ControlLease 없는 OS input과 lease scope 밖 process, window input은 0이다.
8. physical user preemption 뒤 새 effect segment는 0이고 required safety release 누락도 0이다.
9. already-satisfied intent의 provider effect는 0이다.
10. replay와 ReplayGraph traversal의 browser, app, native live call은 0이다.
11. native host의 listener, arbitrary shell, raw input public RPC, unrestricted target은 0이다.
12. delegated tab의 user gesture 전, origin 변경 뒤, close 뒤 접근은 0이다.
13. secret value, OS handle, provider object, bootstrap capability의 receipt와 recording 유출은 0이다.
14. ActuationReceipt가 intent, binding, plan, authority, route, effect window, terminal, evidence를 모두 연결한다.
15. 기본 browser-only product journey는 native install과 permission 없이 green이다.
16. installed Windows journey와 Control, JavaScript, Python, MCP client가 같은 canonical receipt digest를
    반환한다.
17. 모든 terminal이 redacted ActuationEpisode를 남기고 failure phase, first divergence, correction,
    robustness signal, evidence를 보존한다.
18. `confirmed`가 아니거나 deterministic evidence가 없는 episode가 positive label이 된 횟수는 0이다.
19. proposal의 replay와 negative fixture 이전 promotion, graph coverage gap을 success로 축약한 횟수는 0이다.
20. policy revision이 authority, target uniqueness, effect boundary, non-retry, user precedence, redaction을
    바꾼 횟수는 0이다.
21. 같은 corpus, base policy, evaluation manifest의 proposal input, verdict, promoted revision digest 차이는
    0이다.
22. runtime이 source, native binary, extension을 직접 수정하거나 imported episode가 local promotion
    authority를 얻은 횟수는 0이다.

hosted model의 성공률과 completion time은 보조 artifact로만 기록한다. 졸업은 deterministic fixture,
provider conformance, negative gate가 판정한다.

## 22. 문서 정합

- `docs/specs/actuation/README.md`
- `docs/usage/actuation.md`
- `docs/usage/browserAutomation.md`
- `docs/usage/automationSpace.md`
- `docs/usage/rehearseCommit.md`
- `docs/usage/appSpace.md`
- `docs/usage/replayGraph.md`
- `docs/usage/executionMemory.md`
- `docs/usage/experienceVerification.md`
- `docs/usage/trustPermissions.md`
- `docs/usage/controlProtocol.md`
- `docs/usage/javascriptControl.md`
- `docs/usage/pythonSdk.md`
- `docs/usage/capabilityMatrix.md`
- `docs/reference/api.md`
- `docs/operations/moduleBoundaries.md`
- `docs/operations/contractReality.md`
- `docs/operations/assetProvenance.md`
- `docs/product/vision.md`
- `README.md`, `README.ko.md`
- `SECURITY.md`

Windows native host를 출하하면 build recipe, dependency lock, license inventory, SBOM, signature, release asset
digest, supported OS boundary를 같은 변경에서 문서화한다.

## 23. 실패 조건

- raw coordinate와 low-level input sequence가 canonical public API가 되면 실패다.
- visual fallback을 actuator로 만들거나 pixel inference가 authority를 만들면 실패다.
- `toggle` 같은 relative action을 exact desired state 없이 wire에 넣으면 실패다.
- weighted score가 hard policy failure나 target ambiguity를 상쇄하면 실패다.
- InputLease 하나가 action permission, business approval, physical device control을 모두 대신하면 실패다.
- drag를 이유로 effect 뒤 target 또는 actuator를 바꾸거나 gesture를 재시작하면 실패다.
- user input을 막거나 사용자와 input 경쟁에서 이겨야 journey가 green이면 실패다.
- cooperative action이 Initiative 5 approval이나 Initiative 6 outbox를 우회하면 실패다.
- native host가 listener, shell, arbitrary process control, raw input daemon이 되면 실패다.
- extension이 user gesture 없이 default profile 또는 broad origin authority를 얻으면 실패다.
- replay가 live provider를 호출하거나 missing result를 생성하면 실패다.
- 한 provider만 통과한 상태에서 범용 multi-plane 표준이라고 주장하면 실패다.
- macOS와 Linux를 문서상 지원으로만 추가하면 실패다.
- Playwright 호환과 anti-detection이 core scope를 밀어내면 해당 범위를 제거한다.
- live execution 중 global policy를 교체하거나 learned correction이 committed gesture에 끼어들면 실패다.
- 정상 success 횟수, latency, page report만으로 positive reinforcement를 만들면 실패다.
- replay와 negative fixture를 통과하지 않은 proposal을 다음 live effect에 적용하면 실패다.
- 학습이 authority, target uniqueness, effect boundary, non-retry, user precedence, redaction을 완화하면 실패다.
- runtime이 자기 source나 installed native asset을 직접 수정하면 source evolution을 Verified Change Loop로
  되돌린다.

## 24. 완료 정의

같은 absolute intent가 cooperative app, isolated browser, Windows accessibility, Windows OS input에서 같은
의미 terminal로 닫히고, 필요할 때만 bounded physical input을 사용하며, target drift와 사용자 개입에서 wrong effect를 만들지
않고, consequential effect를 한 번만 전송하며, 모든 결과가 canonical ActuationReceipt와 replay evidence로
재현되고, 실패와 robustness episode에서 만든 전술 교정이 effect-free evaluation과 safety gate를 통과한
versioned policy로만 성장할 때 끝난다.

완료한 같은 사이클에 다음을 수행한다.

1. 구현과 정식 tests를 본진에 졸업시킨다.
2. 위 지속 문서와 공개 계약을 모두 정합화한다.
3. `tests/attempts/proofCarryingMotor/`를 물리 삭제한다.
4. `mainPlan/8-proofCarryingMotor/`를 물리 삭제한다.
5. 두 경로의 `Test-Path`가 false임을 확인한다.
6. Node, browser, installed, Windows native, types gate가 모두 green임을 확인한다.
