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
5. `clockDevice`: monotonic/wall clock과 timer.
6. `entropyDevice`: browser crypto 기반 random bytes.

카메라, 마이크, clipboard, GPU는 v1 core가 아니라 선택 capability다.

`networkDevice`는 하나의 거짓 추상화로 합치지 않는다. adapter는 `request` 또는 `packet` mode를 capability로 선언한다. ASGI/Service Worker는 request mode, x86 NIC emulation은 packet mode를 소비하며, host는 지원하지 않는 mode를 부팅 전에 거부한다.

## adapter 전략

| adapter | 첫 근거 | 역할 |
|---|---|---|
| pyproc | `openPersistentMachine`, `Session`, `MachineJournal`, [dualEngineProbe](../../tests/attempts/webMachine/probes/dualEngineProbe.html) GREEN 13/13 x3 | 첫 guest OS, `portable` snapshot, heap + `/home/web` + failover |
| WASI | `bootWasi`, `WasiSession`, [dualEngineProbe](../../tests/attempts/webMachine/probes/dualEngineProbe.html) GREEN 13/13 x3 | 두 번째 엔진, `session` snapshot, lifecycle contract의 엔진 독립성 증명 |
| x86 | 외부 주입형 v86 0.5.424, [linuxGuestProbe](../../tests/attempts/webMachine/probes/linuxGuestProbe.html) GREEN 8/8 x3, [dualBootProbe](../../tests/attempts/webMachine/probes/dualBootProbe.html) GREEN 8/8 x3 | Buildroot Linux 6.8.12 i686 `portable` state, pyproc + Linux 실제 Dual-Boot 증명 |

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
공통 block/network/display와 영속 commit 전에는 pyproc 공개 export를 늘리지 않는다.

## 가장 큰 위험

1. **거짓 공통화**: 이름만 같은 pause/snapshot이 guest마다 다른 보장을 가진다.
2. **대형 이미지 비용**: x86 disk와 RAM image가 Python heap보다 훨씬 클 수 있다.
3. **백그라운드 throttling**: 탭 생존과 실제 지속 실행은 다른 문제다.
4. **장치 의미론 누수**: request bridge와 packet network를 같은 것으로 가장할 수 없다.
5. **라이선스와 배포권**: engine code와 guest image는 별도 검토 대상이다.

위험을 숨기지 않고 capability와 adapter별 contract로 공개한다.
