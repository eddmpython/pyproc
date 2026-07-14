# 03. 진행 원장

## 2026-07-14 - 이니셔티브 개설

결정:

1. 최상위 목표는 "브라우저에 OS를 만든다"로 고정한다.
2. "Python machine"은 설명 수단일 수 있지만 목표를 대체하지 않는다.
3. OS 간판은 리눅스 복제 주장이 아니라 브라우저 경계 안에서 실행·상태·파일·프로세스·권한·네트워크를 중재한다는 주장이다.
4. 이전 `browser-os`의 조건부 판정은 폐기하지 않는다. P2/P4/P6 완료 이후 판정표 v2로 갱신한다.

완료:

- `docs/product/vision.md` North Star를 Browser Python OS 중심으로 정렬.
- `mainPlan/browser-os-north-star/` 활성 이니셔티브 개설.

NEXT:

1. OS 판정표 v2 작성.
2. 500MB 이상 힙 성능 봉투 측정 캠페인 개설.
3. 대표 데모 3종의 기존 example/probe 재사용 가능 범위 조사.

## 2026-07-14 - OS 판정표 v2

결정:

1. Browser Python OS 간판은 65/100으로 재판정한다.
2. 60-74 구간을 "Browser-bound OS kernel"로 정의한다.
3. pyproc은 지금 "Chromium 탭 안의 Browser Python OS 커널"이라고 부를 수 있다.
4. "로컬급 범용 OS" 문장은 보류한다. 대형 힙 봉투, `/home` 포함 이미지, 신뢰 체인, 제품 소비 배선이 필요하다.

완료:

- [04-os-verdict-v2.md](04-os-verdict-v2.md) 작성.
- Phase 0, Phase 1 완료 처리.

NEXT:

1. 500MB 이상 힙 성능 봉투 측정 캠페인 개설.
2. `.pymachine` v2(`/home` 포함) 포맷 설계.
3. 대표 데모 3종의 기존 example/probe 재사용 가능 범위 조사.

## 2026-07-14 - 대형 힙 성능 봉투 캠페인 개설

완료:

- [tests/attempts/largeHeapEnvelope](../../tests/attempts/largeHeapEnvelope/README.md) 캠페인 개설.
- `largeHeapProbe.html` 작성: target MB query로 checkpoint, restoreLive, Session.save/load를 실측.
- 64MB smoke GREEN 7/7: heap 88.8MB, checkpoint 82ms, restoreLive 40ms, Session.save 806ms, Session.load 2320ms.

판정:

- 측정 장치는 성립했다.
- OS 판정표 v2의 보류 사유를 닫으려면 512MB 이상 실측이 필요하다.

NEXT:

1. 512MB 실측 실행.
2. journal=1 경로는 128MB 이상에서 별도로 측정한다.
3. 결과에 따라 pack/prune 또는 증분 해시 이니셔티브 필요 여부를 판정한다.

## 2026-07-14 - 512MB 성능 봉투 1차 실측

실측:

- 512MB payload, heap 536.8MB.
- checkpoint: 8240p/515MB, 552ms.
- restoreLive: 109p/6.81MB, 225ms.
- Session.save: 8239p/514.9MB, 3665ms.
- Session.load: 8239p/514.9MB, 3191ms.

판정:

- 500MB급 checkpoint/session 봉투는 성립한다.
- 저장량이 병목이다. checkpoint 자체보다 Session.save/load와 이후 journal/fork가 다음 위험 축이다.
- [05-large-heap-envelope.md](05-large-heap-envelope.md)를 작성해 OS 판정 영향과 다음 게이트를 분리했다.

NEXT:

1. journal=1 128MB 이상 측정.
2. forkLive 512MB 측정 probe 작성.
3. 그 결과로 `04-os-verdict-v2.md` 점수 재산정 여부 결정.

## 2026-07-14 - 128MB journal 결함 수리와 실측

발견:

- `largeHeapProbe.html?target=128&journal=1` 1차 실행은 RED.
- `MachineJournal.commit()`은 2095p를 커밋했지만 새 커널의 힙이 30MB라 `recover()`가 저장 당시 heapLen 152.8MB를 열지 못했다.

조치:

- `MachineJournal._applyGeneration()`에 성장 힙 복구를 추가했다.
- JS `Memory.grow` 직접 호출 대신 `Session.load`와 같은 파이썬 할당 경로로 WASM 힙을 성장시킨다.
- 성장 루프 뒤 cp0으로 되감고 저널 페이지를 적용한다.

재실측:

- 128MB + journal=1 GREEN 9/9.
- journal.commit: 2095p, 실제 신규 blob 131p/8.2MB, 5593ms.
- journal.recover: 2095p/130.9MB, 9116ms.

판정:

- 저널은 성장 힙에서도 복구된다.
- 비용은 무겁다. 512MB journal을 그대로 밀기 전에 pack/prune 설계 판단이 필요하다.

NEXT:

1. forkLive 512MB 측정 probe 작성.
2. journal 512MB 직행 또는 pack/prune 선행 여부 판정.

## 2026-07-15 - 512MB forkLive 성능 봉투 실측

완료:

- `tests/attempts/largeHeapEnvelope/forkLiveLargeProbe.html` 작성.
- 64MB smoke GREEN 7/7: delta 1075p/67.2MB, harvest 51.5ms, apply 32.8ms.
- 512MB GREEN 7/7: parent heap 536.8MB, delta 8243p/515.2MB, harvest 132.3ms, apply 187.4ms.

