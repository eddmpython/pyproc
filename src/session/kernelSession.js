// kernelSession.js - Layer 4: loader-neutral session lifecycle over KernelFactory.
import { PyProcError } from "../runtime/errors.js";
import { decodeValueEnvelope } from "../runtime/kernel/valueEnvelope.js";

export class KernelSession {
  #factory;
  #kernel;
  #closed = false;

  constructor(factory, kernel) {
    if (!factory || typeof factory.open !== "function" || !kernel || typeof kernel.execute !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "KernelSession requires a KernelFactory and v2 kernel");
    }
    this.#factory = factory;
    this.#kernel = kernel;
  }

  static async open(factory, manifest, options = {}) {
    return new KernelSession(factory, await factory.open(manifest, options));
  }

  get kernel() { return this.#kernel; }
  get factory() { return this.#factory; }

  async run(code, options = {}) {
    if (this.#closed) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "KernelSession is closed");
    const result = await this.#kernel.execute({ ...options, code });
    if (result.state !== "completed") {
      throw new PyProcError("PYPROC_KERNEL_EXECUTION_ERROR", result.error?.message || "Kernel execution failed", {
        context: { kernelError: result.error || null },
      });
    }
    return Object.freeze({ ...result,
      output: result.stdout.map((entry) => entry.text).join("\n") });
  }

  async get(name) {
    return decodeValueEnvelope((await this.#kernel.getValue({ name })).value);
  }

  set(name, value) { return this.#kernel.setValue({ name, value }); }

  checkpoint(request = {}) { return this.#factory.checkpoint(this.#kernel, request); }

  restore(checkpoint) {
    const checkpointRef = typeof checkpoint === "string" ? checkpoint : checkpoint?.checkpointRef;
    if (!checkpointRef) throw new PyProcError("PYPROC_INPUT_INVALID", "KernelSession.restore requires a checkpoint");
    return this.#kernel.restore({ checkpointRef, ...(typeof checkpoint === "object" ? { checkpoint } : {}) });
  }

  async fork(options = {}) {
    const cloned = await this.#factory.clone(this.#kernel, options);
    return Object.freeze({ session: new KernelSession(this.#factory, cloned.kernel), checkpoint: cloned.checkpoint });
  }

  exportImage(options = {}) { return this.#factory.exportImage(this.#kernel, options); }

  describe() { return this.#kernel.describe(); }

  async close() {
    if (this.#closed) return Object.freeze({ state: "closed" });
    this.#closed = true;
    return this.#kernel.close();
  }
}
