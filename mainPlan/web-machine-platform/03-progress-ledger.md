# 03. 진행 원장

## 2026-07-15 - Web Machine Platform 이니셔티브 개설

결정:

1. 최상위 North Star를 "브라우저에 Python OS를 만든다"에서 "브라우저를 여러 OS가 올라가는 컴퓨터로 만든다"로 확장한다.
2. pyproc은 범용 host가 아니라 첫 번째 Python guest OS로 유지한다.
3. 공통화 대상은 guest 내부 syscall이 아니라 boot, device, resource, snapshot, recovery 생명주기다.
4. engine별 snapshot은 opaque payload로 두고 `.webmachine` 공통 봉투가 identity, integrity, disk, permissions를 운반한다.
5. host 코드는 두 엔진 실측 전 `src/`에 넣지 않는다.
6. 첫 구조 증명은 pyproc + WASI, 첫 제품급 증명은 pyproc + Linux Dual-Boot로 잡는다.

근거:

- pyproc은 Python guest 안에서 process, IPC, disk, virtual network, permissions, image, multi-tab failover를 이미 실측했다.
- 기존 browser OS 실행 사례가 있으므로 "OS 하나가 브라우저에서 돈다"는 혁신 기준이 아니다.
- 새 가치는 여러 engine의 lifecycle과 장치를 한 host contract로 묶고, 탭보다 오래 사는 이동 가능한 머신으로 만드는 데 있다.

완료:

- 새 이니셔티브의 비전, 아키텍처, phasing, ledger 골격 작성.
- 기존 `browser-os-north-star`를 Python guest OS 하위 트랙으로 재해석하는 구조 결정.
- 저장소 규칙, 제품 비전, 공개 README 2종, mainPlan 인덱스의 North Star 계층 정렬.
- 공통 snapshot을 paused 완료 경계로 제한하고, 외부 I/O는 capture가 아니라 resume 전 device reattach 대상으로 고정.
- 선행 범주와 혁신성 기준을 분리해 OS 하나의 브라우저 부팅을 새 주장으로 쓰지 않도록 고정.
- Phase 0 완료.

NEXT:

1. `tests/attempts/webMachine/README.md`에 Phase 1 가설과 contract gate를 연다.
2. fake guest 두 개로 같은 lifecycle suite를 통과시킨다.
3. pause 경계, device mode, outcome-unknown 오류를 browser probe로 검증한다.
