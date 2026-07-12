# pythonMachine - 파이썬 머신 캠페인 (browser-os 이니셔티브의 실측 레인)

runtimeParity(로컬 따라잡기)와 별개의 개념 캠페인이다: **꺼지지 않고 파일 하나로 이동하는 컴퓨터.**
세부 질문은 폴더가 아니라 probe 파일로 늘린다. 정본 계획: [mainPlan/browser-os](../../../mainPlan/browser-os/README.md)

## 가설

결정적 리플레이 + 사용자 델타 + OPFS(디스크/코어/휠 캐시)를 합치면, 브라우저 탭이 hibernate/resume되고
`.pymachine` 파일로 이동하는 완전한 파이썬 머신이 된다. 각 질문은 브라우저 실측으로만 판정한다.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 부팅이 결정적인가(성의 토대) | [bootDeterminismProbe.html](bootDeterminismProbe.html) | 시드/엔트로피 고정 시 상이 페이지 0 |
| 선형 메모리 되쓰기만으로 되나 | [crossKernelProbe.html](crossKernelProbe.html) | (부정 실측: 벽 좌표 확정용) |
| 델타만으로 동형 커널에서 부활하나 | [replayForkProbe.html](replayForkProbe.html) | 상태 전부 생존 + ms급 적용 |
| 힙이 자란 세션도 부활하나 | [sessionGrowProbe.html](sessionGrowProbe.html) | 성장 세션 복원 정확 + 연속 실행 |
| 컴퓨터가 파일 하나로 이동하나 | [machineImageProbe.html](machineImageProbe.html) | 단일 파일 + SHA-256 + trust 게이트 + 부활 |
| 디스크가 커널을 넘어 사나 | [homeDiskProbe.html](homeDiskProbe.html) | /home/web 파일이 새 커널에서 생존 |
| 네트워크 없이 부팅되나 | [offlineBootProbe.html](offlineBootProbe.html) | 2차 부팅 fetch 계층 miss 0 |
| script 경로까지 오프라인 되나(구멍 봉인) | [swOfflineProbe.html](swOfflineProbe.html) | SW 캐시-우선으로 2차 부팅 CDN 요청 전량 캐시(miss 0) |
| 머신이 탭 밖에서 사나(커널 데몬) | [sharedKernelProbe.html](sharedKernelProbe.html) | 연결 2개(=탭 2개)가 같은 파이썬 상태 공유 + 동시 요청 정합 |
| 헤더 못 다는 호스팅(GH Pages)에서 머신이 뜨나 | [noCoiProbe.html](noCoiProbe.html) | COI=false에서 부팅/세션 부활/.pymachine/디스크 전부 정상(SAB만 경계) |
| SW 헤더 주입으로 SAB를 열 수 있나 | [swCoiProbe.html](swCoiProbe.html) | ?coi=1 등록 + 1회 새로고침 후 crossOriginIsolated=true + SAB 실사용 |
| 브라우저 능력이 파이썬 파일이 되나(Plan 9) | [deviceFsProbe.html](deviceFsProbe.html) | open() 쌍방 브리지 + 동적 읽기 + /proc 커널 상태 + with/부분읽기 정합 |
| 머신이 스스로 일하나(init/cron) | [initProbe.html](initProbe.html) | boot.py 오토스타트 + cron 주기 틱 + /home으로 세대 계승 + 파일 없으면 no-op |
| 체크포인트가 나무가 되나(머신의 git) | [branchProbe.html](branchProbe.html) | 분기 후 임의 노드 스위치가 형제 델타에 오염되지 않음(선형 체인이면 RED) |
| 살아있는 커널을 진짜 fork할 수 있나 | [forkLiveProbe.html](forkLiveProbe.html) | 두 커널의 cp0이 바이트 동일 + 부모 상태(변수·배열·계산)가 자식에서 생존 + 주소공간 독립 |
| 강제종료해도 마지막 커밋으로 부활하나(WAL) | [journalProbe.html](journalProbe.html) | clean save 없이 커널을 버려도 유휴 커밋 + recover()로 부활 + CAS dedupe(승격 계약 재실측 창구) |
| 저널 비용의 정체와 배치 이득은 | [churnProbe.html](churnProbe.html) | no-op 문장의 churn 바닥과 그 고정성 + 배치 시 총 쓰기량 절감률(승격 설계 판정) |

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-11 | crossKernelProbe | Edge headless | A(30MB) 이미지를 새 부팅 B에 전체 되쓰기 + 스택 복원 -> `SystemError: Type does not define the tp_name field` | **벽 좌표**: 커널 상태는 선형 메모리만이 아니다(WASM globals + JS 측 미러가 이미지 밖). 동일 인스턴스 복원(우리 리액티브)은 그래서 되고, 크로스 인스턴스는 전체 머신 상태 캡처가 필요 | 불멸 커널은 (a) 부팅 결정성 실측, (b) 전역/JS 상태 목록화 후 재시도. 프론티어 후보 |
| 2026-07-11 | bootDeterminismProbe | Edge headless | 무조치 2회 부팅 = 180p 상이. **PYTHONHASHSEED=0 + 엔트로피/시간 스텁 = 0p 상이(bare와 numpy 리플레이 모두, 힙 길이 동일)** | 부팅이 바이트 단위 결정적. tp_name 크래시 원인(시드 레이아웃 시프트) 확증 | 리플레이+델타 경로 개방 |
| 2026-07-11 | replayForkProbe | Edge headless | A의 사용자 상태(변수+numpy 배열)를 델타 160p/10MB로 수확, 동형 리플레이 B에 **1.5ms 적용** -> 상태 생존·연산·연속 실행 전부 정확 | **불멸 커널/warm-fork 실증**. hiwire 벽을 upstream 수정 없이 우회 | 졸업 -> `session.js` `bootSession`/`Session.save/load`(게이트 상시: 크로스 커널 부활 95p/5.9MB) |
| 2026-07-12 | sessionGrowProbe | Edge headless | 30->65MB로 자란 세션(42.4MB 저장)을 새 커널이 354ms에 부활. 발견 2건: JS에서 Memory.grow 직접 호출은 글루 클로저 뷰 미갱신으로 파손(파이썬 할당 경로가 정답), 성장 루프의 흔적은 restore(0) 되감기 후 델타 적용으로 해소 | 성장 세션 부활 성립(Session v2) | 졸업 -> session.js(load가 파이썬 성장 + 경계 되감기 + 델타), wheelDir 매니페스트 결합 포함 |
| 2026-07-12 | machineImageProbe | Edge headless | 13.7MB `.pymachine` 단일 파일(내보내기 59ms), trust 없이는 거부, 1바이트 변조 거부(SHA-256), 파일로 부팅 2.5s에 상태 전부 생존 | **파일 하나 = 살아있는 컴퓨터** 성립(신뢰 모델 포함) | 졸업 -> `exportImage`/`openMachine` |
| 2026-07-12 | homeDiskProbe | Edge headless | `/home/web` 마운트: python open/os로 쓴 파일·디렉터리·바이너리가 다른 커널에서 생존. 발견: pyodide 기본 /home 비어있지 않아 기본 경로는 /home/web | 영속 디스크 성립 | 졸업 -> `Runtime.mountHome` |
| 2026-07-12 | offlineBootProbe | Edge headless | 코어 3종(wasm/stdlib/lock) OPFS 캐시, 2차 부팅 hit 3/miss 0(fetch 계층 네트워크 0), 웜 2457ms vs 콜드 4006ms. 한계: pyodide.js/asm.js는 script 경로라 fetch 밖(완전 오프라인은 SW 몫) | boot({coreCacheDir}) 성립 | 졸업 -> runtime.js coreCacheDir 옵션(rt.coreCache 통계). 무한재귀(fetch 재진입) 결함 수정 |
| 2026-07-12 | swOfflineProbe | Edge headless | SW 캐시-우선: 1차 부팅이 CDN 5건 채움(pyodide.js/asm.mjs **script 경로 포함**), 리로드 후 2차 부팅 **CDN miss 0**(hit 3, 잔여 2건은 브라우저 메모리 캐시 = 역시 네트워크 0), 2391ms | 기둥5의 남은 구멍(script 경로) 봉인 = 완전 오프라인 등가 성립 | 졸업 -> `pyprocSw.js`(?cache=1, coreCache와 상보) |
| 2026-07-12 | sharedKernelProbe | Edge headless | SharedWorker(module) 커널 부팅 4253ms, 연결 A의 `x=41`을 연결 B가 `x+1=42`로 조회, 동시 요청 정합. **벽: crossOriginIsolated=false**(플랫폼 제약) = SAB 불가, JSPI는 true | **머신이 탭 밖에서 산다**(여러 탭 = 한 상태). interrupt/스냅샷-fork는 이 커널에서 불가(SAB) | 졸업 -> `SharedKernel`(실행/상태 공유 v1). SAB 기능은 플랫폼 COI 지원 대기 |
| 2026-07-12 | noCoiProbe | Edge headless(헤더 제거 서버) | COI=false/SAB 잠김 확인 후: 부팅 3533ms, 세션 부활 115p/7.2MB, .pymachine 왕복 1804ms, /home 디스크, JSPI=true 전부 정상 | **머신 핵심 동선은 COI 불필요**(SAB 쓰는 프로세스 OS만 경계) = GitHub Pages에 그냥 올려도 대표 데모가 돈다 | GH Pages 데모 배포 채택 근거 |
| 2026-07-12 | swCoiProbe | Edge headless(헤더 제거 서버) | pyprocSw(?coi=1) 등록 + 1회 새로고침 -> crossOriginIsolated=true, SAB 생성 + 워커 Atomics 쓰기 관측, 일반 서빙 무파손 | 헤더 못 다는 호스팅에서도 SAB 복구 성립(opaque는 원본 통과 = CDN 자체 CORP 전제, jsdelivr ok) | 졸업 -> `pyprocSw.js` ?coi=1 + processOs.html 부트스트랩 |
| 2026-07-12 | deviceFsProbe | Edge headless | Emscripten FS 장치 등록: 파이썬 write -> JS 싱크 / JS 소스 -> read, /dev/clock 열 때마다 신선, /proc/meminfo가 실제 힙과 일치, /proc/ps 제공자 배선, read(4)/with문/os.path.exists 정합. 클립보드 쓰기는 headless 권한 거부(정직 기록) | **모든 것은 파일 성립**(새 API 표면 0: open()이 계약). 비동기 소스는 캐시+refresh가 정직한 계약 | 졸업 -> `DeviceFs`(enableDeviceFs: 내장 /proc/meminfo·/dev/clipboard + 소비자 장치) |
| 2026-07-12 | initProbe | Edge headless | 디스크에 심은 boot.py가 다음 부팅에서 자동 실행(4ms, counter 1), cron.py 300ms 틱 1.05s에 3회, 3세대 부팅이 counter=2로 계승, 파일 없으면 no-op | **머신이 스스로 일한다**(rc.local+cron, 전부 파일 주도 = 배선 코드 0) | 졸업 -> `Init`(enableInit) + machine.html 배선 |

