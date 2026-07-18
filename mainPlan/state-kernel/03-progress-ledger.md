# 03. 진행 원장 - state-kernel

결정 기록은 위가 과거, 아래가 최신. 재개 지점(NEXT)은 항상 마지막 줄.

## 2026-07-18 - 이니셔티브 개설

- 다섯 렌즈(시스템 아키텍처, 라이브러리 표면, 반증, 플랫폼 궤적, 메커니즘 지형)의 독립
  검토 + 상호 반박 + 종합 판정으로 방향 확정. 판정의 하중 지지 사실 3건을 별도
  재검증했다: machine 층 `collectDelta` 호출 0건, ECDSA 스택 2벌
  (session/machineSignature.js, machine/image/webMachineTrust.js), 루트 export 실물 37개.
- 확정 방향: 이중 구역 상태 커널(휘발 index + 내구 CAS 리포, 승격 관문 `collectDelta`
  한 점) + 표면 원자 개편(porcelain 핸들 + plumbing subpath 3+1). 상세는
  [00](00-product-vision.md)/[01](01-architecture.md)/[02](02-phasing-and-wiring.md).
- 기각 13건을 [00-product-vision.md](00-product-vision.md)에 사망 기록으로 보존(재상정 차단).
- 코드 착수 0. 표면·저장 포맷 불변.

## 2026-07-18 - 착수 전 정합성·ROI 재검 통과

- PRD 하중 가정 전수를 실물 코드로 대조했다: `collectDelta`가 세션 저장([session.js](../../src/session/session.js) `_collectDelta`)과 저널 커밋([machineJournal.js](../../src/capabilities/machineJournal.js) `commit`)의 공용 프리미티브인 것, sha256이 승격 시점(커밋의 페이지별 `sha256Hex`)에만 발생하는 것, h0 불일치가 PREV 후퇴 없는 즉시 예외인 것, HEAD/PREV·digest·서명·봉투 각 2벌인 것 전부 실물과 일치.
- 저장 포맷 실물 확인: 세션 = `<name>.json`(meta v2: manifest/pages/sp/heapLen/h0) + `<name>.bin`(packPages 연속 슬롯), 저널 = `HEAD.json`/`PREV.json` + `blob/<hex64>` loose + `PACKS.json`/`pack/*.bin`, `.pymachine` = MAGIC "PYMACHINE2\n" + hex64 봉투해시 + u32 헤더길이 + 헤더 + 델타(+homePack), machine generation = IndexedDB 4 store(blobs/generations/heads/owners) + `sha256:` 접두 digest.
- ROI 성립: 중복이 프로토콜·스키마·신뢰 계약 수준에 실재하고, 단계 게이트(구 포맷 바이트 동등성 100%)가 유실 위험을 담보한다. 착수 확정.

## 2026-07-18 - 0단계 완료: probe 3종 전부 통과, 시안 채택

- `tests/attempts/stateKernel/` 개설. 커널 시안(stateKernelDraft.js: `sha256:` 주소, blob/tree(pageTable|payload)/commit 오브젝트, OPFS store 드라이버, 쓰기 순서 법 + fence 선택형 ref CAS, 복구 의미론 2축) + probe 3종.
- probe 1(승격 비용 곡선): 64/128/256/512MB 전부 GREEN. checkpoint 중앙값 비율 0.965/0.901/1.008/0.902(기각선 1.05 위반 없음), checkpoint 루프 중 store 증가 0. 순수 해시 82~808ms 페이지 선형, 승격 커밋 2.9~14.1s. 내용주소 dedupe가 동일 패턴 페이지를 접어 wrote는 전 구간 136.
- probe 2(구 포맷 재구성): GREEN 6/6. 세션 save·저널(raw OPFS)·.pymachine(독자 파서)·machine generation(IndexedDB) 4포맷 전부 신 모델 바이트 대조 100% + legacy 재합성 -> 새 커널 부활.
- probe 3(ref CAS 음성 시험): GREEN 7/7. 크래시 6지점 구 HEAD 무결, HEAD-first/PREV 미보존/stale fence/env 불일치/변조 blob 전부 적발.
- 판정: 이중 구역 경계와 오브젝트 모델이 실측으로 성립. 1단계 착수 자격 확보.

NEXT: 1단계 법 추출 - digest 코어 cryptoProvider 매개변수화(contentDigest + generationIntegrity 통합), verify-on-read 단일화, 주소 형식 `sha256:<hex>` 통일. machine 배달은 주입. 게이트 = npm test + test:browser green + 기존 저널·봉투 그대로 열림 + 주소 형식 위반 주입 RED.
