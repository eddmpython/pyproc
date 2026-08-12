# stateKernel - 내구 상태 3벌을 이중 구역 커널 하나로 통합할 수 있는가

**살아 있는 이유**: 이중 구역 커널의 남은 질문과 h0 계열 변경의 실측 자리다.

[state 모듈](../../../src/state/index.js)에 승격된 내구 상태 오브젝트 모델의 선행 실측 캠페인.

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
| 2026-08-12 | commitDeltaLossProbe | Edge headless, 실 OPFS + 실 힙 | RED. controller A가 X 주소를 cache한 뒤 controller B가 X를 HEAD/PREV 밖으로 밀고 pack하면, A의 다음 X 커밋은 성공하지만 recover가 PREV로 후퇴 | 원인은 `collectDelta` 유실이 아니라 controller별 stale address 단언과 공유 저장소 연산의 비직렬화다 | Runtime+dir coordination domain, 주소 hint 존재 대조, commit/recover/pack/prune/delete 직렬화를 src와 정식 게이트에 흡수 |
| 2026-08-04 | branchRefsProbe | Edge headless, 실 OPFS + 실 힙 | 10/10 GREEN | 이름 있는 가지(commitBranch/listBranches/recoverBranch/adoptBranch)가 ref 프로토콜 (5') 위에서 성립. pack 뒤 가지 부활 = live 판정이 가지를 지킨다. 가지 존재 = 마커 v2(구 버전 fail-closed), 전부 삭제 = v1 복원. note(provenance)와 갈림점 parents 왕복 확인 | src 흡수 완료(가지 동사 + attempts). 게이트는 gate.js 3검사 + [state 가지] 2검사가 상시 판정 |
| 2026-07-18 | promotionCostProbe | Edge headless, COOP/COEP | 64/128/256/512MB 전부 GREEN 6/6. checkpoint 중앙값 비율 0.965/0.901/1.008/0.902(전부 <= 1.05). checkpoint 루프 중 store 증가 0. 승격 해시 82/256/407/808ms(페이지 수 선형), promote 2.9/5.6/7.9/14.1s. dedupe 940/1964/4012/8108(내용주소가 동일 페이지를 접음, wrote는 전 구간 136) | 승격은 커밋 시점에만 발생하고 경계 비용 회귀 0. 시안 채택 | 1단계 법 추출 |
| 2026-07-18 | legacyReconstructProbe | Edge headless, COOP/COEP | GREEN 6/6. 423p/26.4MB 델타를 세션 save·저널 HEAD+blob(raw OPFS 판독)·.pymachine(독자 파서)·machine generation(IndexedDB) 4포맷 전부 신 모델 재구성 바이트 대조 100%. 신 모델 -> legacy 재합성 -> 새 커널 부활까지 성립 | 구 포맷 4종 무손실 표현 가능. 이관 착수 자격 확보 | 3~5단계 recover 게이트의 원형 |
| 2026-07-18 | refCasProbe | Edge headless, COOP/COEP | GREEN 7/7. 쓰기 순서 법 크래시 6지점 전부 구 HEAD 무결, HEAD-first 위반 corruption 감지 + PREV 후퇴, PREV 미보존 + HEAD 파손 = 명시 예외, stale fence 거부 + HEAD 불변, env(h0) 불일치 즉시 예외(후퇴 금지), 변조 blob verify-on-read 적발 | ref CAS 프로토콜 시안이 전 위반을 문다. 2단계 음성 시험의 원형 | 2단계 src/state 신설 |

| 2026-07-18 | headerTagProbe | Edge headless, COOP/COEP | GREEN 5/5. 미신뢰 거부 접두 슬라이스 2회(198KB 번들, payload 접촉 0). 치환 = verify-on-read 거부, 색인 조작 = 서명 대상 불일치, tag 변조 = 검증 실패 | 헤더 서명 충분성 채택(git tag 동형). 본진 전환 완료 | .webmachine bundle 통합의 전제 확보 |

## 판정

진행 중 (기존 시안은 승격됐고, 2026-08-12 저널 coordination 결함 수리 자격을 RED로 확보)
