// workerGuestAdapter.js - the campaign's candidate: a guest adapter whose session lives in a worker.
//
// The hypothesis this file tests is narrow and falsifiable: the 8-method adapter contract
// (boot/pause/resume/snapshot/restore/shutdown/request/inspect) is already async and message-shaped,
// so a proxy can satisfy it over a worker boundary and `WebMachineHost` needs no new branch.
//
// What it deliberately does NOT do yet, so the campaign record stays honest:
//  - snapshot/restore declare `snapshotScope: "none"`. Moving a heap image out of a worker is a real
//    piece of work (the payload has to cross postMessage), and claiming portable before proving it
//    would be the exact defect this project keeps finding in itself.
//  - devices are not bridged. That is graduation item 3 and needs `portBridgedDevice`.
// Both are named in the campaign README's graduation gate rather than papered over here.
import { createRpcPort } from "../../../src/runtime/rpcChannel.js";

export function createWorkerGuestFactory({ workerURL } = {}) {
  if (!workerURL) throw new TypeError("createWorkerGuestFactory: a workerURL is required");
  return () => new WorkerGuestAdapter({ workerURL });
}

class WorkerGuestAdapter {
  constructor({ workerURL }) {
    this._workerURL = workerURL;
    this.capabilities = {
      adapterVersion: "worker-guest-probe-v1",
      // Honest for now: this adapter cannot yet move an image out of the worker, so it must not
      // claim a scope the host would then trust.
      snapshotScope: "none",
      pauseMode: "cooperative",
      shutdownMode: "release",
      requiredDevices: [{ name: "console", kind: "console" }],
    };
    this._worker = null;
    this._port = null;
    this._context = null;
  }

  async boot(context, manifest) {
    this._context = context;
    this._worker = new Worker(this._workerURL, { type: "module" });
    this._port = createRpcPort(this._worker, { label: "workerGuest" });
    await this._port.call({ type: "boot", manifest: manifest.session || {} });
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
    throw new Error("workerGuest: snapshot is not implemented yet (graduation item 4)");
  }

  async restore() {
    throw new Error("workerGuest: restore is not implemented yet (graduation item 4)");
  }

  async shutdown() {
    if (this._port) {
      try { await this._port.call({ type: "shutdown" }); } catch (error) { /* the worker may already be gone */ }
    }
    this._worker?.terminate();
    this._worker = null;
    this._port = null;
    this._context?.devices.console?.write?.("workerGuest:shutdown");
  }

  async request(message) {
    if (!this._port) throw new Error("workerGuest: not booted");
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
    throw new Error(`workerGuest: unsupported request ${message.type}`);
  }

  inspect() {
    return {
      engine: "pyodide",
      hosted: "worker",
      ready: !!this._port,
      snapshotScope: this.capabilities.snapshotScope,
    };
  }
}
