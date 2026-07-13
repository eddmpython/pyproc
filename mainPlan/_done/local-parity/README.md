# local-parity - "브라우저 파이썬 = 로컬 파이썬" 발명 프로그램

> ✅ 완료 (2026-07-13): 실행·프로세스·시스템콜·세션·터미널·라이브러리 축 v1 도달 + 네 가지 상태 지도 확립. 지속 프레임(네 가지 상태 + North Star)은 [docs/product/vision.md](../../../docs/product/vision.md)로 승격. 잔여(numpy 정적 빌드·GPU·동적 dlopen 등)는 프론티어/upstream 대기라 재개 시 새 이니셔티브.

상태: 개시 (2026-07-11). 목표: 웹 파이썬이 실행·터미널·라이브러리에서 로컬과 구분 불가능해지는 것. 각 축은 tests/attempts 카테고리에서 실측으로 전진하고, 졸업분만 src로 승격한다.

## Parity 지도 (축별 현재 위치)

| 축 | 로컬의 기준 | 현재 (2026-07-11) | 다음 attempts |
|---|---|---|---|
| 실행 | 순수 파이썬 로직 속도 | **도달** + numpy 열세 완화: `mapArray` 샤딩 4워커 **5.28배**(32MB sort+sum 실측) | WebGPU 산술(프론티어), 2D 샤딩(matmul) |
| 프로세스 | fork/Pool/kill이 되는 OS | **도달(v1)**: 스냅샷-fork ~380ms, map 병렬, taskTimeout + kill/respawn + `interrupt(pid)`(SIGINT, respawn 0) | 시그널 확장(SIGSTOP/재개), 프로세스간 IPC |
| 시스템콜 | input/HTTP/subprocess | **도달(v1)**: input(동기+JSPI 블로킹), urllib 실 GET, subprocess(자식 워커, `-c`) | requests 계열, 저수준 socket(프록시 계약), 파일계(FS Access 마운트) |
| 세션 영속 | (로컬도 없음: REPL은 죽으면 끝) | **로컬 초월(v1)**: `Session` 승격. 결정적 리플레이 + 델타(5.9MB급)로 커널 간·세션 간 부활, 게이트 상시 | 성장 세션(v2), 델타 체인·분기, 매니페스트에 wheel 캐시 결합 |
| 터미널 | 로컬 REPL과 동일 체감 | **도달(v1) + 초월**: `Terminal` 승격(블로킹 input 24ms) + `{timeTravel}` 옵션의 `%undo`(완결 문장 단위 시간여행) | 히스토리·자동완성·멀티라인 편집 |
| 라이브러리/환경 | `pip install` 전부 + uv급 환경(즉시 부팅·재현·스크립트 자급) | **uv 레인 v1 완성(2026-07-12)**: `bootEnv`(bare 스냅샷 + OPFS 휠) 웜 부팅 **1229ms**(콜드 5109ms, 4.2배) + `runScript`(PEP 723 자급 실행) + `freeze` 락(`boot({lockFileURL})` 관통, 해석 0 재현). 커버리지 실측 17/17(pandas/scipy/sklearn/matplotlib 등, v314) | 실패군 표본 확대, Session 리플레이의 스냅샷 베이스 결합(v2), requires-python 해석, 네이티브 전용군 분류 |
| 상주/네이티브 | 데몬, 네이티브 휠(torch CUDA), 데스크톱 조작 | **분리**(아래 네 상태 지도): 인바운드 서버·임의 네이티브 바이너리·데스크톱은 영구 벽, 네이티브 C확장·GPU·threading은 upstream 대기 | 각 항목별 프론티어(네 상태 지도) |

## 네 가지 상태 (목표는 무한대, 현재형 주장은 증명된 만큼)

이 프레임은 지속 제품 정책으로 승격됐다: **정본 = [docs/product/vision.md](../../../docs/product/vision.md)의 "능력의 네 가지 상태"**. 아래는 이 이니셔티브의 축별 실측 스냅샷이다(날짜 박힌 기록).

North Star("로컬에서 되는 모든 파이썬을 브라우저에서")는 방향이다. 각 능력은 네 상태 중 하나에 있고, pyproc의 일은 위 칸으로 밀어 올리는 것과 upstream이 벽을 여는 순간 가장 먼저 흡수하는 구조가 되는 것이다. "불가능"은 현재 조건 판정이지 포기가 아니다.

