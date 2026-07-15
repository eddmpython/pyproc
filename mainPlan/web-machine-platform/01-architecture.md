# 01. 아키텍처 - 얇은 Web Machine 계약

## 설계 원칙

Web Machine의 핵심은 모든 guest를 같은 OS로 만드는 것이 아니라, 서로 다른 guest의 **생명주기와 장치 연결을 같은 host 계약으로 다루는 것**이다. 인터넷의 IP나 컨테이너 이미지 봉투처럼 가운데 계약은 작게 유지한다.

## 레이어

```text
제품 표면
  desktop / IDE / notebook / automation
                    |
Web Machine Host
  registry / scheduler / permissions / persistence / image envelope
                    |
GuestAdapter                  VirtualDevice
  pyproc / WASI / x86         disk / console / display / net / input
                    |
Guest engines
                    |
Chromium sandbox and browser capabilities
```

## 개념 계약

아래 이름은 설계 계약이며 아직 공개 API가 아니다.

```js
class GuestAdapter {
  async boot(context) {}
  async pause() {}
  async resume() {}
  async snapshot() {}
  async restore(snapshot) {}
  async shutdown() {}
  async inspect() {}
}
```

## lifecycle state machine v0

공통 의미론을 넓게 잡지 않는다.

```text
created --boot--> running --pause--> paused --resume--> running
   |                 |                 |
   |                 +----shutdown-----+
   |                                   |
   +------------restore------------> paused
                                       |
                                    shutdown
                                       |
                                    stopped

transition failure -----------------> failed
```

계약:

1. `snapshot()`은 `paused`에서만 허용한다.
2. `pause()` 완료는 guest instruction과 host command가 더 진행되지 않는 경계다.
3. snapshot은 guest memory와 virtual disk의 완료 generation을 가리킨다.
4. in-flight request, socket, timer, browser handle은 snapshot 대상이 아니다.
5. 외부 자원은 `resume()` 전 device reattach hook으로 다시 연결한다.
6. host command 전송 뒤 adapter 소유권이 사라지면 자동 replay하지 않고 outcome unknown으로 끝낸다.

adapter가 강한 pause를 제공하지 못하면 `cooperative-pause` capability를 명시하고 제품이 그 제한을 볼 수 있게 한다. 이름만 같은 snapshot으로 보장 차이를 숨기지 않는다.

`context`는 raw browser 전역이 아니라 host가 허용한 장치와 자원만 담는다.

```js
{
  machineId,
  memoryLimit,
  cpuLimit,
  disks,
  console,
  display,
  network,
  devices,
  permissions
}
```

## 책임 경계

### Web Machine Host가 소유한다

- machine ID, guest registry, lifecycle 상태 전이
- resource budget과 capability permission
- 가상 장치 연결과 해제
- snapshot 세대, HEAD/PREV, CAS, integrity
- leader election, fencing, cold reopen
- 공통 이미지 import/export

### GuestAdapter가 소유한다

- 특정 엔진의 boot 방식
- 엔진별 pause/resume 의미론
- opaque snapshot 생성과 적용
- guest console, framebuffer, disk, network를 공통 장치에 연결하는 변환
- 엔진 고유 오류를 공통 lifecycle 오류로 좁히는 일

### Guest가 소유한다

- syscall, process model, filesystem semantics
- package manager와 executable format
- 사용자·서비스·desktop 정책
- guest 내부 보안과 애플리케이션 수명주기

## 이미지 봉투

`.webmachine`은 모든 엔진의 메모리를 같은 형식으로 바꾸지 않는다. 공통 manifest와 엔진별 opaque payload를 한 봉투에 넣는다.

```text
machine.webmachine
├─ manifest.json
├─ guest/
│  ├─ adapter ID and version
│  └─ opaque snapshot blobs
├─ disks/
│  └─ content-addressed blocks
├─ devices.json
├─ permissions.json
└─ integrity.json
```

최소 manifest 좌표:

```json
{
  "schemaVersion": 1,
  "machineId": "example",
  "adapter": "pyproc",
  "adapterVersion": "0.0.1",
  "requiredCapabilities": ["opfs", "workers"],
  "entrySnapshot": "sha256:..."
}
```

