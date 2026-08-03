# attemptsSunset

## 판정 결과(2026-08-03)

14개 폴더 전부에 대해 "누가 이 폴더를 인용하는가"를 실측했다. 인용이 있으면 삭제가 링크
게이트나 북극성 증거 게이트를 RED로 만든다(실제로 시도해서 확인했다).

| 폴더 | 인용처 | 판정 |
|---|---|---|
| enginePort | `docs/usage/capabilityMatrix.md`, `scripts/fetchWasiAssets.mjs`, wasi 게이트 2곳 | 살아 있음(북극성 엔진 축의 다음 수) |
| envManager | `docs/usage/capabilityMatrix.md`, `src/composition/envManager.js` | 진행 중 |
| gpuCompute | `docs/usage/capabilityMatrix.md`, `tests/northStar.mjs`, `tests/run.mjs` | 승격 필요(**북극성 증거가 이 폴더의 probe다**) |
| inTabTls | 없음 | 살아 있음(북극성 네트워크 축 사다리 1단) |
| largeHeapEnvelope | `docs/usage/capabilityMatrix.md` | 살아 있음(10이 쓸 자리) |
| numericShard | `tests/run.mjs`(Speed Lab helper 공유 검사) | 승격 필요 |
| pythonMachine | docs 2곳, `src/processOs/` 2곳 | 진행 중 |
| runtimeParity | docs 2곳, src 3곳, 게이트 1곳 | 살아 있음(09가 쓸 자리) |
| selfHost | 없음 | 진행 중(남은 질문 셋 명시) |
| socketBridge | `docs/usage/capabilityMatrix.md`, `src/capabilities/socketBridge.js`, `tests/browser/socketLane.mjs` | 승격 필요 |
| stateKernel | `src/state/objectModel.js`, `tests/run.mjs` | 살아 있음(10이 쓸 자리) |
| wasiPackages | `tests/browser/wasiGate.html` | 승격 필요 |

**종결 3건**: `externalS1`(지식이 benchmarking.md에 승격돼 있었다)과 `branchFleet`(주석의 경로 인용을
사실 서술로 바꿔 승격했다. 숫자는 주석에 남고 과정은 git 이력이 보존한다), `engineContract`
(WASI 매핑표를 그것을 쓰는 살아 있는 캠페인 enginePort로 옮기고 주석 인용을 사실 서술로 바꿨다).

**결론: 나머지 11개는 지금 지울 수 없다.** 이유가 폴더마다 다르지 않다:
출하 코드와 문서가 그 폴더의 probe를 "실측 정본"으로 인용하고, 북극성 원장은 `gpuCompute`의
probe 파일을 축 증거로 등재하고 있다. 규칙은 "종결 시 폴더째 삭제하고 지속 계약만 docs에
남긴다"인데, 지금 상태는 **지속 계약이 아니라 실측 자체가 삭제 대상 폴더에 산다.**

## 다음 착수(승격 6건)

승격은 "숫자를 docs로 옮기고 인용을 그쪽으로 돌린다"가 아니다. 인용의 성격이 둘로 갈린다.

1. **주석의 실측 인용**(branchFleet, runtimeParity 일부): 주석이 폴더 경로를 가리키는 대신
   사실을 말하게 고친다. git 이력이 과정을 보존하므로 경로는 필요 없다.
2. **게이트와 원장의 파일 인용**(gpuCompute, numericShard, wasiPackages, socketBridge): 그
   probe가 실제로 게이트에서 돌거나 증거로 등재돼 있다. 폴더를 지우려면 probe를 정식 위치
   (`tests/browser/` 또는 `tests/webMachine/browser/probes/`)로 옮기고 북극성 증거 경로를 함께
   바꿔야 한다. 이것이 "핵심 주장의 증거가 삭제 예정 폴더에 상주"라는 감사 지적의 실체다.

`tests/attempts/`의 실험 폴더 15개에 판정을 내린다. 규칙은 "종결 시 폴더째 삭제하고 지속 계약만 docs에
남긴다"인데 지금 15개가 전부 살아 있다. 폴더구조 축에서 가장 큰 미집행 부채다.

## Outcome brief

- 주 축: 폴더구조
- 관측된 손실 지점: 어느 실험이 끝났고 어느 것이 진행 중인지 폴더만 봐서는 알 수 없다. 종결된 캠페인의
  probe가 남아 있으면 "핵심 주장의 증거가 삭제 예정 폴더에 상주"하는 상태가 재발한다.
