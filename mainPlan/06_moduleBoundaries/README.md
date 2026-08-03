# moduleBoundaries

층 계약을 코드가 아니라 **폴더에서** 읽을 수 있게 만든다. 값 그래프는 이미 깨끗하다(307 edge 중 위반 0).
문제는 타입 그래프가 반대 방향이고, 순수 집합이 손으로 유지하는 목록이며, 능력이 아닌 것이 능력 폴더에
사는 것이다.

## Outcome brief

- 주 축: 모듈화, 폴더구조
- 관측된 손실 지점: `Runtime` 타입을 고치려면 rank 0 파일이 아니라 최상단 `index.d.ts`를 열어야 한다.
  순수 집합 목록에서 빠진 파일은 아무 검사도 안 받고 출력에도 나타나지 않는다. 새 파일을 만들 때마다 게이트
  소스를 열어 등재를 판단해야 한다.
- 기대 변화: rank가 폴더에서 유도되고, 타입 edge도 값 edge와 같은 규칙을 받는다.
- 롤백 반경: 대부분 파일 이동이라 되돌리기가 쉽다. 다만 `.d.ts` 방향 수정은 타입 계약이라 `test:types`가
  판정자다.

## 근거

- `src/runtime/index.d.ts:2-10`이 `"../../index.js"`에서 `BootOptions`, `EngineContract`, `EnvReport`,
  `FileSystem`, `MemoryCapability`, `Runtime`, `RuntimeContract`를 import한다. rank 0이 최상단을 역참조한다.
- `src/capabilities/socketBridge.d.ts:3`도 같은 형태다(rank 2 -> 루트).
- 레이어 게이트는 `collect(join(ROOT, "src"), [".js"], [])`라 `.d.ts`를 수집하지 않는다. 계약의 절반이
  검사 밖이다.
- `tests/run.mjs:2703-2721`의 `machinePureFiles`는 11개 파일 allowlist다. 주석이 이유를 적는다:
  "폴더가 아니라 파일인 이유: snapshotEnvelope/machineManifest는 image/에 살지만 계약 층이다".
  빠뜨리면 자동으로 platform으로 판정돼 순수성 검사를 아예 안 받는다.
- 반대 오염도 있다: `src/machine/contracts/byteCodec.js`는 `contracts/`에 있지만 `atob`/`Buffer` 전역 때문에
  실제로는 platform이다(`tests/run.mjs:2709` 주석이 명시).
- `tests/run.mjs:892`의 `PURE_STATE`는 5파일인데 `src/state`에는 8파일이 있다(02가 등재 강제로 닫는다).
- `src/capabilities/` 최상위에 능력이 아닌 파일 5개가 산다. 실제 registry 설치 능력은
  `src/composition/runtimeBindings/*.js` 기준 10개다.
  - `pyprocSw.js`(217줄, import 0, 배포 자산), `heapMaterialize.js`, `machineHome.js`, `imagePortability.js`
    (셋 다 내구 이미지 법), `envManager.js`(참조 0, 공개 0)
- `src/machine/coordination/`은 파일 하나짜리 폴더이고 규칙도 rank도 `persistence/`와 같다
  (`tests/support/structureWebMachine.mjs:271`이 셋을 동일 취급).
- `src/machine/guests/`는 18파일 평면 네임스페이스이고 접두사(`v86*` 13, `pyproc*` 3)가 폴더 역할을 대신한다.
- `src/machine/image/webMachineFile.js:17`과 `webMachineTrust.js:7`이 `persistence/generationIntegrity.js`를
  당긴다. 그 파일은 저장소가 아니라 무결성 계약이다(헤더가 그렇게 적는다).
- 상향 자산 edge 유일성 주장의 실효 범위: `tests/run.mjs:96-105`의 newURL 탐지는 리터럴 한 형태뿐이다.
  `src/machine/guests/workerHostedGuestAdapter.js:30-32,138`은 주입받은 `workerURL`로 `new Worker`를 한다.
- `docs/operations/moduleBoundaries.md` 전문에 "machine" 문자열이 0건이고 rank 표도 없다. CLAUDE.md가 그것을
  SSOT로 지목하는데 절반만 담고 있다.

## 입장 조건

- 02가 끝나 있다(같은 게이트 파일을 만진다).
- `byteCodec.js`의 목적지를 먼저 정한다. `machine/` 하위에 platform 전용 폴더가 없고 소비자가 image, devices,
  persistence 셋에 흩어져 있다. 폴더 신설 여부 결정이 착수 전 게이트다.

## 범위

포함

- `.d.ts` 방향 뒤집기와 레이어 게이트의 `.d.ts` 수집
- 비리터럴 워커 스폰 탐지
- `machinePureFiles` allowlist를 파일 이동으로 소멸
- `capabilities/`에서 능력이 아닌 파일 재배치
- `machine/coordination` 흡수, `machine/guests` 하위 분할
- `docs/operations/moduleBoundaries.md`에 rank 표와 machine 내부 rank 추가

제외

- `src/capabilities/pyprocSw.js` 이동은 **하지 않는다.** `src/runtime/assets.js`가 그 경로를 자산 계약으로
  들고 있어서 경로 변경은 배포한 소비자의 SW 등록 URL을 깬다. 릴리즈 사유이므로 10에서 다룬다.
- `exports` 맵의 5개 subpath 뒤에 배럴을 넣는 것은 이 캠페인 뒤로 미룬다(공개 specifier는 안 바뀌지만
  `.d.ts` 이동이 함께 필요해 diff가 커진다).
- `envManager.js`는 참조 0이라 삭제 후보지만, 삭제는 04와 같은 성격이므로 여기서는 rank 3 이동만 한다.