snapshot 호환성은 `adapter + adapterVersion + engine manifest`가 판정한다. host는 모르는 payload를 해석하지 않고 해시·저장·전달한다.

## 장치 계약

첫 버전은 장치를 여섯 종류로 제한한다.

1. `blockDevice`: byte range read/write/flush.
2. `consoleDevice`: stdin/stdout/stderr stream.
3. `displayDevice`: framebuffer 또는 frame presentation.
4. `networkDevice`: guest adapter가 소비하는 request/packet bridge.
5. `clockDevice`: 주입된 wall time, 역행하지 않는 monotonic time, bounded timer.
6. `entropyDevice`: 주입된 browser CSPRNG 기반 bounded random bytes.

카메라, 마이크, clipboard, GPU는 v1 core가 아니라 선택 capability다.

`networkDevice`는 하나의 거짓 추상화로 합치지 않는다. adapter는 `request` 또는 `packet` mode를 capability로 선언한다. ASGI/Service Worker는 request mode, x86 NIC emulation은 packet mode를 소비하며, host는 지원하지 않는 mode를 부팅 전에 거부한다.

## adapter 전략

| adapter | 첫 근거 | 역할 |
|---|---|---|
| pyproc | `openPersistentMachine`, `Session`, `MachineJournal`, [dualEngineProbe](../../tests/attempts/webMachine/probes/dualEngineProbe.html) GREEN 13/13 x3 | 첫 guest OS, `portable` snapshot, heap + `/home/web` + failover |
| WASI | `bootWasi`, `WasiSession`, [dualEngineProbe](../../tests/attempts/webMachine/probes/dualEngineProbe.html) GREEN 13/13 x3 | 두 번째 엔진, `session` snapshot, lifecycle contract의 엔진 독립성 증명 |
| x86 | 외부 주입형 v86 0.5.424, [linuxGuestProbe](../../tests/attempts/webMachine/probes/linuxGuestProbe.html) GREEN 8/8 x3, [dualBootProbe](../../tests/attempts/webMachine/probes/dualBootProbe.html) GREEN 8/8 x3, [framebufferPointerProbe](../../tests/attempts/webMachine/probes/framebufferPointerProbe.html) GREEN 18/18 x3, [clockEntropyProbe](../../tests/attempts/webMachine/probes/clockEntropyProbe.html) GREEN 19/19 x3 | Buildroot Linux 6.8.12 i686와 graphical KolibriOS `portable` state, pyproc + Linux Dual-Boot 및 pixel/pointer/clock/entropy device 증명 |

[deviceBackedDualBootProbe](../../tests/attempts/webMachine/probes/deviceBackedDualBootProbe.html)는 pyproc heap에서
`/home/web`을, v86 RAM state에서 9P file tree를 제거하고 guest별 block volume으로 분리했다. `pause()`는
guest page cache에 해당하는 file tree를 block에 쓰고, host `flush()`와 CAS generation이 durable 경계를
만든다. 복구는 block을 먼저 적용한 뒤 opaque guest state를 여는 순서다.

[packetNetworkProbe](../../tests/attempts/webMachine/probes/packetNetworkProbe.html)는 browser 계층의 bounded
Ethernet switch와 v86 계층의 NIC bus port를 분리했다. switch는 endpoint, frame 크기, queue 상한, MAC
학습만 소유하고 ARP·IPv4·ICMP 정책은 probe fixture가 소유한다. NIC port는 snapshot에 넣지 않으며 cold
restore가 새 port를 연결한다. portable NIC state는 snapshot의 MAC을 보존해 guest RAM과 receive filter가
같은 장치 identity를 보게 한다.

[displayInputProbe](../../tests/attempts/webMachine/probes/displayInputProbe.html)는 `text-cells` display와
`ps2-scan-code` input을 console과 서로에게서 분리했다. display는 단일 producer의 working cells를 revision
단위로 present하고 subscriber에 복제 frame만 준다. input은 단일 focus, bounded batch queue이며 pause에서
분리된다. v86 bridge는 공개 `screen-set-size`, `screen-put-char`, `keyboard_send_scancodes`만 소비한다.

