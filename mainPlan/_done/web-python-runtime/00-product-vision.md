# 00. 이니셔티브 범위와 소비자 실태

상태: v0.3 (2026-07-11). 제품 방향의 정본은 [docs/product/vision.md](../../../docs/product/vision.md)로 이관했다(지속 문서는 docs, 이 트리는 개발 계획이라 완료 시 `_done`으로 빠지기 때문). 여기는 **이 이니셔티브가 그 방향에서 맡는 범위**와 착수 시점의 소비자 실태만 담는다.

## 이 이니셔티브의 범위

web-python-runtime 이니셔티브는 pyproc의 코어 런타임을 세우고 세 소비 제품(codaro/dartlab/xlpod)의 실소비를 성립시키는 것까지다:

1. 코어 4모듈(런타임/복원 리액티브/프로세스 OS/능력 계약)의 승격과 레이어 구조 확립. (완료)
2. 운영 체계(attempts 졸업 게이트, mainPlan 수명주기, docs, 기여 정책) 수립. (완료)
3. codaro UI 배선 동행, xlpod 이관 전제(동기 UDF 흡수) 충족, dartlab 소비 개시. (진행)

이 범위가 끝나면 폴더째 `_done`으로 이관하고, 다음 능력(로드맵 후보)은 각자 새 이니셔티브로 연다.

## 소비자 실태 (2026-07-11 조사 확정)

| 소비자 | 상태 | 증거 |
|---|---|---|
| codaro | **first consumer. SHA 핀 import 완료** | `editor/package.json`에 `github:eddmpython/pyproc#<sha>` 핀. `editor/src/lib/browserPythonRuntime.ts`가 `boot`/`PyProc`와 타입(`BootOptions`/`Runtime`/`PyProcBootInfo`)을 import. UI 표면 배선 전(seam 존재). |
| xlpod | **소비 예약. 자체 Pyodide 워커 운용 중** | `src/xlpod/engine/pyodideWorker.js`+`pyBridge.js`로 `=PYUDF` 동기 실행. 문서(`mainPlan/prd/08-runtime-notebook.md` §1.5.3)가 "정식 패키지 승격 시 능력 계약 뒤로 이관"을 명시. 하드 제약: **Pyodide v314.0.2 정합**과 `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면 보존. |
| dartlab | 미착수 | 점진 이관 대상. |

여기서 나오는 하드 계약 2개(정본은 [소비 계약](../../../docs/consuming/contract.md)):
1. **공개 표면 시그니처는 codaro 빌드가 컴파일 의존한다.** `boot(opts)`, `Runtime.run`, `PyProc.boot(n)`, `PyProc.map(fnSrc, args)`, 타입 3종. 파괴적 변경은 릴리즈 노트 없이 금지.
2. **Pyodide 기본 버전은 v314.0.2 (CPython 3.14).** 세 제품이 같은 런타임을 공유해야 xlpod 이관이 성립한다. 버전 올릴 때는 소비자와 동시 이동.
