# runtimeParity - 런타임을 로컬 파이썬급으로 (개념 캠페인 하나 = 카테고리 하나)

로컬 parity 발명([mainPlan/local-parity](../../../mainPlan/local-parity/README.md))의 실측 레인. 세부 질문은 **폴더가 아니라 probe 파일로** 늘린다. 이 캠페인이 끝날 때까지 이 폴더 하나에서 운영한다.

## 가설

수명주기(행/죽음 수렴), 복원 soundness, 시스템콜(입력/HTTP/서브프로세스), 터미널까지 갖추면 브라우저 런타임이 로컬 파이썬과 체감 구분이 없어진다. 각 축은 브라우저 실측으로만 판정한다.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 행/죽음에서 유한 수렴 가능한가 | [lifecycleProbe.html](lifecycleProbe.html) | 행 결함 재현 + respawn < 1s + 복구 풀 정상 -> `taskTimeoutMs`/`kill` 승격 |
| 64비트급 해시가 여전히 싼가 | [soundnessProbe.html](soundnessProbe.html) | 이중 해시 비용 <= 단일의 2.2배, 절대치 <= 150ms -> 이중 해시 승격 |
| 시스템콜을 실제로 빌릴 수 있나 | [syscallProbe.html](syscallProbe.html) | 동기 input + urllib 실 GET 필수 PASS -> v1 승격. JSPI/subprocess는 능력 보고 |
| 탭이 진짜 터미널이 되나 | [terminalProbe.html](terminalProbe.html) | REPL 시맨틱 + REPL 안 `input()` 블로킹 재개 -> Terminal 능력 계약으로 승격 |
| 예외로 더러워진 힙을 안전 복원할 수 있나 | [exceptionRestoreProbe.html](exceptionRestoreProbe.html) | 결함 재현 + rehash 복원 정확 -> `restoreLive({rehash})` 승격 (dartlab 흡수) |
| dartlab 스택이 v314에서 도는가 (이관 관문) | [versionParityProbe.html](versionParityProbe.html) | fastapi/pydantic/polars/numpy/requests 설치·import 성공률 보고 |
| FastAPI가 커널 안에서 소켓 0으로 도는가 | [asgiProbe.html](asgiProbe.html) | GET 200 + POST 검증 200/422 -> `AsgiServer` 능력 승격 (dartlab 흡수) |
| 행 워커를 kill 없이 회수할 수 있나 | [interruptProbe.html](interruptProbe.html) | SIGINT 수렴 + 같은 워커 재사용 -> `interrupt(pid)` 승격 |
| 대표 라이브러리가 얼마나 깔리나 | [libCoverageProbe.html](libCoverageProbe.html) | 대표군 설치·import 성공률 실측(성공/실패 분류가 산출물) |
| 기준 힙을 RAM 밖(OPFS)에 둘 수 있나 | [opfsCheckpointProbe.html](opfsCheckpointProbe.html) | 쓰기/읽기 처리량 + 로드본 복원 정확 -> `saveBase`/`loadBase` 승격 |
| 패키지 로드 후 스냅샷 재수확이 되나(warm-fork 우회) | [reharvestProbe.html](reharvestProbe.html) | 되면 warm-fork·환경=이미지 개방, 안 되면 벽 좌표 확정 |
| 파이썬 서버가 진짜 URL로 응답하나(가상 오리진) | [swOriginProbe.html](swOriginProbe.html) | SW 가로채기 -> ASGI 위임 fetch가 GET/POST 정합 + 왕복 < 100ms -> SW 자산 + 배선 승격 |
| requests가 진짜로 도나 | [requestsProbe.html](requestsProbe.html) | pyodide-http patch_all 후 requests.get/헤더/재사용 전부 200 -> syscallBridge 옵션 승격 |

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-11 | lifecycleProbe | Edge headless | 행 시 map 무한 대기 재현. respawn 302ms. 복구 풀 정상 | 타임아웃 + kill/respawn이 수렴 수단 | 졸업 -> `pyProc.js` (`taskTimeoutMs`/`kill`/`_replace`), 게이트 검사 3종 상시화 |
| 2026-07-11 | soundnessProbe | Edge headless | 30MB 힙: 단일 9.3ms vs 이중 14.3ms(1.54x). 1바이트 변경 감지 | 대역폭 지배 가설 입증 | 졸업 -> `memoryCapability.js`+`reactive.js` 이중 해시(~2^-64) |
| 2026-07-11 | syscallProbe(+임시 diag) | Edge headless | v314엔 `callSyncifying` 없음 -> `pyodide.ffi.run_sync`+`can_run_sync()` 확정. 동기 input PASS, urllib 실 GET(200) PASS, JSPI input 동작, subprocess 2007ms | 3종 전부 실동작 | 졸업 -> `syscallBridge.js` v1. 저수준 socket·requests는 이 캠페인 잔여 |
| 2026-07-11 | terminalProbe | Edge headless | 식 평가 4, 다중행+상태 유지 70, REPL 안 input() 블로킹 재개 24ms | 탭 = 터미널 개념 성립 | 졸업 -> `terminal.js` `Terminal`(push 계약) + examples/terminal.html + 게이트 상시화 |
| 2026-07-11 | exceptionRestoreProbe | Edge headless | 예외 후 rehash 없는 restoreLive는 오염 잔존(재현). `{rehash:true}` 복원 17.6ms/162p, 연속 실행 정상 | dartlab의 재해시 해법 유효 | 졸업 -> `reactive.js` `restoreLive(j, sp, {rehash})`, 게이트 상시화 |
| 2026-07-11 | versionParityProbe | Edge headless | v314.0.2에서 fastapi 0.136.1, pydantic 2.12.5, polars 1.33.1, numpy 2.4.3, requests 2.33.1 전부 설치·import ok | **버전 관문 통과. dartlab 스택은 v314에서 돈다** | 이관 시 0.27.5 -> v314 정합 장애물 없음 |
| 2026-07-11 | asgiProbe | Edge headless | fastapi 설치 960ms(v314). dispatch 3.4ms. GET /ping 200, POST pydantic 200/422 | dartlab browser-as-server 핵심을 pyproc 프리미티브로 재현 | 졸업 -> `asgiServer.js` `AsgiServer`(enableAsgiServer), 게이트 상시화. SW 배선은 소비 제품 몫 |

