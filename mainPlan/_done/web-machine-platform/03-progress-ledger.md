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

## 2026-07-15 - Linux NIC packet network와 process cold reattach

구현:

1. browser 경계에 `kind: network`, `mode: packet`인 bounded Ethernet switch를 추가했다. endpoint 중복,
   frame 크기, queue 상한을 구조화 오류로 거부하고 frame bytes를 복제하며 source MAC만 학습한다.
2. v86 전용 bridge는 공개 NIC bus의 `net0-send`와 `net0-receive`만 packet port에 연결한다. browser device는
   guest와 engine 이름을 모르며 v86 adapter만 bridge를 import한다.
3. ARP와 ICMP 정책은 core나 switch가 아니라 probe fixture에 두었다. Linux `eth0`가 10.77.0.1 peer에
   실제 ARP request와 ICMP echo를 보낸다.
4. packet port와 browser handle은 generation payload에 넣지 않는다. cold restore는 새 switch endpoint를
   연결하고 opaque NIC state만 복원한다.
5. 구조 게이트가 block과 packet device, v86의 block·filesystem·packet bridge 존재와 기존 의존성 방향을 고정한다.

실패에서 고친 계약:

- 첫 process cold restore는 RED 13/14였다. peer의 reply frame은 switch와 v86 NIC bus를 통과했지만 Linux
  ping은 수신 0이었다.
- 새 process의 v86 NIC가 임의 MAC을 생성한 반면 Linux RAM과 송신 frame은 snapshot의 이전 MAC을 사용했다.
  reply destination과 NIC receive filter가 달라 올바른 frame을 폐기했다.
- packet device를 쓰는 portable restore는 `preserve_mac_from_state_image`를 강제해 guest RAM, 송신 frame,
  NIC filter가 같은 장치 identity를 보도록 고쳤다.

실측:

- `packetNetworkProbe` 수정본 3회 연속 GREEN 14/14.
- 최초 Linux boot 3909/3251/3350ms, ARP와 ICMP round trip 160/185/167ms, generation commit
  412/329/332ms였다.
- 기존 Edge process tree 종료 뒤 cold restore 452/380/357ms, 새 packet port의 ping round trip
  137/117/129ms였다.
- request/packet mode mismatch와 permission 부족은 engine constructor 0회에서 거부됐다.
- duplicate endpoint, 64-byte frame 상한, queue 포화, 닫힌 port, 송신 bytes 격리 fault가 모두 통과했다.
- cold restore 뒤 switch는 source MAC 2개를 학습했고 frame drop 0, delivery error 0이었다. adapter shutdown과
  peer 종료 뒤 endpoint도 0이 됐다.

판정:

1. request bridge를 packet network라고 이름만 바꾼 것이 아니라 실제 Linux NIC의 Ethernet frame이 공통
   device port를 왕복했다.
2. packet device는 OS나 protocol policy를 모르고, guest bridge는 browser persistence를 모른다. 네트워크
   기능을 추가해도 고정한 package 의존성 방향을 완화하지 않았다.
3. NIC handle을 snapshot에 직렬화하지 않고 새 process에서 재연결했으므로 외부 device reattach 계약이
   block과 별도로 성립했다.
4. 인터넷 relay, NAT, DNS는 이번 증명의 범위가 아니다. raw packet port 위에 조립할 별도 network policy다.

NEXT:

1. framebuffer와 input을 console과 분리해 headless와 desktop 구성을 같은 core에서 조립한다.
2. browser owner를 강제 종료해 정확히 한 successor와 이전 epoch command 거부를 실측한다.
3. clock과 entropy를 ambient browser 접근이 아닌 명시적 device port로 주입한다.

## 2026-07-15 - VGA text display와 PS/2 keyboard cold reattach

구현:

1. browser 경계에 `text-cells` display와 `ps2-scan-code` input을 별도 device로 추가했다. console과 UI
   object를 재사용하지 않는다.
2. display는 최대 크기, cell 범위, 단일 producer를 강제하고 working frame을 revision 단위로 복제 present한다.
   subscriber가 받은 cells를 바꿔도 장치의 presented frame은 변하지 않는다.
