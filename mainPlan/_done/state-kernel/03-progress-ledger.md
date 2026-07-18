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

- PRD 하중 가정 전수를 실물 코드로 대조했다: `collectDelta`가 세션 저장([session.js](../../../src/session/session.js) `_collectDelta`)과 저널 커밋([machineJournal.js](../../../src/capabilities/machineJournal.js) `commit`)의 공용 프리미티브인 것, sha256이 승격 시점(커밋의 페이지별 `sha256Hex`)에만 발생하는 것, h0 불일치가 PREV 후퇴 없는 즉시 예외인 것, HEAD/PREV·digest·서명·봉투 각 2벌인 것 전부 실물과 일치.
- 저장 포맷 실물 확인: 세션 = `<name>.json`(meta v2: manifest/pages/sp/heapLen/h0) + `<name>.bin`(packPages 연속 슬롯), 저널 = `HEAD.json`/`PREV.json` + `blob/<hex64>` loose + `PACKS.json`/`pack/*.bin`, `.pymachine` = MAGIC "PYMACHINE2\n" + hex64 봉투해시 + u32 헤더길이 + 헤더 + 델타(+homePack), machine generation = IndexedDB 4 store(blobs/generations/heads/owners) + `sha256:` 접두 digest.
- ROI 성립: 중복이 프로토콜·스키마·신뢰 계약 수준에 실재하고, 단계 게이트(구 포맷 바이트 동등성 100%)가 유실 위험을 담보한다. 착수 확정.

## 2026-07-18 - 0단계 완료: probe 3종 전부 통과, 시안 채택

- `tests/attempts/stateKernel/` 개설. 커널 시안(stateKernelDraft.js: `sha256:` 주소, blob/tree(pageTable|payload)/commit 오브젝트, OPFS store 드라이버, 쓰기 순서 법 + fence 선택형 ref CAS, 복구 의미론 2축) + probe 3종.
- probe 1(승격 비용 곡선): 64/128/256/512MB 전부 GREEN. checkpoint 중앙값 비율 0.965/0.901/1.008/0.902(기각선 1.05 위반 없음), checkpoint 루프 중 store 증가 0. 순수 해시 82~808ms 페이지 선형, 승격 커밋 2.9~14.1s. 내용주소 dedupe가 동일 패턴 페이지를 접어 wrote는 전 구간 136.
- probe 2(구 포맷 재구성): GREEN 6/6. 세션 save·저널(raw OPFS)·.pymachine(독자 파서)·machine generation(IndexedDB) 4포맷 전부 신 모델 바이트 대조 100% + legacy 재합성 -> 새 커널 부활.
- probe 3(ref CAS 음성 시험): GREEN 7/7. 크래시 6지점 구 HEAD 무결, HEAD-first/PREV 미보존/stale fence/env 불일치/변조 blob 전부 적발.
- 판정: 이중 구역 경계와 오브젝트 모델이 실측으로 성립. 1단계 착수 자격 확보.

## 2026-07-18 - 1단계 완료: digest 법 추출

- [contentDigest.js](../../../src/runtime/contentDigest.js)에 순수 코어 신설: `sha256HexWith`/`sha256AddressWith`(cryptoProvider 매개변수화, 전역 접근 0), `SHA256_ADDRESS_RE`, `parseSha256Address`(sha256: 주소와 bare hex 두 인코딩을 아는 유일 지점), `verifySha256With`(verify-on-read 단일 판정, 비던짐 반환이라 층별 오류 계약과 양립). 기존 함수들은 전역 바인딩 래퍼로 강등.
- verify-on-read 3벌 -> 1판정: 저널 recover blob/home 2곳 + blobStore pack 재대조 1곳이 전부 `verifySha256` 경유. machineSignature 지문의 `sha256:` 조립도 `sha256Address` 경유로.
- machine의 generationIntegrity는 경계상(밖 import는 composition 한 점) 코어를 import하지 못하므로 주입식 사본으로 유지하고 5단계(coordinator 커널 위임)에서 소멸 예정을 파일 헤더에 명시.
- 신설 게이트 `[digest 법]`: raw `subtle.digest("SHA-256")`은 코어 2곳 + pyprocSw(의도 중복)만, `"sha256:"` 주소 조립은 코어 2곳만. **음성 시험 2종으로 이빨 증명**(raw digest 주입 RED, 주소 조립 주입 RED, 원복 후 GREEN).
- 게이트: npm test 1279 green, test:types green, test:browser 70/70 green(기존 저널 commit/pack/recover·세션 save/load·openMachine 전부 그대로 동작 = 저장 포맷 의미 불변).

