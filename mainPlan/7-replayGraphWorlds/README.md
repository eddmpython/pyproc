# Initiative 7: ReplayGraph Worlds 실행 계획

상태: **착수**

이 문서는 선형 recording을 exact state node와 verified action edge의 그래프로 확장해 실제 site effect 없이
여러 선택을 탐색하고 평가하는 여덟 번째 이니셔티브의 임시 실행 계획이다.

지속 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-7---replaygraph-worlds),
실험 원장은 [Initiative 7 attempt](../../tests/attempts/replayGraphWorlds/README.md)가 소유한다.

## 1. 제품 명제

현재 ReplaySpace는 pinned recording의 정확한 다음 operation만 재생한다. 이것은 안전하고 결정적이지만 한
cursor에서 다른 action을 선택할 수 없다.

> ReplayGraph는 관찰 가능한 state를 node로, exact input과 terminal을 edge로 보존하고, 이미 기록되거나
> transactional app에서 결정적으로 생성된 분기만 effect 없이 탐색하는 업무 세계다.

가상 인터넷을 만들지 않는다. graph에 없는 action 결과를 browser engine이나 model이 추측하지 않는다.

## 2. graph truth model

### 2.1 node

node는 screenshot 하나가 아니다.

```text
node identity
provider and environment digest
SituationCapsule or APX observation
app state revision when available
Machine or Execution Session revision when available
artifact table
known, unknown, conflicted, completeness
oracle state
```

node identity는 canonical state digest에서 온다. visual similarity, URL, title, DOM node id만으로 두 node를
합치지 않는다.

### 2.2 edge

```text
source node
canonical operation and input digest
authority and risk
effect class
terminal and ActionEvidence
target node
recording or generation provenance
```

edge provenance:

- `recordedLive`: authorized live run에서 수집
- `recordedFrame`: cooperative FrameSpace run에서 수집
- `transactional`: AppSpace state restore와 deterministic transition에서 생성
- `syntheticFixture`: test author가 exact oracle과 함께 선언

provenance가 다른 edge를 같은 truth로 평탄화하지 않는다.

### 2.3 missing edge

현재 node에서 요청 input digest와 일치하는 edge가 없으면 `REPLAY_GRAPH_EDGE_MISSING`으로 끝난다. 비슷한
action을 찾거나 자연어로 결과를 생성하지 않는다. graph 탐색과 graph 확장은 별도 authority다.

## 3. graph construction

### 3.1 linear import

기존 Automation Recording 하나는 node와 edge의 선형 chain으로 import한다. operation 전과 후 state가
recording에 충분하지 않으면 implicit cursor node로만 만들고 semantic state를 꾸미지 않는다.

### 3.2 branch capture

새 edge를 만드는 허용 경로:

1. live provider에서 source state를 다시 확립하고 authorized recording을 수행한다.
2. Transactional AppSpace에서 exact source snapshot을 restore하고 effect-free transition을 실행한다.
3. deterministic fixture adapter가 transition oracle을 제공한다.

ReplayGraph 자체는 live target을 열거나 app state를 invent하지 않는다.

### 3.3 node deduplication

두 candidate를 합치려면 다음 digest가 모두 맞아야 한다.

- provider class와 environment
- app state 또는 recording state
- SituationCapsule fact closure와 completeness
- permission and policy version
- relevant artifact digest
- pending effect and session revision

동일 screenshot이나 URL은 충분하지 않다. omitted 또는 unknown channel이 다르면 합치지 않는다.

## 4. execution semantics

```text
open graph at pinned node
-> inspect available typed edges
-> authorize exact edge
-> return recorded terminal and target node
-> advance cursor
```

ReplaySpace처럼 authorization token은 current node와 edge digest에 묶인다. 다른 edge가 먼저 실행되면 stale다.

read-only graph traversal은 external effect가 아니다. 그러나 recorded edge의 original risk와 outcome을 보존한다.
`recordedLive` external effect edge를 replay했다고 새 live effect가 발생했다고 표시하지 않는다.

## 5. worlds와 tasks

ReplayGraph World는 graph와 평가 contract를 묶는다.

