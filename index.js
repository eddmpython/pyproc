// pyproc - 브라우저 파이썬 프로세스 OS.
// 서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬(프로세스·병렬·복원 리액티브).
// codaro / dartlab / xlpod 공통 런타임의 SSOT.
//
// 공개 표면:
//   boot()               - Pyodide 런타임 부팅 -> Runtime
//   Runtime              - run/install/loadPackages + 능력 등록(enableReactive/enableSyscallBridge)
//   MemoryCapability     - WASM 힙 접근을 캡슐화한 능력 계약
//   ReactiveController   - 복원 기반 리액티브(체크포인트/시간여행)
//   SyscallBridge        - socket/subprocess/input을 빌려주는 능력 계약
//   PyProc               - 프로세스 OS 커널(스냅샷-fork spawn + Pool.map 병렬)
//
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated). Firefox/Safari 미지원.
export { boot, Runtime, MemoryCapability, PAGE_SIZE } from "./src/runtime/runtime.js";
export { ReactiveController } from "./src/capabilities/reactive.js";
export { SyscallBridge } from "./src/capabilities/syscallBridge.js";
export { AsgiServer } from "./src/capabilities/asgiServer.js";
export { PyProc } from "./src/processOs/pyProc.js";