## 2026-07-18 - 2단계 완료: src/state/ 커널 신설

- 신설 5파일: [objectModel.js](../../../src/state/objectModel.js)(canonical JSON, blob 주소, pageTable|payload 타입 tree, 환경 지문 commit), [refProtocol.js](../../../src/state/refProtocol.js)(store 계약 + 쓰기 순서 법 + fence 선택형 ref CAS + 복구 의미론 2축), [signedTag.js](../../../src/state/signedTag.js)(ECDSA P-256 서명 코어 한 벌, 4단계에서 두 호출부가 여기 붙는다), [memoryStateStore.js](../../../src/state/memoryStateStore.js)(계약 인메모리 구현 + 파손 주입 채널), [opfsStateStore.js](../../../src/state/opfsStateStore.js)(OPFS 드라이버, 파일명 hex는 드라이버 세부).
- 오류 코드 2개 추가(PYPROC_STATE_CORRUPT, PYPROC_STATE_FENCE_STALE) - errors.js 카탈로그 + d.ts union 삼자 일치 유지. env 불일치는 기존 PYPROC_REPLAY_MISMATCH 재사용(같은 의미 축).
- 레이어 게이트 개정 동일 커밋: LAYER_RANK에 state(1) 삽입, 이하 각 +1, composition 순위 리터럴을 참조로 교체. CLAUDE.md 레이어 문면 갱신.
- 신설 게이트 `[state 커널]`(매 커밋 Node 실행): 순수 집합(브라우저 전역 0) 4파일 + 프로토콜 음성 시험 6종(정상 왕복·dedupe, 쓰기 순서 크래시 6지점, corruption PREV 후퇴 + 이중 파손 명시 예외, mismatch 즉시 예외, stale fence + HEAD 불변, signedTag 위조 적발).
- **이빨 증명 3건**: 순수 집합 게이트가 개발 중 주석의 영단어를 물었고, [digest 법] 게이트가 드라이버의 sha256: 슬라이스 중복을 물어 parseSha256Address 경유로 교정시켰고, 커널에 쓰기 순서 위반(HEAD를 PREV 보존 전에 교체)을 고의 주입해 프로토콜 게이트 RED("지점 5: 구 HEAD 오염")를 확인 후 원복했다.
- 브라우저 게이트에 OPFS 드라이버 절 편입(커밋 왕복 + 변조 blob 적발 + PREV 후퇴): test:browser 72/72 GREEN. npm test 1314, test:types green.

## 2026-07-18 - 3단계 완료: 저널 재기초

