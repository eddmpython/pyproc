# 03. 진행 원장 - 결정 기록과 재개 지점

목적: 현재 결정, 그 출처, 문서 상태, NEXT. 세션 재개 시 여기부터 읽는다.

## 결정 원장 (최신이 위)

### 2026-07-13 완결: v0.0.9 릴리즈 + _done 이관

- pyproc 측 3능력을 릴리즈했다(**v0.0.9**, package.json 0.0.8 -> 0.0.9 + 태그 v0.0.9 + GitHub Release + npm publish 워크플로). 소비는 **npm 버전 핀**(`"pyproc": "0.0.9"`) = 소비자가 SHA 핀 대신 npm으로 쓰기로 확정.
- 이니셔티브를 `mainPlan/_done/engine-agnostic-surface/`로 이관. pyproc이 할 수 있는 건 다 했다(능력 승격 + 검증 + 릴리즈).
- **남은 P4는 소비자 측(pyproc 밖)**: dartlab 워커가 raw 3접점을 `rt.loadPackagesFromImports`/`rt.fs.*`/`rt.setStdout`으로 교체(매핑 [02-phasing](02-phasing-and-wiring.md)). 성공 기준의 "raw 0 참조"는 dartlab이 채택을 마치면 성립. pyproc은 더 할 게 없어 완결로 닫는다.

### 2026-07-13 P1~P3 완료: 3능력 승격 + 실 브라우저 GREEN + DeviceFs 판정

- **P1 접지(engineContract 실 브라우저)**: fsProbe **GREEN 10/10**(utf8/binary 왕복 == 원본, mkdirTree, readdir ./.. 필터, stat isDir/isFile/size, unlink/rmdir, 미존재 에러, **변이 시 execSeq++/읽기 불변**, **파이썬 open() <-> rt.fs 동일 FS** from js/from py 교차), outputCaptureProbe **GREEN 5/5**(핸들러 수신 + 셀 도중 교체 격리 + null 복원 + stderr 분리), loadImportsProbe **GREEN 3/3**(stdlib no-op + numpy가 import 스캔만으로 995ms 자동 로드 + 동작).
- **P2 승격**: EngineContract(pyodideEngine)에 `loadPackagesFromImports`/`setStdout`/`setStderr`/`get fs`(중립 파사드) 추가. `FileSystem` 능력 신규(src/capabilities/fileSystem.js, 변이만 execSeq 상승). Runtime에 `this.fs` 상시 + 위임 3. index.js/index.d.ts(FileSystem export + Runtime 타입)/run.mjs(export + 메서드 가드)/README 2종.
- **P3 DeviceFs 판정(착수 전 계획 뒤집음, 정직)**: 실제 코드 검토 결과 DeviceFs의 raw.FS는 핵심이 장치-등록(`registerDevice`/`makedev`/`mkdev`) = 파일 IO 아닌 별개 seam(runtime.js:151이 축복). 부수 파일-op도 `_mk` 한 함수에서 device 등록과 얽혀, 분리 시 혼합 API = 열화. **이관 안 함.** 소비자 raw 제거는 `Runtime.fs`로 완전 성립(우리 device seam이 아니라 소비 코드 목표).
- **정합 발견**: engineContract README 계약 표면표가 이미 `fs()`를 FS 계약으로 예정해뒀다 = 이 승격이 그 예정 계약의 실현. 비브레이킹(새 메서드/능력만).

### 2026-07-13 이니셔티브 개시: dartlab 채택이 당긴 엔진-무관 능력 3건

- dartlab이 pyproc 노트북 런타임을 채택 중이고(AsgiServer 라이브 + XHR 바이트 복원 0.0.8 upstream 완료), 남은 raw 접점 3건(실측: FS 19회, loadPackagesFromImports 2회, setStdout/setStderr 각 1회)을 엔진-무관 능력으로 노출하는 소비자-당김 이니셔티브로 개시.
- **정합성·ROI 재검(무비판 착수 금지)**: (a) 코드가 이미 갭을 인정([runtime.js:151](../../../src/runtime/runtime.js#L151) raw 주석 "deviceFs의 FS 등"), (b) engine-independence(_done)의 존재 이유 = 실 소비자가 raw를 버리는 실증인데 이게 그 첫 사례, (c) 기존 위임 규약에 정확히 정합(신규 개념 리스크 낮음), (d) 비브레이킹. **판정: 착수 정당.**
- **핵심 설계 결정**: FS는 `enableFs()`가 아니라 `Runtime.fs` 상시 능력(memory와 동급, 코어라 항상). 엔진은 중립 `fs` 파사드 노출(계약이 Pyodide FS 모양으로 안 굳게). 능력 레이어가 변이 시 execSeq 상승(리액티브 가드). setStdout는 스코프 헬퍼가 아니라 가변 싱크(셀별 라이브 스트리밍이 실제로 필요). 상세 [01-architecture](01-architecture.md).
- **스코프 규율**: OPFS 영속은 이미 mountHome이 하므로 재발명 금지 = 마운트된 FS 위 파일-op 8개만. 장치-등록(registerDevice 등)은 별개 seam이라 DeviceFs raw에 남긴다. 체크포인트는 소비자 요청 없음 + ReactiveController 상위라 추가 작업 0.
- **정직한 WASI 경계**: 오늘 Pyodide 실동 + WASI는 정직 degradation(미지원 에러/no-op). "WASI에서도 dartlab이 그대로"는 계약 목표지 오늘 실측 아님. WASI 배선·실측은 후속.

### NEXT

- P1~P3 완료(위 엔트리). 구조 게이트 + 브라우저 런타임 게이트 green 확인 후 커밋.
- **P4(소비자 측, pyproc 밖)**: dartlab 워커가 raw 3접점을 `rt.loadPackagesFromImports`/`rt.fs.*`/`rt.setStdout`으로 교체(배선 매핑 [02-phasing](02-phasing-and-wiring.md)), 커밋 SHA 핀 채택. raw 0 참조 확인 시 이니셔티브 완결 -> `_done` 이관.
- **릴리즈 0.0.9**: 비브레이킹 신 표면이라 소비자-싱크 순간이지만 **명시 지시가 있을 때만**. dartlab은 SHA 핀이라 릴리즈 전에도 채택 가능.
- **후속(별개)**: WASI 엔진을 계약에 배선하고 fs/imports/stdout 실측 = "WASI에서도 그대로"의 실증(오늘은 정직한 degradation).