3. input은 focus endpoint 하나, batch byte 상한, bounded queue를 강제하며 전달 전후 bytes를 격리한다.
4. v86 display bridge는 공개 VGA text event만, input bridge는 공개 keyboard scan code API만 쓴다. adapter는
   각 장치를 별도 capability로 요구하며 mode/permission mismatch를 engine constructor 전에 거부한다.
5. pause는 input queue를 drain하고 endpoint를 분리한 뒤 emulator를 멈춘다. cold restore 중에는 display만
   연결해 VGA state를 redraw하고 resume 직전에 새 input endpoint를 연결한다.

실패에서 고친 계약:

- 첫 probe는 RED 0/1이었다. Buildroot image가 이미 VGA tty shell을 제공하는데 두 번째 shell을 `/dev/tty1`에
  띄워 한 scan code batch가 서로 다른 input owner에 분산됐다.
- 별도 shell 생성을 제거하고 기존 VGA prompt 하나만 keyboard focus owner로 사용했다. 장치 구현이나 scan
  code를 우회하지 않았고, raw input이 원래 guest console을 직접 소비하게 했다.

실측:

- `displayInputProbe` 수정본 3회 연속 GREEN 18/18.
- Linux initial boot 3832/3503/4003ms, 최초 PS/2 command와 VGA marker present 354/349/344ms,
  generation commit 347/297/299ms였다.
- 기존 Edge process tree 종료 뒤 cold restore 356/353/352ms, 새 display/input의 command와 frame present
  437/426/458ms였다.
- cold restore 직후 새 80x25 display는 revision 2로 이전 VGA frame을 redraw했고 input은 연결되지 않았다.
  resume 뒤 keyboard batch 82 codes가 Linux에 전달되어 `/tmp/reopened`를 실제 생성했다.
- display mode mismatch와 input permission 부족은 engine constructor 0회에서 차단됐다. duplicate/busy endpoint,
  display range/size, frame clone, input queue/batch, paused input, shutdown detach fault가 모두 통과했다.

판정:

1. serial console text를 화면이라고 복사한 것이 아니라 VGA device event로 별도 frame을 만들었다.
2. request API로 Linux command를 실행한 것이 아니라 PS/2 scan code가 guest keyboard controller와 tty를
   거쳐 파일을 생성했다.
3. display와 input handle은 generation에 넣지 않고 새 process에서 다시 연결했다. output은 paused restore에
   필요하지만 input은 resume 전까지 차단한다는 방향별 lifecycle 차이도 숨기지 않았다.
4. 이번 통과 범위는 VGA text cells와 keyboard다. RGBA framebuffer, pointer, clipboard를 완료로 부르지 않는다.

NEXT:

1. browser owner를 강제 종료해 정확히 한 successor와 이전 epoch command 거부를 실측한다.
2. RGBA framebuffer와 pointer mode를 text/keyboard와 다른 capability로 추가한다.
3. clock과 entropy를 ambient browser 접근이 아닌 명시적 device port로 주입한다.

## 2026-07-15 - 단일 owner와 durable epoch successor

구현:

1. browser coordination 경계에 `WebLockOwnerCoordinator`를 추가했다. 같은 machine lock을 exclusive로
   획득하고 복구가 끝나기 전에는 owner 준비 완료를 공개하지 않는다.
2. `IndexedDbOwnerEpochStore`가 lock 획득마다 machine별 owner identity와 epoch를 한 transaction에서 갱신한다.
   release와 assert는 현재 token이 아니면 `WEB_MACHINE_OWNER_STALE`로 거부한다.
3. machine handle에 `adoptOwnership({ ownerId, epoch })`를 추가했다. command는 전송 시점의 owner identity와
   epoch를 함께 잡고 둘 중 하나라도 달라지면 결과를 `WEB_MACHINE_OUTCOME_UNKNOWN`으로 폐기한다.
4. iframe 네 개를 독립 composition root로 만들었다. 각 context는 자체 host와 adapter를 만들되 Web Lock,
   owner epoch record, 완료 generation만 같은 origin 자원으로 공유한다.
5. 정상 양도는 machine을 먼저 invalidate하고 epoch를 release한 뒤 lock을 넘긴다. 강제 제거는 정리 callback에
   의존하지 않으며 browser가 lock을 회수하면 successor가 새 epoch를 claim한다.

