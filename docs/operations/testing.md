# 테스트 - 게이트와 브라우저 실측

WASM 런타임 특성상 진짜 검증은 브라우저에서만 가능하다. 그래서 검증은 2단으로 나뉜다: Node 구조 게이트(커밋마다, 기계 강제)와 브라우저 실측(런타임 동작 확인, 절차 강제).

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

## 2. 브라우저 실측 (examples/)

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
- 공개 표면·런타임 동작을 바꾼 커밋은 실측 결과(수치)를 [진행 원장](../../mainPlan/web-python-runtime/03-progress-ledger.md)에 남긴다. README의 실측 수치는 이 원장에서만 가져온다.

## 3. 개념증명 실측 (tests/attempts/)

신규 능력의 실측은 examples가 아니라 `tests/attempts/<카테고리>/`의 probe에서 한다. probe도 같은 서버로 띄운다(`http://localhost:8788/tests/attempts/...`). 결과 기록 형식은 [tests/attempts/README.md](../../tests/attempts/README.md) 참조.
