# 01. 진행 원장 - kernel-product

위가 과거, 아래가 최신. 재개 지점(NEXT)은 항상 마지막 줄.

## 2026-07-18 - 개설

- state-kernel 잔여 4건(bundle header-target, machine generation 커널 스키마, .webmachine
  bundle 통합, VirtualOrigin 재노출)의 해소와 통합 제품(Web Computer v2)을 한 이니셔티브로
  개설. 단계·게이트·기각 기준은 [00-plan.md](00-plan.md).

## 2026-07-18 - P1 완료: bundle header-target 서명

- probe 5(headerTagProbe) GREEN 5/5: 미신뢰 거부 접두 슬라이스 2회(payload 접촉 0), 오브젝트
  치환 = verify-on-read 거부, 색인 조작 = 서명 대상 불일치, tag 변조 = 검증 실패. 가설 채택.
- 본진 전환: tag.target = canonical 헤더(tag=null) 다이제스트(`stateBundleHeaderDigest` -
  색인만으로 계산 가능해 서명에 오브젝트 바이트가 불필요), 접두 판독기
  `readStateBundleHeader`(Uint8Array/Blob/{read} 소스, 신뢰 preflight 프리미티브) 신설.
  세션 서명·검증, 배럴·d.ts, run.mjs bundle 시험, 레이아웃 문서 동시 개정.
- 게이트: npm test 1321, test:browser 84/84(서명 신뢰 부활·변조 거부·독립 재파싱·구 봉투 호환) 전부 green.

## 2026-07-18 - P2 완료: machine generation = 커널 commit 스키마

- generation이 machine 자기 manifest에서 커널 오브젝트로 전환됐다: 스냅샷 payload = blob,
  머신·장치 도메인 메타 = payloadTree 엔트리 meta(objectModel에 meta 필드 추가), generation
  정체 = commit(parents = 직전 generation, fence = owner epoch). generationId = commit 주소라
  정체성 대조가 주소 대조로 환원된다. 커널 문법은 machineCryptoProvider.state로 주입.
- record = { schemaVersion: 2, commitAddress, blobDigests } (gc 색인). 복원은 색인을 신뢰하지
  않고 commit -> tree를 걷는다 - 색인이 거짓이어도 오염 반경은 gc뿐이다. retention은 commit
  체인 도달 blob으로 삭제 집합 계산, 그룹 판정은 저장 키가 한다(record는 그룹 무관).
- store 트랜잭션 CAS(owner + expectedHead)는 backend 원자성으로 불변. 구 manifest 스키마는
  미지원(브레이킹, IndexedDB generation은 미게시 제품 로컬 상태).
- 게이트: 커널 verify-on-read(commit·tree·blob 3단 재대조) + corruption/mismatch 의미론 보존.
  machineStoreContract·generationContract·machineEnvelope + dual-boot/device/clock/display/
  framebuffer/packet/persistent 8기 probe 전부 GREEN(검사 의미 보존, 프로세스 경계는 commit
  주소를 재시작 쿼리로 운반). guest snapshot이 exportImage bundle이 되어 파서도 전환.
  제품 게이트 13/13, npm test 1321, test:types green.

NEXT: P3 - .webmachine = 단일 bundle. webMachineFile writer를 bundle 인코딩(주입 코덱)으로
교체, reader는 헤더 선행 검증으로 payload 접촉 전 신뢰 거부 보존, 구 WEBMACHINE1 감지형 reader.
