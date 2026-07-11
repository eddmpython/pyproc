# pyproc PRD - 제품 방향과 정책

언어: [English](PRD.md) | 한국어

상태: v0.1 (2026-07-11). 이 문서는 pyproc이 무엇을 지향하고, 무엇을 하지 않으며, 소비자(codaro/dartlab/xlpod)가 어떤 계약으로 가져다 쓰는지의 SSOT다. 코드가 바뀌면 이 문서도 같은 변경에서 갱신한다.

---

## 0. 한 줄 (North Star)

**서버 없이 브라우저 탭에서 파이썬을 "노트북 한 셀"이 아니라 운영체제처럼 돌린다. 프로세스·병렬·복원 리액티브를 하나의 재사용 런타임으로 묶어, codaro/dartlab/xlpod가 공유하는 웹 파이썬 런타임의 단일 진실(SSOT)이 된다.**

## 1. 문제

브라우저에서 진짜 파이썬을 돌리는 조각(Pyodide, JSPI, File System Access, SharedArrayBuffer)은 이미 있다. 그러나 이들을 "실제 로컬 런타임처럼" 엮는 계층은 각 제품이 매번 새로 짠다. 그 결과:

- codaro·dartlab·xlpod가 같은 브라우저 파이썬 런타임을 필요로 하는데 각자 복붙하면 3벌로 갈라진다. 한 곳에서 버그를 고쳐도 나머지는 안 고쳐진다.
- Pyodide는 단일 인터프리터 한 개다. 병렬·프로세스·상태 복원 같은 "런타임의 물성"은 기본 제공되지 않아 매번 재발명된다.
- 브라우저의 부재 능력(socket/subprocess/blocking input)을 메우는 방식이 제품마다 제각각이라 재사용이 안 된다.

pyproc은 이 계층을 **한 번 제대로 만들어 버전 고정으로 공유**한다. 레포를 키우면 개선이 한 곳에 모이고, 세 제품이 실제로 import하면 자동으로 SSOT가 된다.

## 2. 무엇인가 / 무엇이 아닌가

**pyproc이다:**
- 프레임워크 무관 ESM 라이브러리. 빌드 단계 없음(네이티브 `.js` + 손으로 유지하는 `.d.ts`).
- 브라우저 티어의 런타임 프리미티브: 런타임 부팅, 복원 리액티브, 프로세스 OS, 능력 계약.
- 교차 관심사(WASM 힙 접근·스택 포인터·몽키패치)를 능력 계약 뒤에 캡슐화한 깨끗한 소비 표면.

**pyproc이 아니다:**
- 제품 UI/도메인 로직(커리큘럼·자동화·시트 편집). 그건 소비 제품이 위에 얹는다.
- 실행 위치 배정 정책(capability router의 티어 판정). 그건 제품별로 달라 제품이 소유한다.
- 로컬 엔진/GitHub Actions 엔진. codaro의 `ExecutionEngine` 3티어는 codaro 소유이고, pyproc은 그중 브라우저 티어의 프리미티브만 제공한다.
- Firefox/Safari 대응. 스코프 밖(사유는 10절).

## 3. 발명 계보 (검증된 조각 + 실측)

pyproc의 코어는 새 이론이 아니라 브라우저에서 실측으로 뚫은 조각들의 승격이다.

| 조각 | 무엇을 뚫었나 | 실측 |
| --- | --- | --- |
| 스냅샷 = fork 프리미티브 | 힙 스냅샷을 워커에 주입 = 프로세스 fork. 프로세스 생성이 "부팅"에서 "이미지 로드"로 | bare fork 자식 부팅 184ms vs 콜드 2839ms = **15.4배**, 독립 프로세스 |
| 프로세스 OS 병렬 | 독립 인터프리터 N개 = 독립 GIL N개 = N코어 물리 동시 실행 | 4워커 `map` **2.67배**, 결과 정확 |
| 복원 기반 리액티브 | WASM엔 없는 dirty-page 추적을 실행 경계 완전 해시로 재구성. 재실행 대신 복원 후 하류만 | 라이브-차분 복원 **2.4ms**(memcpy 대비 12배), 리액티브 편집 **9.1배** 빠름, 크래시 0 |
| 능력 계약 | HEAPU8·스택 접근을 계약 뒤로 격리. 소비자는 깨끗한 API만 | 소비자가 엔진 내부 직접 접근 0으로 복원 리액티브 사용 |

