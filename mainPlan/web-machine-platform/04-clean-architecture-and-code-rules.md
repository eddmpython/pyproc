# 04. 클린 아키텍처와 코드 규칙

## 결정

Web Machine Host는 pyproc 내부 기능으로 키우지 않는다. **독립적인 platform core와 browser host를 두고,
pyproc과 v86은 guest plugin으로 연결한다.** pyproc은 첫 guest OS이며 core의 주인이 아니다.

기능 수보다 의존성 방향을 먼저 고정한다. 새 OS를 추가할 때 core를 수정해야 한다면 설계 실패다.

## 절대 불변식

1. core에는 guest 이름과 engine 이름이 0개다.
2. core에는 `window`, `document`, `navigator`, storage, network, random 같은 browser 구현 접근이 0개다.
3. browser host는 guest adapter를 import하지 않는다.
4. guest adapter끼리는 서로 import하지 않는다.
5. adapter 등록과 device 조립은 composition root 한 곳에서만 한다.
6. snapshot payload는 core에서 해석하지 않는 bytes다.
7. OS별 분기, mode flag, optional method 누적으로 새 guest를 붙이지 않는다.
8. durable이라고 부르는 상태는 snapshot과 disk가 한 generation으로 commit된 뒤의 상태뿐이다.

## 최종 패키지 구조

패키지를 세부 기능마다 늘리지 않는다. 처음에는 책임과 release 축이 다른 네 package만 둔다.

```text
packages/
├─ core/                       # @web-machine/core, 순수 상태 머신과 계약
│  ├─ index.js
│  ├─ index.d.ts
│  └─ src/
│     ├─ contracts/
│     │  ├─ adapterContract.js
│     │  ├─ deviceContract.js
│     │  └─ webMachineError.js
│     ├─ host/
│     │  ├─ webMachineHost.js
│     │  ├─ machineHandle.js
│     │  └─ commandQueue.js
│     └─ image/
│        ├─ snapshotEnvelope.js
│        └─ machineManifest.js
├─ browser/                    # @web-machine/browser, browser 구현
│  ├─ index.js
│  └─ src/
│     ├─ composition/
│     │  └─ createBrowserHost.js
│     ├─ coordination/
│     │  ├─ ownerElection.js
│     │  └─ ownershipFence.js
│     ├─ persistence/
│     │  ├─ generationStore.js
│     │  ├─ blobStore.js
│     │  └─ recovery.js
│     └─ devices/
│        ├─ consoleDevice.js
│        ├─ blockDevice.js
│        ├─ requestNetworkDevice.js
│        ├─ packetNetworkDevice.js
│        ├─ displayDevice.js
│        ├─ inputDevice.js
│        ├─ clockDevice.js
│        └─ entropyDevice.js
├─ guest-pyproc/               # @web-machine/guest-pyproc
│  ├─ index.js
│  └─ src/pyprocGuestAdapter.js
└─ guest-v86/                  # @web-machine/guest-v86
   ├─ index.js
   └─ src/v86GuestAdapter.js

apps/
└─ lab/                        # 조립과 관찰만 하는 개발 표면

tests/
├─ contracts/                  # 모든 adapter가 그대로 소비하는 공통 suite
├─ architecture/               # 금지 import, 금지 이름, cycle gate
├─ browser/                    # 실제 browser lifecycle/failure gate
└─ fixtures/                   # hash 고정 image recipe, binary는 미추적
```

WASI adapter는 제품 지원 범위가 확정될 때 `guest-wasi/`로 추가한다. device도 독립 release와 제3자 소비가
실제로 생기기 전에는 package로 쪼개지 않고 `browser/src/devices/`에 둔다.

## 의존성 방향

```text
                         +----------------------+
                         |       apps/lab       |
                         +----------+-----------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
              v                     v                     v
   @web-machine/browser   guest-pyproc adapter    guest-v86 adapter
              |                     |                     |
              +---------------------+---------------------+
                                    |
                                    v
                         @web-machine/core
```

허용:

- `browser -> core`
- `guest-* -> core`의 공개 계약
- `app -> browser + guest-*`

금지:

