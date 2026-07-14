# 04. OS 판정표 v2 - P2/P4/P6 이후 재판정

작성: 2026-07-14. 갱신: 2026-07-15. 근거: `browser-os` 판정 이후 완료된 커널 선출(P2), 잡 컨트롤(P3), 파이프/shm(P4), 머신 컨테이너(P5), 권한 감옥(P6), 파일 세계 v2(P7), MachineJournal pack/prune, 대표 데모 3종의 src 승격, codaro의 `Runtime.fs`/`AsgiServer` 제품 소비와 browser/example gate 실측.

## 한 줄 판정

**Browser Python OS 간판은 정당화 가능(70/100)으로 상승했다.** 2026-07-12의 49/100은 "가장 OS에 가까운 브라우저 파이썬 런타임"이었다. 지금은 프로세스, IPC, 보호, 탭 죽음 생존, 512MB 대형 힙 봉투, journal 1차 속도 병목, `/home` 포함 signed `.pymachine`, 대표 데모 3종이 실제 커널 능력과 제품 표면으로 닫혔으므로 "Chromium 탭 안의 Browser Python OS 커널"이라고 부를 수 있다.

단, 무수식 "로컬 OS" 또는 "리눅스급 웹 OS"는 아직 아니다. 2026-07-14에서 2026-07-15 사이에 512MB checkpoint/session/fork/journal 비용은 [05-large-heap-envelope.md](05-large-heap-envelope.md)로 실측됐고 journal recover 병목은 24.8s에서 2.3s로 줄었다. MachineJournal pack/prune은 장기 loose blob 누적 구조를 닫았다. `.pymachine` signature, 부트 자산 SRI v2, Service Worker 등록 자산 봉인, codaro의 첫 제품 소비 증거도 들어갔지만, 공개키 배포 UI와 권한 UI는 남아 있다.

## 점수 기준

| 구간 | 판정 |
|---|---|
| 0-39 | 런타임 또는 데모 |
| 40-59 | OS-like runtime |
| 60-74 | Browser-bound OS kernel |
| 75-84 | 제품 표면까지 갖춘 브라우저 OS |
| 85+ | 로컬급 범용 OS에 가까운 상태 |

현재 점수 70은 세 번째 구간이다. 간판은 "Browser Python OS kernel"까지 허용하고, "local-grade OS"는 아직 보류한다.

## OS 점수표 v2

