# 03. 외부 평가 대응 - 수용/기각/참조 지도

작성: 2026-07-12. 외부 코드 리뷰 2건(정적 분석 + 참조 프로젝트 조사)을 받아 지적을 코드로 갚은 기록.
정확성 라운드 = "기능 추가가 아니라 이미 발명한 기능에 프로토콜·복원·장애 불변조건을 부여"하는 단계.
같은 결론을 이 레포의 심판 3종([02-os-verdict.md](02-os-verdict.md))과 외부 리뷰가 독립적으로 냈다(수렴 = 강한 신호).

## 수용 -> 코드 (전부 실측 GREEN)

| 지적 | 검증 | 조치 | 게이트 |
|---|---|---|---|
| .pymachine SHA-256이 델타만 덮고 헤더(manifest/setup)는 무인증 = 부팅 코드 변조가 통과 | 확정(session.js:118 델타만 해시, 헤더의 manifest로 bootSession) | **포맷 v2**: MAGIC + 봉투해시(u32+헤더+델타 전체) + 입력 검증 상한. v1은 헤더 무인증이라 지원 종료(명시적 거부) | machineImageProbe 8/8: manifest.setup 변조 파일 거부, v1 거부 |
| map()의 taskId가 호출마다 0부터, _call()은 pid로만 응답 매칭 = 동시 호출 시 응답 교차 | 확정 | **reqId RPC**: 전역 고유 요청 id + 워커당 상시 라우터 1개 + pending map. 워커 사망 시 대기 요청 전량 즉시 reject | gate: 동시 map 3건 격리 |
| ASGI가 공용 전역(_pyprocM 등)에 요청을 실어 동시 요청 시 덮임 | 확정(iframe 라우팅으로 실시나리오화) | 요청을 전역이 아니라 **함수 인자**로 넘김(코루틴 지역 = 인터리빙 안전) | gate: 동시 요청 4건 격리 |
| 워커 task 결과 PyProxy를 destroy 안 함 = 장시간 map 누수 | 확정 | 결과를 `toJs({create_pyproxies:false})`로 직렬화 계약 강제 + finally destroy | worker.js |
| 성장 프로세스 live fork 위험: 자식 힙을 안 키우고 뒤쪽 페이지 씀 | 확정 | harvest가 heapLen 전달 + applyDelta가 파이썬 할당으로 자식 힙 성장 후 적용 | forkLiveProbe 10/10: 부모 73MB>자식 30MB fork |
| bootEnv()의 indexURL 유실 | 확정(1줄) | `new Runtime(py, indexURL)` | - |
| recover()가 저널 손상과 첫 부팅을 혼동 | 확정 | 손상/첫부팅 구분 + blob SHA 재검증 + HEAD/PREV 2세대(HEAD 파손 시 후퇴) | journalProbe 11/11 |
| 복제 프로세스들이 같은 random 상태 공유 | 정확(os.urandom은 안전, random 모듈은 시드 복제) | cp0 확정 뒤 재시드(fork는 예외 = 부모 상태 물려받음) | gate: 프로세스별 random 갈림 |
| 전역 monkey patch 경쟁(동시 부팅) | 확정 | ensureEngineScript in-flight 공유 + 결정적 부팅 구간 직렬화(bootChain) | session.js runExclusive |
| recover에 경계 지문 대조 없음 | 이미 라운드 8에서 h0 도입 | 저널 h0 + blob 재검증으로 강화 | journalProbe |

## 기각 또는 보류 (원칙과의 충돌)

- **SQLite WASM으로 저널 메타 관리**: 기각(의존성 0 강행규칙). 단 제안한 구조(objects/manifests/refs + PREV + 원자적 HEAD)는 의존성 없이 OPFS로 차용 = HEAD/PREV 2세대로 구현.
- **지금 WASI/WASIX형 syscall ABI + 권한 매니페스트**: 방향은 P6와 일치하나 단계 오버. P2 이후 순서 유지.
- **"WAL이 아니라 체크포인트 저장소" 개명**: 공개 API 개명 불요(계약 문서가 이미 "경계 일관성"으로 정직). 문서 정밀화로 충분.
- **tsc 게이트**: 의존성 0과 긴장. CI 전용 npx 잡이 절충(후속 후보).
- **비결정 이벤트 로그(rr/Temporal)**: 옳은 장기 방향이나 heap snapshot을 대체하지 않고 보완. 장수 세션 캠페인 후보로 등재.
- **wait/exit/IPC/FD 완성**: P3/P4에 병합(로드맵에 이미 있음).

## 외부 리뷰가 못 본 것 (우리가 이미 가진 것)

- 유휴 커밋의 execSeq 정지 판정은 약한 형태의 정지 장벽(quiescence barrier)이다.
- 다탭 저널 소유권의 구조적 정답은 리뷰의 "Storage Worker"보다 우리 P2(커널 선출 = 쓰기 권한을 한 탭으로)가 근본이다.
- 보석(reactive/session/.pymachine/가상오리진/스케줄링)은 이미 엔진 중립이다([engine-independence](../engine-independence/README.md) 감사).

## 진짜 목표와의 합류: Pyodide 제거

목표는 "Pyodide를 떼고 진짜 파이썬이 굴러갈 수준". 이 정확성 라운드가 곧 그 준비다:
지적의 대부분이 "Pyodide 특이 접점을 좁은 계약 뒤로 모으는" 작업이었다(RPC 프로토콜화, 실행 직렬화, 값 프로토콜화). 수리가 곧 디커플링이다.

조사 결론(전문 에이전트, [engine-independence](../engine-independence/README.md) P1~P4 + D2 관문):
- non-Pyodide CPython wasm은 실재한다. WASI 프리빌트(brettcannon 3.14.6, 받아서 부팅 가능) + browser_wasi_shim(114KB, MIT, vendoring 가능, 의존성 0). emscripten은 자가 빌드(공개 아티팩트 없음).
- **벽**: WASI엔 JS FFI가 없다 = jsProxy/pyProxy급 전역 표면은 원리적으로 불가. 엔진 계약을 "값 프로토콜"(직렬화 get/set)로 낮추는 재설계가 D2의 실제 비용. 스택 save/restore·인터럽트는 emscripten 자가 빌드에만 있음(WASI 프리빌트 미노출).
- **역설적 이점**: WASI의 엔트로피는 `random_get` import 하나로 수렴 = 우리 결정적 부팅이 오히려 더 깨끗해질 수 있다. Pyodide 스냅샷의 hiwire 벽이 upstream엔 없다.
- **결론**: "삭제"가 아니라 "기본 엔진 옵션으로 강등". 그 인프라가 P1 EngineContract seam이다.
