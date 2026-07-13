# engineContract - 엔진 접점을 계약 하나로 모으면 프리미티브가 계약만으로 도는가

캠페인 = engine-independence 이니셔티브의 P1(EngineContract seam) 개념 증명. mainPlan 정본:
[engine-independence](../../../mainPlan/_done/engine-independence/README.md), [D2 관문 조사](../../../mainPlan/_done/browser-os/03-external-review-response.md).

## 가설

pyproc이 엔진(Pyodide)을 실제로 만지는 지점은 8파일 40지점에 산재하지만, **계약 표면은 좁다**:
실행(run/runAsync) / 값 다리(get/set) / 선형 메모리(heap·stack) / 인터럽트 / 패키지 / 스냅샷 / FS.
이 표면을 어댑터 하나(EngineContract) 뒤로 격리하면:
1. 상위(reactive/session/pyProc/능력)는 계약만 보고 엔진 내부를 모른다 = 덕지덕지 제거.
2. 계약을 non-Pyodide 엔진이 구현하면 엔진이 바뀐다 = "Pyodide 제거"의 인프라.

보석(reactive/session/.pymachine)이 이미 "선형 메모리 + 스택 + 결정적 부팅 + 스냅샷" 4프리미티브
위의 순수 알고리즘임은 코드 감사가 확인했다. 이 캠페인은 그 사실을 **어댑터로 실증**한다.

## 졸업 게이트

- EngineContract로 감싼 어댑터(PyodideEngine)만으로 부팅 -> reactive 체크포인트 -> 상태 변이 ->
  복원(시간여행)이 **엔진 내부 직접 접근 0으로** GREEN.
- 델타 수집/적용(session의 핵심)이 계약의 heap/stack만으로 성립.
- 계약 표면의 **WASI 매핑 가능성 표**: 각 메서드가 non-Pyodide(WASI CPython)에서 구현 가능/값프로토콜 강등/emscripten 자가빌드 필요/불가 중 어디인지. FFI 부재 우회 설계가 명시되면 졸업.
- 졸업 시 승격 형태: `src/runtime/engines/pyodideEngine.js`(어댑터) + Runtime/MemoryCapability가 계약 경유.
  게이트: **동작 무변경**(기존 구조 + 브라우저 게이트가 수정 없이 GREEN).

## 계약 표면 (초안 = 어댑터가 구현)

| 그룹 | 메서드 | 용도 | 필수/선택 |
|---|---|---|---|
| 실행 | `runSync(code)` / `runAsync(code)` | 코드 실행 | 필수 |
| 값 다리 | `setGlobal(name, v)` / `getGlobal(name)` | JS<->파이썬 값 | 필수(값 프로토콜로 강등 가능) |
| 메모리 | `heapU8()` / `stackSave()` / `stackRestore(sp)` | 체크포인트/델타/fork의 전제 | 필수 |
| 인터럽트 | `setInterruptBuffer(sab)` -> bool | 시그널 | 선택(미지원 시 false) |
| 패키지 | `loadPackages(pkgs)` / `install(pkg)` / `freeze()` | 환경 | 선택 |
| FS | `fs()` / `mountDir(path, handle)` | 장치/영속 디스크 | 선택 |
| 스냅샷 | `makeSnapshot()` / 부팅 시 loadSnapshot | bare fork | 선택 |
| 탈출구 | `raw()` | 미이관 접점 | 필수(권장 안 함) |

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-12 | contractProbe | Edge headless | GREEN 8/8. PyodideEngine 어댑터로 부팅 -> memory 능력을 계약(heapU8/stack) 위에 세움 -> src ReactiveController가 그 위에서 체크포인트/양방향 시간여행(cp0<->cp1, 델타 106p) 성립. 엔진 내부(`_module`,`globals`,`_emscripten_stack_*`) 직접 접근 0 | **계약 표면이 충분하다.** 발견: execSeq(실행 경계 카운터)도 계약의 일부다(우회 실행은 reactive가 힙 변이를 놓쳐 복원이 깨진다). 인터럽트 지원 보고(true) 성립 | src 승격: MemoryCapability가 engine을 받게 + engines/pyodideEngine.js. 동작 무변경 게이트 |
| 2026-07-13 | fsProbe | Edge headless | GREEN 10/10(승격 표면 `boot()`+`rt.fs`). utf8/binary 왕복 == 원본, mkdirTree 중첩, readdir(./.. 필터), stat isDir/isFile/size, exists, unlink/rmdir, 미존재 읽기 에러, **변이 시 execSeq++/읽기 불변**, **파이썬 open() <-> rt.fs 동일 FS**(from js/from py 교차) | **FS 계약(README 표면표의 `fs()`)이 실동.** 능력 레이어가 변이만 execSeq 상승 = 리액티브 가드 정합. 소비자 raw.FS 대체 성립 | 승격 -> `Runtime.fs`(FileSystem 능력) [engine-agnostic-surface](../../../mainPlan/_done/engine-agnostic-surface/README.md) |
| 2026-07-13 | outputCaptureProbe | Edge headless | GREEN 5/5. setStdout 핸들러 수신, **셀 도중 핸들러 교체 격리**(buf1은 두 번째 출력 안 받음), setStdout(null) 복원, stderr 분리 캡처 | **셀별 가변 싱크가 실동.** 스코프 헬퍼가 아니라 가변 싱크가 셀별 라이브 스트리밍의 정직한 프리미티브임을 실증 | 승격 -> `Runtime.setStdout/setStderr` |
| 2026-07-13 | loadImportsProbe | Edge headless | GREEN 3/3. stdlib-only 코드 무에러 no-op, **numpy가 import 문 스캔만으로 자동 로드(995ms) + 동작**(np.array sum==6) | **import 자동 로드 실동.** 소비자가 셀마다 명시 목록 없이 C확장 휠을 얻는다 | 승격 -> `Runtime.loadPackagesFromImports` |

