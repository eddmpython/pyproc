# 00. 제품 비전 - 첫 Python guest OS를 완성한다

## 목표

이 이니셔티브의 목표는 단순한 웹 파이썬 실행기가 아니라 **브라우저 안 Python OS**를 실측으로 완성하는 것이다. 상위 North Star는 [Web Machine Platform](../web-machine-platform/README.md)이며, pyproc은 그 위에 처음 올라가는 guest OS다.

정확한 정의:

- 브라우저 탭은 하드웨어와 보안 경계다.
- Web Worker는 프로세스다.
- WASM 힙과 체크포인트 나무는 메모리/스냅샷 계층이다.
- OPFS와 DeviceFs는 파일 세계다.
- Service Worker와 ASGI는 네트워크 가상화다.
- MachineJail과 CSP는 권한/보호 계층이다.
- Session, MachineJournal, KernelElection은 부팅·영속·크래시 생존 계층이다.
- Terminal, JobControl, pipe, shm은 유저랜드와 셸 계층이다.

그래서 pyproc의 현재 제품 정체성은 "브라우저에서 파이썬 코드 실행"이 아니라, **파이썬으로 구성된 첫 Web Machine guest OS 커널**이다.

## OS라고 부를 수 있는 조건

OS 간판은 이름으로 얻지 않는다. 아래 축을 실측으로 통과해야 한다.

| 축 | pyproc의 기준 | 통과 조건 |
|---|---|---|
| 프로세스 | pid, fork, kill, signal, job control | 살아있는 상태를 자식에 넘기고, 종료·시그널·백그라운드 작업이 재현 가능 |
| 메모리 | checkpoint, restore, time travel, branch tree | 실행 경계에서 상태를 되돌리고 분기하며, 대형 힙 비용을 공개 |
| 파일 | `/home`, `/dev`, `/proc`, `/var`, `.pymachine` | 재부팅·탭 죽음·파일 이동 뒤에도 일관성 유지 |
| IPC | pipe, shm, lock, semaphore | 배치 map이 아니라 흐름·블로킹·backpressure 제공 |
| 네트워크 | ASGI, VirtualOrigin, SocketBridge | 브라우저 벽 안에서 서버/클라이언트 역할을 가상화 |
| 보호 | MachineJail, CSP, trust gate | 신뢰·권한·네트워크 범위를 실행 전에 제한 |
| 부팅/영속 | Session, Journal, KernelElection | 닫힘·죽음·재방문에서 커널 상태가 복구 |
| 개발 표면 | Terminal, `%pip`, `%undo`, self-hosting | OS 위에서 앱을 개발하고, 되돌리고, 재기동 가능 |

## 만들지 않는 것

리눅스 복제는 목표가 아니다. 임의 네이티브 바이너리, 로컬 드라이버, 인바운드 공개 포트, 데스크톱 조작은 브라우저 보안 모델 밖이다. 이들은 로컬 에이전트나 릴레이가 필요한 외부 조각으로 분리한다.

브라우저 OS의 강점은 리눅스 흉내가 아니라 다음 네 가지다.

1. 사용자 데이터가 탭 밖으로 나가지 않는 실행 경계.
2. 실행된 상태 자체를 저장·분기·이동하는 `.pymachine`.
3. 서버 컨테이너 없이 브라우저에서 프로세스·서버·터미널을 갖는 것.
4. 제품들이 같은 커널을 import해서 각자 표면을 얹는 것.

## 성공 기준

이번 라운드의 성공은 "OS라고 부르자"가 아니다. 성공은 다음 문장을 실측으로 방어하는 것이다.

> pyproc은 Chromium 탭 안에서 파이썬 프로세스, 파일 세계, 권한, 네트워크 가상화, 시간여행, 크래시 생존을 제공하는 Browser Python OS 커널이다.
