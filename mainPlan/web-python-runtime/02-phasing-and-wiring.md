# 02. Phasing과 배선 - 로드맵, 소비 배선, 거버넌스

상태: v0.2 (2026-07-11). 구 PRD 7·8·11절을 이관하고 attempts 졸업 게이트와 연결했다.

## 소비 정책 (계약)

- **커밋 SHA 핀으로 소비한다.** 소비 제품은 `"pyproc": "github:eddmpython/pyproc#<sha>"`처럼 커밋 SHA를 박아 npm으로 설치한다. 플로팅(main 추종) 금지.
- **공개 계약만 의존한다.** `index.js`가 내보내는 표면과 `index.d.ts` 타입만 쓴다. 엔진 내부(HEAPU8 등) 직접 접근 금지. 그래야 내부를 바꿔도 소비자가 안 깨진다.
- **단방향.** 의존은 products -> pyproc 한 방향뿐. pyproc은 어떤 소비 제품도 import하지 않는다. 순환 없음.
- **패키지에 실리는 것.** `files` = `index.js`, `index.d.ts`, `src`, README 2종. 훅·테스트·mainPlan·docs는 소비 패키지에 싣지 않는다.
- **번들러 호환은 계약이다.** codaro 검증 기준: `moduleResolution: Bundler` + `allowJs: false`에서 `tsc -b` 통과, Vite가 `new Worker(new URL("./worker.js", import.meta.url))`를 워커 청크로 emit. worker.js와 pyProc.js의 같은 폴더 배치는 이 계약의 일부다.
- **SSOT는 실제 import로만 성립한다.** codaro가 first consumer(2026-07-11 import 검증: npm 해석·tsc 타입·Vite 워커 emit 3단계 green). dartlab/xlpod는 같은 SHA 핀 방식으로 점진 이관한다.

## 소비자별 배선 상태와 다음 단계

| 소비자 | 현재 | 다음 배선 |
|---|---|---|
| codaro | `browserPythonRuntime.ts` seam까지 완료(UI 미배선) | PyodideEngine이 seam을 브라우저 티어로 실제 사용. 그 시점의 pyproc SHA로 재핀 |
| xlpod | 자체 `pyodideWorker.js` 운용 | pyproc이 동기 UDF 요구(유한 타임아웃·인터럽트 SAB·요청 id·오류 토큰)를 계약으로 흡수하면 능력 계약 뒤로 이관. Pyodide v314.0.2 정합 유지가 전제 |
| dartlab | 미착수 | codaro 배선 안정 후 같은 방식 |

## 로드맵 (다음 승격 후보)

현재 승격된 것: 런타임·복원 리액티브·프로세스 OS·능력 계약(코어 4모듈, src 레이어 구조).

다음 후보는 전부 **tests/attempts의 카테고리에서 졸업 게이트를 통과한 뒤에만** src로 승격한다(운영 규칙: [tests/attempts/README.md](../../tests/attempts/README.md)). 후보와 게이트 초안:

1. **processLifecycle** - map 타임아웃, 워커 사망 감지, kill(pid)/respawn. 게이트: 워커 강제 종료 시나리오에서 map이 유한 시간 안에 오류로 수렴하는 브라우저 실측.
2. **browserAsServer** - WSGI/ASGI(Flask/FastAPI)를 소켓 0으로 Service Worker fetch에 연결. 게이트: GET 200/POST 201/422 검증 실측(codaro 실험에서 1회 입증, pyproc 모듈 형태로 재현).
3. **warmPool** - 페이지 로드 시 패키지까지 warm-up된 워커 풀 + live-diff pristine 복귀. 게이트: 재임포트 0으로 태스크 즉시 처리 실측.
4. **syncUdfBridge** - xlpod의 동기 UDF 브리지(SAB Atomics 왕복·인터럽트·오류 토큰)를 능력 계약으로 흡수. 게이트: xlpod 스모크(8/8) 동등 통과.
5. **sabIpc** - SharedArrayBuffer + Atomics 고속 채널(postMessage 대비 실측 우위). 
6. **fsMount** - File System Access 마운트(진짜 로컬 폴더).
7. **reactiveSoundness** - 64비트/이중 페이지 해시, restoreLive 실행 경계 위반 가드. 게이트: 해시 강화 비용(체크포인트 지연) 실측이 수용 범위 안.

우선순위는 소비자 수요가 정한다: codaro UI 배선(1·2·3) > xlpod 이관(4) > 나머지.

## 거버넌스

- **main 전용.** 로컬 브랜치 생성/푸시 금지. `.githooks`가 기계 차단.
- **빌드 없는 ESM.** 번들러/트랜스파일러 도입 금지. 타입 선언은 손으로 유지(`index.d.ts`).
- **능력 계약 경유.** 엔진 내부 접근은 능력 뒤에 격리. `camelCase` 파일/함수, `PascalCase` 클래스.
- **버전 `0.0.x` 라인.** 릴리즈 때만 끝자리를 올리고, `package.json`과 태그 `v0.0.x`를 같은 값으로 맞춘다.
- **테스트 게이트.** `npm test`(Node, 의존성 0)가 공개 표면·타입 커버리지·문서 링크·구조 불변식을 검사한다. 커밋 전 green. 브라우저 실측 절차는 [docs/operations/testing.md](../../docs/operations/testing.md).
- **착수 전 정합성·ROI 재검(필수 게이트).** 이 플랜을 무비판 실행하지 않는다. 착수 시점의 코드/소비자 상태와 대조해 어긋나면 플랜부터 고친다.

## 롤백

- 소비자는 SHA 핀이라 pyproc의 어떤 변경도 소비자를 즉시 깨지 않는다. 문제가 생기면 소비자가 이전 SHA로 되핀하면 끝.
- src 승격이 잘못됐으면 해당 모듈을 되돌리고 attempts 카테고리로 강등해 게이트를 다시 채운다. 결정은 [03-progress-ledger.md](03-progress-ledger.md)에 기록한다.
