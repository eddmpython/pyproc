# enginePort - EngineContract를 non-Pyodide CPython이 구현할 수 있는가 (D2 관문)

캠페인 = engine-independence의 D2 관문. 정본: [engine-independence](../../../mainPlan/engine-independence/README.md),
계약 표면과 WASI 매핑 표: [engineContract](../engineContract/README.md).

## 가설

"Pyodide를 뗀다"의 실증 첫 관문은 **Pyodide가 아닌 CPython wasm이 우리 워커에서 부팅되어
코드를 실행하고, 계약의 코어(선형 메모리 + 결정적 부팅)가 성립하는 것**이다. WASI 빌드 +
vendored shim(의존성 0)으로 가능하다. 사다리: ① WLR 단일 파일(stdlib 내장 = 배선 0)로 shim
자체를 검증 ② brettcannon 3.14.6(zip stdlib 배선)으로 버전 정합 ③ 값 프로토콜(get/set) ④
reactive를 이 엔진 위에서(엔진 무관성의 최종 증명).

## 자산 (레포 자산 0 유지: 바이너리는 미추적, 아래 레시피로 재현)

- `browserWasiShim.js` = @bjorn3/browser_wasi_shim 0.4.2 번들(MIT OR Apache-2.0, 29KB, vendored):
  `curl -sL "https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.2/+esm" -o browserWasiShim.js`
- `pythonWasi.wasm` = WLR CPython 3.12.0 단일 파일(stdlib 내장 26MB, PSF/Apache-2.0, .gitignore로 미추적):
  `curl -sL -o pythonWasi.wasm "https://github.com/vmware-labs/webassembly-language-runtimes/releases/download/python%2F3.12.0%2B20231211-040d5a6/python-3.12.0.wasm"`
- `python-3.14.6.wasm` + `python314-stdlib.zip` = brettcannon/cpython-wasi-build(살아있는 소스, 3.14.6, python.wasm 30MB + 외부 stdlib, .gitignore로 미추적). 재현: 릴리즈 zip을 받아 `python.wasm`을 `python-3.14.6.wasm`으로, `lib/python3.14/` 내용을 deflate zip으로 묶어 `python314-stdlib.zip`(모듈이 zip 루트).
  `curl -sL -o cpy.zip "https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.14.6/python-3.14.6-wasi_sdk-24.zip"` 후 압축 해제 + `python -c "import zipfile,os; ..."`(모듈을 zip 루트로 재압축).

## 졸업 게이트

