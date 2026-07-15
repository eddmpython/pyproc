// runtimeBindings.js - Runtime public capability factory registry.
// capability 목록은 capabilities 레이어가 담당하고, runtimeApi.js는 이 registry만 설치한다.
import { ReactiveController } from "./reactive.js";
import { SyscallBridge } from "./syscallBridge.js";
import { SocketBridge } from "./socketBridge.js";
import { AsgiServer } from "./asgiServer.js";
import { WheelCache } from "./wheelCache.js";
import { Terminal } from "./terminal.js";
import { DeviceFs } from "./deviceFs.js";
import { Init } from "./init.js";
import { MachineJournal } from "./machineJournal.js";
import { GpuBridge } from "./gpuCompute.js";

const RUNTIME_CAPABILITY_BINDINGS = Symbol.for("pyproc.runtimeCapabilityBindings");

export function installRuntimeCapabilityBindings(RuntimeClass) {
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
