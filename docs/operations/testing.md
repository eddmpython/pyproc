# 테스트 - 게이트와 브라우저 실측

WASM 런타임 특성상 진짜 검증은 브라우저에서만 가능하다. 그래서 검증은 4단이다: Node 구조 게이트(커밋마다), 브라우저 런타임 게이트(공개 표면의 실동작), **예제 실행 게이트(데모 페이지 완주)**, 수동 실측(사람 눈 확인·벤치). 셋 다 CI에서 매 푸시마다 돈다.

## 1. Node 구조 게이트 (`npm test`)

```bash
npm test          # = node tests/run.mjs, 의존성 0
```

커밋 전 반드시 green. 검사 항목:

- **공개 표면**: `index.js`가 계약한 export(이름·타입)를 전부 내는가.
- **능력 계약 형태**: `Runtime`/`PyProc`/`ReactiveController` 프로토타입 메서드 존재.
- **타입 커버리지**: `index.d.ts`가 공개 표면을 전부 선언하고 `package.json`이 이를 배선하는가.
- **문서 위생**: 전체 `*.md`/`*.js`에 em dash(U+2014) 0.
- **상대 링크**: 모든 `*.md`의 상대 링크가 실존 파일을 가리키는가(죽은 링크 차단).
- **attempts 구조**: `tests/attempts/` 각 카테고리에 README(+ 졸업 게이트 절)가 있는가.
- **mainPlan 구조**: 각 이니셔티브 폴더에 README가 있는가.
- **worker 계약**: `src/processOs/worker.js`가 boot/task 프로토콜을 처리하는가(텍스트 검사. Node에서 import 불가).

새 규칙을 만들면 가능한 한 여기(또는 `.githooks`)에 기계 가드를 짝지어 추가한다.

## 2. 브라우저 런타임 게이트 (`npm run test:browser`)

```bash
npm run test:browser    # = node tests/browser/run.mjs, 의존성 0
```

COOP/COEP 서버를 임시 포트로 띄우고, 로컬 Chromium 계열 브라우저(Edge/Chrome 자동 탐색, `PYPROC_BROWSER=<경로>`로 지정 가능)를 headless로 실행해 `tests/browser/gate.html`의 실측 결과를 POST 백채널로 회수한다. 공개 표면이 진짜 브라우저에서 도는지를 커밋 단위로 검증하는 게이트다:

- crossOriginIsolated 전제, `boot()` + 파이썬 실행.
- 복원 리액티브의 실행 경계 계약(경계를 닫은 `restoreLive`, 안전 기준선 `restore`).
- 스냅샷-fork spawn, `map` 병렬 결과 정확성, `mapSerial` 일치, `ps`/`terminate`.

런타임 동작을 바꾸는 커밋은 이 게이트 green이 조건이다. 실측 수치(부팅/복원/fork/map ms)가 함께 출력되므로, 의미 있는 변화는 활성 이니셔티브의 진행 원장에 기록한다(활성이 없으면 다음 이니셔티브 개설과 함께 시작. 직전 원장: [mainPlan/_done/web-python-runtime/03-progress-ledger.md](../../mainPlan/_done/web-python-runtime/03-progress-ledger.md)). CI에서도 같은 게이트가 돈다(`.github/workflows/ci.yml`).

## 3. 예제 실행 게이트 (`npm run test:examples`)

```bash
npm run test:examples    # = node tests/browser/examples.mjs, 의존성 0
```

데모 페이지(`examples/*.html`)를 **사람이 여는 그대로** headless로 열어 완주 여부를 회수한다.
각 예제는 `?gate` 쿼리에서만 POST 백채널로 보고하고, 사람이 열면 아무것도 안 한다.
생긴 이유(2026-07-12): 라이브러리 게이트는 라이브러리만 검증해서, 예제 코드의 실결함
(BigInt 직렬화)이 라이브 데모까지 나갔다. 데모는 공개 진열장이므로 이 게이트가 회귀를 막는다.

## 4. 수동 실측 (examples/)

crossOriginIsolated(COOP/COEP 헤더) 페이지에서만 SharedArrayBuffer가 열리므로, 동봉된 서버로 띄운다:

```bash
npm run serve     # = node examples/serve.mjs (COOP/COEP 헤더 포함, 의존성 0)
```

Chromium/Edge에서 확인:

| 페이지 | 확인하는 것 | green 기준 |
|---|---|---|
| `http://localhost:8788/examples/basic.html` | 단일 런타임 부팅 + 파이썬 실행 + numpy 로드 | sum=4950, numpy sum=45 출력 |
| `http://localhost:8788/examples/processOs.html` | 스냅샷-fork spawn + map 병렬 vs 직렬 | forked=true, speedup > 1, 결과 일치 true |

체크리스트:

- 콘솔에 `crossOriginIsolated`가 true인지(`false`면 헤더 문제).
- 공개 표면·런타임 동작을 바꾼 커밋은 실측 결과(수치)를 활성 이니셔티브의 진행 원장에 남긴다(활성 0이면 다음 이니셔티브에서). README의 실측 수치는 그 원장에서만 가져온다. 과거 수치의 출처: [mainPlan/_done/web-python-runtime/03-progress-ledger.md](../../mainPlan/_done/web-python-runtime/03-progress-ledger.md).

## 5. 개념증명 실측 (tests/attempts/)

신규 능력의 실측은 examples가 아니라 `tests/attempts/<카테고리>/`의 probe에서 한다. probe도 같은 서버로 띄운다(`http://localhost:8788/tests/attempts/...`). 결과 기록 형식은 [tests/attempts/README.md](../../tests/attempts/README.md) 참조.
