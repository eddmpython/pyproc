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

## 2026-07-15 - codaro Runtime.fs product gate로 두 번째 OS primitive 소비 확인

문제:

- 직전 상태는 codaro가 기본 `Runtime` boot, `assetIntegrity`, build 산출물의 same-origin asset graph를 실제 브라우저에서 검증하는 단계였다.
- Browser OS 목표에서 외부 제품 증거로 인정하려면 브라우저 파일 세계가 단순 문서 표면이 아니라 실제 제품 실행 결과와 Python `open()`에 동시에 보여야 한다.
- `Runtime.fs`가 JS에서만 보이고 Python 파일 IO와 분리되면 OS primitive가 아니라 포장된 저장 헬퍼에 그친다.

완료:

- codaro `e862593f090e471f4bc0345a6c7fefc1c0e91576`가 `pyproc-runtime-fs-browser` product gate를 추가했다.
- gate는 `npm run build` 후 정적 editor 산출물을 띄우고, `?codaroBrowserRuntimeDiagnostics=1`일 때만 브라우저 Python diagnostic hook을 설치한다.
- 첫 셀은 실제 pyproc 런타임에서 실행되고, codaro runtime seam은 `Runtime.fs`로 `/home/web/codaro/cells/<cell>.py`와 `/home/web/codaro/runs/<cell>.json`을 쓴다.
- JS `Runtime.fs.readFile()` readback과 Python `open()` readback을 모두 검증한다.
- 두 번째 셀은 Python `open('/home/web/codaro/runs/cell-fs-source.json')`으로 첫 번째 셀의 실행 기록을 읽고, `Runtime.fs`와 `cell-fs-source:success`를 stdout으로 증명한다.
- 실행 결과 UI는 `data-runtime-artifacts`로 브라우저 FS 셀 소스와 실행 기록 경로를 노출한다.
- 첫 실측에서 Vite `BASE_URL="/"`를 `URL` 생성자 base로 직접 쓰던 결함이 `Invalid base URL`로 드러났고, 현재 origin 기준 절대 base로 고쳤다. 이 수정도 같은 gate로 재검증했다.
- codaro `quality-cycle`과 `product-quality-audit`는 `output/test-runner/pyproc-runtime-fs-browser/pyproc-runtime-fs-report.json`을 artifact freshness evidence로 대조한다.

검증:

- codaro `npm run check` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate editor-runtime-preflight` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate product-quality-audit` GREEN.
- codaro `uv run python -X utf8 -m pytest tests/runtime/testRunEntrypoint.py tests/product/verifyProductQualityAudit.py -q --tb=short` GREEN 14/14.
- codaro `uv run python -X utf8 tests/run.py gate pyproc-runtime-fs-browser` GREEN.
- codaro `pyproc-runtime-fs-report.json` signals: `runtimeFileSystem: Runtime.fs`, `pythonOpenShared: true`, source path `/home/web/codaro/cells/cell-fs-source.py`, run record path `/home/web/codaro/runs/cell-fs-source.json`.
- codaro `uv run python -X utf8 tests/run.py gate docs` GREEN.
- codaro `uv run python -X utf8 tests/run.py preflight` GREEN 3/3.
- codaro `git push origin main` 완료: `838997d3..e862593f`.

판정:

- 이전 NEXT 1번은 제품 증거 기준으로 닫혔다. codaro는 이제 기본 브라우저 `Runtime` boot/asset preflight에 더해 `Runtime.fs`를 실제 제품 실행 경계에서 소비한다.
- "파일 세계"는 pyproc의 OS 방향에서 핵심 primitive다. 이번 gate는 JS 파일 API와 Python `open()`이 같은 `/home/web/codaro` 세계를 본다는 점을 브라우저에서 직접 증명한다.
- Phase 5의 외부 제품 소비 조건은 실질적으로 닫힌 것으로 본다. 단 pyproc 자체의 실행 자산 봉인 과제는 남아 있다.

NEXT:

1. pyproc의 Service Worker 등록 경로와 Pyodide 내부 import 모듈까지 같은 manifest 정책으로 봉인한다.
2. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `AsgiServer`/`VirtualOrigin` 중 하나로 잡는다. 파일 세계가 닫혔으므로 다음은 상태 부활 또는 브라우저 서버다.

## 2026-07-15 - Service Worker 등록 자산과 내부 import 경로 SRI 봉인

문제:

- `assetIntegrity`는 worker graph를 spawn 전에 검증하지만, Service Worker는 소비자가 직접 `navigator.serviceWorker.register("<문자열>")`를 조합했다.
- 이 구조에서는 "검증한 pyprocSw.js"와 "실제로 등록한 pyprocSw.js"가 갈라질 수 있다.
- `boot({ coreIntegrity })`는 JS `fetch` wrapper로 indexURL fetch 경로를 검증하지만, 브라우저 동적 `import()`가 가져가는 script/module 경로는 wrapper 밖이다. 이 경로는 SW fetch 이벤트에서 봉인해야 한다.

완료:

- 공개 표면 `registerPyProcServiceWorker()` 추가. `pyproc-assets` 산출물의 `pyprocServiceWorker` role을 SRI 검증한 뒤 그 manifest `file.url`만 등록한다.
- helper가 `cache`, `asgi`, `coi`, `cdn`, `coreIntegrity`, `coreRequired`, `asgiTimeout`, `scope`를 안전하게 query/registration option으로 조립한다.
- `pyprocSw.js?cache=1&coreIntegrity=<manifest>` 모드 추가. SW가 cache 대상 response를 캐시 전과 cache hit 반환 전에 SHA-256으로 검증한다.
- SW `coreIntegrity`는 URL/path 기준으로 매칭한다. 파일명 단독 매칭은 이름 충돌 여지를 남기므로 SW 봉인 경로에서는 쓰지 않는다.
- `runtime.js`의 `coreIntegrity` 매칭은 indexURL 상대 path와 URL pathname을 추가로 인식하게 했다. 기존 filename manifest와도 호환된다.
- 브라우저 게이트가 `registerPyProcServiceWorker()`로 실제 SW를 root scope에 등록하고, `/src/capabilities/pyprocSw.js`는 200, manifest에 없는 `/src/capabilities/virtualOrigin.js`는 500으로 수렴하는지 확인한다.
- 제품 소비자 게이트도 설치된 npm package에서 helper가 `/node_modules/pyproc/src/capabilities/pyprocSw.js`를 등록하는지 확인한다.
- README/README.ko/소비 계약/OS 판정표/pythonMachine README를 현재 계약으로 갱신했다.

검증:

- `npm test` GREEN 572/572.
- `npm run test:consumer` GREEN 7/7. installed package SW registers from manifest URL PASS.
- `npm run test:browser` GREEN 47/47. Service Worker register 경로 봉인 PASS, SW `coreIntegrity` import 경로 검증 PASS.
- `node tests/browser/run.mjs tests/attempts/pythonMachine/runtimeIntegrityProbe.html` GREEN 6/6. 기존 `engineScriptIntegrity`/`coreIntegrity`/OPFS 변조 거부 회귀 없음.

판정:

