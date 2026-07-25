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

### 리액티브 메모리 압박 완화 가이드 (워크로드별)

이 가이드는 현재의 운영 제약을 가정한다. 메모리 스파이크의 핵심은 `checkpoint()` 비용보다도
**커밋 빈도**다. 체크포인트는 힙 전체 해시(O(heap))이므로 문장마다를 목표로 하면 커밋/실행 모두
스파이크한다.

#### 1) 공통 규칙

1. `history.commit()`는 문장 단위가 아니라 의미 있는 구간 단위로 띄워서 호출한다(또는 idle 감시로 `cfg.idleMs` 조절).
2. rollback 후보 관리(`history.prune()`)는 1순위 밸브다. 인자를 생략하면 live 경로밖 노드를 정리한다.
3. OPFS 객체 스팸 제어는 `MachineJournal`의 `pack()` 또는 `cfg.autoPack`이다. pack는 RAM을 즉시 줄이진 않지만 오브젝트 수를 줄인다.
4. 반응형 컨트롤러의 `saveBase()`는 base heap 복제본을 OPFS로 이동해 복원 연속성/휴대성에 쓰는 장치다. RAM 경감 장치는 아니다.
5. `dispose()`는 경로 정리를 강하게 하고 싶을 때 마지막 수단으로만 쓴다(동일 반응 컨트롤러 공유 구간에서 다른 소비자 영향 확인).

#### 2) 인터랙티브 REPL / 교육형 데모

1. 사용자 체감이 중요해 rollback 문맥을 많이 남겨야 한다. 먼저 `history.setRetentionPolicy({ maxNodes, onPressure })`로 압박을 관측하고 필요할 때 `history.prune()`한다.
2. 저널은 기본값으로 시작하고, `cfg.autoPack`/`cfg.pruneAfterCommit`은 꺼 둔다. 필요하면 장기 사용 시에만 `prune`을 더 자주 걸어 RAM 상주 힙 폭주를 막는다.
3. `pack()`은 `save`/`export` 전후 정리 목적에 한정해 주기적으로 수행한다.

#### 3) 장문 계산 / 배치 워크로드

1. 첫 번째 조정은 커밋 빈도다. 유휴 시간창(`cfg.idleMs`)을 넓히거나 직접 `history.commit()` 호출 주기를 늦춰서 같은 시간당 커밋 횟수를 낮춘다.
2. 커밋이 잦을 수밖에 없다면 `cfg.pruneAfterCommit = true`로 checkpoint tree를 live 경로만 유지해 재해시 지출을 막는다.
3. 이어서 `cfg.autoPack`을 켜서 객체 폭주를 제어한다. 시작값은 `true`(loose:128개, 8MB) 또는 `{ looseBlobs: 128, looseMB: 16 }`로 둔다.
4. `pack()`은 장애복구 연습/배포 전 보조 검증 단계에서 수행하고, 결과의 `looseRemoved/packsRemoved`를 보며 임계를 튜닝한다.

#### 4) 장시간 상시 세션 / 리플레이 파이프라인

1. 장기 상시 운영에서는 retention budget으로 rollback 후보를 관측하고, `history.prune()`과 `history.watch({ pruneAfterCommit: true })`로 경로를 정리한다.
2. 반응형 컨트롤러의 `saveBase()`는 절차적 하드 전환/휴면 전환 직전에만 1회씩 쓰고, 루프마다 호출하지 않는다.
3. 재시작 직후 대량 복원이나 재배치가 잦으면 `dispose()`로 경로 오염을 제거한 뒤 `restore` 흐름을 다시 정렬한다.

#### 권장 샘플(참고)

```js
machine.history.setRetentionPolicy({
  maxNodes: 256,
  maxDeltaBytes: 128 * 1024 * 1024,
  pruneBranches: true,
  onPressure: (event) => { /* UI 경고와 telemetry */ },
});

const journal = machine.history.watch({
  dir: opfsDir,
  idleMs: 5000,               // 문장이 아닌 유휴 구간 기반
  pruneAfterCommit: true,      // commit 직후 rollback 경로를 live path로 축소
  autoPack: { looseBlobs: 128, looseMB: 16 },
  onStatus: (evt) => { /* commit/io 실패 알림 */ },
});

console.log(machine.history.stats());
```

운영 규칙은 고정: `commit 빈도 제어` → `history.prune()`/`cfg.pruneAfterCommit` → `autoPack`/`pack()` → 반응형 컨트롤러 `saveBase()`.

관련 부채·트레이드오프의 상시 추적은 [contractReality.md](../operations/contractReality.md)다.