- `core -> browser` 또는 `core -> guest-*`
- `browser -> guest-*`
- `guest-a -> guest-b`
- package 사이 deep import

## 현재 attempts 구조

본진 승격 전에도 최종 경계를 흉내 낸다.

```text
tests/attempts/webMachine/
├─ README.md
├─ host/                       # engine/browser 중립 계약 초안
│  ├─ adapterContract.js
│  ├─ snapshotEnvelope.js
│  ├─ webMachineError.js
│  └─ webMachineHostDraft.js
├─ browser/                    # device와 persistence의 browser 구현 초안
│  ├─ devices/
│  │  └─ memoryBlockDevice.js
│  └─ persistence/
│     ├─ generationIntegrity.js
│     ├─ memoryGenerationStore.js
│     ├─ indexedDbGenerationStore.js
│     └─ machineCommitCoordinator.js
├─ adapters/                   # guest별 변환, 파일 하나당 adapter 하나
│  ├─ fakeGuestAdapter.js
│  ├─ pyprocGuestAdapter.js
│  ├─ pyproc/
│  │  └─ pyprocHomeVolume.js
│  ├─ wasiGuestAdapter.js
│  ├─ v86GuestAdapter.js
│  └─ v86/
│     ├─ v86BlockBuffer.js
│     └─ v86FileSystemVolume.js
├─ fixtures/
│  └─ v86/
│     ├─ config.js
│     ├─ prepareAssets.mjs
│     └─ assets/               # hash 검증 로컬 자산, git 미추적
└─ probes/                     # 유일한 composition root
   ├─ hostContractProbe.html
   ├─ dualEngineProbe.html
   ├─ linuxGuestProbe.html
   ├─ dualBootProbe.html
   ├─ generationContractProbe.html
   ├─ persistentDualBootProbe.html
   └─ deviceBackedDualBootProbe.html
```

## 계약 규칙

### Host

Host의 public verb는 아래로 제한한다.

```text
registerAdapter / registerDevice / createMachine / getMachine
boot / pause / resume / snapshot / restore / shutdown / inspect
```

- machine별 command queue를 사용한다. 전역 mutex를 만들지 않는다.
- 상태 전이는 Host만 바꾼다. adapter가 Host state를 직접 쓰지 않는다.
- ownership epoch가 바뀐 in-flight command는 `WEB_MACHINE_OUTCOME_UNKNOWN`이며 자동 replay하지 않는다.
- ID, clock, entropy, persistence는 생성자 또는 device port로 주입한다.

### GuestAdapter

필수 method는 `boot`, `pause`, `resume`, `snapshot`, `restore`, `shutdown`, `request`, `inspect`다.

- adapter는 자기 engine과 공통 계약 사이의 변환만 담당한다.
- 같은 guest의 volume wire format과 engine callback bridge는 guest 이름의 하위 폴더에 둔다. 다른 guest는 import하지 않는다.
- `snapshotScope`, `pauseMode`, `shutdownMode`, `requiredDevices`를 capability로 정직하게 공개한다.
- 지원하지 않는 보장을 흉내 내지 않는다. `session` state를 `portable`이라고 부르지 않는다.
- engine constructor와 대형 asset은 외부 주입한다.

### VirtualDevice

- `request` network와 `packet` network는 다른 contract다.
- block write는 `write`와 `flush` 완료 경계를 분리한다.
- console, display, input을 하나의 UI object로 합치지 않는다.
- 권한 없는 device는 adapter `boot()` 전에 거부한다.
- browser handle은 snapshot에 넣지 않고 resume 전 다시 attach한다.

## 코드 규칙

