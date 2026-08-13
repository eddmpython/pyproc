# Initiative 4: Execution Memory Registry 실행 계획

상태: **Initiative 3 후행 대기**

이 문서는 대화 요약이 아니라 실제 계산과 browser 작업의 이어받기 지점을 durable record로 만드는 다섯
번째 이니셔티브의 임시 실행 계획이다.

지속 결정은
[Agent experience initiatives](../../docs/operations/agentExperienceInitiatives.md#initiative-4---execution-memory-registry),
실험 원장은 [Initiative 4 attempt](../../tests/attempts/executionMemoryRegistry/README.md)가
소유한다.

## 1. 제품 명제

대화 기록은 작업을 설명하지만 실행 상태를 부활시키지 못한다. pyproc의 Machine generation, branch,
environment, situation, replay cursor, evidence를 하나의 session head로 연결하면 호출자가 바뀌어도 설명을
재구성하는 대신 검증된 실행 지점에서 계속할 수 있다.

> Execution Memory는 transcript가 아니라 다시 열 수 있는 실행 상태와 그 상태가 현실에 대해 알고 있는
> 것의 content-addressed index다.

Registry는 Machine byte를 새 포맷으로 복제하지 않는다. 이미 존재하는 generation, `.pymachine`,
`.webmachine`, recording, Evidence Pack을 immutable reference로 연결한다.

## 2. 현재 기반과 간극

| 기반 | 현재 능력 | 간극 |
|---|---|---|
| Machine generation | heap, `/home/web`, device, outcome의 durable state | project와 task identity, observation, evidence 연결 없음 |
| checkpoint와 branch | 같은 heap 기반의 후보와 adopt | 어떤 요구와 검증 때문에 branch를 택했는지 공통 session record 없음 |
| APX recording | observation, action terminal, replay cursor | Machine generation과 atomic하게 연결되지 않음 |
| Evidence Pack | repository change verification 계획 | live working session의 current head와 handoff 의미 없음 |
| signed images | portable state와 provenance | permission, latest situation, pending effect, caller handoff는 운반하지 않음 |
| fleet registry | hot와 cold lifecycle 계획 | task-level memory와 완료 상태를 소유하지 않음 |

## 3. Execution Session contract

### 3.1 identity

각 session은 stable `executionSessionId`와 immutable revision chain을 가진다. mutable latest pointer는
content-addressed revision을 가리킬 뿐 record를 덮어쓰지 않는다.

```text
ExecutionSession HEAD
        |
        v
session revision
|-- project identity
|-- machine generation
|-- branch and checkpoint lineage
|-- environment fingerprint
|-- permission manifest digest
|-- situation reference
|-- replay cursor
|-- evidence pack reference
|-- pending intent reference
`-- lifecycle and provenance
```

### 3.2 최소 schema 후보

```json
{
  "schemaVersion": "1",
  "executionSessionId": "session:...",
  "revision": 12,
  "parents": ["sha256:..."],
  "project": {
    "workspaceId": "project:...",
    "repositoryTree": "sha256:..."
  },
  "machine": {
    "machineId": "machine:...",
    "generation": "sha256:...",
    "environment": "sha256:...",
    "lifecycle": "cold"
  },
  "work": {
    "state": "suspended",
    "branch": "candidate-a",
    "checkpoint": "checkpoint:..."
  },
  "browser": {
    "situationRef": "situation:...",
    "recordingId": "recording:...",
    "cursor": 8,
    "prefixSha256": "sha256:..."
  },
  "evidence": {
    "packSha256": "sha256:..."
  },
  "permissions": {
    "manifestSha256": "sha256:..."
  }
}
```

field는 모든 session에서 억지로 채우지 않는다. unavailable, notApplicable, unknown을 구분하고 존재하지
않는 browser나 evidence를 빈 object로 꾸미지 않는다.

### 3.3 lifecycle

```text
created -> active -> waitingApproval -> suspended -> active
                  \-> completed
                  \-> failed
                  \-> abandoned
```

- `active`: hot Machine lease와 current revision이 있음
- `waitingApproval`: exact pending intent가 있고 새로운 external effect를 받지 않음
- `suspended`: Machine이 cold이며 generation과 resume contract가 완결됨
- `completed`: required Evidence Pack verdict와 final generation이 있음
- `failed`: terminal failure와 재개 가능한 last safe revision을 구분함
- `abandoned`: explicit destructive choice이며 자동 상태가 아님

session lifecycle과 Machine lifecycle을 같은 enum으로 합치지 않는다. session은 completed여도 Machine은
archive로 남을 수 있고, Machine은 hot이어도 session은 waitingApproval일 수 있다.

## 4. revision atomicity

새 revision publish 순서는 다음과 같다.

```text
verify referenced generation and artifacts exist
-> write immutable session revision
-> verify digest
-> compare-and-swap session HEAD with expected parent
-> publish event
```

Machine generation과 session revision을 한 storage transaction으로 쓸 수 없으면 two-phase link를 쓴다.
먼저 generation을 durable하게 닫고, session revision은 그 digest를 참조한다. session HEAD publish가
실패하면 generation은 orphan candidate일 수 있지만 current session truth를 오염시키지 않는다. retention은
reachable generation을 보존하고 orphan은 별도 cleanup에서 회수한다.

## 5. provenance와 truth

각 field는 다음 출처를 보존한다.

- `observed`: Machine store, repository adapter, APX에서 직접 읽음
- `declared`: caller가 project 또는 task metadata로 제공
- `derived`: exact input에서 deterministic하게 계산
- `reported`: app 또는 page가 보고함
- `inferred`: optional adapter 결과

caller가 “테스트 통과”라고 쓴 문자열을 completion evidence로 쓰지 않는다. completed는 referenced Evidence
Pack의 verified verdict와 exact contract digest가 있을 때만 자동 판정할 수 있다.

## 6. handoff

### 6.1 handoff descriptor

handoff는 session HEAD와 필요한 asset 목록을 canonical descriptor로 만든다.

```text
session revision
machine image or generation export
environment and asset manifest
permission manifest
recording and sidecars
Evidence Pack and sidecars
trust and resume instructions
```

새 `.agentcapsule` 파일을 바로 만들지 않는다. existing state bundle이 meta와 referenced objects를 안전하게
표현할 수 있는지 attempt에서 검증한다. 하나의 file이 필요해도 Machine bytes, evidence bytes, permission
승인을 같은 의미로 평탄화하지 않는다.

### 6.2 받는 쪽의 절차

```text
verify envelope integrity and optional signature
-> show signer and requested capabilities
-> require explicit trust and permissions
-> verify exact engine and assets
-> import into isolated registry namespace
-> restore Machine cold
-> verify recording and Evidence Pack
-> publish a new local session revision
```

signature는 permission grant가 아니다. 외부 browser cookie, login state, uncommitted site effect는 handoff되지
않는다. JS proxy-bearing heap은 기존 portability refusal을 유지한다.

## 7. privacy와 retention

Execution Memory는 source tree, form value, data frame, screenshot, network metadata를 연결할 수 있어 높은
민감도를 가진다.

- registry record에는 원문보다 digest와 bounded metadata를 기본으로 둔다.
- secret, cookie, token, authorization, password를 record에 쓰지 않는다.
- sidecar 위치는 allowed root 아래이고 source control 밖이다.
- session별 retention과 pin을 명시한다.
- completed가 자동 삭제를 의미하지 않으며, destructive delete는 exact target과 reachable set을 확인한다.
- handoff export 전에 private artifact inventory를 보여준다.

## 8. Registry API 후보

```text
createSession(project)
openSession(executionSessionId)
checkpointSession(expectedRevision, links)
suspendSession(expectedRevision)
resumeSession(expectedRevision)
completeSession(expectedRevision, evidencePack)
listSessions(filter)
inspectSession(executionSessionId)
exportHandoff(executionSessionId)
importHandoff(source, trust)
close()
```

`modelSession`을 core schema에 넣지 않는다. 특정 호출자 대화 identity는 optional opaque annotation으로
참조할 수 있지만 state truth와 completion을 결정하지 않는다.

공개 표면은 Initiative 3 Fleet과 같은 upper control layer에서 검증한다. 새 root export는 만들지 않고
existing `pyproc/machine` 또는 Control surface에서 승격 가능성을 판정한다.

## 9. 내부 구조 후보

```text
scripts/executionMemory/
|-- executionSession.js
|-- sessionRevision.js
|-- sessionRegistry.js
|-- sessionLinks.js
|-- handoffDescriptor.js
|-- handoffVerifier.js
|-- retentionPolicy.js
`-- executionMemoryErrors.js
```

state storage는 기존 kernel grammar와 store를 사용한다. Machine, APX, recording, Evidence Pack을 다시
구현하지 않는다.

## 10. 실험 캠페인

신규 코드는 [Initiative 4 attempt](../../tests/attempts/executionMemoryRegistry/)에서
시작한다.

| probe | 질문 | 음성 시험 |
|---|---|---|
| `sessionRevisionProbe.mjs` | immutable revision과 CAS HEAD가 성립하는가 | stale writer overwrite 0 |
| `machineLinkProbe.html` | generation과 session head가 정합하는가 | missing generation publish 0 |
| `situationLinkProbe.mjs` | APX와 replay cursor가 같은 epoch를 가리키는가 | forged cursor 수락 0 |
| `completionTruthProbe.mjs` | verified Evidence Pack만 completion을 만든는가 | caller text로 completed 0 |
| `coldHandoffProbe.html` | 다른 isolated context가 exact state를 이어받는가 | engine mismatch와 untrusted import 거부 |
| `permissionBoundaryProbe.html` | signature와 permission이 분리되는가 | signer만으로 device grant 0 |
| `retentionProbe.mjs` | reachable object만 보존하고 orphan을 안전하게 찾는가 | live generation 삭제 0 |
| `redactionProbe.mjs` | session과 handoff에 secret이 없는가 | configured secret 원문 0 |

## 11. 실행 단계

1. current state objects와 필요한 link identity를 inventory한다.
2. pure session revision schema, canonical digest, CAS fixture를 만든다.
3. Machine generation과 Fleet lifecycle link를 구현한다.
4. SituationCapsule, recording cursor, Evidence Pack link를 구현한다.
5. completion state machine과 provenance를 반증한다.
6. handoff descriptor와 isolated import를 검증한다.
7. retention, redaction, orphan cleanup을 구현한다.
8. 본진 승격과 Control, JavaScript, Python, MCP parity를 닫는다.
9. clean installed package에서 caller 교체 handoff journey를 실행한다.
10. docs, README, security, API, capability matrix를 정합화한다.
11. debt, attempt, mainPlan을 완료 사이클에 삭제한다.

## 12. 문서 정합

- `docs/specs/executionMemory/README.md`
- `docs/usage/executionMemory.md`
- `docs/usage/machineFleet.md`
- `docs/usage/replaySpace.md`
- `docs/usage/trustPermissions.md`
- `docs/usage/capabilityMatrix.md`
- `docs/reference/api.md`
- `docs/operations/moduleBoundaries.md`
- `docs/operations/contractReality.md`
- `docs/product/vision.md`
- `README.md`, `README.ko.md`
- `SECURITY.md`

문서에서 transcript memory와 Execution Memory, integrity와 signature, image와 permission을 항상 구분한다.

## 13. 졸업 gate

1. stale writer가 session HEAD를 덮은 횟수 0이다.
2. 모든 published revision의 Machine, environment, situation, recording, evidence reference가 검증된다.
3. missing 또는 mismatched reference는 completed나 suspended로 publish되지 않는다.
4. caller declaration만으로 completed가 된 횟수 0이다.
5. different isolated context에서 exact generation과 replay boundary를 이어받는다.
6. signature만으로 permission이 열린 횟수 0이다.
7. JS proxy, external browser state, unknown effect를 portable하다고 표시한 횟수 0이다.
8. secret fixture 원문이 registry와 handoff에 들어간 횟수 0이다.
9. retention이 reachable generation과 evidence를 삭제한 횟수 0이다.
10. installed package와 모든 public client가 같은 revision digest와 lifecycle을 반환한다.

## 14. 실패 조건

- chat transcript나 vector store wrapper에 그치면 실패다.
- state bytes를 기존 bundle과 별개 포맷으로 중복 저장하면 재설계한다.
- mutable JSON 한 파일을 덮어쓰며 history를 가장하면 실패다.
- caller가 쓴 natural language를 completion truth로 쓰면 실패다.
- 특정 model이나 editor session을 core identity로 요구하면 범위를 줄인다.
- external browser login 상태까지 이동한다고 주장하면 실패다.

## 15. 완료 정의

새 호출자가 session ID 하나로 exact Machine generation, branch, environment, latest situation, replay boundary,
evidence를 검증하고 같은 safe point에서 작업을 이어갈 때 끝난다.
