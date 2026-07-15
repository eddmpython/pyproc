# webMachine - 서로 다른 엔진을 같은 브라우저 컴퓨터 계약으로 다룰 수 있는가

정본: [web-machine-platform](../../../mainPlan/web-machine-platform/README.md).

## 가설

guest 내부 syscall이나 memory layout을 공통화하지 않아도 boot, pause, resume, snapshot, restore,
shutdown, device permission, ownership fencing만으로 얇은 Web Machine Host를 만들 수 있다. 같은
contract suite가 fake guest 두 개, pyproc `Session`, non-Pyodide `WasiSession`, x86 Linux에서도
통과해야 엔진과 운영체제 독립성의 첫 증거가 된다.

snapshot 보장은 숨기지 않는다.

- pyproc: `.pymachine` 바이트로 새 adapter에서도 여는 `portable` scope.
- WASI: live `WasiSession.checkpoint/timeTravel`을 쓰는 `session` scope.
- x86 Linux: 같은 v86 version과 engine manifest에서 새 adapter가 여는 `portable` state.
- 공통 host: scope가 다른 snapshot의 cold restore를 부팅 전에 거부한다.

## 졸업 게이트

1. fake guest 두 개가 같은 lifecycle suite를 100% 통과한다.
2. snapshot은 `paused` 상태에서만 허용되고 running request는 명시적 오류가 난다.
3. device permission, missing device, request/packet mode mismatch가 adapter boot 전에 거부된다.
4. ownership 상실 뒤 늦은 응답은 `WEB_MACHINE_OUTCOME_UNKNOWN`으로 끝나고 자동 replay 0회다.
5. pyproc과 WASI가 같은 host API로 boot, request, pause, snapshot, mutate, restore, resume, shutdown을 통과한다.
6. pyproc portable snapshot은 adapter shutdown 뒤 cold restore되고, WASI session snapshot은 같은 세션 안에서만 복원된다.
7. host core는 Python heap, WASI memory, `.pymachine` 내부 형식을 해석하지 않는다.
8. 브라우저 probe를 최소 3회 반복해 모두 GREEN이고 결과와 시간을 기록한다.
9. 실제 Linux가 같은 host API로 boot, console round trip, snapshot, live/cold restore를 통과한다.
10. pyproc Python OS와 Linux를 한 registry에서 동시 boot하고, 두 adapter를 destroy한 뒤 memory와 file state를 함께 복원한다.
11. guest snapshot과 flushed block image를 한 content-addressed generation으로 CAS commit하고 torn commit, 동시 CAS race, 손상 HEAD의 PREV 복구를 통과한다.
12. pyproc, Linux, block generation을 IndexedDB에 저장한 뒤 브라우저 프로세스를 완전히 종료하고 새 프로세스에서 boot 없이 함께 복원한다.
13. pyproc snapshot에서 `/home/web`을, v86 state에서 9P file tree를 제거하고 두 guest가 실제로 소비한 별도 block volume에서만 process cold restore한다.
14. request와 packet network mode를 부팅 전에 구분하고, Linux NIC의 실제 ARP/ICMP frame을 새 browser process의 새 packet port에서도 왕복한다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-15 | hostContractProbe | Edge headless, COOP+COEP, 3회 | **3회 연속 GREEN 27/27**, 공통 lifecycle 4/5/4ms | 두 fake adapter가 같은 13-event lifecycle을 통과. running snapshot과 paused request 거부, device mode/permission은 boot 0회에서 차단, ownership 상실 명령 실행 1회·자동 replay 0회·late response 오염 0 | 실제 두 엔진에 같은 suite 적용 |
| 2026-07-15 | dualEngineProbe | Edge headless, COOP+COEP, pyproc v314.0.2 + CPython WASI 3.14.6, full home image, 3회 | **3회 연속 GREEN 13/13**. pyproc boot 2647/2763/2936ms, portable snapshot 54-60ms·8,192,958 bytes, cold restore 1721-1837ms. WASI boot 458/488/466ms, session snapshot 14-21ms, restore 2-3ms | 같은 host API가 Pyodide와 non-Pyodide 두 실제 엔진에서 성립. pyproc은 빈 machine도 `/home/web`을 만든 뒤 전체 home을 image에 포함 | Phase 3 x86/Linux adapter |
| 2026-07-15 | linuxGuestProbe 원격 image | Edge headless, COOP+COEP | **RED 0/1**. 원격 Buildroot image download-error | 격리 브라우저에서 외부 image 전달이 불안정했다. SHA-256 검증 로컬 실험 캐시로 변경 | `fixtures/v86/prepareAssets.mjs` |
| 2026-07-15 | linuxGuestProbe | Edge headless, COOP+COEP, v86 0.5.424 + Buildroot Linux 6.8.12 i686, 3회 | **3회 연속 GREEN 8/8**. boot 3661/3662/3657ms, state 51,890,928-51,944,164 bytes, snapshot 57-71ms, live restore 54-83ms, destroy 뒤 cold restore 163-175ms | 외부 주입형 x86 adapter가 실제 Linux에서 공통 lifecycle, console, portable RAM state를 통과 | pyproc + Linux Dual-Boot |
| 2026-07-15 | dualBootProbe file state 첫 시도 | Edge headless, COOP+COEP | **RED 4/5**. pyproc `/tmp` file은 `includeHome: false` image에서 제외 | machine image가 사용자 파일을 빼면 안 된다는 계약 결함을 발견. full home image로 변경 | 빈 home 경계 재검증 |
| 2026-07-15 | dualEngineProbe full home 첫 시도 | Edge headless, COOP+COEP, 3회 | **3회 RED 2/3**. 빈 session에 `/home/web`이 없어 export 거부 | pyproc guest boot 계약이 `/home/web`을 항상 생성하도록 수정 | full home gate 재실행 |
| 2026-07-15 | dualBootProbe | Edge headless, COOP+COEP, pyproc + v86 Linux, full file state, 3회 | **3회 연속 GREEN 8/8**. 동시 boot 5404/5422/5513ms, dual snapshot 141-190ms, Python image 8,782,882 bytes, Linux image 51,903,216-51,919,600 bytes, 두 adapter destroy 뒤 cold restore 1862-1928ms | 한 host registry가 Python OS와 Linux를 실제 이중 부팅. 두 OS의 memory 값과 file 값 42가 함께 생존 | 공통 block/network/display 장치 배선 |
| 2026-07-15 | generationContractProbe | Edge headless, COOP+COEP, memory + IndexedDB, 3회 | **3회 연속 GREEN 16/16**. first commit 1-2ms, second commit 0ms, PREV recovery 1ms. torn publish 뒤 HEAD 불변, CAS race 승자 1, 기존 generation 덮어쓰기 거부, 손상 HEAD에서 PREV 복구 | guest snapshot과 flushed block을 한 content-addressed generation으로 publish하는 원자성 계약 성립. 실제 IndexedDB transaction도 동시 commit 하나만 허용 | 실제 두 guest를 포함한 프로세스 재시작 |
| 2026-07-15 | persistentDualBootProbe | Edge headless, COOP+COEP, pyproc + v86 Linux + IndexedDB, 새 Edge process, 3회 | **3회 연속 GREEN 9/9**. boot 5986/6299/6214ms, commit 599/467/469ms, process cold restore 2601/2376/2783ms | Python OS, Linux, block을 같은 generation에 commit하고 Edge process tree 종료 뒤 새 process에서 boot 없이 복원 | 공통 block을 두 guest의 실제 backing device로 연결 |
| 2026-07-15 | deviceBackedDualBootProbe ATA 첫 시도 | Edge headless, COOP+COEP, v86 injected ATA buffer | **RED 0/1**. `/proc/partitions` 비어 있음, `/dev/sda`와 `/dev/hda` 없음, injected block write 0회 | v86 PCI IDE는 보였지만 고정 Buildroot 커널에 ATA block driver가 없었다. `/dev/sda` 대상 `dd`는 일반 파일을 만든 거짓 양성이었다 | 커널에 포함된 virtio 9P 경로 사용 |
| 2026-07-15 | deviceBackedDualBootProbe 9P 첫 시도 | Edge headless, COOP+COEP, v86 host9p | **RED 8/11**. block generation과 Python은 통과, Linux file을 directory로 오분류 | v86 inode는 file도 빈 `direntries`를 가지며 Buildroot가 host9p를 `/mnt`에 이미 mount한다. inode `IsDirectory`와 기존 mount로 수정 | process cold reopen 반복 |
| 2026-07-15 | deviceBackedDualBootProbe | Edge headless, COOP+COEP, pyproc home block + v86 9P block + IndexedDB, 새 Edge process, 3회 | **3회 연속 GREEN 12/12**. boot 5681/6091/6210ms, commit 525/544/660ms, process cold restore 2541/2316/2145ms. 삭제 file tail 잔존 0 | pyproc heap snapshot에서 home을, v86 RAM state에서 9P file을 제거했다. 두 OS가 실제 사용한 file state를 별도 block volume에서만 복원 | packet network, display/input, owner successor |
| 2026-07-15 | packetNetworkProbe 첫 cold restore | Edge headless, COOP+COEP, v86 NE2K + 새 packet switch | **RED 13/14**. reply frame은 NIC에 도달했지만 ping 수신 0 | 새 process의 임의 NIC MAC과 snapshot 속 Linux MAC이 달라 NIC filter가 reply를 폐기했다 | portable packet restore가 snapshot MAC 보존 |
| 2026-07-15 | packetNetworkProbe | Edge headless, COOP+COEP, v86 NE2K + bounded packet switch + 새 Edge process, 3회 | **3회 연속 GREEN 14/14**. 최초 ARP/ICMP 160/185/167ms, commit 412/329/332ms, process cold restore 452/380/357ms, 재연결 ping 137/117/129ms | request/packet mode와 permission을 engine boot 0회에서 선거부했다. Linux eth0가 실제 Ethernet frame을 보내고 새 process의 새 port에서도 왕복했으며 drop/error 0 | display/input, owner successor |

