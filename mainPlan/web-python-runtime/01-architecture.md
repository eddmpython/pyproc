# 01. 아키텍처 - 레이어, 능력, 발명 계보, 계약 실태

상태: v0.3 (2026-07-11). parity 승격 5종(ASGI/Terminal/interrupt/OPFS 영속/예외안전복원)과 restoreLive 경계 기계 강제를 반영했다.

## 레이어 (폴더 = 레이어)

```text
Layer 2  src/processOs/     PyProc 커널(pyProc.js: 스냅샷-fork spawn + map 병렬)
                            worker.js = "프로세스"(Web Worker 안 Pyodide). pyProc.js와 같은
                            폴더 = new URL 상대경로 계약(번들러 워커 emit).
Layer 1  src/capabilities/  reactive.js  복원 리액티브 (능력)
                            syscallBridge.js  socket/subprocess/input 브리지 (능력 계약)
                            asgiServer.js  커널 안 ASGI dispatch (능력 계약)
                            terminal.js  서버리스 파이썬 REPL (능력 계약)
Layer 0  src/runtime/       runtime.js  Pyodide 래퍼(boot/Runtime)
                            memoryCapability.js  MemoryCapability 계약 + PAGE_SIZE
표면     index.js           공개 표면 re-export / index.d.ts 타입 계약(손 유지)
```

- import 방향은 단방향이다: `processOs`/`capabilities` -> `runtime/memoryCapability`. 구 구조의 runtime<->reactive 순환 import는 memoryCapability 분리로 제거했다(2026-07-11).
- 능력(Layer 1)은 opt-in이다. `Runtime.enableReactive()`/`enableSyscallBridge()`로 켠다.
- 소비자는 능력 계약만 만진다. `HEAPU8` 같은 엔진 내부 직접 접근 금지.

## 능력 (capabilities)

- **복원 리액티브** - 실행 경계마다 힙을 완전 해시(Uint32 워드)로 체크포인트. 완전 해시가 soundness의 열쇠다. 샘플링은 불완전 델타를 만들어 복원을 깨뜨린다. 라이브-차분 복원으로 인접 시간여행이 사실상 즉시. 경계 위반은 `Runtime.execSeq`(상태 변이 카운터)로 자동 감지해 재해시 경로로 승격한다(기계 강제). `saveBase`/`loadBase`로 기준 힙을 OPFS에 내보내 RAM 부담을 옮긴다.
- **프로세스 OS** - 메인스레드=커널. 프로세스 테이블(pid/state/parentPid), 스냅샷-fork spawn, `map`/`mapSerial` 스케줄러, `ps()`, 수명주기(`kill(pid)` SIGKILL 등가 + `interrupt(pid)` SIGINT 등가 + `map` taskTimeout 시 respawn), `terminate()`.
- **빌린 시스템콜 브리지(v1 실배선)** - `input()`(동기 핸들러 + JSPI `pyodide.ffi.run_sync` 블로킹), `urllib`(동기 XHR, 바이너리 보존, proxyUrl 옵션), `subprocess.run(["python","-c",code])`(자식 워커 독립 인터프리터). HTTP 프록시 엔드포인트는 소비 제품이 채운다.
- **커널 안 ASGI 서버** - FastAPI/Starlette 앱을 TCP 소켓 0으로 dispatch(실측 3.4ms/요청). 엔드포인트 `async def` 강제. Service Worker fetch 배선은 소비 제품 몫, pyproc은 dispatch 프리미티브만 소유한다.
- **서버리스 파이썬 터미널** - `code.InteractiveConsole` 기반 REPL(탭 = 셸). `input()` 블로킹은 syscallBridge의 JSPI 경로와 조합한다.

## 발명 계보 (검증된 조각 + 실측)

pyproc의 코어는 새 이론이 아니라 codaro `tests/_attempts`에서 브라우저 실측으로 뚫은 조각들의 승격이다.

| 조각 | 무엇을 뚫었나 | 실측 |
| --- | --- | --- |
| 스냅샷 = fork 프리미티브 | 힙 스냅샷을 워커에 주입 = 프로세스 fork. 프로세스 생성이 "부팅"에서 "이미지 로드"로 | bare fork 자식 부팅 184ms vs 콜드 2839ms = **15.4배**, 독립 프로세스 |
| 프로세스 OS 병렬 | 독립 인터프리터 N개 = 독립 GIL N개 = N코어 물리 동시 실행 | 4워커 `map` 8태스크 병렬 130ms vs 직렬 347ms = **2.67배**, 결과 정확 |
| 복원 기반 리액티브 | WASM엔 없는 dirty-page 추적을 실행 경계 완전 해시로 재구성. 재실행 대신 복원 후 하류만 | 라이브-차분 복원 **2.4ms**(memcpy 대비 12배), 리액티브 편집 **9.1배** 빠름, 크래시 0 |
| 능력 계약 | HEAPU8·스택 접근을 계약 뒤로 격리. 소비자는 깨끗한 API만 | 소비자가 엔진 내부 직접 접근 0으로 복원 리액티브 사용 |

속도 실측 정정: 순수 파이썬 로직은 로컬과 대등하거나 더 빠르다(Pyodide의 CPython 3.14 > 로컬 3.12). numpy 대규모 산술만 86배 느리다(WASM 단일스레드·no-AVX BLAS). 서버/자동화/로직 워크로드는 런타임급이고, 대규모 수치/ML만 로컬 몫이다.