- 핵심 결정: 새 포맷의 바이트는 기존 `blob/<hex>` CAS를 그대로 공유한다(내용주소는 포맷 무관 - 구 저널 blob이 새 세대의 dedupe 대상이 되고 pack 기계를 재사용). 커널 ref는 `state/HEAD.json·PREV.json` 하위 디렉터리에 둬 구 루트 HEAD.json과 파일 충돌 없이 이관한다(어느 시점에 죽어도 두 세대 체계 중 하나는 완전). 커널 refs 존재 시 무조건 우선(구 세대로의 조용한 되감기 차단).
- [journalKernelStore.js](../../../src/capabilities/journalKernelStore.js) 신설: JournalBlobStore(loose+pack 바이트) + OpfsStateStore(ref 위임)를 커널 store 계약으로 묶는 드라이버.
- [machineJournal.js](../../../src/capabilities/machineJournal.js) 강등: 커밋 = `commitState` 한 호출(승격·dedupe·쓰기 순서 법은 커널 소유), recover = `openState`(verify-on-read·h0 대조·PREV 후퇴는 커널 소유) + 힙 적용만. /home pack은 pageTable tree의 file 엔트리. 남은 것 = 유휴 정책, live 판정(pack/prune: 커널 세대는 commit/tree 오브젝트까지 live), legacy reader(읽기 전용), 첫 커널 커밋 후 구 ref 삭제(writer 즉시 단일화). 공개 API·결과 형태·오류 코드(JOURNAL_CORRUPT 래핑, REPLAY_MISMATCH 통과) 전부 보존.
- 커널 확장: pageTable tree에 file 엔트리(id/address/byteLength/meta), commitState 쓰기 분해 카운터(pagesWrote/filesWrote/metaWrote).
- 게이트: 기존 저널 게이트(유휴 커밋·pack·pack-only 복구) 무수정 통과 + 신설 4종 - 동일 상태 재커밋 wrote 0(비용 법칙 보존), 구 포맷 v2 fixture recover 호환, 첫 커밋의 커널 이관(구 ref 소멸 + 공유 CAS dedupe + 재복구), 커널 포맷 h0 불일치 즉시 예외. **이빨 증명**: legacy 경로 우회 주입 -> RED("nullp") -> 원복 GREEN.
- npm test 1319, test:types, test:browser 76/76 전부 green.

## 2026-07-18 - 4단계(세션측) 완료: bundle 단일 writer + 서명 코어 호출부화

- [bundleFormat.js](../../../src/state/bundleFormat.js) 신설: 단일 봉투 포맷 PYBUNDLE1(MAGIC + 봉투 다이제스트 hex64 + u32 헤더 + 오브젝트 연속). 무결성(봉투 다이제스트)과 출처(tag, unsigned 다이제스트 서명)가 분리되고, decode는 상한 검증 + 전 오브젝트 verify-on-read 후에만 바이트를 내준다. 레이아웃은 [docs/reference/bundleFormat.md](../../../docs/reference/bundleFormat.md)가 버전 있는 공개 계약으로 문서화(문서-코드 상수 동기 게이트 포함).
- `Session.exportImage` = bundle 단일 writer(구 v2/v3 writer 폐지). 내부 표현 = 커널 커밋(페이지 blob + /home file 엔트리 + 환경 지문 h0/deterministic). `openMachine` = 감지형 이중 reader(PYBUNDLE1 커널 경로 + PYMACHINE2 legacy 경로, 신뢰 게이트는 한 함수 공유). legacy reader는 다음 브레이킹 릴리즈에 일몰(문서 명시).
- 서명 코어 한 벌(세션측): [machineSignature.js](../../../src/session/machineSignature.js)는 v1 형식 reader + 서명자 자료 정규화만 남기고 키 생성·내보내기·지문·서명·검증 전부 [signedTag.js](../../../src/state/signedTag.js) 코어에 위임. `signMachineMeta`(구 writer) 삭제. 지문 규약(kty,crv,x,y 순서)은 기존과 동일 보존 - 지문은 소비자가 박아두는 공개 값이라 순서 변경 = 전 소비자 지문 무효화이므로 코어 canonical 순서를 세션 규약에 맞췄다.
- 게이트: run.mjs에 bundle 왕복 + 레이아웃 문서 동기 + 변조 음성 3종(바이트 변조 무결성 거부, tag 제거, 잘못된 키 valid-but-untrusted). 브라우저 게이트 5종 신설: 서명+신뢰 부활, 잘못된 키 거부, 변조 즉시 거부, **문서화 레이아웃 독립 재파싱 대조**(디코더 미경유), 구 봉투 v2 fixture reader 호환. npm test 1329, test:browser 81/81, test:mcp 7/7, test:types 전부 green.
- 잔여(4단계 machine측): webMachineTrust의 코어 호출부화와 .webmachine의 bundle 통합은 machine 경계(밖 import는 composition 한 점) 때문에 주입 배선이 필요해 5단계(coordinator 커널 위임)의 composition 개정과 같은 지점에서 처리한다.

