# 05. 대형 힙 성능 봉투 - 512MB 실측과 journal 1차 최적화

작성: 2026-07-14. 정본 probe: [largeHeapEnvelope](../../tests/attempts/largeHeapEnvelope/README.md).

## 한 줄 판정

**512MB 사용자 힙에서 checkpoint/session save/load/forkLive/journal은 모두 성립하고, journal recover 병목은 24.8s에서 2.3s로 줄었다.** 500MB 이상 힙이 막연한 미검증 구간이던 상태는 해소됐다. 남은 병목은 제품 배선, 런타임 자산 신뢰, 장기 OPFS pack/prune이다.

## 실측표

환경: Edge headless, 로컬 COOP+COEP, Pyodide v314.0.2.

| target | heap | checkpoint | restoreLive | Session.save | Session.load | forkLive | journal |
|---:|---:|---:|---:|---:|---:|---:|---|
| 64MB | 88.8MB | 1072p/67MB, 82ms | 109p/6.81MB, 40ms | 66.9MB, 806ms | 2320ms | harvest 51.5ms, apply 32.8ms | 미측정 |
| 128MB | 152.8MB | 2096p/131MB, 174ms | 109p/6.81MB, 105ms | 130.9MB, 1279ms | 2763ms | 미측정 | commit 5593ms, recover 9116ms |
| 512MB 1차 | 536.8MB | 8240p/515MB, 552ms | 109p/6.81MB, 225ms | 514.9MB, 3665ms | 3191ms | harvest 132.3ms, apply 187.4ms | commit 14047ms, recover 24769ms |
| 512MB journal 캐시 후 | 536.8MB | 8240p/515MB, 497ms | 109p/6.81MB, 223ms | 514.9MB, 4434ms | 3193ms | harvest 132.3ms, apply 187.4ms | commit 2895ms, recover 2312ms |

## 해석

1. **checkpoint는 선형 비용이지만 512MB에서 552ms다.** OS 간판을 바로 깨는 수준은 아니다.
2. **restoreLive는 변경 페이지 수에 좌우된다.** 512MB payload 전체가 있어도 되돌린 페이지가 109p라 225ms였다.
3. **session save/load는 저장량이 병목이다.** 512MB 저장 3.7s, 로드 3.2s는 "즉시"는 아니지만 머신 이미지/부활 동선으로는 실용 범위다.
4. **forkLive는 512MB에서도 빠르다.** 수확 132.3ms, 적용 187.4ms다. OPFS 저장이 없고 워커 간 델타 전송+적용이라 session save/load보다 훨씬 작다.
5. **journal의 반복 blob IO 병목은 1차 해소됐다.** 512MB에서 commit 14.0s -> 2.9s, recover 24.8s -> 2.3s다. 실제 신규 blob은 8.2MB뿐인데 같은 content-addressed key를 수천 번 조회·읽기·검증하던 비용이 지배했고, key별 1회 IO 캐시로 제거했다.

## 수리된 결함

첫 128MB journal 실행은 RED였다. commit은 됐지만 새 커널이 저장 당시 heapLen보다 작아 recover가 실패했다. `MachineJournal`은 `Session.load`처럼 파이썬 할당 경로로 WASM 힙을 성장시킨 뒤, cp0으로 되감고 저널 페이지를 적용하도록 수정했다. 같은 probe 재실행은 GREEN 9/9다.

## 수리된 병목

512MB journal 1차 실행은 GREEN이었지만 느렸다. `pages` map은 8239개였고 실제 신규 blob은 131개뿐이었다. `MachineJournal.commit()`은 같은 커밋 안에서 이미 확인한 key의 OPFS 존재 확인을 생략하고, `recover()`는 같은 key의 blob을 한 번만 읽고 SHA-256 검증 결과를 재사용한다. 저장 포맷은 바꾸지 않아 기존 HEAD와 blob 파일을 그대로 읽는다.

## OS 판정 영향

`04-os-verdict-v2.md`의 가장 큰 보류 사유 중 "500MB 이상 checkpoint/session/fork/journal 비용 미공개"는 닫혔고, journal 속도 병목도 1차 해소됐다. 따라서 메모리 관리 점수는 6에서 7로 올릴 근거가 생겼다. 단 영속·크래시 내성은 `/home` 이미지 결합과 fd 재개설이 남아 있어 유지한다.

남은 축:

1. WebCrypto 서명/SRI/포맷 마이그레이션.
2. 대표 데모와 제품 배선.
3. journal append-only pack/prune으로 장기 OPFS 파일 수와 GC 축소.

이 셋이 통과하면 75점대 제품 표면 구간 진입 여부를 재산정한다.

## 다음

1. 신뢰 체인 설계.
2. 대표 데모와 제품 배선.
3. journal append-only pack/prune은 장기 최적화로 분리.
