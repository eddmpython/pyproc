# 용어집 - 이름의 소유권

같은 저장소에 두 어휘 계층(pyproc 커널, `src/machine` Web Machine host)이 살고 둘 다 npm으로 나가므로 은유의
경계를 여기서 고정한다. 새 이름을 붙일 때 이 표와 충돌하면 이름을 바꾼다.

## pyproc (공개 npm 표면)

| 용어 | 뜻 | 소유 |
|---|---|---|
| Runtime | 한 탭 안 Pyodide 커널의 핸들(run/install/fs) | `machine.runtime`, `new Runtime(py)`(`pyproc/runtime`) |
| Machine handle | 역사를 가진 파이썬 머신의 핸들(결정적 리플레이 + 델타) | `boot({ deterministic: true })`, `open(blob, trustOpts)` -> `PyprocMachine` |
| cp0 / 리플레이 경계 | 같은 매니페스트가 재현하는 바이트 동일 힙의 기준점 | ReactiveController의 노드 0 |
| Checkpoint | cp0 위 페이지 해시 나무의 노드(복원 핸들) | `machine.history.checkpoint()` |
| Journal | 유휴마다 HEAD/PREV 세대로 커밋되는 WAL | `MachineJournal` |
| Machine image | 서명된 이동 가능 상태 파일 `.pymachine` | `machine.history.export`, `open(blob, trustOpts)` |
| Kernel (선출) | 여러 탭 중 실제 파이썬을 소유한 리더 | `KernelElection`, `open({ persistent })` |
| Process | PyProc 풀의 워커 인터프리터(독립 GIL) | `PyProc` |
| Container | 머신 안 머신(자기 매니페스트로 부팅한 커널) | `MachineContainer`, `pyprocMachine` |

pyproc의 루트 명사는 "역사를 가진 머신" 하나다(`PyprocMachine`/`PyprocHistory`). `Machine`
접두는 능력(MachineJournal/MachineJail/MachineContainer)과 파일 포맷(`.pymachine`)에도 계속 쓴다.
개명은 이미 일어났다: 옛 `Session` 핸들이 porcelain 머신 핸들로 흡수됐다.

## Web Machine 플랫폼 (src/machine, pyproc의 최상층)

| 용어 | 뜻 | 소유 |
|---|---|---|
| Web Machine | 여러 guest OS를 부팅하는 브라우저 컴퓨터 계약 | `src/machine/contracts`+`host` |
| MachineHandle / WebMachineHost | 호스트 생명주기(boot/pause/snapshot/restore) | `src/machine/host` |
| Guest | host 계약을 구현한 OS 어댑터(pyproc, v86 Linux) | `src/machine/guests` |
| Generation | owner-fenced 저장소의 HEAD/PREV 커밋 단위 | `src/machine/persistence` |
| `.webmachine` | 두 OS 스냅샷과 디스크를 함께 서명 운반하는 봉투 | `src/machine/image` |
| Web Computer | 두 OS를 한 화면에서 조립한 제품 | `apps/webComputer` |

경계 선언: `src/machine`의 순수 집합은 guest 이름(pyproc/v86)을 모르고, 조립은
`createWebComputer` 한 점이 한다. 제품 화면 조립만 `apps/webComputer`가 소유한다.

## 접미 관례

`<Name>Store`(영속), `<Name>Coordinator`(조정), `<Name>Bridge`(경계 변환),
`<Name>Controller`(상태 기계 조작), `enable<Name>`(Runtime 능력 팩토리),
subpath는 단어 하나 소문자(`pyproc/runtime`, `pyproc/history`, `pyproc/machine`, `pyproc/assets`, `pyproc/worker`, 강등 `pyproc/gpu`·`socket`·`wasi`).