## 2026-07-18 - 계획 수정: 5·6단계(machine측)를 7단계 일격에 병합

- 근거([machineCommitCoordinator.js](../../../src/machine/persistence/machineCommitCoordinator.js) 정독): coordinator 생성자 옵션·결과 형태·store 계약은 `pyproc/machine` subpath의 공개 표면이다(machine/index.d.ts). 커널 위임을 지금 하면 (a) 주입 필드를 필수로 만들어 7단계 전에 machine 표면을 깨거나 (b) 기본값 폴백을 두는 이중 경로(덕지덕지 + 이중 표면)가 된다. 둘 다 PRD 자신의 기각 12번("옛/새 표면 장기 공존 금지")에 걸린다.
- 수정: 5단계(coordinator 커널 위임, fence = ref 훅, generationIntegrity·webMachineTrust 소멸, .webmachine bundle 통합)와 6단계(machine retention의 gc 정책 흡수)를 **7단계 브레이킹 일격에 병합**한다. 저널측 gc(ref 도달 가능성 live 판정 + 크래시 안전 pack)는 3단계에서 이미 커널 위에 섰다.
- 7단계 실행 분해:
  - **7a machine 재기초**: machine/composition에 커널 글루(state import는 composition 한 점 규칙 유지) - coordinator가 저장·무결성을 커널 위임, IndexedDB store = 커널 backend(fence·expectedHead CAS는 backend 트랜잭션 원자성으로), webMachineTrust = signedTag 코어 호출부(주입), .webmachine writer = bundle 단일화 + 구 reader, generationIntegrity 소멸, retention = gc 정책. machine 게이트·probe·d.ts 동시 개정.
  - **7b 표면 원자 개편**: porcelain 머신 핸들(machine/composition, `boot`/`createWebComputer` 반환) - `machine.run/history/proc/fs/term`, history = checkpoint/restore(휘발) + commit/checkout/open/push/export(내구), `open(source)` 통합, 비용 영수증(additive-only), 결정 부팅 opt-in + 커밋 헤더 기록. 루트 export 37 -> 한 자릿수, subpath = history/machine/worker/assets, 강등 gpu·socket·wasi는 계약 실태 표로. d.ts 재작성 + 표면 게이트(패리티 표류 주입 RED 포함) 재작성 동일 커밋.
  - **7c 문서 동시 개정**: api.md, capabilityMatrix, resumeCatalog, README 양본, 소비 계약, CHANGELOG Unreleased(브레이킹 명시). 버전 +1·태그는 릴리즈 명시 지시 대기(일상 커밋 불변 규칙).

## 2026-07-18 - 7a-1 완료: machine 암호 법의 커널 위임(주입 필수화)

