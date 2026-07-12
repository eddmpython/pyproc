// pyproc - 브라우저 파이썬 프로세스 OS.
// 서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬(프로세스·병렬·복원 리액티브).
// codaro / dartlab / xlpod 공통 런타임의 SSOT.
//
// 공개 표면:
//   boot()               - Pyodide 런타임 부팅 -> Runtime
//   bootEnv()            - uv 레인: 환경 선언 + 캐시 디렉터리 -> 웜 부팅(스냅샷+휠, 실측 3.61배)
//   runScript()          - 브라우저판 uv run: PEP 723 인라인 의존성 자동 설치 + 실행
//   Runtime              - run/install/loadPackages/freeze + 능력 등록(enableReactive/enableSyscallBridge/enableAsgiServer/enableTerminal/enableWheelCache)
//   MemoryCapability     - WASM 힙 접근을 캡슐화한 능력 계약
//   ReactiveController   - 복원 기반 리액티브(체크포인트/시간여행/OPFS 영속)
//   SyscallBridge        - socket/subprocess/input을 빌려주는 능력 계약
//   AsgiServer           - 커널 안 ASGI 서버(FastAPI/Starlette를 소켓 0으로 dispatch)
//   VirtualOrigin        - 파이썬 서버를 진짜 URL로(pyprocSw.js와 짝, fetch -> ASGI 3.4ms)
//   Terminal             - 서버리스 파이썬 REPL(code.InteractiveConsole, %pip/%undo)
//   DeviceFs             - 모든 것은 파일: 브라우저 능력을 파이썬 open()으로(/dev, /proc)
//   Init                 - OS의 init: /home/web/boot.py 오토스타트 + cron.py 주기 틱
//   MachineJournal       - WAL: 유휴마다 상태를 디스크에 남겨 강제종료에도 부활(hibernate 훅 불필요)
//   PyProc               - 프로세스 OS 커널(스냅샷-fork spawn + Pool.map 병렬 + kill/signal/respawn + fork(2))
//   SIGNAL               - 시그널 번호(INT/TERM/USR1/USR2). PyProc.signal(pid, signum)
//   SharedKernel         - 탭 밖에서 사는 공유 커널(SharedWorker, 여러 탭 = 한 파이썬 상태)
//
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated). Firefox/Safari 미지원.
export { boot, Runtime, MemoryCapability, PAGE_SIZE } from "./src/runtime/runtime.js";
export { ReactiveController } from "./src/capabilities/reactive.js";
export { SyscallBridge } from "./src/capabilities/syscallBridge.js";
export { AsgiServer } from "./src/capabilities/asgiServer.js";
export { VirtualOrigin } from "./src/capabilities/virtualOrigin.js";
export { Terminal } from "./src/capabilities/terminal.js";
export { DeviceFs } from "./src/capabilities/deviceFs.js";
export { Init } from "./src/capabilities/init.js";
export { MachineJournal } from "./src/capabilities/machineJournal.js";
export { bootSession, openMachine, Session } from "./src/capabilities/session.js";
export { WheelCache } from "./src/capabilities/wheelCache.js";
export { bootEnv, runScript } from "./src/capabilities/envManager.js";
export { PyProc, SIGNAL } from "./src/processOs/pyProc.js";
export { SharedKernel } from "./src/processOs/sharedKernel.js";