```text
world manifest
start node set
goal predicates
forbidden states and actions
step and byte budget
terminal oracle
coverage map
provenance and license
```

평가 대상은 browser policy, prompt, orchestration, human training workflow일 수 있다. pyproc은 특정 model의
training algorithm이나 leaderboard를 소유하지 않는다. 같은 world에서 action selection 결과와 evidence를
재현 가능하게 제공한다.

## 6. evaluation semantics

측정 가능한 기본 항목:

- goal predicate 도달 여부
- forbidden edge 선택 여부
- unknown에서 추측한 action 여부
- step budget과 terminal
- wrong target과 stale capability
- outcomeUnknown 처리
- evidence completeness

model success rate나 상대 제품 점수는 repository public surface의 제품 주장이 아니다. raw evaluation
artifact와 tests에만 둔다.

## 7. coverage

graph가 어떤 선택을 지원하는지 숨기지 않는다.

- node별 available edge catalog
- goal까지 known path 존재 여부
- unexplored action class
- state completeness
- provenance distribution
- dead end와 terminal

coverage가 낮은 world에서 실패한 caller를 실제 browser reasoning 실패로 단정하지 않는다. missing edge와
wrong action을 분리한다.

## 8. storage와 retention

graph는 content-addressed node, edge, artifact를 공유한다. 여러 recording에서 같은 verified object를 한 번만
저장한다.

- graph manifest는 immutable root를 가리킨다.
- 업데이트는 새 graph revision이다.
- node와 edge 수, artifact byte, path depth budget을 둔다.
- pruning은 start, goal, pinned evaluation run에서 reachable object를 보존한다.
- artifact와 state에 credential이나 personal data가 들어갈 수 있어 private storage가 기본이다.
- live recording을 graph에 넣을 권리와 retention policy는 caller가 책임진다.

## 9. integrity와 trust

- 모든 node, edge, artifact는 digest와 size를 가진다.
- graph root는 canonical manifest digest를 가진다.
- mutation, missing object, broken edge endpoint를 preflight에서 거부한다.
- hash chain은 author identity가 아니다.
- optional signature는 graph provenance를 증명하지만 page permission을 열지 않는다.
- synthetic fixture와 live recording을 같은 provenance로 표시하지 않는다.

## 10. architecture 후보