| 축 | 2026-07-12 | v2 | 근거 | 아직 못 올리는 이유 |
|---|---:|---:|---|---|
| 프로세스 관리 | 6 | 7 | `PyProc`의 fork/signal/kill/exec, `JobControl`의 `&`, `%fg`, `%kill`, replay worker 풀. 근거: [pyProc.js](../../src/processOs/pyProc.js), [jobControl.js](../../src/processOs/jobControl.js), [pythonMachine](../../tests/attempts/pythonMachine/README.md) | process group, wait 계열, exec image replacement 없음 |
| 메모리 관리 | 4 | 7 | checkpoint tree, restore/timeTravel, Session replay+delta, forkLive 델타 적용, 512MB checkpoint/session/fork/journal 실측. journal recover는 24.8s에서 2.3s로 줄었다. 근거: [reactive.js](../../src/capabilities/reactive.js), [session.js](../../src/capabilities/session.js), [machineJournal.js](../../src/capabilities/machineJournal.js), [largeHeapEnvelope](../../tests/attempts/largeHeapEnvelope/README.md) | 가상메모리/보호/쿼터는 아니다 |
| 파일시스템 | 5 | 7 | `/home` OPFS, `Runtime.fs`, `/dev/random`, `/dev/fb0`, `/proc/<pid>/ctl`, `/var/log` 생존, `.pymachine` home payload. 근거: [fileSystem.js](../../src/capabilities/fileSystem.js), [deviceFs.js](../../src/capabilities/deviceFs.js), [session.js](../../src/capabilities/session.js), [fsWorldProbe](../../tests/attempts/pythonMachine/README.md) | 파일 권한/락/마운트 정책 부족 |
| IPC | 3 | 7 | SAB ring pipe, blocking read, backpressure, shm, lock, semaphore, kernel endpoint. 근거: [ipc.js](../../src/processOs/ipc.js), [pipeShmProbe](../../tests/attempts/pythonMachine/README.md) | select/poll, 다중 producer/consumer 정책, 오류 전파 계약 보강 필요 |
| 스케줄링 | 3 | 5 | map queue, task timeout, signal, background job, prompt immediate return. 근거: [pyProc.js](../../src/processOs/pyProc.js), [jobControlProbe](../../tests/attempts/pythonMachine/README.md) | 선점 스케줄링은 의도적으로 기각, priority/fairness 없음, 백그라운드 탭 스로틀은 플랫폼 벽 |
| 보호·격리 | 5 | 7 | worker 주소공간 격리, `.pymachine` trust gate + WebCrypto signature, 부트 자산 SRI v2, `registerPyProcServiceWorker`, SW `coreIntegrity`, `MachineJail` 협조 티어 + CSP connect-src 집행. 근거: [machineJail.js](../../src/capabilities/machineJail.js), [session.js](../../src/capabilities/session.js), [runtime.js](../../src/runtime/runtime.js), [assets.js](../../src/runtime/assets.js), [pyprocSw.js](../../src/capabilities/pyprocSw.js), [jailProbe](../../tests/attempts/pythonMachine/README.md) | same-origin parent 측면통로, 공개키 배포 UI 없음, 권한 UI 없음, 힙 평문 비밀 경고 필요 |
| 네트워크 | 4 | 6 | ASGI/VirtualOrigin으로 브라우저 안 서버, SocketBridge로 outbound HTTP/HTTPS socket. 근거: [asgiServer.js](../../src/capabilities/asgiServer.js), [virtualOrigin.js](../../src/capabilities/virtualOrigin.js), [socketBridge.js](../../src/capabilities/socketBridge.js), [socketBridge probes](../../tests/attempts/socketBridge/README.md) | 공개 inbound port, 쿠키 세션, WebSocket upgrade, streaming/SSE는 벽 또는 미지원 |
| 부팅·초기화 | 7 | 8 | boot/freeze/uv lane, offline core cache, Init boot.py/cron, KernelElection leader failover. 근거: [envManager.js](../../src/capabilities/envManager.js), [init.js](../../src/capabilities/init.js), [kernelElection.js](../../src/processOs/kernelElection.js) | Pyodide private snapshot API와 버전 핀 의존 |
| 영속·크래시 내성 | 7 | 8 | MachineJournal WAL, recover h0 대조, `pack()`/`prune()` live blob compaction, KernelElection failover, Session revival, `/home` 포함 signed `.pymachine`. 512MB journal commit/recover는 2-3초대로 진입했다. 근거: [machineJournal.js](../../src/capabilities/machineJournal.js), [session.js](../../src/capabilities/session.js), [kernelElectionProbe](../../tests/attempts/pythonMachine/README.md), [journalPackProbe](../../tests/attempts/pythonMachine/journalPackProbe.html) | 부활 후 fd 재개설 필요, 512MB급 자동 pack 정책 수치 없음 |
| 개발자 표면 | 5 | 8 | Terminal, `%pip`, `%undo`, JobControl, self-hosting FastAPI/sqlite/html, signed machine cast, Speed Lab public benchmark, `/dev/fb0`, codaro 제품 gate의 `Runtime.fs`/`AsgiServer` 소비. 근거: [terminal.js](../../src/capabilities/terminal.js), [selfHost](../../tests/attempts/selfHost/README.md), [runtimeParity](../../tests/attempts/runtimeParity/README.md), [examples](../../examples/), [소비 계약](../../docs/consuming/contract.md) | `.pymachine` 제품 소비, completion/history polish, compatibility lab 미완 |

합계: **70/100**.

## 49에서 69로 오른 이유

점수가 오른 핵심은 이름이 아니라 닫힌 축이다.

