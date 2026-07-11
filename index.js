// pyproc - 브라우저 파이썬 프로세스 OS.
// 서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬(프로세스·병렬·복원 리액티브).
// codaro / dartlab / xlpod 공통 런타임의 SSOT.
//
// 공개 표면:
//   boot()               - Pyodide 런타임 부팅 -> Runtime
//   Runtime              - run/install/loadPackages + 능력 등록(enableReactive/enableSyscallBridge/enableAsgiServer/enableTerminal)
//   MemoryCapability     - WASM 힙 접근을 캡슐화한 능력 계약
//   ReactiveController   - 복원 기반 리액티브(체크포인트/시간여행/OPFS 영속)
//   SyscallBridge        - socket/subprocess/input을 빌려주는 능력 계약
//   AsgiServer           - 커널 안 ASGI 서버(FastAPI/Starlette를 소켓 0으로 dispatch)
//   Terminal             - 서버리스 파이썬 REPL(code.InteractiveConsole)
//   PyProc               - 프로세스 OS 커널(스냅샷-fork spawn + Pool.map 병렬 + kill/interrupt/respawn)
//
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated). Firefox/Safari 미지원.
export { boot, Runtime, MemoryCapability, PAGE_SIZE } from "./src/runtime/runtime.js";
export { ReactiveController } from "./src/capabilities/reactive.js";
export { SyscallBridge } from "./src/capabilities/syscallBridge.js";
export { AsgiServer } from "./src/capabilities/asgiServer.js";
export { Terminal } from "./src/capabilities/terminal.js";
export { bootSession, Session } from "./src/capabilities/session.js";
export { PyProc } from "./src/processOs/pyProc.js";
