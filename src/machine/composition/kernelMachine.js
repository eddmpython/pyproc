// kernelMachine.js - Layer 5/composition: session, process, and portable Machine image over KernelFactory.
import { KernelFactory } from "../../composition/kernelFactory.js";
import { KernelTerminal } from "../../capabilities/kernelTerminal.js";
import { PackageEnvironment } from "../../capabilities/packageEnvironment.js";
import { getDefaultKernelEngineManifest } from "../../runtime/engines/wasi/ownedEngineDistribution.js";
import { KernelSession } from "../../session/kernelSession.js";
import { KernelProcessManager } from "../../processOs/kernelProcess.js";
import { OwnedWasmToolLayer } from "../../runtime/tools/ownedWasmToolLayer.js";
import { MachineToolHostBridge } from "./machineToolHostBridge.js";

const defaultKernelFactory = new KernelFactory();

export class KernelMachine {
  #session;
  #processes;
  #toolLayer;
  #toolBridge;
  #kernelRef;

  constructor(session, options = {}) {
    this.#session = session;
    this.#kernelRef = session.kernel.kernelRef;
    this.#toolLayer = new OwnedWasmToolLayer({ assetIntegrity: options.assetIntegrity,
      fetchImpl: options.fetchImpl, kernelVfs: session.kernel.vfs });
    this.#toolBridge = options.machineToolHostBridge || null;
    this.#toolBridge?.attach(this.#kernelRef, this.#toolLayer);
    this.#processes = new KernelProcessManager(session.factory, { openSession: KernelSession.open,
      onSessionOpen: (child) => this.#toolBridge?.attach(child.kernel.kernelRef, this.#toolLayer),
      onSessionClose: (child) => this.#toolBridge?.detach(child.kernel.kernelRef) });
    const run = (code, options) => this.#session.run(code, options);
    run.python = run;
    run.get = (name) => this.#session.get(name);
    run.set = (name, value) => this.#session.set(name, value);
    this.run = Object.freeze(run);
    this.history = Object.freeze({ checkpoint: (request) => this.#session.checkpoint(request),
      restore: (checkpoint) => this.#session.restore(checkpoint),
      export: (options) => this.#session.exportImage(options) });
    this.proc = Object.freeze({ spawn: (manifest, options) => this.#processes.spawn(manifest, options),
      clone: (options = {}) => this.#processes.spawn(this.manifest, { ...options, cloneFrom: this.#session }),
      inspect: () => this.#processes.inspect() });
    this.tools = Object.freeze({ run: (command, args, options) => this.#toolLayer.run(command, args, options),
      inspect: () => this.#toolLayer.inspect() });
  }

  get kernel() { return this.#session.kernel; }
  get manifest() { return this.#session.factory.manifestFor(this.#session.kernel); }

  createPackageEnvironment(options = {}) {
    return new PackageEnvironment({ ...options, kernel: this.#session.kernel });
  }

  terminal(options = {}) {
    return new KernelTerminal(this.#session.kernel, {
      ...options,
      checkpoint: (request) => this.#session.checkpoint(request),
    });
  }

  async inspect() {
    return Object.freeze({ protocol: "pyproc.kernel-machine-inspection", version: 1,
      kernel: await this.#session.describe(), processes: this.#processes.inspect(),
      tools: this.#toolLayer.inspect(), engineManifestDigest: this.manifest.digest });
  }

  async close() {
    this.#toolLayer.close();
    let processFailure = null;
    let receipt;
    try {
      try { await this.#processes.close(); }
      catch (error) { processFailure = error; }
      receipt = await this.#session.close();
    } finally {
      this.#toolBridge?.detach(this.#kernelRef);
      this.#toolBridge?.close();
    }
    if (processFailure) throw processFailure;
    return receipt;
  }
}

export async function bootKernelMachine(factory, manifest, options = {}) {
  const bridge = options.hostBroker instanceof MachineToolHostBridge
    ? options.hostBroker : new MachineToolHostBridge(options.hostBroker || null);
  try {
    const session = await KernelSession.open(factory, manifest, { ...options, hostBroker: bridge });
    return new KernelMachine(session, { ...options, machineToolHostBridge: bridge });
  } catch (error) {
    bridge.close("Machine boot failed");
    throw error;
  }
}

export async function openKernelMachineImage(factory, image, options = {}) {
  const bridge = options.hostBroker instanceof MachineToolHostBridge
    ? options.hostBroker : new MachineToolHostBridge(options.hostBroker || null);
  try {
    const session = new KernelSession(factory, await factory.openImage(image, { ...options, hostBroker: bridge }));
    return new KernelMachine(session, { ...options, machineToolHostBridge: bridge });
  } catch (error) {
    bridge.close("Machine image open failed");
    throw error;
  }
}

export async function bootDefaultKernelMachine(options = {}) {
  const manifest = options.engineManifest || await getDefaultKernelEngineManifest();
  const factory = options.kernelFactory || (options.assetStore || options.checkpointStore || options.fetchImpl
    ? new KernelFactory({ assetStore: options.assetStore, checkpointStore: options.checkpointStore,
      fetchImpl: options.fetchImpl })
    : defaultKernelFactory);
  return bootKernelMachine(factory, manifest, {
    deterministic: options.deterministic === true,
    kernelRef: options.kernelRef,
    hostBroker: options.hostBroker,
    assetIntegrity: options.assetIntegrity,
    fetchImpl: options.fetchImpl,
    checkpointCoordinator: options.checkpointCoordinator,
    kernelVfs: options.kernelVfs,
  });
}

export async function openDefaultKernelMachineImage(image, options = {}) {
  const factory = options.kernelFactory || defaultKernelFactory;
  return openKernelMachineImage(factory, image, options);
}