- 이전 NEXT 1번은 닫혔다. pyproc 자체의 실행 자산 신뢰 체인은 `pyodide.js` SRI, fetch core `coreIntegrity`, worker graph `assetIntegrity`, Service Worker 등록 helper, SW `coreIntegrity`로 나뉘어 각 브라우저 경로에서 집행된다.
- 이 변경은 속도 직접 개선은 아니지만, 로컬급 OS 목표의 배포 신뢰성과 구조 완성도를 올린다. 신뢰할 수 없는 바이트를 빠르게 실행하는 것은 목표가 아니다.
- OS 점수는 보수적으로 70/100을 유지한다. 남은 상승 근거는 공개키 배포/권한 UI, `.pymachine` 또는 `AsgiServer`/`VirtualOrigin`의 제품 소비 확장, journal pack/prune이다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `AsgiServer`/`VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. MachineJournal append-only pack/prune으로 장기 OPFS 파일 수와 GC를 줄인다.

## 2026-07-15 - codaro AsgiServer product gate로 브라우저 서버 소비 확인

문제:

- 직전 NEXT는 codaro가 `.pymachine` 또는 `AsgiServer`/`VirtualOrigin` 중 하나를 더 소비해 OS primitive 제품 증거를 넓히는 것이었다.
- `Runtime.fs` 제품 gate는 파일 세계를 닫았지만, 브라우저 OS에서 "서버" 축은 아직 제품 표면 아래에서 검증되지 않았다.
- pyproc의 `AsgiServer`가 examples와 dartlab에서 성립해도 codaro가 공개 표면으로 가져가지 않으면 공통 커널 SSOT 증거가 약하다.

완료:

- codaro가 pyproc pin을 `a7fc83906cfa7bf24c009c8631043738423fa84a`로 올렸다.
- codaro `527e0e2627e7e85f75a2b760b3bf3e59d5b4b184`가 `pyproc-asgi-browser` product gate를 추가했다.
- `browserPythonRuntime.ts` diagnostic hook에 `verifyAsgiServer()`가 추가됐다. 이 hook은 실제 pyproc runtime을 boot한 뒤 `rt.enableAsgiServer({ app })`를 호출한다.
- 브라우저 커널 안 Python ASGI 앱은 `POST /codaro/pyproc-asgi?value=41` 요청의 method, path, query, body, `x-codaro-gate: browser-os-server` header를 읽고, `207` 응답과 `x-codaro-runtime: pyproc-asgi` header를 돌려준다.
- Playwright gate는 build된 editor를 정적 서버로 띄운 뒤 Chromium page context에서 `diagnostics.verifyAsgiServer()`를 실행하고, `output/test-runner/pyproc-asgi-browser/pyproc-asgi-report.json`에 status, path, query, request header, response header, body byte length, transport signal을 남긴다.
- codaro `quality-cycle`과 `product-quality-audit`는 `pyproc-asgi-report.json`을 artifact freshness evidence로 대조한다.
- pyproc 소비 계약과 OS 판정표는 codaro가 `Runtime.fs`와 `AsgiServer`를 제품 gate로 소비하는 상태로 갱신했다.

검증:

- codaro `npm run check` GREEN.
- codaro `uv run python -X utf8 -m pytest tests/runtime/testRunEntrypoint.py -q --tb=short` GREEN 14/14.
- codaro `uv run python -X utf8 tests/run.py gate editor-runtime-preflight` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate product-quality-audit` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate pyproc-asgi-browser` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate pyproc-assets-browser` GREEN.
- codaro `uv run python -X utf8 tests/run.py gate pyproc-runtime-fs-browser` GREEN.
- codaro `uv run python -X utf8 tests/run.py preflight` GREEN 3/3.
- codaro `git push origin main` 완료: `e862593f..527e0e26`.

판정:

- 이전 NEXT 1번의 `AsgiServer` 축은 닫혔다. codaro는 이제 pyproc 공개 표면으로 브라우저 파일 세계와 브라우저 안 Python 서버를 모두 제품 gate에서 소비한다.
- Phase 5의 "제품 하나가 복원, 파일, 서버 또는 프로세스 OS 중 둘 이상을 공개 표면으로 사용" 조건은 파일 + 서버 조합으로 충족된다.
- 다만 `VirtualOrigin`은 아직 제품 URL fetch로 닫히지 않았고, `.pymachine` 세션 이미지는 제품 소비 증거가 없다. OS 점수는 보수적으로 70/100 유지한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. MachineJournal append-only pack/prune으로 장기 OPFS 파일 수와 GC를 줄인다.

## 2026-07-15 - MachineJournal pack/prune으로 장기 OPFS 파일 수 구조 수리

문제:

- 512MB journal commit/recover는 중복 blob IO 캐시로 2-3초대까지 내려왔지만, 장수 머신이 loose blob 파일을 계속 누적하는 구조는 남아 있었다.
- 기존 저장 형식은 `blob/<sha256>` 파일 하나가 page blob 하나라서, 장기 실행에서는 OPFS 파일 수와 GC가 다음 병목이 된다.
- pack/prune은 속도와 라이브러리 구조 모두에 걸린다. recover가 loose 전용이면 저장소 포맷 확장이 소비자에게 새 마이그레이션 부담으로 번진다.

완료:

- `MachineJournal.pack()` 추가. 현재 HEAD/PREV가 참조하는 live blob만 `pack/*.bin` 파일 1개로 묶고, `PACKS.json`을 마지막에 교체한다.
- `MachineJournal.prune()` 추가. HEAD/PREV가 더 이상 참조하지 않는 loose blob과 `PACKS.json`에 없는 stale pack 파일을 제거한다.
- recover 경로는 기존 loose blob과 새 pack 계층을 모두 읽는다. 기존 HEAD/blob 저널은 그대로 호환된다.
- pack-only recover 속도 경로를 위해 한 recover/pack 작업 안에서 `PACKS.json`, pack directory, pack File을 캐시한다. 같은 pack 파일을 key마다 다시 열지 않는다.
- 공개 타입 `index.d.ts`, 구조 게이트, README/README.ko/소비 계약을 `pack()`/`prune()`까지 포함하도록 갱신했다.
- `journalPackProbe.html` 추가. 2세대 커밋 후 pack, prune, pack-only HEAD recover, HEAD 파손 후 PREV fallback을 실제 브라우저 OPFS에서 확인한다.

검증:

- `node tests/browser/run.mjs tests/attempts/pythonMachine/journalPackProbe.html` GREEN 7/7.
- 실측: loose blob 223개 -> pack 파일 1개 + loose 0개.
- `MachineJournal.pack()` 1614ms.
- `MachineJournal.prune()`이 stale loose 1개와 stale pack 1개를 제거.
- pack-only HEAD recover: `value=22`, `pages=122`.
- HEAD 파손 후 pack PREV fallback: `value=11`.

판정:

- 이전 NEXT 3번의 장기 OPFS 파일 수 구조는 닫혔다.
- OS 점수는 보수적으로 70/100 유지한다. 이유는 512MB급 자동 pack 정책 수치, 공개키 배포/권한 UI, `.pymachine` 또는 `VirtualOrigin` 제품 소비가 아직 남아 있기 때문이다.
- 즉시 성능 병목은 commit/recover 2-3초대, 구조 병목은 pack/prune으로 각각 1차 수리됐다. 다음 속도 작업은 "언제 자동 pack할지"를 512MB급 장수 머신에서 실측하는 것이다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. MachineJournal pack 자동 실행 기준을 512MB급 장수 머신에서 실측한다.

