# stateKernel - 내구 상태 3벌을 이중 구역 커널 하나로 통합할 수 있는가

[mainPlan/_done/state-kernel](../../../mainPlan/_done/state-kernel/README.md)의 0단계 실측 캠페인.

## 가설

저널(HEAD.json + blob CAS), 세션 이미지(.pymachine), machine generation(IndexedDB)은
전부 "blob + tree + commit + ref"의 같은 오브젝트 모델로 무손실 표현 가능하고,
sha256 승격을 `collectDelta` 이후(커밋 시점)로 한정하면 실행 경계(`checkpoint()`)
비용에 회귀가 없다. ref 쓰기 순서 법(payload -> tree -> commit -> PREV 보존 -> HEAD)과
fence 전제조건은 고의 위반 주입을 전부 잡아낸다.

## 졸업 게이트

- probe 1: 승격(sha256 + blob 쓰기) 비용이 커밋 시점에만 발생(체크포인트 루프 중 store
  오브젝트 수 증가 0)하고, 커널 시안 사용 전후 `checkpoint()` 중앙값 비율 <= 1.05.
  힙 128/256/512MB 곡선 기록. 위반 시 그 시안 폐기.
- probe 2: 구 포맷 3종(세션 save 파일, 저널 HEAD.json+blob, .pymachine 봉투) +
  machine generation(IndexedDB)을 신 오브젝트 모델로 읽어 페이지/페이로드 바이트 대조
  100%. 미달 포맷은 이관 착수 금지.
- probe 3: 쓰기 순서 위반(각 크래시 지점에서 구 HEAD 무결), HEAD-first 위반(corruption
  감지 + PREV 후퇴), PREV 미보존(첫 부팅 위장 없이 명시 예외), stale fence 거부,
  env(h0) 불일치 즉시 예외(PREV 후퇴 금지), 변조 blob verify-on-read 적발이 전부 RED로
  잡힘. 하나라도 통과(미적발)되면 프로토콜 시안 기각.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-18 | promotionCostProbe | Edge headless, COOP/COEP | 64/128/256/512MB 전부 GREEN 6/6. checkpoint 중앙값 비율 0.965/0.901/1.008/0.902(전부 <= 1.05). checkpoint 루프 중 store 증가 0. 승격 해시 82/256/407/808ms(페이지 수 선형), promote 2.9/5.6/7.9/14.1s. dedupe 940/1964/4012/8108(내용주소가 동일 페이지를 접음, wrote는 전 구간 136) | 승격은 커밋 시점에만 발생하고 경계 비용 회귀 0. 시안 채택 | 1단계 법 추출 |
| 2026-07-18 | legacyReconstructProbe | Edge headless, COOP/COEP | GREEN 6/6. 423p/26.4MB 델타를 세션 save·저널 HEAD+blob(raw OPFS 판독)·.pymachine(독자 파서)·machine generation(IndexedDB) 4포맷 전부 신 모델 재구성 바이트 대조 100%. 신 모델 -> legacy 재합성 -> 새 커널 부활까지 성립 | 구 포맷 4종 무손실 표현 가능. 이관 착수 자격 확보 | 3~5단계 recover 게이트의 원형 |
| 2026-07-18 | refCasProbe | Edge headless, COOP/COEP | GREEN 7/7. 쓰기 순서 법 크래시 6지점 전부 구 HEAD 무결, HEAD-first 위반 corruption 감지 + PREV 후퇴, PREV 미보존 + HEAD 파손 = 명시 예외, stale fence 거부 + HEAD 불변, env(h0) 불일치 즉시 예외(후퇴 금지), 변조 blob verify-on-read 적발 | ref CAS 프로토콜 시안이 전 위반을 문다. 2단계 음성 시험의 원형 | 2단계 src/state 신설 |

## 판정

진행 중 (0단계 probe 3종 전부 통과. 시안 채택, 1단계 법 추출 착수 자격 확보)
