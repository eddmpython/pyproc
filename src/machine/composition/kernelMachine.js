// kernelMachine.js - Layer 5/composition: session, process, and portable Machine image over KernelFactory.
import { KernelFactory } from "../../composition/kernelFactory.js";
import { KernelTerminal } from "../../capabilities/kernelTerminal.js";
import { PackageEnvironment } from "../../capabilities/packageEnvironment.js";
import { getDefaultKernelEngineManifest } from "../../runtime/engines/wasi/ownedEngineDistribution.js";
import { KernelSession } from "../../session/kernelSession.js";
import { KernelProcessManager } from "../../processOs/kernelProcess.js";

const defaultKernelFactory = new KernelFactory();

export class KernelMachine {
  #session;
  #processes;

  constructor(session) {
    this.#session = session;
    this.#processes = new KernelProcessManager(session.factory, { openSession: KernelSession.open });
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
      engineManifestDigest: this.manifest.digest });
  }

  async close() {
    await this.#processes.close();
    return this.#session.close();
  }
}

export async function bootKernelMachine(factory, manifest, options = {}) {
  return new KernelMachine(await KernelSession.open(factory, manifest, options));
}

export async function openKernelMachineImage(factory, image, options = {}) {
  return new KernelMachine(new KernelSession(factory, await factory.openImage(image, options)));
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
    checkpointCoordinator: options.checkpointCoordinator,
    kernelVfs: options.kernelVfs,
  });
}

export async function openDefaultKernelMachineImage(image, options = {}) {
  const factory = options.kernelFactory || defaultKernelFactory;
  return openKernelMachineImage(factory, image, options);
}
