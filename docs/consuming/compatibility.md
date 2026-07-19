# 환경 호환성 - 한 장

소비 제품이 "우리 대상 환경에서 pyproc의 어느 표면을 켤 수 있는가"를 한 번에 읽는 표다.
런타임 판정은 `checkEnvironment()`가 돌려주고(아래 코드와 1:1), 여기 값은 그 판정의 근거다.
능력별 상세(제품 가치·상태·경계)는 [capabilityMatrix.md](capabilityMatrix.md)가 정본이다.

## 지원 브라우저

**Chromium / Edge 전용.** Firefox / Safari 미지원은 결함이 아니라 스코프 선택이다(JSPI +
SharedArrayBuffer + `crossOriginIsolated`를 셋 다 요구하는 능력이 있고, 그 조합이 Chromium
계열에서만 성립한다).

| 항목 | 요건 | 없으면 |
|---|---|---|
| 기본 실행(`boot`/`run`/`loadPackages`/`checkEnvironment`/reactive) | Chromium 계열 브라우저. 헤더 불필요 | Firefox/Safari에서 미지원 |
| JSPI (`WebAssembly.Suspending`) | Chrome/Edge 137+ (137부터 기본 활성) | terminal blocking input, subprocess, syscall bridge, ASGI 동기 경로가 안 뜬다 (`checkEnvironment().jspi === false`, 코드 `no-jspi`) |
| SharedArrayBuffer + `crossOriginIsolated` | 페이지에 `COOP: same-origin` + `COEP: require-corp` 헤더 | 프로세스 OS(`machine.proc`), fork/map, 소켓, 인터럽트가 안 뜬다 (`checkEnvironment().sharedArrayBuffer === false`, 코드 `no-cross-origin-isolation`) |
| same-origin worker 자산 | worker graph를 same-origin에 두고 SRI 검증(`pyproc/assets`) | CDN URL만으로 worker를 여는 것은 브라우저 same-origin 정책이 막는다 |

`checkEnvironment()` 반환: `{ ok, crossOriginIsolated, sharedArrayBuffer, jspi, issues }`.
`issues[]`의 각 항목은 `{ code, need, why, fix }`다. 제품은 능력을 켜기 전에 이 결과를 처리한다.

## 능력별 필수 조건 요약

| 능력 묶음 | Chromium | JSPI | COOP/COEP (SAB) | 비고 |
|---|:---:|:---:|:---:|---|
| Python 실행, 패키지, 파일 IO, 체크포인트/복원/시간여행 | 필요 | - | - | 헤더 없이 `npm install`만으로 동작 |
| 터미널, 빌린 syscall, subprocess, 커널 내 ASGI 서버 | 필요 | 필요 | - | 동기 blocking 경로가 JSPI에 의존 |
| 프로세스 OS(fork/forkMany/map/mapArray/matmul), 소켓, 인터럽트, 멀티탭 영속(SAB 능력) | 필요 | 필요 | 필요 | `crossOriginIsolated` 하에서만 |

## 엔진

- **Pyodide v314.0.2 (CPython 3.14).** 기본 CDN 로드, 셀프 호스팅 가능(`indexURL`).
  버전 변경은 릴리즈 사유이며 소비 제품과 동시 이동한다(상세: [contract.md](contract.md) 런타임 정합).
- WASI 엔진(`pyproc/wasi`)은 엔진 무관 실증용 별도 async 표면이다(프로덕션 정본은 Pyodide).

## 자원 특성 (제품이 힙 규모를 정할 때)

- **체크포인트 경계 비용은 O(heap)이다.** WASM은 mprotect/dirty-page가 없어 실행 경계마다
  힙 전 페이지를 완전 해시해 델타를 재구성한다(그 완전성이 복원 soundness의 조건이다).
  즉 경계 하나의 해시 비용은 힙 크기에 비례한다. 이 비용을 지배하는 것은 힙 크기 자체가
  아니라 **커밋 빈도**다(churnProbe 법칙): 문장마다 커밋하면 힙 전체를 매번 훑는다.
- **peak memory는 base 상주 + 델타 누적이다.** 복원 리액티브의 base(힙 전체 사본)가 RAM에
  상주하고 체크포인트 델타가 누적된다. 배출 밸브는 `history.prune`(`pruneTo`)와 `dispose`,
  base 오프로드는 `saveBase`(OPFS로 이동, RAM은 복원 경로 전제상 안 줄어든다).
- **프로세스 OS는 워커마다 독립 인터프리터 = 독립 힙이다.** N 워커 = N개의 독립 파이썬 힙이
  실메모리를 쓴다(그 대가로 N개 독립 GIL = 물리 병렬). 스냅샷-fork는 초기 상태를 SAB로
  공유해 워커당 전체 복사를 피하지만, 워커가 갈라진 뒤의 상태는 각자 소유한다.
- 큰 힙(수백 MB 이상)과 저사양/모바일 실측치는 공개 표면에 걸지 않는다(숫자 자랑 금지).
  각자 기계에서 [Speed Lab](../../examples/speedLab.html)으로 잰다. 개발 실측은
  [benchmarking.md](../operations/benchmarking.md)와 원장·artifact에 산다.

관련 부채·트레이드오프의 상시 추적은 [contractReality.md](../operations/contractReality.md)다.