판정:

- 500MB급 live fork는 성립한다.
- forkLive는 OPFS 저장을 거치지 않아 session save/load보다 훨씬 빠르다.
- 대형 힙 보류 사유는 이제 journal 512MB 또는 pack/prune 판단으로 좁혀졌다.

NEXT:

1. journal 512MB 직행 또는 pack/prune 선행 여부 판정.
2. OS 판정표 점수 재검토.

## 2026-07-15 - 512MB journal 직행 실측과 점수 재산정

실측:

- 512MB + journal=1 GREEN 9/9.
- checkpoint: 8240p/515MB, 454ms.
- Session.save: 8239p/514.9MB, 3756ms.
- Session.load: 2879ms.
- journal.commit: 8239p, 신규 blob 131p/8.2MB, 14047ms.
- journal.recover: 8239p/514.9MB, 24769ms.

판정:

- 512MB 대형 힙 봉투는 checkpoint/session/fork/journal 모두 통과했다.
- journal은 기능적으로 성립하지만 속도 목표의 다음 병목이다.
- OS 판정표를 65/100에서 66/100으로 갱신한다. 메모리 관리 점수만 5에서 6으로 올리고, 영속·크래시 내성은 journal 속도 때문에 유지한다.

NEXT:

1. MachineJournal pack/prune 또는 map 파일 단축 이니셔티브 설계.
2. `.pymachine` v2(`/home` 포함) 포맷 설계.

## 2026-07-15 - MachineJournal 중복 blob IO 캐시 최적화

발견:

- 512MB journal은 실제 신규 blob이 131p/8.2MB뿐인데 `pages` map은 8239개였다.
- 기존 구현은 같은 content-addressed key를 수천 번 `getFileHandle`, `arrayBuffer`, `sha256` 처리했다.
- 병목은 저장 포맷 이전에 반복 blob IO였다.

조치:

- `MachineJournal.commit()`에서 같은 커밋 안에 이미 확인한 key는 OPFS 존재 확인과 쓰기를 건너뛴다.
- `MachineJournal._applyGeneration()`에서 같은 key의 blob은 1회만 읽고 SHA-256을 검증한 뒤 재사용한다.
- HEAD 형식과 blob 파일명은 그대로 둬 기존 저널과 호환된다.

재실측:

- `journalProbe.html` GREEN 11/11.
- `largeHeapProbe.html?target=512&journal=1` GREEN 9/9.
- journal.commit: 8239p, 신규 blob 131p/8.2MB, 14047ms -> 2895ms.
- journal.recover: 8239p/514.9MB, 24769ms -> 2312ms.

판정:

- 512MB WAL은 기능 성립을 넘어 체감 병목 1차 해소로 이동했다.
- 포맷 pack/prune은 여전히 디스크 파일 수와 장기 GC 문제 때문에 후보지만, OS 판정의 즉시 보류 사유는 아니다.
- OS 판정표를 66/100에서 67/100으로 갱신한다. 메모리 관리 점수만 6에서 7로 올리고, 영속·크래시 내성은 `/home` 이미지 결합과 fd 재개설이 남아 있어 유지한다.

NEXT:

1. `.pymachine` v2(`/home` 포함) 포맷 설계.
2. WebCrypto 서명/SRI/포맷 마이그레이션 신뢰 체인 설계.
3. journal append-only pack/prune은 장기 OPFS 파일 수 최적화로 분리한다.

## 2026-07-15 - `.pymachine` home payload 승격

결정:

1. `.pymachine` 봉투 v2는 유지하고, 메타 v3 payload를 `delta + homePack`으로 확장한다.
2. `homePack`은 `/home/web` 파일 트리의 스냅샷이다. 파일 바이트는 JSON base64가 아니라 payload 뒤쪽에 연속 배치한다.
3. 봉투 SHA-256은 `u32(headerLen) + header + delta + homePack` 전체를 덮는다.
4. `exportImage()` 기본은 `/home/web`이 있으면 함께 싣고, `includeHome: false`면 힙 델타만 내보낸다.

완료:

- `Session.exportImage({ includeHome, homePath })` 옵션 추가.
- `openMachine()`이 메타 v3를 읽어 힙 델타를 적용한 뒤 `/home/web` 파일 트리를 복원한다.
- `machineImageProbe.html` 확장: OPFS 마운트에 쓴 텍스트/디렉터리/바이너리 파일이 단일 `.pymachine`으로 이동.
- `machineImageProbe.html` GREEN 10/10: 파일 15MB, export 80ms, open 2684ms.

판정:

- `.pymachine`은 이제 힙 상태만이 아니라 디스크 세계까지 싣는 portable machine image다.
- OS 판정표를 67/100에서 68/100으로 갱신한다. 파일시스템 축만 6에서 7로 올리고, trust chain 미완 때문에 보호·격리와 영속 축은 유지한다.

NEXT:

1. WebCrypto 서명/SRI/포맷 마이그레이션 신뢰 체인 설계.
2. 대표 데모 3종 중 "세션 cast" 또는 "크래시 생존 머신"에 `.pymachine` home payload를 배선한다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - `.pymachine` WebCrypto signature 승격

결정:

1. `.pymachine` signature는 WebCrypto ECDSA P-256으로 한다. Chromium/Edge 표준 WebCrypto 경로에서 바로 검증된다.
2. 서명 대상은 signature 필드를 제외한 unsigned body의 SHA-256이다.
3. 최종 outer envelope는 signature를 포함한 body 전체를 다시 SHA-256으로 덮는다.
4. `openMachine()`은 `trust: true` 또는 `trustedPublicKeys` 중 하나를 요구한다. trusted public key가 signature를 검증하면 `trust: true` 없이 열린다.

완료:

- `createMachineKeyPair()`와 `exportMachinePublicKey()` 공개 표면 추가.
- `Session.exportImage({ signingKey, publicKey })` 옵션 추가.
- `openMachine({ trustedPublicKey, trustedPublicKeys, requireSignature })` 검증 경로 추가.
- `machineImageProbe.html` GREEN 11/11: 서명된 `.pymachine`이 trusted public key로 `trust: true` 없이 부활하고, 다른 공개키는 거부된다.
- 실측: 파일 15MB, export 75ms, open 1608ms.

판정:

- `.pymachine`은 이제 무결성, 디스크 포함, 출처 검증을 가진 실행 파일급 머신 이미지다.
- OS 판정표를 68/100에서 69/100으로 갱신한다. 보호·격리 축만 6에서 7로 올린다.
- 남은 신뢰 축은 공개키 배포 UI, 권한 승인 UI, 런타임 자산 SRI다.

NEXT:

1. 대표 데모 3종 중 "세션 cast"에 signed `.pymachine` 흐름을 배선한다.
2. 런타임 자산 SRI 또는 자가호스팅 엔진 pin 검증을 설계한다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - 부트 자산 SRI v1 승격

결정:

1. `pyodide.js`는 브라우저 script SRI로 검증한다. 계약 이름은 `engineScriptIntegrity`다.
2. fetch 경로의 indexURL 자산(wasm/stdlib/lock/휠 등)은 pyproc이 직접 SRI를 검증한다. 계약 이름은 `coreIntegrity`다.
3. `coreIntegrity`는 strict가 기본이다. manifest에 없는 indexURL 자산은 실행하지 않는다.
4. OPFS 캐시 hit도 실행 바이트이므로 검증 대상이다. 변조 캐시는 네트워크로 조용히 우회하지 않고 실패한다.
5. Pyodide가 fetch 오류를 reject로 전파하지 않고 hang으로 남기는 경로가 있어, integrity 실패는 별도 Promise로 부팅 실패에 직접 연결한다.

완료:

- `boot({ engineScriptIntegrity, coreIntegrity })` 옵션 추가.
- `Runtime.coreCache` 통계에 `verified`와 `integrityMissing` 추가.
- `runtimeIntegrityProbe.html` + 격리 helper 작성.
- 자가 호스팅 경로 실측 GREEN 6/6:
  - 잘못된 `pyodide.js` SRI 거부.
  - 올바른 SRI 부팅 2195ms.
  - coreIntegrity 캐시 hit 검증 2189ms, verified 3, hit 3, miss 0.
  - strict manifest 누락 거부.
  - OPFS 캐시 변조 거부.
- 기존 offlineBoot 회귀 재검증 GREEN 4/4.

판정:

- `.pymachine` signature에 이어 부트 자산의 바이트 신뢰도 v1까지 닫혔다.
- 단, 이 작업은 `pyodide.js`와 fetch 경로 core 자산을 덮는다. 워커의 직접 `import()`와 Pyodide 내부 import 모듈 경로를 제품 배포 manifest 또는 SW 계층으로 완전 봉인하는 일은 남아 있다.
- OS 판정표 점수는 69/100을 유지한다. 보호 축은 이미 7이며, 제품 공개키/권한 UI와 import 경로 봉인이 닫혀야 다음 상승 근거가 된다.

NEXT:

1. 대표 데모 3종 중 "세션 cast"에 signed `.pymachine` 흐름을 배선한다.
2. worker/import 자산 SRI 완전 봉인 또는 제품 배포 manifest 계약을 설계한다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - signed session cast 데모 배선

결정:

1. 대표 데모의 첫 축은 `examples/machine.html`에서 닫는다. 새 src 능력이 아니라 이미 승격된 `Session.exportImage`, `openMachine`, WebCrypto signature, `/home` payload를 제품 표면에 배선하는 작업이다.
2. import UX는 `confirm()` + `{ trust: true }`가 아니라 trusted public key 검증으로 간다.
3. 데모 키는 IndexedDB에 보존한다. 페이지 reload 후에도 같은 데모 공개키로 자신이 서명한 `.pymachine`을 검증할 수 있다.
4. `openMachine()`이 복원한 `/home/web`은 OPFS로 복사한 뒤 런타임 디렉터리를 비우고 NativeFS를 마운트한다. Pyodide는 비어 있지 않은 디렉터리에 mount를 허용하지 않는다.

완료:

- `examples/machine.html`에 trusted key fingerprint 표시, signed export, signed in-tab cast, trusted-public-key import를 배선했다.
- `?gate`가 단순 코드 실행에서 signed `.pymachine` cast + trusted open + `/home/web` 복원 검증으로 강화됐다.
- `tests/browser/examples.mjs`가 `PYPROC_INDEX_URL`을 받아 예제 전체를 자가 호스팅 엔진으로 검사할 수 있게 됐다.
- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples` GREEN 7/7.
- machine gate 실측: signed `.pymachine` cast 9.3MB, trusted key 검증 후 counter와 `/home/web/visits.txt` 생존.

판정:

- 제품 표면 배선의 첫 축이 닫혔다. 사용자가 보는 대표 데모에서 "파일 하나로 컴퓨터를 보낸다"가 unsigned trust가 아니라 공개키 검증 흐름으로 동작한다.
- OS 판정표 점수는 유지한다. 대표 데모 3종 중 1종 완료이며, 서버 개발과 멀티프로세스 데이터 작업 데모가 아직 남아 있다.

NEXT:

1. 대표 데모 3종 중 "브라우저 안 서버 개발"을 VirtualOrigin/FastAPI/SQLite 흐름으로 배선한다.
2. 대표 데모 3종 중 "멀티프로세스 데이터 작업"을 PyProc map/pipe 흐름으로 배선한다.
3. worker/import 자산 SRI 완전 봉인 또는 제품 배포 manifest 계약을 설계한다.

## 2026-07-15 - Server Dev 대표 데모 배선

결정:

1. 대표 데모 2번은 `examples/serverDev.html`로 둔다. 새 src 능력이 아니라 `boot`, `mountHome`, `AsgiServer`, `VirtualOrigin`, `pyprocSw.js`를 제품 표면에 묶는 작업이다.
2. 서비스 워커는 `examples/serverDevSw.js` wrapper로 `/examples/` 스코프에 건다. 구현은 `src/capabilities/pyprocSw.js` 그대로 재사용한다.
3. 데모는 "서버 흉내"가 아니라 FastAPI + SQLite + editable `app.py` + iframe preview + Service Worker virtual origin까지 포함해야 한다.
4. 예제 게이트의 `PYPROC_INDEX_URL`은 실제 예제 부팅에 들어가야 한다. 기존 예제들도 `indexURL` 쿼리를 소비하도록 정리했다.

완료:

- `examples/serverDev.html` 추가.
- `examples/serverDevSw.js` 추가.
- 랜딩과 예제 내비게이션에 Server Dev 데모 연결.
- `tests/browser/examples.mjs`에 `examples/serverDev.html` 추가.
- 기존 examples의 `boot`, `bootSession`, `PyProc` 부팅이 `?indexURL=`을 실제로 사용하도록 정리.
- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples` GREEN 8/8.
- Server Dev 실측: boot 2163ms, fastapi install 651ms, `GET ./pyproc/api/version` 5ms, `app.py` v2 reload 25ms.

판정:

- 대표 데모 3종 중 2종이 닫혔다. signed machine cast와 browser server dev는 이제 사람용 UI와 gate가 함께 있다.
- 남은 대표 데모는 멀티프로세스 데이터 작업이다. Process OS 예제는 이미 있지만, OS 목표 기준으로는 pipe/map/shm을 데이터 작업 한 흐름으로 묶는 데모가 필요하다.

NEXT:

1. 대표 데모 3종 중 "멀티프로세스 데이터 작업"을 PyProc map/pipe 흐름으로 배선한다.
2. worker/import 자산 SRI 완전 봉인 또는 제품 배포 manifest 계약을 설계한다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - Speed Lab 대표 데모 배선

결정:

1. 대표 데모 3번은 `examples/speedLab.html`로 둔다. 새 src 능력이 아니라 이미 승격된 `PyProc.matmul()`과 snapshot-fork worker pool을 제품 표면에 배선하는 작업이다.
2. 속도 주장은 같은 run 안의 단일 worker baseline과 4-worker sharded run을 비교한다. 결과 일치 검증이 먼저고, speedup은 그 다음이다.
3. GitHub Pages에서는 SAB가 필요하므로 `processOs.html`과 같은 `pyprocSw.js?coi=1` 1회 reload 부트스트랩을 넣는다.
4. 데모의 코드 예시는 `new PyProc({ packages: ["numpy"], setup: "import numpy" })`, `boot(4)`, `matmul(..., { parts })`로 제한한다. 내부 `raw`나 deep import를 노출하지 않는다.

완료:

- `examples/speedLab.html` 추가.
- 랜딩과 모든 예제 내비게이션에 Speed Lab 연결.
- `tests/browser/examples.mjs`에 `examples/speedLab.html` 추가.
- `docs/operations/demoHosting.md`, `docs/operations/testing.md`, README 벤치마크 문구 갱신.
- Phase 3 대표 데모 3종을 완료 상태로 갱신.

실측:

- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples` GREEN 9/9.
- Speed Lab gate: 768x768 f64 numpy matmul, single worker 2126ms, 4-worker shard 529ms, speedup 4.02x, sample max error 0.00e+0.

판정:

- 대표 데모 3종이 모두 사람용 UI와 자동 gate를 갖췄다.
- OS 점수는 제품/개발자 표면 근거가 보강되어 69/100에서 70/100으로 오른다.
- 다음 핵심은 새 데모가 아니라 제품 소비 배선과 신뢰 체인의 남은 구멍이다.

NEXT:

1. worker/import 자산 SRI 완전 봉인 또는 제품 배포 manifest 계약을 설계한다.
2. dartlab/codaro/xlpod 중 실제 제품 하나가 machine/server/process 중 둘 이상을 공개 표면만으로 소비하게 만든다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - 실행 자산 manifest 공개 표면 승격

문제:

- `PyProc`, `SyscallBridge`, `SharedKernel`, `MachineContainer`, `WasiSession`, `VirtualOrigin`은 Worker/SharedWorker/Service Worker 실행 자산을 브라우저가 직접 연다.
- 이 자산은 same-origin이어야 하고 상대 import 구조를 보존해야 하는데, 기존 계약은 문서와 코드 주석에 흩어져 있었다.
- 제품 배포가 copy/SRI 파이프라인을 만들려면 "무엇을 복사하고 해시해야 하는가"의 기계 판독 정본이 필요하다.

결정:

1. `getPyProcAssetManifest()`를 공개 표면으로 추가한다.
2. manifest v1은 stable role, package-root 상대 경로, kind, usedBy, same-origin 정책을 제공한다.
3. 실제 worker import 그래프 전체 SRI 봉인은 다음 단계로 둔다. 이번 단계는 경로/역할/정책 정본화와 drift gate다.
4. `src/` deep import를 소비자에게 요구하지 않는다. root export와 타입 선언만 소비한다.

완료:

- `src/runtime/assets.js` 추가.
- `index.js`, `index.d.ts`, `package.json` 공개 표면 갱신.
- `tests/run.mjs`에 export/type/manifest 경로 drift gate 추가.
- `docs/consuming/contract.md`에 same-origin 실행 자산 manifest 절 추가.
- `scripts/assetManifest.mjs` CLI 추가: Worker/SW entrypoint의 상대 import graph를 따라가 파일별 `sha256-...` SRI manifest를 만들고, `--copy-to`로 필요한 파일을 복사한다.
- `package.json`에 `pyproc-assets` bin과 `npm run assets:manifest` 추가.

판정:

- 라이브러리 구조의 취약점 하나가 문서 관례에서 공개 계약으로 이동했다.
- 제품 배포 파이프라인이 바로 쓸 수 있는 copy/SRI 산출물이 생겼다.
- 다음 SRI 단계는 브라우저 런타임에서 worker/import graph 해시를 강제 검증하는 방식으로 좁혀진다.

NEXT:

1. `pyproc-assets` 산출물을 실제 제품 배포 파이프라인에 연결한다.
2. worker import graph 해시를 브라우저 런타임에서 강제 검증하는 방식을 SW 계층 또는 제품 manifest에서 결정한다.
3. dartlab/codaro/xlpod 중 실제 제품 하나가 machine/server/process 중 둘 이상을 공개 표면만으로 소비하게 만든다.

## 2026-07-15 - 실행 자산 SRI runtime preflight 연결

문제:

- `pyproc-assets`가 copy/SRI manifest를 만들 수 있게 됐지만, 런타임은 아직 그 manifest를 읽어 worker spawn을 막지 않았다.
- 브라우저는 `new Worker(..., { type: "module" })` 하위 import에 script 태그 같은 SRI 속성을 걸 수 없다.
- 따라서 정직한 1차 집행은 worker 생성 전에 graph 파일을 fetch하고 SHA-256을 대조하는 preflight다.

결정:

1. 검증 함수는 `src/runtime/assets.js`의 `verifyPyProcAssetIntegrity()`로 둔다. 경로 정본과 SRI 검증 책임을 같은 레이어에 모은다.
2. `boot({ assetIntegrity })`는 Runtime에 manifest를 보관하고, Runtime에서 만든 worker 능력(`SyscallBridge`, `MachineContainer`)이 상속한다.
3. Runtime 없이 worker를 띄우는 `PyProc`, `SharedKernel`, `JobControl`, `bootWasi`는 자기 옵션에 `assetIntegrity`를 직접 받는다.
4. 이 단계는 spawn 전 preflight다. Service Worker 등록 경로와 Pyodide 내부 import 모듈까지 완전 봉인하는 일은 SW 계층 또는 제품 배포 정책으로 남긴다.

완료:

- `verifyPyProcAssetIntegrity()` 공개 표면 추가. `pyproc-assets` manifest의 `files[]`를 role/path로 선택하고 fetch + SHA-256으로 대조한다.
- `PyProc.boot()`가 `processWorker` graph를 worker pool 생성 전에 검증한다.
- `SyscallBridge` subprocess가 `processWorker` graph를 자식 worker 생성 전에 검증한다.
- `MachineContainer.spawn()`이 `machineWorker` graph를 컨테이너 worker 생성 전에 검증한다.
- `SharedKernel`이 `sharedKernelHost` graph 검증 뒤 SharedWorker를 만든다.
- `bootWasi`/`WasiSession`이 `wasiWorker` graph 검증 뒤 WASI worker를 만든다.
- 타입 선언, README, 소비 계약, 테스트 문서 갱신.
- Node gate에 올바른 SRI 통과와 잘못된 SRI 거부 단위 검증 추가.
- 브라우저 게이트 서버가 `pyproc-assets --baseURL /` CLI 산출물을 `/pyproc-assets.json`으로 제공하고, 게이트 페이지가 이 JSON을 fetch해 `assetIntegrity`로 `PyProc`에 전달한다. 같은 게이트가 `boot({ assetIntegrity }) -> Runtime -> SyscallBridge` 상속 경로까지 확인해 child worker도 spawn 전 SRI 검증을 탄다. 이로써 CLI 산출물과 runtime preflight 사이의 실제 소비 경로가 닫혔다.

판정:

- 실행 자산 신뢰 체인이 `pyodide.js`/core fetch에서 pyproc worker graph까지 확장됐다.
- 로컬급 OS 목표에서 "내가 어떤 커널 바이트를 실행하는가"의 답이 한 단계 더 명확해졌다.
- 남은 핵심은 pyproc 밖 실제 소비 제품 배포 파이프라인에서 같은 manifest 생성/서빙 방식을 채택하고, Service Worker와 Pyodide 내부 모듈 경로까지 같은 정책으로 닫는 것이다.

NEXT:

1. `pyproc-assets` 산출물과 `assetIntegrity` preflight를 pyproc 밖 실제 제품 하나의 배포 파이프라인에 연결한다.
2. Service Worker 등록 자산과 Pyodide 내부 import 모듈 경로의 신뢰 체인을 닫는다.
3. dartlab/codaro/xlpod 중 실제 제품 하나가 machine/server/process 중 둘 이상을 공개 표면만으로 소비하게 만든다.

## 2026-07-15 - 패키지 소비자 게이트 추가

문제:

- 저장소 내부 import와 실제 npm 설치 소비는 다르다.
- Browser OS 목표에서는 제품 앱이 `src/`를 직접 파고들지 않고 공개 API와 설치된 배포 도구만으로 worker 자산을 배포할 수 있어야 한다.

완료:

- `tests/packageConsumer.mjs` 추가: `npm pack` tarball을 임시 앱에 설치하고, `pyproc`와 `pyproc/assets`만 import한다.
- 설치된 `pyproc-assets` bin으로 graph SRI manifest를 만들고 `--copy-to` 결과를 확인한다.
- `npm test`에 패키지 소비자 게이트를 연결하고 `npm run test:package` 단독 실행 스크립트를 추가했다.

판정:

- 라이브러리 구조 검증이 저장소 내부 정적 검사에서 실제 패키지 설치 경로까지 확장됐다.
- 제품 소비 배선의 남은 작업은 실제 제품 하나에 이 manifest copy/SRI 파이프라인을 연결하는 것이다.

NEXT:

1. dartlab/codaro/xlpod 중 실제 제품 하나가 machine/server/process 중 둘 이상을 공개 표면만으로 소비하게 만든다.
2. Service Worker 등록 경로와 Pyodide 내부 모듈까지 같은 manifest 정책으로 닫는 방식을 결정한다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - 브라우저 제품 소비자 게이트 추가

문제:

- Node의 `npm pack` 소비자 게이트는 설치 패키지의 exports/bin 계약을 보지만, 브라우저에서 설치 패키지를 실제 앱처럼 import하고 worker를 spawn하는 경로는 별도로 검증해야 한다.
- Browser OS 목표에서는 repo 상대 import가 아니라 소비 앱의 public specifier, 설치된 `pyproc-assets`, 실제 module worker URL이 한 흐름에서 맞아야 한다.

완료:

- `tests/packageHarness.mjs`로 `npm pack` + 임시 앱 설치 공통 하네스를 분리했다.
- `tests/browser/productConsumer.mjs` 추가: 임시 앱에 설치된 `node_modules/pyproc`만 노출하고 import map으로 `pyproc`, `pyproc/assets` public specifier를 매핑한다.
- 설치된 `pyproc-assets` bin이 `/node_modules/pyproc/` 기준 SRI manifest를 만들고, 브라우저가 그 manifest로 실제 worker graph를 검증한다.
- 같은 게이트가 잘못된 worker SRI의 spawn 전 거부, 설치 패키지 `Runtime.boot()`, 설치 패키지 `PyProc` worker `map()`을 확인한다.
- `npm run test:consumer` 추가, CI browser job에 연결, Node 구조 게이트가 스크립트와 CI 배선을 감시한다.

판정:

- 라이브러리 구조 검증이 "패키지 설치"에서 "브라우저 제품 앱 소비"까지 확장됐다.
- 외부 제품 repo를 건드리기 전에도, pyproc 자체 CI가 설치 패키지의 브라우저 소비 가능성을 매번 증명한다.

NEXT:

1. codaro를 first external consumer로 잡고 실제 repo에서 `pyproc` public import + asset manifest 배포 배선을 검토한다.
2. Service Worker 등록 경로와 Pyodide 내부 모듈까지 같은 manifest 정책으로 닫는 방식을 결정한다.
3. journal append-only pack/prune은 장수 머신 최적화로 분리한다.

## 2026-07-15 - codaro 브라우저 런타임 seam에 assetIntegrity 연결

문제:

- codaro는 이미 `browserPythonRuntime.ts`에서 `import("pyproc")`로 브라우저 커널을 lazy boot하지만, 현재 핀된 pyproc SHA는 실행 자산 manifest 공개 표면 이전이다.
- 새 pyproc SHA로 핀을 올리기 전에도 codaro 쪽 seam은 `/pyproc-assets.json`을 읽어 `boot({ assetIntegrity })`로 넘길 준비가 되어 있어야 한다.

완료:

- codaro `editor/src/lib/browserPythonRuntime.ts`에 `VITE_PYPROC_ASSET_INTEGRITY_URL` 오버라이드와 기본 `/pyproc-assets.json` fetch 경로를 추가했다.
- manifest가 있으면 `boot({ assetIntegrity })`로 넘기고, manifest가 없거나 현재 구 SHA처럼 해당 공개 표면이 준비되지 않은 배포에서는 기존 단일 런타임 동작을 유지한다.
- codaro `tests/runtime/verifyEditorRuntimePreflight.py`가 브라우저 커널 seam의 asset manifest token과 Node probe alias를 검증한다.

검증:

- codaro `npm run check` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate editor-runtime-preflight` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate editor-build` GREEN.

판정:

- codaro는 아직 새 pyproc SHA로 고정되지 않았으므로 완전한 외부 소비자 cutover는 아니다.
- 그러나 첫 외부 소비자 코드 경계는 새 pyproc의 runtime preflight 계약을 받을 준비가 됐다.

NEXT:

1. pyproc 변경을 immutable SHA로 만든 뒤 codaro `editor/package.json`의 pyproc 핀을 올린다.
2. codaro build 단계에서 `pyproc-assets --baseURL /.../` 산출물을 배포 산출물에 포함한다.
3. codaro 브라우저 게이트가 `/pyproc-assets.json` 존재와 `assetIntegrity` 적용을 실제 브라우저에서 확인하게 한다.

## 2026-07-15 - codaro editor build에 pyproc asset manifest 생성기 연결

문제:

- codaro 런타임 seam은 `assetIntegrity`를 넘길 준비가 됐지만, 실제 배포 산출물에 `pyproc-assets.json`과 same-origin vendor graph를 넣는 단계가 없었다.
- `editor/public`에 직접 생성하면 root-clean을 더럽히므로, 산출물은 Vite build 이후 `webBuild` 또는 `CODARO_WEB_OUT`에 후처리로 써야 한다.
- 현재 codaro가 핀한 pyproc SHA는 asset contract 이전이므로, 새 SHA 전까지 build가 실패하면 안 된다.

완료:

- codaro `editor/scripts/generatePyprocAssets.mjs` 추가. 설치된 `node_modules/pyproc` 또는 `CODARO_PYPROC_PACKAGE_ROOT`의 `getPyProcAssetManifest()`를 읽고 상대 import graph를 수집해 `sha256-...` SRI manifest를 만든다.
- `editor/package.json`의 `build`가 `vite build` 후 `npm run pyproc:assets`를 실행한다. 출력 위치는 기본 `src/codaro/webBuild`, Pages 변형은 `CODARO_WEB_OUT`을 따른다.
- 출력은 `pyproc-assets.json`과 `vendor/pyproc/**`이며, base URL은 `CODARO_WEB_BASE`가 있으면 subpath를 반영한다.
- 현재 구 pyproc SHA처럼 asset contract가 없으면 스크립트가 stale 산출물을 지우고 skip한다. 따라서 기존 codaro build는 깨지지 않는다.
- `browserPythonRuntime.ts` 기본 manifest URL을 고정 `/pyproc-assets.json`에서 Vite `BASE_URL` 기준 `pyproc-assets.json`으로 바꿨다. `/codaro/app/` 같은 subpath 배포에서 올바른 경로를 읽는다.
- codaro `verifyEditorRuntimePreflight.py`가 build script 배선, 생성기 token, fixture 기반 graph/SRI 생성 결과를 검증한다.

검증:

- codaro `npm run pyproc:assets` GREEN. 현재 구 SHA에서는 `asset contract not found`로 안전 skip.
- codaro `npm run check` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate editor-runtime-preflight` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate editor-build` GREEN.
- 새 pyproc 작업트리를 `--package-root`로 주면 temp out에 25개 파일 graph, `pyproc-assets.json`, `vendor/pyproc/**`가 생성됨을 확인했다.

판정:

- 외부 소비 제품의 배포 파이프라인까지 manifest 생성 계약이 연결됐다.
- 아직 완전한 cutover는 아니다. codaro 의존 SHA가 구버전이라 실제 editor build에서는 manifest 생성이 skip된다.
- 다음 단계는 pyproc 변경을 커밋 가능한 immutable SHA로 만든 뒤 codaro pin을 올리고, 그 상태의 editor build 산출물에서 manifest가 실제로 포함되는지 브라우저 게이트로 닫는 것이다.

NEXT:

1. pyproc 변경을 immutable SHA로 만든 뒤 codaro `editor/package.json`의 pyproc 핀을 올린다.
2. codaro editor build 산출물의 `/pyproc-assets.json`과 `/vendor/pyproc/**`를 브라우저 product gate에서 fetch 검증한다.
3. codaro가 복원, 파일, 서버 또는 프로세스 OS 중 둘 이상을 pyproc 공개 표면으로 쓰게 만들어 Phase 5 완료 조건을 닫는다.

## 2026-07-15 - codaro를 새 pyproc SHA로 올리고 manifest 산출을 실측

문제:

- codaro build 후처리는 준비됐지만, 이전 상태에서는 핀된 pyproc SHA가 asset contract 이전이라 실제 배포 산출물이 skip됐다.
- Phase 5 소비 배선은 "준비된 seam"이 아니라 설치된 외부 제품 repo에서 새 pyproc SHA를 실제로 소비해야 진전이다.

완료:

- pyproc 변경을 `7ac859b2f09c8a3a83d2f808afb48550293f63df`로 main 커밋하고 `origin/main`에 반영했다.
- codaro `editor/package.json`과 `editor/package-lock.json`의 pyproc 핀을 해당 SHA로 올렸다.
- codaro `editor build`가 `pyproc:assets` 후처리에서 skip 없이 `src/codaro/webBuild/pyproc-assets.json`과 `src/codaro/webBuild/vendor/pyproc/**`를 생성했다.
- codaro preflight에 설치된 실제 pyproc 패키지 기준 manifest 생성 검증을 추가했다. fixture가 아니라 `node_modules/pyproc`에서 5개 entrypoint role과 graph copy/SRI를 확인한다.

검증:

- pyproc `npm test` GREEN 569/569.
- pyproc `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:browser` GREEN 45/45.
- pyproc `git push origin main` 완료: `218d973..7ac859b`.
- codaro `npm install pyproc@github:eddmpython/pyproc#7ac859b2f09c8a3a83d2f808afb48550293f63df` 완료.
- codaro `npm run build` GREEN, `pyproc assets: 25 files`.
- codaro `uv run python -X utf8 tests/run.py gate editor-runtime-preflight` GREEN.
- 생성 manifest 확인: files 25개, entrypoint role 5개(`processWorker`, `sharedKernelHost`, `machineWorker`, `wasiWorker`, `pyprocServiceWorker`).

판정:

- "pyproc 자체 CI에서 소비 가능"을 넘어 실제 외부 제품 codaro가 새 pyproc 공개 표면과 자산 manifest 배포 계약을 소비한다.
- Phase 5는 아직 완전 종료가 아니다. codaro가 현재 쓰는 것은 기본 브라우저 커널 부팅과 asset preflight이고, 완료 조건은 복원, 파일, 서버, 프로세스 OS 중 둘 이상을 제품 표면에서 공개 API만으로 쓰는 것이다.

NEXT:

1. codaro 브라우저 product gate에서 `/pyproc-assets.json`과 `/vendor/pyproc/**`를 fetch해 manifest/SRI를 실제 페이지 기준으로 검증한다.
2. codaro가 pyproc `Runtime.fs`/`.pymachine` 또는 `AsgiServer`/`VirtualOrigin` 중 하나를 더 소비하게 만들어 "OS 프리미티브 둘 이상" 조건을 닫는다.
3. pyproc의 Service Worker 등록 경로와 Pyodide 내부 import 모듈까지 같은 manifest 정책으로 봉인한다.

## 2026-07-15 - codaro pyproc 자산 브라우저 product gate 추가

문제:

- 직전 상태는 codaro editor build가 `pyproc-assets.json`과 `vendor/pyproc/**`를 만든다는 산출 확인까지였다.
- Browser OS 목표에서 외부 제품 증거로 인정하려면 실제 브라우저 page context가 배포 산출물을 fetch하고, manifest role과 SRI를 재계산해야 한다.

완료:

- codaro `838997d31cd6ed2ab8c3e448a681256e5f3c133b`가 `pyproc-assets-browser` product gate를 추가했다.
- gate는 `npm run build` 후 정적 editor 산출물을 띄우고, 브라우저에서 `/pyproc-assets.json`을 읽는다.
- manifest의 5개 entrypoint role, `/vendor/pyproc/` package root, same-origin policy, `vendor/pyproc/**` 파일 URL을 확인한다.
- 모든 vendor 파일을 fetch한 뒤 브라우저 `crypto.subtle.digest`로 `sha256-...` SRI를 다시 계산한다.
- process worker payload가 실행 가능한 module 형태를 유지하는지도 별도 case로 본다.
- codaro product quality cycle은 이 gate의 `output/test-runner/pyproc-assets-browser/pyproc-assets-report.json`을 artifact freshness evidence로 대조한다.

검증:

- codaro `uv run python -X utf8 tests/run.py gate pyproc-assets-browser` GREEN, 25개 파일, 187129 bytes 검증.
- codaro `uv run python -X utf8 -m pytest tests/runtime/testRunEntrypoint.py tests/product/verifyProductQualityAudit.py -q --tb=short` GREEN 14/14.
- codaro `uv run python -X utf8 tests/run.py gate docs` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate product-quality-audit` GREEN.
- codaro `uv run python -X utf8 tests/run.py preflight` GREEN 3/3.
- codaro `git push origin main` 완료: `7550d5b5..838997d3`.

판정:

- 이전 NEXT 1번은 닫혔다. 외부 제품 codaro의 실제 브라우저 표면이 pyproc same-origin 자산 graph와 SRI를 검증한다.
- Phase 5는 아직 완전 종료가 아니다. codaro가 현재 쓰는 것은 기본 `Runtime` boot, `assetIntegrity`, `PyProc` 타입 seam이고, 완료 조건은 복원, 파일, 서버, 프로세스 OS 중 둘 이상을 제품 표면에서 공개 API만으로 쓰는 것이다.

NEXT:

1. codaro가 pyproc `Runtime.fs`/`.pymachine` 또는 `AsgiServer`/`VirtualOrigin` 중 하나를 더 소비하게 만들어 "OS 프리미티브 둘 이상" 조건을 닫는다.
2. pyproc의 Service Worker 등록 경로와 Pyodide 내부 import 모듈까지 같은 manifest 정책으로 봉인한다.
