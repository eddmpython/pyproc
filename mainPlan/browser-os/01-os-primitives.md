# 01. 근본 OS 프리미티브 - 연구 종합과 로드맵

작성: 2026-07-12. 근거: 전문 에이전트 3종 토론(OS 아키텍처 / 혁신 터미널 / 가상화) + 같은 날 실측 5종.
정본 실측 레인: [tests/attempts/pythonMachine](../../tests/attempts/pythonMachine/README.md), [runtimeParity](../../tests/attempts/runtimeParity/README.md).

## 진단: 커널에 없던 4가지

OS 교과서에 대면 정확히 4개의 부재가 보였고, 이 문서의 로드맵은 전부 이것을 채운다.

1. **죽음 내성이 없다.** hibernate는 pagehide 훅이 성공해야 산다. 강제종료·OOM이면 마지막 저장 이후가 증발한다.
2. **fork가 부팅 이미지의 fork였다.** 스냅샷-fork는 bare 이미지 복제라 `x = bigDf`를 자식에 못 넘긴다. -> **2026-07-12 해소**(아래 완료 1).
3. **IPC가 단계형(staged)뿐이다.** map은 배치다. 스트리밍 파이프·블로킹 read·backpressure가 없다.
4. **시그널 표가 SIGINT 한 칸이었다.** -> **2026-07-12 해소**(아래 완료 2).

## 완료 (이번 라운드 승격)

1. **forkLive = 진짜 fork(2)** - `PyProc({replay})` + `fork(src, dst)`. 살아있는 프로세스의 변수·배열·계산 결과가 자식으로 실린다(델타 10.3MB 수확 43.6ms, 주소공간 독립).
   - **정화 가드(2026-07-12 심판 수리)**: 자식측이 델타 밖 드리프트를 cp0으로 되돌려 더러운 dst에도 정확히 "경계 + 부모 델타"를 만든다(혼합 상태 소거, 게이트 마커 배타 검사 상시). 적용 비용 1.4ms -> 33ms(힙 1회 스캔 = 정확성의 값). parentPid 계보 기록. 객관 판정 전문: [02-os-verdict.md](02-os-verdict.md).
   - **벽 좌표**: 메인 커널 vs 워커 커널의 리플레이는 **바이트가 다르다**(로더/컨텍스트 차이). 워커끼리는 동일하다. 그래서 fork는 대칭 컨텍스트(워커-워커)에서만 성립하고, 메인은 조율자다. 이 사실이 아래 P2(커널을 워커로)의 근거다.
2. **시그널 표** - `PyProc.signal(pid, signum)` + `SIGNAL{INT,TERM,USR1,USR2}`. SAB 채널에 번호를 쓰면 CPython eval 루프가 그 번호의 파이썬 핸들러를 부른다(협조적 종료 264ms, 워커 재사용 가능). 발명 0으로 유닉스 시그널이 열렸다.
3. **체크포인트 나무(머신의 git)** - `reactive.parents` + `tree()`. **선형 체인의 실결함을 재현하고 고쳤다**: 분기 노드로 스위치하면 버려진 형제 분기의 델타를 집어 `memory access out of bounds`로 힙이 깨졌다(%undo는 뒤로만 가서 무증상이었다). 델타 해석이 부모 체인을 따르도록 수정.

## 다음 프리미티브 (우선순위)