## 2026-07-15 - 512MB MachineJournal pack 비용 실측

문제:

- 직전 항목은 `MachineJournal.pack()`/`prune()`의 구조와 소형 probe 계약을 닫았다.
- 그러나 OS 속도 목표에서는 512MB급 장수 머신에서 pack이 실제로 어느 비용인지 확인해야 한다.
- pack이 loose blob 파일 수를 줄여도 512MB에서 수십 초가 걸리면 자동 운영 정책에 올릴 수 없다.

완료:

- `largeHeapProbe.html`에 `&pack=1` query를 추가했다. `pack=1`은 journal 경로를 켜고, `journal.commit`, `journal.recover`, `journal.pack`, pack-only `journal.recover`를 한 번에 검증한다.
- 64MB smoke와 512MB 수동 실측을 모두 실행했다.
- `tests/attempts/largeHeapEnvelope/README.md`와 `05-large-heap-envelope.md`에 512MB pack 수치를 추가했다.
- OS 판정표의 영속·크래시 내성 보류 사유를 "512MB급 자동 pack 정책 수치 없음"에서 "자동 pack 정책 기준 없음"으로 좁혔다.

검증:

- `node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/largeHeapProbe.html?target=64&pack=1"` GREEN 11/11.
- 64MB 수치: journal commit 1302ms, recover 2049ms, pack 883ms, loose 131 -> 0, pack-only recover 1772ms.
- `PYPROC_GATE_TIMEOUT=900000 node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/largeHeapProbe.html?target=512&pack=1"` GREEN 11/11.
- 512MB 수치: checkpoint 515MB 538ms, restoreLive 222ms, Session.save 514.9MB 3740ms, Session.load 2700ms.
- 512MB journal: commit 2702ms(wrote 131p/8.2MB), recover 2490ms.
- 512MB pack: 131 keys/8.2MB, loose 131 -> 0, pack 1081ms.
- 512MB pack-only recover: 8239p/514.9MB, 2481ms.

판정:

- 이전 NEXT 3번의 "512MB급 pack 수치"는 닫혔다.
- pack은 장수 머신의 loose blob 누적을 줄이는 데 512MB 기준 약 1.1초다. commit/recover 2-3초대 봉투 안에 들어간다.
- 자동 pack은 이제 성능 미지수가 아니라 정책 문제다. 즉 언제 pack할지, UI/제품이 어떤 idle boundary에서 호출할지를 소비 제품 계약으로 정하면 된다.
- OS 점수는 보수적으로 70/100 유지한다. 점수 상승은 제품 소비 배선(`.pymachine` 또는 `VirtualOrigin`)과 공개키·권한 UI가 닫힌 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. MachineJournal pack 자동 실행 기준을 제품 장수 운영 정책으로 고정한다.

## 2026-07-15 - MachineJournal autoPack 정책 고정

문제:

- 직전 항목에서 512MB pack 비용은 1081ms로 닫혔다.
- 그러나 제품이 직접 `pack()`을 호출해야만 장수 머신 파일 수가 줄어드는 구조면 운영 정책이 라이브러리 밖으로 새고, 소비 제품마다 임계값이 흔들린다.
- 또 `pack()` 후 loose blob이 0개가 되면, 다음 `commit()`이 pack index를 dedupe 대상으로 보지 않아 같은 live blob을 loose 파일로 다시 만들 수 있는 구조 결함이 있었다.

완료:

- `MachineJournal`에 `autoPack` config를 추가했다. 기본은 비활성이고, `autoPack: true`는 loose blob 128개 또는 8MB 이상에서 커밋 직후 pack한다.
- 임계값 128개/8MB는 512MB 실측의 131 keys/8.2MB, pack 1081ms 지점을 기준으로 잡았다.
- 객체 옵션 `autoPack: { looseBlobs, looseMB }`로 소비 제품이 더 빡빡하거나 느슨한 정책을 명시할 수 있게 했다.
- `commit()`이 loose blob뿐 아니라 `PACKS.json`의 packed blob도 dedupe 대상으로 본다. pack 후 no-op 재커밋이 같은 blob을 loose 파일로 재생성하지 않는다.
- `commit()` 결과에 `autoPack` 실행 결과를 붙이고, `MachineJournal.packs`/`packBytes`를 공개 타입에 추가해 정책 발화가 관측 가능하다.
- README, README.ko, 소비 계약, OS 판정표, 대형 힙 봉투 문서에 autoPack 계약을 반영했다.

검증:

- `node tests/browser/run.mjs tests/attempts/pythonMachine/journalPackProbe.html` GREEN 10/10.
- pack 수동 경로: loose 223 -> pack 파일 1개 + loose 0개, pack-only HEAD recover 정상, HEAD 파손 후 PREV fallback 정상.
- autoPack 경로: `autoPack: { looseBlobs: 1, looseMB: 1024 }`에서 커밋 직후 pack 발화, trigger=121, packed=121, loose 0, pack-only recover 정상.
- pack-aware dedupe: pack 후 no-op 재커밋 `wrote=0`, loose 0.

판정:

- 이전 NEXT 3번의 "MachineJournal pack 자동 실행 기준"은 닫혔다.
- 자동 pack은 성능 미지수도, 제품마다 새로 만들어야 하는 임시 정책도 아니다. 라이브러리 계약은 opt-in이고, 기본 정책은 512MB 실측 지점에 맞춘다.
- OS 점수는 70/100을 유지한다. 점수 상승은 제품 소비 배선(`.pymachine` 또는 `VirtualOrigin`)과 공개키·권한 UI가 닫힌 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. 부활 후 fd·socket·DB connection 재개설을 `Init` 또는 소비 제품 boot hook 계약으로 고정한다.

## 2026-07-15 - Init resume hook으로 부활 후 자원 재개설 계약 고정

문제:

- 문서에는 부활 후 fd/socket/DB connection을 다시 열어야 한다는 경고가 있었지만, 호출 계약과 실측 probe가 없었다.
- 힙 델타와 `.pymachine`은 파이썬 힙과 `/home/web` 파일 바이트를 복원하지만, 열린 fd/socket/DB connection의 외부 자원 상태까지 보장하지 않는다.
- Browser OS 간판에서는 부활 후 자원 재개설이 제품마다 임의 boot 코드로 흩어지면 안 된다.

완료:

- `InitConfig.resumePath`를 추가했다. 기본 경로는 `/home/web/resume.py`다.
- `Init.resume(reason)`을 추가했다. `Session.load`, `MachineJournal.recover`, `openMachine` 뒤 소비자가 명시 호출하고, `resume.py`에는 전역 `pyprocResumeReason`을 주입한다.
- `resume.py`가 없으면 no-op으로 끝나게 해 기존 boot/cron 계약과 같은 파일 주도 구조를 유지했다.
- `resumeHookProbe.html`을 추가했다. 세 부활 경로 뒤 `resume.py`가 sqlite connection을 다시 열고, `reason`을 기록하며, 누락 파일 no-op을 확인한다.
- README, README.ko, 소비 계약, OS 판정표, pythonMachine 원장에 `resume.py` 계약을 반영했다.

