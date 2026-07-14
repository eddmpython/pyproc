// runtimeApi.js - public Runtime 표면: core Runtime에 opt-in capability factory를 배선한다.
// runtime.js는 엔진 core만 소유하고, 이 파일이 public subpath(`pyproc/runtime`)의 능력 등록 경계다.
import { boot, Runtime, DEFAULT_INDEX, ensureEngineScript } from "./runtime.js";
import { MemoryCapability, PAGE_SIZE } from "./memoryCapability.js";
import { FileSystem } from "./fileSystem.js";
import { ReactiveController } from "../capabilities/reactive.js";
import { SyscallBridge } from "../capabilities/syscallBridge.js";
import { SocketBridge } from "../capabilities/socketBridge.js";
import { AsgiServer } from "../capabilities/asgiServer.js";
import { WheelCache } from "../capabilities/wheelCache.js";
import { Terminal } from "../capabilities/terminal.js";
import { DeviceFs } from "../capabilities/deviceFs.js";
import { Init } from "../capabilities/init.js";
import { MachineJournal } from "../capabilities/machineJournal.js";
import { GpuBridge } from "../capabilities/gpuCompute.js";

const RUNTIME_CAPABILITY_BINDINGS = Symbol.for("pyproc.runtimeCapabilityBindings");

export function installRuntimeCapabilities(RuntimeClass = Runtime) {
  const proto = RuntimeClass.prototype;
  if (proto[RUNTIME_CAPABILITY_BINDINGS]) return RuntimeClass;
  Object.defineProperties(proto, {
    [RUNTIME_CAPABILITY_BINDINGS]: { value: true },
    enableReactive: { value() { return new ReactiveController(this); } },
    enableSyscallBridge: { value(cfg = {}) { return new SyscallBridge(this, { ...cfg, assetIntegrity: cfg.assetIntegrity || this.assetIntegrity }); } },
    enableSocketBridge: { value(cfg = {}) { return new SocketBridge(this, cfg); } },
    enableAsgiServer: { value(cfg = {}) { return new AsgiServer(this, cfg); } },
    enableTerminal: { value(cfg = {}) { return new Terminal(this, cfg); } },
    enableWheelCache: { value(cfg = {}) { return new WheelCache(this, cfg); } },
    enableDeviceFs: { value(cfg = {}) { return new DeviceFs(this, cfg); } },
    enableInit: { value(cfg = {}) { return new Init(this, cfg); } },
    enableJournal: { value(cfg = {}) { return new MachineJournal(this, cfg); } },
    // Python numpy -> GPU 직결(install()로 pyprocGpu 모듈 배선). 실 GPU + 창 모드 + numpy 필요.
    enableGpu: { value(cfg = {}) { return new GpuBridge(this); } },
  });
  return RuntimeClass;
}

installRuntimeCapabilities();

export { boot, Runtime, DEFAULT_INDEX, ensureEngineScript, MemoryCapability, PAGE_SIZE, FileSystem };
export { checkEnvironment } from "./preflight.js";
