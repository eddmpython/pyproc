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
3. v86 0.5.424 module/wasm, revision `2f1346b` BIOS, 공식 예제 Buildroot image를 SHA-256으로 고정하는 `fixtures/v86/prepareAssets.mjs`를 만들었다. 바이너리는 레포에 넣지 않는다.
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

## 2026-07-15 - 클린 아키텍처와 코드 경계 고정

결정:

1. Web Machine Host는 pyproc `src/`의 새 레이어가 아니라 독립 platform package로 승격한다.
2. 최초 package는 `core`, `browser`, `guest-pyproc`, `guest-v86` 네 개로 제한한다. device별 package 증식은 실제 독립 release 수요 전까지 금지한다.
3. core는 guest/engine 이름과 browser 구현을 모두 모른다. ID, clock, entropy, persistence도 port로 주입한다.
4. browser host는 guest를 import하지 않고, guest adapter끼리도 import하지 않는다. 유일한 조립 지점은 composition root다.
5. `utils`, `common`, `shared`, `helpers` 같은 책임 없는 공유 폴더를 금지한다.

구현:

1. `tests/attempts/webMachine/`을 `host`, `adapters`, `fixtures`, `probes`로 재배치했다.
2. 318줄 단일 host 초안을 `adapterContract`, `snapshotEnvelope`, `webMachineError`, `webMachineHostDraft` 책임으로 분리했다.
3. host의 직접 random 접근을 제거하고 `idFactory`를 composition root에서 주입한다.
4. pyproc과 WASI가 한 파일을 공유하던 구조를 guest별 adapter 파일로 분리했다.
5. v86 module, BIOS, Buildroot image recipe는 `fixtures/v86/` 아래 한 경계로 모았다.
6. 최종 package tree, 의존성 방향, contract, error, naming, durable commit 순서를 [04-clean-architecture-and-code-rules.md](04-clean-architecture-and-code-rules.md)에 고정했다.

기계 게이트:

- attempts root dump와 `utils/common/shared/helpers` 폴더를 차단한다.
- host의 guest/engine 이름과 browser API 접근을 차단한다.
- host 역방향 import, adapter 사이 import, pyproc deep import를 차단한다.
- `probes/` 밖 adapter 등록과 Web Machine import cycle을 차단한다.

회귀 실측:

- 재배치 뒤 `hostContractProbe` GREEN 27/27.
- 재배치 뒤 `dualEngineProbe` GREEN 13/13.
- 재배치 뒤 `linuxGuestProbe` GREEN 8/8.
- 재배치 뒤 `dualBootProbe` GREEN 8/8. 두 OS의 memory/file cold restore가 유지됐다.

판정:

기능 추가보다 먼저 구조를 잠갔다. 다음 block/network/persistence 구현은 이 경계를 통과하는 plugin과 port로만
들어갈 수 있다. 구조 게이트를 완화해야만 기능이 들어간다면 기능 구현이 아니라 설계를 다시 한다.

NEXT:

1. `browser/src/devices/blockDevice`에 해당하는 attempts port를 먼저 계약으로 만든다.
2. pyproc home과 v86 disk를 같은 block generation에 연결하기 전에 fake device로 write/flush/torn commit을 검증한다.
3. HEAD/PREV + CAS persistence를 adapter와 분리된 browser 구현으로 만든다.

## 2026-07-15 - Phase 4 durable generation과 브라우저 프로세스 cold reopen

구현:

1. browser 경계에 bounded block device와 write/flush 분리, SHA-256 content-addressed blob, immutable generation manifest를 구현했다.
2. guest opaque snapshot과 flushed block snapshot을 한 manifest에 넣고 `HEAD(previous -> next)` CAS가 성공한 경우에만 durable로 공개한다.
3. 메모리 store와 IndexedDB store를 같은 계약으로 만들고 HEAD/PREV, blob과 manifest 무결성 검증, 손상 HEAD의 PREV fallback을 구현했다.
4. 브라우저 게이트에 process restart phase를 추가했다. 같은 profile을 유지하되 기존 Edge process tree를 종료하고 새 Edge process가 다음 phase를 연다.
5. pyproc, v86 Linux, 공통 block을 한 IndexedDB generation에 저장하고 새 process에서 guest boot 없이 restore하는 probe를 만들었다.

실패에서 고친 계약:

- host가 등록 device를 object spread로 복제해 class prototype method를 잃었다. device identity를 보존하도록 바꿨다.
- cold restore된 fake adapter가 새 host context를 다시 붙이지 않아 block device를 찾지 못했다. restore가 새 context를 받는 계약으로 고쳤다.
- persistent probe가 browser 전역 이름을 잘못 전달해 restart 직전 대기했다. 전역 `indexedDB`를 명시적으로 주입하고 초기화 오류도 gate report로 드러내게 했다.

실측:

- `generationContractProbe` 3회 연속 GREEN 16/16. memory와 실제 IndexedDB CAS race 모두 정확히 한 commit만 성공했고 기존 generation 덮어쓰기를 거부했다.
- first commit 1-2ms, second commit 0ms, 손상 HEAD의 PREV recovery 1ms였다.
- torn commit은 HEAD를 바꾸지 않았고, HEAD와 PREV가 모두 손상되면 `WEB_MACHINE_RECOVERY_UNAVAILABLE`로 끝났다.
- `persistentDualBootProbe` 3회 연속 GREEN 9/9.
- Python OS + Linux initial boot 5986/6299/6214ms, IndexedDB commit 599/467/469ms, 새 browser process cold restore 2601/2376/2783ms였다.
- 복원 뒤 pyproc과 Linux의 memory/file 값 `42:42`, 공통 block marker, generation hash가 모두 일치했고 두 guest boot history는 0이었다.

