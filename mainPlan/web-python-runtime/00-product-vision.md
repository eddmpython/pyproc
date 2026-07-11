# 00. 제품 비전 - 무엇을, 누구를 위해, 왜

상태: v0.2 (2026-07-11). 구 `docs/PRD.md`의 비전·정책부를 이관하고 소비자 실태 조사로 갱신했다.

## North Star (한 줄)

**서버 없이 브라우저 탭에서 파이썬을 "노트북 한 셀"이 아니라 운영체제처럼 돌린다. 프로세스·병렬·복원 리액티브를 하나의 재사용 런타임으로 묶어, codaro/dartlab/xlpod가 공유하는 웹 파이썬 런타임의 단일 진실(SSOT)이 된다.**

## 문제

브라우저에서 진짜 파이썬을 돌리는 조각(Pyodide, JSPI, File System Access, SharedArrayBuffer)은 이미 있다. 그러나 이들을 "실제 로컬 런타임처럼" 엮는 계층은 각 제품이 매번 새로 짠다. 그 결과:

- codaro·dartlab·xlpod가 같은 브라우저 파이썬 런타임을 필요로 하는데 각자 복붙하면 3벌로 갈라진다. 한 곳에서 버그를 고쳐도 나머지는 안 고쳐진다.
- Pyodide는 단일 인터프리터 한 개다. 병렬·프로세스·상태 복원 같은 "런타임의 물성"은 기본 제공되지 않아 매번 재발명된다.
- 브라우저의 부재 능력(socket/subprocess/blocking input)을 메우는 방식이 제품마다 제각각이라 재사용이 안 된다.

pyproc은 이 계층을 **한 번 제대로 만들어 버전 고정으로 공유**한다. 개선이 한 곳에 모이고, 세 제품이 실제로 import하면 자동으로 SSOT가 된다.

## 무엇인가 / 무엇이 아닌가

**pyproc이다:**
- 프레임워크 무관 ESM 라이브러리. 빌드 단계 없음(네이티브 `.js` + 손으로 유지하는 `.d.ts`).
- 브라우저 티어의 런타임 프리미티브: 런타임 부팅, 복원 리액티브, 프로세스 OS, 능력 계약.
- 교차 관심사(WASM 힙 접근·스택 포인터·몽키패치)를 능력 계약 뒤에 캡슐화한 깨끗한 소비 표면.

**pyproc이 아니다:**
- 제품 UI/도메인 로직(커리큘럼·자동화·시트 편집). 그건 소비 제품이 위에 얹는다.
- 실행 위치 배정 정책(capability router의 티어 판정). 그건 제품별로 달라 제품이 소유한다.
- 로컬 엔진/GitHub Actions 엔진. codaro의 3티어 실행 구조는 codaro 소유이고, pyproc은 그중 브라우저 티어의 프리미티브만 제공한다.
- Firefox/Safari 대응. 스코프 밖(아래 "지원 경계").

## 소비자 실태 (2026-07-11 조사 확정)

| 소비자 | 상태 | 증거 |
|---|---|---|
| codaro | **first consumer. SHA 핀 import 완료** | `editor/package.json`에 `github:eddmpython/pyproc#<sha>` 핀. `editor/src/lib/browserPythonRuntime.ts`가 `boot`/`PyProc`와 타입(`BootOptions`/`Runtime`/`PyProcBootInfo`)을 import. UI 표면 배선 전(seam 존재). |
| xlpod | **소비 예약. 자체 Pyodide 워커 운용 중** | `src/xlpod/engine/pyodideWorker.js`+`pyBridge.js`로 `=PYUDF` 동기 실행. 문서(`mainPlan/prd/08-runtime-notebook.md` §1.5.3)가 "정식 패키지 승격 시 능력 계약 뒤로 이관"을 명시. 하드 제약: **Pyodide v314.0.2 정합**과 `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면 보존. |
| dartlab | 미착수 | 점진 이관 대상. |

여기서 나오는 하드 계약 2개:
1. **공개 표면 시그니처는 codaro 빌드가 컴파일 의존한다.** `boot(opts)`, `Runtime.run`, `PyProc.boot(n)`, `PyProc.map(fnSrc, args)`, 타입 3종. 파괴적 변경은 소비자 patch 노트 없이 금지.
2. **Pyodide 기본 버전은 v314.0.2 (CPython 3.14).** 세 제품이 같은 런타임을 공유해야 xlpod 이관이 성립한다. 버전 올릴 때는 소비자와 동시 이동.

## 성공 / 실패 기준

- **성공**: 세 제품이 pyproc을 실제 import해서 각자 표면을 얹고, 브라우저 파이썬 런타임 개선이 pyproc 한 곳에 모인다. 소비자는 능력 계약만으로 복원 리액티브·프로세스 병렬을 쓰고 엔진 내부를 만지지 않는다.
- **실패**: 제품들이 여전히 각자 복붙해서 런타임이 갈라진다. 또는 pyproc이 제품 UI/도메인을 흡수해 범용성을 잃는다. 또는 계약이 자주 깨져 소비자가 매번 따라 고친다.

## 지원 경계 (Chromium/Edge 전용)

JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox/Safari 미지원은 결함이 아니라 스코프다. SharedArrayBuffer는 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

브라우저 티어의 영구 상한(정직하게): 네이티브 휠(torch 등)·데스크톱 조작(xlwings/pyautogui)·상주 스케줄은 브라우저에서 영원히 불가하다. 이는 기술 부채가 아니라 웹 보안 모델이다. 그 몫은 소비 제품의 로컬/Actions 티어가 진다.
