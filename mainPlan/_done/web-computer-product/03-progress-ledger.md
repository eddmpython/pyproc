# 03. 진행 원장

## 2026-07-16 - Web Computer Product 착수

결정:

1. Web Machine의 기술 완료와 사용자가 쓰는 제품 완료를 분리한다.
2. 제품 composition root를 `apps/webComputer/`에 두고 독립 package 공개 root만 소비한다.
3. 첫 제품은 Python OS와 Buildroot Linux의 dual workspace로 제한한다.
4. 저장은 두 guest snapshot과 두 block volume의 단일 CAS generation만 성공으로 본다.
5. 이동은 P-256 signed `.webmachine`, 명시적 signer trust, fresh-profile import까지 한 동선으로 닫는다.
6. provenance가 불완전한 Linux image는 숨기지 않고 Development image로 표시한다.

NEXT:

1. 제품 셸과 runtime composition을 구현한다.
2. 실제 제품 동선 E2E를 만든다.
3. 회귀 검증 뒤 완료 원장과 `_done` 이관을 수행한다.

## 2026-07-16 - 제품 구현과 완료

구현:

1. `apps/webComputer/`에 반응형 제품 화면을 만들고 Python OS editor, Linux VGA text display, Linux terminal, PS/2 keyboard input을 연결했다.
2. 두 guest의 pause, resume, shutdown과 전체 Save를 같은 제품 controller에서 제공한다.
3. `IndexedDbGenerationStore`와 `MachineCommitCoordinator`로 두 portable snapshot과 두 block volume을 한 CAS generation에 commit한다.
4. `WebLockOwnerCoordinator`와 durable epoch로 workspace owner를 한 탭으로 제한한다.
5. 명령 실행 뒤 자동 Save와 수동 Save를 연결하고 browser process restart 때 HEAD를 읽어 guest boot 없이 복원한다.
6. device-local P-256 identity, signed `.webmachine` export, untrusted header의 signer·machine·device 표시, 명시적 Trust and import를 연결했다.
7. engine, WASM, firmware, Linux image를 `assetCatalog.json`의 byte length와 SHA-256으로 준비하고 binary는 git과 npm package에서 제외했다.
8. 실행 자산의 불완전한 provenance를 숨기지 않고 제품에 Development channel로 표시하고 public redistribution을 차단했다.
9. 제품 UI가 package public root만 소비하는 구조 게이트와 세 browser process phase의 실제 제품 E2E를 추가했다.

실측:

- `test:web-computer` GREEN 9/9.
- 제품 부팅 6,988ms.
- Python/Linux 실제 명령과 durable commit 707ms.
- 두 guest snapshot payload 합계 60,739,253 bytes.
- browser process restart 복원 확인과 export 1,063ms.
- signed `.webmachine` 65,001,684 bytes.
- 원본 IndexedDB가 없는 fresh browser profile import 4,277ms.
- import 뒤 Python memory/file `91:PYTHON_PRODUCT:91`, Linux memory/file `91:LINUX_PRODUCT:91` 일치.
- `npm test` 873/873, 기본 browser gate 47/47, package consumer와 제품 consumer PASS.

판정:

1. Web Machine은 probe 집합을 넘어 사람이 직접 사용하는 Web Computer 제품 표면을 갖췄다.
2. 제품은 Python OS와 Linux의 입력, 화면, 파일, memory, lifecycle, durable recovery, portable signed image를 한 workspace로 제공한다.
3. 공개 npm의 pyproc 정체성과 독립 private Web Machine package 경계는 유지됐다.
4. Linux 실행 자산은 제품 구현에는 사용 가능하지만 provenance가 불완전해 Development channel이다. 공개 image 재배포와 공개 Web Machine package release는 구현 완료와 별도 compliance·release 작업이다.
5. README 완료 조건 6개를 모두 충족했으므로 이니셔티브를 완료하고 `_done`으로 이관한다.