실측:

- `ownerSuccessorProbe` 3회 연속 GREEN 11/11.
- 최초 owner 준비 196/173/189ms, 정상 successor 22/22/23ms, owner iframe 강제 제거 successor
  21/22/23ms였다.
- 네 context 경쟁 동안 해당 Web Lock은 held 1, pending 3이었다. 정상 양도 뒤 held 1, pending 2,
  강제 제거 뒤 held 1, pending 1로 유지됐고 같은 epoch owner가 둘인 순간은 없었다.
- successor는 epoch 2와 3을 claim하고 같은 `owner-generation-1`의 값 42를 복구했다. successor history의
  boot event는 0이고 새 generation commit과 command replay도 0이었다.
- 이전 owner의 slow command는 adapter에서 정확히 1회 실행됐지만 ownership loss 뒤 결과는 outcome unknown,
  `retryable: false`였고 machine owner는 null이었다.
- 강제 제거된 epoch 2 token은 durable store에서 stale로 거부됐고, 최종 정리 뒤 held/pending lock은 0이었다.

판정:

1. 단일 owner는 탭 사이 메시지 관례가 아니라 browser가 보장하는 exclusive lock으로 성립한다.
2. Web Lock의 휘발성 수명과 IndexedDB의 durable epoch를 분리해 hard kill 뒤에도 stale owner를 식별한다.
3. successor는 guest를 새로 boot하거나 미확정 command를 replay하지 않고 마지막 완료 generation만 복구한다.
4. coordinator와 epoch store는 guest 이름을 모르며 host는 browser 전역을 모른다. coordination 추가 때문에
   고정한 의존성 방향을 완화하지 않았다.

NEXT:

1. RGBA framebuffer와 pointer mode를 text/keyboard와 다른 capability로 추가한다.
2. clock과 entropy를 ambient browser 접근이 아닌 명시적 device port로 주입한다.
3. 이동 가능한 `.webmachine` envelope와 engine/image license, SBOM 배포 게이트를 닫는다.

## 2026-07-15 - RGBA framebuffer와 relative pointer cold reattach

구현:

1. browser 경계에 `MemoryRgbaDisplayDevice`를 추가했다. bounded RGBA8888 region을 working frame에 쓰고
   revision 단위로 복제 present하며 단일 producer, frame 크기, stride, bytes 범위를 강제한다.
2. `CanvasRgbaFrameSource`는 v86 canvas의 `putImageData` 완료 지점에서 실제 dirty region만 합쳐 RGBA bytes로
   읽는다. guest와 engine을 모르며 listener마다 pixels를 복제한다.
3. `MemoryRelativePointerDevice`는 keyboard와 다른 단일 focus와 bounded queue를 가진다. move, buttons, wheel을
   이름 있는 event로 제한하고 delta 상한과 paused detach를 강제한다.
4. v86 전용 framebuffer bridge는 `screen-set-size`로 graphical mode와 크기를 받고 canvas region을 공통
   display에 쓴다. pointer bridge는 공통 y-down 좌표를 v86 PS/2 mouse bus 좌표로 변환한다.
5. hash 고정 KolibriOS floppy image를 ignored fixture cache에 추가했다. graphical guest는 1024x768x32bpp
   VGA와 PS/2 mouse를 실제 사용하며 binary는 레포와 package에 넣지 않는다.

실패에서 고친 계약:

- 첫 probe는 RED 1/2였다. 기존 Buildroot Linux 6.8.12 image에는 `/proc/fb`, `/dev/fb0`,
  `/dev/input/mice`가 모두 없었다.
- text console을 RGBA처럼 렌더링하거나 host에서 pointer event를 받은 사실만 세면 guest device I/O 증명이
  아니다. 고정 Linux image를 억지로 우회하지 않고 실제 VGA graphical mode와 PS/2 mouse를 쓰는 hash 고정
  guest fixture로 바꿨다.

실측:

- `framebufferPointerProbe` 수정본 3회 연속 GREEN 18/18.
- graphical guest boot 5247/5309/5276ms, 최초 pointer 뒤 frame 변화 40/39/39ms, generation commit
  141/132/134ms였다.
