# 01 - 진행 원장

재개 지점은 항상 이 문서의 마지막 줄이다.

## 2026-07-19 개설: 3표면 커버리지 감사(전문 에이전트 병렬) + 델타 soundness fuzz 착수

외부 리뷰에서 흡수할 것을 골랐다. **거부**: 채택 축(1.5/10 등 = 저장소 금지 규칙),
범위 축소(North Star 배반), 공개 벤치 간판(숫자 자랑 금지). **흡수**: 차별점의 soundness
검증 강도 - 리뷰가 정확히 짚었고 저장소 자체 규칙("게이트 없는 경로 리팩터 시 게이트 동반",
"검증할 수 없으면 검증했다고 쓰지 않는다")과 같은 본능이다.

### 감사 결과(3표면 병렬, 읽기 전용)

세 전문 에이전트가 차별점 표면의 현재 게이트 커버리지를 매핑했다. 수렴한 핵심 발견:

**가장 강한 커버리지가 삭제 예정 non-CI attempts probe에 산다.** branchProbe(분기 참조
무결성), kernelElectionProbe(S1/S3 election), soundnessProbe(해시), growthRestoreProbe,
exceptionRestoreProbe - 전부 `npm run test:browser`가 안 돌리는 수동 probe이고 캠페인 종결
시 폴더째 삭제된다. pythonMachine 캠페인은 이미 `_done`. 즉 강한 증거가 휘발성·무방비다.

**여러 핵심 주장이 CI 커버리지 0:**
- 휘발(delta): `pageHashes` false-negative 없음(reactive.js:4가 "sound의 열쇠"로 선언한
  바로 그것)의 CI 게이트 0. 유일한 해시 시험(soundnessProbe)은 재구현 해시·단일 benign
  입력·non-CI. 전 힙 바이트 동일성 오라클은 어디에도 없다(전부 Python 스칼라/4바이트 마커).
  잠재 결함 RG3: `pageHashes`가 `len%4` 꼬리 바이트 미해싱(실힙 PAGE_SIZE 배수라 우연 안전,
  미문서·미검증 전제).
- 내구(durable): **bundle index-forgery 라이브 게이트 부재** - 이번 세션 header-target
  서명의 핵심 증명이 졸업하며 삭제된 attempts probe(headerTagProbe)에 있었고 어떤 라이브
  게이트도 승계 안 함(정확히 규칙 위반). `machineImage.js`(적대적 입력 파서)의 v1 거부·
  validateMeta/validateManifest 경계 라이브 게이트 0. verify-on-read는 페이지 blob 1개
  변조로만 검증(commit/tree 오브젝트, byte-length 경계 미검증). OPFS crash-at-point 미검증
  (유일한 쓰기순서 게이트는 partial write 불가능한 MemoryStore).
- 동시성(election): **KernelElection 런타임 CI 게이트 전무**(method-existence만). split-brain
  (PYPROC_SPLIT_BRAIN) 실행 0. served-cache 멱등성 0. reject 상태기계 4콜러 중 2개만.
  결정적으로: 이 대부분이 fake BroadcastChannel/locks/mem으로 **순수 Node 테스트 가능**.

### Phase 1 착수: [해시 soundness] Node fuzz (커밋 1)

`tests/run.mjs`에 `[해시 soundness]` 섹션 신설(순수 함수 + fake engine, WASM 0):
1. 임의 변이 false-negative 0 (fuzz 1200회, 시드 고정 mulberry32) - 오라클 byteDiffPages.
2. 힙 성장분 페이지 전량 포함 (400회).
3. packPages/unpackPages 왕복 바이트 동일 (400회).
4. PAGE_SIZE 4바이트 정렬 전제 load-bearing 고정(RG3를 문서화된 경계로 전환).

**음성 시험**: pageHashes 내부 루프를 stride-8 샘플링으로 바꾸니 fuzz가 it=0에서 즉시
RED("페이지 0 변이 미감지"). SSOT 주석("샘플링 -> 불완전 델타 -> 복원 크래시")이 이제껏
갖지 못한 음성 증명이다. 되돌려 GREEN.

재개 지점: Phase 1 계속 - 내구(bundle index-forgery + machineImage 경계 Node 게이트) +
동시성(KernelElection reject 상태기계 + split-brain Node 게이트) + 휘발 나머지(reactive
나무 참조 무결성 Node, 전 힙 왕복 browser). 그 뒤 Phase 2(browser: 전 힙 round-trip,
OPFS crash, PyProc mid-flight death), Phase 3(단일 호환성 표 + O(heap)·peak memory 정직화).
