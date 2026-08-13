# Initiative 2: verifiedChangeLoop - 저장소 변경 완료를 재현 가능한 브라우저 증거로 판정할 수 있는가

## 가설

strict Experience Contract, Perception Computer의 `SituationCapsule`, proof-carrying action, diagnostics,
exact baseline comparison을 하나의 실행 루프로 묶으면 screenshot diff나 클릭 성공만으로는 판정할 수 없는
사용자 경험 회귀와 상태 모순을 찾고, 변경 완료 여부를 replay 가능한 Evidence Pack으로 증명할 수 있다.

기획 정본은
[Agent experience initiatives](../../../docs/operations/agentExperienceInitiatives.md#initiative-2---verified-change-loop),
실행 계획은 [Initiative 2](../../../mainPlan/2-verifiedChangeLoop/README.md)이다. 이 폴더는 그 주장을
browser 실측으로 반증하거나 졸업시키는 단일 캠페인이다.

## 선행 조건

Machine Entrance와 Perception Computer가 먼저 졸업해야 한다. 특히 다음 계약이 정식 제품에 없으면
probe를 실행하지 않는다.

- 목표별 최소 충분 `SituationCapsule`
- known, conflicted, unknown, stale 상태
- document epoch에 묶인 action capability
- DOM과 network transition을 연결한 `ActionEvidence`
- live effect 없는 replay
- installed client parity

## 졸업 게이트

아래 fixture와 음성 시험이 모두 browser 및 installed package에서 PASS해야 한다.

1. required scenario 누락, readiness timeout, browser 또는 fixture mismatch, artifact 누락은 전부
   `incomplete`이며 `verified`로 축약되지 않는다.
2. false `verified` 0, wrong-target action 0, `outcomeUnknown` 자동 effect 재전송 0이다.
3. click command는 성공하지만 visible, durable 또는 network postcondition이 실패하는 fixture는
   `rejected`다.
4. desktop, tablet, mobile fixture의 overflow, clipping, occlusion, focus, selected semantics 결함을 찾고
   정상 fixture 오탐은 0이다.
5. perceptual-only claim이 deterministic required verdict를 바꾼 횟수 0이다.
6. semantic scenario의 full-page artifact 수는 0이며 모든 visual artifact는 unresolved claim과 연결된다.
7. exact contract, fixture, browser, viewport identity가 다른 baseline은 비교하지 않는다.
8. 모든 finding은 scenario, checkpoint, rule, entity lineage, evidence ref로 역추적된다.
9. Evidence Pack byte mutation, sidecar 삭제, recording mutation, oracle digest 변경을 모두 거부한다.
10. replay에서 live provider request와 browser effect 0으로 같은 deterministic verdict와 issue identity를
    재현한다.
11. cookie, authorization, token-shaped value, configured secret 원문 artifact 유출은 0이다.
12. cancel, browser death, quota failure 뒤 complete pack 오게시 0, owned process와 profile 잔여 0이다.
13. JavaScript, Python, MCP, CLI가 같은 terminal, issue identity, pack digest를 반환한다.
14. clean directory에 packed exact package만 설치하고 문서의 audit와 verify journey를 완주한다.

## 예정 probe

| probe | 질문 | 필수 음성 시험 |
|---|---|---|
| `contractBoundaryProbe.mjs` | 사람 문서와 strict contract가 분리되는가 | 문서 속 command, unknown field, path escape 실행 0 |
| `readinessProbe.html` | loading과 ready를 정확히 구분하는가 | timeout을 success 또는 제품 결함으로 오판 0 |
| `responsiveTruthProbe.html` | viewport별 구조 결함을 찾는가 | 환경 mismatch를 regression으로 판정 0 |
| `stateTruthProbe.html` | 클릭과 업무 성공을 분리하는가 | applied effect만으로 verified 판정 0 |
| `diagnosticCorrelationProbe.html` | 관련 console과 network evidence만 연결하는가 | unrelated response 오상관 0 |
| `perceptualBoundaryProbe.html` | 주관적 판단이 advisory에 머무는가 | 취향을 required fail로 승격 0 |
| `issueIdentityProbe.html` | rerender와 document replacement를 구분하는가 | 좌표 변화만으로 새 issue 생성 0 |
| `baselinePinProbe.mjs` | exact reference만 비교하는가 | floating baseline과 환경 mismatch 수락 0 |
| `evidencePackProbe.mjs` | canonical pack과 sidecar가 완결되는가 | mutation, 누락, report drift 수락 0 |
| `redactionProbe.html` | secret이 capture 전에 제거되는가 | credential 원문 artifact 0 |
| `authorityBoundaryProbe.html` | repo와 page text가 authority를 넓히지 않는가 | external effect 자동 승인 0 |
| `replayVerdictProbe.mjs` | effect 없이 판정을 재계산하는가 | provider 호출, effect 재전송, oracle 변경 묵인 0 |
| `consumerParityProbe.mjs` | 모든 client가 같은 의미를 받는가 | client별 verdict 축약 0 |

현재 상태에서는 probe 파일을 만들지 않는다. 선행 이니셔티브가 졸업한 뒤 exact dependency와 fixture를
다시 잠그고 시작한다.

## 모듈화 설계 후보

실측 전 `scripts/verification/`, 공개 operation, CLI syntax를 확정하지 않는다. 졸업 시 책임 후보는
다음과 같다.

- contract loader는 strict schema, path, origin, risk, quota를 소유한다.
- scenario runner는 readiness, step, checkpoint, cleanup state machine을 소유한다.
- checkpoint oracle은 structural, behavioral, perceptual 판정을 분리한다.
- visual planner는 unresolved claim에 필요한 bounded artifact만 요청한다.
- issue ledger는 stable identity와 finding lifecycle을 소유한다.
- comparator는 exact reference와 current pack의 comparability를 먼저 판정한다.
- Evidence Pack writer는 canonical manifest, sidecar digest, atomic publish를 소유한다.
- replay verifier는 effect 없이 pack terminal을 다시 계산한다.
- report renderer는 canonical pack만 읽으며 판정에 참여하지 않는다.

browser lifecycle, situation, action, attachment, recording은 기존 제품 계약을 재사용한다. 새 root export,
새 Experimental subpath, arbitrary shell runner, source repair operation은 만들지 않는다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | 기획과 반증 gate 설계 | APX 1.0, AutomationSpace, ReplaySpace, installed clients 문서와 코드 대조 | probe 미실행 | Perception Computer와 분리된 repository experience verification 가설로 고정 | 선행 이니셔티브 졸업 뒤 contract boundary probe |

## 판정

대기 중. 기획과 반증 gate만 확정했으며 Perception Computer 졸업 전에는 probe를 실행하지 않는다.
