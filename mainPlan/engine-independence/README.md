# engine-independence - 엔진 독립: Pyodide 없이도 살 수 있는 pyproc

상태: PRD (2026-07-12, 전문 에이전트 2종 연구 종합: 생태계 리서치 + 코드 결합 감사). **착수 결정 대기.**

## 질문과 답

출발 질문: "Pyodide 의존성을 제거하고 독립적으로, 지금 모든 게 가능한 방법 - 아니면 더 훌륭한 방법은?"

답: **완전 제거는 지금 하면 손해다**(수개월 재작성 + 생태계 상실, 아래 근거). 더 훌륭한 방법이 실재한다:
의존을 4개 층으로 분해하면 층마다 오늘 놓을 수 있는 독립 장치가 있고, 그 사다리를 다 놓으면
"Pyodide가 내일 방향을 틀어도 pyproc은 안 죽는" 상태가 된다. 떠나는 게 아니라 **갇히지 않게 만드는 것**이 정답.

| 의존 층 | 독립 장치 | 비용 |
|---|---|---|
| 유통 (CDN에서 자산 로드) | P0 자가 호스팅(핀 자산 셀프 서빙) | 일 단위 |
| 코드 (엔진 API 산재) | P1 EngineContract seam(어댑터 1파일로 격리) | 주 단위 |
| 기능 (스냅샷 벽 #5195) | P2 스냅샷 사전 제조 probe + P3 업스트림 워치/기여 | 주 단위 |
| 미래 (엔진 교체 옵션) | P4 fork 보험(MPL, 조건부) + PyEmscripten ABI 탈출구 | 발동 시에만 |

## 왜 "완전 제거"가 오늘 손해인가 (증거)

1. **재구현 대상이 인터프리터가 아니라 글루다.** Pyodide의 CPython 패치는 9개 파일 수준(PEP 776 업스트리밍의 결과). 떠난다는 것은 FFI(JsProxy/PyProxy/run_sync) + 로더/dylink + micropip/lock + 스냅샷 기계를 재작성한다는 뜻 = 사실상 pyodide core 재작성(수개월), 얻는 것은 거의 없음.
2. **생태계가 우리에게 유리한 방향으로 표준화 중.** CPython 3.14가 Emscripten을 Tier 3로 공식 복귀시켰고(PEP 776, Active), **PEP 783이 Accepted(2026-04-06)**: C 확장 휠이 `pyemscripten_2026_0_wasm32` 태그로 PyPI에 정식 업로드된다. 이 플랫폼 정의는 "Python/Pyodide에 관한 내용이 없다"고 명시 = **미래에 독자 런타임을 만들어도 휠 자산이 이식된다. 지금 안 떠나도 갇히지 않는 근거.** cibuildwheel 4.0이 이미 이 ABI를 빌드한다.
3. **대안 엔진은 오늘 우리 요구와 양립 불가.** WASI 레인은 동적 C 확장이 막혀 있고(cpython#142234 open, component-model#401 open) PEP 816이 WASI 0.2를 건너뛰겠다고 자인 = numpy/pandas 상실. MicroPython-wasm은 진짜지만(303KB, 수 ms 부팅, 공식 npm) CPython 휠 생태계가 없어 **대체가 아니라 보조 프로세스 레인** 재료. RustPython 미성숙.
4. **fork는 공짜 보험이라 선제 불필요.** Pyodide는 MPL-2.0(파일 단위 copyleft, fork 법적 장벽 낮음), 유일한 대규모 fork(Cloudflare)가 스냅샷 제조 코드까지 전부 공개(cloudflare/pyodide + workerd/src/pyodide/make_snapshots.py). 필요해지는 순간 며칠 안에 열 수 있다.
5. **유일하게 "오늘 우리 통제 밖에서 깨질 수 있는" 지점은 CDN이다.** 코드/버전은 핀으로 고정했지만 jsdelivr 가용성·정책은 우리 밖. 이게 P0가 1순위인 이유다.

## 옵션 매트릭스 (기각 근거 보존)

| 옵션 | 유지 | 상실/부담 | 비용 | 판정 |
|---|---|---|---|---|
| 1. 현행(스톡 + 핀) | 전부 | CDN 리스크, 스냅샷 벽 업스트림 종속 | 0 | P0 전까지의 기본값 |
| 2. 자가 호스팅 | 전부 | 자산 서빙만 추가 | 일 | **P0 채택** |
| 3. fork + 패치 (Cloudflare 모델) | 전부 + 스냅샷 벽 자체 해결 | 리베이스 유지비 영구(연 1회 ABI break) | 초기 주, 유지 월 누적 | **P4 조건부 보험** |
| 4. 독자 CPython-Emscripten 빌드(ABI 호환) | 휠은 ABI 정합 시 유지(사양 보장) | FFI/로더/micropip/스냅샷 전부 재구현 | 수개월+ | 기각(지금은). ABI 탈출구가 미래 옵션을 보존 |
| 5. WASI 레인 | 표준 정렬, 샌드박스 | **동적 C 확장 불가 = 수치 스택 상실** | 수개월 + 능력 후퇴 | 기각(WASI 0.3 + dlopen 해결 시 재평가) |
| 6. MicroPython 보조 엔진 | 초경량 프로세스 레인 추가 | 대체 불가(병행만) | 주 | 별도 캠페인 후보(승인 시) |

## 코드 결합 감사 요약 (전수 정독 결과)

- 엔진 API를 실제로 만지는 파일은 15개 중 **8개, 약 40지점**. 절반은 이동 가능한 부팅/배포 코드.
- 진짜 모트 3덩어리: (1) JsProxy/run_sync FFI (2) micropip/lock/휠 생태 (3) 엔진 스냅샷 API.
- **보석은 이미 엔진 중립**: reactive(엔진 접점 0), session/.pymachine, SW 가상 오리진, PyProc 스케줄링, SharedKernel 클라이언트 - 전부 "선형 메모리 + 스택 포인터 + 결정적 부팅 + 엔진 스냅샷" 4개 프리미티브 위의 순수 알고리즘. 엔진이 바뀌어도 살아남는 자산이 pyproc의 가치라는 뜻.
- 위험 상위 5와 조치: ① `_module` 내부 3경로(memoryCapability) -> P1 seam으로 한 곳에 격리 ② 스냅샷 언더스코어 3종 -> 계약 실태 표 기존 행 + P2/P3 ③ 세션 리플레이 결정성 무대조 -> **해소(2026-07-12, cp0 다이제스트 h0 대조)** ④ interrupt 무증상 no-op -> **해소(2026-07-12, interrupts 플래그 소비)** ⑤ 암묵 FFI 변환(`toJs` 덕타이핑 3개소)·"엔진이 전역 fetch를 쓴다" 가정 -> 계약 실태 표 신규 행.
- 감사가 적발한 실결함: subprocess 자식 워커에 indexURL 미전달(자가호스팅 배포에서 자식만 CDN으로 새는 버그) -> **해소(2026-07-12, `Runtime.indexURL` 계약)**.

## 단계 (사다리, 각 단계에 게이트)

- **P0 유통 독립 - 자가 호스팅** (일 단위): GitHub Releases의 v314.0.2 전체 배포판을 자가 서빙 경로로 옮기고 `boot({indexURL})`로 소비. 게이트: 자가 경로에서 브라우저 게이트 전 검사 GREEN + offlineBoot/swOffline probe 재실측 + docs/consuming 갱신. (자식 워커 CDN 누수는 이미 수정됨.)
- ~~**P1 코드 독립 - EngineContract seam**~~ **완료(2026-07-12)**: [engineContract 캠페인](../../tests/attempts/engineContract/README.md) contractProbe 8/8(reactive 시간여행이 계약 표면만으로, 엔진 내부 직접 접근 0)로 개념 확립 후 승격. `src/runtime/engines/pyodideEngine.js`(EngineContract Pyodide 구현) + MemoryCapability/Runtime이 계약 경유. **동작 무변경 실증**: 구조 298 + 브라우저 38 + 예제 4 GREEN. 엔진 접점이 8파일 40지점 -> 1파일로 격리. 발견: execSeq(실행 경계)도 계약의 일부(우회 실행은 복원을 깬다). WASI 매핑 표로 non-Pyodide 구현 경로 확정(값 다리 = 값 프로토콜 강등, 스택 = null 허용). 잔여: worker.js/pyProc의 프로세스 부팅 경로는 자체 엔진이라 이번 seam 밖(후속 정합).
- **P2 기능 독립 - 스냅샷 사전 제조 probe** (attempts, envManager 캠페인 질문으로): Cloudflare workerd의 make_snapshots.py 패턴(패키지 사전 주입 후 스냅샷)을 스톡 v314에서 재현 가능한지 실측. 벽 원인은 스냅샷 직렬화기의 기대 hiwire 엔트리 고정(7개)이므로, 업스트림 PR #5971(Load packages without using Python)이 여는 경로를 관찰하며 병행.
- **P3 업스트림 워치/기여**: #5195(벽 본체), #5971(공식 해결 트랙), 스냅샷 안정화 언질(유지보수자, 2025-12-25). fork보다 싼 길 = 이 트랙의 테스트/리뷰 기여로 착지를 앞당기기.
- **P4 조건부 fork (보험)**: 발동 조건 = "스냅샷-with-packages가 제품 차단 요인 + 업스트림 착지 부재"가 둘 다 참일 때만. cloudflare/pyodide(MPL) 패치 차용, **패키지 CI는 인수하지 않는다**(레시피 수백 개가 진짜 유지비. 공식 배포판 자산 재사용).
- 병행 후보(별도 승인): MicroPython-wasm 경량 프로세스 레인(303KB/수 ms 부팅 = 다른 계급의 프로세스). attempts 신규 캠페인로만 개시.

## 연구가 공짜로 준 부수 발견 (즉시 반영/주의)

- 314.0.0에서 `pyodide.asm.js` -> `pyodide.asm.mjs` 개명 + classic worker 지원 중단: pyproc은 module worker + `pyodide.mjs` 경로라 정합(문제 없음). 코어 캐시 MIME은 .js/.mjs 둘 다 이미 커버.
- ssl 모듈 stub화 + OpenSSL 유래 hashlib 제거(314.0.0): 라이브러리 커버리지 17/17은 v314에서 실측된 수치라 유효. ssl 직접 의존 패키지를 커버리지에 편입할 때 주의.
- JSPI가 Chrome 137에 기본 출시 + 표준화 완료: Chromium 전용 전제가 더 단단해짐.
- 업스트림이 pthreads 빌드 실험 중(PR #6285, opt-in): 우리 "워커 N개 = GIL N개" 모델과 별개의 미래 병렬 축. 관찰만.

## 근거 링크 (핵심만)

- PEP 776(Emscripten Tier 3) / PEP 783(pyemscripten 휠, Accepted) / PEP 816(WASI 0.3 대기) / PEP 11(티어 표): peps.python.org
- CPython `Platforms/emscripten`(빌드 가능 + JSPI REPL 예제): github.com/python/cpython
- 스냅샷 벽: pyodide#5195(open) / 해결 트랙 pyodide#5971(open) / 직렬화기의 기대 엔트리 7개 고정(src/js/snapshot.ts)
- Cloudflare 실증: cloudflare/pyodide(fork) + workerd/src/pyodide(make_snapshots.py 등, 전부 공개) + 공식 블로그(패키지 포함 스냅샷, cold start ~1s)
- pyodide-build 단독 사용 가능(xbuildenv 지정): github.com/pyodide/pyodide-build
- MicroPython-wasm 공식 npm: @micropython/micropython-webassembly-pyscript

## 착수 전 재검 (mainPlan 규칙)

- 정합성: P0/P1은 기존 계약(indexURL, 공개 표면) 안에서 움직여 소비자 무영향. P1은 공개 표면 불변이 게이트.
- ROI: P0(일 단위)가 유일한 실시간 리스크(CDN)를 제거하므로 최우선. P1은 이후 모든 엔진 실험의 고정비를 1파일로 낮추는 투자.
- 롤백: P0는 indexURL 되돌리면 끝. P1은 어댑터 도입 커밋 단위 revert 가능(동작 무변경 게이트가 보증).
