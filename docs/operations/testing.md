# 테스트 - 게이트와 브라우저 실측

WASM 런타임 특성상 진짜 검증은 브라우저에서만 가능하다. 그래서 검증은 5단이다: Node 구조 게이트(커밋마다), 브라우저 런타임 게이트(공개 표면의 실동작), **브라우저 제품 소비자 게이트(설치 패키지 소비)**, **예제 실행 게이트(데모 페이지 완주)**, 수동 실측(사람 눈 확인·벤치). 자동 게이트는 CI에서 매 푸시마다 돈다.

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
- **실행 자산 manifest**: `getPyProcAssetManifest()`와 `pyproc-assets` CLI가 Worker/SW graph + SRI manifest를 만들고, `--copy-to`로 필요한 파일을 복사하며, 브라우저 게이트 서버가 그 CLI 산출물을 `/pyproc-assets.json`으로 제공하고 `verifyPyProcAssetIntegrity()`가 잘못된 SRI를 spawn 전 거부하는가.
- **패키지 소비자 계약**: `npm pack` tarball을 임시 앱에 설치한 뒤 `pyproc`, `pyproc/assets`, 설치된 `pyproc-assets` bin만으로 public import, graph SRI manifest, `--copy-to` 복사가 성립하는가(`npm run test:package`로 단독 실행 가능).

새 규칙을 만들면 가능한 한 여기(또는 `.githooks`)에 기계 가드를 짝지어 추가한다.

## 2. 브라우저 런타임 게이트 (`npm run test:browser`)

```bash
npm run test:browser    # = node tests/browser/run.mjs, 의존성 0
```

COOP/COEP 서버를 임시 포트로 띄우고, 로컬 Chromium 계열 브라우저(Edge/Chrome 자동 탐색, `PYPROC_BROWSER=<경로>`로 지정 가능)를 headless로 실행해 `tests/browser/gate.html`의 실측 결과를 POST 백채널로 회수한다. 공개 표면이 진짜 브라우저에서 도는지를 커밋 단위로 검증하는 게이트다:

- crossOriginIsolated 전제, `boot()` + 파이썬 실행.
- `pyproc-assets` CLI 산출 manifest를 같은 오리진에서 fetch하고, `assetIntegrity`로 `PyProc` worker graph와 `Runtime -> SyscallBridge` child worker 상속 경로를 spawn 전 검증.
- 복원 리액티브의 실행 경계 계약(경계를 닫은 `restoreLive`, 안전 기준선 `restore`).
- 스냅샷-fork spawn, `map` 병렬 결과 정확성, `mapSerial` 일치, `ps`/`terminate`.

런타임 동작을 바꾸는 커밋은 이 게이트 green이 조건이다. 실측 수치(부팅/복원/fork/map ms)가 함께 출력되므로, 의미 있는 변화는 활성 이니셔티브의 진행 원장에 기록한다(활성이 없으면 다음 이니셔티브 개설과 함께 시작. 직전 원장: [mainPlan/_done/web-python-runtime/03-progress-ledger.md](../../mainPlan/_done/web-python-runtime/03-progress-ledger.md)). CI에서도 같은 게이트가 돈다(`.github/workflows/ci.yml`).

## 3. 브라우저 제품 소비자 게이트 (`npm run test:consumer`)

```bash
npm run test:consumer
PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:consumer    # 자가 호스팅 엔진으로 설치 패키지 소비 검사
```

`npm pack`으로 만든 tarball을 임시 앱에 설치한 뒤, 브라우저 import map에서 `pyproc`와 `pyproc/assets` public specifier만 노출한다. 그 앱이 설치된 `pyproc-assets`로 `/node_modules/pyproc/` 기준 SRI manifest를 만들고, headless Chromium에서 다음을 검증한다:

- 설치된 패키지의 public specifier import가 동작한다.
- 설치된 worker graph의 SRI manifest가 실제 `node_modules/pyproc/src/...` 바이트와 일치한다.
- 설치된 `pyprocSw.js`를 SRI 검증 후 `asgi=/pyproc/`로 등록하고, `VirtualOrigin` fetch가 Python ASGI까지 도달한다.
- 잘못된 worker SRI는 `PyProc` worker spawn 전에 거부된다.
- 설치된 `Runtime`과 `PyProc` worker가 같은 브라우저 앱 안에서 실제로 돈다.