- 기존 Edge process tree 종료 뒤 paused cold restore 200/200/180ms, resume 뒤 새 pointer가 frame을 바꾸기까지
  36/37/45ms였다.
- cold restore 직후 새 display는 1024x768 RGBA8888 frame을 revision 1로 redraw했고 32개 이상의 실제 색을
  포함했다. pointer endpoint는 붙지 않았다.
- resume 뒤 relative move 하나가 v86 PS/2 controller와 guest를 거쳐 일관되게 138 pixels를 바꿨다.
- mode mismatch와 pointer permission 부족은 engine constructor 0회에서 차단됐다. display region/stride/bytes,
  canvas clone, pointer queue/delta, paused input, shutdown detach fault가 모두 통과했다.

판정:

1. VGA text를 canvas에 다시 그린 것이 아니라 graphical guest가 만든 32bpp pixel output을 공통 frame으로
   전달했다.
2. DOM mouse listener를 guest 입력으로 가장하지 않고 공통 pointer queue가 v86 PS/2 bus로 들어가 guest frame을
   바꾸는 끝단까지 검증했다.
3. framebuffer와 pointer handle은 generation에 넣지 않았다. 새 process는 opaque guest state만 복구한 뒤
   output을 먼저 redraw하고 resume 직전에 input을 붙였다.
4. text/pixel display와 keyboard/pointer를 각각 별도 implementation으로 유지해 mode Boolean과 UI object
   누적 없이 장치 능력을 확장했다.

NEXT:

1. clock과 entropy를 ambient browser 접근이 아닌 명시적 device port로 주입한다.
2. `.webmachine` envelope의 schema, integrity, adapter capability 요구를 실제 export/import로 검증한다.
3. v86, BIOS, Buildroot, KolibriOS 구성물의 정확한 license와 SBOM 배포 게이트를 닫는다.

## 2026-07-15 - Linux CMOS clock과 RDRAND entropy cold reattach

구현:

1. browser 경계에 `BrowserClockDevice`를 추가했다. wall과 monotonic 공급원, timer scheduler를 생성자에서
   주입받고 monotonic 역행, timer delay, pending 상한을 구조화 오류로 거부한다.
2. `BrowserEntropyDevice`는 주입된 CSPRNG에서 한 번에 최대 65,536 bytes를 동기로 읽고 반환 bytes를 복제한다.
   source failure와 read 크기 오류를 분리하며 random 전역을 직접 읽지 않는다.
3. v86의 공식 `wasm_fn` import에서 `microtick`을 공통 clock으로, `get_rand_int`를 공통 entropy의 little-endian
   int32로 바꿨다. engine WASM instantiation은 composition root가 주입한다.
4. v86 0.5.424의 CMOS RTC는 `Date.now()`를 직접 읽으므로 engine 전용 `V86ClockPort`가 RTC timer를 명시적
   wall clock으로 치환한다. CPU periodic/update/alarm interrupt 상태와 100ms scheduling 반환 계약은 유지한다.
5. probe가 만든 최소 i686 ELF 두 개가 Linux root 안에서 실제 `RDRAND EAX`를 실행하고, `ioperm` 뒤 CMOS
   0x70/0x71 port의 second/minute/hour/day/month/year/century/status B를 직접 읽는다.

실패에서 고친 계약:

- 첫 공개 옵션 실측은 RED 2/3이었다. monotonic tick 11,106회와 Linux RDRAND 56회는 `wasm_fn`으로
  들어갔지만 CMOS RTC는 browser 현재시각을 읽었다. tick과 RTC를 같은 것으로 가장하지 않고 RTC bridge를
  별도 engine 경계로 만들었다.
- 첫 wall target 2040은 Linux i686의 32-bit `time_t`를 넘겨 `date +%s`가 `-2085881048`로 overflow했다.
  host clock 결함과 guest ABI 한계를 분리하고 2030 boot, 2035 cold reattach로 검증했다.
- cold restore 뒤 Buildroot에는 `/dev/rtc`가 없어 `hwclock`으로 system time을 갱신할 수 없었다. adapter가
  guest 명령을 몰래 실행하지 않고, ioperm 기반 CMOS port reader로 새 hardware 값을 직접 검증했다. guest
  system clock은 snapshot 정책대로 유지된다.

