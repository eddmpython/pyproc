# 01. 아키텍처 - OS 축별 현재 자산과 남은 증명

## 레이어

```text
제품 표면(codaro / dartlab / xlpod / examples)
        |
Browser Python OS API
        |
Runtime  Process OS  Capabilities
        |
Pyodide/WASI engines  Workers  Service Worker  OPFS
        |
Chromium sandbox, WASM, SAB, Web Locks, CSP, WebGPU
```

pyproc이 소유하는 것은 제품 UI가 아니라 OS API와 커널 프리미티브다. 소비 제품은 노트북, 시트, 코딩 도구, 데이터 도구 같은 표면을 위에 얹는다.

## 축별 현황

| 축 | 현재 자산 | 남은 증명 |
|---|---|---|
| 프로세스 | `PyProc`, `fork`, `signal`, `JobControl`, worker repl | 프로세스 그룹, wait 계열, 긴 작업 취소의 일관성 표 |
| 메모리 | `ReactiveController`, checkpoint tree, `Session`, 512MB 비용 봉투, 512MB journal pack 수치, `MachineJournal.autoPack` | 제품별 쿼터/idle UI 정책 |
| 파일 | `Runtime.fs`, `mountHome`, `DeviceFs`, `.pymachine` home payload | 파일 권한/락/마운트 정책, 이미지 포맷 마이그레이션 경로 |
| IPC | `pipe`, `shm`, `lock`, `semaphore` | 다중 producer/consumer, 큰 스트림, 오류 전파 계약 |
| 네트워크 | `AsgiServer`, `VirtualOrigin`, `SocketBridge`, `virtualOriginBoundaryProbe` | 릴레이 운영 모델, 외부 제품 VirtualOrigin 채택 |
| 보호 | `MachineJail`, trust flag, CSP, `.pymachine` WebCrypto signature, `fingerprintMachinePublicKey`, trust/permission UI contract, 부트 자산 SRI v2(`pyodide.js` + fetch core + pyproc worker graph preflight), `registerPyProcServiceWorker`, SW `coreIntegrity`, 실행 자산 manifest | 외부 제품 공개키/권한 UI gate, 힙 평문 비밀 경고 |
| 부팅/영속 | `bootEnv`, `freeze`, `MachineJournal`, `MachineJournal.pack/prune/autoPack`, `Init.resume`, `KernelElection`, `SharedKernel`, `resumeCatalog` | SharedKernel과 hibernate/resume 결합, 외부 제품 resume.py gate |
| 개발 표면 | `Terminal`, `%pip`, `%undo`, signed machine cast demo, Server Dev demo, Speed Lab demo, 공개 import 경계 게이트 | 제품 소비 배선, completion/history polish, compatibility lab |
| 성능 | WebGPU, CPU sharding, snapshot fork, Speed Lab public benchmark | WebVM/JupyterLite/marimo 대비 정면 벤치 |

## 핵심 설계 원칙

1. **OS 목표는 유지한다.** 단, 리눅스 복제라는 뜻으로 쓰지 않는다.
2. **브라우저 벽은 가상화한다.** raw TCP listen은 ASGI/VirtualOrigin, fork는 worker, socket은 relay, 디스크는 OPFS로 대응한다.
3. **상태가 제품이다.** 코드와 파일만 저장하는 경쟁자와 달리 실행된 힙 상태, 분기, 저널, 머신 이미지를 일급 값으로 다룬다.
4. **공개 표면만 소비시킨다.** `raw`/엔진 내부를 제품이 만지는 순간 OS 커널 경계가 무너진다.
5. **큰 힙을 숨기지 않는다.** OS 간판의 가장 약한 지점은 O(힙) 비용이므로 숫자로 공개한다.

## 다음 아키텍처 질문

1. OS 판정표 v2에서 현재 점수는 몇 점인가.
2. 공개키 배포와 권한 UI 계약을 어떤 외부 제품 gate로 고정할 것인가.
3. codaro/dartlab/xlpod의 `resume.py` 정책을 어떤 제품 gate로 고정할 것인가.
4. 외부 소비 제품은 VirtualOrigin을 어떤 URL namespace와 인증 방식으로 채택할 것인가.
5. 외부 소비 제품이 OS API만으로 가져가야 하는 최소 묶음은 무엇인가.
