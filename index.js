// pyproc - 브라우저 파이썬 프로세스 OS.
// 서버 없이 브라우저 탭에서 도는 진짜 런타임 파이썬(프로세스·병렬·복원 리액티브).
// codaro / dartlab / xlpod 공통 런타임의 SSOT.
//
// 표면 정본: index.d.ts(시그니처)와 docs/consuming/capabilityMatrix.md(상태/증거/경계),
// docs/reference/api.md(영문 레퍼런스). 여기 목록을 두지 않는 이유: 손 유지 목록은
// 실물과 표류한다(2026-07-16 실측: 8개 어긋난 채 방치).
//
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated). Firefox/Safari 미지원.
export { boot, Runtime, MemoryCapability, PAGE_SIZE, checkEnvironment } from "./src/runtime/runtimeApi.js";
export { PyProcError, PYPROC_ERROR_CODES } from "./src/runtime/errors.js";
export { getPyProcAssetManifest, verifyPyProcAssetIntegrity, registerPyProcServiceWorker, PYPROC_ASSET_MANIFEST_VERSION } from "./src/runtime/assets.js";
export { ReactiveController } from "./src/capabilities/reactive.js";
export { SyscallBridge } from "./src/capabilities/syscallBridge.js";
export { AsgiServer } from "./src/capabilities/asgiServer.js";
export { VirtualOrigin } from "./src/capabilities/virtualOrigin.js";
export { Terminal } from "./src/capabilities/terminal.js";
export { DeviceFs } from "./src/capabilities/deviceFs.js";
export { FileSystem } from "./src/runtime/fileSystem.js";
export { Init } from "./src/capabilities/init.js";
export { MachineJournal } from "./src/capabilities/machineJournal.js";
export { MachineJail } from "./src/capabilities/machineJail.js";
export { bootSession, openMachine, createMachineKeyPair, exportMachinePublicKey, fingerprintMachinePublicKey, Session } from "./src/capabilities/session.js";
export { WheelCache } from "./src/capabilities/wheelCache.js";
export { bootEnv, runScript } from "./src/capabilities/envManager.js";
export { PyProc, SIGNAL } from "./src/processOs/pyProc.js";
export { MachineContainer } from "./src/processOs/machineContainer.js";
export { JobControl } from "./src/processOs/jobControl.js";
export { KernelElection, openPersistentMachine } from "./src/processOs/kernelElection.js";