| 2026-07-12 | branchProbe | Edge headless | **선형 체인의 실결함 재현**: 분기 노드로 스위치하면 `RuntimeError: memory access out of bounds`(6/7 RED). 원인 = 델타 해석이 배열 역순(k-1)이라 버려진 형제 분기의 페이지를 집는다. **부모 체인 walk로 수정 후 10/10 GREEN**(분기 왕복/형제 가지/삼중 스위치 전부 정확, 판별 검사는 라이브를 base로 고정해 우연 일치를 제거) | **체크포인트 나무 = 머신의 git 성립**. %undo(뒤로만)에서는 무증상이었고 분기를 여는 순간 힙이 깨지는 결함이었다 | 졸업 -> `reactive.js` parents 체인 + `tree()`. 게이트 상시 |
| 2026-07-12 | forkLiveProbe | Edge headless | **관문 1차 RED**: 메인 커널 vs 워커 커널 리플레이는 힙 길이는 같아도 **바이트가 다르다**(로더/컨텍스트 차이 = 벽 좌표). **워커 대 워커는 바이트 동일 -> 8/8 GREEN**: 델타 164p/10.3MB 수확 43.6ms, 적용 1.4ms, 왕복 4ms. 부모의 변수·bytearray·계산 결과가 자식에서 생존, 자식 변이는 부모에 무영향(독립 주소공간), 자식이 부모 상태 위에서 연속 계산 | **살아있는 커널의 진짜 fork(2) 성립**. 스냅샷-fork(bare 이미지 복제)와 다르다: `x = bigDf`가 자식으로 실린다. 단 대칭 컨텍스트(워커끼리)가 전제 | 졸업 -> `PyProc({replay})` + `fork(src, dst)`. 커널을 워커로 옮기는 설계(P3)의 근거 |
| 2026-07-12 | journalProbe(1차, 문장단위) | Edge headless | 문장 경계마다 CAS append + HEAD commit. **clean save 없이 커널을 버려도 부활 5/5 GREEN**. **비용 발견**: 문장당 변경 중앙값 **128p(8MB)**, 문장당 커밋 ~1s | 강제종료 내성 실증. 그러나 **naive 문장단위 WAL은 무겁다** | 개념 졸업, 승격 보류 -> churnProbe로 원인 규명 |
| 2026-07-12 | churnProbe | Edge headless | **churn 바닥의 정체 규명**: no-op 문장(`1`)조차 90~106p(6MB)를 더럽히고, 그 페이지 **집합은 97~98% 고정**이다(CPython eval/GC의 scratch 워킹셋 = 사용자 상태와 무관). gc.freeze도 못 줄인다. 배치의 고유 페이지 절감은 1~5%뿐이지만 **총 쓰기량은 88% 절감**(문장별 765p vs 배치 1회 91p = 8.4배) | **커밋 단위는 문장이 아니라 유휴다**: churn 바닥은 못 줄이므로 **커밋 빈도**가 비용을 지배한다. 문장단위 WAL 기각, 유휴 배치 확정 | P1 승격 설계 확정 |
| 2026-07-12 | journalProbe(승격 계약) | Edge headless | `rt.enableJournal({dir, reactive, idleMs})`: 유휴 판정 후 자동 커밋(139p), **hibernate 없이 커널을 버려도 새 커널이 recover()로 부활**(140p/8.8MB, 2330ms), 저널 없으면 null(첫 부팅), CAS dedupe 동작. 7/7 GREEN | **강제종료 내성이 계약이 됐다**. 커밋은 비동기라 REPL 비차단(커밋 1회 완료 ~2s는 OPFS 파일 생성 비용 - 다음 최적화 후보: blob을 개별 파일 대신 append-only 팩으로) | 졸업 -> `MachineJournal`(enableJournal). 재실측 창구로 유지 |

## 판정

진행 중 (17개 질문 실측 완료: 결정성/리플레이/성장/이미지/디스크/오프라인 2단/공유 커널/호스팅 독립 2단/파일 세계/init/체크포인트 나무/forkLive/**저널 WAL(churn 규명 -> 유휴 커밋으로 승격)**. 잔여: 커널 선출(P2), /home 포함 이미지 v2, 저널 blob 팩 최적화)
