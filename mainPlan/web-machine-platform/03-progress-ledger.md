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

## 2026-07-15 - Phase 1/2 Web Machine 이중 엔진 실증

구현:

1. `tests/attempts/webMachine/` 캠페인을 열고 engine import가 없는 `WebMachineHostDraft`를 구현했다.
2. host는 adapter registry, lifecycle state, paused-only snapshot, opaque envelope, device permission, request/packet mode, ownership epoch fencing만 소유한다.
3. fake adapter 두 개에 같은 contract suite를 적용했다.
4. 공개 root export만 쓰는 pyproc adapter와 WASI adapter를 같은 host API에 연결했다.
5. pyproc은 `.pymachine` bytes 기반 `portable`, WASI는 checkpoint index 기반 `session` snapshot으로 보장 차이를 capability에 노출했다.

실측:

- `hostContractProbe` 3회 연속 GREEN 27/27. 공통 lifecycle 4/5/4ms.
- 두 fake adapter가 같은 13-event lifecycle을 통과했다.
- network request/packet mode mismatch와 device permission 부족은 adapter `boot()` 호출 0회에서 차단됐다.
- ownership 상실 request는 `WEB_MACHINE_OUTCOME_UNKNOWN`, 실행 1회, 자동 replay 0회였고 늦은 응답은 다음 request를 오염시키지 않았다.
- `dualEngineProbe` 3회 연속 GREEN 13/13.
- pyproc boot 3147/3040/2920ms, portable snapshot 61-65ms·7,996,254 bytes, live restore 1676-1961ms, adapter shutdown 뒤 cold restore 1907-2085ms.
- WASI boot 497/541/548ms, session snapshot 12-15ms, same-session restore 2-5ms.

판정:

1. 얇은 Web Machine lifecycle은 모형이 아니라 Pyodide와 non-Pyodide CPython 두 실제 엔진에서 성립한다.
2. 혁신 가설의 첫 절반인 multi-engine host contract는 통과했다.
3. 아직 multi-OS는 아니다. 두 guest 모두 Python이므로 "브라우저가 여러 OS를 부팅한다"는 주장은 Phase 3 Linux guest 전까지 금지한다.
4. `src/` 승격도 보류한다. x86/Linux adapter가 같은 contract를 깨지 않는지 먼저 본다.

NEXT:

1. x86 engine의 외부 주입 adapter와 재현 가능한 최소 Linux image를 선정한다.
2. request-mode가 아닌 packet/display/block device 계약을 Linux guest로 검증한다.
3. pyproc과 Linux를 같은 machine registry에서 동시에 부팅하는 `dualBootProbe`를 만든다.

## 2026-07-15 - Phase 3 실제 Linux와 Dual-Boot 핵심 실증

구현:

1. v86 constructor를 integration layer에서 주입받는 `V86GuestAdapterDraft`를 만들었다. host core와 pyproc dependency에는 x86 code가 들어가지 않는다.
2. adapter는 실제 emulator의 `run/stop/destroy/save_state/restore_state`와 serial console을 공통 lifecycle에 연결했다.
3. v86 0.5.424 module/wasm, revision `2f1346b` BIOS, 공식 예제 Buildroot image를 SHA-256으로 고정하는 `prepareV86Assets.mjs`를 만들었다. 바이너리는 레포에 넣지 않는다.
4. pyproc image는 `includeHome: true`로 바꾸고 빈 guest도 `/home/web`을 생성해 사용자 파일 없는 machine 경계를 제거했다.

실패에서 고친 계약:

- 원격 Buildroot image 직접 로드는 격리 브라우저에서 download-error가 났다. 검증된 로컬 실험 캐시로 바꿨다.
- pyproc의 `includeHome: false` image는 memory 값만 살리고 사용자 파일을 버렸다. full home image로 바꿨다.
- full home을 켠 빈 session은 `/home/web`이 없어 export를 거부했다. guest boot가 home 존재를 보장하게 했다.

실측:

- `linuxGuestProbe` 3회 연속 GREEN 8/8. Linux 6.8.12 i686 boot 3661/3662/3657ms.
- Linux state 51,890,928-51,944,164 bytes, snapshot 57-71ms, live restore 54-83ms, v86 destroy 뒤 cold restore 163-175ms.
- `dualBootProbe` full file state 수정본 3회 연속 GREEN 8/8.
- Python OS + Linux 동시 boot 5404/5422/5513ms, dual snapshot 141-190ms, 두 adapter destroy 뒤 cold restore 1862-1928ms.
- pyproc `/home/web/web_machine_value`와 Linux `/tmp/web_machine_value`가 모두 `42`로 복원됐다.
- full home 기준 `dualEngineProbe`도 다시 3회 연속 GREEN 13/13. pyproc image 8,192,958 bytes.

판정:

1. multi-engine을 넘어 하나의 Web Machine Host가 Python OS와 실제 Linux OS를 함께 다룬다는 핵심 가설이 성립했다.
2. 이 결과는 "브라우저를 컴퓨터로 만든다"의 첫 강한 실증이다. 단순 터미널 두 개가 아니라 같은 registry, lifecycle, opaque image, console permission, cold restore를 공유한다.
3. 아직 완성된 브라우저 컴퓨터는 아니다. 공통 block/clock/entropy/packet/display와 탭 종료 뒤 durable commit이 남았다.
4. Linux engine과 image는 미번들이며, 제품 배포 전 별도 license/SBOM 검토가 필요하다.

NEXT:

1. Linux adapter에 실제 block device와 packet network를 연결하고 host permission 선거부를 검증한다.
2. display framebuffer와 input을 capability로 연결하되 headless console을 core에 강제하지 않는다.
3. pyproc + Linux snapshot을 공통 HEAD/PREV generation에 commit하고 모든 탭 종료 뒤 cold reopen한다.
4. 위 경계가 통과되면 host를 `src/` 내부가 아니라 독립 package로 둘지 결정한다.
