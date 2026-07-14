# 05. 대형 힙 성능 봉투 - 512MB 실측과 journal 최적화

작성: 2026-07-14. 갱신: 2026-07-15. 정본 probe: [largeHeapEnvelope](../../tests/attempts/largeHeapEnvelope/README.md), [journalPackProbe](../../tests/attempts/pythonMachine/journalPackProbe.html).

## 한 줄 판정

**512MB 사용자 힙에서 checkpoint/session save/load/forkLive/journal은 모두 성립하고, journal recover 병목은 24.8s에서 2.3-2.5s로 줄었다.** 500MB 이상 힙이 막연한 미검증 구간이던 상태는 해소됐다. 장기 OPFS 파일 수 축은 `MachineJournal.pack()`/`prune()`으로 구조를 닫았고, 512MB급 pack도 1.1s로 실측됐다. `autoPack`은 loose 128개 또는 8MB 기준의 opt-in 정책으로 고정했다. 부활 후 프로세스 자원 재개설은 `Init.resume(reason)`과 `/home/web/resume.py` 계약, Machine demo 적용, resume catalog까지 닫았다. 공개키/권한 UI는 fingerprint API와 trust/permission contract까지 닫았다. 남은 병목은 외부 제품 배선과 외부 제품 UI gate다.

## 실측표

환경: Edge headless, 로컬 COOP+COEP, Pyodide v314.0.2.

| target | heap | checkpoint | restoreLive | Session.save | Session.load | forkLive | journal |
|---:|---:|---:|---:|---:|---:|---:|---|
| 64MB | 88.8MB | 1072p/67MB, 82ms | 109p/6.81MB, 40ms | 66.9MB, 806ms | 2320ms | harvest 51.5ms, apply 32.8ms | 미측정 |
| 128MB | 152.8MB | 2096p/131MB, 174ms | 109p/6.81MB, 105ms | 130.9MB, 1279ms | 2763ms | 미측정 | commit 5593ms, recover 9116ms |
| 512MB 1차 | 536.8MB | 8240p/515MB, 552ms | 109p/6.81MB, 225ms | 514.9MB, 3665ms | 3191ms | harvest 132.3ms, apply 187.4ms | commit 14047ms, recover 24769ms |
| 512MB journal 캐시 후 | 536.8MB | 8240p/515MB, 497ms | 109p/6.81MB, 223ms | 514.9MB, 4434ms | 3193ms | harvest 132.3ms, apply 187.4ms | commit 2895ms, recover 2312ms |
| 512MB journal pack 후 | 536.8MB | 8240p/515MB, 538ms | 109p/6.81MB, 222ms | 514.9MB, 3740ms | 2700ms | harvest 132.3ms, apply 187.4ms | commit 2702ms, recover 2490ms, pack 1081ms, pack-only recover 2481ms |

## 해석

1. **checkpoint는 선형 비용이지만 512MB에서 552ms다.** OS 간판을 바로 깨는 수준은 아니다.
2. **restoreLive는 변경 페이지 수에 좌우된다.** 512MB payload 전체가 있어도 되돌린 페이지가 109p라 225ms였다.
3. **session save/load는 저장량이 병목이다.** 512MB 저장 3.7s, 로드 3.2s는 "즉시"는 아니지만 머신 이미지/부활 동선으로는 실용 범위다.
4. **forkLive는 512MB에서도 빠르다.** 수확 132.3ms, 적용 187.4ms다. OPFS 저장이 없고 워커 간 델타 전송+적용이라 session save/load보다 훨씬 작다.
5. **journal의 반복 blob IO 병목은 1차 해소됐다.** 512MB에서 commit 14.0s -> 2.9s, recover 24.8s -> 2.3s다. 실제 신규 blob은 8.2MB뿐인데 같은 content-addressed key를 수천 번 조회·읽기·검증하던 비용이 지배했고, key별 1회 IO 캐시로 제거했다.
6. **journal의 장기 파일 수 병목은 구조와 512MB 수치를 모두 닫았다.** `journalPackProbe`는 2세대 커밋의 loose blob 223개를 pack 파일 1개 + loose 0개로 줄였고, pack-only HEAD recover와 PREV fallback을 모두 통과했다. 512MB `largeHeapProbe?target=512&pack=1`은 loose blob 131개를 pack 파일 1개로 줄였고, pack 1081ms, pack-only recover 2481ms로 수렴했다. 자동 정책은 `autoPack: true`의 loose 128개 또는 8MB 기준으로 고정했다.

## 수리된 결함

첫 128MB journal 실행은 RED였다. commit은 됐지만 새 커널이 저장 당시 heapLen보다 작아 recover가 실패했다. `MachineJournal`은 `Session.load`처럼 파이썬 할당 경로로 WASM 힙을 성장시킨 뒤, cp0으로 되감고 저널 페이지를 적용하도록 수정했다. 같은 probe 재실행은 GREEN 9/9다.

## 수리된 병목

512MB journal 1차 실행은 GREEN이었지만 느렸다. `pages` map은 8239개였고 실제 신규 blob은 131개뿐이었다. `MachineJournal.commit()`은 같은 커밋 안에서 이미 확인한 key의 OPFS 존재 확인을 생략하고, `recover()`는 같은 key의 blob을 한 번만 읽고 SHA-256 검증 결과를 재사용한다. 저장 포맷은 바꾸지 않아 기존 HEAD와 blob 파일을 그대로 읽는다.

## 수리된 장기 파일 수

`MachineJournal.pack()`은 현재 HEAD/PREV가 참조하는 live blob만 `pack/*.bin` 파일 1개로 묶고, `PACKS.json`을 마지막에 교체한다. `recover()`는 기존 loose blob과 새 pack 계층을 모두 읽으므로 기존 저널과 호환된다. `prune()`은 HEAD/PREV가 더 이상 참조하지 않는 loose blob과 index에 없는 stale pack 파일을 지운다. `journalPackProbe`는 loose blob 223개 -> pack 파일 1개, loose 0개, stale loose 1개와 stale pack 1개 제거, pack-only HEAD recover, HEAD 파손 후 PREV fallback, autoPack, pack-aware commit dedupe를 GREEN 10/10으로 확인했다. 512MB `largeHeapProbe?target=512&pack=1`은 loose blob 131개 -> pack 파일 1개, loose 0개, pack 1081ms, pack-only recover 2481ms를 GREEN 11/11로 확인했다.

## OS 판정 영향

`04-os-verdict-v2.md`의 가장 큰 보류 사유 중 "500MB 이상 checkpoint/session/fork/journal 비용 미공개"는 닫혔고, journal 속도 병목과 장기 loose blob 누적 구조도 1차 해소됐다. 512MB급 pack 수치도 1.1s로 들어왔고, 자동 실행 기준도 opt-in 정책으로 고정했다. 따라서 메모리 관리 점수는 6에서 7로 올릴 근거가 생겼다. 영속·크래시 내성은 이미 8점 구간이고, 부활 후 fd/socket/DB connection 재개설은 `Init.resume` 계약, demo gate, resume catalog로 닫혔다. 추가 상향은 외부 제품 trust/permission UI와 resume gate가 정리된 뒤 재산정한다.

남은 축:

1. 공개키 배포와 권한 UI의 외부 제품 gate.
2. machine image 또는 VirtualOrigin 제품 배선.
3. 외부 제품 `resume.py` gate.

이 셋이 통과하면 75점대 제품 표면 구간 진입 여부를 재산정한다.

## 다음

1. 공개키 배포와 권한 UI의 외부 제품 gate.
2. machine image 또는 VirtualOrigin 제품 배선.
3. 외부 제품 `resume.py` gate.
