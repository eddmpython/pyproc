// runtimeBindings.js - Layer 2 조립: Runtime public capability factory registry.
// 능력 8개를 아는 유일한 파일이다. core Runtime(Layer 0)도 능력들(Layer 1)도 서로를 모르고,
// 둘을 엮는 지식은 여기에만 산다. runtimeApi.js가 이 registry를 설치한다.
import { ReactiveController } from "../capabilities/reactive.js";
import { SyscallBridge } from "../capabilities/syscallBridge.js";
import { AsgiServer } from "../capabilities/asgiServer.js";
import { VirtualOrigin } from "../capabilities/virtualOrigin.js";
import { WheelCache } from "../capabilities/wheelCache.js";
import { Terminal } from "../capabilities/terminal.js";
import { DeviceFs } from "../capabilities/deviceFs.js";
import { Init } from "../capabilities/init.js";
import { MachineJournal } from "../capabilities/machineJournal.js";

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
    // 파이썬 서버를 진짜 URL로: 설치 완료된 AsgiServer를 받아 SW 위임에 응답한다.
    // asgi 인자를 생략하면 여기서 enableAsgiServer(cfg)로 만든다(install은 소비자 몫).
    enableVirtualOrigin: { value(asgi, cfg = {}) { return new VirtualOrigin(asgi || this.enableAsgiServer(cfg)); } },
    enableTerminal: { value(cfg = {}) { return new Terminal(this, cfg); } },
    enableWheelCache: { value(cfg = {}) { return new WheelCache(this, cfg); } },
    enableDeviceFs: { value(cfg = {}) { return new DeviceFs(this, cfg); } },
    enableInit: { value(cfg = {}) { return new Init(this, cfg); } },
    enableJournal: { value(cfg = {}) { return new MachineJournal(this, cfg); } },
  });
  return RuntimeClass;
}
