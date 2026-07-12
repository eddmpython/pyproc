# browser-os - 파이썬 머신 (세상에 없던 것)

상태: 개시 (2026-07-12, 토론 합의 반영). local-parity가 "로컬 따라잡기"라면, 이 이니셔티브는 **로컬에도 없는 컴퓨터**를 만든다. 커널은 이미 완성됐다는 인식에서 출발한다.

## 한 문장

**꺼지지 않고, 파일 하나로 이동하는 파이썬 컴퓨터.** 탭을 닫으면 수 MB로 잠들고(hibernate), 열면 몇 초 안에 어제 그 자리에서 깨어나며(resume), 그 컴퓨터 전체를 `.pymachine` 파일 하나로 남에게 보낼 수 있다. VM 이미지는 GB지만 우리는 리플레이+델타라서 MB다.

## 정체성 (토론 합의)

- 대외 워딩은 **"파이썬 머신"**(`.pymachine`이 정체성). "OS"는 아키텍처 내부 언어로만 쓴다(권한/스레드 모델 시비 회피).
- 선행자 대비 차별(WebContainers·Jupyter·Cloudflare 스냅샷과의 답): 그들은 코드·파일을 저장하고 재실행하지만, 우리는 **실행된 상태 그 자체**를 저장·이동·부활시킨다. 재실행은 느리고 비결정적이며(난수·시간·유료 API) 10분짜리 계산을 다시 하게 만든다. 우리는 그 결과가 든 컴퓨터를 몇 초에 깨운다. 그리고 시간여행(%undo·분기)이 커널 프리미티브다.

## 이미 가진 것 = 커널 (전부 게이트/probe 실측 완료)

| OS 개념 | pyproc 자산 |
|---|---|
| 프로세스 (fork/kill/SIGINT/스케줄러) | `PyProc`: 스냅샷-fork ~380ms, map/mapArray(4워커 5.28배), taskTimeout, interrupt |
| 가상 메모리 (체크포인트/시간여행) | `ReactiveController`: 이중 해시 페이지 diff, restoreLive ~1ms, 예외 안전 |
| hibernate/resume | `Session`: 결정적 리플레이 + 델타(성장 세션 354ms 부활) |
| 시스템콜 | `SyscallBridge`: input(JSPI 블로킹)/urllib/subprocess |
| 네트워크 스택 (소켓 0) | `AsgiServer`: 커널 안 FastAPI, dispatch 3.4ms |
| 콘솔 | `Terminal`: REPL + `%undo` 시간여행 |
| 패키지 저장소 | `WheelCache`: 재다운로드 0 |

## 만들 것 = 사용자 세계 5기둥 (토론으로 5번째 추가)

1. **머신 이미지 (.pymachine)** - 매니페스트 + 세션 델타(+ /home)를 파일 하나로. 어느 브라우저에서든 그 파일로 같은 컴퓨터가 부팅된다. **신뢰 모델을 v1부터 포함**: 머신 파일은 실행 파일과 동급 위험이므로 SHA-256 무결성 검증 + 명시적 신뢰 승인(`trust` 플래그) 없이는 열리지 않는다.
2. **영속 디스크** - OPFS를 `/home`으로 마운트해 파이썬 `open()`이 진짜 지속 파일을 읽고 쓴다. hibernate에 포함.
3. **진짜 셸** - 터미널 위에 코어유틸(%ls/%cat/%pip 등)과 파이프. 셸 언어는 파이썬 그 자체.
4. **수명주기(init)** - 탭 pagehide/visibilitychange에 auto-hibernate, 열림에 auto-resume. 데모 한 방 = "탭 닫았다 열어도 살아있는 컴퓨터 + 파일로 내보내 딴 데서 열기".
5. **오프라인 완전 부팅** - Pyodide 코어까지 OPFS 캐시. 비행기 모드에서도 컴퓨터가 켜진다. 부팅 결정성(성 전체의 토대)이 CDN 변덕에서 독립한다.

## 원칙

- local-parity와 동일: **모든 주장은 probe 실측으로만.** 실측 레인은 [tests/attempts/pythonMachine](../../tests/attempts/pythonMachine/README.md) 캠페인이다(2026-07-12 runtimeParity에서 분리).
- 제품 UI(창/작업 관리)는 소비 제품 몫. pyproc은 머신 프리미티브까지만.

## NEXT

1. ~~머신 이미지 v1~~ 완료(2026-07-12): `.pymachine`(SHA-256 + trust 게이트) -> `exportImage`/`openMachine` 승격. 13.7MB 파일로 부팅 2.5s 실측.
2. ~~영속 디스크~~ 완료(2026-07-12): `Runtime.mountHome`(기본 /home/web), 커널 간 생존 실측.
3. ~~수명주기 데모~~ 완료(2026-07-12): examples/machine.html - 탭 pagehide 자동 hibernate, 재방문 resume, 내보내기/열기 버튼, /home 방문 기록.
4. ~~오프라인 부팅~~ 완료(2026-07-12, 2단): `boot({coreCacheDir})`(fetch 계층) + `pyprocSw.js?cache=1`(script 경로까지, 2차 부팅 CDN miss 0). 비행기 모드 컴퓨터 성립.
5. ~~커널 데몬(탭 밖에서 사는 머신) v1~~ 완료(2026-07-12): `SharedKernel`(SharedWorker) - 여러 탭 = 한 파이썬 상태. 벽: SharedWorker COI=false = SAB 불가(interrupt/fork 제외, 플랫폼 대기).
6. ~~진짜 OS 표면 라운드~~ 완료(2026-07-12): ① 모든 것은 파일 `DeviceFs`(/dev/clipboard·/proc, 새 API 표면 0) ② init/cron `Init`(boot.py 오토스타트 + 크론) ③ requests 실동작 ④ 셸 %pip.
7. ~~근본 OS 라운드 1차~~ 완료(2026-07-12): **fork(2)**(`PyProc({replay})`+`fork` - 살아있는 상태 복제, 적용 1.4ms) + **시그널 표**(`signal(pid, signum)` - SIGTERM/SIGUSR1 핸들러 발화) + **체크포인트 나무**(머신의 git. 선형 체인의 힙 파손 결함을 재현하고 수정).
8. **다음 프리미티브 로드맵**: [01-os-primitives.md](01-os-primitives.md)가 정본(전문 에이전트 3종 토론 종합). 우선순위: ~~P1 저널(WAL)~~ 완료 -> P2 커널 선출(커널을 워커로 = fork 비대칭 해소 + 탭 죽음 생존) -> P3 잡 컨트롤(&) -> P4 파이프/shm -> P5 머신 컨테이너 -> P6 권한 감옥 -> P7 파일 세계 v2. 터미널 비전("스크롤백이 살아있다")과 안티 추천 8종도 같은 문서.
9. ~~객관 판정 + 셀프호스팅 증명~~ 완료(2026-07-12): [02-os-verdict.md](02-os-verdict.md) - 심판 3종 토론(OS 점수표 49/100 조건부 / 개발 플랫폼 성립 / 반론 10) + 당일 수리 6건(배선 3종·fork 정화·h0 가드·persist·표기 정직화) + 풀스택 셀프호스팅 실측([selfHost](../../tests/attempts/selfHost/README.md) 8/8).
10. /home 포함 이미지 포맷 v2 + SharedKernel과 hibernate/resume 결합.