## 구현 계약

1. `Runtime`, `MemoryCapability`, `FileSystem`, `EngineContract`, `RuntimeContract`, `BootOptions`, `EnvReport`의
   **정의를 `src/runtime/index.d.ts`로 내리고** 루트 `index.d.ts`가 `export type { ... } from "./src/runtime/index.js"`로
   재수출한다. 값 방향과 같아진다.
2. `src/capabilities/socketBridge.d.ts:3`이 `../runtime/index.js`를 가리키게 한다.
3. 레이어 게이트의 수집 확장자를 `[".js", ".d.ts"]`로 넓힌다. **1과 2를 먼저 착지시킨 뒤** 켠다. 순서를
   뒤집으면 즉시 RED다.
4. `tests/run.mjs`의 `jsModuleRefs`에 `workerSpawn` kind를 추가한다. `new Worker(<식별자>` / `new SharedWorker(<식별자>`를
   탐지하고, 정적으로 못 푸는 스폰은 "주입 스폰 선언 목록"에 등재돼야 통과한다(현재 유일 항목:
   `workerHostedGuestAdapter.js`, 주입원 `createWebComputer.js:72`).
5. `tests/run.mjs:2896`의 `if (!target) continue`를 bare import 금지로 바꾼다. machine 게이트는 이미 문다.
   현재 src에 bare import 0건이라 즉시 green이다.
6. 파일 이동으로 `machinePureFiles`를 소멸시킨다.
   - `src/machine/image/snapshotEnvelope.js` -> `src/machine/contracts/`
   - `src/machine/image/machineManifest.js` -> `src/machine/contracts/`
   - `src/machine/contracts/byteCodec.js` -> 입장 조건에서 정한 platform 폴더
   - `machineFileRank`를 폴더만 보는 형태로 축약하고 Set을 삭제한다.
7. `src/capabilities/image/`를 만들고 `heapMaterialize.js`, `machineHome.js`, `imagePortability.js`를 옮긴다.
   헤더에 "Runtime 핸들 위에서 도는 내구 이미지 법. 능력이 아니므로 registry에 등재하지 않는다"를 명시한다.
8. `src/capabilities/envManager.js`를 `src/composition/`으로 옮긴다. `capabilityToRuntimeBudget`의 세 줄이
   소멸한다.
9. `src/machine/coordination/webLockOwnerCoordinator.js`를 `persistence/`로 옮기고 폴더를 삭제한다.
   `structureWebMachine.mjs`의 `expected` 배열과 folder 목록에서 `coordination`을 뺀다.
10. `src/machine/guests/` 아래 `v86/`, `pyproc/`, `bridged/`를 만들고 18파일을 나눈다. `machineFileRank`가
    `relPath.split("/")[2] === "guests"`로 판정하므로 rank는 그대로 유지된다.
11. `src/machine/persistence/generationIntegrity.js`를 `image/` 또는 `contracts/`로 올린다(무결성은 이미지
    계약이라는 책임 기준). `contracts/` 승격은 브라우저 전역 접근 0 확인이 선결이다.
12. `docs/operations/moduleBoundaries.md`에 6층 rank 표와 machine 내부 rank, 순수 집합 불변식을 넣고,
    `tests/run.mjs:2770`의 CONTRIBUTING 대조를 이 문서에도 적용한다.

## 영향 파일

기존: `index.d.ts`, `src/runtime/index.d.ts`, `src/capabilities/socketBridge.d.ts`, `src/machine/index.js`,
`tests/run.mjs`, `tests/support/structureWebMachine.mjs`, `tests/support/structureWebComputer.mjs`,
`docs/operations/moduleBoundaries.md`, 이동 대상 파일들과 그 import 지점

신규: `src/capabilities/image/`(폴더), `src/machine/guests/{v86,pyproc,bridged}/`(폴더), platform 폴더(입장 조건에서 결정)

## 검증

- `npm test`, `npm run test:types`(1과 2의 판정자), `npm run test:browser`, `npm run test:package`
- `npm run test:web-machine`

음성 시험

- `.d.ts` 게이트: `src/runtime/index.d.ts`에 `from "../../index.js"`를 되살린 사본이 RED인지 확인한다.
  이것이 3의 이빨 증명이다.
- 워커 스폰 탐지: `src/capabilities/syscallBridge.js`에 `new Worker(someVar)`를 주입해 RED 확인. 선언 목록에
  등재하면 통과하는 것까지 본다(양방향).
- 순수 집합 소멸 확인: 이동 후 `machinePureFiles` Set을 지웠는데도 `contracts/`에 브라우저 전역을 한 줄
  넣으면 RED가 되는지 본다(rank가 폴더에서 유도되는지의 증명).
- bare import: `src/`의 아무 파일에 `import x from "node:fs"`를 넣어 RED 확인.

## 롤백

이동은 순수 이동이라 되돌리기 쉽다. `.d.ts` 방향 수정만 타입 계약에 닿으므로 그것만 독립 커밋으로 내고,
`test:types`가 RED면 그 커밋만 되돌린다.

## 커밋 분할

1. `.d.ts` 방향 수정(정의를 아래로, 루트는 재수출) + 레이어 게이트 `.d.ts` 수집 + 음성 시험
2. 워커 스폰 탐지 + bare import 금지
3. machine 순수 집합 파일 이동 + `machineFileRank` 축약 + Set 삭제
4. `capabilities/` 재배치(`image/` 신설, `envManager` 이동)
5. `machine/coordination` 흡수 + `guests/` 하위 분할
6. `moduleBoundaries.md` rank 표 + 문서 대조 게이트
