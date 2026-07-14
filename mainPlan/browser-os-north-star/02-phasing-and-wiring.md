# 02. 페이징과 배선

## Phase 0 - 목표 고정

상태: 완료.

작업:

1. `docs/product/vision.md`의 North Star를 Browser Python OS로 정렬한다.
2. 활성 이니셔티브를 열어 OS 목표, 판정표, 다음 증명을 한 곳에 둔다.
3. 기존 `browser-os` 완료 기록의 "조건부 OS" 판정을 새 라운드의 출발점으로 삼는다.

게이트:

- `npm test` green.
- 문서에 OS 목표와 브라우저 보안 벽이 함께 적혀 있어야 한다.

## Phase 1 - OS 판정표 v2

상태: 완료. 결과는 [04-os-verdict-v2.md](04-os-verdict-v2.md)가 정본이다.

목표: P2/P4/P6 완료 이후의 현재 OS 점수를 다시 낸다.

작업:

1. `mainPlan/_done/browser-os/02-os-verdict.md`의 10축 점수표를 v2로 재평가한다.
2. 점수 근거는 src 승격 능력과 browser gate/probe 실측만 사용한다.
3. "OS라고 부를 수 있는 조건"과 "아직 조건부인 이유"를 같은 문서에 둔다.

게이트:

- 각 축이 파일/심볼/실측 경로를 가진다.
- 점수 상승이 기능명 나열이 아니라 동작 계약으로 설명된다.

## Phase 2 - 성능 봉투

상태: 완료. 512MB checkpoint/session/fork/journal 실측과 journal 반복 blob IO 최적화는 [05-large-heap-envelope.md](05-large-heap-envelope.md)에 기록됐다.

목표: 큰 힙에서 OS 프리미티브 비용을 공개한다.

측정 항목:

- 500MB, 1GB, 2GB 힙에서 checkpoint.
- restoreLive, timeTravel, fork, journal commit/recover.
- OPFS base 저장/로드, pack/prune 전후.
- 메모리 사용량과 브라우저 탭 안정성.

게이트:

- Edge/Chrome 중 최소 하나에서 수동 실측표.
- 숫자가 나쁘면 그대로 기록하고, 최적화 후보를 별도 Phase로 분리한다.

## Phase 2.5 - 이동 가능한 머신 이미지

상태: 완료. `.pymachine`은 힙 델타와 `/home/web` 파일 트리를 함께 담고, WebCrypto signature로 출처를 검증한다.

목표: "파일 하나로 컴퓨터를 보낸다"를 힙 상태에서 디스크 세계까지 확장한다.

게이트:

- `machineImageProbe.html`이 힙 상태와 `/home/web` 텍스트/디렉터리/바이너리 파일을 함께 복원한다.
- 봉투 해시가 manifest, delta, home payload 전체를 덮는다.
- trust 게이트는 유지되고, trusted public key가 있으면 `trust: true` 없이 열린다.

## Phase 3 - 대표 데모 3종

상태: 완료. 1번 크래시 생존 머신의 signed session cast 흐름은 `examples/machine.html`, 2번 브라우저 안 서버 개발 흐름은 `examples/serverDev.html`, 3번 멀티프로세스 데이터 작업 흐름은 `examples/speedLab.html`에 배선됐다. 셋 다 `npm run test:examples` gate가 검증한다.

목표: OS 목표를 한눈에 보이게 만든다.

데모:

1. **크래시 생존 머신**: 코드 실행, 파일 생성, signed `.pymachine` cast, 탭 죽음, 재방문 복구.
2. **브라우저 안 서버 개발**: FastAPI/SQLite/HTML을 VirtualOrigin으로 띄우고 수정 후 재서빙.
3. **멀티프로세스 데이터 작업**: numpy matmul을 단일 worker와 4-worker sharding으로 나누고 결과 비교.

게이트:

- 사람용 example과 `?gate` 자동 검증을 분리한다.
- 데모는 제품 UI가 아니라 OS 프리미티브 증명이어야 한다.

## Phase 4 - 호환성 실험실

목표: "로컬처럼"을 패키지·워크로드 단위로 쪼개 공개한다.

작업:

1. top 패키지 import/install/run smoke matrix.
2. 실패군 분류: delivered, virtualized, upstream-pending, permanent wall.
3. Pyodide 버전 변경 시 재측정 절차.

게이트:

- 성공률보다 실패 분류의 정직성이 우선이다.
- 지원 표면은 README와 `docs/product/vision.md`의 네 상태와 일치해야 한다.

## Phase 5 - 소비 배선

목표: OS 커널이 실제 제품 표면 아래에서 쓰이게 한다.

작업:

1. dartlab/codaro/xlpod 중 하나가 OS 프리미티브 묶음을 공개 surface만으로 소비한다.
2. deep import 또는 `raw` 접점이 생기면 pyproc 표면을 확장하거나 소비 설계를 고친다.
3. `getPyProcAssetManifest()`, `pyproc-assets` CLI, `verifyPyProcAssetIntegrity()`를 소비 배포 파이프라인의 copy/SRI/runtime preflight 정본으로 쓴다.
4. 소비자 문서에 버전 핀과 권한 경계를 남긴다.
5. codaro는 Vite base-aware `pyproc-assets.json` fetch와 editor build 후처리 생성기를 갖췄고, pyproc SHA `a7fc83906cfa7bf24c009c8631043738423fa84a` 핀 뒤 실제 editor build가 25개 파일 graph와 5개 entrypoint role을 산출한다.
6. codaro는 `Runtime.fs`와 `AsgiServer`를 공개 표면으로 소비하는 제품 gate를 갖췄다. `pyproc-runtime-fs-browser`는 JS `Runtime.fs`와 Python `open()`이 같은 파일 세계를 보는지 확인하고, `pyproc-asgi-browser`는 브라우저 커널 안 Python ASGI 앱 요청/응답 왕복을 확인한다.

완료 조건:

- 제품 하나가 복원, 파일, 서버 또는 프로세스 OS 중 둘 이상을 pyproc 공개 표면으로 사용한다.
- pyproc 문서의 성공 기준이 실제 import로 충족된다.
