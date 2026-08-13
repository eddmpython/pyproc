# Initiative 8: proofCarryingMotor - 같은 intent를 여러 actuator에서 같은 증거 계약으로 실행할 수 있는가

## 가설

Initiative 1부터 7까지의 world, authority, transaction, AppSpace, ReplayGraph 계약 위에 absolute intent,
TargetBinding, deterministic actuator broker, ControlLease, bounded effect window를 합성하면 cooperative app,
browser input, Windows accessibility, OS input이 같은 semantic terminal과 ActuationReceipt를 반환하고,
redacted execution episode에서 검증된 전술 교정을 다음 policy revision으로 승격할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-8---proof-carrying-motor),
제품 요구사항과 실행 계획은 [Initiative 8](../../../mainPlan/8-proofCarryingMotor/README.md)이다.

## 선행 조건

Initiative 7이 졸업해 exact world node와 action edge를 effect 없이 탐색하고, Initiative 1과 5의
ActionCapability, CommitLease, evidence terminal이 정식 계약이어야 한다.

## 졸업 게이트

1. pinned browser baseline의 fixture action reach 손실은 0이다.
2. cooperative, browser input, Windows accessibility, Windows OS input의 semantic terminal 차이는 0이다.
3. ambiguous 또는 stale TargetBinding 뒤 wrong target effect는 0이다.
4. effect window 뒤 fallback, new target, gesture restart는 0이다.
5. 한 CommitLease의 consequential live send는 최대 1이다.
6. ControlLease 없는 OS input과 user preemption 뒤 새 effect segment는 0이다.
7. aborted committed gesture의 required safety release 누락은 0이다.
8. replay의 browser, app, native live provider call은 0이다.
9. visual, page content, accessibility label, weighted score의 authority 확대는 0이다.
10. native host의 listener, raw input public RPC, unrestricted target은 0이다.
11. delegated tab의 user gesture 전, origin 변경 뒤, close 뒤 접근은 0이다.
12. installed client별 canonical ActuationReceipt digest 차이는 0이다.
13. 모든 terminal의 redacted ActuationEpisode 누락은 0이다.
14. evidence 없는 positive label과 safety constitution 변경 proposal 수락은 0이다.
15. replay와 negative fixture 전 promotion과 live execution 중 policy 교체는 0이다.
16. 같은 corpus와 evaluation manifest의 promotion verdict digest 차이는 0이다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `intentSchemaProbe.mjs` | absolute intent가 canonical한가 | relative verb와 raw input 수락 0 |
| `brokerDecisionProbe.mjs` | route가 결정적인가 | weighted score authority 0 |
| `targetBindingProbe.mjs` | target이 exact unique한가 | name 또는 rectangle 단독 binding 0 |
| `activateWindowProbe.html` | effect 전 보정과 effect 뒤 동결이 지켜지는가 | second press와 fallback 0 |
| `valueStateProbe.html` | desired state를 exact하게 닫는가 | stale toggle 0 |
| `dragEnvelopeProbe.html` | 한 gesture 안에서만 feedback하는가 | restart와 new target 0 |
| `controlLeaseProbe.mjs` | user가 physical control을 회수하는가 | preemption 뒤 effect 0 |
| `safetyReleaseProbe.mjs` | 중단이 stuck input을 남기지 않는가 | required release 누락 0 |
| `cooperativeAdapterProbe.html` | AppSpace authority를 재사용하는가 | approval 우회 0 |
| `replayActuatorProbe.mjs` | receipt를 effect 없이 재생하는가 | provider call 0 |
| `windowsUiaProbe.mjs` | Windows semantic action이 같은 intent인가 | unsupported pattern success 0 |
| `windowsInputProbe.mjs` | physical input이 lease와 plan에 묶이는가 | raw coordinate RPC 0 |
| `coordinateTransformProbe.mjs` | monitor와 DPI 변환이 exact한가 | stale transform input 0 |
| `delegatedTabProbe.mjs` | user gesture와 origin epoch가 권한인가 | cross-origin access 0 |
| `nativeIntegrityProbe.mjs` | native provenance가 검증되는가 | tampered binary 실행 0 |
| `clientParityProbe.mjs` | client가 같은 receipt를 보존하는가 | digest와 outcome 차이 0 |
| `episodeLedgerProbe.mjs` | terminal과 correction을 보존하는가 | missing terminal과 secret 원문 0 |
| `failureAttributionProbe.mjs` | first divergence와 cause를 구분하는가 | 상관관계의 observed cause 승격 0 |
| `policyPromotionProbe.mjs` | replay와 음성 시험 뒤에만 성장하는가 | safety regression promotion 0 |
| `experiencePoisoningProbe.mjs` | untrusted log가 policy를 오염시키지 않는가 | page label과 imported authority 0 |
| `policyRollbackProbe.mjs` | regression에서 이전 revision으로 돌아가는가 | active execution policy 교체 0 |

## 모듈화 설계 후보

- pure core는 intent, binding, plan, broker, effect window, receipt를 소유한다.
- Perception, transaction, AppSpace, ReplayGraph는 기존 object를 주입하고 Motor가 복제하지 않는다.
- browser, cooperative, replay, native host는 동일 actuator interface를 구현한다.
- visual은 sensor로만 남고 actuator kind가 아니다.
- native host는 parent-owned stdio 또는 native messaging만 사용하고 public raw input을 열지 않는다.
- ControlLease는 physical surface arbitration만 소유하고 effect approval을 대신하지 않는다.
- experience ledger는 receipt와 evidence를 content-addressed reference로 연결하고 raw log를 복제하지 않는다.
- policy lab은 provider를 호출하지 않고 ReplayGraph, fixture, deterministic oracle만 사용한다.
- runtime policy는 전술만 바꾸며 source, authority, effect safety constitution을 수정하지 않는다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | source contract audit | APX, browser control, Initiatives 1부터 7, official platform boundaries 대조 | probe 미실행 | 별도 automation stack이 아니라 proof-carrying actuation orchestration으로 제한 | Initiative 7 졸업 뒤 schema와 target binding negative fixture |

## 판정

진행 중. Initiative 7의 durable ReplayGraph root와 effect-free traversal을 선행 계약으로 사용한다.