## 모듈화 설계

- `host/`: engine과 browser 구현을 모르는 state machine, adapter contract, snapshot envelope, 구조화 오류.
- `browser/`: block device, content-addressed blob, CAS generation, IndexedDB persistence 구현.
- `adapters/`: 파일 하나당 guest adapter 하나. 같은 guest의 wire format/engine bridge만 이름 있는 하위 폴더에 두며 guest끼리는 import하지 않는다.
- `fixtures/v86/`: hash 고정 자산 recipe와 manifest. binary는 미추적이다.
- `probes/`: adapter와 device를 조립할 수 있는 유일한 composition root다.

상세 package 경계와 강행 규칙은 [클린 아키텍처 정본](../../../mainPlan/web-machine-platform/04-clean-architecture-and-code-rules.md)을 따른다.

Linux probe 자산은 레포에 넣지 않는다. 아래 명령이 [v86 0.5.424](https://www.npmjs.com/package/v86)의
module/wasm, v86 revision `2f1346b`의 BIOS, [공식 예제](https://github.com/copy/v86/blob/2f1346b/examples/serial.html)의
Buildroot bzImage를 내려받고 SHA-256을 검증해 ignored `assets/`에 둔다. v86 package는 BSD-2-Clause지만
BIOS와 guest image는 별도 구성물이므로 제품 번들 전 license/SBOM 검토를 다시 통과해야 한다.

```bash
node tests/attempts/webMachine/fixtures/v86/prepareAssets.mjs
node tests/browser/run.mjs tests/attempts/webMachine/probes/linuxGuestProbe.html
```

두 실제 엔진, Linux guest, 원자 generation, 브라우저 프로세스 cold reopen, 실제 guest file의 block
분리와 Linux NIC packet network 조건은 충족했다. pyproc home과 v86 9P file은 guest snapshot에 중복되지 않고
별도 block volume이 완료 generation의 원본이다. display/input, owner successor가 남았으므로 이번 변경에서는
`src/` 또는 `index.js`로 승격하지 않는다. 승격 위치는 독립 `core`, `browser`, `guest-pyproc`,
`guest-v86` package로 확정했다.

## 덕지덕지 제거 기준

- host core에 `pyproc`, `wasi`, `linux`, `x86` 이름 분기 0.
- host core에 browser 전역, storage, network, random 직접 접근 0.
- adapter factory 등록 외 engine 선택 플래그 0.
- adapter 사이 import 0, adapter 등록은 `probes/`에만 존재.
- snapshot payload 해석 0.
- network request mode와 packet mode를 하나로 가장하지 않는다.
- 제품 UI와 desktop 정책 0.

## 판정

**Phase 1/2 졸업, Phase 3 Dual-Boot·실제 block-backed file·packet network 핵심 GREEN, Phase 4 durable
generation과 프로세스 cold reopen 핵심 GREEN, 캠페인 진행 중.** pyproc home과 Linux 9P file을 각 guest
snapshot에서 제거하고 별도 block volume으로 복원했다. Linux NIC는 bounded packet switch에서 실제 ARP와
ICMP를 왕복하고 새 process에서 port를 다시 연결한다. display/input, owner successor, 배포 license
게이트가 남았으므로 완성된 브라우저 컴퓨터 또는 공개 API라고 부르지 않는다.