### 현재 달성 (오늘 브라우저 실측)
순수 파이썬 + Pyodide 빌드 패키지, 멀티코어 프로세스/스냅샷-fork/map, 체크포인트/시간여행(Pyodide 경로), 세션 영속·부활, 터미널, 커널 내 ASGI, 영속 FS(OPFS), input/HTTP/subprocess(`-c`), non-Pyodide WASI CPython 3.14.6 부팅 + 순수 파이썬 wheel `installWheel`([enginePort](../../../tests/attempts/enginePort/README.md), [wasiPackages 졸업](../../../tests/attempts/wasiPackages/README.md)). **정적 링크 C 확장도 이미 실행**: `_struct`/`array`/`math` 등 stdlib C 모듈이 브라우저 위 진짜 C 코드로 돈다(python.wasm 자체가 정적 C 확장 묶음 = wasiGate 실측). "C 확장 불가"는 틀렸다 - **동적만 불가, 정적은 이미 됨**.

### 우회 가능 (브라우저 방식으로 가상화, 실측)
- **아웃바운드 소켓**: **src 능력으로 승격 완료.** `Runtime.enableSocketBridge({relayURL})`가 파이썬 socket을 얇은 WS->TCP 릴레이에 심해 **`urllib.request.urlopen`이 진짜 소켓으로 HTTP 200을 받는다**(블로킹 recv = JSPI/runAsync). [socketBridge GREEN 3/3 + 블로킹 2/2 + 파이썬 2/2 + 능력 2/2](../../../tests/attempts/socketBridge/README.md). `requests`/`urllib3`가 같은 socket API라 따라온다. 남은 것 = 릴레이 강화(Wisp 멀티플렉싱, TLS in-tab로 HTTPS).
- **서버**: TCP `listen()`을 `AsgiServer`/`VirtualOrigin`으로(파이썬 앱이 진짜 URL, 왕복 3.4ms).
- **프로세스**: `os.fork`를 워커 커널로, subprocess를 자식 워커로.