- 워커에서 WASI CPython 부팅 -> `print` 결과 회수(브라우저에서 non-Pyodide 파이썬 실행) = pass/fail
- 계약 코어: `exports.memory`(heapU8 등가) 접근 성립 = pass/fail
- **결정적 부팅**: `random_get`/`clock_time_get`을 shim에서 고정하면 두 부팅의 파이썬 가시 상태(해시/랜덤/시간)가 동일 = pass/fail
- 반복 실행(인터프리터 세워두고 코드 조각 N회) 성립 여부와 방식 기록(stdin 프레임 드라이버)

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-12 | wasiBootProbe | Edge headless, 로컬 COOP+COEP | GREEN 6/6. WLR CPython 3.12(WASI) 워커 부팅+print 253ms(Pyodide 콜드 ~3s 대비 빠름), exports.memory(heapU8 등가) 접근, json/sys 동작, **결정적 부팅 = 두 커널 파이썬 가시 상태 바이트 동일**(비결정 대조로 확인) | **"Pyodide를 뗀다"가 실측이 됐다.** 계약 코어 2축(선형 메모리 + 결정적 부팅)이 non-Pyodide에서 성립. WASI는 엔트로피가 import 2개로 수렴 = 더 깨끗한 결정성 | 값 프로토콜, 반복 실행, reactive 이식 |
| 2026-07-12 | wasiReplProbe | Edge headless, 로컬 COOP+COEP | GREEN 12/12. 반복 실행(상태 유지), 값 프로토콜 양방향(get/set, FFI 없이), 결정적 부팅+반복 실행, **엔진 선형 메모리 위 완전 시간여행**(체크포인트 10MB -> 변이 v=200/big 2MB -> 복원 -> 복원 후 파이썬이 정확히 체크포인트 상태 v=100으로 재개 -> 분기 v=999) | **pyproc 프리미티브(반복 실행/값 다리/완전 시간여행)가 non-Pyodide 위에서 완전히 성립.** 파이썬 엔진은 pyproc 소유(wasiReplDriver.py). 돌파한 벽 4(compile 스택/UTF-8 argv/Fd 초기화/**완전 상태복귀**) | WasiEngine 승격 |
| 2026-07-13 | wasiUpgradeProbe | Edge headless, 로컬 COOP+COEP | RED 7/9(부분 성립). **brettcannon CPython 3.14.6 부팅 79ms**(죽은 WLR 3.12 소스 이전), stdlib를 `/lib/python3.14` loose 파일 preopen으로 마운트(shim readdir 서빙, zlib 부재라 JS DecompressionStream으로 언집), **결정적 부팅 성립**(두 3.14.6 커널 random 스트림 동일), **체크포인트 성립**(40MB). 그러나 **시간여행 복원 후 재개가 트랩**(`RuntimeError: memory access out of bounds`) | **소스 이전의 코어는 성립(부팅/버전/stdlib/결정성/체크포인트) = 3.12 동결 해제.** 그러나 WASI 전체-힙 시간여행 복원이 WLR 3.12에선 살아남고 3.14.6에선 트랩. wasm이 `memory`/`_start`만 export(레이아웃 심볼 없음), global 0 파싱으로 heapBase=16MB 얻어 heap-only 복원 시도했으나 여전히 트랩(_PyRuntime 정적 데이터 + 힙 + 라이브 스택 삼자 정합 문제). 시간여행의 버전 이식은 깊은 엔진 연구 = per-version 실작업 | 스택 인지 복원(정적+힙 복원, 라이브 스택 보존) 캠페인. 그때까지 src 이전 보류(wasiGate 시간여행 회귀 방지) |

## 돌파한 벽 (실측으로 특정 + 해결)

- **완전 상태복귀(가장 어려운 것) - 해결**: 힙 복원이 파이썬 stdin 입력 스트림 상태(누적 바이트)를 되돌려 복원 후 재개가 어긋났다(실측: 명령이 3바이트 밀림). 근본 원인은 WASI FFI 부재 - Pyodide는 FFI로 코드를 힙에 직접 주입해 입력 스트림이 없지만, WASI는 stdin 경유라 입력 상태가 힙에 결합. **값 채널 무상태화로 뚫었다**: 코드는 preopen 파일 `/cmd`(힙 밖 = 복원 무관), stdin은 실행 신호 1바이트(무상태 = 복원 시점에 어긋날 상태 없음). 이로써 복원 후 파이썬이 정확히 체크포인트 상태로 재개하고 분기까지 성립.
- **compile 스택 초과**: 반복 루프 프레임 위 명시적 compile()이 wasm C 스택 초과 -> exec(str) 직접(내부 컴파일은 C 레벨).
- **argv UTF-8**: 한글 주석을 -c로 실으면 args 처리 크래시 -> 드라이버/코드를 preopen 파일로 전달.
- **Fd stdin 초기화**: Fd 부분 구현 stdin은 fdstat/seek 조회에서 깨짐 -> OpenFile 상속 + fd_fdstat_get.

## 남은 벽 (진짜)

- **스택 sp 미노출**: WASI 프리빌트는 emscripten_stack_* 미노출(null 계약으로 흡수, 경계 스냅샷이 스택 영역을 포함하므로 경계-대-경계 복원은 성립 - 완전 시간여행이 이를 실증).
- **네이티브 확장**: 정적 링크(dlopen 없음). PEP 783 휠은 Pyodide ABI 대상.

## 판정

**졸업 -> src (2026-07-12).** `src/runtime/engines/wasi/`(wasiSession/wasiWorker/wasiReplDriver/wasiProtocol
/browserWasiShim). 공개 표면 `bootWasi`/`WasiSession`(async run/get/set + checkpoint/timeTravel).
전문 에이전트 설계로 **별도 async 표면**(Runtime에 끼우지 않음 = 소비자 무영향, 8함정 회피). 실배선
게이트 tests/browser/wasiGate.html GREEN 6/6(부팅 122ms, 값 다리, 완전 시간여행 재개+분기). shim은
라이선스 고지 후 커밋, wasm은 wasmURL 소비자 제공. 이 캠페인은 승격 완료로 다음 정리 시 폴더 삭제 대상
(기록은 이 원장 + git). 잔여(v2): reactive 페이지-델타 트리의 워커-내 재사용(현 v1은 전체-힙 스냅샷).
