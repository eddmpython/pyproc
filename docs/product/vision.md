# pyproc 제품 방향 - 무엇을, 누구를 위해, 왜

pyproc의 전체 방향과 제품 정책의 정본이다. 지속 문서라 docs에 산다(개발 계획·진행 상태는 [mainPlan/](../../mainPlan/README.md)이 담당하고, 완료되면 `_done`으로 빠진다).

## North Star (한 줄)

**서버 없이 브라우저 탭에서 파이썬을 "노트북 한 셀"이 아니라 운영체제처럼 돌린다. 프로세스·병렬·복원 리액티브를 하나의 재사용 런타임으로 묶어, codaro/dartlab/xlpod가 공유하는 웹 파이썬 런타임의 단일 진실(SSOT)이 된다.**

## 문제

브라우저에서 진짜 파이썬을 돌리는 조각(Pyodide, JSPI, File System Access, SharedArrayBuffer)은 이미 있다. 그러나 이들을 "실제 로컬 런타임처럼" 엮는 계층은 각 제품이 매번 새로 짠다. 그 결과:

- codaro·dartlab·xlpod가 같은 브라우저 파이썬 런타임을 필요로 하는데 각자 복붙하면 3벌로 갈라진다. 한 곳에서 버그를 고쳐도 나머지는 안 고쳐진다.
- Pyodide는 단일 인터프리터 한 개다. 병렬·프로세스·상태 복원 같은 "런타임의 물성"은 기본 제공되지 않아 매번 재발명된다.
- 브라우저의 부재 능력(socket/subprocess/blocking input)을 메우는 방식이 제품마다 제각각이라 재사용이 안 된다.

pyproc은 이 계층을 **한 번 제대로 만들어 버전 고정으로 공유**한다. 개선이 한 곳에 모이고, 제품들이 실제로 import하면 자동으로 SSOT가 된다. 오픈소스이므로 외부 사용자에게도 같은 계약으로 열려 있다.

## 무엇인가 / 무엇이 아닌가

**pyproc이다:**
- 프레임워크 무관 ESM 라이브러리. 빌드 단계 없음(네이티브 `.js` + 손으로 유지하는 `.d.ts`).
- 브라우저 티어의 런타임 프리미티브: 런타임 부팅, 복원 리액티브, 프로세스 OS, 능력 계약.
- 교차 관심사(WASM 힙 접근·스택 포인터·몽키패치)를 능력 계약 뒤에 캡슐화한 깨끗한 소비 표면.

**pyproc이 아니다:**
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

- **성공**: 소비 제품들이 pyproc을 실제 import해서 각자 표면을 얹고, 브라우저 파이썬 런타임 개선이 pyproc 한 곳에 모인다. 소비자는 능력 계약만으로 복원 리액티브·프로세스 병렬을 쓰고 엔진 내부를 만지지 않는다.
- **실패**: 제품들이 여전히 각자 복붙해서 런타임이 갈라진다. 또는 pyproc이 제품 UI/도메인을 흡수해 범용성을 잃는다. 또는 계약이 자주 깨져 소비자가 매번 따라 고친다.

## 능력의 네 가지 상태 (목표는 무한대, 현재형 주장은 증명된 만큼)

North Star("로컬에서 되는 모든 파이썬을 브라우저에서")는 방향이다. 각 능력은 아래 네 상태 중 하나에 있고, pyproc의 일은 위 칸으로 밀어 올리는 것과 upstream이 벽을 여는 순간 가장 먼저 흡수하는 구조가 되는 것이다. "불가능"은 현재 조건 판정이지 포기가 아니다. 축별 실측 좌표의 정본은 관련 이니셔티브의 실측 원장이다.

1. **현재 달성 (오늘 브라우저 실측)**: 순수 파이썬 + Pyodide 빌드 패키지, 멀티코어 프로세스/스냅샷-fork/map, 체크포인트/시간여행, 세션 영속·부활, 터미널, 커널 내 ASGI, 영속 FS(OPFS), input/HTTP/subprocess, 프로세스 OS 전반(파이프/shm/락, 잡 컨트롤, 커널 선출, 머신 컨테이너, 권한 감옥, fsWorld), non-Pyodide WASI CPython 3.14.6 부팅 + 순수 파이썬 wheel 설치. **정적 링크 C 확장도 이미 실행**(`_struct`/`array`/`math` 등 stdlib C 모듈이 브라우저 위 진짜 C 코드로 돈다). "C 확장 불가"는 틀렸다 - **동적만 불가, 정적은 이미 됨.**
2. **우회 가능 (브라우저 방식으로 가상화, 실측)**: 아웃바운드 소켓(`SocketBridge`가 WS->TCP 릴레이에 파이썬 socket을 심어 urllib http+https), 서버(`AsgiServer`/`VirtualOrigin`으로 TCP listen을 진짜 URL로), 프로세스(워커 커널). **네이티브 패키지(numpy 등)는 정적 fat 바이너리로 이 경로에 오른다**(C 소스를 wasi-sdk로 정적 링크해 python.wasm builtin으로. 빌드 경로 확정, 아티팩트는 CI 단계 = 프론티어).
3. **upstream 대기 (지금 막혔으나 플랫폼 발전으로 다시 열림)**: 동적 C확장 로딩(.so dlopen = 임의 wheel 즉시 설치, PEP 783 pyemscripten 휠 / WebAssembly 컴포넌트 모델), GPU(WebGPU 산술), 진짜 threading/nogil(WASM threads + 공유 메모리). 정적 fat 빌드가 있으면 동적 로딩은 없어도 되지만, 임의 패키지 즉시 설치는 이게 열려야 한다.
4. **웹 보안상 영구 벽 (외부 조각 없이는 불가)**: 인바운드 서버(탭이 공개 인터넷의 서버 = 역터널 릴레이 필요), 임의 네이티브 바이너리 실행(`/bin/ls`, ssh 클라이언트), 로컬 드라이버 직접(CUDA), 데스크톱 자동화(pyautogui/xlwings). 이 몫은 소비 제품의 로컬/Actions 티어가 진다.

정정(정직): 이전 판의 "네이티브 휠은 브라우저에서 영원히 불가"는 틀렸다. 정적 링크는 이미 실행되고(상태 1), numpy 정적 빌드는 경로가 확정됐으며(상태 2), 동적 로딩만 upstream 대기(상태 3)다. 영구 벽은 인바운드 서버·임의 네이티브 바이너리·데스크톱 조작(상태 4)이다.

## 지원 경계 (Chromium/Edge 전용)

JSPI(JavaScript Promise Integration), SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox/Safari 미지원은 결함이 아니라 스코프다. SharedArrayBuffer는 페이지가 아래 헤더로 crossOriginIsolated 상태여야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 관련 문서

- 소비 계약(설치·공개 표면·버전 정합): [docs/consuming/contract.md](../consuming/contract.md)
- 운영 모델(수명주기·개발 원칙): [docs/operations/operatingModel.md](../operations/operatingModel.md)
- 현재 개발 계획과 결정 기록: [mainPlan/](../../mainPlan/README.md) (이니셔티브는 완료 시 `_done`으로 이관)