검증:

- `node tests/browser/run.mjs tests/attempts/pythonMachine/resumeHookProbe.html` GREEN 8/8.
- Session.load 뒤 resume.py 실행 24ms.
- MachineJournal.recover 뒤 resume.py 실행 8ms.
- openMachine 뒤 resume.py 실행 10ms.
- 세 경로 모두 `resumeValue=41`을 유지했고, sqlite connection은 `resumeConn`으로 재개설됐다.

판정:

- 이전 NEXT 3번의 "부활 후 fd·socket·DB connection 재개설 계약"은 닫혔다.
- 힙 델타/머신 이미지는 열린 자원을 보존하지 않고, `resume.py`가 부활 후 다시 연다는 경계가 공개 API 계약이 됐다.
- OS 점수는 70/100을 유지한다. 점수 상승은 제품 소비 배선(`.pymachine` 또는 `VirtualOrigin`)과 공개키·권한 UI가 닫힌 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. 제품별 `resume.py` 자원 정책 카탈로그를 만든다.

## 2026-07-15 - 설치 패키지 consumer gate에 VirtualOrigin URL 동선 추가

문제:

- `VirtualOrigin`은 examples와 runtimeParity probe에서는 성립했지만, 설치된 npm 패키지를 임시 제품 앱에서 소비하는 `test:consumer`는 Runtime/PyProc/SW 등록까지만 봤다.
- 제품 배포에서 중요한 것은 repo 상대 import가 아니라 `node_modules/pyproc` 공개 표면, 설치된 `pyproc-assets`, 등록된 `pyprocSw.js`가 함께 실제 URL fetch를 처리하는지다.
- 기존 `pyprocSw.js`의 ASGI 라우팅은 `pathname.indexOf(ASGI_PREFIX)`라서 `/node_modules/pyproc/...` 안의 `/pyproc/`도 ASGI 경로로 오인할 수 있었다.

완료:

- `tests/browser/productConsumer.mjs`에 설치 패키지 기준 `VirtualOrigin` 소비를 추가했다.
- consumer gate가 `registerPyProcServiceWorker(assetIntegrity, { cache: true, asgi: "/pyproc/", scope: "/" })`로 검증된 SW를 등록하고, 설치된 `boot` + `Runtime.enableAsgiServer` + `VirtualOrigin` 공개 표면만으로 `/pyproc/product/api?value=41` fetch를 Python ASGI까지 보낸다.
- `pyprocSw.js`의 ASGI 매칭을 `pathname` exact prefix로 고쳤다. `/pyproc/...`는 가로채고, `/node_modules/pyproc/...` 같은 패키지 자산은 가로채지 않는다.
- 테스트 문서, 소비 계약, README, OS 판정표에 설치 패키지 consumer gate의 `VirtualOrigin` 동선을 반영했다.

검증:

- 1차 `npm run test:consumer`는 의도치 않게 RED를 만들었다. 원인: `/node_modules/pyproc/src/processOs/ipc.js`가 ASGI prefix에 오인되어 Python JSON 응답으로 바뀌고, `assetIntegrity`가 해시 불일치를 잡았다.
- scope-relative prefix 수리 후 `node tests/browser/run.mjs tests/attempts/runtimeParity/originFidelityProbe.html` GREEN 7/7.
- `npm run test:consumer` GREEN 8/8.
- 실측: originFidelity iframe serve 21ms, timeout 10009ms. Product consumer Runtime boot 3239ms, VirtualOrigin fetch 15ms, PyProc worker run 1706ms.
- VirtualOrigin fetch 뒤에도 PyProc worker graph SRI 검증과 실행이 통과하므로, SW가 설치 패키지 자산을 가로채지 않는다는 회귀 가드가 생겼다.

판정:

- pyproc 자체의 설치 패키지 소비자 표면에서는 `VirtualOrigin` URL 동선이 닫혔다.
- 이것은 codaro 외부 제품의 `VirtualOrigin` 채택을 대체하지 않는다. 다만 pyproc 패키지 구조가 제품 앱 안에서 Runtime, SW, VirtualOrigin, PyProc을 동시에 소비할 수 있음을 증명한다.
- OS 점수는 70/100 유지. 외부 제품의 `.pymachine` 또는 `VirtualOrigin` 채택과 공개키·권한 UI가 다음 상승 조건이다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. VirtualOrigin 쿠키/WS/스트리밍 벽을 product-facing compatibility lab으로 묶는다.

## 2026-07-15 - VirtualOrigin 제품 경계 compatibility lab 고정

문제:

- `VirtualOrigin`은 URL fetch, 헤더, 바이너리, iframe 동선까지 성립했지만, 로컬 서버와 다른 플랫폼 벽은 문서 경고에 가까웠다.
- 제품이 쿠키 세션, WebSocket upgrade, SSE 청크 스트림을 기대하면 pyproc의 가상 오리진이 "되는 척"하다가 런타임에서 어긋난다.
- Browser OS 간판에서는 되는 것뿐 아니라 안 되는 것도 실행 계약이어야 한다. 그래야 소비 제품이 안전한 인증/통신 경로를 고른다.

완료:

- `virtualOriginBoundaryProbe.html`을 추가했다.
- `Set-Cookie` 응답을 Python ASGI 앱에서 실제로 내보낸 뒤, 브라우저 fetch 응답 header와 `document.cookie`, 다음 요청의 `cookie` header를 모두 확인한다.
- `/pyproc/ws` WebSocket 연결을 시도하고, Service Worker/ASGI 경로로 `/ws`가 들어오지 않는지 `seenPaths`로 확인한다.
- ASGI 앱이 `text/event-stream` 응답에서 첫 body 뒤 `asyncio.sleep(0.16)`을 두고 두 번째 body를 보내도록 만들고, fetch가 청크가 아니라 완료 후 일괄 body로 끝나는지 시간과 body로 확인한다.
- 소비 계약, runtimeParity README, 테스트 운영 문서, 아키텍처 질문, OS 판정표에 이 경계를 product-facing compatibility lab으로 반영했다.

검증:

- `node tests/browser/run.mjs tests/attempts/runtimeParity/virtualOriginBoundaryProbe.html` GREEN 4/4.
- Set-Cookie: `header=null`, `document.cookie=(empty)`, 다음 요청 `cookie=(empty)`.
- WebSocket: 결과 `error`, Python ASGI `seenPaths=/set-cookie,/cookie-echo,/state`, `/ws` 없음.
- SSE/streaming: fetch 170ms 뒤 `data: first\n\ndata: second\n\n` 일괄 수신.

판정:

- 이전 NEXT 3번의 "VirtualOrigin 쿠키/WS/스트리밍 벽 product-facing compatibility lab"은 닫혔다.
- VirtualOrigin은 로컬 서버와 같은 척하지 않는다. HTTP 요청/응답, 헤더, 바이너리, iframe 서빙은 제품 표면이고, 쿠키 세션/WebSocket upgrade/청크 스트리밍은 명시 벽이다.
- OS 점수는 70/100 유지. 점수 상승은 외부 제품의 `.pymachine` 또는 `VirtualOrigin` 채택과 공개키·권한 UI가 닫힌 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. 제품별 `resume.py` 자원 정책 카탈로그를 실제 소비 표면에 붙인다.