실측:

- `clockEntropyProbe` 수정본 3회 연속 GREEN 19/19.
- Linux initial boot 3844/3913/3872ms, 최초 guest clock/RDRAND read 356/307/391ms, generation commit
  337/301/491ms였다.
- 기존 Edge process tree 종료 뒤 cold restore 308/335/342ms, 새 clock/entropy의 guest read
  477/526/471ms였다.
- 최초 Linux system clock과 CMOS는 2030-01-02 03:04:05 기준 10초 안에 일치했다. 새 process의 paused
  restore 뒤 CMOS raw bytes `56 34 12 01 06 35 20 02`는 정확히 2035-06-01 12:34:56을 나타냈다.
- cold restore 직후 entropy read는 0이었다. resume 뒤 Linux RDRAND 한 번이 새 CSPRNG의 4 bytes를 매회
  byte-for-byte 소비했고 port/device read·byte 계수도 일치했다.
- 새 host history에는 boot event가 0이고 generation의 device payload도 0이었다. clock과 entropy handle은
  snapshot이 아니라 새 WASM import와 RTC bridge로 다시 붙었다.

판정:

1. browser clock을 읽어 guest 명령 인자로 넘긴 것이 아니라 x86 CPU tick, CMOS port, RDRAND instruction의
   hardware 경계까지 연결했다.
2. wall clock, monotonic tick, entropy bytes의 서로 다른 의미를 한 random/time callback으로 합치지 않았다.
   공통 browser device와 v86 변환부는 guest 이름 없이 유지된다.
3. restore가 guest system clock을 몰래 수정하지 않는다. 새 RTC hardware 값의 OS 재적용은 guest driver와
   resume policy 책임이며, 현재 Buildroot image의 `/dev/rtc` 부재를 capability 한계로 남긴다.
4. Phase 3 최소 공통 장치인 block, console, display, input, packet network, clock, entropy는 실제 guest
   끝단을 모두 통과했다. 범용 Web Machine 전체는 이동 가능한 envelope와 배포 게이트 전까지 완료가 아니다.

NEXT:

1. `.webmachine` envelope schema, adapter identity/version, capability requirements와 전체 integrity를 실제
   export/import byte format으로 고정한다.
2. 다른 browser profile에서 pyproc과 Linux envelope를 import하고 adapter missing, version mismatch,
   permission denied, corruption, untrusted signature를 선실행 거부한다.
3. v86, BIOS, Buildroot, KolibriOS 구성물의 정확한 license와 SBOM 배포 게이트를 닫는다.

## 2026-07-15 - signed `.webmachine`과 새 browser profile import

구현:

1. core image 경계에 schema version 1의 `machineManifest`를 추가했다. machine별 adapter identity/version,
   portable snapshot scope, required capabilities, permissions, 실행 manifest와 payload reference를 고정한다.
2. browser image 경계를 `webMachineFile`, `webMachineTrust`, `machineEnvelopeCoordinator` 세 책임으로 나눴다.
   파일 형식, 외부 trusted key, host/device 조정을 한 파일이나 guest adapter에 섞지 않는다.
3. 파일은 `WEBMACHINE1` magic, 4-byte manifest 길이, canonical JSON manifest, blob 연속 영역으로 구성한다.
   snapshot과 block을 JSON이나 archive dependency로 재인코딩하지 않으며 blob 단위로 읽고 검증한다.
4. manifest digest가 adapter, capability, permissions, 실행 manifest, 모든 blob digest를 덮고 ECDSA P-256
   signature가 그 digest를 서명한다. embedded key의 서명 유효성과 외부 trusted key 승인을 별도로 확인한다.
5. host에 `preflightMachine`을 추가했다. import coordinator는 모든 target block, 사용자 승인, 환경 capability,
   adapter 설치/version/scope/device permission을 먼저 확인하고 성공 뒤에만 device restore와 machine restore를 연다.
6. browser runner가 probe artifact를 profile 밖 임시 파일로 streaming하고 `freshProfile: true` 요청 시 별도
   user-data-dir을 만든다. 같은 origin이어도 원본 localStorage와 IndexedDB가 없는 실제 새 profile이다.

