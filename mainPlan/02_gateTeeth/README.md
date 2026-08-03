# gateTeeth

판정자를 믿을 수 있게 만든다. 뒤의 모든 캠페인은 커밋 메시지에 "어느 게이트가 green"을 적는데, 지금 그
게이트 중 넷은 시험 대상 페이지가 스스로 낸 합격 선언을 그대로 믿는다. 그 상태에서 리팩터를 하면 검증 줄이
다시 주장이 된다.

## Outcome brief

- 주 축: 전 축(판정 인프라)
- 관측된 손실 지점: `tests/browser/run.mjs`는 이미 옳은 판정을 갖는데, 형제 러너 4개는 `result.ok`를 그대로
  최종 판정으로 쓴다. 소스를 좁히는 법 4개는 나이브 전처리라 같은 줄에 URL이 있으면 눈이 먼다.
- 기대 변화: 페이지가 무엇을 주장하든 러너가 다시 판정한다. 검사를 지우거나 약화시키는 편집이 RED가 된다.
- 롤백 반경: 전부 `tests/` 안이라 제품 코드 위험 0.

## 근거

- `tests/browser/run.mjs:173-181`이 이 실패 모드를 이미 고쳤고 그 이유를 기록한다("판정은 러너가 한다.
  15개 페이지가 각자 사본을 갖고 있었고 어느 게이트도 그 공식을 강제하지 않았다").
- 같은 수정이 없는 러너 넷:
  - `tests/browser/examples.mjs:48` `if (result.ok !== true) failed++` - `result.checks`를 판정에 쓰지 않는다
  - `tests/browser/socketLane.mjs:79-80` `process.exit(result.ok === true ? 0 : 1)`
  - `tests/browser/goldenWorkflow.mjs:78` `result.ok && passCount > 0`
  - `tests/browser/installedPackageGate.mjs:598` `result.ok && coverageOk`
- `tests/browser/harness.mjs`의 export는 `findBrowser`, `headlessArgs`, `killBrowser`, `launchBrowser` 넷뿐이다.
  공용 판정 함수가 없다.
- 나이브 전처리 4곳: `tests/run.mjs:798`(힙 물질화 법), `:812`(MB 단위 법), `:838`(공유 헬퍼 import 실존),
  `:878`(엔진 내부 접근 법, 106 checks). 옳은 헬퍼 `stripComments`는 `:62`에 이미 있고 코덱 법과 로케일 법은
  그것을 쓴다.
- 그 전처리로 실제 잘리는 줄 6개: `src/runtime/runtime.js:94`, `src/runtime/assets.js:87`,
  `src/runtime/preflight.js:14`, `src/runtime/pyodideDistribution.js:7`,
  `src/runtime/engines/wasi/wasiSession.js:37`, `src/capabilities/envManager.js:73`.
- 정적 파싱 부재: `tests/tsconfig.json:12` `"allowJs": false`. package exports 정적 그래프에서 미도달 7파일
  (`machineWorker.js`, `pyprocSw.js`, `workerHostedGuestWorker.js`, wasi 3파일, `envManager.js`)은 Node가 파스조차
  하지 않는다.
- 손유지 목록의 침묵: `tests/run.mjs:892`의 `PURE_STATE`가 5파일인데 `src/state`에는 8파일이 있다.
  `src/state/bundleFormat.js`는 provider 주입형만 쓰는 순수 커널인데 순수 검사를 안 받는다. 빠진 파일은 아무
  검사도 안 받고 출력에도 나타나지 않는다.

## 입장 조건

없다. 다만 브라우저 레인에 손대므로, 착수 시점부터 게이트 출력을 전량 파일로 남긴다(미해결 감시 항목인
119/120 콜드 RED와 새 판정을 섞지 않기 위해서다).

## 범위

포함

- `harness.judgeReport()` 신설과 러너 4개의 수렴
- `stripComments` 수렴 4곳 + 그 전처리가 하나뿐임을 강제하는 메타 법
- 순수 집합 목록의 **등재 강제**(빠진 파일이 있으면 RED)
- ESM 파스 게이트
- `pre-push`에 타입 게이트 추가

제외

- 면제 목록 크기 예산: 기각했다(루트 README "기각한 것" 참조). 06의 파일 이동이 옳은 답이다.
- 기존 체크에 자기시험 소급 의무화: 기각했다. 전방 규칙만 세운다.
- `PURE_STATE`의 denylist 반전: 기각했다. 등재 강제로 같은 침묵을 없앤다.
- 성능 예산 확장은 03이다.

## 구현 계약

1. `tests/browser/harness.mjs`에 `judgeReport(page, result, { floors })`를 만든다. 판정식은
   `checks.length > 0 && checks.every(pass) && passed >= floor(page)`이고 페이지가 보낸 `ok`는 참고값으로
   강등한다. `tests/browser/run.mjs:173-181`의 판정을 **복사가 아니라 이동**한다.
2. 러너 4개가 `judgeReport`만 부르게 한다. 전환은 기존 판정과 동치인 상태로 먼저 착지시키고, 그 다음
   커밋에서 페이지별 하한을 조인다. 넷을 한 커밋에 동시 전환하면 진짜 회귀와 새 판정자를 구분할 수 없다.
3. `tests/browser/gateFloor.json`에 examples 레인 페이지별 최소 통과 체크 수를 등재한다.
4. `tests/run.mjs:798, 812, 838, 878`을 `stripComments()`로 교체한다.
5. `[탐지기 자기 시험]` 절에 메타 법을 더한다: `tests/run.mjs` 자기 소스에서 `split("//")[0]` 출현 수가 0이다.
6. `PURE_STATE`를 "등재 강제"로 바꾼다: `src/state/*.js` 전체를 나열하고, 각 파일이 순수 목록이나 명시적
   제외 목록(현재 `opfsStateStore.js`, `index.js`) 중 정확히 한쪽에 있어야 한다. 어느 쪽에도 없으면 RED.
7. `tests/contracts/sourceParses.mjs`를 신설한다. `--experimental-vm-modules`로 자식 하나를 띄우고
   `new vm.SourceTextModule(code)`로 `src/**/*.js` 126파일을 파스만 한다(평가 없음). 파일별 `node --check`
   spawn은 채택하지 않는다(Windows 실측 22.7s로 게이트 예산을 두 배로 만든다).
8. `.githooks/pre-push`의 구조 게이트 호출 뒤에 `tsc -p tests/tsconfig.json`을 더한다. `typescript`가 없으면
   조용히 넘기지 않고 명시적으로 차단한다(증거 없음은 통과가 아니다).

## 성능 계약

- `npm test` 총 시간은 파스 게이트 포함 13초를 넘지 않는다(현재 11.5초, 파스는 단일 spawn 약 1초).
- `git push`는 타입 게이트 포함 20초를 넘지 않는다(현재 약 15초 + 실측 4.5초).

## 영향 파일

기존: `tests/browser/harness.mjs`, `tests/browser/run.mjs`, `tests/browser/examples.mjs`,
`tests/browser/socketLane.mjs`, `tests/browser/goldenWorkflow.mjs`, `tests/browser/installedPackageGate.mjs`,
`tests/browser/gateFloor.json`, `tests/run.mjs`, `tests/gateFloor.json`, `tests/contracts/run.mjs`, `.githooks/pre-push`

신규: `tests/contracts/sourceParses.mjs`

## 검증

- `npm test`, `npm run test:browser`, `npm run test:examples`, `npm run test:socket`, `npm run test:golden`,
  `npm run test:installed` 전부 green
- `node tests/contracts/run.mjs` green

음성 시험

- `judgeReport`에 `{ ok: true, checks: [{ pass: false }] }`와 `{ ok: true, checks: [] }` 두 fixture를 매 실행
  주입해 둘 다 RED가 나오는지 본다(`tests/run.mjs`의 `bites()` 패턴과 같은 형태).
- 러너 소스에 `result.ok`를 최종 판정으로 되살린 오염 fixture를 텍스트 법에 먹여 RED 확인.
- 나이브 전처리 fixture: `const u = "https://x"; const m = _module.a;`에 옛 전처리를 먹이면 `_module.`이
  사라지고 `stripComments`는 보존한다는 것을 매 실행 단정한다. `run.mjs` 사본에 `split("//")[0]`을 한 줄
  심어 메타 법이 RED인지도 본다.
- 파스 게이트: 읽은 소스 문자열에 `const = ;`를 주입한 fixture가 RED(디스크는 건드리지 않는다). 그리고
  "126개 중 0개 파스"가 되도록 파서를 no-op으로 만든 사본이 RED가 되게 파스 성공 수 하한도 함께 단정한다.
- `pre-push` 타입 게이트: `index.d.ts`에 타입 오류 한 줄을 주입한 트리에서 push가 blocked인지, 그리고
  `typescript` 미설치 상태에서도 통과가 아니라 차단인지 둘 다 확인한다.

## 롤백

전부 `tests/`와 `.githooks/`라 제품 코드 영향이 0이다. 러너 전환이 문제를 내면 그 러너만 이전 판정으로
되돌린다. 파스 게이트가 느리면 그것만 뺀다.

## 커밋 분할

1. `judgeReport` 신설 + 러너 4개 동치 전환 + 음성 fixture
2. examples 레인 하한 등재 + 페이지별 단정 강도 조이기
3. 정적 게이트 위생(stripComments 수렴 + 메타 법 + 순수 집합 등재 강제)
4. 파스 게이트 + `pre-push` 타입 게이트