1. native ESM과 명시적 `.js` 확장자를 쓴다. default export는 쓰지 않는다.
2. public surface는 package `index.js`와 `index.d.ts`만 통과한다. deep import는 테스트도 금지한다.
3. 파일 하나에는 변경 이유 하나만 둔다. state machine, envelope, persistence, device 구현을 한 파일에 섞지 않는다.
4. `utils/`, `common/`, `shared/`, `helpers/` 폴더는 만들지 않는다. 공유 코드는 이름 있는 domain 책임으로 승격한다.
5. 같은 의미의 소비자가 둘 이상 확인되기 전에는 추상화를 만들지 않는다. 단순 코드 중복보다 거짓 공통화가 더 나쁘다.
6. `isLinux`, `useV86`, `pythonMode` 같은 guest flag를 core와 browser에 넣지 않는다. 새 guest는 adapter 등록으로만 추가한다.
7. Boolean option으로 동작 의미를 바꾸지 않는다. 다른 보장은 이름 있는 capability 또는 별도 implementation으로 표현한다.
8. 오류는 `WebMachineError(code, message, details)` 한 종류로 좁힌다. 문자열 throw와 원인 없는 catch를 금지한다.
9. 장시간 operation은 취소와 timeout 경계를 계약에 포함한다. 내부 무한 대기는 금지한다.
10. 상수는 schema version, protocol number, 측정에서 고정된 limit만 허용한다. 출처와 호환성 범위를 같은 파일에 둔다.
11. snapshot envelope와 capability record는 생성 뒤 불변으로 취급한다. 외부에 내부 mutable collection을 반환하지 않는다.
12. composition root 외부에서 singleton과 전역 registry를 만들지 않는다.

## 이름 규칙

| 책임 | 이름 |
|---|---|
| 플랫폼 진입점 | `WebMachineHost` |
| machine 제어 handle | `MachineHandle` |
| guest 변환 | `<Guest>GuestAdapter` |
| 장치 port/구현 | `<Name>Device` |
| 영속 blob/generation | `<Name>Store` |
| 소유권 조정 | `<Name>Coordinator` 또는 `<Name>Fence` |
| 이동 가능한 봉투 | `MachineEnvelope`, `SnapshotEnvelope` |
| 구조화 오류 | `WebMachineError` |

`manager`, `service`, `processor`, `helper`처럼 책임이 보이지 않는 이름은 금지한다.

## 영속 commit 규칙

```text
pause adapters
  -> flush block devices
  -> collect opaque guest snapshots
  -> write content-addressed blobs
  -> write immutable generation manifest
  -> CAS HEAD(previous -> next)
  -> publish durable
```

- 중간 실패 generation은 HEAD가 아니므로 복구 대상이 아니다.
- HEAD 손상 시 PREV까지 검증하고, 둘 다 실패하면 명시적 recovery error다.
- adapter state와 disk generation을 따로 성공 처리하지 않는다.
- 탭 owner가 바뀌면 이전 epoch의 commit과 command 결과를 받아들이지 않는다.

## 기계 게이트

`npm test`가 다음을 차단한다.

1. attempts root의 승인되지 않은 파일과 폴더.
2. host에서 guest/engine 이름 사용.
3. host에서 browser 전역과 storage/network API 직접 접근.
4. host가 adapters, fixtures, probes를 import하는 역방향 의존.
5. guest adapter 사이 import와 adapter의 pyproc deep import. 같은 guest의 이름 있는 wire format/engine bridge만 내부 import 허용.
6. browser의 guest 이름과 adapter/fixture/probe 역방향 import.
7. probe 밖 adapter 등록.
8. Web Machine import graph cycle.
9. default export와 확장자 없는 local ESM import.

browser gate는 모든 adapter에 같은 lifecycle suite를 적용하고, fault injection으로 permission, timeout,
ownership loss, torn commit, cold restore를 검증한다.

## 본진 승격 조건

다음이 모두 GREEN일 때만 독립 package 골격을 만든다.

1. [통과] pyproc + Linux 공통 lifecycle과 full file state cold restore.
2. [통과] 공통 block device의 write/flush/snapshot generation과 pyproc home/v86 9P guest file backing volume.
3. [대기] request/packet network 분리와 permission 선거부.
4. [통과] 브라우저 프로세스 종료 뒤 IndexedDB HEAD/PREV cold reopen.
5. [통과] architecture gate와 adapter contract suite.
6. [대기] engine/image license와 SBOM 배포 검토.

이전에는 attempts 코드가 아무리 안정적이어도 pyproc `src/`나 public export로 복사하지 않는다.
