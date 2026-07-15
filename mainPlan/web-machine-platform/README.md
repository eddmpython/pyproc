# web-machine-platform - 브라우저를 컴퓨터로 만드는 상위 North Star

상태: 활성 (2026-07-15). 목표: 브라우저를 하나의 런타임이 아니라 여러 게스트 OS가 올라가는 범용 컴퓨터로 정의하고, 그 목표를 실측 가능한 Web Machine 계약과 Dual-Boot 게이트로 좁힌다.

현재 증명: 같은 host registry에서 pyproc Python OS와 Linux 6.8.12 i686을 실제 동시 부팅하고,
두 opaque snapshot과 flushed block image를 한 content-addressed IndexedDB generation에 CAS commit했다.
Edge process tree를 종료한 뒤 새 process에서 boot 없이 세 상태를 함께 복원했다. Phase 3 Dual-Boot와
Phase 4 durable generation 핵심은 통과했다. 이어 pyproc heap에서 `/home/web`을, v86 RAM state에서
Linux 9P file을 제거하고 별도 block volume에서만 복원했다. 실제 guest file의 block 배선도 통과했으며
Linux eth0를 bounded packet switch에 연결해 실제 ARP/ICMP와 process cold restore 뒤 NIC 재연결까지 통과했다.
이어 VGA text display와 PS/2 keyboard를 console과 분리하고 cold restore 뒤 새 장치 재연결까지 통과했다.
RGBA framebuffer, pointer와 owner successor는 남아 있다.

## 한 문장

**브라우저를 가상 하드웨어와 영속 생명주기를 가진 컴퓨터로 만들고, pyproc Python OS와 별도 Linux 게스트를 같은 Web Machine 계약으로 부팅한다.**

## pyproc의 자리

pyproc은 폐기되거나 범용 에뮬레이터로 변하지 않는다. pyproc은 Web Machine 위에서 가장 먼저 부팅되는 Python 게스트 OS이며, 현재 공개 패키지의 범위도 Browser Python OS 커널로 유지한다. 범용 host 계약은 게스트 내부와 분리해 검증한다.

## 왜 지금

pyproc은 실행, 프로세스, 파일, 네트워크 가상화, 권한, 머신 이미지, 탭 장애복구를 한 Python 머신 안에서 실측했다. 다음 근본 질문은 Python 기능을 더 붙이는 것이 아니라, 이 생명주기와 장치 계약을 다른 실행 엔진도 사용할 수 있는 컴퓨터 경계로 분리할 수 있는가다.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 무엇을 창조하며 어떤 경우 혁신이 아닌가.
2. [01-architecture.md](01-architecture.md) - 얇은 Web Machine 계약, host와 guest의 책임, 이미지 봉투.
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - 실험 순서, Dual-Boot 게이트, 졸업과 중단 조건.
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장과 최신 NEXT.
5. [04-clean-architecture-and-code-rules.md](04-clean-architecture-and-code-rules.md) - 최종 package 구조, 의존성 방향, 코드와 기계 게이트.

## 완료 조건

1. pyproc과 두 번째 비-Pyodide 엔진이 같은 host 생명주기 계약으로 부팅·정지·스냅샷·복원된다.
2. Python OS와 Linux 게스트가 같은 가상 디스크·콘솔·권한 모델 아래에서 실행된다.
3. 두 게스트가 모든 탭 종료 뒤에도 마지막 완료 스냅샷에서 다시 열린다.
4. 하나의 `.webmachine` 봉투가 엔진별 opaque snapshot과 공통 manifest를 무결성 검증과 함께 운반한다.
5. 게스트별 특수 케이스가 host core로 새지 않고 adapter 경계에 머문다.