이 게이트는 "repo에서는 되는데 소비 앱에서는 깨지는" 구조 결함을 막는다. 특히 `asgi=/pyproc/`가 `/node_modules/pyproc/...` 패키지 자산을 오인해 가로채는 충돌을 막기 위해, `VirtualOrigin` fetch 뒤에도 `PyProc` worker graph 검증과 실행이 통과해야 한다. CI에서도 돈다.

## 4. 예제 실행 게이트 (`npm run test:examples`)

```bash
npm run test:examples    # = node tests/browser/examples.mjs, 의존성 0
PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples    # 자가 호스팅 엔진으로 같은 예제 검사
```

데모 페이지(`examples/*.html`)를 **사람이 여는 그대로** headless로 열어 완주 여부를 회수한다.
각 예제는 `?gate` 쿼리에서만 POST 백채널로 보고하고, 사람이 열면 아무것도 안 한다.
생긴 이유(2026-07-12): 라이브러리 게이트는 라이브러리만 검증해서, 예제 코드의 실결함
(BigInt 직렬화)이 라이브 데모까지 나갔다. 데모는 공개 진열장이므로 이 게이트가 회귀를 막는다.
`PYPROC_INDEX_URL`을 주면 런타임 게이트와 같은 방식으로 예제 전체가 자가 호스팅 엔진 배포판을 쓴다.
`machine.html`의 gate는 코드 실행뿐 아니라 signed `.pymachine` cast, trusted public key open, `/home/web` 복원을 함께 검증한다.
`speedLab.html`의 gate는 단일 worker numpy matmul과 4-worker sharded matmul 결과가 일치하고 같은 run에서 speedup이 1을 넘는지 검증한다.

## 5. 수동 실측 (examples/)

crossOriginIsolated(COOP/COEP 헤더) 페이지에서만 SharedArrayBuffer가 열리므로, 동봉된 서버로 띄운다:

```bash
npm run serve     # = node examples/serve.mjs (COOP/COEP 헤더 포함, 의존성 0)
```

Chromium/Edge에서 확인:

| 페이지 | 확인하는 것 | green 기준 |
|---|---|---|
| `http://localhost:8788/examples/basic.html` | 단일 런타임 부팅 + 파이썬 실행 + numpy 로드 | sum=4950, numpy sum=45 출력 |
| `http://localhost:8788/examples/serverDev.html` | FastAPI/SQLite + VirtualOrigin 서버 개발 루프 | iframe preview, POST todo, app.py v2 reload |
| `http://localhost:8788/examples/speedLab.html` | 단일 worker numpy matmul vs 4-worker sharded matmul | 결과 일치, speedup > 1 |
| `http://localhost:8788/examples/processOs.html` | 스냅샷-fork spawn + map 병렬 vs 직렬 | forked=true, speedup > 1, 결과 일치 true |

체크리스트:

- 콘솔에 `crossOriginIsolated`가 true인지(`false`면 헤더 문제).
- 공개 표면·런타임 동작을 바꾼 커밋은 실측 결과(수치)를 활성 이니셔티브의 진행 원장에 남긴다(활성 0이면 다음 이니셔티브에서). README의 실측 수치는 그 원장에서만 가져온다. 과거 수치의 출처: [mainPlan/_done/web-python-runtime/03-progress-ledger.md](../../mainPlan/_done/web-python-runtime/03-progress-ledger.md).

## 6. 개념증명 실측 (tests/attempts/)

신규 능력의 실측은 examples가 아니라 `tests/attempts/<카테고리>/`의 probe에서 한다. probe도 같은 서버로 띄운다(`http://localhost:8788/tests/attempts/...`). 결과 기록 형식은 [tests/attempts/README.md](../../tests/attempts/README.md) 참조.
`runtimeParity/virtualOriginBoundaryProbe.html`처럼 "지원하지 않는 벽"을 제품 계약으로 고정하는 probe도 여기에 둔다. 이런 probe는 기능 확장이 아니라 소비자가 쿠키 세션, WebSocket upgrade, 청크 스트리밍 같은 플랫폼 벽에 의존하지 않도록 막는 compatibility lab이다.