- [machineCryptoProvider.js](../../../src/machine/composition/machineCryptoProvider.js) 신설(composition = machine의 유일한 밖 import 지점): 커널의 digest(sha256AddressWith)·ECDSA(signStateDigest/verifyStateDigest/createStateKeyPair/exportStatePublicKey)를 함수 조각 provider로 묶어 machine 생성자에 배달. 배럴 export + d.ts에 MachineCryptoProvider 타입.
- [generationIntegrity.js](../../../src/machine/persistence/generationIntegrity.js): 자체 subtle/hex 암호 구현 소멸. 남은 것 = machine 도메인 형식 법(canonical manifest 직렬화 + byteLength·digest 재대조 판정). [digest 법] 게이트에서 machine 사본 허용을 제거(raw digest는 코어 + pyprocSw만, 주소 조립은 코어만)해 게이트가 더 조여졌다.
- [webMachineTrust.js](../../../src/machine/image/webMachineTrust.js): ECDSA 상수·subtle 호출 소멸, signDigest/verifyDigest 위임. 남은 것 = signature v1 스키마(hex), JWK 정규화, 지문 직렬화 규약(기존 보존 - 신뢰 목록 무효화 방지), 신뢰 판정 순서. 임포트 불가 키는 provider가 false로 수렴(적대 입력의 정상 결말).
- 생성자 계약: MachineCommitCoordinator/MachineEnvelopeCoordinator가 맨 Crypto를 TypeError로 거부(폴백 없음 = 이중 경로 금지). 구성 지점 전수 갱신: probes 2종, 제품 앱 3파일(persistence/identityStore/imageTrust).
- retention = gc 명문화: [generationRetention.js](../../../src/machine/persistence/generationRetention.js)가 "ref 도달 가능성 = liveness"의 machine측 구현임을 계약 주석으로 봉인(저널측과 같은 법, backend만 다름 - 6단계의 실체).
- 게이트: 신설 음성 시험(맨 Crypto 거부 + 주입 digest 형식) + npm test 1335, test:types, generationContract 25/25, machineEnvelope 20/20, webComputer 제품 13/13 전부 green.
- 잔여 기록(정면 봉착): .webmachine의 bundle 통합은 설계 긴장이 실재한다 - 현 .webmachine은 content(manifest) 서명이라 **payload 접촉 전 신뢰 거부**(probe가 slice 2회로 증명)가 성립하는데, 현 bundle tag는 전신 다이제스트 서명이라 거부 전에 전체 판독이 필요하다. 올바른 해소는 bundle tag의 header-target 서명(내용주소가 오브젝트를 개별 봉인하므로 헤더 서명으로 충분 - git tag 동형)이며, 이는 세션측 bundle과 문서·게이트의 공동 개정이 필요해 별도 probe(campaign probe 5)로 실측 후 진행한다.

## 2026-07-18 - 7b 진행 중(작업 트리, 미커밋): 표면 일격의 코어 완료

- porcelain 신설: [pyprocMachine.js](../../../src/machine/composition/pyprocMachine.js) - `boot`(deterministic opt-in = 옛 bootSession 흡수) / `open`(bundle | {dir,name} | {persistent} 통합) / PyprocMachine(run/runAsync/fs/term/proc/runtime 탈출구) / PyprocHistory(휘발 checkpoint·restore·tree·prune + 내구 commit·recover·watch·pack·export·save, export는 결정 부팅 전용 명시 거부).
- 루트 [index.js](../../../index.js) = 정확히 6 export. [package.json](../../../package.json) exports = . / history(신설, [src/state/index.js](../../../src/state/index.js) 배럴 + index.d.ts) / machine / worker / assets / 강등 gpu·socket·wasi. 소멸: runtime·reactive·syscall-bridge·process-os. **PRD와 의도적 편차**: 강등 3종 subpath는 유지한다(제거하면 Runtime enable* 바인딩이 없는 gpu/socket/wasi 능력이 도달 불가 = 기능 상실. 강등의 정의는 원래 "루트 부재"였다).
- 루트 [index.d.ts](../../../index.d.ts) 수술: 자산 계약 -> [src/runtime/assets.d.ts](../../../src/runtime/assets.d.ts)(subpath 형제 d.ts), 값-export가 사라진 클래스 19종은 declare + export type(핸들·탈출구가 돌려주는 타입), porcelain 선언(BootMachineOptions/OpenTrustOptions/PyprocMachine/PyprocHistory/boot/open) 추가. SIGNAL은 `PyProc.SIGNAL` 정적 상수로 이사.
- run.mjs 게이트 재작성: 표면(6개 정확 일치 + **d.ts 값-선언 1:1 패리티 신설**), 계약(소스를 내부 모듈로 전환 + porcelain 어휘 계약 + pyproc/history 계약), 타입(declare 타입 검사 + subpath d.ts 확장), exports 고정 목록 갱신, tsconfig에 신규 d.ts 3종. packageConsumer smoke를 새 표면(+ 설치본 커널 왕복 실검증)으로 재작성.
- README 양본: 새 표면 지도(porcelain 서사) + 진입점 표 + 코드 샘플 전면 갱신.
- 병렬 진행 중(에이전트 3): (A) 소비자 게이트 이행 - gate.html import·porcelain 스모크, productConsumer/immortal/coverage manifest/contract.md 표, run.mjs coverage 목록, mcp. (B) examples 15종 + 랜딩 이행. (C) api.md 재구성 + capabilityMatrix 도달 경로 + CHANGELOG Unreleased 브레이킹·마이그레이션 표.
- 전부 GREEN 후 한 커밋으로 봉인 예정(내부는 단계, 표면은 일격). 남은 후속: 패리티 게이트 음성 시험, 전 브라우저 게이트 재실행, .webmachine bundle 통합 probe(원장 7a-1 잔여 기록 참조).

