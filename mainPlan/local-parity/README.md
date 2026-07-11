# local-parity - "브라우저 파이썬 = 로컬 파이썬" 발명 프로그램

상태: 개시 (2026-07-11). 목표: 웹 파이썬이 실행·터미널·라이브러리에서 로컬과 구분 불가능해지는 것. 각 축은 tests/attempts 카테고리에서 실측으로 전진하고, 졸업분만 src로 승격한다.

## Parity 지도 (축별 현재 위치)

| 축 | 로컬의 기준 | 현재 (2026-07-11) | 다음 attempts |
|---|---|---|---|
| 실행 | 순수 파이썬 로직 속도 | **도달** (CPython 3.14 WASM >= 로컬 3.12, numpy 대규모만 86배 열세) | WebGPU 산술(프론티어) |
| 프로세스 | fork/Pool/kill이 되는 OS | **도달(v1)**: 스냅샷-fork ~380ms, map 병렬, taskTimeout + kill/respawn + `interrupt(pid)`(SIGINT, respawn 0) | 시그널 확장(SIGSTOP/재개), 프로세스간 IPC |
| 시스템콜 | input/HTTP/subprocess | **도달(v1)**: input(동기+JSPI 블로킹), urllib 실 GET, subprocess(자식 워커, `-c`) | requests 계열, 저수준 socket(프록시 계약), 파일계(FS Access 마운트) |
| 세션 영속 | (로컬도 없음: REPL은 죽으면 끝) | **로컬 초월(v1)**: `Session` 승격. 결정적 리플레이 + 델타(5.9MB급)로 커널 간·세션 간 부활, 게이트 상시 | 성장 세션(v2), 델타 체인·분기, 매니페스트에 wheel 캐시 결합 |
| 터미널 | 로컬 REPL과 동일 체감 | **도달(v1)**: `Terminal` 능력 승격 + examples/terminal.html(블로킹 input 재개 24ms) | 히스토리·자동완성·멀티라인 편집 |
| 라이브러리 | `pip install` 전부 | **실측 17/17**: 대표군(pandas/scipy/sklearn/matplotlib/pillow/sqlalchemy/lxml/httpx/cryptography 등 + fastapi/polars/requests) 전부 설치·import ok(v314) | 표본 확대(실패군 발견), wheel OPFS 캐시(재설치 0), 네이티브 전용군 분류 |
| 상주/네이티브 | 데몬, 네이티브 휠(torch CUDA), 데스크톱 조작 | **영구 벽**(웹 보안 모델). 정직하게 스코프 밖 | 벽 앞 우회: 소비 제품의 로컬/Actions 티어 몫 |

## 원칙

1. **parity는 주장으로 얻지 않는다.** 축마다 attempts probe가 숫자로 판정한다(위 표의 수치는 전부 브라우저 게이트/probe 실측).
2. **벽은 벽이라고 쓴다.** WASM dlopen(warm-fork/nogil/제로카피)과 네이티브 휠은 upstream 연구 문제다. 로드맵이 아니라 프론티어 절에 둔다.
3. 아키텍처·계약 상세는 [web-python-runtime](../web-python-runtime/01-architecture.md)이 정본이고, 이 이니셔티브는 격차 지도와 우선순위만 소유한다.

## 흡수 계획 (dartlab 병행 구현 발견, 2026-07-11)

dartlab이 자체 노트북 런타임(`mainPlan/web-notebook-runtime`)과 browser-as-server(`mainPlan/browser-as-server-ssot`, e2e PASS)를 Pyodide 0.27.5로 병행 구현했다. 세 소비자의 개별 풀이는 동결 상태이고, pyproc이 서면 전부 pyproc을 바라보게 한다(소유자 결정). pyproc이 가져올 것:

1. **예외 안전 복원**: 실행 중 예외는 checkpoint 없이 힙을 더럽혀 restoreLive 경계 계약을 조용히 깬다. dartlab 해법 = 복원 전 현재 힙 재해시. pyproc은 옵션(`rehash`)으로 흡수.
2. **체크포인트 그래프 + OPFS**: 분기 복원(부모 그래프), content-addressed 상태, OPFS 원장. 기준 힙 영속은 2026-07-11 `saveBase`/`loadBase`로 1단계 흡수(30MB 쓰기 256ms/읽기 46ms). 남은 것: 델타 체인 영속 + 분기 그래프 + 세션 간 커널 복원.
3. **browserAsServer**: "로컬 서버 = 소켓이 아니라 ASGI". SW fetch -> ASGI dispatch, HTTP 오버헤드 8ms, `async def` 강제 제약까지 검증 완료. 능력 계약으로 흡수.
4. **라이브러리·파일계 체크리스트**: wheel OPFS 캐시, requirements manifest, `%pip` 영속, 부팅+복구+첫 셀 시간 기준선.
5. ~~버전 정합 관문~~ **통과(2026-07-11 실측)**: v314.0.2에서 fastapi/pydantic/polars/numpy/requests 전부 설치·import ok. dartlab 이관에 버전 장애물 없음.

## NEXT

1. ~~예외 안전 복원 흡수~~ 완료(2026-07-11): `restoreLive({rehash})` 승격 + 게이트 상시화.
2. ~~browserAsServer 흡수~~ 완료(2026-07-11): `AsgiServer` 능력 승격(dispatch 3.4ms, 200/422 검증, 게이트 상시화). Service Worker 배선은 소비 제품 몫.
3. ~~terminal 승격~~ 완료(2026-07-11): `Terminal` 능력 + examples/terminal.html + 게이트 상시화.
4. browserAsServer 능력 계약 설계(흡수 3) / 체크포인트 그래프+OPFS(흡수 2) / 라이브러리 커버리지 / 협조적 취소(SIGINT).
5. **리플레이+델타 = 불멸 커널/warm-fork (실증 완료, 2026-07-11)**: 결정적 부팅(PYTHONHASHSEED=0 + 엔트로피/시간 고정)이 바이트 단위 동일 힙을 재현(180p 상이 -> 0p)하고, 사용자 상태는 델타 페이지(10MB급)만 OPFS에 저장해 동형 커널에 1.5ms 적용으로 부활. Pyodide 스냅샷의 hiwire 벽을 upstream 수정 없이 우회(전문 리서치: Cloudflare workerd와 동원리, 단 우리는 리플레이 기반). 승격 후 "웹의 uv"는 (매니페스트=환경 선언) + (wheel OPFS 캐시) + (세션 델타)의 3층이 된다.