## 2026-07-15 - resume.py 제품 자원 카탈로그와 Machine demo 적용

문제:

- `Init.resume(reason)`은 API와 probe로 닫혔지만, 제품이 실제로 어떤 자원을 다시 열어야 하는지의 표가 없었다.
- 부활 후 열린 fd/socket/DB connection을 다시 여는 정책이 제품마다 임의 코드로 흩어지면 `.pymachine`과 journal의 OS 구조가 약해진다.
- 대표 제품 표면인 Machine demo도 `Session.load`와 `openMachine` 뒤 `resume.py`를 호출하지 않아, 공개 데모가 소비 계약을 완전히 보여주지 못했다.

완료:

- `examples/machine.html`에 실제 `/home/web/resume.py` 사용을 추가했다.
- Machine demo는 첫 부팅 또는 부활 뒤 `resume.py`로 `appDb` SQLite connection을 열고, `resumeEvent` 테이블에 `fresh.boot`, `session.load`, `openMachine` 같은 reason을 기록한다.
- signed `.pymachine` cast 후 `openMachine`에서도 runtime의 `/home/web`을 OPFS로 다시 연결하고 `resume.py`를 실행해 `appDb`를 재개설한다.
- 새 문서 `docs/consuming/resumeCatalog.md`를 추가했다. 공통 계약, reason 값, 현재 고정 표면, codaro/dartlab/xlpod/외부 제품별 재개설 정책을 한 곳에 묶었다.
- 소비 계약, docs 지도, 테스트 운영 문서, README/README.ko, OS 판정표, 대형 힙 봉투, 아키텍처 질문을 카탈로그 기준으로 갱신했다.

검증:

- `node tests/browser/run.mjs examples/machine.html?gate=1` GREEN 1/1.
- `npm run test:examples` GREEN 9/9.
- `npm test` GREEN 578/578.
- Machine demo gate에서 `fresh.boot`로 `appDb`를 열고, 사용자 코드 실행 후 signed `.pymachine` cast, `openMachine`, `resume.py` 재실행까지 통과했다.
- 실측 출력: `resume.py: reopened appDb (openMachine, events=3)`, signed machine size 11.1MB.

판정:

- 이전 NEXT 3번의 "제품별 resume.py 자원 정책 카탈로그를 실제 소비 표면에 붙인다"는 pyproc 내부 표면에서는 닫혔다.
- 남은 것은 codaro/dartlab/xlpod 같은 외부 제품 gate다. 즉 카탈로그와 대표 demo는 정본이 됐고, 외부 제품 적용은 별도 제품 소비 축으로 남긴다.
- OS 점수는 70/100 유지. 점수 상승은 외부 제품 `.pymachine` 또는 `VirtualOrigin` 채택과 공개키·권한 UI가 닫힌 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다.
3. 외부 제품의 `resume.py` 정책을 제품 gate로 고정한다.

## 2026-07-15 - 공개키 fingerprint와 권한 UI 계약 고정

문제:

- `.pymachine` signature와 `MachineJail`은 있었지만, 제품 UI가 사용자에게 어떤 공개키를 신뢰하는지 안정적으로 보여줄 공개 API가 없었다.
- Machine demo는 trusted key를 자체 로컬 해시로 표시했고, 권한 정책은 UI에 드러나지 않았다.
- signature는 출처 검증이고 권한 승인이 아니다. 이 둘을 분리한 제품 계약이 없으면 `trust: true` 같은 이진 승인으로 회귀하기 쉽다.

완료:

- `fingerprintMachinePublicKey(key)`를 공개 API로 추가했다. CryptoKeyPair, CryptoKey, JWK를 받아 안정적인 `sha256:<hex>` fingerprint를 만든다.
- `machineImageProbe.html`에 fingerprint 안정성 검증을 추가했다. 같은 키의 CryptoKeyPair와 JWK가 같은 fingerprint를 내야 한다.
- `examples/machine.html`이 로컬 해시 구현을 버리고 `fingerprintMachinePublicKey()`를 사용한다.
- Machine demo UI에 signer fingerprint와 permission policy를 표시한다: `home=yes, net=no, clipboard=no, workers=no`, `MachineJail.connectSrc()` 기준 `connect-src 'self'`.
- `docs/consuming/trustPermissions.md`를 추가했다. 공개키 JWK 배포, fingerprint 표시, `openMachine({ trustedPublicKeys, requireSignature: true })`, `trust: true` 금지, MachineJail 권한 UI, 제품별 적용을 한 문서에 묶었다.
- README/README.ko, 소비 계약, 테스트 운영 문서, pythonMachine/largeHeap README, OS 아키텍처/판정표/대형 힙 봉투를 새 계약에 맞췄다.

검증:

- `node tests/browser/run.mjs tests/attempts/pythonMachine/machineImageProbe.html` GREEN 12/12.
- `node tests/browser/run.mjs examples/machine.html?gate=1` GREEN 1/1.
- `npm run test:examples` GREEN 9/9.
- 1차 `npm test`는 RED였다. 원인: 새 문서 `docs/consuming/trustPermissions.md`가 아직 git index에 없어 링크 가드가 CI 기준 죽은 링크로 판정했다. stage 후 재실행한다.
- stage 후 `npm test` GREEN 583/583.
- `npm run test:browser` GREEN 47/47.
- 실측: fingerprint `sha256:4c7f3bc29416cb70...`, `.pymachine` export 15MB/89ms, trusted key open 2101ms.

판정:

- 이전 NEXT 2번의 "공개키 배포와 권한 UI를 소비 제품 계약으로 고정한다"는 pyproc 내부 계약과 대표 demo 표면에서는 닫혔다.
- 남은 것은 codaro/dartlab/xlpod 같은 외부 제품 gate다. 즉 공개 API, 카탈로그, Machine demo는 정본이 됐고, 외부 제품 적용은 제품 소비 축으로 남긴다.
- OS 점수는 70/100 유지. 점수 상승은 외부 제품 `.pymachine` 또는 `VirtualOrigin` 채택과 외부 제품 trust/permission UI gate가 닫힌 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포와 권한 UI를 외부 제품 gate로 고정한다.
3. 외부 제품의 `resume.py` 정책을 제품 gate로 고정한다.

## 2026-07-15 - PyProc.matmul parts 공개 타입과 입력 계약 고정

문제:

- Speed Lab과 numericShard probe는 이미 `PyProc.matmul(a, b, { parts })`를 쓰고 있었지만, `index.d.ts`의 공개 타입은 `matmul(a, b)`만 선언했다.
- 구현은 `parts`를 받았지만 0, 음수, 소수 같은 잘못된 병렬도 입력이 명시 계약 에러가 아니라 우발적인 JS 배열 길이 오류나 기본값 우회로 수렴할 수 있었다.
- 속도 표면은 데모 코드만 빨라서는 안 되고, 소비자가 TypeScript와 런타임 양쪽에서 같은 계약을 보아야 한다.