1. **IPC가 3에서 7로 상승**: 배치 map뿐이던 상태에서 pipe, shm, lock, semaphore가 들어왔다. OS 판정에서 가장 큰 상승분이다.
2. **탭 죽음 생존이 실제 커널 능력이 됐다**: KernelElection이 리더 죽음 후 failover와 저널 resume을 실측했다.
3. **권한이 trust boolean에서 권한 감옥으로 진화했다**: MachineJail이 협조 티어와 CSP 집행을 분리했다.
4. **대화형 프로세스 모델이 생겼다**: JobControl이 `&`, `%fg`, `%kill`로 셸의 핵심 체감을 만든다.
5. **파일 세계가 OS 표면이 됐다**: `/proc/<pid>/ctl` 쓰기가 시그널이고, `/dev/fb0`가 화면이며, `/var/log`가 재부팅을 견딘다.
6. **512MB 대형 힙 봉투가 숫자로 닫혔다**: checkpoint/session/fork/journal이 모두 GREEN이다.
7. **journal recover 병목이 1차 해소됐다**: 같은 blob key를 반복 읽고 검증하던 비용을 제거해 512MB recover가 24.8s에서 2.3s로 줄었다.
8. **journal loose blob 누적이 구조적으로 닫혔다**: `MachineJournal.pack()`/`prune()`이 HEAD/PREV live blob만 pack 파일로 묶고, pack-only recover와 PREV fallback을 통과했다.
8. **`.pymachine`이 `/home`까지 싣는다**: 힙 델타와 파일 트리가 한 봉투 해시 안에 들어가 portable machine image가 됐다.
9. **`.pymachine`이 서명 출처를 검증한다**: trusted public key가 있으면 `trust: true` 없이 열리고, 다른 공개키는 거부된다.
10. **부트 자산 SRI v2가 들어갔다**: `pyodide.js`와 fetch 경로 core 자산은 SRI manifest로 검증되고, pyproc worker graph는 `assetIntegrity` preflight로 spawn 전에 검증된다. OPFS 캐시 변조와 잘못된 worker SRI는 거부된다.
11. **대표 데모 3종이 닫혔다**: machine, serverDev, speedLab이 모두 사람용 UI와 `?gate` 자동 검증을 가진다.

## 아직 조건부인 이유

1. **대형 힙 봉투는 성립했지만 아직 로컬급 전체 OS는 아니다.** 512MB checkpoint/session/fork/journal은 실측됐고 journal commit/recover는 2-3초대로 줄었다. 그러나 session save/load는 여전히 초 단위이고, 가상메모리·쿼터·swap 같은 로컬 OS 메모리 정책은 없다.
2. **신뢰 체인은 제품 배포까지 닫혀야 한다.** `.pymachine` signature, 부트 자산 SRI v2, 실행 자산 manifest runtime preflight, Service Worker 등록 자산 봉인은 들어갔지만 공개키 배포 UI와 권한 승인 UI는 남아 있다.
3. **네트워크는 가상화다.** 브라우저 보안상 공개 inbound port와 임의 native socket server는 외부 릴레이 없이는 불가다.
4. **제품 표면은 아직 초기 단계다.** `examples/machine.html`, `examples/serverDev.html`, `examples/speedLab.html`은 대표 흐름을 닫았고, codaro는 asset graph, `Runtime.fs`, `AsgiServer`를 제품 gate로 소비한다. 다만 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 같은 상위 OS 묶음의 제품 채택은 아직 남아 있다.

## 현재 허용 문장

허용:

> pyproc은 Chromium 탭 안에서 파이썬 프로세스, 파일 세계, 권한, 네트워크 가상화, 시간여행, 크래시 생존을 제공하는 Browser Python OS 커널이다.

금지:

> pyproc은 브라우저에서 리눅스를 완전히 대체한다.

보류:

> pyproc은 로컬급 범용 OS다.

보류 문장을 열려면 제품 소비 배선을 machine image 또는 VirtualOrigin 축까지 넓히고 공개키·권한 UI 계약을 닫아야 한다. journal pack/prune은 구조를 닫았지만, 512MB급 자동 pack 정책 수치는 제품 장수 운영 기준으로 남긴다.

## 다음 게이트

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. MachineJournal pack 자동 실행 기준을 512MB급 장수 머신에서 실측한다.
