# 00. 제품 비전 - 무엇을, 누구를 위해, 왜

## 한 문장

**소비자가 `rt.raw`(엔진 탈출구)를 완전히 버리고 pyproc Runtime + 능력만으로 노트북을 돌린다.** 그러면 엔진을 갈아도(WASI 등) 소비 코드가 그대로 돈다 = engine-independence가 말이 아니라 실측으로 선다.

## 누구를 위해

- **1차 소비자 = dartlab**(라이브 채택 중). AsgiServer(browser-as-server) 채택 완료, 동기 XHR 바이트 복원은 0.0.8로 upstream 완료. 남은 걸림돌이 이 3건의 raw 접점이다.
- **codaro·xlpod도 동일**. 노트북/실행 표면을 얹는 모든 소비자가 파일 IO·패키지 자동로드·출력 캡처를 필요로 한다.

## 스코프 (무엇인가 / 무엇이 아닌가)

**이 이니셔티브다:**
- `Runtime.loadPackagesFromImports(code)` - 셀 코드 import 스캔 자동 패키지 로드.
- `Runtime.fs` - 엔진-무관 일반 파일 IO 능력(writeFile/readFile/mkdir/mkdirTree/readdir/stat/exists/unlink/rmdir).
- `Runtime.setStdout(handler)`/`setStderr(handler)` - 실행 출력 캡처(셀별 가변 싱크).
- 전부 `this._engine`에 위임(엔진-무관). 비브레이킹. 우리 내부(`DeviceFs`)의 파일-op raw 사용도 같이 이관.

**이 이니셔티브가 아니다:**
- OPFS 영속의 재발명. 영속은 이미 [`mountHome`/`mountDir`](../../src/runtime/runtime.js#L146)(mountNativeFS)가 한다. 이건 **마운트된 FS 위 파일-op 레이어**지 새 VFS가 아니다(덕지덕지 금지).
- 장치 등록(registerDevice/makedev/mkdev). 그건 파일 IO가 아니라 별개 엔진 seam = DeviceFs의 몫으로 남는다.
- 체크포인트. [ReactiveController](../../src/capabilities/reactive.js)(나무·분기·64bit·OPFS)가 dartlab CheckpointGraph보다 상위 = 소비자가 id/savedSP 어댑터로 채택. pyproc 추가 작업 없음(소비자 요청도 없음).
- 스코프 밖 FS 확장(chmod/symlink/rename 등). dartlab 실사용 8op만. 요구가 서면 그때.

## 정직한 WASI 경계

이 3건은 **오늘 Pyodide에서 실동 + WASI는 정직한 degradation**이다. WASI 엔진은 아직 EngineContract에 FS/패키지/stdout이 배선 안 됐다(prebuilt 트랙). 그러니 "WASI에서도 dartlab이 그대로 돈다"는 **계약상 목표**지 오늘의 실측이 아니다. 각 능력은 미지원 엔진에서 실행 가능한 에러 또는 no-op(정직 degradation, 기존 `setInterruptBuffer=false`/`stackSave=null`과 같은 급). WASI 실동 parity는 WASI가 계약에 배선되고 실측될 때 성립한다.

## 성공 / 실패 기준

- **성공**: dartlab 워커가 `rt.raw`를 0회 참조하고 Runtime + `rt.fs` + 출력 캡처 + import 자동로드만으로 셀을 실행한다. pyproc 내부(DeviceFs)도 파일-op raw를 안 쓴다. npm test + 브라우저 게이트 green. 비브레이킹(기존 소비자 무변경).
- **실패**: 능력이 실측 없이 표면만 늘거나(engineContract probe 없이 승격), FS 인코딩 계약(utf8/binary)이 소비자 실사용에서 깨지거나, `raw`를 못 버려 갭이 남는 것.
