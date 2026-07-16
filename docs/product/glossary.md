# 용어집 - 이름의 소유권

같은 저장소에 두 계층(공개 pyproc 커널, 비공개 Web Machine 플랫폼)이 살므로 은유의
경계를 여기서 고정한다. 새 이름을 붙일 때 이 표와 충돌하면 이름을 바꾼다.

## pyproc (공개 npm 표면)

| 용어 | 뜻 | 소유 |
|---|---|---|
| Runtime | 한 탭 안 Pyodide 커널의 핸들(run/install/fs) | `boot()`, `new Runtime(py)` |
| Session | 부활 가능한 파이썬 머신의 핸들(결정적 리플레이 + 델타) | `bootSession`, `openMachine` |
| cp0 / 리플레이 경계 | 같은 매니페스트가 재현하는 바이트 동일 힙의 기준점 | ReactiveController의 노드 0 |
| Checkpoint | cp0 위 페이지 해시 나무의 노드(복원 핸들) | `reactive.checkpoint()` |
| Journal | 유휴마다 HEAD/PREV 세대로 커밋되는 WAL | `MachineJournal` |
| Machine image | 서명된 이동 가능 상태 파일 `.pymachine` | `Session.exportImage`, `openMachine` |
| Kernel (선출) | 여러 탭 중 실제 파이썬을 소유한 리더 | `KernelElection`, `openPersistentMachine` |
| Process | PyProc 풀의 워커 인터프리터(독립 GIL) | `PyProc` |
| Container | 머신 안 머신(자기 매니페스트로 부팅한 커널) | `MachineContainer`, `pyprocMachine` |

pyproc에서 "Machine"은 단독 클래스명이 아니라 능력 접두(MachineJournal/MachineJail/
MachineContainer)와 파일 포맷(.pymachine)에만 쓴다. Session을 Machine으로 개명하지
않는 이유: 아래 플랫폼 계층이 Machine 어휘를 선점했다.

## Web Machine 플랫폼 (packages/, 비공개)

| 용어 | 뜻 | 소유 |
|---|---|---|
| Web Machine | 여러 guest OS를 부팅하는 브라우저 컴퓨터 계약 | `packages/core` |
| MachineHandle / WebMachineHost | 호스트 생명주기(boot/pause/snapshot/restore) | `packages/core/src/host` |
| Guest | host 계약을 구현한 OS 어댑터(pyproc, v86 Linux) | `packages/guest-*` |
| Generation | owner-fenced 저장소의 HEAD/PREV 커밋 단위 | `packages/browser` persistence |
| `.webmachine` | 두 OS 스냅샷과 디스크를 함께 서명 운반하는 봉투 | `packages/browser` image |
| Web Computer | 두 OS를 한 화면에서 조립한 제품 | `apps/webComputer` |

경계 선언: pyproc 공개 표면은 이 플랫폼 어휘를 쓰지 않고, 플랫폼 core는 guest 이름
(pyproc/v86)을 모른다. 조립은 composition root(`apps/webComputer`)만 한다.

## 접미 관례

`<Name>Store`(영속), `<Name>Coordinator`(조정), `<Name>Bridge`(경계 변환),
`<Name>Controller`(상태 기계 조작), `enable<Name>`(Runtime 능력 팩토리),
subpath는 kebab-case(`pyproc/process-os`).
