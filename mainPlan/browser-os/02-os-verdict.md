# 02. 객관 판정 - 정말 OS인가, 그 위에서 서버와 웹을 개발할 수 있는가

작성: 2026-07-12. 근거: 독립 심판 3종 토론(OS 아키텍처 점수표 / 개발 플랫폼 실현성 / 적대적 반박) + 같은 날의 수리·실측.
판정 대상 질문 2개: ① "웹 OS" 간판이 객관적으로 정당한가 ② 이 OS 위에서 서버와 웹 앱을 실제로 개발할 수 있는가.

## 한 줄 판정

- **OS 간판: 조건부(49/100).** 무수식 "웹 OS"는 아직 과장이다. 오늘의 정확한 좌표는 "가장 OS에 가까운 브라우저 파이썬 런타임"이고, 간판 조건은 P4(파이프) / P2(커널 탭독립) / P6(집행되는 보호) 셋이다. 전부 기존 로드맵에 있다.
- **셀프호스팅: 성립(실측).** FastAPI + sqlite + HTML 풀스택 서비스를 브라우저 탭 안에서 개발-구동-영속-재부팅생존-핫리로드까지 완주했다([selfHost/fullStackProbe](../../tests/attempts/selfHost/fullStackProbe.html) 8/8). 서빙된 웹앱이 커널 페이지 밖 문서(iframe)에서도 20ms에 산다([runtimeParity/originFidelityProbe](../../tests/attempts/runtimeParity/originFidelityProbe.html) 7/7). "OS에서 서버도 웹도 개발 가능한가"의 답은 **가능하다, 실측으로**.

## 심판 A: OS 점수표 (교과서 10축, 리눅스급 = 10)

| 축 | 점수 | 한 줄 근거 |
|---|---|---|
| 프로세스 관리 | 6 | pid 표 + 스냅샷 spawn + kill/시그널 4종 + forkLive. exec/wait/프로세스그룹 없음 |
| 메모리 관리 | 4 | 체크포인트 나무는 정교하나 상태 스냅샷이지 가상메모리/보호/쿼터가 아님 |
| 파일시스템 | 5 | /home OPFS + /dev,/proc 실동작. 마운트 테이블/권한/파일락 없음, 루트 휘발 |
| IPC | 3 | 시그널 + 배치 map + SAB 읽기 공유뿐. 파이프/블로킹 read/락 전무(P4) |
| 스케줄링 | 3 | 동적 태스크 큐 + 타임아웃 수렴뿐. 선점/우선순위 없음(선점은 안티 추천으로 기각) |
| 보호·격리 | 5 | 주소공간 격리는 강하나 플랫폼 상속분. 고유분은 SHA-256 + trust 게이트뿐(P6 전) |
| 네트워크 | 4 | 아웃바운드 requests + 인바운드 가상 오리진. 진짜 socket listen 없음 |
| 부팅·초기화 | 7 | 3레인(콜드/스냅샷/bare) + 리플레이 + 오프라인 + lock 재현 + init/cron |
| 영속·크래시 내성 | 7 | WAL 유휴 커밋 + recover 부활 + .pymachine. 힙 한정, 커밋 ~2s |
| 개발자 표면 | 5 | REPL + %pip/%undo + 데모 4종. 잡컨트롤/자동완성 부재 |

**과장 적발 5건과 조치**: ① fork의 더러운 dst 오염 무가드(실결함) -> **당일 수리**(아래) ② parentPid 항상 0(장식) -> **당일 수리** ③ 5.28배는 병렬 효율이 아니라 샤딩 배속(조각 정렬 != 전역 정렬) -> **랜딩 표기 정직화**("sharded sort vs one pass") ④ .pymachine은 RAM만(디스크 미포함) -> /home 포함 이미지 v2 큐 유지 ⑤ 시그널 4칸 단일 슬롯(큐잉 없음, 커널->자식 단방향) -> 좌표로 기록.

## 심판 B: 개발 플랫폼 실현성

- **성립 스택(실측)**: FastAPI(pydantic-core 프리빌트, 422 검증 실동작) / starlette / Jinja2 / sqlite3(stdlib, fullStackProbe로 첫 실측) / microdot. **불가**: aiosqlite·StaticFiles·sync def 라우트 등 스레드풀 계열 전부(Pyodide 스레드 생성 불가). Flask는 WSGI라 직결 불가, 인라인 어댑터 ~40줄 거리.
- **막고 있던 배선 4구멍 -> 당일 전부 승격**: 요청 헤더 미전달 / 바이너리 바디 미지원 / 커널 클라이언트 라우팅 부재(서빙된 문서의 fetch가 영원히 매달림) / 무응답 무한 대기. 수리 후 originFidelityProbe 7/7: Authorization 도달, PNG와 0x00-0xFF 512B 무손상 왕복, 204/404 정합, iframe 동선 20ms, 커널 부재 시 10s 후 504.
- **정직한 벽(코드가 아니라 스코프 선언)**: SW 합성 응답의 Set-Cookie 스트립(쿠키 세션 불가 = 토큰 방식), WebSocket 미가로채기, 스트리밍/SSE 미지원(축적 후 일괄), async-only 규율. 소비 계약 문서에 명시할 것.
- **부활-후-fd 무효**: 저널/세션 부활은 힙만 복원하므로 DB 커넥션 등 파일 핸들은 부활 후 재개설이 계약(boot.py 훅 자리 있음).