완료:

- `PyProcShardOptions`와 `PyProcMatmulOptions`를 공개 타입에 추가했다.
- `mapArray()`와 `matmul()`의 `parts`를 양의 정수로 검증하고, 풀 크기와 행 수를 넘으면 안전하게 clamp한다.
- `matmul()`은 `taskTimeoutMs`도 내부 `map()`에 전달하므로 무거운 샤딩 작업의 timeout 계약이 public option과 맞는다.
- `matmulSurfaceProbe.html`에 잘못된 `parts` 거부 검증을 추가했다.
- README, README.ko, 소비 계약, numericShard 원장을 `matmul(a, b, { parts })` 기준으로 정리했다.
- `tests/run.mjs`가 d.ts의 샤딩 옵션 선언과 `matmul` 시그니처를 구조 게이트로 검사한다.

검증:

- `npm test` GREEN 584/584.
- `node tests/browser/run.mjs tests/attempts/numericShard/matmulSurfaceProbe.html` 1차 RED 5/6. 기능 검증은 모두 PASS였고, 단발 속도 gate만 1.65x로 흔들렸다.
- 같은 probe 재실행 GREEN 6/6: 단일워커 4390ms, 전 워커 2163ms, 2.03x.
- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples` GREEN 9/9. Speed Lab은 768x768 f64에서 3.67x(1827ms -> 498ms).
- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:browser` GREEN 47/47.

판정:

- `PyProc.matmul(..., { parts })`는 데모 관례가 아니라 공개 타입, 런타임 검증, 브라우저 probe가 맞물린 속도 API 계약이 됐다.
- OS 점수는 70/100 유지한다. 이 작업은 라이브러리 구조와 speed surface 정합을 닫는 수리이지, 외부 제품 소비 배선 자체는 아니다.
- 단발 배속 gate는 환경 민감도가 확인됐다. 다음 속도 꼭지는 threshold를 낮추는 게 아니라 반복 벤치/median/p95 봉투로 분리하는 것이다.

NEXT:

1. Speed Lab과 numericShard 속도 gate를 단발 threshold가 아니라 반복 벤치/median/p95 봉투로 구조화한다.
2. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
3. 공개키 배포, 권한 UI, `resume.py` 정책을 외부 제품 gate로 고정한다.

## 2026-07-15 - Speed Lab 반복 벤치 봉투 고정

문제:

- 직전 `matmulSurfaceProbe`는 기능은 모두 PASS였지만 단발 speedup만 1.65x로 흔들린 적이 있다.
- 속도 주장을 단 한 번의 wall time에 걸면 브라우저 스케줄링, 첫 BLAS lane, 헤드리스 부하에 흔들린다.
- threshold를 낮추는 것은 목표와 어긋난다. 반복 샘플, median, p95 latency 봉투로 속도 주장의 형태를 고쳐야 한다.

완료:

- `examples/speedLab.html`을 3회 warmed sample 벤치로 바꿨다.
- public demo는 median speedup, single/shard median, single/shard p95, max sample error를 UI와 gate report에 표시한다.
- Speed Lab gate는 `maxErr < 1e-9`, `medianSpeedup >= 2.0`, `shard p95 < single median`을 동시에 요구한다.
- `matmulSurfaceProbe.html`도 같은 반복 벤치 봉투로 바꿨다.
- 첫 구현의 1024x1024 반복 surface gate는 GREEN이었지만 150초까지 늘었다. 상시 surface probe에는 과하므로 768x768로 조정하고, 1024급 선형성은 heavy `shardMatmulProbe`에 남겼다.
- 테스트 운영 문서, 데모 호스팅 문서, README/README.ko, numericShard 원장을 반복 벤치 기준으로 갱신했다.

검증:

- `npm test` GREEN 584/584.
- `PYPROC_INDEX_URL=/vendor/pyodide/ node tests/browser/run.mjs tests/attempts/numericShard/matmulSurfaceProbe.html` GREEN 7/7.
- numericShard 반복 실측: 768x768 f64, 3회 warmed sample, single median 1442ms, shard median 650ms, median speedup 2.22x, shard p95 659ms, maxErr 0.00.
- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples` GREEN 9/9.
- Speed Lab 반복 실측: 768x768 f64, 3회 warmed sample, single median 1430ms, shard median 547ms, median speedup 2.52x, shard p95 604ms, maxErr 0.00.

판정:

- 이전 NEXT 1번의 "Speed Lab과 numericShard 속도 gate를 반복 벤치/median/p95 봉투로 구조화한다"는 닫혔다.
- 속도 주장은 단발 스파이크가 아니라 반복 샘플의 중심값과 tail latency까지 포함하는 계약이 됐다.
- OS 점수는 70/100 유지한다. 외부 제품 소비 배선이 아니라 내부 speed surface 품질과 재현성 개선이다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포, 권한 UI, `resume.py` 정책을 외부 제품 gate로 고정한다.
3. WebVM/JupyterLite/marimo 대비 정면 벤치 표를 Speed Lab 방식의 반복 봉투로 설계한다.

## 2026-07-15 - 반복 벤치 통계 helper 공유

문제:

- Speed Lab과 `matmulSurfaceProbe.html`이 같은 반복 벤치 계약을 각자 구현했다.
- median/p95 계산과 green 판정이 두 곳에 중복되면 다음 속도 gate 조정 때 데모와 probe가 갈라진다.
- 이 로직은 런타임 공개 API가 아니라 측정 표면의 계약이므로 `src/` 공개 능력으로 올리면 오해가 생긴다.

완료:

- `examples/benchStats.js`를 추가했다.
- `percentile()`, `median()`, `summarizePairedLatencyBench()`, `isShardedSpeedBenchGreen()`를 단일 helper로 묶었다.
- `examples/speedLab.html`과 `tests/attempts/numericShard/matmulSurfaceProbe.html`이 같은 helper를 import하게 했다.
- `tests/run.mjs`에 "Speed Lab 반복 벤치 통계 helper 공유" 구조 가드를 추가했다. helper export와 두 소비 파일의 import 경로가 갈라지면 Node gate가 막는다.

검증:

- `npm test` GREEN 588/588.
- `PYPROC_INDEX_URL=/vendor/pyodide/ node tests/browser/run.mjs tests/attempts/numericShard/matmulSurfaceProbe.html` GREEN 7/7.
- numericShard 반복 실측: 768x768 f64, 3회 warmed sample, single median 1315ms, shard median 490ms, median speedup 2.68x, shard p95 490ms.
- `PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:examples` GREEN 9/9.
- Speed Lab 반복 실측: single median 1347ms, shard median 472ms, median speedup 2.90x, shard p95 477ms.

판정:

- 반복 벤치 계약은 이제 문서상 원칙이 아니라 공유 구현과 구조 가드를 가진다.
- 이 작업은 속도 자체를 올린 것이 아니라, 속도 주장의 측정 구조와 라이브러리 품질을 개선한 것이다.

NEXT:

1. codaro 다음 소비 축은 `.pymachine` 세션 이미지 또는 `VirtualOrigin` 중 하나로 잡는다.
2. 공개키 배포, 권한 UI, `resume.py` 정책을 외부 제품 gate로 고정한다.
3. WebVM/JupyterLite/marimo 대비 정면 벤치 표를 Speed Lab 방식의 반복 봉투로 설계한다.

## 2026-07-15 - 설치 패키지 제품 게이트에 signed machine 동선 추가

문제:

- `npm run test:consumer`는 설치된 패키지 기준으로 public specifier, SRI, SW 등록, `VirtualOrigin`, `PyProc` worker를 검증했지만, 브라우저 OS의 핵심인 signed `.pymachine`, trust fingerprint, 권한 manifest, `resume.py` 자원 재개설까지는 제품 소비자 관점에서 묶지 못했다.
- Machine demo와 attempts는 repo 상대 import 경로라 "라이브러리 내부에서는 되지만 설치 소비 앱에서 깨지는" 결함을 막는 근거가 약했다.
- 외부 제품으로 바로 건너가기 전에 pyproc이 소유한 설치 패키지 소비자 게이트가 제품 시나리오의 최소 계약을 강제해야 한다.

완료:

- `tests/browser/productConsumer.mjs`의 설치 앱 import를 `bootSession`, `openMachine`, `createMachineKeyPair`, `exportMachinePublicKey`, `fingerprintMachinePublicKey`, `MachineJail`까지 넓혔다.
- 같은 headless 소비 앱이 `MachineJail({ net:false, clipboard:false, home:true, workers:false })`를 설치하고, policy object와 Python `pyprocJail` 초크포인트가 같은 권한을 집행하는지 검증한다.
- 설치 앱이 `/home/web/resume.py`와 SQLite DB 상태를 가진 세션을 signed `.pymachine`으로 export하고, signer fingerprint 안정성, 무신뢰 공개키 거부, wrong key 거부, trusted public key open을 검증한다.
- trusted open 뒤 `Init.resume("product.openMachine")`을 실행해 `/home/web/product/state.txt`와 `resume.db` row 2개가 살아 있는지 확인한다.
- 소비 계약, 테스트 운영 문서, OS 판정표를 "설치 패키지 게이트는 닫힘, 실제 외부 제품 UI gate는 남음"으로 맞췄다.

검증:

- `node --check tests/browser/productConsumer.mjs` PASS.
- `npm test` GREEN 588/588.
- `npm run test:consumer` GREEN 15/15.
- 실측: Runtime boot 3662ms, VirtualOrigin 18ms, PyProc worker 1646ms, machine boot 1540ms, signed `.pymachine` 10.8MB export 57ms, trusted open 1706ms.

판정:

- pyproc이 직접 통제하는 설치 패키지 소비자 게이트는 이제 Browser Python OS 제품 최소 흐름을 한 번에 검증한다: 실행 자산 SRI, Python URL server, worker process, 권한 manifest, signed machine image, resume hook.
- 이것은 codaro/dartlab/xlpod 같은 실제 외부 제품 적용을 대체하지 않는다. 다만 외부 제품이 붙어야 할 계약을 `node_modules/pyproc` 소비 앱에서 먼저 고정했으므로, 다음 외부 배선의 실패 원인을 제품 UI/배포키/라우팅으로 좁힐 수 있다.
- OS 점수는 70/100 유지한다. 75점대 제품 표면 구간은 실제 외부 제품 gate에서 `.pymachine` 또는 `VirtualOrigin` UI 동선을 닫은 뒤 재산정한다.

NEXT:

1. codaro 다음 소비 축을 signed `.pymachine` 세션 이미지 또는 `VirtualOrigin` UI 채택 중 하나로 고정한다.
2. 외부 제품의 공개키 배포, 권한 UI, `resume.py` 정책을 gate로 닫는다.
3. WebVM/JupyterLite/marimo 대비 정면 벤치 표를 Speed Lab 방식의 반복 봉투로 설계한다.

## 2026-07-15 - 속도 정면 비교 계약 고정

문제:

- Speed Lab은 pyproc 내부 속도 간판으로 정리됐지만, WebVM/JupyterLite/marimo 대비 표를 만들 때 어떤 scenario와 sample 규칙으로 비교할지 아직 문서 계약이 없었다.
- 비교 표가 먼저 생기면 측정 조건이 섞이고, 단발 수치나 서로 다른 일을 비교한 숫자가 README 문구로 올라갈 위험이 있다.
- 속도 목표를 강하게 밀려면 외부 비교 전에 "무엇을 재고, 무엇을 주장하지 않는가"부터 기계 가드로 고정해야 한다.

완료:

- `docs/operations/benchmarking.md`를 추가했다. 속도 주장 금지 조건, 실측 봉투 필드(commit/command/browser/host/engine/scenario/samples/metrics/raw output), canonical scenario S0-S4를 정했다.
- canonical scenario는 basic boot, NumPy sharded matmul, process map, browser server, signed machine resume로 잡았다.
- `mainPlan/browser-os-north-star/06-speed-comparison.md`를 추가했다. WebVM/JupyterLite/marimo 비교 matrix는 측정 슬롯만 만들고, 외부 성능 주장은 전부 "미측정/보류"로 둔다.
- docs 지도, 테스트 운영 문서, browser-os 이니셔티브 지도를 새 벤치 계약에 연결했다.
- `tests/run.mjs`에 "속도 비교 벤치 계약 고정" 구조 가드를 추가했다. S0-S4, median/p95/raw output, WebVM/JupyterLite/marimo, 실측 봉투 필드, 문서 지도 링크가 빠지면 `npm test`가 실패한다.

검증:

- `node --check tests/run.mjs` PASS.
- `npm test` GREEN 595/595.

판정:

- 이전 NEXT 3번의 "WebVM/JupyterLite/marimo 대비 정면 벤치 표를 Speed Lab 방식의 반복 봉투로 설계한다"는 계약 단계에서는 닫혔다.
- 아직 외부 실측은 없다. 다음 상승 조건은 S1부터 실제 외부 후보를 같은 브라우저/머신에서 측정하고, raw output을 원장에 남기는 것이다.
- OS 점수는 70/100 유지한다. 이 작업은 속도 비교의 구조를 닫은 것이고, 실제 상대 성능 증명은 다음 단계다.

NEXT:

1. S1 NumPy sharded matmul부터 WebVM/JupyterLite/marimo 중 실행 가능한 후보를 실제 측정한다.
2. pyproc Speed Lab raw report를 JSON으로 저장하는 옵션을 검토한다.
3. codaro 다음 소비 축을 signed `.pymachine` 세션 이미지 또는 `VirtualOrigin` UI 채택 중 하나로 고정한다.

## 2026-07-15 - Speed Lab raw JSON 벤치 러너 추가

문제:

- 속도 비교 계약은 생겼지만, Speed Lab의 S1 결과가 `/gateReport`의 사람이 읽는 문자열에만 묶여 있었다.
- 외부 후보와 비교하려면 pyproc 기준점부터 commit, command, browser, host, engine, samples, metrics를 JSON으로 남겨야 한다.
- 브라우저 버전이나 dirty worktree 여부가 빠지면 나중에 숫자의 출처를 재현하기 어렵다.

완료:

- `examples/speedLab.html`의 gate report에 `scenario: "S1"`, config, boot timing, boot summary, `bench` 객체를 싣게 했다.
- `tests/browser/speedBench.mjs`를 추가했다. headless Chromium으로 Speed Lab만 실행하고, `--out <path>` 또는 `PYPROC_BENCH_OUT=<path>`로 raw JSON artifact를 저장한다.
- artifact에는 schemaVersion, scenario, command, commit, worktreeDirty, browser path/version, host CPU/메모리, engine indexURL, raw report, metrics를 담는다.
- `package.json`에 `npm run bench:speed`를 추가했다.
- `tests/run.mjs` 구조 가드가 `bench:speed`, `speedBench.mjs`, Speed Lab S1 JSON report 계약을 확인한다.
- 벤치마크 운영 문서, 테스트 문서, 속도 비교 matrix를 새 러너 기준으로 갱신했다.

검증:

- `node --check tests/browser/speedBench.mjs` PASS.
- `npm test` GREEN 598/598.
- `npm run bench:speed -- --out .tmp/speed-s1.json` GREEN.
- S1 실측: Edge 150.0.4078.65, 768x768 f64, 3 warmed samples, single median 1524ms, shard median 491ms, median speedup 3.10x, shard p95 500ms, maxErr 0.

판정:

- 이전 NEXT 2번의 "pyproc Speed Lab raw report를 JSON으로 저장하는 옵션"은 닫혔다.
- 이제 외부 후보 측정은 같은 JSON 봉투를 목표 형식으로 삼을 수 있다.
- OS 점수는 70/100 유지한다. 속도 비교의 증거 파이프라인이 닫힌 것이고, 실제 외부 비교 수치는 다음 단계다.

NEXT:

1. S1 NumPy sharded matmul부터 WebVM/JupyterLite/marimo 중 실행 가능한 후보를 실제 측정한다.
2. 외부 후보 raw artifact도 S1 JSON 봉투에 맞춘다.
3. codaro 다음 소비 축을 signed `.pymachine` 세션 이미지 또는 `VirtualOrigin` UI 채택 중 하나로 고정한다.

## 2026-07-15 - S1 벤치 artifact 비교 CLI 추가

문제:

- `bench:speed`는 pyproc S1 JSON을 만들지만, 여러 후보 JSON을 같은 표로 합치고 schema를 검증하는 도구가 없었다.
- 외부 후보를 측정하더라도 수동 복사 표가 되면 candidate, dirty SHA, browser, sample 수, p95 같은 필드가 빠질 수 있다.
- 비교 표 생성 자체가 기계화되어야 외부 후보 측정이 구조화된다.

완료:

- `tests/browser/benchCompare.mjs`를 추가했다. S1 JSON artifact들을 읽어 schemaVersion, scenario, candidate, metrics, samples 길이를 검증하고 Markdown 비교 표를 출력한다.
- `benchCompare`는 `notApplicableReason`도 지원한다. 외부 후보가 같은 시나리오를 수행하지 못하면 0점이 아니라 N/A 행으로 남길 수 있다.
- `tests/browser/speedBench.mjs` artifact에 `candidate: "pyproc"`을 추가했다.
- `package.json`에 `npm run bench:compare`를 추가했다.
- `tests/run.mjs` 구조 가드가 `bench:compare`, `benchCompare.mjs`, `candidate`, `medianSpeedup`, `notApplicableReason`, `renderMarkdown`을 고정한다.
- 벤치마크 운영 문서와 속도 비교 matrix에 `bench:compare` 사용법을 추가했다.

검증:

- `node --check tests/browser/benchCompare.mjs` PASS.
- `node --check tests/browser/speedBench.mjs` PASS.
- `npm test` GREEN 601/601.
- `npm run bench:speed -- --out .tmp/pyproc-s1.json` GREEN.
- `npm run bench:compare -- .tmp/pyproc-s1.json --out .tmp/s1-compare.md` PASS.
- 샘플 비교 행: pyproc, single median 1462ms, shard median 516ms, shard p95 520ms, median speedup 2.89x, maxErr 0.

판정:

- 외부 후보 측정 전 마지막 구조 축이 닫혔다. 이제 S1 후보 artifact를 만들면 표 생성과 schema 검증이 자동이다.
- OS 점수는 70/100 유지한다. 실제 외부 후보 숫자는 아직 없다.

NEXT:

1. S1 NumPy sharded matmul부터 WebVM/JupyterLite/marimo 중 실행 가능한 후보를 실제 측정한다.
2. 외부 후보 raw artifact를 `candidate`와 `notApplicableReason` 규칙까지 포함해 저장한다.
3. codaro 다음 소비 축을 signed `.pymachine` 세션 이미지 또는 `VirtualOrigin` UI 채택 중 하나로 고정한다.

## 2026-07-15 - 공개 import 경계 게이트 추가

문제:

- pyproc는 재사용 라이브러리이므로 제품과 예제는 root API와 안정 subpath만 소비해야 한다.
- `src/` 내부 경로 deep import 금지는 문서 계약으로는 있었지만, 공개 예제가 실수로 내부 파일을 module import해도 막는 기계 가드가 없었다.
- `src/` 내부 상대 module 참조도 파일 이동 때 깨질 수 있으므로 구조 게이트가 필요했다.

완료:

- `tests/run.mjs`에 JS module 참조 추출 helper를 추가했다. 정적 import/export, dynamic import, `importScripts`, `new URL(..., import.meta.url)`를 같은 방식으로 본다.
- `src module 참조 실존` 게이트를 추가했다. `src/` 내부 상대 참조는 `.js` 확장자를 가진 실제 `src/` 파일이어야 한다.
- `exports 안정 subpath 고정` 게이트를 추가했다. `package.json exports`는 `.`, `./assets`, `./runtime`, `./reactive`, `./syscall-bridge`, `./process-os`, `./worker`만 허용한다.
- `examples는 공개 표면으로만 pyproc 소비` 게이트를 추가했다. 공개 예제가 `src/`를 module import하면 실패한다. `serverDevSw.js`의 Service Worker 정적 wrapper만 좁은 예외로 유지했다.
- 테스트 운영 문서, 소비 계약, OS 아키텍처 표를 새 구조 게이트에 맞췄다.

검증:

- `node --check tests/run.mjs` PASS.
- `npm test` GREEN 604/604.

판정:

- 라이브러리 구조의 핵심 경계 하나가 관례에서 기계 게이트로 이동했다.
- 이번 작업은 내부 레이어 순환을 한 번에 제거한 것이 아니다. 현재 현실과 맞지 않는 이상 규칙을 걸지 않고, 공개 소비 경계와 참조 실존성부터 잠갔다.

NEXT:

1. S1 NumPy sharded matmul부터 WebVM/JupyterLite/marimo 중 실행 가능한 후보를 실제 측정한다.
2. 내부 `src/` 레이어 graph를 별도로 산출하고, 허용 edge와 제거할 cycle을 나눠 다음 구조 게이트로 좁힌다.
3. codaro 다음 소비 축을 signed `.pymachine` 세션 이미지 또는 `VirtualOrigin` UI 채택 중 하나로 고정한다.
