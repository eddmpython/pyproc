# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

### 2026-07-11 dartlab 병행 구현 발견 -> 흡수 결정 + 목표 확장(소유자 지시)

- dartlab `mainPlan/web-notebook-runtime`(자체 워커·체크포인트 그래프·OPFS, Pyodide 0.27.5)과 `browser-as-server-ssot`(FastAPI in pyodide, e2e PASS)를 발견. 런타임이 3벌로 갈라진 상태 확인.
- **소유자 결정**: 세 소비자의 개별 풀이는 동결. pyproc이 서면 dartlab/codaro/xlpod 전부 pyproc을 바라본다. pyproc = 혁신·발명 레인, 목표는 "웹에서 로컬처럼: 실행 + 패키지 설치 + 임베디드 파이썬/uv급 환경". 하드코딩 원칙 금지(CLAUDE.md 개발 원칙 6).
- 흡수 목록과 순서는 [local-parity](../local-parity/README.md) "흡수 계획" 절이 정본. 1순위 = 예외 안전 복원(재해시), 관문 = Pyodide 버전 정합(0.27.5 vs v314) 실측.

### 2026-07-11 잔여 결함 전량 개선(attempts 3종 졸업) + local-parity 발명 개시

- **processLifecycle 졸업**: 행 시 map 무한 대기 재현 -> `map(.., {taskTimeoutMs})` 유한 수렴(1786ms 실측) + `kill(pid)` + 스냅샷 respawn(302ms). `_spawn`/`_replace` 리팩터.
- **reactiveSoundness 졸업**: 페이지당 이중 32비트 해시(실효 64비트, ~2^-64). 비용 1.54배(30MB 힙 14.3ms), restoreLive 1.06ms 유지.
- **syscallBridge v1 졸업(스텁 탈피)**: input(동기 핸들러 + JSPI 블로킹), urllib 실 HTTP GET(동기 XHR, 바이너리 보존, proxyUrl 옵션), subprocess `-c`(자식 워커, 2007ms). 발견: v314에 `callSyncifying` 없음, JSPI 경로는 `pyodide.ffi.run_sync` + `can_run_sync()` 호출 시점 판정.
- **terminal 개념 입증**(승격 전): InteractiveConsole REPL + REPL 안 `input()` 블로킹 재개(24ms). 게이트 3(능력 계약 승격) 남음.
- **local-parity 이니셔티브 개시**: 축별 격차 지도(실행/프로세스/시스템콜/터미널/라이브러리/영구 벽). [mainPlan/local-parity](../local-parity/README.md).
- 하네스 범용화: `node tests/browser/run.mjs <페이지>`로 attempts probe도 headless 실측. 메인 게이트 15검사로 확장(수명주기 3 + 시스템콜 2 추가).

### 2026-07-11 브라우저 런타임 게이트 신설 + 프로세스 OS 실결함 2건 수정

- **`npm run test:browser` 신설**(의존성 0): COOP/COEP 서버 + headless Chromium(Edge/Chrome 자동 탐색) + POST 백채널로 공개 표면의 실동작을 자동 검증. CI(`.github/workflows/ci.yml`)에서도 같은 게이트가 돈다. examples/serve.mjs는 `createStaticServer()` export로 리팩터링해 게이트가 재사용.
- **게이트가 첫 실행에서 실결함 2건을 적발, 수정:**
  1. `PyProc.boot()`가 워커 부팅 실패를 삼켜 영원히 pending(계약 실태 표의 알려진 결함). 부팅 에러를 reject로 전파 + 워커 error 이벤트 처리 + 프로세스 상태 `dead` 기록.
  2. **스냅샷-fork가 배포 코드에서 부팅 불가였다**: SAB 뷰를 `_loadSnapshot`에 그대로 주면 Pyodide 내부 TextDecoder가 shared buffer를 거부(TypeError). 워커 로컬 일반 버퍼로 1회 복사해 해결. 기존 "검증된 실측"은 codaro 실험 코드 기준이었고, 추출된 pyproc의 SAB 경로는 브라우저 실측이 없어 이 결함이 숨어 있었다. 런타임 게이트 신설의 정당성이 즉시 입증된 사례.
- **이 머신 실측(게이트 GREEN 10/10, Edge headless)**: 메인 부팅 4004ms, restoreLive 0.84ms, fork 워커 부팅 평균 384ms(콜드 대비 약 10배), map 병렬 39ms vs 직렬 65ms(2워커 1.67배, 결과 정확). v0.0.3 재구조화의 브라우저 검증 완료(NEXT 1 해소).
- **릴리즈 정책(소유자 지시)**: 버전 올림 = 태그 = 릴리즈, 하나다. 소유자의 명시 지시가 있을 때만 같은 값으로 함께 올린다. 남발 금지. 지시 없이 올렸던 0.0.4는 철회하고 0.0.3(태그 v0.0.3과 동일 값)으로 되돌렸다. 일상 커밋은 버전을 건드리지 않는다(소비자는 SHA 핀).

