# 02. 페이징과 배선

## Phase 0 - North Star 정렬

상태: 완료.

목표:

- 상위 North Star를 "브라우저에 Python OS를 만든다"에서 "브라우저를 여러 OS가 올라가는 컴퓨터로 만든다"로 확장한다.
- pyproc의 현재 제품 범위와 미래 Web Machine Host 주장을 분리한다.
- 기존 `browser-os-north-star`를 첫 Python guest OS 트랙으로 재배치한다.

게이트:

- `CLAUDE.md`, `docs/product/vision.md`, README 2종, `mainPlan/README.md`가 같은 계층을 말한다.
- 현재형 공개 기능과 미래 목표가 섞이지 않는다.
- `npm test` green.

## Phase 1 - host contract 실험

상태: 완료. [hostContractProbe](../../tests/attempts/webMachine/probes/hostContractProbe.html) 3회 연속 GREEN 27/27.

위치: `tests/attempts/webMachine/`.

작업:

1. `GuestAdapter` lifecycle state machine을 명문화한다.
2. fake guest 두 개로 boot/pause/resume/snapshot/restore/shutdown 전이를 검증한다.
3. block, console, clock, entropy 최소 장치 계약을 검증한다.
4. adapter 오류와 host 오류의 경계를 정한다.

게이트:

- host core에 guest 이름 분기가 없다.
- 같은 contract test suite를 두 adapter가 그대로 통과한다.
- snapshot payload는 opaque byte sequence로만 취급된다.

## Phase 2 - pyproc + WASI 이중 엔진

상태: 완료. [dualEngineProbe](../../tests/attempts/webMachine/probes/dualEngineProbe.html) 3회 연속 GREEN 13/13.

작업:

1. pyproc adapter는 공개 `openPersistentMachine`/Session 계열만 소비한다.
2. WASI adapter는 공개 `bootWasi`/`WasiSession`만 소비한다.
3. 두 엔진이 같은 lifecycle report와 image envelope를 낸다.
4. 공통 console과 disk view를 제품 UI 없이 probe에서 검증한다.

게이트:

- 두 엔진 boot, snapshot, restore, shutdown GREEN.
- deep import 0.
- host가 Python heap 또는 WASI memory 형식을 해석하지 않는다.

## Phase 3 - Dual-Boot Linux

상태: 핵심 Dual-Boot 완료, 공통 장치 배선 진행 중. [linuxGuestProbe](../../tests/attempts/webMachine/probes/linuxGuestProbe.html)와 [dualBootProbe](../../tests/attempts/webMachine/probes/dualBootProbe.html) 각각 3회 연속 GREEN 8/8.

작업:

1. [완료] x86 engine을 외부 주입하는 adapter를 만든다.
2. [완료] Buildroot Linux 6.8.12 i686 image를 부팅한다.
3. [완료] pyproc Python OS와 Linux guest를 같은 machine registry에서 동시에 열고 두 memory/file state를 함께 cold restore한다.
4. [진행] console 다음으로 block, clock, entropy, packet network, display, input을 공통 장치 계약으로 연결한다. block-backed guest file, packet network, VGA text/PS2 keyboard, RGBA framebuffer/relative pointer는 완료했다.

게이트:

- [통과] Python OS와 Linux가 같은 host API의 `boot/pause/snapshot/restore/resume/shutdown`을 사용한다.
- [통과] 두 guest가 파일 쓰기와 console round trip을 완료하고 destroy 뒤 같은 값으로 복원된다.
- [통과] x86 engine은 외부 주입되며 pyproc 기본 dependency는 0이다.
- [부분] engine과 image 출처, version, SHA-256, 미번들 정책을 기록했다. 제품 배포 전 BIOS/image license와 SBOM 검토가 남았다.
- [통과] pyproc `/home/web`과 Linux가 mount한 v86 9P file을 별도 block volume으로 연결하고 guest snapshot에서 file payload를 제거했다.
- [통과] request/packet mode와 permission을 engine boot 전에 구분하고 Linux eth0의 ARP/ICMP frame을 bounded packet switch에 연결했다.
- [통과] browser process cold restore 뒤 snapshot MAC을 보존하고 새 packet port로 ping을 다시 왕복했다.
- [통과] console과 분리한 80x25 VGA cell frame과 PS/2 scan code로 Linux command를 실행하고 process cold reattach했다.
- [통과] 1024x768x32bpp VGA dirty region과 PS/2 pointer를 graphical x86 guest에 연결하고 process cold reattach했다.
- [대기] clock/entropy를 ambient browser 접근이 아닌 명시적 device port로 실제 guest에 연결한다.

## Phase 4 - 영속 머신과 탭 장애복구

상태: durable generation, 브라우저 프로세스 cold reopen, 실제 guest block 배선, 정확히 한 owner successor 완료.

작업:

1. [완료] 공통 HEAD/PREV + CAS generation을 만든다.
2. [완료] adapter snapshot과 flushed virtual block을 같은 content-addressed generation에 commit한다.
3. [완료] Web Lock 단일 owner, IndexedDB 단조 epoch, 이전 owner 결과 거부와 정확히 한 successor를 적용했다.
4. [완료] pyproc과 Linux를 IndexedDB에 commit하고 Edge process tree 종료 뒤 새 process에서 cold reopen한다.
5. [완료] 공통 block port를 pyproc home과 v86 9P guest file의 완료 generation backing volume으로 연결한다.

게이트:

- [통과] 독립 browsing context 네 개의 leader 경쟁과 강제 제거 뒤 정확히 한 successor.
- [통과] 완료 commit 경계의 두 guest opaque snapshot과 block image 복구.
- [통과] 전송 뒤 끊긴 명령 자동 replay 0.
- [통과] process recovery 2.5-3.0초와 owner failover 21-23ms를 공개했다.
- [통과] 복구한 공통 block이 pyproc home과 Linux 9P mount의 실제 file state를 제공한다.

## Phase 5 - 이동 가능한 `.webmachine`

상태: 대기.

작업:

1. schema version, adapter identity, capability requirements를 봉투에 고정한다.
2. snapshot, disk, permissions 전체를 integrity hash로 덮는다.
3. signature와 trusted key 경계를 재사용한다.
4. 다른 origin 또는 새 browser profile에서 import gate를 실행한다.

게이트:

- 같은 image envelope가 pyproc과 Linux guest를 구분해 올바른 adapter로 연다.
- adapter 미설치, version 불일치, 권한 부족, blob 손상이 구분된 오류를 낸다.
- 신뢰되지 않은 image는 실행 전에 거부된다.

## 중단 또는 축소 조건

다음 중 하나면 범용 host 주장을 축소한다.

1. 두 번째 엔진을 받기 위해 host가 guest memory layout을 알아야 한다.
2. 새 OS마다 core device contract가 깨진다.
3. adapter보다 host의 OS별 분기가 더 커진다.
4. 영속 snapshot 비용이 제품 사용 범위를 벗어나며 증분 전략도 성립하지 않는다.
5. 기존 pyproc 안정성을 깨야만 플랫폼을 만들 수 있다.

축소 시에도 pyproc Python OS는 독립 제품으로 유지된다.