속도 실측 정정: 순수 파이썬 로직은 로컬과 대등하거나 더 빠르다(Pyodide의 CPython 3.14 > 로컬 3.12). numpy 대규모 산술만 86배 느리다(WASM 단일스레드·no-AVX BLAS). 서버/자동화/로직 워크로드는 런타임급이고, 대규모 수치/ML만 로컬 몫이다.

## 4. 아키텍처 (레이어)

```text
Layer 2  processOS.js  PyProc 프로세스 OS 커널 (스냅샷-fork spawn + map 병렬)
                         worker.js = "프로세스"(Web Worker 안 Pyodide)
Layer 1  reactive.js   복원 리액티브 (능력)
         syscallBridge  socket/subprocess/input 브리지 (능력, 계약)
Layer 0  runtime.js    Pyodide 래퍼(boot/Runtime) + MemoryCapability 능력 계약
         index.js      공개 표면 / index.d.ts 타입 계약
```

능력(Layer 1)은 opt-in이다. 런타임에서 필요한 것만 켠다(`enableReactive()` 등). 능력은 엔진 내부를 `MemoryCapability` 같은 계약 뒤에 숨기고, 소비자는 그 계약만 만진다.

## 5. 능력 (capabilities)

- **복원 리액티브** - 실행 경계마다 힙을 완전 해시(Uint32 워드)로 체크포인트. 완전 해시가 soundness의 열쇠다. 샘플링은 불완전 델타를 만들어 복원을 깨뜨린다. 라이브-차분 복원으로 인접 시간여행이 사실상 즉시.
- **프로세스 OS** - 메인스레드=커널. 프로세스 테이블(pid/state/parentPid), 스냅샷-fork spawn, `map`/`mapSerial` 스케줄러, `ps()`, `terminate()`.
- **빌린 시스템콜 브리지(계약)** - 브라우저에 없는 socket/subprocess/input을 각각 프록시·자식 워커·JSPI로 빌리는 계약. 라이브러리는 "무엇을 배선하는지"를 노출하고, 실제 엔드포인트는 소비 제품이 채운다.

## 6. 프론티어 (정직한 벽 = WASM dlopen)

pyproc이 "오늘 가능한 최상단"인 이유와 그 위의 벽을 숨기지 않는다.

- warm-fork(패키지 로드 후 재임포트 0으로 복제), 진짜 공유메모리 스레드(nogil), numpy 프로세스간 제로카피 - **이 셋은 전부 하나의 미해결 문제(WASM dlopen + 크로스 인스턴스/스레드 메모리 공유)에 걸려 있다.** Pyodide 스레딩 이슈 #237은 2018년부터 열려 있다. "몇 주 빌드"가 아니라 upstream 연구 문제다.
- pyproc(독립 인터프리터 워커 + 메시지 패싱)은 정확히 이 문제를 회피한다. 각 워커가 자기 wasmTable/힙/글루를 소유하므로 dlopen 불일치가 없다. 그래서 오늘 가능한 최상단이고, 프론티어는 발판이 아니라 벽이다.
- 이 벽은 pyproc 레포에서 계속 파고들 자리다(hiwire/emval shadow, nogil-WASM 커스텀 빌드, WebGPU 산술).

## 7. 소비 정책 (계약)

