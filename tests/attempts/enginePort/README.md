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

## 졸업 게이트

- 워커에서 WASI CPython 부팅 -> `print` 결과 회수(브라우저에서 non-Pyodide 파이썬 실행) = pass/fail
- 계약 코어: `exports.memory`(heapU8 등가) 접근 성립 = pass/fail
- **결정적 부팅**: `random_get`/`clock_time_get`을 shim에서 고정하면 두 부팅의 파이썬 가시 상태(해시/랜덤/시간)가 동일 = pass/fail
- 반복 실행(인터프리터 세워두고 코드 조각 N회) 성립 여부와 방식 기록(stdin 프레임 드라이버)

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-12 | wasiBootProbe | Edge headless, 로컬 COOP+COEP | GREEN 6/6. WLR CPython 3.12(WASI) 워커 부팅+print 253ms(Pyodide 콜드 ~3s 대비 빠름), exports.memory(heapU8 등가) 접근, json/sys 동작, **결정적 부팅 = 두 커널 파이썬 가시 상태 바이트 동일**(비결정 대조로 확인) | **"Pyodide를 뗀다"가 실측이 됐다.** 계약 코어 2축(선형 메모리 + 결정적 부팅)이 non-Pyodide에서 성립. WASI는 엔트로피가 import 2개로 수렴 = 더 깨끗한 결정성 | 값 프로토콜, 반복 실행, reactive 이식 |
| 2026-07-12 | wasiReplProbe | Edge headless, 로컬 COOP+COEP | GREEN 10/10. 인터프리터를 세워두고 반복 실행(상태 유지 x=41->+1->42), 값 프로토콜 양방향(get/set, FFI 없이), 결정적 부팅+반복 실행, **엔진 선형 메모리 위 힙 시간여행**(경계 체크포인트 10MB -> 변이 -> 복원이 2페이지 되돌림) | **pyproc 프리미티브(반복 실행/값 다리/힙 시간여행)가 non-Pyodide 위에서 성립.** 파이썬 엔진 드라이버는 pyproc 소유(wasiReplDriver.py). 돌파한 벽 3(compile 스택/UTF-8 argv/Fd 초기화) | 복원 후 재개(값 채널을 stdin과 분리), WasiEngine 승격 |

## 정직한 벽 (실측으로 특정)

- **복원 후 파이썬 재개**: 힙 전체 복원이 stdin BufferedReader 상태까지 되돌려 다음 readline이 깨진다(드라이버가 stdin REPL이라 값 채널과 힙이 결합). 완전한 시간여행 재개는 값 전달을 stdin과 분리하는 채널(preopen 파일/공유 메모리)이 전제. 힙 스냅샷/복원 자체는 성립.
- **스택 sp 미노출**: WASI 프리빌트는 emscripten_stack_* 미노출(null 계약으로 흡수, 경계 스냅샷이 스택 영역을 포함하므로 경계-대-경계 복원은 성립).
- **네이티브 확장**: 정적 링크(dlopen 없음). PEP 783 휠은 Pyodide ABI 대상.
- **argv UTF-8**: 한글 주석을 -c로 실으면 크래시. 소스는 파일로 전달(회피 확정).

## 판정

진행 중 (2관문 졸업: non-Pyodide 부팅 + 계약 코어 2축 + 반복 실행/값 프로토콜/힙 시간여행 GREEN).
"Pyodide를 뗀다"의 개념+프리미티브 실증 완료. 승격 경로 = EngineContract에 WasiEngine 구현 추가 ->
`boot({engine})` 옵션화. 그 전 남은 실측: 값 채널 분리(복원 후 재개), preopen 기반 값 다리.
