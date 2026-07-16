# largeHeapEnvelope - 대형 힙에서 OS 프리미티브 비용은 어디서 무너지는가

## 가설

Browser Python OS 간판의 가장 약한 지점은 기능 부재가 아니라 O(힙) 비용이다. checkpoint, restore, session save/load, journal commit/recover, fork가 500MB 이상 힙에서 어느 비용 곡선을 보이는지 실측하면 "로컬급" 주장 가능 범위를 정확히 자를 수 있다.

## 졸업 게이트

아래 수치가 Edge 또는 Chrome 실측으로 기록되면 졸업한다.

1. 64MB smoke가 GREEN이고, 측정 항목이 정상 수집된다.
2. 500MB 이상에서 checkpoint, restoreLive, session save, session load가 수치로 기록된다.
3. journal commit/recover는 별도 옵션으로 최소 128MB 이상 수치 또는 명시적 실패 원인이 기록된다.
4. 결과가 [완료된 Browser OS 판정표](../../../mainPlan/_done/browser-os-north-star/04-os-verdict-v2.md)의 OS 판정 보류 사유를 갱신한다.

## 실행

기본 smoke:

```sh
node tests/browser/run.mjs tests/attempts/largeHeapEnvelope/largeHeapProbe.html
node tests/browser/run.mjs tests/attempts/largeHeapEnvelope/forkLiveLargeProbe.html
```

500MB 이상 수동 실측:

```sh
PYPROC_GATE_TIMEOUT=900000 node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/largeHeapProbe.html?target=512"
PYPROC_GATE_TIMEOUT=900000 node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/forkLiveLargeProbe.html?target=512"
```

journal CAS 커밋 포함:

```sh
PYPROC_GATE_TIMEOUT=900000 node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/largeHeapProbe.html?target=128&journal=1"
PYPROC_GATE_TIMEOUT=900000 node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/largeHeapProbe.html?target=512&journal=1"
PYPROC_GATE_TIMEOUT=900000 node tests/browser/run.mjs "tests/attempts/largeHeapEnvelope/largeHeapProbe.html?target=512&pack=1"
```

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-14 | largeHeapProbe | Edge headless, 로컬 COOP+COEP | 64MB smoke GREEN 7/7. heap 88.8MB, checkpoint 1072p/67MB 82ms, restoreLive 109p/6.81MB 40ms, Session.save 66.9MB 806ms, Session.load 2320ms | 측정 장치 성립. 64MB 구간에서는 session save/load가 실용 범위지만, OS 판정의 보류 사유를 닫으려면 500MB 이상이 필요하다 | 512MB 실행 후 비용 곡선 기록. journal=1은 별도 실행 |
| 2026-07-14 | largeHeapProbe?target=512 | Edge headless, 로컬 COOP+COEP | 512MB GREEN 7/7. heap 536.8MB, checkpoint 8240p/515MB 552ms, restoreLive 109p/6.81MB 225ms, Session.save 514.9MB 3665ms, Session.load 3191ms | 500MB급 checkpoint/session 봉투는 성립. 대형 힙에서 병목은 checkpoint보다 저장/전송량이며, restoreLive는 변경 109p만 써서 225ms로 수렴 | journal=1 128MB 이상, fork 512MB 별도 측정 |
| 2026-07-14 | largeHeapProbe?target=128&journal=1 | Edge headless, 로컬 COOP+COEP | 1차 RED: commit 후 recover가 작은 새 커널에서 실패. `MachineJournal` 성장 복구 수리 후 GREEN 9/9. checkpoint 131MB 174ms, Session.save 130.9MB 1279ms, Session.load 2763ms, journal.commit 5593ms(wrote 8.2MB), journal.recover 9116ms | 저널도 성장 힙 복구 계약이 필요했다. 수리 후 128MB WAL은 성립하지만 recover 9.1s로 무겁다 | journal 512MB 또는 pack/prune 설계 판단, fork 512MB 측정 |
| 2026-07-15 | forkLiveLargeProbe | Edge headless, 로컬 COOP+COEP | 64MB GREEN 7/7. delta 1075p/67.2MB, harvest 51.5ms, apply 32.8ms | forkLive 대형 측정 장치 성립. 워커-워커 cp0 결정성 유지 | 512MB 실행 |
| 2026-07-15 | forkLiveLargeProbe?target=512 | Edge headless, 로컬 COOP+COEP | 512MB GREEN 7/7. parent heap 536.8MB, delta 8243p/515.2MB, harvest 132.3ms, apply 187.4ms | 500MB급 live fork는 강하게 성립. session save/load보다 훨씬 빠른 이유는 OPFS 저장 없이 워커 간 델타 전송+적용만 하기 때문 | journal pack/prune 판단, OS 판정표 점수 재검토 |
| 2026-07-15 | largeHeapProbe?target=512&journal=1 | Edge headless, 로컬 COOP+COEP | 512MB GREEN 9/9. checkpoint 515MB 454ms, Session.save 514.9MB 3756ms, Session.load 2879ms, journal.commit 14047ms(wrote 8.2MB), journal.recover 24769ms | 512MB WAL도 성립. 그러나 commit 14s/recover 24.8s는 속도 목표의 다음 병목이다. pack/prune 또는 map 파일 단축이 필요하다 | journal pack/prune 이니셔티브 또는 `MachineJournal` 포맷 최적화 설계 |
| 2026-07-15 | largeHeapProbe?target=512&journal=1, journal cache 후 | Edge headless, 로컬 COOP+COEP | 512MB GREEN 9/9. checkpoint 515MB 497ms, Session.save 514.9MB 4434ms, Session.load 3193ms, journal.commit 2895ms(wrote 8.2MB), journal.recover 2312ms | 반복 blob key를 커밋 중 1회만 확인하고 recover 중 1회만 읽게 하자 journal 병목이 2-3초대로 내려왔다. HEAD/blob 포맷은 호환 유지 | `.pymachine` v2(`/home` 포함), 신뢰 체인, 장기 pack/prune |
| 2026-07-15 | largeHeapProbe?target=512&pack=1 | Edge headless, 로컬 COOP+COEP | 512MB GREEN 11/11. checkpoint 515MB 538ms, Session.save 514.9MB 3740ms, Session.load 2700ms, journal.commit 2702ms(wrote 8.2MB), journal.recover 2490ms, journal.pack 1081ms(131 keys/8.2MB, loose 131->0), pack-only recover 2481ms | 512MB급 장수 머신에서도 pack 비용은 약 1.1s, recover는 pack-only에서도 2.5s로 유지된다. loose blob 누적을 줄이는 구조가 속도 봉투 안에 들어왔다 | `autoPack: true` 기본 기준은 loose 128개 또는 8MB. 소비 제품은 명시 임계값으로 더 조정 가능 |

## 판정

진행 중. 512MB checkpoint/session/fork/journal 수치는 확보했고 journal 반복 blob IO 병목과 pack/prune 장기 파일 수 축도 1차 해소했다. 다음 목표는 제품 표면의 `.pymachine`/`VirtualOrigin` 소비와 외부 제품 trust/permission UI gate다.
