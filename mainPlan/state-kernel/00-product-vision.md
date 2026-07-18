# 00. 체제 선언 - 역사를 가진 브라우저 컴퓨터

## 한 문장

머신의 상태(파이썬 힙, guest 머신, 장치)는 두 구역을 가진 **단일 역사 저장소** 안에 산다.
휘발 구역은 실행 경계마다 자라는 체크포인트 나무(64비트 페이지 해시, 정체성 주소, RAM)이고,
내구 구역은 sha256 내용주소 오브젝트 리포(commit DAG + fence 있는 ref + 서명 tag + 이동 가능한 bundle)이며,
두 구역 사이에는 유일한 승격 관문(`collectDelta`) 하나가 있다.

시간여행, `%undo`, fork는 휘발 구역의 연산이고, 저널·세션 저장·영속 머신·서명 봉투는 전부
내구 구역의 같은 커밋 연산이다. git의 포맷이 아니라 git의 불변식(내용주소, 부모 포인터,
ref의 원자 갱신, 서명된 출처)을 가져오되, git이 풀지 않은 문제(멀티탭 owner fencing,
리플레이 환경 지문)를 정식 구성원으로 더한다.

## 왜 지금인가 - 중복의 전수 목록 (판정 근거)

레포 실물을 파일 단위로 대조해 확인한 재발명 목록. 재발명은 프리미티브가 아니라
**프로토콜·스키마·신뢰 계약 수준**에 있다:

1. verify-on-read 3벌
2. HEAD/PREV 2세대 프로토콜 2벌: [machineJournal.js](../../src/capabilities/machineJournal.js)의 HEAD.json/PREV.json vs [machineCommitCoordinator.js](../../src/machine/persistence/machineCommitCoordinator.js)의 head/prev + expectedHead CAS + fence
3. 오류 code 공간 2벌 (PyProcError vs WebMachineError)
4. ECDSA P-256 서명·신뢰 스택 2벌: [machineSignature.js](../../src/session/machineSignature.js) vs [webMachineTrust.js](../../src/machine/image/webMachineTrust.js) - 동일 알고리즘 리터럴의 완전 독립 재구현(실물 확인)
5. digest 구현 2벌 + 주소 형식 2벌: [contentDigest.js](../../src/runtime/contentDigest.js)(bare hex, 전역 crypto) vs [generationIntegrity.js](../../src/machine/persistence/generationIntegrity.js)(`sha256:` 접두, cryptoProvider 주입)
6. 봉투 포맷 2벌: `.pymachine` v2/v3 vs `.webmachine`
7. 세대/커밋 메타 스키마 3벌
8. 페이지 델타 인코딩 3형
9. 환경 정체성 계약 2벌: h0 vs originInstanceId

반면 **델타 수집(`collectDelta`)과 capabilities 이하의 digest는 이미 단일 소스다.**
"프리미티브까지 4중 재발명"이라는 초기 진단은 과장으로 정정됐고, "중복은 3조각뿐"이라는
반대 진단은 위 목록 대비 과소집계로 기각됐다.

추가 확인 사실: `src/machine/` 전체에서 `collectDelta` 호출 0건(machine의 blob은 힙 페이지가
아니라 불투명 payload다), 루트 [index.js](../../index.js) export 실물 37개.

## 성공 기준

- 위 중복 목록 9항이 전부 "커널 한 벌 + 정책/드라이버"로 해소된다.
- 루트 export 37개가 한 자릿수 porcelain(진입 동사 + 머신 핸들)으로 준다. subpath는 3+1로 재편.
- 모든 신설 불변식(승격 관문 유일성, ref 쓰기 순서, corruption/mismatch 이분법, 순수 집합
  전역 접근 0)이 음성 시험으로 이빨을 증명한 기계 게이트가 된다.
- 구 포맷(.pymachine v2/v3, HEAD.json 저널, IndexedDB generation)은 신 경로에서 읽혀
  힙 바이트 동일성 100%로 부활한다. 데이터 유실 0.
- 실행 경계 비용 회귀 0: sha256은 승격 시점에만 발생한다(churnProbe가 세운 비용 법칙 보존).

## 실패(기각) 기준

- 커널 시안이 checkpoint() 경계 비용을 5% 이상 올리면 그 시안 폐기(0단계 probe 1).
- 구 포맷 재구성 리허설에서 바이트 대조 100% 미달이면 해당 포맷 이관 착수 금지(probe 2).
- ref 프로토콜 시안이 고의 위반 주입(순서 위반, stale fence)을 RED로 못 잡으면 게이트 미성립(probe 3).

## 기각된 방향 (사망 기록, 재상정 차단)

