# pyproc 제품 방향 - 무엇을, 누구를 위해, 왜

pyproc의 전체 방향과 제품 정책의 정본이다. 지속 문서라 docs에 산다(개발 계획·진행 상태는 [mainPlan/](../../mainPlan/README.md)이 담당하고, 완료되면 `_done`으로 빠진다).

## 상위 North Star

**브라우저를 컴퓨터로 만든다. 정확히는 Chromium을 하드웨어·보안 경계로 삼고, 가상 CPU·메모리·디스크·화면·네트워크·장치·권한·부팅·복구를 하나의 Web Machine 계약으로 묶어 서로 다른 guest OS가 올라가게 한다.**

목표는 브라우저에 Windows 또는 macOS 모양 UI를 그리는 것이 아니다. 운영체제가 아래에 컴퓨터가 있다고 믿을 수 있는 얇은 host 계약을 만들고, pyproc Python OS와 별도 Linux guest가 같은 boot, device, snapshot, restore 생명주기를 소비하게 만드는 것이다.

## pyproc의 현재 자리

pyproc은 Web Machine Platform의 첫 Python guest OS다. 공개 npm package는 서버 없이 브라우저에서 Python 실행·프로세스·파일·권한·네트워크 가상화·복원 리액티브를 제공하는 재사용 커널로 유지한다. 독립 private Web Machine package와 `apps/webComputer/` 제품은 pyproc과 Linux를 같은 lifecycle·device·signed image 계약으로 조립한다. codaro/dartlab/xlpod는 pyproc 공개 표면을 소비하고, Web Computer 제품은 별도 composition root에서 상위 플랫폼을 소비한다.

상위 목표가 커져도 현재형 주장은 넓히지 않는다. 범용 host, 공통 `.webmachine` 이미지, Linux Dual-Boot는 [완료된 web-machine-platform](../../mainPlan/_done/web-machine-platform/README.md)에서 독립 private package로 실증했으며 pyproc 공개 API가 아니다.

## 근본 설계 원칙

모든 OS의 syscall과 내부 상태를 통일하지 않는다. Web Machine이 공통화하는 것은 boot, pause, resume, shutdown, virtual device, resource permission, snapshot envelope, failure recovery뿐이다. 엔진별 상태는 opaque payload로 두고 adapter가 번역한다. 새 guest가 추가될 때 host core에 OS 이름 분기가 늘어나면 설계 실패다.

## 문제

브라우저에서 진짜 파이썬을 돌리는 조각(Pyodide, JSPI, File System Access, SharedArrayBuffer)은 이미 있다. 그러나 이들을 "실제 로컬 런타임처럼" 엮는 계층은 각 제품이 매번 새로 짠다. 그 결과:

- codaro·dartlab·xlpod가 같은 브라우저 파이썬 런타임을 필요로 하는데 각자 복붙하면 3벌로 갈라진다. 한 곳에서 버그를 고쳐도 나머지는 안 고쳐진다.
- Pyodide는 단일 인터프리터 한 개다. 병렬·프로세스·상태 복원 같은 "런타임의 물성"은 기본 제공되지 않아 매번 재발명된다.
- 브라우저의 부재 능력(socket/subprocess/blocking input)을 메우는 방식이 제품마다 제각각이라 재사용이 안 된다.

pyproc은 이 계층을 **한 번 제대로 만들어 버전 고정으로 공유**한다. 개선이 한 곳에 모이고, 제품들이 실제로 import하면 자동으로 SSOT가 된다. 오픈소스이므로 외부 사용자에게도 같은 계약으로 열려 있다.

## 무엇인가 / 무엇이 아닌가

**pyproc이다:**
- 프레임워크 무관 ESM 라이브러리. 빌드 단계 없음(네이티브 `.js` + 손으로 유지하는 `.d.ts`).
- 브라우저 티어의 OS 커널 프리미티브: 런타임 부팅, 복원 리액티브, 프로세스 OS, 파일 세계, 권한 감옥, 네트워크 가상화, 능력 계약.
- 교차 관심사(WASM 힙 접근·스택 포인터·몽키패치)를 능력 계약 뒤에 캡슐화한 깨끗한 소비 표면.

