# 01. 아키텍처 - 3건 설계와 엔진-무관 계약

## 위임 규약 (기존 패턴에 정합)

세 능력 전부 `Runtime -> this._engine(EngineContract) -> 엔진 네이티브`로 단방향 위임한다. 기존 [`loadPackages`/`setInterruptBuffer`](../../src/runtime/runtime.js#L123)와 동일 계층. 계약은 중립 어휘로 쓰고, 각 엔진이 자기 네이티브로 매핑한다(계약이 Pyodide 어휘로 굳지 않게).

```
소비자 -> Runtime.fs / loadPackagesFromImports / setStdout
            -> PyodideEngine.fs / loadPackagesFromImports / setStdout
                 -> _py.FS / _py.loadPackagesFromImports / _py.setStdout
```

## 1. loadPackagesFromImports(code)

- **EngineContract(PyodideEngine)**: `async loadPackagesFromImports(code) { return this._py.loadPackagesFromImports(code); }`.
- **Runtime**: `async loadPackagesFromImports(code) { this.execSeq++; return this._engine.loadPackagesFromImports(code); }`.
- **WASI degradation**: import 정적 스캔 불가 = no-op(빈 결과). 소비자는 명시 `loadPackages(pkgs)` 폴백.

## 2. FileSystem 능력 (Runtime.fs)

핵심 설계 결정 3가지:

1. **`enableFs()` opt-in이 아니라 `Runtime.fs` 상시 능력**. FS는 GPU/reactive 같은 선택적 무거운 능력이 아니라 코어다. [`this.memory`](../../src/runtime/runtime.js#L111)와 동급으로 constructor에서 eager 인스턴스화. 미지원 엔진이면 메서드 호출 시 실행 가능한 에러(부팅은 안 깨짐).
2. **엔진은 중립 파사드 `fs`를 노출**(Pyodide FS 모양을 계약에 새지 않게). PyodideEngine의 `get fs()`가 `_py.FS`에서 중립 op 객체를 1회 빌드해 캐시. 계약 어휘 = writeFile/readFile/mkdir/mkdirTree/readdir/stat/exists/unlink/rmdir.
3. **능력 레이어가 execSeq를 올린다**(그냥 pass-through가 아닌 이유). FS 변이(write/mkdir/unlink/rmdir)는 실행 경계라 리액티브 가드 근거다([deviceFs.js:61](../../src/capabilities/deviceFs.js#L61)가 이미 이 규약). 읽기(read/readdir/stat/exists)는 execSeq 불변.

### 인코딩 계약 (실측으로 못 박을 지점)

- `writeFile(path, data, opts?)`: `data`가 문자열이면 utf8, `Uint8Array`면 binary(opts.encoding으로 명시 가능).
- `readFile(path, opts?)`: 기본 binary(`Uint8Array`) 반환. `{encoding: "utf8"}`면 문자열. (Pyodide `FS.readFile`의 encoding 계약에 직결.)
- `stat(path)`: 중립 `{ size, isDir, isFile, mtimeMs }`(Pyodide `FS.isDir/isFile(mode)`로 파생).
- `readdir(path)`: `.`/`..` 필터링한 이름 배열.
- `exists(path)`: `FS.analyzePath(path).exists` 불리언.
- posix 이름(mkdir/readdir/rmdir/unlink/stat)은 외부 기술 어휘라 원어 유지(camelCase 가드 무충돌). writeFile/readFile/mkdirTree는 camelCase 정합.

## 3. setStdout(handler) / setStderr(handler)

- **가변 싱크를 고른다**(스코프 헬퍼 아님). 셀별 **라이브 스트리밍**은 실제로 가변 싱크가 필요하다(긴 셀 도중 출력을 흘려야지 종단 캡처가 아님). Pyodide `setStdout({batched: handler})`에 1:1.
- **EngineContract(PyodideEngine)**: `setStdout(handler) { handler == null ? this._py.setStdout() : this._py.setStdout({ batched: handler }); }` (setStderr 대칭).
- **Runtime**: `setStdout(handler) { return this._engine.setStdout(handler); }`.
- **계약**: handler가 문자열 청크 수신. `null` 전달 = 기본 복원. 과설계가 아니라 스트리밍의 정직한 프리미티브.
- **WASI degradation**: stdout 프로토콜로 회수([pyodideEngine.js:15](../../src/runtime/engines/pyodideEngine.js#L15) 주석의 경로).

## DeviceFs 관계 (실제 코드 검토 후 판정: 이관 안 함)

착수 전엔 "DeviceFs의 파일-op raw도 파사드로 닫자"였으나, [deviceFs.js](../../src/capabilities/deviceFs.js) 실제 검토 결과 판정을 뒤집는다. DeviceFs의 `this._rt.raw.FS`는 **핵심이 장치 등록**(`registerDevice`/`makedev`/`mkdev`)이고 이는 파일 IO가 아니라 별개 엔진 seam이라 이 이니셔티브 밖이다([runtime.js:151](../../src/runtime/runtime.js#L151)이 명시적으로 축복하는 raw 용처). 부수적 파일-op(`mkdir`/`mkdirTree`/`unlink`)도 device 등록과 **한 함수(`_mk`)에 얽혀** 있어, 그것만 파사드로 떼면 한 함수가 `fs` 파사드 + raw device API를 섞는 혼합 API가 된다 = 부분 이관이 오히려 열화(덕지덕지 금지). 따라서 **DeviceFs는 raw를 장치-등록 seam으로 유지**한다. **소비자(dartlab)의 raw 제거는 `Runtime.fs`로 완전히 성립**하며, 그게 이 이니셔티브의 목표다(우리 내부 device seam이 아니라 소비 코드의 파일 IO).

## 검증 접지 (engineContract 캠페인)

[tests/attempts/engineContract/](../../tests/attempts/engineContract/)는 EngineContract를 검증한 집(contractProbe 8/8). 여기에 probe 3개 추가: `fsProbe`(바이너리/utf8 왕복, mkdirTree, readdir 필터, stat.isDir, unlink/rmdir, 미존재 에러), `outputCaptureProbe`(핸들러 수신 + 셀별 교체 + null 복원), `loadImportsProbe`(stdlib no-op 무에러 + 실 패키지 import 성립).