[framebufferPointerProbe](../../tests/attempts/webMachine/probes/framebufferPointerProbe.html)는 `rgba-frame`
display와 `relative-pointer` input을 text/keyboard에서 분리했다. display는 bounded RGBA8888 region을 working
frame에 적용하고 revision 단위로 원자 present한다. browser frame source는 v86이 canvas에 반영한 dirty region만
복제하며 guest bridge는 `screen-set-size`와 PS/2 mouse bus event만 변환한다. framebuffer와 pointer handle은
snapshot에 넣지 않고 cold restore에서 output 먼저, resume 직전에 input 순서로 새 장치에 연결한다.

[clockEntropyProbe](../../tests/attempts/webMachine/probes/clockEntropyProbe.html)는 `wall-monotonic` clock과
`cryptographic-random` entropy를 browser 전역에서 분리했다. v86의 공식 `wasm_fn`에 monotonic tick과
RDRAND 공급 함수를 주입하고, engine 전용 clock port가 `Date.now()`를 직접 읽던 CMOS RTC를 명시적 wall
clock으로 치환한다. Linux root가 ioperm으로 CMOS 0x70/0x71을 직접 읽고 RDRAND instruction 결과를 host가
공급한 4 bytes와 대조한다. clock/entropy handle은 snapshot에 넣지 않으며 cold restore는 새 공급원을 붙인다.

[ownerSuccessorProbe](../../tests/attempts/webMachine/probes/ownerSuccessorProbe.html)는 browser coordination을
guest와 분리했다. `WebLockOwnerCoordinator`는 같은 machine의 실행 owner를 하나로 제한하고,
`IndexedDbOwnerEpochStore`는 lock 획득마다 owner identity와 epoch를 원자 갱신한다. machine handle은 이 token을
adopt해 command 결과를 owner와 epoch 양쪽으로 fence한다. 강제 제거된 context의 browser handle은 저장하지
않으며 successor가 같은 완료 generation을 복구한다.

adapter는 host core의 필수 dependency가 아니다. consumer 또는 integration layer가 등록한다. 따라서 x86 엔진의 크기·라이선스·업데이트가 pyproc 기본 패키지에 전이되지 않는다.

## 코드 위치 결정 게이트

신규 능력은 바로 `src/`에 넣지 않는다.

```text
tests/attempts/webMachine/
├─ README.md
├─ host/
├─ adapters/
├─ fixtures/v86/
└─ probes/
```

두 엔진과 한 Linux guest는 계약을 통과했다. 승격 위치는 pyproc `src/`가 아니라 독립 package 구조로
확정했다. 폴더와 import 강행 규칙은 [04-clean-architecture-and-code-rules.md](04-clean-architecture-and-code-rules.md)가 정본이다.
공통 block과 영속 commit은 실제 guest file까지, packet network는 실제 Linux NIC까지, text display/input은
실제 VGA와 PS/2 keyboard까지 통과했다. 단일 owner와 durable epoch successor도 실제 browsing context
경쟁과 강제 제거까지 통과했다. RGBA framebuffer와 relative pointer도 실제 graphical x86 guest와 process
cold reattach를 통과했다. clock/entropy도 실제 Linux CMOS, timer, RDRAND와 process cold reattach를 통과했다. 이동 가능한 envelope,
배포 검토 전에는 pyproc 공개 export를 늘리지 않는다.

## 가장 큰 위험

1. **거짓 공통화**: 이름만 같은 pause/snapshot이 guest마다 다른 보장을 가진다.
2. **대형 이미지 비용**: x86 disk와 RAM image가 Python heap보다 훨씬 클 수 있다.
3. **백그라운드 throttling**: 탭 생존과 실제 지속 실행은 다른 문제다.
4. **장치 의미론 누수**: request bridge와 packet network를 같은 것으로 가장할 수 없다.
5. **라이선스와 배포권**: engine code와 guest image는 별도 검토 대상이다.

위험을 숨기지 않고 capability와 adapter별 contract로 공개한다.