**pyproc이 아니다:**
- 일반 목적 리눅스 복제품. 브라우저가 막는 네이티브 바이너리·인바운드 포트·로컬 드라이버 직접 접근은 외부 조각 없이는 만들지 않는다.
- 공개 npm으로 배포되는 범용 Web Machine host 또는 x86 emulator. private package와 로컬 제품은 실측됐지만 engine/image compliance와 공개 package release는 별도 경계다.
- 제품 UI/도메인 로직(커리큘럼·자동화·시트 편집). 그건 소비 제품이 위에 얹는다.
- 실행 위치 배정 정책(어느 티어에서 돌릴지 판정). 그건 제품별로 달라 제품이 소유한다.
- 로컬 엔진/GitHub Actions 엔진. pyproc은 브라우저 티어의 프리미티브만 제공한다.
- Firefox/Safari 대응. 스코프 밖(아래 "지원 경계").

### 안 만드는 것 (검토 후 기각, 근거 보존)

끌리지만 우리에게 틀린 것들. 각 항목은 검토 끝에 기각했고, 근거를 보존한다(상세 논증은 [mainPlan/_done/browser-os/01-os-primitives.md](../../mainPlan/_done/browser-os/01-os-primitives.md) 안티 추천 절).

1. **SharedWorker를 커널로 승격.** COI=false는 플랫폼 벽이고 그 안의 커널은 SAB/interrupt/fork/shm을 전부 잃는다. 대신 Web Locks + BroadcastChannel 선출(`KernelElection`)로 SAB를 지키며 탭 죽음을 넘는다.
2. **메인 커널의 선점 시분할**(settrace 바이트코드 예산). settrace는 2-10배 감속. 선점 단위는 프로세스(워커)이고 메인 커널은 대화형 전용이다.
3. **사용자/계정 시스템.** 브라우저 프로필이 이미 사용자다. 필요한 건 신원이 아니라 머신별 능력(`MachineJail`).
4. **SAB 위 numpy 제로카피 약속.** 단일 선형 메모리 벽으로 불가능. "memcpy 1회"를 공개 계약으로 유지한다.
5. **VT100/xterm.js 에뮬레이션 + 셸 파이프 미니 언어(`|`, `>`).** 1978년의 제약을 역수입하고 파이썬 위에 두 번째 문법을 얹는 덕지덕지다. 셸 언어는 파이썬 그 자체이고, 파이프의 본질(lazy 조합)은 제너레이터에 이미 있다.
6. **split pane / 창 관리자.** 제품 UI는 소비 제품 몫. "한 머신을 여러 화면에서"의 답은 `KernelElection`이다.
7. **커스텀 Pyodide 빌드(pthread/nogil)를 상시 유지.** 엔진 커스텀 빌드는 조건부 보험(발동 조건에서만)이다: [mainPlan/_done/engine-independence/README.md](../../mainPlan/_done/engine-independence/README.md) P4.
8. **WebRTC 분산 머신.** 시그널링 서버 의존 = zero-dep 위반. 기기 간 이동은 `.pymachine` 파일이 담당한다.

## 성공 / 실패 기준

- **현재 제품 성공**: 소비 제품들이 pyproc을 실제 import해서 각자 표면을 얹고, 브라우저 Python OS 개선이 pyproc 한 곳에 모인다. 소비자는 능력 계약만으로 복원 리액티브·프로세스 병렬·파일 세계·권한·가상 오리진을 쓰고 엔진 내부를 만지지 않는다.
- **상위 플랫폼 성공**: 같은 Web Machine Host가 pyproc과 Linux guest를 공통 lifecycle·device·image 계약으로 부팅하고, 두 머신이 탭 장애와 cold reopen 뒤 복구된다.
- **실패**: 제품들이 런타임을 복붙해 갈라지거나, pyproc이 제품 UI와 x86 특수 로직을 흡수하거나, guest가 추가될 때마다 host core의 OS별 분기가 늘어난다.

## Python guest 능력의 네 가지 상태 (목표는 무한대, 현재형 주장은 증명된 만큼)

Web Machine 상위 North Star 아래에서 pyproc guest의 호환성 방향은 "로컬에서 되는 모든 파이썬을 브라우저에서"다. 각 능력은 아래 네 상태 중 하나에 있고, pyproc의 일은 위 칸으로 밀어 올리는 것과 upstream이 벽을 여는 순간 가장 먼저 흡수하는 구조가 되는 것이다. "불가능"은 현재 조건 판정이지 포기가 아니다. 축별 실측 좌표의 정본은 관련 이니셔티브의 실측 원장이다.