- 기대 변화: 살아 있는 캠페인만 남고, 끝난 것의 지속 계약은 `docs/`에 있다.
- 롤백 반경: 삭제만 하므로 revert 하나. 다만 삭제 전에 승격이 끝나 있어야 한다.

## 근거

- 현재 폴더 15개: `branchFleet`, `engineContract`, `enginePort`, `envManager`, `externalS1`, `gpuCompute`,
  `inTabTls`, `largeHeapEnvelope`, `numericShard`, `pythonMachine`, `runtimeParity`, `selfHost`,
  `socketBridge`, `stateKernel`, `wasiPackages`.
- CLAUDE.md: "카테고리 = 개념 캠페인 하나. 증식 금지. 종결 시 폴더째 삭제하고 지속 계약만 docs에 남긴다
  (git 이력이 실측 과정을 보존한다)."
- `tests/run.mjs`가 검사하는 것은 각 폴더의 README 존재뿐이다. 수명주기(열림/종결)는 기계 판정 대상이 아니다.
- 09와 10이 실측을 요구하는데, 그 실측이 갈 자리가 `runtimeParity`, `stateKernel`, `largeHeapEnvelope`다.
  즉 이 캠페인은 그 셋을 **살려두는** 판정도 함께 내려야 한다.

## 입장 조건

없다. 언제든 병렬로 돌릴 수 있고 제품 코드를 건드리지 않는다.

다만 09와 10보다 **먼저** 끝내지 않는다. 그 둘이 쓸 폴더를 지우면 안 되므로, 판정 시점에 09와 10의
실측 계획을 함께 본다.

## 범위

포함

- 15개 폴더 각각에 세 판정 중 하나: **살아 있음**(어느 캠페인이 쓰는지 명시), **승격 후 삭제**(무엇을
  `docs/` 어디로 올렸는지 명시), **그냥 삭제**(지속 계약이 없다는 판단 근거 명시)
- 승격 대상의 `docs/` 이관
- 판정 결과를 `tests/attempts/README.md`에 반영

제외

- 새 attempts 폴더 신설은 하지 않는다. 09와 10의 세부 질문은 기존 캠페인 안의 probe 파일로 늘린다.
- probe 코드를 `src/`로 옮기는 것은 각 캠페인의 졸업 절차이지 이 캠페인의 일이 아니다.

## 구현 계약

1. 폴더마다 README와 probe를 읽고 판정한다. 판정 근거는 "이 폴더가 답하려던 질문이 닫혔는가"이고,
   닫혔다면 그 답이 지금 어디에 사는지(`docs/`, 게이트, `src/` 계약) 확인한다.
2. 답이 코드나 게이트에만 있고 문서에 없으면 **먼저 승격한다.** 승격 없이 삭제하면 "왜 이렇게 했는지"를
   git 이력에서 재구성해야 한다.
3. 살아 있는 폴더는 어느 mainPlan 캠페인이 그것을 쓰는지 README 첫 줄에 적는다. 아무도 안 쓰는데 살아
   있으면 그것은 살아 있는 것이 아니다.
4. 삭제는 폴더째 한다. 파일 몇 개만 남기는 것은 규칙이 금지하는 형태다.
5. 판정 표를 `tests/attempts/README.md`에 남기지 않는다(그 파일은 규칙 문서다). 판정 결과는 커밋 메시지와
   승격된 `docs/` 문서에 산다.

## 영향 파일

기존: `tests/attempts/**`, `tests/attempts/README.md`, 승격 대상이 갈 `docs/` 문서들, `tests/gateFloor.json`
(문서 기반 법의 체크 수가 줄어들 수 있다)

신규: 승격으로 생기는 `docs/` 문서(있다면)

## 검증

- `npm test` green. 폴더가 줄면서 문서 기반 법의 체크 수가 내려가므로 `tests/gateFloor.json`의 해당 하한을
  **같은 커밋에서** 내리고, 내린 이유를 커밋 메시지에 적는다. 하한을 내리는 diff가 곧 심사 지점이다.
- 상대 링크 생존 게이트가 green. 삭제한 폴더를 가리키는 링크가 `docs/`나 README에 남으면 RED가 된다.

음성 시험

- 삭제한 폴더를 가리키는 링크를 일부러 남긴 사본이 링크 게이트에서 RED가 되는지 확인한다(승격 누락을
  잡는 장치가 그것이다).

## 롤백

폴더 삭제는 revert로 복구된다. 승격 문서가 먼저 들어가 있으므로 되돌려도 지식은 남는다.

## 커밋 분할

1. 판정과 승격(문서만 추가, 삭제 없음)
2. 종결 폴더 삭제 + 하한 조정