| # | 프리미티브 | 무엇 | 왜 획기적 | 관문/게이트 |
|---|---|---|---|---|
| ~~P1~~ | ~~**machineJournal (WAL + 페이지 CAS)**~~ **완료(2026-07-12)** | 유휴마다 변경 페이지를 content-addressed로 OPFS에 append + HEAD commit. 부팅 = 리플레이 + `recover()` | **브라우저를 강제 종료해도 마지막 커밋으로 부활**한다(hibernate 훅이 실패해도 산다) | **승격: `MachineJournal`(enableJournal)**. 설계 확정 근거 = churnProbe: no-op 문장조차 ~95p(6MB)를 더럽히고 그 집합이 97% 고정(CPython eval/GC scratch)이라 **문장단위 WAL은 기각**, 유휴 배치가 총 쓰기 **88% 절감**. 계약: 크래시 시 잃는 것은 마지막 커밋 이후(경계 일관성). 다음 최적화: blob 개별 파일 -> append-only 팩(커밋 1회 ~2s의 대부분이 OPFS 파일 생성) |
| ~~P2~~ | ~~**kernelElection (커널 선출 + 탭 죽음 생존)**~~ **완료(2026-07-13)** | Web Locks로 리더 탭 선출, 리더만 커널(bootSession + 저널) 부팅, 다른 탭은 BroadcastChannel RPC 뷰. 리더가 죽으면 저널에서 resume | OS가 자기 하드웨어(탭)의 죽음에서 생존한다. SharedWorker(COI=false)의 약속을 SAB 포기 없이 달성(리더 커널은 자기 문서에 살아 COI 상속) | **승격: `KernelElection`.** kernelElectionProbe GREEN 5/5(iframe 3개 = 탭 3개): 리더 정확히 하나(2739ms), 3탭 RPC 정합(여러 탭 = 한 상태), RPC 왕복 p50 1.07ms(< 3), 리더 iframe 제거 = 탭 죽음 -> lock 자동 해제 -> **failover 2763ms(< 5s) + 저널 resume으로 x=41 생존**(recovered=true). 주: fork 대칭화(커널을 워커로)는 P3에서 별도로 다룬다 - 이 프리미티브는 "탭 죽음 생존"이 본질 |
| ~~P3~~ | ~~**jobControl (셸의 &)**~~ **완료(2026-07-13)** | `y = f(x) &` = forkLive로 지금 네임스페이스를 복제해 딴 코어에서 실행. `%jobs`/`%fg`/`%kill`. 잡 테이블 | 브라우저 파이썬에 job control이 존재한 적 없다. fork(완료)와 시그널(완료) 위에 바로 선다 | **승격: `JobControl` + `PyProc.repl` + worker repl 메시지.** jobControlProbe GREEN 8/8: 프롬프트 복귀 76.6ms(< 100), 잡 실행 중 대화형 5/5, %fg가 fork된 네임스페이스로 계산한 값 회수(sum(x*x)=333328333350000), %kill 45.2ms(< 200, 무한 루프 회수 = state killed), 슬롯 재사용. 벽 해소: fork는 워커끼리만 대칭이라 대화형 REPL도 워커 레인(replay 풀 레인 0)에서 돈다 = P2가 예고한 "커널을 워커로"를 jobControl이 실현 |
| ~~P4~~ | ~~**pipes + shm**~~ **완료(2026-07-13)** | SAB 링버퍼 파이프(Atomics.wait = 진짜 블로킹 read + backpressure), 명명 공유 메모리, Lock/Semaphore | map은 배치고 파이프는 흐름이다. `A | B` 스트리밍이 서면 중간 산출이 램에 안 쌓인다 | **승격: `PyProc.pipe/lock/semaphore/shm/exec` + `src/processOs/ipc.js`.** pipeShmProbe GREEN 6/6: 처리량 982.9MB/s, 소메시지 편도 p50 0.092ms, backpressure 무손실(md5), 블로킹 read 중 SIGTERM 회수 + 워커 생존, 락 상호배제 600, 커널 엔드포인트 왕복. 핵심 설계: 유한 슬라이스 Atomics.wait(블로킹에 시그널을 끼움), memcpy 1회(제로카피 불가 준수), EOF=undefined |
| ~~P5~~ | ~~**machineContainers (머신 안 머신)**~~ **완료(2026-07-13)** | `.pymachine`을 워커에서 openMachine -> `m = bootMachine(...)`가 파이썬 값. 머신마다 자기 매니페스트 = 자기 패키지 세트 | 이미지(.pymachine + SHA-256 + trust) + 레지스트리(OPFS) + 실행(워커) = 도커의 3요소가 브라우저에 완성 | **승격: `MachineContainer`(new MachineContainer(rt)) + `src/processOs/machineWorker.js`.** machineContainerProbe GREEN 6/6: warm 부팅 274ms(스냅샷 fast fork, 1회 제조 2383ms amortize), 외부-내부 RPC p50 1.38ms(< 2), 깊이 2(컨테이너 속 컨테이너, 값이 층 거슬러 옴, 503ms), 내부 kill 외부 무영향(주소공간 독립), 격리(네임스페이스 안 샘), 파이썬 값 노출(`m = pyprocMachine.spawn(); m.run(...)`, 블로킹=JSPI) |
| P6 | **machineJail (권한 매니페스트)** | 머신 헤더에 `permissions{net, clipboard, home, workers}`. 집행 2단: 협조(우리 초크포인트) + **감옥**(sandboxed iframe + CSP `connect-src`) | trust:true 이진 게이트가 스코프 승인으로 진화. 파이썬 레벨 검사는 `import js`로 우회 가능함을 인정하고 **브라우저의 벽**을 빌리는 정직한 설계 | 감옥 안 비허용 host fetch 차단 실증, 부팅 오버헤드 < 1.5x |
| ~~P7~~ | ~~**fsWorld v2**~~ **완료(2026-07-13)** | mount 테이블 + `/proc/<pid>/ctl`(쓰기 = 시그널, Plan 9) + `/etc`, `/var/log`, `/tmp` + 장치 성장(`/dev/random`, `/dev/fb0` = 파이썬이 raw RGBA를 쓰면 화면에 뜬다) | 합치면 "파이썬이 브라우저의 전부를 파일로 만진다"가 완성. fb0 + 터미널 = 화면 있는 완전한 기계 | **승격: `DeviceFs` 확장(track/framebuffer/signal + /dev/random).** fsWorldProbe GREEN 5/5: /dev/fb0 640x480 **379fps**(파이썬 RGBA -> putImageData), /proc/<pid>/ctl 쓰기=시그널 왕복 **55ms**(< 60), /var/log 재부팅 생존(OPFS 마운트), /dev/random 신선. mount는 mountHome이 임의 경로로 담당(homeDiskProbe 검증분 재사용). 새 능력 없이 "모든 것은 파일" 한 네임스페이스로 흡수(Plan 9) |