## 심판 C: 적대적 반박 (최강 반론 10, 요약)

| 반론 | 치명도 | 해소 |
|---|---|---|
| 하드웨어를 중재하지 않으면 OS가 아니다(전부 브라우저/Pyodide 위임) | 간판 붕괴 | 영구 벽. 고칠 것은 코드가 아니라 문장 |
| "로컬급"은 수십 MB 힙 구간의 외삽(모든 프리미티브가 O(힙), 대형 힙 실측 0) | 간판 붕괴급 | 부분 가능: 팩/prune/증분 해시 + 500MB+ 실측 공표 |
| Chromium 전용은 웹이 아니다(iOS 0대, COOP/COEP가 임베딩 생태 파괴) | 강한 할인 | 부분: 능력 계층화(noCoi 실측). Safari/iOS는 통제 밖 |
| 임의 C 확장 불가는 생태계 절반(버전 고정도 Pyodide 세계의 락) | 강한 할인 | 절반은 PEP 783(수년, 통제 밖), 절반(GPU/네이티브) 영구 벽 |
| 탭이 곧 전원(백그라운드 크론 스로틀, persist() 미호출 = 디스크가 캐시) | 강한 할인 | persist는 **당일 수리**. 백그라운드 상주는 벽, P2가 완화 |
| WebVM이 진짜 리눅스+pip을 돌린다("OS" 명칭 경쟁 패배) | 할인 | 차별 실체는 속도·병렬·상태 프리미티브·임베드. 정면 벤치 1장 필요 |
| JupyterLite/marimo가 이미 함(고유분은 비가시 층) | 할인 | 고유 프리미티브로만 가능한 제품 경험의 실증(codaro) |
| 시장: 브라우저 OS는 20년째 기각된 명제(외부 소비자 0) | 할인 | 외부 실사용 1곳 또는 간판을 인프라로 좁히기 |
| 보안이 불리언 하나(서명 없음, SRI 없음, recover h0 무대조, 힙 평문 비밀) | 할인 | h0 대조 **당일 수리**. SRI/서명/스크럽 큐 등재 |
| 생후 하루·개발 1인·밑줄 API 결정성(엔진 업그레이드 = 저장물 전멸) | 할인 | EngineContract seam + 포맷 버전/마이그레이터 큐 등재 |

**반박을 다 인정한 뒤에도 살아남는 간판 1줄**: "브라우저 탭의 파이썬에 진짜 멀티코어 병렬, 문장 단위 시간여행, 크래시를 견디는 세션, 파일 하나로 옮기는 머신 이미지를 더하는 런타임 계층 (Chromium)." 영문: *"A runtime layer that gives browser Python real multicore parallelism, per-statement time travel, crash-surviving sessions, and single-file machine images (Chromium)."*

## 판정이 코드가 된 것 (당일 수리·실측 전부 GREEN)

| 발견(심판) | 조치 | 실측 |
|---|---|---|
| 배선 4구멍(B) | asgiServer(headers/bodyBytes/b64) + pyprocSw(커널 등록부/타임아웃/COI 헤더) + virtualOrigin(hello) | originFidelityProbe 7/7, iframe 20ms, swOrigin 회귀 5/5(3.1ms) |
| fork 더러운 dst 오염(A) | worker 자식측이 델타 밖 드리프트를 cp0으로 복원 + parentPid 계보 | 게이트 35/35, 정화 2p 실증, 적용 1.4->33ms(정확성의 값) |
| recover 조용한 오염(C) | HEAD에 경계 지문(h0) 기록 + 부활 시 대조, 불일치는 명시적 예외 | journalProbe 8/8(오염 HEAD -> 예외 발화) |
| 디스크가 캐시(C) | journal.start()가 storage.persist() 요청 | 코드 반영(거부돼도 동작 지속) |
| 5.28배 표기(A) | 랜딩을 "sharded numpy sort vs one pass"로 정직화 | examples/index.html |
| 셀프호스팅 미증명(B) | selfHost 캠페인 신설 + 풀스택 완주 | fullStackProbe 8/8(설치 916ms, p50 2.1ms, 재부팅->재서빙 3.4s, dev loop 7ms) |

발견 2건도 기록한다: `setGlobal(null)`은 None이 아니라 JsNull 프록시(널 정규화는 JS 경계에서), SW 합성 응답에 COI 헤더가 없으면 부모의 COEP가 iframe을 차단(가상 오리진 응답은 COI 헤더 기본 탑재).

## 다음 지렛대 (우선순위)

1. **간판 조건 3종**: P2 커널 선출(탭 독립 + fork 비대칭 해소) > P4 파이프(IPC 마지막 조각) > P6 감옥. [01-os-primitives.md](01-os-primitives.md)가 정본.
2. **성능 봉투 공표**: 500MB~2GB 힙 구간의 체크포인트/저널/fork 비용 실측이 없다. "로컬급" 주장 전에 이 캠페인이 먼저다.
3. **신뢰 체인**: 부트 스크립트 SRI 핀, .pymachine 서명(WebCrypto), 저장물 포맷 버전 태그 + 엔진 업그레이드 마이그레이터, 힙 평문 비밀 경고 문서화.
4. **정면 벤치 1장**: 같은 numpy/pandas 워크로드로 WebVM 대비(속도·무게·병렬).
5. 소비 계약 문서에 가상 오리진 벽(쿠키/WS/스트리밍, async-only) 명시.
