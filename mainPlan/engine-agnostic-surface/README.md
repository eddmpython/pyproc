# engine-agnostic-surface - 소비자가 raw를 버리게 하는 엔진-무관 능력 3건

> 이니셔티브 인덱스. 상세는 번호 문서. 재개는 [03-progress-ledger.md](03-progress-ledger.md)의 NEXT부터.

## 한 줄

dartlab이 pyproc 노트북 런타임을 완전 채택하려면 아직 `rt.raw`(Pyodide 특정 표면)로 손대는 3가지를 엔진-무관 능력으로 노출해야 한다. 이걸 닫으면 **첫 실제 소비 제품이 Runtime + 능력만으로 돌아 engine-independence가 실증된다.**

## 무엇 (실측 카운트: dartlab 워커 실사용)

| # | 갭 | 지금(raw) | 실사용 |
|---|---|---|---|
| 1 | 셀 import 자동 패키지 로드 | `raw.loadPackagesFromImports` | 셀마다 |
| 2 | 일반 파일 IO | `raw.FS.*` (writeFile/readFile/mkdir/readdir/stat/unlink...) | 19회 |
| 3 | 실행 출력 캡처(셀별 교체) | `raw.setStdout/setStderr` | 각 1회 |

전부 기존 위임 규약([runtime.js](../../src/runtime/runtime.js)의 `loadPackages`/`setInterruptBuffer`)에 올라탄다. 비브레이킹(새 메서드 추가, 기존 표면 무변경).

## 문서

- [00-product-vision.md](00-product-vision.md) - 무엇을/누구를/왜, 스코프, 성공·실패, 정직한 WASI 경계.
- [01-architecture.md](01-architecture.md) - 3건 설계, 엔진-무관 계약, FS 능력 모양, 인코딩 계약, DeviceFs 관계.
- [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - phase 분해, 소비 배선(dartlab raw 제거), 게이트, 롤백.
- [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장, 재개 지점(NEXT).

## 왜 지금

engine-independence(P1 EngineContract seam)가 [_done](../_done/engine-independence/README.md)으로 닫혔고, [runtime.js:151](../../src/runtime/runtime.js#L151)의 `raw` 주석이 이미 "미이관 접점(deviceFs의 FS 등)용"이라 스스로 이 갭을 인정한다. 소비자가 당긴 응집된 한 덩어리 = 계약을 넓히기에 정확한 시점.