### 우회 가능 - 빌드 경로 확정, 아티팩트 미완
- **네이티브 패키지(numpy 등)**: 정적 fat 바이너리로 이 경로에 오른다 - numpy C 소스를 wasi-sdk로 정적 링크해 python.wasm에 builtin으로 등록(`PyImport_AppendInittab`). 선례 = kesmit 2023 numpy 1.24.2 정적 링크 실증, CPython 3.14가 dotted-name importer 블로커([cpython#102768](https://github.com/python/cpython/issues/102768)) 해소. 빌드는 CI 아티팩트 단계(wasi-sdk 109MB, brettcannon release.yml 레시피 재사용, blas/lapack=none + 번들 lapack_lite, longdouble/SIMD off, wasm-strip). 미완 = 프론티어(enginePort 후속).

### upstream 대기 (지금 막혔으나 플랫폼 발전으로 다시 열림 - 프론티어)
- **동적 C확장 로딩**(.so를 런타임에 dlopen = 임의 wheel 즉시 설치): PEP 783 pyemscripten 휠 / WebAssembly 컴포넌트 모델 / WASI 동적 링킹. 정적 fat 빌드가 있으면 이건 없어도 되지만, 임의 패키지 즉시 설치는 이게 열려야.
- **WASI 시간여행 이식**: 3.14.6에서 전체-힙 복원이 트랩(스택 인지 복원 필요). 프론티어 = 스택 인지 복원 캠페인([enginePort 결론 표](../../../tests/attempts/enginePort/README.md)).
- **GPU**: WebGPU 산술(실행 축 프론티어).
- **진짜 threading / nogil**: WASM threads + 공유 메모리, upstream nogil.

### 웹 보안상 영구 벽 (외부 조각 없이는 불가)
- **인바운드 서버**(탭이 공개 인터넷의 서버가 되는 것): SW는 같은 브라우저만, WebRTC는 시그널링 필요. 최소 = 역터널 릴레이("탭용 ngrok").
- **임의 네이티브 바이너리 실행**(`subprocess`로 `/bin/ls`, ssh 클라이언트), 로컬 드라이버 직접(CUDA), 데스크톱 자동화(pyautogui). 소비 제품의 로컬 에이전트/클라우드 티어 몫.

## 원칙

1. **parity는 주장으로 얻지 않는다.** 축마다 attempts probe가 숫자로 판정한다(위 표의 수치는 전부 브라우저 게이트/probe 실측).
2. **벽은 벽이라고 쓴다.** WASM dlopen(warm-fork/nogil/제로카피)과 네이티브 휠은 upstream 연구 문제다. 로드맵이 아니라 프론티어 절에 둔다.
3. 아키텍처·계약 상세는 [web-python-runtime](../web-python-runtime/01-architecture.md)이 정본이고, 이 이니셔티브는 격차 지도와 우선순위만 소유한다.

## 흡수 계획 (dartlab 병행 구현 발견, 2026-07-11)

dartlab이 자체 노트북 런타임(`mainPlan/web-notebook-runtime`)과 browser-as-server(`mainPlan/browser-as-server-ssot`, e2e PASS)를 Pyodide 0.27.5로 병행 구현했다. 세 소비자의 개별 풀이는 동결 상태이고, pyproc이 서면 전부 pyproc을 바라보게 한다(2026-07-11 결정). pyproc이 가져올 것:

1. **예외 안전 복원**: 실행 중 예외는 checkpoint 없이 힙을 더럽혀 restoreLive 경계 계약을 조용히 깬다. dartlab 해법 = 복원 전 현재 힙 재해시. pyproc은 옵션(`rehash`)으로 흡수.
2. **체크포인트 그래프 + OPFS**: 분기 복원(부모 그래프), content-addressed 상태, OPFS 원장. 기준 힙 영속은 2026-07-11 `saveBase`/`loadBase`로 1단계 흡수(30MB 쓰기 256ms/읽기 46ms). 남은 것: 델타 체인 영속 + 분기 그래프 + 세션 간 커널 복원.
3. **browserAsServer**: "로컬 서버 = 소켓이 아니라 ASGI". SW fetch -> ASGI dispatch, HTTP 오버헤드 8ms, `async def` 강제 제약까지 검증 완료. 능력 계약으로 흡수.
4. **라이브러리·파일계 체크리스트**: wheel OPFS 캐시, requirements manifest, `%pip` 영속, 부팅+복구+첫 셀 시간 기준선.
5. ~~버전 정합 관문~~ **통과(2026-07-11 실측)**: v314.0.2에서 fastapi/pydantic/polars/numpy/requests 전부 설치·import ok. dartlab 이관에 버전 장애물 없음.

## NEXT

1. ~~예외 안전 복원 흡수~~ 완료(2026-07-11): `restoreLive({rehash})` 승격 + 게이트 상시화.
2. ~~browserAsServer 흡수~~ 완료(2026-07-11 dispatch + **2026-07-12 SW 배선까지**): `AsgiServer` 승격에 이어 `pyprocSw.js`(?asgi=접두) + `VirtualOrigin` 승격으로 파이썬 서버가 진짜 URL이 됐다(왕복 3.4ms = SW 오버헤드 0). "SW 배선은 소비 제품 몫" 방침은 폐기: 배선도 pyproc 프리미티브다(등록/스코프만 소비자 몫).
3. ~~terminal 승격~~ 완료(2026-07-11): `Terminal` 능력 + examples/terminal.html + 게이트 상시화.
4. 체크포인트 그래프(델타 체인·분기) / 라이브러리 실패군 탐색 / 저수준 socket·requests 계열.
5. **리플레이+델타 = 불멸 커널/warm-fork (실증 완료, 2026-07-11)**: 결정적 부팅(PYTHONHASHSEED=0 + 엔트로피/시간 고정)이 바이트 단위 동일 힙을 재현(180p 상이 -> 0p)하고, 사용자 상태는 델타 페이지(10MB급)만 OPFS에 저장해 동형 커널에 1.5ms 적용으로 부활. Pyodide 스냅샷의 hiwire 벽을 upstream 수정 없이 우회(전문 리서치: Cloudflare workerd와 동원리, 단 우리는 리플레이 기반).
6. ~~"웹의 uv" 3층 결합~~ 완료(2026-07-12): (매니페스트) + (bare 스냅샷 + wheel OPFS) + (락)이 `bootEnv`/`runScript`/`freeze`로 승격. 실측·잔여는 [tests/attempts/envManager](../../../tests/attempts/envManager/README.md) 결론 표가 정본.