```text
scripts/replayGraph/
|-- replayGraph.js
|-- graphManifest.js
|-- graphNode.js
|-- graphEdge.js
|-- recordingImporter.js
|-- branchCapture.js
|-- graphStore.js
|-- graphTraversal.js
|-- worldContract.js
|-- worldEvaluator.js
|-- graphRetention.js
`-- replayGraphErrors.js
```

ReplaySpace canonical recording, Perception Computer state, Transactional AppSpace snapshot, Evidence Pack oracle를
재사용한다. graph core는 browser provider를 import하지 않는다. live branch capture adapter만 provider를 안다.

## 11. public surface 후보

```text
openWorld(manifest)
inspectNode(nodeRef)
listEdges(nodeRef)
traverse(edgeRef)
checkpointCursor()
restoreCursor(checkpoint)
evaluate(run)
importRecording(recording)
captureBranch(sourceNode, authorizedProvider)
inspectCoverage()
close()
```

MCP와 SDK는 graph traversal을 기존 live browser operation과 명확히 구분한다. `browserOpen` 같은 이름을
재사용해 실제 browser가 열린 것처럼 보이게 하지 않는다.

## 12. 실험 캠페인

신규 코드는 [Initiative 7 attempt](../../tests/attempts/replayGraphWorlds/)에서 시작한다.

fixture family:

1. linear recording import
2. source node에서 두 safe actions와 한 forbidden action
3. same URL and screenshot but different app state
4. same semantic state but different permission policy
5. incomplete observation and unknown edge
6. Transactional AppSpace branch restore
7. post-send outcomeUnknown edge
8. missing artifact and broken endpoint
9. graph revision and concurrent writer
10. private data redaction and retention

필수 probe:

| probe | 질문 | 음성 시험 |
|---|---|---|
| `linearImportProbe.mjs` | recording을 loss 없이 graph로 옮기는가 | 없는 before state invent 0 |
| `branchTraversalProbe.mjs` | exact edge만 effect 없이 탐색하는가 | live provider call 0 |
| `missingEdgeProbe.mjs` | graph 밖 action을 정직하게 거부하는가 | search-ahead와 generated terminal 0 |
| `nodeIdentityProbe.mjs` | state와 policy가 다른 node를 분리하는가 | URL 또는 screenshot만으로 merge 0 |
| `transactionalBranchProbe.html` | AppSpace branch가 graph edge가 되는가 | source restore 없는 edge 생성 0 |
| `coverageProbe.mjs` | supported와 unexplored를 구분하는가 | graph gap을 caller failure로 판정 0 |
| `integrityProbe.mjs` | graph mutation과 누락을 거부하는가 | broken endpoint 수락 0 |
| `evaluationProbe.mjs` | deterministic oracle가 run을 판정하는가 | model text가 terminal 변경 0 |
| `retentionProbe.mjs` | reachable graph object를 보존하는가 | pinned run 삭제 0 |

## 13. 실행 단계

1. ReplaySpace recording에서 node와 edge로 손실 없이 가져올 최소 identity를 찾는다.
2. pure graph schema, canonical digest, mutation fixture를 만든다.
3. exact edge traversal과 cursor checkpoint를 구현한다.
4. node identity, deduplication, coverage를 반증한다.
5. AppSpace와 authorized live branch capture adapter를 구현한다.
6. World contract와 deterministic evaluator를 구현한다.
7. quotas, retention, privacy, signatures를 닫는다.
8. Control, MCP, JavaScript, Python parity를 구현한다.
9. installed package에서 effect 0으로 multi-branch evaluation을 실행한다.
10. docs, API, README, security, capability matrix를 정합화한다.
11. debt, attempt, mainPlan을 완료 사이클에 삭제한다.

## 14. 문서 정합

- `docs/specs/replayGraph/README.md`
- `docs/usage/replayGraph.md`
- `docs/usage/replaySpace.md`
- `docs/usage/appSpace.md`
- `docs/usage/experienceVerification.md`
- `docs/usage/capabilityMatrix.md`
- `docs/reference/api.md`
- `docs/operations/moduleBoundaries.md`
- `docs/operations/contractReality.md`
- `docs/product/vision.md`
- `README.md`, `README.ko.md`
- `SECURITY.md`

## 15. 졸업 gate

1. linear recording의 operation, input, terminal, artifact, digest 손실은 0이다.
2. graph traversal의 live provider request와 browser effect는 0이다.
3. missing edge에서 search-ahead, nearest match, generated terminal은 0이다.
4. URL, title, screenshot similarity만으로 node를 merge한 횟수 0이다.
5. source state restore와 provenance 없는 branch edge 생성은 0이다.
6. coverage gap을 wrong action 또는 task failure로 판정한 횟수 0이다.
7. mutated node, edge, artifact, broken endpoint를 모두 거부한다.
8. synthetic, cooperative, recorded live provenance가 섞인 횟수 0이다.
9. deterministic evaluator를 model text가 바꾼 횟수 0이다.
10. installed client들이 같은 graph root, cursor, terminal, evaluation digest를 반환한다.

## 16. 실패 조건

- graph에 없는 world transition을 생성하면 실패다.
- screenshot 또는 DOM snapshot만 node truth로 쓰면 실패다.
- live recording과 synthetic fixture를 같은 provenance로 표시하면 실패다.
- arbitrary internet이나 browser engine을 대체한다고 주장하면 실패다.
- training framework와 leaderboard까지 core가 소유하면 범위를 줄인다.
- graph coverage 부족을 caller 성능 저하로 숨기면 실패다.

## 17. 완료 정의

같은 pinned world에서 여러 caller가 live effect 없이 정확한 branch를 탐색하고, graph에 없는 선택은
명시적으로 거부되며, deterministic oracle가 같은 evidence로 같은 결과를 낼 때 끝난다.