| 2026-07-11 | interruptProbe | Edge headless | setInterruptBuffer(SAB) SIGINT: busy 루프 517ms 수렴(대기 500 포함), respawn 0으로 같은 워커 재사용. 발견: 워커 에러는 꼬리를 남겨야 예외 타입이 살아남는다 | 협조적 취소 성립 | 졸업 -> `pyProc.js` `interrupt(pid)` + worker SIGINT 채널, 게이트 상시화 |

| 2026-07-11 | libCoverageProbe | Edge headless | v314 대표 12종 전부 ok: pandas 3.0.2(5.9s), scipy 1.18, scikit-learn 1.8(6.1s), matplotlib 3.10, pillow, sqlalchemy, bs4, lxml, openpyxl, httpx, jinja2, cryptography. 이전 5종 포함 누적 17/17 | 대표 워크로드 커버리지 100% | 다음: 실패군 탐색(더 넓은 표본) + wheel OPFS 캐시로 재설치 0 |

| 2026-07-11 | opfsCheckpointProbe | Edge headless | 30MB base: OPFS 쓰기 256ms, 읽기 46ms. 로드본 base로 rehash 복원 정확 + 연속 실행 | 기준 힙 영속 성립(dartlab 156MB RAM 부담의 해법 방향) | 졸업 -> `reactive.js` `saveBase`/`loadBase`(핸들은 소비자 제공), 게이트 상시화 |

| 2026-07-11 | reharvestProbe | Edge headless | 런타임 중 loadPackage 후, 부팅 옵션 packages 후 **양 경로 모두** makeMemorySnapshot이 `Unexpected hiwire entry at index 6`으로 거부 | **벽 좌표 확정**: v314 스냅샷은 bare 전용. 패키지 로드 상태(JS FFI 흔적)는 이미지화 불가 | warm-fork·환경=힙이미지는 upstream 프론티어로 격상. 웹의 uv는 wheel OPFS 캐시(다운로드 0) 경로로 진행 |



| 2026-07-11 | wheelCacheProbe | Edge headless | 커널1이 six+micropip wheel을 OPFS에 저장(miss 2), 커널2는 **hit 2 / miss 0**으로 설치 + import 정상. 발견: micropip은 fetch에 URL 객체를 준다(문자열 아님) | 재다운로드 0 성립("웹의 uv" 저장층) | 졸업 -> `wheelCache.js` `enableWheelCache({dir})`(install/loadPackages 스코프 래핑), 게이트 상시 |

| 2026-07-11 | (게이트 직결) %undo | Edge headless | Terminal({timeTravel:true}): 완결 문장마다 자동 경계, `%undo`가 직전 상태 복원(q=999 -> 1), 게이트 23/23 | 시간여행 REPL 성립(로컬 REPL에 없는 능력 2호) | 졸업 -> `terminal.js` timeTravel 옵션 |


| 2026-07-12 | shardMapProbe | Edge headless | 32MB float64 sort+sum: 1워커 570ms vs 4워커 108ms = **5.28배**, 합·sqrt합 정확. 발견 2건: 워커의 loadPackage는 다운로드만이라 부팅 setup 예열 필요, bare 워커엔 numpy 미설치 -> PyProc({packages, setup}) 계약 신설 | numpy 단일스레드 열세를 프로세스 샤딩으로 완화 | 졸업 -> `pyProc.js` `mapArray`(SAB 공유 + 워커 내 1회 복사 numpy화), 게이트 상시 |

| 2026-07-12 | swOriginProbe | Edge headless | SW가 `/pyproc/*` fetch를 가로채 페이지 커널 ASGI로 위임: GET(쿼리 포함)/POST body 왕복 정합, 무관 경로 통과, 평균 **3.4ms/req**(직접 dispatch와 동일 = SW 오버헤드 0) | **가상 오리진 성립**: 파이썬 서버가 진짜 URL이 된다(WebContainers의 localhost 개념을 ASGI 위에) | 졸업 -> `pyprocSw.js`(SW 자산, ?asgi=접두) + `VirtualOrigin`(페이지 배선) |

| 2026-07-12 | requestsProbe | Edge headless | requests+pyodide-http 설치 247ms, patch_all 후 requests.get **15ms**(자기 자신 200), 재사용/커스텀 헤더 정상. 1차 실측 발견: requests는 절대 URL만(상대 경로 MissingSchema) | 파이썬 생태계 표준 HTTP 성립(dartlab 체크리스트의 requests 계열 해소) | 졸업 -> `SyscallBridge({requests:true})` |

## 판정

진행 중 (수명주기·soundness·시스템콜 v1(+requests)·예외 안전 복원·ASGI 서버·가상 오리진 졸업, 버전 관문 통과 / 저수준 socket, 라이브러리 실패군 탐색 잔여)
