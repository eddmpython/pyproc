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

## 판정

진행 중 (11개 질문 실측 완료: 결정성/리플레이/성장/이미지/디스크/오프라인 2단/공유 커널/호스팅 독립 2단. 잔여: /home 포함 이미지 v2, 델타 분기, SharedKernel과 머신 수명주기 결합)
