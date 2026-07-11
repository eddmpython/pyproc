# syscallBridge - 브라우저에 없는 시스템콜을 실제로 빌릴 수 있나 (스텁 탈피)

## 가설

1. `input()`은 JS 동기 핸들러(FFI 동기 호출)로 어디서나, 비동기 핸들러는 JSPI `callSyncifying`으로 runAsync 경로에서 빌릴 수 있다.
2. HTTP 계층의 socket 수요(urllib)는 동기 XHR로 파이썬의 동기 시맨틱 그대로 빌릴 수 있다(x-user-defined 트릭으로 바이너리 보존).
3. `subprocess.run(["python","-c",code])`은 자식 워커의 독립 인터프리터 + JSPI로 빌릴 수 있다.

## 졸업 게이트

- 필수: (a) 동기 `input()`이 핸들러 문자열을 반환, (b) `urllib.request.urlopen`이 실제 HTTP GET으로 본문을 읽음. 이 둘이 브라우저 실측 PASS면 v1 승격.
- 능력 보고(정보성): JSPI 가용 여부, 비동기 input(callSyncifying) 동작 여부, subprocess 동작 여부. 실패해도 v1 졸업을 막지 않되 결과를 기록하고 미가용 경로는 명확한 예외로 남긴다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-11 | diag(임시) | Edge headless | v314에 `callSyncifying` 없음(AttributeError). 대신 `pyodide.ffi.run_sync` 존재, runAsync 맥락에서 `can_run_sync()=True` | JSPI 경로 = run_sync. 호출 시점 판정으로 설계 변경 | BOOTSTRAP 수정 |
| 2026-07-11 | probe.html | Edge headless | 동기 input PASS, urllib 실 GET("# pyproc", 200) PASS, JSPI 비동기 input 동작, subprocess(자식 워커) 동작 2007ms | 필수 + 능력 3종 전부 실동작 | src 승격(v1) |

## 판정

졸업 -> `src/capabilities/syscallBridge.js` v1 실배선: `input()`(동기 핸들러 + JSPI run_sync 비동기 핸들러), `urllib.request.urlopen`(동기 XHR, x-user-defined 바이너리, proxyUrl 옵션), `subprocess.run(["python","-c",code])`(자식 워커, runAsync 경로). 저수준 socket 자체는 프론티어로 남음(로드맵).
