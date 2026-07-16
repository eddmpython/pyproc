// runtimeBindings.js - Runtime public capability factory registry.
// capability 목록은 capabilities 레이어가 담당하고, runtimeApi.js는 이 registry만 설치한다.
import { ReactiveController } from "./reactive.js";
import { SyscallBridge } from "./syscallBridge.js";
import { AsgiServer } from "./asgiServer.js";
import { WheelCache } from "./wheelCache.js";
import { Terminal } from "./terminal.js";
import { DeviceFs } from "./deviceFs.js";
import { Init } from "./init.js";
import { MachineJournal } from "./machineJournal.js";

const RUNTIME_CAPABILITY_BINDINGS = Symbol.for("pyproc.runtimeCapabilityBindings");
const REACTIVE_CONTROLLER = Symbol.for("pyproc.reactiveController");

export function installRuntimeCapabilityBindings(RuntimeClass) {
  const proto = RuntimeClass.prototype;
  if (proto[RUNTIME_CAPABILITY_BINDINGS]) return RuntimeClass;
  Object.defineProperties(proto, {
    [RUNTIME_CAPABILITY_BINDINGS]: { value: true },
    // 런타임당 컨트롤러 1개(memoize). 컨트롤러가 둘이면 한쪽의 복원이 다른 쪽 경계 가드에
    // 보이지 않아 낡은 해시로 힙을 조용히 오염시킨다(soundness 수리, 2026-07-16).
    enableReactive: { value() { return (this[REACTIVE_CONTROLLER] ||= new ReactiveController(this)); } },
    enableSyscallBridge: { value(cfg = {}) { return new SyscallBridge(this, { ...cfg, assetIntegrity: cfg.assetIntegrity || this.assetIntegrity }); } },
    enableAsgiServer: { value(cfg = {}) { return new AsgiServer(this, cfg); } },
    enableTerminal: { value(cfg = {}) { return new Terminal(this, cfg); } },
    enableWheelCache: { value(cfg = {}) { return new WheelCache(this, cfg); } },
    enableDeviceFs: { value(cfg = {}) { return new DeviceFs(this, cfg); } },
    enableInit: { value(cfg = {}) { return new Init(this, cfg); } },
    enableJournal: { value(cfg = {}) { return new MachineJournal(this, cfg); } },
  });
  return RuntimeClass;
}