- **커밋 SHA 핀으로 소비한다.** 소비 제품은 `"pyproc": "github:eddmpython/pyproc#<sha>"`처럼 커밋 SHA를 박아 npm으로 설치한다. 플로팅(main 추종) 금지. **태그는 실제 릴리즈 전까지 만들지 않는다** - 스캐폴드/배선마다 태그를 찍지 않는다.
- **공개 계약만 의존한다.** `index.js`가 내보내는 표면(`boot`/`Runtime`/`PyProc` 등)과 `index.d.ts` 타입만 쓴다. 엔진 내부(HEAPU8 등)를 직접 만지지 않는다. 그래야 내부를 바꿔도 소비자가 안 깨진다.
- **단방향.** 의존은 products -> pyproc 한 방향뿐. pyproc은 어떤 소비 제품도 import하지 않는다. 순환 없음.
- **패키지에 실리는 것.** `files` = `index.js`, `index.d.ts`, `src`, README. 내부 에이전트/개발 규칙 문서와 훅·테스트·PRD는 소비 패키지에 싣지 않는다.
- **SSOT는 실제 import로만 성립한다.** "참조"만으로는 SSOT가 아니다. codaro가 first consumer(2026-07-11 import 검증 완료: npm 해석·tsc 타입·Vite 워커 emit 3단계 green). dartlab/xlpod는 같은 SHA 핀 방식으로 점진 이관한다.

## 8. 로드맵 (Horizons)

현재 승격된 것: 런타임·복원 리액티브·프로세스 OS·능력 계약(코어 4모듈).

다음 승격 후보(codaro 실험에서 검증됐으나 아직 모듈로 안 옮긴 것):

1. **Browser-as-Server** - WSGI/ASGI(Flask/FastAPI)를 소켓 0으로 Service Worker가 페이지 fetch에 연결. 실측: GET 200/POST 201/422 pydantic 검증 PASS.
2. **서버리스 터미널** - 셸=파이썬 프로그램, JSPI로 `input()`이 진짜 블록/재개.
3. **예열 워커 풀 + 차분 리셋** - 페이지 로드 시 워커를 패키지까지 warm-up, live-diff로 pristine 복귀해 재임포트 없이 즉시 태스크 처리.
4. **SAB IPC 고속 채널** - SharedArrayBuffer + Atomics로 postMessage보다 빠른 바이트 전송(제로카피는 프론티어).
5. **File System Access 마운트** - 진짜 로컬 폴더를 런타임에 마운트(Chromium/Edge).

## 9. 성공 / 실패 기준

- **성공**: 세 제품이 pyproc을 실제 import해서 각자 표면을 얹고, 브라우저 파이썬 런타임 개선이 pyproc 한 곳에 모인다. 소비자는 능력 계약만으로 복원 리액티브·프로세스 병렬을 쓰고 엔진 내부를 만지지 않는다.
- **실패**: 제품들이 여전히 각자 복붙해서 런타임이 갈라진다. 또는 pyproc이 제품 UI/도메인을 흡수해 범용성을 잃는다. 또는 계약이 자주 깨져 소비자가 매번 따라 고친다.

## 10. 지원 경계 (Chromium/Edge 전용)

JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox/Safari 미지원은 결함이 아니라 스코프다. SharedArrayBuffer는 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

브라우저 티어의 영구 상한(정직하게): 네이티브 휠(torch 등)·데스크톱 조작(xlwings/pyautogui)·상주 스케줄은 브라우저에서 영원히 불가하다. 이는 기술 부채가 아니라 웹 보안 모델이다. 그 몫은 소비 제품의 로컬/Actions 티어가 진다.

## 11. 거버넌스

- **main 전용.** 로컬 브랜치 생성/푸시 금지. `.githooks`의 `reference-transaction`/`pre-push`가 non-main ref를 차단한다.
- **빌드 없는 ESM.** 번들러/트랜스파일러 도입 금지. 타입 선언은 손으로 유지한다(`.d.ts`).
- **능력 계약 경유.** 엔진 내부 접근은 능력 뒤에 격리한다. `camelCase` 파일/함수, `PascalCase` 클래스.
- **버전 `0.0.x` 라인.** 릴리즈 때만 끝자리를 올리고, 그때만 태그를 만든다.
- **테스트 게이트.** `npm test`(Node, 의존성 0)가 공개 표면·타입 커버리지·문서 위생을 검사한다. 커밋 전 green.
- 상세 개발 규칙은 로컬 규칙 문서(git 미추적)가 SSOT다. 이 PRD는 공개되는 제품 방향/소비 정책을 담는다.
