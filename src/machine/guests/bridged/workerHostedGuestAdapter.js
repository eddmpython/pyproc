// workerHostedGuestAdapter.js - Layer 5/guests: 세션이 워커에 사는 guest 어댑터.
//
// The hypothesis this file tests is narrow and falsifiable: the 8-method adapter contract
// (boot/pause/resume/snapshot/restore/shutdown/request/inspect) is already async and message-shaped,
// so a proxy can satisfy it over a worker boundary and `WebMachineHost` needs no new branch.
//
// The two capabilities that were honestly withheld in the first candidate are now carried, and each
// is carried by a mechanism rather than a claim:
//  - **snapshotScope: "portable"**, because the worker exports a real signed image through the same
//    `exportImage` the in-process adapter uses, and `restore` revives it in a *fresh worker*. The
//    qualification the campaign measured stays true and is stated in the README: cp0 is decided by
//    the host context, so an image made in a worker revives in a worker. This adapter only ever
//    revives into a worker, so the scope it declares is the scope it delivers.
//  - **a bridged packet device**, so the guest reaches the shared switch that cannot leave the host
//    thread. What survives the crossing and what changes shape is in portBridgedDevice.js.
import { indexRequirements, resolveRequiredDevice } from "../../contracts/deviceRequirement.js";
import { WebMachineError } from "../../contracts/webMachineError.js";
import { serveBridgedDevice } from "./portBridgedDevice.js";

// createPort는 주입이다. guest는 순수 계약만 소비하고 machine 밖(runtime의 rpcChannel)은 조립
// 지점만 만질 수 있다는 층 법의 결과이며, 출하 pyproc 어댑터가 bootSession/openMachine을 받는
// 것과 같은 형태다. workerURL도 주입인 이유는 같다: 자산 위치는 조립이 안다.
export function createWorkerHostedGuestFactory({ createPort, workerURL, networkDeviceName = null } = {}) {
  if (typeof createPort !== "function") throw new TypeError("a createPort function is required");
  if (!workerURL) throw new TypeError("a workerURL is required");
  return () => new WorkerHostedGuestAdapter({ createPort, workerURL, networkDeviceName });
}

class WorkerHostedGuestAdapter {
  constructor({ createPort, workerURL, networkDeviceName }) {
    this._createPort = createPort;
    this._workerURL = workerURL;
    this._networkDeviceName = networkDeviceName ? String(networkDeviceName) : null;
    // The declaration is the single truth about what this guest needs, exactly as the in-process
    // adapter has it: the host reads `requiredDevices` for its allowlist, and the adapter resolves
    // devices only through that declaration. A bridge does not earn an exemption from that law.
    this.capabilities = {
      adapterVersion: this._networkDeviceName ? "worker-hosted-net-v1" : "worker-hosted-v1",
      snapshotScope: "portable",
      pauseMode: "cooperative",
      shutdownMode: "release",
      requiredDevices: [
        { name: "console", kind: "console" },
        ...(this._networkDeviceName
          ? [{ name: this._networkDeviceName, kind: "network", mode: "packet", methods: ["connect"] }]
          : []),
      ],
    };
    this._requirementByName = indexRequirements(this.capabilities.requiredDevices);
    this._worker = null;
    this._port = null;
    this._context = null;
    this._deviceServer = null;
    this._manifest = null;
  }

  async boot(context, manifest) {
    this._context = context;
    this._manifest = manifest;
    await this._spawn(context, { type: "boot", manifest: manifest.session || {} });
    context.devices.console?.write?.(`workerGuest:boot:${context.machineId}`);
  }

  async pause() {
    // Cooperative, exactly as the in-process adapter is: the command queue stops accepting new
    // requests. What a worker adds is that the guest's own execution no longer blocks the host -
    // which is the whole point of the campaign, and is measured rather than asserted here.
    this._context?.devices.console?.write?.("workerGuest:pause");
  }

  async resume() {
    this._context?.devices.console?.write?.("workerGuest:resume");
  }

  async snapshot() {
    if (!this._port) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "workerHostedGuest: not booted");
    const reply = await this._port.call({ type: "snapshot" });
    return reply.bytes;
  }

  // A restore replaces the worker rather than reusing it. That is the honest shape: the image was
  // taken at a boundary, and a fresh worker is a fresh process image - which is precisely what
  // graduation item 4 asks the adapter to prove instead of assert.
  async restore(payload, context, manifest) {
    this._context = context;
    this._manifest = manifest || this._manifest;
    await this._teardown();
    await this._spawn(context, {
      type: "restore",
      bytes: payload instanceof Uint8Array ? payload : new Uint8Array(payload),
      indexURL: (this._manifest?.session || {}).indexURL,
    });
    context.devices.console?.write?.(`workerGuest:restore:${context.machineId}`);
  }

  async shutdown() {
    if (this._port) {
      try { await this._port.call({ type: "shutdown" }); } catch (error) { /* the worker may already be gone */ }
    }
    await this._teardown();
    this._context?.devices.console?.write?.("workerGuest:shutdown");
  }

  async request(message) {
    if (!this._port) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "workerHostedGuest: not booted");
    if (message.type === "run") {
      const reply = await this._port.call({ type: "run", code: String(message.code || "") });
      return reply.value;
    }
    if (message.type === "checkpoint") {
      const reply = await this._port.call({ type: "checkpoint" });
      return { index: reply.index, changedPages: reply.changedPages };
    }
    if (message.type === "historyDepth") {
      const reply = await this._port.call({ type: "historyDepth" });
      return { depth: reply.depth, live: reply.live };
    }
    if (message.type === "netInspect") {
      const reply = await this._port.call({ type: "netInspect" });
      return reply.stats;
    }
    throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `workerHostedGuest: unsupported request ${message.type}`);
  }

  inspect() {
    return {
      engine: "pyodide",
      hosted: "worker",
      ready: !!this._port,
      snapshotScope: this.capabilities.snapshotScope,
      networkBridged: !!this._deviceServer,
    };
  }

  // One place spawns a worker, wires its device channel, and sends the first message, because boot
  // and restore differ only in that message. Two copies of this wiring would drift.
  async _spawn(context, first) {
    this._worker = new Worker(this._workerURL, { type: "module" });
    this._port = this._createPort(this._worker, { label: "workerHostedGuest" });
    const transfer = [];
    if (this._networkDeviceName) {
      const device = resolveRequiredDevice(context.devices, this._requirementByName.get(this._networkDeviceName), "workerGuest adapter");
      const channel = new MessageChannel();
      this._deviceServer = serveBridgedDevice({ port: channel.port1, device, label: context.machineId });
      first.endpointId = `${context.machineId}:${this._networkDeviceName}`;
      // Addresses are the machine's declaration, not the adapter's invention: two guests on one
      // switch need distinct ones, and the manifest is where a machine says who it is.
      first.network = this._manifest?.network || null;
      transfer.push(channel.port2);
    }
    // The image payload is copied, not transferred: the host owns those bytes (they are its stored
    // machine image) and detaching its buffer would destroy the copy it keeps.
    await this._port.call(first, transfer);
  }

  async _teardown() {
    this._deviceServer?.stop();
    this._deviceServer = null;
    this._worker?.terminate();
    this._worker = null;
    this._port = null;
  }
}