## 계약 실태 (계약 vs 실제, 정직하게)

"계약이 문서에 있는 것"과 "실제로 그렇게 도는 것"의 간극을 여기서 상시 추적한다. 간극을 발견하면 이 표에 먼저 적고, 메우면 지운다.

| 항목 | 계약 | 실제 | 상태 |
|---|---|---|---|
| restoreLive 실행 경계 | 경계 준수 시 즉시(재해싱 0), 위반 시에도 조용한 오염 없음 | **기계 강제(2026-07-11)**: Runtime.execSeq(상태 변이 카운터)로 위반을 O(1) 감지해 자동 재해시 승격. 반환값 `rehashed`로 경로 확인, 게이트 상시 검증 | 해소 (외부 리뷰 지적 반영) |
| 페이지 해시 soundness | 실질적 sound(누락 확률 무시 가능) | 이중 32비트(실효 64비트, ~2^-64)로 승격. 비용 1.54배, 30MB 힙 14.3ms 실측 | 해소 (attempts/reactiveSoundness 졸업, 2026-07-11) |
| syscallBridge | input/HTTP/subprocess를 실제로 빌린다 | v1 실배선: input(동기 + JSPI `run_sync`), urllib(동기 XHR, proxyUrl 옵션), subprocess(`["python","-c",code]`, 자식 워커, runAsync 경로). 저수준 socket·requests 계열은 미배선 | v1 해소 (attempts/syscallBridge 졸업, 2026-07-11). 잔여는 local-parity 축 |
| PyProc 오류 경로 | 부팅·행·죽음이 유한 시간에 귀결 | 부팅 실패 reject + `map(.., {taskTimeoutMs})` 행 수렴 + kill/스냅샷 respawn(302ms 실측). 남은 것: 협조적 취소(SIGINT) | 해소 (attempts/processLifecycle 졸업, 2026-07-11). 취소는 후보 |
| Pyodide 스냅샷 API | 스냅샷-fork | `_makeSnapshot`/`_loadSnapshot`은 Pyodide 밑줄(실험) API. 버전 핀(v314.0.2)으로만 안전. 대응 계획: [engine-independence](../engine-independence/README.md) P1(seam 격리)·P3(업스트림 #5971 워치) | 버전 올릴 때 최우선 재검증 항목 |
| 암묵 FFI/fetch 가정 | 엔진 교체·업데이트에 견딤 | `toJs` 덕타이핑 3개소(terminal/worker/sharedKernelHost), latin1 바이트 밀수(syscallBridge), "엔진이 .whl/코어를 전역 fetch로 받는다" 가정(wheelCache/coreCache)은 변환 기본값·fetch 전략 변경 시 예외가 아니라 틀린 데이터/무증상 캐시 무력화로 나타남 | **열림(부채)**: engine-independence P1 seam이 `toJs`를 계약 메서드로 승격 + dist 서술자로 이동 |
| 리액티브/%undo 메모리 | 장시간 사용에도 안전 | base(힙 전체 사본)가 RAM 상주 + 체크포인트 델타가 무한 누적(%undo는 문장마다). 장수 REPL에서 실메모리 성장 | **열림(부채)**: 델타 rebase/prune 설계 필요 |
| README 표면 동기화 | 공개 표면 = README 표 | `tests/run.mjs`가 index.js의 모든 export가 양쪽 README에 등장하는지 기계 검사(2026-07-12). 표도 전량 갱신됨 | 해소 (가드 상시) |
| 전역 스텁 3종 | 스코프 밖 무영향 | entropy/시간(session 부팅), fetch(wheelCache install 구간) 스왑은 finally 복원되지만 그 창 안의 동시 작업엔 보인다 | 문서화된 트레이드오프. 동시 부팅 금지 명시 필요 |
| restore()의 힙 성장 처리 | 두 복원 경로의 성장 처리 동등 | 비대칭은 존재하나 **실해 없음 실측**(growthRestoreProbe, 2026-07-11): 40+30MB 성장 후 restore 정확, dlmalloc/GC 정합, checkpoint 성장분 루프가 체인 재정합, restoreLive 왕복 정확(성장분은 재해시 경로가 전량 커버) | 해소 (실측으로 종결) |

## 프론티어 (정직한 벽 = WASM dlopen)

- warm-fork(패키지 로드 후 재임포트 0으로 복제), 진짜 공유메모리 스레드(nogil), numpy 프로세스간 제로카피 - **이 셋은 전부 하나의 미해결 문제(WASM dlopen + 크로스 인스턴스/스레드 메모리 공유)에 걸려 있다.** Pyodide 스레딩 이슈 #237은 2018년부터 열려 있다. "몇 주 빌드"가 아니라 upstream 연구 문제다.
- pyproc(독립 인터프리터 워커 + 메시지 패싱)은 정확히 이 문제를 회피한다. 각 워커가 자기 wasmTable/힙/글루를 소유하므로 dlopen 불일치가 없다. 그래서 오늘 가능한 최상단이고, 프론티어는 발판이 아니라 벽이다.
- 이 벽은 pyproc 레포에서 계속 파고들 자리다(hiwire/emval shadow, nogil-WASM 커스텀 빌드, WebGPU 산술). 파고들 때도 tests/attempts에서 시작한다.