## 터미널: "스크롤백이 살아있다"

터미널 연구의 비전 한 줄: **터미널은 프로세스를 보는 창이 아니라, 시간·프로세스·파일이 일급 값인 머신의 조종면이다.**
조사 결론: Warp(블록)·Wave(위젯)·asciinema(녹화)는 전부 **바이트 스트림 위의 재포장**이고, 지나간 텍스트를 예쁘게 만든다. 우리만 가진 것은 프롬프트마다의 힙 체크포인트, fork, 머신 파일이다.

기능 로드맵(wow-per-effort 순, 신규 캠페인 `tests/attempts/machineTerminal/`에서 실측):

1. **`/dev/display`** [S] - `plt.show()`가 인라인 PNG로. DeviceFs `close` 콜백 1줄 + PNG 매직 라우팅. 새 API 0.
2. **Ghost history + live completion** [S] - `rlcompleter`(표준 라이브러리, 의존성 0)로 **살아있는 객체**를 완성한다(IDE보다 정확한 유일한 지점). 히스토리가 힙에 살아 hibernate 후에도 부활.
3. **Time Rail** [M] - 프롬프트마다 체크포인트 점, 클릭하면 그 순간의 컴퓨터로 복귀(~1ms), 거기서 치면 분기. **나무 수정(완료)이 이것의 전제였다.**
4. **Addressable blocks** [S/M] - `Out[3]`이 살아있는 파이썬 값. 시간여행하면 그 이후 Out도 사라진다(출력도 상태다).
5. **Session cast** [M] - 세션 공유 = 영상이 아니라 **컴퓨터를 보낸다**(.pymachine 드래그 앤 드롭 + trust 배너).
6. **`&` = fork the world** [L] - P3 jobControl의 UI 표면.

## 안티 추천 (끌리지만 우리에게 틀린 것)

1. **SharedWorker를 커널로 승격.** COI=false는 플랫폼 벽이고 그 안의 커널은 SAB/interrupt/fork/shm을 전부 잃는다. 라우터로 강등하거나 Web Locks + BroadcastChannel로 대체(P2).
2. **메인 커널의 선점 시분할**(settrace/monitoring 바이트코드 예산). settrace는 2-10배 감속. 선점 단위는 프로세스(워커)이고 커널은 대화형 전용이다.
3. **사용자/계정 시스템.** 브라우저 프로필이 이미 사용자다. 필요한 건 신원이 아니라 머신별 능력(P6).
4. **SAB 위 numpy 제로카피 약속.** 단일 선형 메모리 벽으로 불가능. "memcpy 1회"를 공개 계약으로 유지.
5. **VT100/xterm.js 에뮬레이션과 셸 파이프 미니 언어(`|`, `>`).** 1978년의 제약을 역수입하고, 파이썬 위에 두 번째 문법을 얹는 덕지덕지다. 셸 언어는 파이썬 그 자체이고, 파이프의 본질(lazy 조합)은 제너레이터에 이미 있다. 대신 매직을 **값**으로도 노출한다(`[f for f in ls() if f.endswith(".py")]`).
6. **split pane / 창 관리자.** 제품 UI는 소비 제품 몫. "한 머신을 여러 화면에서"의 답은 P2(커널 선출)다.
7. **커스텀 Pyodide 빌드(pthread/nogil).** engine-independence PRD의 사다리가 정본 경로이고 이 라운드가 앞지르면 안 된다.
8. **WebRTC 분산 머신.** 시그널링 서버 의존 = zero-dep 위반. 기기 간 이동은 `.pymachine` 파일이 담당한다(이미 있다).
