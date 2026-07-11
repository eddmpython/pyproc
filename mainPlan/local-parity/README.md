# local-parity - "브라우저 파이썬 = 로컬 파이썬" 발명 프로그램

상태: 개시 (2026-07-11). 목표: 웹 파이썬이 실행·터미널·라이브러리에서 로컬과 구분 불가능해지는 것. 각 축은 tests/attempts 카테고리에서 실측으로 전진하고, 졸업분만 src로 승격한다.

## Parity 지도 (축별 현재 위치)

| 축 | 로컬의 기준 | 현재 (2026-07-11) | 다음 attempts |
|---|---|---|---|
| 실행 | 순수 파이썬 로직 속도 | **도달** (CPython 3.14 WASM >= 로컬 3.12, numpy 대규모만 86배 열세) | WebGPU 산술(프론티어) |
| 프로세스 | fork/Pool/kill이 되는 OS | **도달(v1)**: 스냅샷-fork 384ms, map 병렬, taskTimeout + kill/respawn | 협조적 취소(SIGINT, `setInterruptBuffer`) |
| 시스템콜 | input/HTTP/subprocess | **도달(v1)**: input(동기+JSPI 블로킹), urllib 실 GET, subprocess(자식 워커, `-c`) | requests 계열, 저수준 socket(프록시 계약), 파일계(FS Access 마운트) |
| 터미널 | 로컬 REPL과 동일 체감 | **개념 입증**: InteractiveConsole + JSPI input 블로킹 재개(24ms) 실측 | Terminal 능력 계약(`push(line)`) 승격 + examples 터미널 |
| 라이브러리 | `pip install` 전부 | **부분**: Pyodide 배포판(numpy/pandas/scipy 등 컴파일 완료분) + micropip(순수 파이썬 휠 전부) | 휠 커버리지 실측 카테고리(상위 PyPI 100 설치율), 실패군 분류 |
| 상주/네이티브 | 데몬, 네이티브 휠(torch CUDA), 데스크톱 조작 | **영구 벽**(웹 보안 모델). 정직하게 스코프 밖 | 벽 앞 우회: 소비 제품의 로컬/Actions 티어 몫 |

## 원칙

1. **parity는 주장으로 얻지 않는다.** 축마다 attempts probe가 숫자로 판정한다(위 표의 수치는 전부 브라우저 게이트/probe 실측).
2. **벽은 벽이라고 쓴다.** WASM dlopen(warm-fork/nogil/제로카피)과 네이티브 휠은 upstream 연구 문제다. 로드맵이 아니라 프론티어 절에 둔다.
3. 아키텍처·계약 상세는 [web-python-runtime](../web-python-runtime/01-architecture.md)이 정본이고, 이 이니셔티브는 격차 지도와 우선순위만 소유한다.

## NEXT

1. terminal 승격(게이트 3): `Terminal` 능력 계약 + examples 터미널 페이지 + 브라우저 게이트 검사.
2. 라이브러리 커버리지 카테고리 개설: 상위 PyPI 패키지 설치·import 성공률 실측(성공/실패군 분류표가 산출물).
3. 협조적 취소 카테고리: `setInterruptBuffer` 기반 SIGINT(행 워커를 kill 없이 회수).