## 2026-07-18 - 7b·7c 완료: 표면 일격과 문서 동시 개정

- 병렬 이행 3축 수합: (A) 소비자 게이트 - gate.html(심층 import 전환 + porcelain 스모크 3종), productConsumer/immortal(설치 표면만 소비, coverage manifest 12행 schemaVersion 2, 검사명 문자열 전부 보존), contract.md coverage 표 재생성. 도달 불가가 된 표면의 게이트는 의미 보존 재배선: VirtualOrigin -> 설치 SW 위임 프로토콜 직접 배선, JobControl/MachineContainer -> `machine.proc` 공개 동사로 동일 수명주기, MachineJail -> runtime 탈출구 집행. (B) examples 15종 + 랜딩 전면 이행(10/10 GREEN), 판단 기록: VirtualOrigin 재노출 검토 권고, `machine.proc()`의 boot info 미반환 개선 여지. (C) api.md 전면 재구성(루트 6 + 핸들 어휘 + 비용 영수증 + 오류 전 표), capabilityMatrix 도달 경로 갱신(구 이름 병기), CHANGELOG Unreleased 브레이킹 7항 + 마이그레이션 표 14행.
- 최종 검증(전부 직접 재실행): npm test 1310/0, test:types 0 error, test:browser 84/84, test:examples 10/10, test:mcp 7/7, test:consumer 30/30, test:web-computer 13/13, test:package ok. **패리티 게이트 이빨 증명**: d.ts에 유령 값-선언 주입 -> RED("실물에 없는 값-선언: ghostExport") -> 원복 GREEN.
- 릴리즈(버전 +1 + 태그)는 명시 지시 대기(0.0.x 남발 금지 규칙). CHANGELOG Unreleased가 노트 정본.

## 잔여 후속(별도 작업 단위)

1. bundle header-target 서명 probe(campaign probe 5): .webmachine bundle 통합의 전제. payload 접촉 전 신뢰 거부 보존이 쟁점(7a-1 잔여 기록 참조).
2. VirtualOrigin의 표면 재노출 검토(예제·게이트가 SW 내부 프로토콜을 인라인 배선 중 - 드리프트 위험).
3. `machine.proc()`이 PyProcBootInfo(workers/avgBootMs/forked)를 핸들에 실어주는 개선.
4. attempts/stateKernel 캠페인 종결 판정은 위 1 해소 후(캠페인 폴더 삭제 + 기록은 원장·계약 실태 표로).

NEXT: 7단계 일격 커밋으로 봉인(이 항목이 마지막 기록). 이후 이니셔티브는 잔여 후속 1~4를 남기고 실질 완료 상태다.

## 2026-07-18 - 완료 이관

7단계 일격 커밋(eec5008)으로 실질 완료. 규칙대로 폴더째 `mainPlan/_done/`으로 이관하고
참조 경로(src 주석 2곳, attempts 캠페인 README)를 갱신했다. 잔여 후속 4건은 위 절이 정본이며
각각 독립 작업 단위로 재개한다(재개 시 새 이니셔티브 또는 attempts probe).
