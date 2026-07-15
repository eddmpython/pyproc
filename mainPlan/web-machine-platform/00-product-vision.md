# 00. 제품 비전 - 브라우저를 컴퓨터로 만든다

## North Star

**브라우저를 가상 하드웨어와 영속 생명주기를 가진 컴퓨터로 만들고, 그 위에 서로 다른 운영체제를 부팅한다.**

이 목표는 브라우저에 데스크톱 모양 UI를 그리는 것이 아니다. 화면, 파일, 프로세스, 네트워크, 장치, 권한, 부팅, 종료, suspend, resume을 중재하는 host를 만들고, Python OS, WASI guest, x86/Linux guest가 같은 머신 생명주기를 소비하게 만드는 것이다.

## 제품 가설

운영체제마다 내부 syscall과 파일시스템을 다시 구현하면 실패한다. 반대로 브라우저가 제공하는 WASM, Web Worker, OPFS, Service Worker, Canvas, WebGPU, 입력·장치 API를 하나의 얇은 머신 계약으로 묶으면, 실행 엔진별 adapter 하나가 여러 guest를 수용할 수 있다.

```text
Python OS        WASI guest        x86/Linux guest
    |                |                   |
    +---------- GuestAdapter ------------+
                     |
              Web Machine Host
                     |
  WASM / Worker / OPFS / SW / Canvas / WebGPU
                     |
                  Chromium
```

통일하는 것은 guest 내부가 아니라 다음 생명주기다.

- boot, pause, resume, shutdown
- virtual disk, console, display, network, device 연결
- resource limits와 capability permissions
- snapshot, restore, clone, export, import
- tab failure와 cold reopen 이후 복구

## 혁신성 기준

### 선행 검증과 남은 공간

- [v86](https://github.com/copy/v86)은 x86 PC와 여러 운영체제 부팅, emulator state 저장·복원을 이미 증명했다.
- [CheerpX](https://cheerpx.io/docs/overview)는 Linux-compatible syscall layer와 x86 실행 파일의 client-side 실행을 증명했다.
- [WebContainers](https://webcontainers.io/guides/introduction)은 Node.js toolchain과 OS command를 브라우저 안에서 제품 규모로 실행한다.
- [WASI](https://wasi.dev/releases)는 component와 cross-language system interface의 표준 기반을 제공한다.

따라서 "브라우저에서 OS 또는 runtime 하나가 돈다"는 문제는 이미 풀린 범주다. 남은 제품 가설은 서로 다른 engine을 공통 host lifecycle·device·portable state·tab failure recovery 아래에 놓을 수 있는가다. 이 조합의 독창성은 선행기술 조사로 계속 검증하며, 존재하지 않는다고 단정하지 않는다.

다음은 단독으로 혁신 주장이 아니다.

- 브라우저에서 운영체제 하나를 부팅한다.
- Linux 터미널이나 Python REPL 하나를 제공한다.
- Windows 또는 macOS 모양의 창 UI를 만든다.
- 기존 x86 에뮬레이터를 감싼다.

이번 목표가 새로워지는 지점은 다음 조합이다.

1. 서로 다른 실행 엔진을 같은 머신 생명주기와 장치 계약으로 다룬다.
2. 엔진별 opaque state를 하나의 이동 가능한 이미지 봉투로 관리한다.
3. 머신이 특정 탭보다 오래 살고, leader 제거와 cold reopen을 넘는다.
4. 브라우저 장치를 ambient 권한이 아니라 명시적 capability로 guest에 연결한다.
5. pyproc에서 실측한 상태 분기·복구를 다중 guest host의 공통 능력으로 끌어올린다.

## pyproc과 Web Machine의 관계

- **pyproc**: 현재 배포되는 Browser Python OS 커널이며 첫 번째 guest다.
- **Web Machine Host**: 여러 guest engine의 생명주기와 장치를 중재하는 상위 플랫폼이다.
- **제품**: host 위에 데스크톱, IDE, 데이터 도구, 에이전트 작업공간 같은 사용자 표면을 얹는다.

pyproc 공개 API에 x86 또는 Linux 특수 로직을 바로 넣지 않는다. [tests/attempts/webMachine](../../tests/attempts/webMachine/) 캠페인에서 공통 장치와 durable commit까지 검증하고, 졸업 시 [독립 package 구조](04-clean-architecture-and-code-rules.md)로 승격한다.

## 만들지 않는 것

1. Windows, Linux, macOS 커널을 처음부터 다시 작성하지 않는다.
2. 모든 guest에 공통 POSIX syscall table을 강요하지 않는다.
3. 엔진별 snapshot byte 형식을 하나로 만들지 않는다.
4. 최신 Windows나 실제 macOS가 수정 없이 실용 속도로 돈다고 선전하지 않는다.
5. 창 관리자와 데스크톱 UI를 host core에 넣지 않는다.
6. 브라우저가 물리적으로 막는 공개 inbound port, 임의 로컬 드라이버, native GPU driver를 숨기지 않는다.

## 성공 기준

> 같은 Web Machine Host가 pyproc Python OS와 Linux guest를 부팅하고, 공통 디스크·콘솔·권한·이미지 계약으로 suspend/resume하며, 탭 장애와 재방문 뒤에도 두 머신을 복구한다.

## 실패 기준

- guest가 추가될 때마다 host core에 OS 이름 분기와 특수 규칙이 늘어난다.
- 공통 계약을 지키기 위해 guest 내부 syscall이나 패키지를 하나씩 수정해야 한다.
- 두 번째 엔진이 같은 lifecycle contract를 구현하지 못한다.
- OS를 실행하는 것과 OS처럼 보이는 UI를 혼동한다.
- 현재 pyproc의 검증된 제품 계약을 미래 플랫폼 주장으로 과장한다.
