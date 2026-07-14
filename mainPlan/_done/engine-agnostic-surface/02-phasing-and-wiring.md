# 02. phasing과 배선 - 게이트, 소비, 롤백

## Phase 분해

| Phase | 내용 | 게이트(GREEN 조건) |
|---|---|---|
| P1 접지 | engineContract에 fsProbe/outputCaptureProbe/loadImportsProbe. 실 브라우저에서 계약 실동 | 3 probe GREEN(FS 바이너리/utf8 왕복 == 원본, 셀별 출력 교체 격리, import 자동로드 성립) |
| P2 승격 | EngineContract(fs 파사드 + loadPackagesFromImports + setStdout/setStderr) + FileSystem 능력 + Runtime 위임 | 구조 게이트 + 브라우저 런타임 게이트 green |
| P3 DeviceFs 판정 | 실제 코드 검토: DeviceFs raw는 장치-등록 seam으로 정당(파일-op도 `_mk` 한 함수에서 device 등록과 얽혀 분리 시 혼합 API = 열화). 이관 안 함 | 판정 기록, 코드 무변경 |
| P4 소비 실증 | dartlab 워커가 raw 3접점 제거, 커밋 SHA 핀 채택 | dartlab 노트북이 raw 0 참조로 실동(소비자 측 검증) |

릴리즈(0.0.9 후보)는 P2~P3 green 후 **명시 지시가 있을 때만**. dartlab은 SHA 핀이라 릴리즈 전에도 커밋 SHA로 채택 가능(P4는 릴리즈 비의존).

## 소비 배선 (dartlab raw 제거 매핑)

| dartlab 워커 현재 | 이관 후 |
|---|---|
| `rt.raw.loadPackagesFromImports(code)` | `rt.loadPackagesFromImports(code)` |
| `rt.raw.FS.writeFile(p, s)` | `rt.fs.writeFile(p, s)` |
| `rt.raw.FS.readFile(p, {encoding})` | `rt.fs.readFile(p, {encoding})` |
| `rt.raw.FS.mkdirTree(p)` | `rt.fs.mkdirTree(p)` |
| `rt.raw.FS.readdir(p)` | `rt.fs.readdir(p)` (`.`/`..` 이미 필터) |
| `rt.raw.FS.stat(p)` + `FS.isDir(mode)` | `rt.fs.stat(p).isDir` |
| `rt.raw.FS.analyzePath(p).exists` | `rt.fs.exists(p)` |
| `rt.raw.FS.unlink/rmdir(p)` | `rt.fs.unlink/rmdir(p)` |
| `rt.raw.setStdout({batched})` | `rt.setStdout(handler)` |

단방향(products -> pyproc). 공개 표면 + `index.d.ts`만 의존.

## 롤백

전부 **새 메서드 추가 = 비브레이킹**이라 롤백 = 메서드 제거(기존 소비자 무영향). P3는 판정만(코드 무변경)이라 롤백 대상 없음. 계약 파손 위험 0.

## 산출물 표면

- src: [pyodideEngine.js](../../../src/runtime/engines/pyodideEngine.js)(fs/loadPackagesFromImports/setStdout/setStderr), [runtime.js](../../../src/runtime/runtime.js)(Runtime.fs/위임 3), `src/runtime/fileSystem.js`(신규 FileSystem 능력). DeviceFs는 무변경(장치-등록 seam).
- 표면: index.js/index.d.ts(FileSystem export + Runtime 메서드 타입), tests/run.mjs(export + 메서드 가드), README 2종(능력 표에 Runtime.fs 행).
- 접지: tests/attempts/engineContract/(probe 3 + README 결론 표).
