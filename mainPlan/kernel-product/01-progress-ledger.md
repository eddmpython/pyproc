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

## 2026-07-18 - P4 완료: VirtualOrigin 공개 표면 재노출

- runtimeBindings에 enableVirtualOrigin 추가: machine.runtime.enableVirtualOrigin(asgi?, cfg?)로
  공개 도달 경로 복원(asgi 생략 시 enableAsgiServer로 생성). Runtime 계약 게이트 목록과
  index.d.ts에 편입. 예제·소비자 게이트의 SW 내부 프로토콜 인라인을 공개 경로로 되돌리는
  것과 브라우저 실동작 검증은 P5 통합 제품에서 함께.
- npm test 1321, test:types green.

## (병행) P3 진행 중: .webmachine = 단일 bundle

- bundleFormat의 commit을 선택형으로 일반화(세션 bundle은 commit 실음, machine envelope는 안 실음 -
  두 소비자가 같은 wire 포맷 공유, meta로만 갈림). 헤더 서명(header-target)이 payload 접촉 전
  신뢰 거부를 이미 보장하므로 .webmachine의 조기 거부 계약이 그대로 성립한다.
- webMachineFile을 bundle 위에 재기초(주입 코덱 + 조기 거부 reader + 구 WEBMACHINE1 감지형 reader),
  coordinator preflight·machineEnvelopeProbe 이행은 병행 작업 단위로 진행.

NEXT: P3 수합(게이트 검증) -> P5 통합 제품 Web Computer v2(porcelain python 패널 + 단일 bundle
저장·이동 + VirtualOrigin 공개 경로 + 전 게이트).

## 2026-07-18 - P5 진행: 통합 제품에 시간여행 표면 추가

- pyproc guest 어댑터 request 프로토콜에 history 3종(checkpoint/undo/historyDepth) 추가:
  통합 상태 커널의 휘발 구역(체크포인트 나무)을 guest 요청으로 연다. 제품이 서버 0으로
  "실행 전 체크포인트, 실패하면 undo"를 쓴다.
- webComputerRuntime에 checkpointPython/undoPython/pythonHistoryDepth, 제품 UI(index.html)에
  Checkpoint/Undo 버튼 + history 뱃지, app.js 배선.
- 제품 게이트(gate.js restorePhase)에 시간여행 E2E: checkpoint -> machineValue=777 변이 ->
  undo(checkpoint.index) -> machineValue=91 복귀. checkpoint 트리 index 반환과 depth 증가 검증.
- npm test 1321 green. 브라우저 제품 게이트는 P3(.webmachine) 수합과 함께 실행.

(P3, P5 종결 기록은 아래 최종 절)

## 2026-07-18 - P3, P5 완료 및 이니셔티브 종결

- P3(.webmachine = 단일 bundle): bundleFormat의 commit을 선택형으로 일반화해 세션 bundle과
  machine envelope가 같은 wire 포맷(PYBUNDLE1) + 같은 서명 방식 + 같은 접두 신뢰 판독을
  공유하고 meta로만 갈린다. machineCryptoProvider.state에 bundle 코덱 6종 주입, webMachineFile을
  bundle 위에 재기초(합성 manifest로 기존 소비 계약 유지, 구 WEBMACHINE1 감지형 reader).
  제품 신뢰 화면(imageTrust)도 접두 판독기로 전환. 조기 거부 실증: 64MB 이미지에서 미신뢰
  signer를 slice 2회(byte 2436까지)만 읽고 거부, payload 미접촉.
- P5(통합 제품): pyproc guest에 history request 3종, 제품 UI Checkpoint/Undo + 게이트 시간여행
  E2E(checkpoint -> 변이 -> undo -> 복귀). 제품은 전 산물을 소비한다: Python OS + Linux
  dual-guest, 커널 스키마 durable commit, 단일 bundle signed export/import, 멀티탭 owner, 시간여행.
- 게이트 전판 직접 재실행 GREEN: 구조 1321, 타입 0error, machineEnvelope 21/21, browser 84/84,
  web-computer 13/13(시간여행 + bundle import 포함), consumer 30/30, examples 10/10, mcp 7/7,
  package 20 files.
- 미해결 4건 전부 해소: (1) bundle header-target 서명(조기 거부) (2) machine generation 커널
  스키마 (3) .webmachine 단일 bundle (4) VirtualOrigin 재노출. 통합 제품 실증까지 완료.