### 2026-07-11 라이선스 확정: Apache 2.0

- 소유자 결정으로 **Apache License 2.0** 채택(Copyright 2026 eddmpython). 근거: 명시적 특허 조항(3절)이 스냅샷-fork·복원 리액티브 같은 발명성 기법의 사용자를 보호하고, 기여 조건 내장(5절, inbound=outbound)이 별도 CLA 없이 외부 기여를 연다. Pyodide(MPL-2.0)는 CDN 런타임 로드라 간섭 없음.
- CONTRIBUTING 2종의 "기여 보류" 절 해제, package.json `Apache-2.0` + `files`에 LICENSE 포함, README 2종 갱신.
- npm 레지스트리에 `pyproc` 이름 비어 있음 확인(2026-07-11). 퍼블리시는 소유자 npm 계정 필요(NEXT 참조).

### 2026-07-11 운영 체계 수립 + src 레이어 재구조화 (v0.0.3)

- **운영 체계를 dartlab에서 차용해 수립.** 3층 정보 구조(CLAUDE.md 강행규칙 / 로컬 메모리 약속 / docs 공개 운영 문서), tests/attempts 졸업 게이트, mainPlan 수명주기(_done 이관). 규칙 SSOT: [docs/operations/operatingModel.md](../../docs/operations/operatingModel.md).
- **src를 레이어 폴더로 재구조화.** `src/runtime/`(runtime.js + memoryCapability.js), `src/capabilities/`(reactive.js + syscallBridge.js), `src/processOs/`(pyProc.js + worker.js). runtime<->reactive 순환 import를 memoryCapability 분리로 제거. 공개 표면과 subpath export 이름은 불변(소비자 무영향).
- **restoreLive 실행 경계 계약을 명문화.** "복원 전 마지막 실행을 checkpoint()로 닫는다"가 계약. 구 README 예제는 이 계약을 어겨 조용히 오동작하는 코드였다(checkpoint 없이 restoreLive 호출 = stale 해시 비교 = 0페이지 복원). 예제 수정 + reactive.js 상단 계약 주석 추가.
- **구 docs/PRD 2종을 이 이니셔티브 문서(00~02)로 이관.** docs/는 운영 문서 트리로 재편.
- **기여 정책 신설.** CONTRIBUTING 2종(en/ko). 라이선스는 미정 상태라 외부 코드 기여는 라이선스 확정 전까지 보류로 명시.
- 출처: 소유자 지시(2026-07-11, 운영 체계 전면 세팅) + dartlab/codaro/xlpod 실태 조사.

### 2026-07-11 레포 추출 + codaro import 검증 (v0.0.1 ~ v0.0.2)

- codaro `tests/_attempts`의 검증 조각 4모듈을 프레임워크 무관 ESM으로 승격해 pyproc 레포 생성.
- codaro가 SHA 핀으로 실제 import(npm 해석·tsc 타입·Vite 워커 emit 3단계 green). SSOT 성립의 증명점.
- 소비 계약 확정: SHA 핀, 공개 표면만 의존, 단방향, Pyodide v314.0.2.

## NEXT (재개 지점)

1. **terminal 승격(local-parity NEXT 1)**: `Terminal` 능력 계약(`push(line) -> {more, out}`) + examples 터미널 페이지 + 게이트 검사. 개념 실측은 완료.
2. **푸시 후 CI 첫 실행 확인**: GitHub Actions에서 구조 게이트 + 브라우저 게이트가 러너(ubuntu, google-chrome)에서 green인지 확인. 러너 특이사항이 나오면 이 원장에 기록.
3. **codaro UI 배선 동행**: PyodideEngine이 browserPythonRuntime seam을 실제 사용할 때 나오는 요구를 이 원장에 기록. 그 시점 SHA로 재핀(스냅샷-fork 결함 수정이 들어간 커밋 이후여야 함).
4. **npm 퍼블리시(소유자 계정 필요)**: `pyproc` 이름이 비어 있다. `npm publish`로 선점하면 외부 소비가 `npm install pyproc` 한 줄이 된다. files 배열은 준비 완료.

## 메모리 포인터

- 세션 간 행동 약속(운영 방식 차용 근거, 소비자 하드 계약)은 로컬 메모리에 기록되어 있다. 레포 문서가 정본이고 메모리는 라우팅이다.
