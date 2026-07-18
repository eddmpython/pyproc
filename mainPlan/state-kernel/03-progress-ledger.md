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

## 2026-07-18 - 1단계 완료: digest 법 추출

- [contentDigest.js](../../src/runtime/contentDigest.js)에 순수 코어 신설: `sha256HexWith`/`sha256AddressWith`(cryptoProvider 매개변수화, 전역 접근 0), `SHA256_ADDRESS_RE`, `parseSha256Address`(sha256: 주소와 bare hex 두 인코딩을 아는 유일 지점), `verifySha256With`(verify-on-read 단일 판정, 비던짐 반환이라 층별 오류 계약과 양립). 기존 함수들은 전역 바인딩 래퍼로 강등.
- verify-on-read 3벌 -> 1판정: 저널 recover blob/home 2곳 + blobStore pack 재대조 1곳이 전부 `verifySha256` 경유. machineSignature 지문의 `sha256:` 조립도 `sha256Address` 경유로.
- machine의 generationIntegrity는 경계상(밖 import는 composition 한 점) 코어를 import하지 못하므로 주입식 사본으로 유지하고 5단계(coordinator 커널 위임)에서 소멸 예정을 파일 헤더에 명시.
- 신설 게이트 `[digest 법]`: raw `subtle.digest("SHA-256")`은 코어 2곳 + pyprocSw(의도 중복)만, `"sha256:"` 주소 조립은 코어 2곳만. **음성 시험 2종으로 이빨 증명**(raw digest 주입 RED, 주소 조립 주입 RED, 원복 후 GREEN).
- 게이트: npm test 1279 green, test:types green, test:browser 70/70 green(기존 저널 commit/pack/recover·세션 save/load·openMachine 전부 그대로 동작 = 저장 포맷 의미 불변).

## 2026-07-18 - 2단계 완료: src/state/ 커널 신설

- 신설 5파일: [objectModel.js](../../src/state/objectModel.js)(canonical JSON, blob 주소, pageTable|payload 타입 tree, 환경 지문 commit), [refProtocol.js](../../src/state/refProtocol.js)(store 계약 + 쓰기 순서 법 + fence 선택형 ref CAS + 복구 의미론 2축), [signedTag.js](../../src/state/signedTag.js)(ECDSA P-256 서명 코어 한 벌, 4단계에서 두 호출부가 여기 붙는다), [memoryStateStore.js](../../src/state/memoryStateStore.js)(계약 인메모리 구현 + 파손 주입 채널), [opfsStateStore.js](../../src/state/opfsStateStore.js)(OPFS 드라이버, 파일명 hex는 드라이버 세부).
- 오류 코드 2개 추가(PYPROC_STATE_CORRUPT, PYPROC_STATE_FENCE_STALE) - errors.js 카탈로그 + d.ts union 삼자 일치 유지. env 불일치는 기존 PYPROC_REPLAY_MISMATCH 재사용(같은 의미 축).
- 레이어 게이트 개정 동일 커밋: LAYER_RANK에 state(1) 삽입, 이하 각 +1, composition 순위 리터럴을 참조로 교체. CLAUDE.md 레이어 문면 갱신.
- 신설 게이트 `[state 커널]`(매 커밋 Node 실행): 순수 집합(브라우저 전역 0) 4파일 + 프로토콜 음성 시험 6종(정상 왕복·dedupe, 쓰기 순서 크래시 6지점, corruption PREV 후퇴 + 이중 파손 명시 예외, mismatch 즉시 예외, stale fence + HEAD 불변, signedTag 위조 적발).
- **이빨 증명 3건**: 순수 집합 게이트가 개발 중 주석의 영단어를 물었고, [digest 법] 게이트가 드라이버의 sha256: 슬라이스 중복을 물어 parseSha256Address 경유로 교정시켰고, 커널에 쓰기 순서 위반(HEAD를 PREV 보존 전에 교체)을 고의 주입해 프로토콜 게이트 RED("지점 5: 구 HEAD 오염")를 확인 후 원복했다.
- 브라우저 게이트에 OPFS 드라이버 절 편입(커밋 왕복 + 변조 blob 적발 + PREV 후퇴): test:browser 72/72 GREEN. npm test 1314, test:types green.

## 2026-07-18 - 3단계 완료: 저널 재기초

- 핵심 결정: 새 포맷의 바이트는 기존 `blob/<hex>` CAS를 그대로 공유한다(내용주소는 포맷 무관 - 구 저널 blob이 새 세대의 dedupe 대상이 되고 pack 기계를 재사용). 커널 ref는 `state/HEAD.json·PREV.json` 하위 디렉터리에 둬 구 루트 HEAD.json과 파일 충돌 없이 이관한다(어느 시점에 죽어도 두 세대 체계 중 하나는 완전). 커널 refs 존재 시 무조건 우선(구 세대로의 조용한 되감기 차단).
- [journalKernelStore.js](../../src/capabilities/journalKernelStore.js) 신설: JournalBlobStore(loose+pack 바이트) + OpfsStateStore(ref 위임)를 커널 store 계약으로 묶는 드라이버.
- [machineJournal.js](../../src/capabilities/machineJournal.js) 강등: 커밋 = `commitState` 한 호출(승격·dedupe·쓰기 순서 법은 커널 소유), recover = `openState`(verify-on-read·h0 대조·PREV 후퇴는 커널 소유) + 힙 적용만. /home pack은 pageTable tree의 file 엔트리. 남은 것 = 유휴 정책, live 판정(pack/prune: 커널 세대는 commit/tree 오브젝트까지 live), legacy reader(읽기 전용), 첫 커널 커밋 후 구 ref 삭제(writer 즉시 단일화). 공개 API·결과 형태·오류 코드(JOURNAL_CORRUPT 래핑, REPLAY_MISMATCH 통과) 전부 보존.
- 커널 확장: pageTable tree에 file 엔트리(id/address/byteLength/meta), commitState 쓰기 분해 카운터(pagesWrote/filesWrote/metaWrote).
- 게이트: 기존 저널 게이트(유휴 커밋·pack·pack-only 복구) 무수정 통과 + 신설 4종 - 동일 상태 재커밋 wrote 0(비용 법칙 보존), 구 포맷 v2 fixture recover 호환, 첫 커밋의 커널 이관(구 ref 소멸 + 공유 CAS dedupe + 재복구), 커널 포맷 h0 불일치 즉시 예외. **이빨 증명**: legacy 경로 우회 주입 -> RED("nullp") -> 원복 GREEN.
- npm test 1319, test:types, test:browser 76/76 전부 green.

NEXT: 4단계 - 봉투·신뢰 통합. machineSignature와 webMachineTrust를 signedTag 코어 한 벌의 두 호출부로. bundle writer 즉시 단일화 + 구 .pymachine v2/v3 이중 reader + 변조 3종 음성 시험.
