// pyproc - 브라우저 파이썬 프로세스 OS.
// 서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬(프로세스·병렬·복원 리액티브).
// codaro / dartlab / xlpod 공통 런타임의 SSOT.
//
// 공개 표면:
//   checkEnvironment()   - 환경 진단: crossOriginIsolated/SAB/JSPI가 준비됐는지 + 안 됐으면 무엇을
//                          어떻게 고치는지. 기본 표면(boot/run/enableReactive)은 준비 없이 Chromium에서
//                          돌지만, 프로세스 OS(PyProc)/소켓은 COOP/COEP 헤더가 필요하다
//   boot()               - Pyodide 런타임 부팅 -> Runtime
//   bootEnv()            - uv 레인: 환경 선언 + 캐시 디렉터리 -> 웜 부팅(스냅샷+휠, 실측 3.61배)
//   runScript()          - 브라우저판 uv run: PEP 723 인라인 의존성 자동 설치 + 실행
//   Runtime              - run/install/loadPackages/loadPackagesFromImports/setStdout/setStderr/freeze + fs + 능력 등록(enableReactive/enableSyscallBridge/enableAsgiServer/enableTerminal/enableWheelCache)
//   MemoryCapability     - WASM 힙 접근을 캡슐화한 능력 계약
//   FileSystem           - 엔진-무관 일반 파일 IO(Runtime.fs): writeFile/readFile/mkdir/readdir/stat/exists/unlink/rmdir
//   ReactiveController   - 복원 기반 리액티브(체크포인트/시간여행/OPFS 영속)
//   SyscallBridge        - socket/subprocess/input을 빌려주는 능력 계약
//   AsgiServer           - 커널 안 ASGI 서버(FastAPI/Starlette를 소켓 0으로 dispatch)
//   VirtualOrigin        - 파이썬 서버를 진짜 URL로(pyprocSw.js와 짝, fetch -> ASGI 3.4ms)
//   Terminal             - 서버리스 파이썬 REPL(code.InteractiveConsole, %pip/%undo)
//   DeviceFs             - 모든 것은 파일: 브라우저 능력을 파이썬 open()으로(/dev, /proc)
//   Init                 - OS의 init: /home/web/boot.py 오토스타트 + cron.py 주기 틱
//   MachineJournal       - WAL: 유휴마다 상태를 디스크에 남겨 강제종료에도 부활(hibernate 훅 불필요)
//   GpuCompute/GpuArray  - WebGPU 컴퓨트로 f32 대규모 선형대수 가속(잔류 핸들: 업로드1/체이닝/다운로드1).
//                          matmul 실측 ~127배 vs WASM numpy(실 GPU, 타일드 커널). f32 한정(f64 WGSL 부재), 창 모드 필요
//   BrowserControl       - MV3 확장 offscreen에서 파이썬이 브라우저 조작(enableBrowserControl -> install ->
//                          pyprocBrowser.tab(url,mode).navigate/evaluate/click/type/close). script(스텔스)/
//                          debugger(신뢰입력 isTrusted) 두 mode. SW는 별도 openBrowserControlHost(pyproc/browser-control-host)
//   MachineJail          - 권한 감옥: permissions{net,clipboard,home,workers} 2단 집행(협조 초크포인트
//                          + 감옥 컨텍스트의 CSP connect-src = 브라우저 벽). trust 이진 게이트의 스코프 진화
//   PyProc               - 프로세스 OS 커널(스냅샷-fork spawn + Pool.map 병렬 + kill/signal/respawn + fork(2)
//                          + exec/pipe/lock/semaphore/shm = 흐름 IPC: SAB 링버퍼 파이프·명명 공유메모리·락
//                          + matmul = 샤딩 행렬곱: A 행블록을 N코어에 분산, compute-bound near-linear 배속)
//   SIGNAL               - 시그널 번호(INT/TERM/USR1/USR2). PyProc.signal(pid, signum)
//   MachineContainer     - 머신 안 머신: .pymachine급 컨테이너 커널을 워커에 띄우고 파이썬 값(m)으로
//                          노출(m.run/spawn/kill). 중첩(깊이 2+) = 컨테이너 속 컨테이너 = 도커 3요소
//   JobControl           - 셸의 잡 컨트롤: `expr &`가 대화형 네임스페이스를 살아있는 채로 fork해
//                          딴 코어에서 돌린다(프롬프트 즉시 복귀). %jobs/%fg/%kill로 조종
//   KernelElection       - 커널 선출: 여러 탭이 Web Locks로 리더 하나를 뽑고 리더만 커널을 부팅,
//                          나머지는 RPC 뷰. 리더 탭이 죽으면 팔로워가 승격 + 저널에서 resume(탭 죽음 생존)
//   SharedKernel         - 탭 밖에서 사는 공유 커널(SharedWorker, 여러 탭 = 한 파이썬 상태)
//   bootWasi/WasiSession - Pyodide 아닌 CPython(WASI) 세션(엔진 무관 실증). async run/get/set +
//                          완전 시간여행(checkpoint/timeTravel). 값 다리는 JSON 한정, wasmURL 소비자 제공
//
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated). Firefox/Safari 미지원.
export { boot, Runtime, MemoryCapability, PAGE_SIZE, checkEnvironment } from "./src/runtime/runtime.js";
export { ReactiveController } from "./src/capabilities/reactive.js";
export { SyscallBridge } from "./src/capabilities/syscallBridge.js";
export { SocketBridge } from "./src/capabilities/socketBridge.js";
export { AsgiServer } from "./src/capabilities/asgiServer.js";
export { VirtualOrigin } from "./src/capabilities/virtualOrigin.js";
export { Terminal } from "./src/capabilities/terminal.js";
export { DeviceFs } from "./src/capabilities/deviceFs.js";
export { FileSystem } from "./src/capabilities/fileSystem.js";
export { Init } from "./src/capabilities/init.js";
export { MachineJournal } from "./src/capabilities/machineJournal.js";
export { MachineJail } from "./src/capabilities/machineJail.js";
export { bootSession, openMachine, Session } from "./src/capabilities/session.js";
export { WheelCache } from "./src/capabilities/wheelCache.js";
export { bootEnv, runScript } from "./src/capabilities/envManager.js";
export { GpuCompute, GpuArray, GpuBridge } from "./src/capabilities/gpuCompute.js";
export { BrowserControl, routeBrowserWorker, installBrowserWorker } from "./src/capabilities/browserControl.js";
export { PyProc, SIGNAL } from "./src/processOs/pyProc.js";
export { MachineContainer } from "./src/processOs/machineContainer.js";
export { JobControl } from "./src/processOs/jobControl.js";
export { KernelElection } from "./src/processOs/kernelElection.js";
export { SharedKernel } from "./src/processOs/sharedKernel.js";
export { bootWasi, WasiSession } from "./src/runtime/engines/wasi/wasiSession.js";