## WASI 매핑 (계약이 non-Pyodide를 구현 가능한가 = D2 관문)

D2 조사([engine-independence](../../../mainPlan/_done/engine-independence/README.md)) 결과를 계약 메서드별로.

| 계약 메서드 | Pyodide | WASI 프리빌트(brettcannon) | emscripten 자가빌드 |
|---|---|---|---|
| runSync/runAsync | 직접 | stdin 프레임 드라이버(exec 루프). runAsync는 워커 경계로 흡수 | callMain REPL 또는 PyRun_SimpleString export |
| setGlobal/getGlobal | FFI 프록시 | **값 프로토콜로 강등**(JSON 직렬화, FFI 없음 - D2의 실제 비용) | 동일 |
| heapU8 | `_module.HEAPU8` | `exports.memory`(wasm ABI 강제, 자명) | 동일 |
| stackSave/stackRestore | `_emscripten_stack_*` | **미노출 -> null 반환**(복원은 페이지 델타로 성립, sp는 정합성 옵션) | export 플래그로 노출 |
| setInterruptBuffer | 지원(true) | 시그널 없음 -> false(워커 terminate = kill 의미론) | `Py_EmscriptenSignalBuffer` 업스트림 내장 |
| makeSnapshot | 지원 | memory.buffer 전체 복사(전망 양호, 미실측) | MEMFS 상태 복제 동반 |
| 결정적 부팅 | 엔트로피 3소스 스텁 | **더 깨끗**: `random_get` import 하나로 수렴, shim에서 고정 | JS 글루 표면 넓음 |

핵심 결론: 우리 보석(reactive/session/.pymachine)이 요구하는 것은 **heapU8 + 결정적 부팅**뿐이고 둘 다
WASI에서 성립(오히려 부팅 결정성은 더 깨끗). 벽은 값 다리(FFI)이고, 계약이 "값 프로토콜"을 기본으로
두면 우회된다. 스택 sp는 null 허용 계약이라 프리빌트에서도 복원이 선다.

## 판정

졸업 -> `src/runtime/engines/pyodideEngine.js`(EngineContract Pyodide 구현). MemoryCapability/Runtime이
계약을 경유하도록 리팩터(동작 무변경: 구조 298 + 브라우저 38 + 예제 4 GREEN). 엔진 접점이 8파일
40지점에서 **한 파일 뒤로** 격리됐다. 다음(별도 캠페인): D2 관문 = 이 계약을 non-Pyodide(WASI
CPython)가 구현해 reactive/session이 도는지 실측(값 프로토콜 재설계 + browser_wasi_shim vendoring).