판정:

1. 탭의 메모리가 아니라 브라우저 저장소에 두 OS와 장치를 한 완료 경계로 남기는 durable machine 핵심이 성립했다.
2. location reload가 아니라 기존 browser process tree를 종료한 뒤 새 process에서 복원했으므로 process 수명보다 긴 machine이라는 주장을 실측했다.
3. 다만 공통 block image는 같은 generation에 속할 뿐, 아직 pyproc home과 v86 disk가 그 block을 실제 저장장치로 소비하지 않는다.
4. 따라서 Phase 4 전체 완료나 브라우저 컴퓨터 완성을 선언하지 않는다. owner successor, packet/display, 실제 block I/O가 다음 관문이다.

NEXT:

1. pyproc 파일 저장 경계를 block port에 연결해 home 변경이 공통 block generation에 직접 반영되게 한다.
2. v86의 외부 disk I/O를 같은 block port에 연결하고 sector read/write/flush를 fault probe로 검증한다.
3. 두 guest가 공통 block의 서로 분리된 volume을 실제 mount한 상태에서 process cold reopen을 다시 통과시킨다.
4. 이후 packet network와 정확히 한 owner successor를 구현한다.

## 2026-07-15 - 실제 guest file을 block generation으로 분리

구현:

1. pyproc adapter에 공개 `Runtime.fs`만 쓰는 `PYPROC_HOME_VOLUME_1` 형식을 추가했다. pause에서 `/home/web`을 block에 쓰고 guest snapshot은 `includeHome: false`로 만든다.
2. restore는 host가 block을 먼저 복원한 뒤 heap-only `.pymachine`을 열고 home volume을 적용한다. heap snapshot header가 version 2이고 home metadata가 없음을 probe가 직접 검사한다.
3. v86의 callback block buffer를 공통 async block port로 변환하는 ATA bridge를 분리했다.
4. 고정 Buildroot 커널이 제공하는 virtio 9P를 위해 `V86_9P_VOLUME_1`을 추가했다. Linux가 이미 mount한 `/mnt`에 쓴 파일을 pause에서 block에 flush한다.
5. v86 snapshot 직전 9P file tree를 빈 상태로 교체하고 save 뒤 live state를 되돌린다. restore에서는 block volume을 먼저 9P filesystem에 넣으므로 RAM state와 disk가 중복 원본이 되지 않는다.

실패에서 고친 계약:

- 첫 ATA 시도는 `/proc/partitions`가 비고 `/dev/sda`, `/dev/hda`도 없어 RED 0/1이었다. v86 PCI IDE는 존재하지만 현재 Buildroot 6.8.12 kernel에 ATA block driver가 없다. `dd of=/dev/sda`가 일반 파일을 생성한 거짓 양성도 block write 0회로 적발했다.
- 커널에는 `9p`, `9pnet`, `virtio-pci`가 포함되어 있었고 `host9p`가 `/mnt`에 이미 mount돼 있었다. 다시 mount한 첫 9P 복구는 busy 오류가 났다.
- v86 inode는 file도 빈 `direntries`를 가져 `read_dir()`만으로 구분할 수 없었다. `IsDirectory(inodeId)` 계약으로 바꿔 file을 directory로 복원하던 RED 8/11을 고쳤다.

실측:

- `deviceBackedDualBootProbe` 수정본 3회 연속 GREEN 12/12.
- initial boot 5681/6091/6210ms, two-device commit 525/544/660ms, 새 browser process cold restore 2541/2316/2145ms였다.
- Python heap snapshot에는 home payload가 없었고 `/home/web/device_value`는 pyproc block volume에서 `42`로 복원됐다.
- v86 RAM snapshot에는 9P file tree를 넣지 않았고 Linux `/mnt/web/device_value`는 v86 9P block volume에서 `LINUX_BLOCK:42`로 복원됐다.
- 더 큰 volume을 한 번 쓴 뒤 file을 삭제하고 다시 flush했을 때 두 block tail에서 삭제 바이트 잔존은 0이었다.
- 두 adapter의 새 host history에는 boot event가 0이고 restore event만 있었다.

판정:

1. 공통 block은 더 이상 manifest에 같이 실린 독립 marker가 아니다. 두 guest가 실제 file I/O에 사용한 상태의 durable 원본이다.
2. pyproc과 v86의 내부 filesystem 형식을 억지로 통일하지 않았다. 각 guest adapter가 자기 volume wire format을 소유하고 host는 byte range read/write/flush만 안다.
3. 현재 Linux 경로는 sector ATA가 아니라 kernel에 내장된 virtio 9P mount다. disk-capable image를 채택하면 이미 분리한 ATA bridge를 추가 검증한다.
4. block 승격 관문은 통과했지만 packet network, display/input, 정확히 한 owner successor와 배포 검토가 남았다.

NEXT:

1. request network와 packet network를 다른 device contract로 고정하고 v86 NIC를 packet port에 연결한다.
2. framebuffer와 input을 console과 분리해 headless와 desktop 구성을 같은 core에서 조립한다.
3. browser owner를 강제 종료해 정확히 한 successor와 이전 epoch command 거부를 실측한다.