실패에서 고친 계약:

- 첫 import는 RED 3/6이었다. 전체 manifest를 content 전용 validator에 그대로 넘겨 `integrity`와 `signature`를
  예상 밖 key로 거부했다. 서명 대상 content를 명시적 필드로 잘라 검증하도록 고쳤다.
- 두 번째 import는 v86 options의 `bzimage.async` 수정에서 실패했다. 검증 archive의 manifest는 끝까지 deep
  freeze하고 adapter에 넘기는 JSON manifest만 복제해 신뢰 원본과 실행용 설정을 분리했다.
- 공개 class 모양을 복제해 검증 archive를 가장하지 못하도록 module-private `WeakSet` brand를 추가했다.
  canonical record 정렬도 locale 규칙이 아니라 code-unit 비교로 고정했다.

실측:

- `machineEnvelopeProbe` 최종 수정본 3회 연속 GREEN 19/19.
- image는 64,600,085-64,628,757 bytes, export는 207/227/256ms, signature와 4개 blob verify는
  152/162/188ms, 새 profile의 두 OS cold import는 2402/2477/2490ms였다.
- source profile에 만든 localStorage marker와 IndexedDB database는 target profile에 없었다. runner가 옮긴
  `.webmachine` bytes만 같았고 pyproc memory/home과 Linux memory/9P file 값 73이 boot 없이 다시 실행됐다.
- untrusted signer는 파일 slice 두 번으로 manifest까지만 읽고 payload 전에 거부됐다. blob 마지막 한 byte
  손상, adapter 미설치, version 불일치, permission 부족, capability 부족은 서로 다른 code로 끝났다.
- 검증 archive 위조와 모든 fault preflight에서 v86 engine constructor는 0회였다. 정상 import 뒤에만 1회였다.

판정:

1. `.webmachine`은 같은 profile의 IndexedDB generation을 다른 이름으로 읽는 기능이 아니다. 실제 file bytes가
   storage identity와 분리돼 새 profile로 이동했다.
2. 파일 신뢰와 device 권한을 합치지 않았다. signer가 trusted여도 사용자가 승인하지 않은 device는 열리지 않는다.
3. core는 두 payload를 해석하지 않고 adapter identity로만 route했다. 두 OS를 담기 위해 guest 분기를 추가하지 않았다.
4. Phase 5 기술 게이트와 이니셔티브의 기능 완료 조건은 통과했다. 공개 package 승격은 engine/image license와
   SBOM 배포 검토가 끝난 뒤에만 진행한다.

NEXT:

1. v86, BIOS, Buildroot, KolibriOS 구성물의 license provenance와 재배포 조건을 파일 단위로 확정한다.
2. Web Machine package가 배포할 engine/image SBOM과 외부 asset pin 계약을 만든다.
3. 배포 게이트 통과 뒤 독립 `core`, `browser`, `guest-pyproc`, `guest-v86` package로 attempts를 승격한다.

## 2026-07-15 - third-party binary 0개와 fixture SPDX SBOM

감사:

1. npm `v86@0.5.424`는 BSD-2-Clause를 선언하고 registry SHA-512 integrity를 제공하지만 package metadata에
   source `gitHead`가 없다. JS module은 declared license를 기록하고 composite WASM file은 최종 license
   inventory를 `NOASSERTION`으로 유지했다.
2. v86 revision `2f1346b`의 BIOS script는 SeaBIOS `rel-1.16.2`를 checkout하고 고정 config로 `bios.bin`과
   `vgabios.bin`을 만든다. 같은 directory의 `COPYING.LESSER`와 SeaBIOS 공식 문서가 LGPL-3.0을 확인한다.
3. `buildroot-bzimage68.bin`은 v86 test URL과 hash만 있고 exact Buildroot revision, `.config`, package manifest,
   `legal-info`가 없다. Linux kernel이라는 이름만으로 root filesystem 전체 license를 확정하지 않았다.
4. `kolibri.img`도 v86 test URL과 hash만 있다. KolibriOS project의 GPLv2 선언은 확인했지만 exact image revision과
   포함 application inventory가 없어 binary 결론은 `NOASSERTION`으로 유지했다.

구현:

1. `assetCatalog.json`을 fixture URL/hash/size, component provenance, license 결론, bundle blocker의 SSOT로 만들었다.
2. `assetProvenance.mjs`가 catalog를 strict validation하고 SPDX 2.3 `fixtureSbom.json`을 결정적으로 생성·검증한다.
3. `prepareAssets.mjs`의 URL/hash 중복을 제거했다. catalog와 SBOM이 다르면 download 전에 실패하고, cache와
   download 모두 SHA-256뿐 아니라 byte length도 검증한다.
4. Node 구조 게이트가 SBOM 동기화, 모든 fixture의 `local-test-only`, opaque guest image의 `NOASSERTION`,
   bundle blocker 존재, git에 third-party fixture binary 0개를 강제한다.
5. 자산 배포 정책을 별도 정본으로 만들었다. code package와 공식 machine image의 배포 조건을 분리했다.

판정:

1. code package는 engine constructor와 manifest만 외부 주입받고 third-party binary를 싣지 않으므로 승격 가능하다.
2. test fixture hash 검증을 재배포 승인으로 오해하지 않는다. 기존 두 guest image는 local probe 외 사용을 차단한다.
3. `.webmachine` signature는 publisher identity이지 license 증명이 아니다. 공식 image catalog는 SBOM digest를
   signed manifest에 포함하는 다음 schema와 compliance material 전까지 만들지 않는다.
4. Web Machine attempts의 기술·아키텍처·code package 배포 졸업 조건은 모두 통과했다.

NEXT:

1. attempts 모듈을 독립 `core`, `browser`, `guest-pyproc`, `guest-v86` package 경계로 승격한다.
2. package public index와 type contract를 만들고 deep import·third-party binary 0개를 release gate로 고정한다.
3. 별도 product-image 트랙에서 재현 가능한 Buildroot recipe와 signed SBOM attachment schema를 연구한다.

## 2026-07-16 - 독립 package 승격과 이니셔티브 완료

구현:

1. engine·browser 중립 상태 머신을 `@web-machine/core`로 승격하고 `WebMachineHost`, `MachineHandle`, `CommandQueue`, adapter·snapshot·manifest 계약을 분리했다.
2. browser device, IndexedDB generation, Web Lock owner, trust, `.webmachine` 조정을 `@web-machine/browser`로 승격했다.
3. pyproc과 v86 변환부를 각각 `@web-machine/guest-pyproc`, `@web-machine/guest-v86`로 승격했다. engine constructor와 실행 자산은 계속 composition root에서 외부 주입한다.
4. 네 package에 root `index.js`, `index.d.ts`, private `0.0.0` manifest를 두고 root workspace를 연결했다. 릴리즈 지시가 없으므로 공개 버전과 태그는 바꾸지 않았다.
5. attempts 캠페인을 제거하고 공통 contract, fixture provenance, browser probe를 `tests/webMachine/` 정식 검증 트리로 옮겼다.
6. 구조 게이트를 `browser -> core`, `guest-* -> core`, guest 간 import 0, package deep import 0, composition root 단일성, third-party binary 0개 기준으로 갱신했다.

검증:

- `npm test` PASS, 834 passed, 0 failed.
- `hostContractProbe` GREEN 27/27.
- `generationContractProbe` GREEN 16/16.
- `dualEngineProbe` GREEN 13/13.
- `machineEnvelopeProbe` GREEN 19/19. 64,608,289-byte signed image가 원본 storage가 없는 새 browser profile에서 두 OS를 복원했다.
- package import smoke PASS: core 13 exports, browser 23 exports, guest package 각 1 export.
- package dry-run PASS: core 10, browser 22, guest-pyproc 5, guest-v86 14 files. fixture, wasm, image, firmware 포함 0개.

판정:

1. README 완료 조건 5개와 본진 승격 조건 6개를 모두 충족했다.
2. pyproc `src/`는 Python guest OS 경계로 유지되고 범용 host는 독립 package에 머문다.
3. provenance가 불완전한 guest image는 계속 `local-test-only`이며, 공식 product image는 별도 이니셔티브와 compliance gate 없이는 배포하지 않는다.
4. Web Machine Platform 이니셔티브를 완료하고 `_done`으로 이관한다.