1. **현재 달성 (오늘 브라우저 실측)**: 순수 파이썬 + **네이티브 C확장 패키지**(numpy/pandas/scipy/scikit-learn/matplotlib 등 - Pyodide 배포판의 pyemscripten(PEP 783) 휠 158개를 dlopen으로 로드 = 이미 실동), 멀티코어 프로세스/스냅샷-fork/map, 체크포인트/시간여행, 세션 영속·부활, 터미널, 커널 내 ASGI, 영속 FS(OPFS), input/HTTP/subprocess, 프로세스 OS 전반(파이프/shm/락, 잡 컨트롤, 커널 선출, 머신 컨테이너, 권한 감옥, fsWorld), non-Pyodide WASI CPython 3.14.6 부팅 + 순수 파이썬 wheel 설치. **Pyodide는 동적 C확장 .so를 dlopen한다** - "동적 C확장 불가"는 WASI 레인 한정이었다(Pyodide 레인은 됨).
2. **우회 가능 (브라우저 방식으로 가상화, 실측)**: 아웃바운드 소켓(`SocketBridge`), 서버(`AsgiServer`/`VirtualOrigin`), 프로세스(워커 커널). **GPU 수치 가속**(WebGPU 컴퓨트 - 워커 접근 + JSPI 동기 구동, 선행자 WgPy가 Pyodide 위 matmul 340배 실측. f32 대규모 선형대수라는 좁은 계급에서 오늘 됨. numpy 투명 가속은 아니고 별도 배열 API). numpy를 WASI 정적 fat 바이너리로 빌드하는 경로도 있으나(빌드 확정) **속도 이득 없음, 오히려 느림**(참조 BLAS + no-SIMD, WASI 값 다리 JSON 한정) = 커버리지 실험이지 속도 경로 아님.
3. **upstream 대기 (지금 막혔으나 플랫폼 발전으로 다시 열림)**: **임의 C확장 즉시 설치**(Pyodide dlopen은 되나 그 패키지의 pyemscripten 휠이 발행돼야 = PEP 783 생태계 채택 ~28개, ABI 락스텝. 대다수 긴 꼬리는 미발행), WASI 동적 링킹(cpython#142234), **numpy SIMD 빌드**(Pyodide가 아직 SIMD로 안 빌드 = 2-4배 대기), 진짜 threading/nogil(WASM threads + 공유 메모리, PR #6285 draft).
4. **웹 보안상 영구 벽 (외부 조각 없이는 불가)**: 인바운드 서버, 임의 네이티브 바이너리 실행, 로컬 드라이버 직접(CUDA), 데스크톱 자동화. 이 몫은 소비 제품의 로컬/Actions 티어가 진다.

정정(정직, 2026-07-13 연구 종합): (1) 네이티브 수치 패키지 **가용성은 이미 해결**(numpy 등 158 휠 dlopen). (2) "동적 C확장 불가"는 WASI 한정 - Pyodide는 dlopen을 한다. (3) 진짜 남은 벽은 **속도**(numpy 대규모 산술 86배 느림 = 이 격차가 다음 도약. 경로: [mainPlan numerical-acceleration](../../mainPlan/_done/numerical-acceleration/README.md) = horizontal 샤딩 + GPU 잔류 레인)와 **임의 패키지 커버리지**(pyemscripten 휠 생태계 채택). (4) GPU는 상태2로 정정(오늘 라이브러리로 됨, 이전 판의 상태3은 stale).

## 지원 경계 (Chromium/Edge 전용)

JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox/Safari 미지원은 결함이 아니라 스코프다. SharedArrayBuffer는 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 관련 문서

- 상위 Web Machine 비전과 Dual-Boot 완료 기록: [mainPlan/_done/web-machine-platform](../../mainPlan/_done/web-machine-platform/README.md)
- 첫 Python guest OS 성숙 완료 기록: [mainPlan/_done/browser-os-north-star](../../mainPlan/_done/browser-os-north-star/README.md)
- 소비 계약(설치·공개 표면·버전 정합): [docs/consuming/contract.md](../consuming/contract.md)
- 운영 모델(수명주기·개발 원칙): [docs/operations/operatingModel.md](../operations/operatingModel.md)
- 현재 개발 계획과 결정 기록: [mainPlan/](../../mainPlan/README.md) (이니셔티브는 완료 시 `_done`으로 이관)
