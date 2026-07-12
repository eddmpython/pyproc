# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션을 재개할 때 여기부터 읽는다.

## 결정 원장 (최신이 위)

### 2026-07-12 소비자 실태 조사 + 채택 표면 - dartlab 라이브 소비자 발견 + 회귀 복원 (구조 330 + 게이트 39/39)

- 형제 레포(dartlab/xlpod) 실태를 전문 에이전트 2종으로 조사. **가장 중요한 발견: dartlab은 이미 라이브 소비자다**(문서엔 "미착수"로 낡아 있었다). 노트북 워커가 자체 부팅 Pyodide를 `new Runtime(py)`로 채택하고 `enableAsgiServer`를 기본 ASGI 커널로 프로덕션 배포(browser-as-server /pyapi, `USE_PYPROC_ASGI=true`). SHA 핀 + 주간 핀 범프 워크플로 운영.
- **회귀 발견·복원(급소)**: EngineContract seam이 `Runtime(engine)`으로 바꿔 dartlab의 `new Runtime(py)` 채택 경로를 깰 뻔했다(py엔 runSync 없음 -> engine.runSync 호출 실패). constructor가 runSync 유무로 판별해 Pyodide 인스턴스면 PyodideEngine으로 감싸도록 복원(하위 호환). 게이트에 채택 경로 상시 가드 + consumerAdoptProbe 5/5. **소비자 파손을 막았다.**
- **xlpod 하드 블로커 해소**: xlpod(브라우저 스프레드시트, =PYUDF 셀 안 파이썬 동기 호출)의 유일한 이관 블로커였던 `setInterruptBuffer`가 엔진 어댑터엔 있으나 Runtime 공개 표면에 없어 raw 탈출구로만 도달했다. `Runtime.setInterruptBuffer` 공개 승격 + `getGlobal`의 PyProxy 반환 계약(call/toJs/destroy 재사용) 명문화.
- **소비 방안 반영**: docs/consuming/contract.md 소비자 표 갱신(dartlab 라이브 / codaro / xlpod 준비 중) + "자체 부팅 Pyodide 채택" 절(new Runtime(py) + setInterruptBuffer + getGlobal PyProxy 패턴). 랜딩(examples/index.html) "Used by real products" 카드(dartlab/xlpod) + README 2종 "누가 쓰나" 섹션. 메모리 갱신(dartlab=라이브).
- **똑똑하게 쓸 여지**(조사가 특정, 후속 후보): dartlab scan 병렬화(PyProc.map, P4 crossOriginIsolated 전제), 두 Pyodide 경로 통합+웜부팅(bootEnv/WheelCache), browser-as-server 배선 흡수(VirtualOrigin), OPFS 시간여행 UI(ReactiveController saveBase). xlpod: syncUdfBridge 능력 승격(로드맵 #4, SAB 왕복 흡수). 남은 마찰: 서브패스 타입 동봉, boot({loadPyodide}) 워커 옵션, 명명/분기 체크포인트, github npm ci 워크어라운드 문서화.

### 2026-07-12 WASI 세션 src 승격 - bootWasi/WasiSession 공개 표면 (구조 328 + WASI 게이트 6/6)

- enginePort 캠페인(완전 시간여행 12/12)을 src 본진으로 승격. 전문 에이전트 아키텍처 설계로 결정: **Runtime에 끼우는 boot({engine})이 아니라 별도 async 표면 bootWasi -> WasiSession**. 근거: Pyodide는 메인 스레드 동기(Runtime.run)지만 WASI는 워커 안 비동기(메인 Atomics.wait 불법)라 동기 계약을 못 지킨다. 별도 표면이면 소비자 4표면(boot/Runtime/PyProc/ReactiveController)을 하나도 안 건드린다(codaro SHA 핀 무영향, 전부 additive).
- **배치**: `src/runtime/engines/wasi/`(자기완결 서브트리) - wasiSession.js(facade + 워커 spawner + 직렬화 큐), wasiWorker.js(shim 부팅 + SabStdin + 경계 체크포인트), wasiReplDriver.js(파이썬 드라이버를 .js 문자열로 = naming 가드 사각 회피), wasiProtocol.js(와이어 상수 한 곳 = 하드코딩 금지), browserWasiShim.js(vendored @bjorn3 0.4.2, LICENSE.browserWasiShim 고지 후 커밋).
- **공개 표면**: index.js/index.d.ts에 bootWasi + WasiSession(async run/get/set/checkpoint/timeTravel) additive. run.mjs 표면·타입 리스트 + README 2종 표에 추가. 값 다리는 JSON 직렬화 한정(FFI 없음) 명시.
- **자산 정책**: wasm은 wasmURL 소비자 제공(indexURL 패턴, 기본 WLR 3.12 핀). 레포 자산 0. shim만 커밋(라이선스 고지). 게이트는 SKIP-on-absent(CI 자산 없어 SKIP green, 로컬/자산 환경 GREEN).
- **실배선 게이트**(tests/browser/wasiGate.html) GREEN 6/6: bootWasi 부팅 122ms, 반복 실행 상태 유지, 값 다리 get/set, 완전 시간여행(checkpoint -> 변이 -> timeTravel -> 복원 후 재개 100/False -> 분기 999), 파이썬 예외 전달. CI 편입(ci.yml, SKIP green). 구조 게이트 328.
- 함정 8개 전부 회피(sync/async category error / reactive 재사용 착각 / shim gitignore 파손 / 라이선스 누락 / 30MB 커밋 / 자산 없이 게이트 / camelCase 사각 / 매직 상수). 잔여(v2): reactive 페이지-델타 트리의 워커-내 재사용(현 v1은 전체-힙 스냅샷 = proven).
- **의미**: "Pyodide를 뗀다"가 실증(enginePort)을 넘어 **제품 표면**이 됐다. Pyodide는 이제 삭제 대상이 아니라 기본 엔진이고, WASI는 소비 가능한 opt-in 세션이다. 엔진 무관성이 계약으로 노출됐다.

### 2026-07-12 완전 시간여행 벽 돌파 - non-Pyodide WASI에서 reactive 완전 성립 (enginePort 12/12)

- 앞 실측이 "완전 상태복귀는 값 채널 무상태화가 전제인 다음 관문"으로 정직하게 미뤄뒀던 벽을, 같은 날 실제로 뚫었다. **엔진 무관 완전 시간여행이 non-Pyodide CPython(WASI)에서 성립**.
- **진단**: 힙 복원 후 파이썬 재개 시 명령이 3바이트 밀렸다(base64 69=4n+1). 워커는 정확한 바이트를 보냈으니(head 정상), 원인은 복원이 파이썬 stdin 입력 스트림 상태(os.read 누적)를 되돌려 스트림이 어긋난 것. 근본 = WASI FFI 부재(Pyodide는 FFI로 코드를 힙에 직접 주입 = 입력 스트림 없음, WASI는 stdin 경유 = 입력 상태가 힙에 결합).
- **해결(값 채널 무상태화)**: 코드는 preopen 파일 `/cmd`(힙 밖 = 복원 무관, 호출자가 매 실행 갱신), stdin은 실행 신호 1바이트(무상태 = 복원 시점에 어긋날 상태가 없음). 이로써 복원 후 파이썬이 **정확히 체크포인트 상태(v=100, log 1, big 없음)로 재개**하고, 거기서 분기(v=999)까지. GREEN 12/12.
- **의미**: pyproc의 리액티브/세션/.pymachine의 완전한 능력(체크포인트 + 복원 + 재개 + 분기)이 Pyodide `_module.HEAPU8`/FFI 없이 exports.memory 위에서 실증됐다. "Pyodide를 뗀다"가 부팅/결정성/반복실행/값프로토콜에 이어 **핵심 프리미티브까지 완전 실측**. 앞서 "혁신이 되려면 아무도 못 넘은 벽을 넘어야"라던 그 벽 하나를 실제로 넘었다.
- 돌파한 벽 4(compile 스택/argv UTF-8/Fd 초기화/완전 상태복귀). 남은 진짜 벽: 스택 sp 미노출(경계-대-경계 복원은 성립하므로 실용 영향 없음), 네이티브 확장(PEP 783). 승격 = EngineContract에 WasiEngine + boot({engine}) 옵션(코드/신호 분리 프로토콜 포함).

### 2026-07-12 non-Pyodide 위 pyproc 프리미티브 실증 - 반복 실행/값 프로토콜/힙 시간여행 (enginePort 10/10)

- D2 관문(부팅+결정성)에 이어 pyproc의 실제 프리미티브가 non-Pyodide CPython(WASI) 위에서 도는지 실측. GREEN 10/10.
- **반복 실행 + 값 프로토콜**: 인터프리터를 세워두고 코드 조각을 N회 실행(상태 유지 x=41->+1->42), FFI 없는 값 다리(get=json.dumps, set=json.loads), 예외 생존, 결정적 부팅+반복 실행(두 커널 random 스트림 바이트 동일). 파이썬 엔진 드라이버는 pyproc이 정본 소유(wasiReplDriver.py, SSOT). 외부 CPython 바이너리는 참조만.
- **엔진 선형 메모리 위 힙 시간여행**: 경계(fd_read = 파이썬이 다음 입력 대기, 스택 항상 동일 깊이)에서 힙 체크포인트(10MB 스냅샷) -> 변이 -> 복원이 변이된 2페이지를 경계 스냅샷 바이트로 되돌림. **pyproc의 리액티브/세션/.pymachine 전제(페이지 스냅샷/복원)가 Pyodide `_module.HEAPU8` 없이 exports.memory 위에서 성립**. Pyodide의 "실행 경계 스택 휴지" 가정을 WASI의 fd_read 경계로 옮긴 것.
- **돌파한 벽 3(실측 특정)**: ① 반복 루프 프레임 위 명시적 compile()이 wasm C 스택 초과 -> exec(str) 직접 ② argv에 UTF-8 멀티바이트(한글 주석) -> args 처리 크래시 -> 드라이버를 preopen 파일로 실행 ③ Fd 부분 구현 stdin 초기화 크래시 -> OpenFile 상속 + fd_fdstat_get.
- **정직한 잔여 벽**: 복원 후 파이썬 재개 자체는 성립(unbuffered os.read 드라이버로 wasm 크래시 0, 인터프리터 살아있음). 완전 상태복귀는 stdin 입력 스트림의 1바이트 재동기화가 남는다(복원이 CPython os.read 내부 상태와 미세 어긋남). 근본 원인은 WASI FFI 부재: Pyodide는 FFI로 코드를 힙에 직접 주입해 입력 스트림이 없지만 WASI는 stdin 경유라 입력 상태가 힙에 결합된다 = 완전 해결은 값 채널 무상태화 프로토콜이 전제. 스택 sp 미노출(경계-대-경계 복원은 성립), 네이티브 확장(PEP 783)도 벽.
- **의미**: EngineContract(계약만으로 프리미티브가 돈다) + enginePort(그 프리미티브가 non-Pyodide 위에서 실제로 돈다)로 "Pyodide를 뗀다"의 개념+프리미티브 실증이 닫혔다. 승격 경로 = EngineContract에 WasiEngine 구현 -> `boot({engine})` 옵션화. 그 전 실측: 값 채널 분리(복원 후 재개).

### 2026-07-12 D2 관문 - "Pyodide를 뗀다"가 실측이 됐다 (enginePort 부팅 6/6)

- 목표의 심장("Pyodide를 떼고 진짜 파이썬이 굴러갈 수준")을 실측으로 관통했다. [enginePort 캠페인](../../tests/attempts/enginePort/README.md): non-Pyodide CPython 3.12(VMware WLR, WASI 빌드)을 vendored browser_wasi_shim(의존성 0, MIT)으로 우리 워커에서 부팅.
- **GREEN 6/6**: ① 부팅 + print(1+1)="2" **253ms**(Pyodide 콜드 ~3s보다 빠르다) ② 계약 코어 = exports.memory(heapU8 등가) 접근 성립 ③ 표준 라이브러리(json/sys) 동작 ④ **결정적 부팅** = random_get + clock_time_get을 shim에서 고정하면 두 커널의 파이썬 가시 상태(random.random(), hash)가 바이트 동일 ⑤ 비결정 대조(고정 끄면 갈림)로 우연 아님 확인.
- **의미**: 우리 보석(reactive/session/.pymachine/체크포인트)이 요구하는 계약 코어 2축(선형 메모리 + 결정적 부팅)이 **Pyodide 없이 성립**한다. 라운드 10의 EngineContract가 "계약만으로 프리미티브가 돈다"를 증명했고, 이번 라운드가 "그 계약을 non-Pyodide가 구현한다"를 실측했다. 둘을 합치면 "떼기"의 개념 증명이 닫힌다. 역설: WASI는 엔트로피가 import 2개(random_get/clock_time_get)로 수렴해 Pyodide의 3소스 전역 스텁보다 결정성이 깨끗하다.
- **자산 정책**: WLR wasm(25MB) + shim(29KB)은 레포 미추적(.gitignore, README 레시피로 재현). "레포 자산 0 + 서드파티 라이선스 고지 부담 회피" = 의존성 0/빌드 0 기조 유지. attempts probe라 CI(gate.html) 무관.
- **남은 것**(승격 전): 값 프로토콜(FFI 부재 우회 = JSON 직렬화 get/set), reactive를 이 엔진 위에서 실동작, 반복 실행(stdin 프레임 드라이버 = 인터프리터 세워두고 코드 조각 N회). 승격 경로 = EngineContract에 WasiEngine 구현 추가 -> `boot({engine})` 옵션화. 벽: 스택 sp 미노출(null 계약으로 흡수), 네이티브 확장(PEP 783 대기).
- 협업 규율 기계화: AskUserQuestion(4지선다/객관식) 전역 PreToolUse 훅으로 영구 차단(대원칙 = 열화판 금지, 최고 품질 자체 판단). 규칙 정본은 CLAUDE.md + 메모리(로컬 전용), 집행은 사용자 전역 `~/.claude`(레포 `.claude/`는 일회성이라 규칙/집행 미배치).

### 2026-07-12 라운드 10: 엔진 독립 P1 착수 완료 - EngineContract seam (구조 298 + 브라우저 38 무변경)

- 목표 재확인: "Pyodide를 떼고 진짜 파이썬이 굴러갈 수준". 그 인프라가 EngineContract seam이다(엔진을 삭제가 아니라 교체 가능한 옵션으로). 개념이 불확실한 부분("우리 프리미티브가 엔진 계약만으로 도는가")은 규칙대로 attempts에서 검증 후 합류했다.
- **개념 증명**([engineContract 캠페인](../browser-os/../../tests/attempts/engineContract/README.md)): PyodideEngine 어댑터로 부팅 -> memory 능력을 계약(heapU8/stack) 위에 세움 -> src ReactiveController가 그 위에서 양방향 시간여행(cp0<->cp1). **엔진 내부(`_module`/`globals`/`_emscripten_stack_*`) 직접 접근 0으로 GREEN 8/8**. 발견: execSeq(실행 경계 카운터)도 계약의 일부다(우회 실행은 reactive가 힙 변이를 놓쳐 복원이 깨진다).
- **승격**: `src/runtime/engines/pyodideEngine.js`(EngineContract Pyodide 구현). MemoryCapability는 `constructor(engine)`로, Runtime은 run/setGlobal/install/freeze/mountHome/raw를 engine 경유로 리팩터. **동작 무변경 게이트**: 구조 298 + 브라우저 38 + 예제 4 전부 수정 없이 GREEN. 엔진 접점이 8파일 40지점 -> 1파일 뒤로 격리(덕지덕지 제거).
- **WASI 매핑 확정**(D2 관문 설계): 계약 메서드별로 non-Pyodide 구현 경로를 표로. 우리 보석이 요구하는 건 heapU8 + 결정적 부팅뿐이고 둘 다 WASI에서 성립(부팅 결정성은 `random_get` import 하나로 수렴 = 오히려 더 깨끗). 벽은 값 다리(FFI 부재) = 계약이 값 프로토콜을 기본으로 두면 우회. 스택 sp는 null 허용 계약이라 프리빌트에서도 복원이 선다.
- 다음: [engine-independence](../engine-independence/README.md) P0 자가 호스팅(유일한 실시간 리스크 CDN 제거) 또는 D2 관문 캠페인(non-Pyodide CPython 실부팅 + 값 프로토콜 재설계). worker.js/pyProc의 프로세스 부팅 경로는 자체 엔진이라 seam 후속 정합 대상.

### 2026-07-12 라운드 9: 외부 평가 수용 = 정확성 라운드(불변조건 부여) (구조 285 + 브라우저 38 + probe)

- 외부 코드 리뷰 2건(정적 분석 + 참조 프로젝트 조사)을 받아 지적을 당일 코드로 갚았다. 정본: [browser-os/03-external-review-response.md](../browser-os/03-external-review-response.md). 리뷰의 결론("기능 추가가 아니라 이미 발명한 기능에 프로토콜·복원·장애 불변조건을 부여할 단계")이 같은 날 우리 심판 3종의 결론과 독립 수렴했다.
- **수용 -> 코드(전부 실측 GREEN)**: ① .pymachine **포맷 v2** = 봉투 전체(헤더+델타) 해시 인증(v1은 델타만 해시라 manifest.setup 변조가 통과 = 부팅 코드 주입 구멍) + 입력 검증 상한, v1 지원 종료. ② **reqId RPC** = 워커당 상시 라우터 + pending map, map taskId가 호출마다 0부터라 동시 호출 응답이 교차하던 결함 제거 + 워커 사망 시 대기 요청 전량 즉시 reject(영원히 매달리는 Promise 소거). ③ **ASGI 동시 요청** = 요청을 전역이 아니라 함수 인자로(코루틴 지역, iframe 라우팅으로 실시나리오화된 경쟁). ④ **PyProxy destroy** + 직렬화 계약. ⑤ **성장 세션 fork** = harvest heapLen + 자식 힙 성장 후 적용(부모 73MB>자식 30MB 실측). ⑥ **저널 HEAD/PREV 2세대** + 손상/첫부팅 구분 + blob SHA 재검증. ⑦ **복제 고유성** random 재시드(fork는 예외). ⑧ **부팅 직렬화**(bootChain) + ensureEngineScript in-flight 공유. ⑨ bootEnv indexURL 유실 수정.
- **게이트 확장**: 동시 map 3건 격리, ASGI 동시 요청 4건 격리, 봉투(헤더) 변조 거부, v1 거부, 성장 fork 무손상, 저널 2세대 후퇴, 손상/첫부팅 구분, 복제 random 갈림. 게이트 35->38, journalProbe 8->11, forkLiveProbe 8->10, machineImageProbe 4->8.
- **기각(원칙 충돌)**: SQLite WASM(의존성 0. 구조만 차용), 즉시 WASI ABI(P6로), tsc 게이트(CI 전용 후보), 이벤트 로그(보완이지 대체 아님, 장수 캠페인 후보).
- **진짜 목표 합류(Pyodide 제거)**: 이 라운드가 곧 디커플링이다(엔진 특이 접점을 좁은 계약 뒤로 이동). D2 관문 조사 완료 - non-Pyodide CPython wasm 실재(WASI brettcannon 3.14.6 + browser_wasi_shim 114KB vendoring), 벽 = JS FFI 부재(값 프로토콜 재설계 필요)·스택/인터럽트는 emscripten 자가 빌드에만. 다음: [engine-independence](../engine-independence/README.md) P1 EngineContract seam(떼기의 인프라).

### 2026-07-12 라이선스 재확정: Apache 2.0 -> MPL-2.0 (전일 결정 번복)

- 하루 전 확정한 Apache 2.0을 **MPL-2.0으로 교체**했다. 재검 트리거는 "AGPL이 더 낫지 않나"라는 질문이었고, 검토 결과 AGPL은 기각하되 **Apache도 최적이 아니라는 결론**이 나왔다.
- **AGPL 기각 근거(구조적)**: AGPL이 GPL과 갈리는 유일한 지점은 §13(네트워크 서비스로만 제공하고 소스는 안 주는 SaaS 구멍)이다. pyproc은 정의상 코드가 브라우저 탭으로 **반드시 전달**되므로 모든 사용이 이미 배포다. 막을 구멍이 없다. 받을 수 없는 이익에 최대 채택세(프론트엔드 의존성 전염 = 기업 법무 자동 반려)를 내는 거래라 기각.
- **Apache -> MPL 근거**: 진짜 방어 동기는 "포크가 닫힌 채 굴러가는 것"이었는데, 그에 정확히 대응하는 도구는 강한 카피레프트가 아니라 **파일 단위 카피레프트**다. MPL-2.0은 비공개 앱 임베드를 자유롭게 허용하면서 pyproc 자체 파일의 수정분은 소스 공개를 강제한다. 런타임 인프라에 필요한 보호는 이것으로 충분하다.
- 부수 이득: **엔진 Pyodide와 동일 라이선스**라 "엔진과 같은 조건" 한 줄로 설명이 끝나고, Pyodide를 이미 수용한 법무팀은 정의상 MPL을 수용한다(채택 비용 ~0). 특허 허여는 MPL 2.1(b)로 유지되므로 Apache 3절을 버려서 잃는 것도 없다. CLA 불요도 유지(2.1절 기여 = 라이선스 허여, inbound = outbound).
- 상실한 유일한 것: Apache의 GPLv2 비호환 회피 등 permissive 특유의 무마찰. 채택 마찰이 실제로 관측되면 MPL -> Apache 완화는 저작권 단독 보유 상태라 언제든 가능하다(역방향은 SHA 핀 계약상 불가).
- 반영: LICENSE(정본 373줄 verbatim), package.json `MPL-2.0`, README 2종 실질 조건 3줄 명시, CONTRIBUTING 2종 기여 조건 갱신, examples 랜딩 푸터. Exhibit A 파일 헤더는 미부착(레포 전체가 단일 라이선스라 루트 LICENSE + README로 3.1절 고지 의무 충족, 덕지덕지 회피).

### 2026-07-12 라운드 8: 객관 판정(심판 3종) + 셀프호스팅 증명 + 판정의 코드화 (구조 278 + 브라우저 35 + probe 3종)

- 질문: "정말 OS인가, 그 위에서 서버·웹을 개발할 수 있는가". 독립 심판 3종(OS 점수표 / 개발 플랫폼 / 적대적 반박)을 돌려 객관 좌표를 받고, 지적을 당일 코드로 갚았다. 정본: [browser-os/02-os-verdict.md](../browser-os/02-os-verdict.md).
- **판정 요지**: OS 간판은 조건부 49/100(조건 = P4 파이프 / P2 커널 탭독립 / P6 집행되는 보호). 셀프호스팅은 **성립을 실측으로 확정**: 신설 캠페인 [selfHost](../../tests/attempts/selfHost/README.md) fullStackProbe 8/8 - FastAPI(설치 916ms) + sqlite + HTML을 /home에 개발, GET p50 2.1ms, 재부팅->재서빙 3.4s(코드/DB 디스크 생존), dev loop(수정->반영) 7ms.
- **가상 오리진 충실화 3종 승격**(개발 플랫폼 심판의 4구멍): 요청 헤더 전달 + 바이너리 바디(b64 채널, .text/.content 등가 계약) + **커널 클라이언트 라우팅(hello 등록부)** + 무응답 504 타임아웃. originFidelityProbe 7/7: **가상 오리진에서 서빙된 iframe(커널 밖 문서)의 fetch가 커널에 20ms로 도달** = 서빙된 웹앱이 진짜 문서로 산다. 발견 2건: `setGlobal(null)`은 JsNull 프록시(널 정규화는 JS 경계), SW 합성 응답에 COI 헤더 없으면 부모 COEP가 iframe 차단(기본 탑재로 해소). 잔여 벽: Set-Cookie 스트립/WebSocket/스트리밍.
- **조용한 오염 경로 2개 폐쇄**(심판 적발 실결함): ① fork 자식측이 델타 밖 드리프트를 cp0으로 복원(더러운 dst 정화, 게이트 마커 배타 검사로 상시화. 적용 1.4->33ms는 정확성의 값) + parentPid 계보 기록 ② journal recover가 경계 지문(h0) 불일치 시 명시적 예외(journalProbe 8/8) + start()의 storage.persist() 요청(디스크의 캐시 강등 방지).
- 표기 정직화: 랜딩 5.28배를 "sharded numpy sort vs one pass"로(샤딩 배속이지 same-work 병렬 효율이 아님을 명시. same-work 정직 수치는 게이트 map 검사).
- 다음 지렛대(판정 문서 §다음 지렛대): P2 > P4 > P6, 대형 힙(500MB+) 성능 봉투 실측, 부트 SRI/.pymachine 서명/저장물 포맷 버전, WebVM 정면 벤치.

### 2026-07-12 발명 라운드 7: WAL 승격 - 강제종료해도 부활하는 머신 (구조 275 + 브라우저 33)

- 로드맵 P1(machineJournal) 완주. 1차 개념증명(문장단위 WAL)이 무겁다는 신호를 남겼고, **churnProbe로 원인을 규명해 설계를 확정**한 뒤 승격했다.
- **churn 바닥의 정체(핵심 발견)**: no-op 문장(`1`)조차 90~106페이지(6MB)를 더럽히고, **그 페이지 집합이 97~98% 고정**이다(CPython eval 루프/GC의 scratch 워킹셋. 사용자 상태와 무관, gc.freeze로도 안 줄어든다). 배치해도 고유 페이지는 1~5%만 줄지만 **총 쓰기량은 88% 준다**(문장별 765p vs 배치 1회 91p = 8.4배). 결론: **커밋 단위는 문장이 아니라 유휴다** - churn 바닥은 못 줄이므로 커밋 *빈도*가 비용을 지배한다.
- **`MachineJournal` 승격**(`rt.enableJournal({dir, reactive, idleMs})`): 유휴 감시 -> 자동 커밋(변경 페이지를 sha256 content-addressed blob + HEAD.json, dedupe 공짜), `recover()`가 마지막 커밋으로 부활. 실측 7/7: hibernate/clean save 없이 커널을 버려도 새 커널이 8.8MB/2330ms로 부활(변수·배열·연속실행 정합), 저널 없으면 null(첫 부팅).
- 계약(정직): 크래시 시 잃는 것은 "마지막 커밋 이후"다(문장 단위 내구성이 아니라 경계 일관성). 커밋은 비동기라 REPL 비차단. 다음 최적화 후보: blob 개별 파일 -> append-only 팩(커밋 1회 ~2s의 대부분이 OPFS 파일 생성 비용).
- 이로써 진단 4대 부재 중 **3개 해소**(죽음 내성 / fork / 시그널). 잔여: IPC(파이프·스트리밍). 다음 우선순위는 P2 커널 선출(커널을 워커로 = fork 비대칭 해소 + 탭 죽음 생존).

### 2026-07-12 발명 라운드 6: 근본 OS - fork(2) + 시그널 표 + 체크포인트 나무 (게이트 33검사)

- 근본 OS 연구 라운드(전문 에이전트 3종 토론: OS 아키텍처 / 혁신 터미널 / 가상화). 연구 종합과 다음 로드맵의 정본: [browser-os/01-os-primitives.md](../browser-os/01-os-primitives.md).
- **forkLive = 진짜 fork(2) 승격**: `PyProc({replay})` + `fork(src, dst)`. 스냅샷-fork(bare 이미지 복제)와 달리 **살아있는 프로세스의 변수·배열·계산 결과가 자식으로 실린다**(델타 10.3MB 수확 43.6ms, 적용 1.4ms, 왕복 4ms, 주소공간 독립). **벽 좌표**: 메인 커널 vs 워커 커널의 리플레이는 힙 길이는 같아도 바이트가 다르다(로더/컨텍스트 차이). 워커끼리는 바이트 동일 -> fork는 대칭 컨텍스트에서만 성립하고 메인은 조율자다. 이 사실이 다음 P2(커널을 워커로)의 근거.
- **시그널 표 승격**: `PyProc.signal(pid, signum)` + `SIGNAL{INT,TERM,USR1,USR2}`. SAB 채널에 번호를 쓰면 CPython eval 루프가 그 번호의 파이썬 핸들러를 부른다(SIGUSR1 발화 후 실행 계속, SIGTERM 협조적 종료 264ms + 워커 재사용). 발명 0으로 유닉스 시그널이 열렸다. `interrupt`는 별칭 유지.
- **체크포인트 나무(머신의 git) 승격 + 실결함 수정**: `reactive.parents` + `tree()`. **선형 체인의 결함을 재현**했다 - 분기 노드로 스위치하면 버려진 형제 분기의 델타를 집어 `memory access out of bounds`로 힙이 깨진다(branchProbe 6/7 RED). %undo는 뒤로만 가서 무증상이었고, 분기(Time Rail)를 여는 순간 밟는 지뢰였다. 델타 해석을 부모 체인 walk로 수정 -> 10/10 GREEN. 터미널 에이전트가 코드 리뷰로 독립 지목한 지점과 일치.
- 다음 우선순위(01-os-primitives.md): P1 저널(WAL = 강제종료 내성) -> P2 커널 선출(워커 커널 + Web Locks, fork 비대칭 해소) -> P3 잡 컨트롤(&) -> P4 파이프/shm -> P5 머신 컨테이너 -> P6 권한 감옥 -> P7 파일 세계 v2. 안티 추천 8종도 기록(SharedWorker 커널 승격, 선점 시분할, 계정 시스템, 제로카피 약속, VT100 에뮬, 셸 파이프 DSL, 커스텀 빌드, WebRTC 분산).

### 2026-07-12 발명 라운드 5: 진짜 OS 표면 - 파이썬이 모든 것을 다룬다 (probe 3종 GREEN, 게이트 29검사)

- 근본 복귀 라운드(주제: 웹 OS, 파이썬이 모두 할 수 있는 진짜 OS). 기둥 4개를 실측 -> 승격.
- **모든 것은 파일(Plan 9)**: Emscripten FS 장치 등록으로 브라우저 능력이 파이썬 파일이 된다. deviceFsProbe 8/8(쌍방 브리지, 열 때마다 신선한 /dev/clock, /proc/meminfo = 실제 힙, with문/부분읽기 정합) -> `DeviceFs`(enableDeviceFs) 승격: 내장 /proc/meminfo + /dev/clipboard(쓰기 즉시 반영 시도, 읽기는 캐시 + refreshClipboard) + 소비자 장치 주입 + /proc/ps 제공자. 새 API 표면 0(open()이 계약). 비동기 소스는 캐시+refresh가 정직한 계약(FS read 콜백은 동기라 JSPI로도 중단 불가).
- **init/cron**: initProbe 5/5(boot.py 오토스타트 4ms, cron 300ms 틱 3회/1.05s, /home으로 세대 계승 counter 1->2, 파일 없으면 no-op) -> `Init`(enableInit) 승격 + machine.html 배선(데모 머신이 rc.local을 지원). 크론 실패는 크론을 죽이지 않는다(경고 후 지속).
- **requests 실동작**: requestsProbe 4/4(pyodide-http patch_all, GET 15ms, 재사용/커스텀 헤더. 1차 RED의 원인 = requests는 절대 URL만 받음) -> `SyscallBridge({requests:true})` 옵션 승격. dartlab 체크리스트의 requests 계열 항목 해소.
- **셸 %pip**: Terminal.push가 `%pip install <spec>`을 micropip으로 배선(머신 안에서 환경 성장). 게이트 상시 검사.
- 게이트 29검사(+%pip, deviceFs 브리지, /proc/meminfo). 잔여(다음 라운드 후보): 파이프/시그널 확장, /home 포함 이미지 v2, 델타 분기, SharedKernel+hibernate.

### 2026-07-12 라이브 데모 실결함 발견 -> 예제 실행 게이트 신설 + 데모 영문 리디자인

- **라이브 데모에서 실결함을 직접 발견**: processOs 예제가 `TypeError: Do not know how to serialize a BigInt`. 원인: 2^53을 넘는 파이썬 int는 BigInt로 오는데(정밀도 보존 = 라이브러리는 올바름) 예제가 JSON.stringify로 결과를 비교. **구멍의 본질: examples/*.html은 어떤 게이트도 실행하지 않았다**(라이브러리 게이트는 라이브러리만 검증).
- 대응: ① BigInt-안전 비교로 수정 ② **예제 실행 게이트 신설**(`npm run test:examples` = tests/browser/examples.mjs): 데모 4쪽을 사람이 여는 그대로 headless 완주 검증, 예제는 `?gate`에서만 보고(평시 no-op). CI 매 푸시 실행. 첫 실행 4/4 GREEN. 하네스 공용 조각은 harness.mjs로 추출(run.mjs와 드리프트 방지).
- **데모 영문 리디자인(결정 2건)**: 데모에도 기본기가 있어야 하고, 영문 위주여야 한다(개발자는 외국인이 다수). examples/demo.css 공용 디자인(다크, 카드/패널/배지) + 4예제와 랜딩을 영문 UI로 재작성. 내부 문서·커밋은 규칙대로 한국어 유지(영문화 범위 = 공개 데모 표면).
- **랜딩 승격(추가 결정: "랜딩 수준으로 그럴싸하게 + 브랜딩 + dartlab식 SNS")**: 랜딩을 워크플로 히어독에서 실파일 examples/index.html로 승격(배포 시 루트 이동, 로컬 "/" 서빙). 브랜드 마크/파비콘(인라인 SVG, 터미널 프롬프트 모티프), 히어로 + 설치 칩(클립보드), 실측 수치 스트립(4.2x/5.28x/3.4ms/13.7MB/0), 기능 그리드 6종, 우상단 SNS 아이콘 줄(dartlab BrandSocial 구성 준용: GitHub/후원 하트/YouTube/Threads/Instagram. Threads·Instagram은 @eddmpython으로 정정 반영).
- **브랜드 마크 창조**: 전원 심볼(꺼지지 않는 컴퓨터)이자 터미널 커서(살아있는 프롬프트)인 이중 의미 글리프, 다크 배지(= .pymachine 파일) 안에 그린. 정본 assets/logo.svg, 파비콘 data URI(외부 자산 0), 랜딩+예제 4쪽 헤더, README 2종 상단 적용. 워드마크는 "py"만 그린.
- **문서 주체 규칙 명문화 + 기계 가드**: 문서·주석·독스트링의 주체는 나다(1인칭/주어 생략 중립, 3인칭 호칭 금지 - 커밋 주체 중립 규칙의 문서판). 기존 문서 전량 스윕 + `tests/run.mjs` 주체 가드 신설로 영구 차단. 공개 데모 표면 영문 우선도 규칙화(로컬 규칙 문서 언어 절).
- 검증 체계는 이로써 4단: 구조(239) / 브라우저 런타임(26) / 예제 실행(4쪽) / 수동. testing.md 갱신.

### 2026-07-12 데모 호스팅 결정: GitHub Pages 정본 + npm 게시 완료

- **npm 게시 완료**: `pyproc@0.0.5` 퍼블리시(릴리즈 v0.0.5 = 버전+태그+GitHub Release+npm, 절차 7단계 신설). 설치 실검증(빈 프로젝트 `npm install pyproc` -> 내용물 정합). README 2종/소비 계약 반영.
- **데모 = GitHub Pages(방침: 외부 서비스 최소화)**. Cloudflare 질문에 대한 답: 필수가 아니라 "헤더 되는 곳" 중 하나였고, 실측 2건이 깃헙 경로를 열었다. ① noCoiProbe 7/7 - 머신 핵심 동선(부팅/세션 부활/.pymachine/디스크/JSPI)은 COI 불필요, SAB(프로세스 OS)만 경계. ② swCoiProbe 4/4 - `pyprocSw.js?coi=1` 헤더 주입 + 1회 새로고침으로 crossOriginIsolated=true + SAB 실사용 복구.
- 승격: pyprocSw 쿼리 3호 `?coi=1`(opaque는 원본 통과 = CDN 자체 CORP 전제), processOs.html 부트스트랩 내장, serve.mjs `{coi:false}` 옵션 + 하네스 `PYPROC_NO_COI`(헤더 없는 호스팅 재현 실측 레인).
- 배포: pages.yml(push마다 자동, 랜딩/SW 루트 사본은 워크플로가 조립해 저장소 루트 무오염). Cloudflare는 예비로 기록(dartlab wrangler 인증이 이 머신에 유효함을 확인, 전환 시 분 단위).

### 2026-07-12 엔진 독립 연구 + 평가 후속 정비 (전문 에이전트 2종 연구 종합)

- 출발 질문("Pyodide 의존 제거, 독립, 아니면 더 훌륭한 방법") -> 생태계 리서치 + 코드 결합 감사 에이전트 연구 종합. **결론: 완전 제거는 지금 손해, "갇히지 않는 사다리"(P0 자가호스팅 -> P1 EngineContract seam -> P2 스냅샷 사전 제조 -> P3 업스트림 워치 -> P4 조건부 fork 보험)가 정답.** 정본: [engine-independence PRD](../engine-independence/README.md). 핵심 증거: PEP 783 Accepted(2026-04, pyemscripten 휠 = Pyodide-agnostic 탈출구), Pyodide의 CPython 패치는 9개 파일(모트는 FFI·패키지 생태·스냅샷 3덩어리), Cloudflare fork 코드 전부 공개(MPL = 공짜 보험), WASI는 동적 C 확장 불가로 현재 양립 불가.
- 결합 감사 판정: 보석(리액티브 접점 0, 세션/.pymachine, SW 층, PyProc 스케줄링, SharedKernel)은 이미 엔진 중립 - "선형 메모리 + 스택 포인터 + 결정적 부팅 + 엔진 스냅샷" 4프리미티브 위 순수 알고리즘. EngineContract seam 설계(~250 LOC, 동작 무변경) 확보.
- **감사 적발 결함 3건 즉시 수정**: ① subprocess 자식 워커에 indexURL 미전달(자가호스팅/오프라인에서 자식만 CDN으로 새는 누수) -> `Runtime.indexURL` 계약 신설 ② `PyProc.interrupt`가 SIGINT 미지원 워커에도 true 반환(무증상 no-op) -> ready의 interrupts 플래그 소비 ③ 세션 리플레이 결정성 무대조(엔진/엔트로피 변화로 cp0이 달라져도 델타를 덮어 조용한 오염) -> 저장물에 cp0 다이제스트(h0) 포함 + load/openMachine 대조 예외(구 저장물은 무검사 통과, .pymachine에도 적용).
- 평가 후속 정비 완료: README 표면 동기화 기계 가드(부채 해소), 데모 배포 준비물(루트 _headers + docs/operations/demoHosting.md), CI 실측 JSON 아티팩트(PYPROC_GATE_OUT), 레포 설명/토픽. 계약 실태 표에 "암묵 FFI/fetch 가정" 행 신설.

### 2026-07-12 발명 라운드 4: uv 레인 + SW 계층 + 공유 커널 (probe 7종 GREEN, 게이트 26검사)

- 타 세계 개념 흡수 라운드(주제: 판을 바꿀 아이디어를 개념부터 확실히 잡고 구현). 새 캠페인 envManager 개설(캠페인 3개째: 개념 = 환경의 선언·캐시·재현).
- **uv 레인 승격**: ① `bootEnv(manifest, dirs)` - bare 스냅샷(_loadSnapshot 부팅 227ms, 콜드 3623ms) + OPFS 휠로 2차 환경 부팅 5109ms -> **1229ms(4.2배)**. 패키지 실린 힙 스냅샷은 hiwire 벽 재확인(3레인: postImport/{packages}/serializer 전부 "index 6" 거부, reharvestProbe와 교차 확인) -> bare가 유일한 스냅샷 단위로 확정. ② `runScript` - PEP 723(# /// script) 파싱은 표준 라이브러리(re+tomllib)로, 의존성 자동 설치 + 실행 = 브라우저판 uv run. ③ `Runtime.freeze` + `boot({lockFileURL})` - micropip.freeze 락(355패키지)으로 커널 B가 해석 0/164ms 핀 설치(비배포판 패키지로 관통 증명).
- **SW 계층 승격**: `pyprocSw.js`(등록형 자산, 쿼리로 기능 선택) + `VirtualOrigin`. ?asgi= 가상 오리진: fetch가 파이썬 ASGI로 응답, 평균 **3.4ms/req = 직접 dispatch와 동일(SW 오버헤드 0)**. ?cache=1 완전 오프라인: 기둥5의 남은 구멍(script 경로)을 봉인, 2차 부팅 CDN miss 0. "SW 배선은 소비 제품 몫" 방침 폐기(배선도 pyproc 프리미티브, 등록/스코프만 소비자 몫). serve.mjs에 Service-Worker-Allowed 헤더.
- **공유 커널 승격**: `SharedKernel`(SharedWorker) - 여러 탭 = 한 파이썬 상태, 탭이 닫혀도 커널 생존(머신이 탭 밖에서 산다). 벽 실측: SharedWorker는 crossOriginIsolated=false(플랫폼) = SAB 불가 -> interrupt/스냅샷-fork 제외한 실행/상태 공유가 v1 스코프.
- 구조 정리: 엔진 스크립트 로더/DEFAULT_INDEX 3중 복제를 runtime.js `ensureEngineScript`/`DEFAULT_INDEX`로 단일화(pyProc 리팩터). 구조 게이트 173검사(네이밍 가드가 새 파일 전부 커버).
- 남은 큐: Session 리플레이의 스냅샷 베이스 결합(머신 resume 가속 v2), SharedKernel과 hibernate 결합, 델타 분기, /home 포함 이미지 v2.

### 2026-07-12 발명 라운드 3: 파이썬 머신 5기둥 완결 + 네이밍·캠페인 정정 (게이트 24검사)

- browser-os 이니셔티브의 5기둥 전부 실측 승격: ① `.pymachine` 단일 파일(SHA-256 무결성 + `trust` 승인 게이트, 13.7MB 부팅 2.5s) = `exportImage`/`openMachine` ② 영속 디스크 `Runtime.mountHome`(/home/web, 커널 간 생존) ③ 셸 매직(%ls/%cd/%pwd/%cat) ④ 수명주기 데모 examples/machine.html(pagehide 자동 hibernate + 재방문 resume) ⑤ 오프라인 부팅 `boot({coreCacheDir})`(코어 3종 OPFS, 2차 부팅 fetch 계층 miss 0. 한계 정직 기록: pyodide.js/asm.js는 script 경로 = 완전 오프라인은 SW 몫).
- 성장 세션(Session v2): 힙이 자란 세션 부활(30->65MB, 354ms). 발견 2건 기록: JS Memory.grow 직접 호출은 글루 뷰 파손(파이썬 할당 경로가 정답), 성장 흔적은 restore(0) 되감기로 해소.
- 규칙 위반 정정 2건: (a) camelCase는 언어 불문(JS 문자열 안 파이썬 포함) - 전량 정정 + `tests/run.mjs` 네이밍 기계 가드 신설. (b) attempts 캠페인 양극단 금지 - runtimeParity에서 pythonMachine 캠페인 분리(질문 7개 이관), 규칙 명문화.
- 결함 수정: coreCacheDir 감싼 fetch의 재진입 무한 재귀.

### 2026-07-11 발명 라운드 2: WheelCache + %undo 시간여행 REPL (게이트 23검사)

- `WheelCache` 승격: install/loadPackages 구간 한정 fetch 래핑으로 .whl을 OPFS에 저장/서빙. 실측 5/5: 커널2가 hit 2/miss 0으로 설치(재다운로드 0). 발견: micropip은 fetch에 URL 객체를 준다.
- `Terminal({timeTravel})` 승격: 완결 문장마다 자동 체크포인트, `%undo`가 직전 상태로 복원. 로컬 REPL에 없는 능력 2호(1호는 Session 부활).
- "웹의 uv" 3층 중 2층(매니페스트=bootSession, 저장층=WheelCache) 완성. 남은 결합: Session 매니페스트가 WheelCache를 경유해 "환경 열면 즉시"를 만드는 v2.
- 남은 발명 큐: parallelMap(numpy 샤딩), 성장 세션(v2), 델타 체인·분기.

### 2026-07-11 발명: Session(불멸 커널/warm-fork) 승격 - 리플레이+델타

- 전문 리서치(웹 조사 에이전트) 협업 결론 채택: 커널 상태 = 선형 메모리 + 함수 테이블 + JS측(hiwire/MEMFS). "부팅된 커널에 되쓰기"가 아니라 **결정적 리플레이 + 델타**가 정답 아키텍처(Cloudflare workerd 동원리).
- 실측 3연타: (1) bootDeterminism - PYTHONHASHSEED=0 + 엔트로피/시간 고정이면 bare·numpy 리플레이 모두 상이 페이지 0(무조치는 180p). (2) replayFork - 사용자 상태(변수+numpy 배열) 델타 160p/10MB를 동형 커널에 1.5ms 적용, 전부 생존. (3) 승격 후 게이트 상시 검사 - 크로스 커널 부활 95p/5.9MB GREEN.
- 승격: `bootSession(manifest)`(indexURL/env/packages/setup = 환경 선언) + `Session.save/load`(OPFS, 매니페스트·힙 크기 불일치는 명시적 예외). base는 저장하지 않는다(리플레이가 대체) = 저장물이 힙 43MB가 아니라 델타 수 MB.
- 의미: hiwire 벽(#5195) 우회로 warm-fork 실용화, 세션 간 부활(로컬 REPL도 없는 능력) 개방. "웹의 uv"는 (매니페스트) + (wheel OPFS 캐시) + (세션 델타) 3층으로 확정.
- boot()에 env 계약 추가. 남은 v2: 힙 성장 세션, 델타 체인·분기, wheel 캐시 결합.

### 2026-07-11 외부 리뷰 대응: restoreLive 경계 계약을 기계 강제로

- 외부 코드 리뷰의 최우선 지적("sound를 파는 라이브러리에서 soundness 전제가 강제되지 않는다") 수용. `Runtime.execSeq`(상태 변이 카운터: run/runAsync/setGlobal/install/loadPackages)로 경계 위반을 **O(1) 감지**해 restoreLive가 자동으로 재해시 경로로 승격. 실측: 위반 시 27.4ms 안전 복원, 준수 시 0.69ms 즉시 경로 유지(`rehashed` 플래그로 확인).
- 리뷰의 다른 지적 중 SIGINT 부재·버전 관문·OPFS 경제성은 리뷰 시점 이후 이미 해소됐음을 확인. "리액티브 과설계" 우려는 dartlab의 독립 재발명이 수요 반증. restore()의 힙 성장 비대칭 관찰은 계약 실태 표에 열린 항목으로 등록(probe 후보).
- 릴리즈 0.0.4(버전만. 태그 폐지 정책 확정: 표식은 package.json 하나, npm 퍼블리시 개시 시 태그를 절차의 자동 산출물로 재도입).

### 2026-07-11 dartlab 흡수 완주 + parity 승격 5종 (게이트 20검사)

- 한 턴에 승격 5종: `restoreLive({rehash})`(예외 안전 복원), `AsgiServer`(소켓 0 dispatch 3.4ms), `Terminal`(+examples/terminal.html), `interrupt(pid)`(SIGINT 517ms 수렴, respawn 0), `saveBase/loadBase`(OPFS 영속, 30MB 쓰기 256ms/읽기 46ms).
- 실측 관문 2종 통과: v314에서 dartlab 스택 + 대표 라이브러리 17/17 설치·import.
- 결함 수정: 워커 에러 문자열을 꼬리로 잘라 예외 타입 보존.
- 남은 큰 덩어리(다음 세션): 델타 체인 영속 + 분기 그래프 + 세션 간 커널 복원, "웹의 uv"(wheel OPFS 캐시 + requirements), requests/저수준 socket, 시그널 확장. 정본: local-parity NEXT.

### 2026-07-11 dartlab 병행 구현 발견 -> 흡수 결정 + 목표 확장

- dartlab `mainPlan/web-notebook-runtime`(자체 워커·체크포인트 그래프·OPFS, Pyodide 0.27.5)과 `browser-as-server-ssot`(FastAPI in pyodide, e2e PASS)를 발견. 런타임이 3벌로 갈라진 상태 확인.
- **결정**: 세 소비자의 개별 풀이는 동결. pyproc이 서면 dartlab/codaro/xlpod 전부 pyproc을 바라본다. pyproc = 혁신·발명 레인, 목표는 "웹에서 로컬처럼: 실행 + 패키지 설치 + 임베디드 파이썬/uv급 환경". 하드코딩 원칙 금지(CLAUDE.md 개발 원칙 6).
- 흡수 목록과 순서는 [local-parity](../local-parity/README.md) "흡수 계획" 절이 정본. 1순위 = 예외 안전 복원(재해시), 관문 = Pyodide 버전 정합(0.27.5 vs v314) 실측.

### 2026-07-11 잔여 결함 전량 개선(attempts 3종 졸업) + local-parity 발명 개시

- **processLifecycle 졸업**: 행 시 map 무한 대기 재현 -> `map(.., {taskTimeoutMs})` 유한 수렴(1786ms 실측) + `kill(pid)` + 스냅샷 respawn(302ms). `_spawn`/`_replace` 리팩터.
- **reactiveSoundness 졸업**: 페이지당 이중 32비트 해시(실효 64비트, ~2^-64). 비용 1.54배(30MB 힙 14.3ms), restoreLive 1.06ms 유지.
- **syscallBridge v1 졸업(스텁 탈피)**: input(동기 핸들러 + JSPI 블로킹), urllib 실 HTTP GET(동기 XHR, 바이너리 보존, proxyUrl 옵션), subprocess `-c`(자식 워커, 2007ms). 발견: v314에 `callSyncifying` 없음, JSPI 경로는 `pyodide.ffi.run_sync` + `can_run_sync()` 호출 시점 판정.
- **terminal 개념 입증**(승격 전): InteractiveConsole REPL + REPL 안 `input()` 블로킹 재개(24ms). 게이트 3(능력 계약 승격) 남음.
- **local-parity 이니셔티브 개시**: 축별 격차 지도(실행/프로세스/시스템콜/터미널/라이브러리/영구 벽). [mainPlan/local-parity](../local-parity/README.md).
- 하네스 범용화: `node tests/browser/run.mjs <페이지>`로 attempts probe도 headless 실측. 메인 게이트 15검사로 확장(수명주기 3 + 시스템콜 2 추가).

### 2026-07-11 브라우저 런타임 게이트 신설 + 프로세스 OS 실결함 2건 수정

- **`npm run test:browser` 신설**(의존성 0): COOP/COEP 서버 + headless Chromium(Edge/Chrome 자동 탐색) + POST 백채널로 공개 표면의 실동작을 자동 검증. CI(`.github/workflows/ci.yml`)에서도 같은 게이트가 돈다. examples/serve.mjs는 `createStaticServer()` export로 리팩터링해 게이트가 재사용.
- **게이트가 첫 실행에서 실결함 2건을 적발, 수정:**
  1. `PyProc.boot()`가 워커 부팅 실패를 삼켜 영원히 pending(계약 실태 표의 알려진 결함). 부팅 에러를 reject로 전파 + 워커 error 이벤트 처리 + 프로세스 상태 `dead` 기록.
  2. **스냅샷-fork가 배포 코드에서 부팅 불가였다**: SAB 뷰를 `_loadSnapshot`에 그대로 주면 Pyodide 내부 TextDecoder가 shared buffer를 거부(TypeError). 워커 로컬 일반 버퍼로 1회 복사해 해결. 기존 "검증된 실측"은 codaro 실험 코드 기준이었고, 추출된 pyproc의 SAB 경로는 브라우저 실측이 없어 이 결함이 숨어 있었다. 런타임 게이트 신설의 정당성이 즉시 입증된 사례.
- **이 머신 실측(게이트 GREEN 10/10, Edge headless)**: 메인 부팅 4004ms, restoreLive 0.84ms, fork 워커 부팅 평균 384ms(콜드 대비 약 10배), map 병렬 39ms vs 직렬 65ms(2워커 1.67배, 결과 정확). v0.0.3 재구조화의 브라우저 검증 완료(NEXT 1 해소).
- **릴리즈 정책(확정)**: 버전 올림 = 태그 = 릴리즈, 하나다. 명시 지시가 있을 때만 같은 값으로 함께 올린다. 남발 금지. 지시 없이 올렸던 0.0.4는 철회하고 0.0.3(태그 v0.0.3과 동일 값)으로 되돌렸다. 일상 커밋은 버전을 건드리지 않는다(소비자는 SHA 핀).

### 2026-07-11 라이선스 확정: Apache 2.0

- **Apache License 2.0** 채택 확정(Copyright 2026 eddmpython). 근거: 명시적 특허 조항(3절)이 스냅샷-fork·복원 리액티브 같은 발명성 기법의 사용자를 보호하고, 기여 조건 내장(5절, inbound=outbound)이 별도 CLA 없이 외부 기여를 연다. Pyodide(MPL-2.0)는 CDN 런타임 로드라 간섭 없음.
- CONTRIBUTING 2종의 "기여 보류" 절 해제, package.json `Apache-2.0` + `files`에 LICENSE 포함, README 2종 갱신.
- npm 레지스트리에 `pyproc` 이름 비어 있음 확인(2026-07-11). 퍼블리시는 npm 계정 인증 필요(NEXT 참조).

### 2026-07-11 운영 체계 수립 + src 레이어 재구조화 (v0.0.3)

- **운영 체계를 dartlab에서 차용해 수립.** 3층 정보 구조(CLAUDE.md 강행규칙 / 로컬 메모리 약속 / docs 공개 운영 문서), tests/attempts 졸업 게이트, mainPlan 수명주기(_done 이관). 규칙 SSOT: [docs/operations/operatingModel.md](../../docs/operations/operatingModel.md).
- **src를 레이어 폴더로 재구조화.** `src/runtime/`(runtime.js + memoryCapability.js), `src/capabilities/`(reactive.js + syscallBridge.js), `src/processOs/`(pyProc.js + worker.js). runtime<->reactive 순환 import를 memoryCapability 분리로 제거. 공개 표면과 subpath export 이름은 불변(소비자 무영향).
- **restoreLive 실행 경계 계약을 명문화.** "복원 전 마지막 실행을 checkpoint()로 닫는다"가 계약. 구 README 예제는 이 계약을 어겨 조용히 오동작하는 코드였다(checkpoint 없이 restoreLive 호출 = stale 해시 비교 = 0페이지 복원). 예제 수정 + reactive.js 상단 계약 주석 추가.
- **구 docs/PRD 2종을 이 이니셔티브 문서(00~02)로 이관.** docs/는 운영 문서 트리로 재편.
- **기여 정책 신설.** CONTRIBUTING 2종(en/ko). 라이선스는 미정 상태라 외부 코드 기여는 라이선스 확정 전까지 보류로 명시.
- 출처: 2026-07-11 운영 체계 전면 세팅 결정 + dartlab/codaro/xlpod 실태 조사.

### 2026-07-11 레포 추출 + codaro import 검증 (v0.0.1 ~ v0.0.2)

- codaro `tests/_attempts`의 검증 조각 4모듈을 프레임워크 무관 ESM으로 승격해 pyproc 레포 생성.
- codaro가 SHA 핀으로 실제 import(npm 해석·tsc 타입·Vite 워커 emit 3단계 green). SSOT 성립의 증명점.
- 소비 계약 확정: SHA 핀, 공개 표면만 의존, 단방향, Pyodide v314.0.2.

## NEXT (재개 지점)

### 직접 처리 TODO (계정/승인이 필요한 것, 2026-07-12 정리)

1. ~~npm 퍼블리시~~ **완료(2026-07-12)**: `pyproc@0.0.5` 게시(레지스트리 확인 23:08 UTC). 외부 설치 = `npm install pyproc`. README 2종/소비 계약에 반영 완료. 이후 릴리즈마다 절차 7단계(npm publish)가 표준.
2. ~~라이브 데모 연결~~ **GitHub Pages 자동 배포로 대체(2026-07-12, 방침: 외부 최소화)**: 추가 조작 0. 실측 2건이 경로를 열었다(noCoiProbe: 머신 동선은 COI 불필요 / swCoiProbe: SAB는 pyprocSw ?coi=1 주입으로). pages.yml이 push마다 배포, Cloudflare는 예비로만 기록(wrangler 인증 확인됨, [demoHosting.md](../../docs/operations/demoHosting.md)).
3. **엔진 독립 이니셔티브 착수 승인**: [mainPlan/engine-independence](../engine-independence/README.md) PRD 검토 후 착수 단계 지시.

### 작업 큐 (다음 세션 재개 지점)

1. **엔진 독립 P0**(착수 결정 시): engine-independence PRD의 첫 단계부터.
2. **다음 발명 라운드 후보**: 리액티브/%undo 델타 rebase·prune(장수 세션 메모리 부채, 계약 실태 표), Session 리플레이의 스냅샷 베이스 결합(머신 resume 가속), 델타 분기(머신의 git), /home 포함 이미지 v2, SharedKernel+hibernate 결합.
3. **codaro UI 배선 동행**: PyodideEngine이 browserPythonRuntime seam을 실제 사용할 때 나오는 요구를 이 원장에 기록. 그 시점 SHA로 재핀(스냅샷-fork 결함 수정이 들어간 커밋 이후여야 함).

### 종결 기록

- ~~푸시 후 CI 첫 실행 확인~~ 완료(2026-07-12, 사고 기록): 확인을 방치한 대가로 **전 이력 적색**이었다. 원인은 러너 특이사항이 아니라 로컬-CI 게이트 불일치: docs 2곳이 git 미추적 로컬 규칙 문서를 상대 링크로 걸어 로컬(파일 존재)만 green이었다. 링크 게이트를 "git 추적 기준"으로 격상해 부류째 봉인했고, 이후 structure + browser(러너 chrome, 26검사) 둘 다 **첫 GREEN**. 교훈: 게이트는 로컬 통과가 아니라 러너 통과가 완료 정의다.
- ~~"웹의 uv" 라운드~~ 완료(2026-07-12): 발명 라운드 4 참조.

## 메모리 포인터

- 세션 간 행동 약속(운영 방식 차용 근거, 소비자 하드 계약)은 로컬 메모리에 기록되어 있다. 레포 문서가 정본이고 메모리는 라우팅이다.