1. **커널 전면 기각.** 기각 근거가 아무도 제안하지 않은 설계(경계 동기 sha256)에 대한
   허수아비였고, 중복 산정이 과소였으며, 반대측 처방의 총합 자체가 이름 없는 커널과 동형이라
   자기반박됐다. 단 그 제약 5개(법 추출 선행, machine 배달은 주입, 핫패스 암호 해시 금지,
   corruption/mismatch 구분, 음성 시험 의무)는 전부 최종안에 흡수됐다.
2. **넷의 단일 구현·단일 저장소 통합(초기 가설의 문자적 독해).** reactive는 커밋이 아니라
   index다. 실행 경계 핫패스에 내용주소를 강제하면 측정된 비용 법칙을 위반한다.
3. **stateKernel의 runtime 구역(rank 0-1) 배치와 reactive의 어댑터 평평화.** ref/fencing은
   플랫폼 접촉 관심사라 runtime에 못 살고, reactive를 어댑터 중 하나로 두면 커밋 문법이
   RAM 핫패스로 스며드는 통로가 열린다. 제안자 스스로 철회.
4. **결정적 리플레이 부팅의 기본화.** PYTHONHASHSEED=0 + 엔트로피 스텁은 게스트 가시
   의미론을 바꾼다. 생존형: opt-in + 커밋 헤더 기록.
5. **오류 클래스 병합·상속 병합.** 병합은 레이어 계약을, 상속은 machine 경계 게이트를 깬다.
   소비자 이득은 code 레지스트리 한 표로 동등 달성.
6. **PREV의 reflog window 일반화.** 측정된 필요 없는 표면 확장. 깊이 2 고정 유지.
7. **플랫폼 출하 예측의 방향 기둥화.** 판정 축 위반. 생존형: 커밋 스키마는 변경 페이지 집합만
   가정, 감지기는 MemoryCapability 뒤, 스코프는 능력 preflight 계약.
8. **SIMD 해싱 워커·중첩 해싱의 방향 승격.** 브라우저 실측 0인 가설은 기둥이 될 수 없고,
   중첩 해싱은 torn read로 경계 해시 계약을 깬다. attempts probe 후보로만 잔존.
9. **git 포맷·동사의 문자적 이식.** 고정 크기 페이지 모델에는 merge/rebase/3-way diff의
   의미론이 없다. 커널 동사는 commit/checkout/open/push/export/prune에서 멈춘다. merge는 의도적으로 없다.
10. **wire format의 신뢰 도메인별 2벌 유지.** 도메인 차이는 검증 정책이지 포맷이 아니다.
    파서 2벌 = 취약면 2배(v1 헤더 변조 적발 전과가 실증).
11. **단일 ref 폐쇄 대수.** 휘발 체크포인트에 내용주소를 주면 핫패스가 죽고, 안 주면 ref의
    계약 의미가 파손된다. 명사 둘 + 명시적 승격이 정답.
12. **부분 표면 개편·옛/새 표면 장기 공존.** 정본 판정 불가능한 이중 표면은 하지 않는 것보다
    나쁘다. 내부는 단계, 표면은 일격.
13. **"커널은 subpath 없이 타입으로만 노출".** store 드라이버는 코드다. `pyproc/history`
    plumbing subpath가 기존 선례(`pyproc/machine`)의 정합적 적용이다.

## 남는 실패 (이 체제로도 안 풀리는 것)

전부 실패로 평평하게 남는다. 커널 통합이 주는 것은 완화의 교체 지점이 네 곳에서 한 곳으로
준다는 것까지이며, 공개 표면은 어느 것도 해결로 서술하지 않는다.

- 실행 경계마다 O(heap) 전수 해시. WASM에 mprotect/dirty-page가 없어 제거 불가. 비용
  receipt로 측정 노출될 뿐이다.
- fork·리플레이 결정성이 upstream 우연(PYTHONHASHSEED, 로더 바이트) 위에 있다. 커밋 헤더
  핀 + 발산 게이트로 조용한 오염이 명시적 실패로 바뀔 뿐이다. 워커 간 한정도 그대로다.
- 제로카피 불가. 임의 C 확장 불가. numpy는 네이티브 대비 대폭 느리다(pyproc 밖 문제).
- Firefox/Safari 불가. COOP/COEP가 서드파티 임베드를 깬다. 인바운드 서버·네이티브
  바이너리·CUDA 영구 불가.
- 커널 통합 자체의 신규 위험: 단일 커널 버그의 오염 반경이 네 벌 시절보다 넓다. 음성 시험
  게이트로 상쇄할 뿐 소멸하지 않는다.
