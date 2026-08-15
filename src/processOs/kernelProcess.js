// kernelProcess.js - Layer 4: process lifecycle composed only through KernelFactory.
import { PyProcError } from "../runtime/errors.js";

export class KernelProcess {
  #session;
  #state = "running";
  #result = null;
  #execution = null;
  #onClose;
  #closeNotified = false;

  constructor(pid, session, { onClose = null } = {}) {
    this.pid = pid;
    this.#session = session;
    this.#onClose = onClose;
  }

  get kernel() { return this.#session.kernel; }
  get session() { return this.#session; }
  get state() { return this.#state; }

  execute(code, options = {}) {
    if (this.#state !== "running") throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", `Process ${this.pid} is ${this.#state}`);
    if (this.#execution) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", `Process ${this.pid} already has an active command`);
    this.#execution = this.#session.run(code, options).then((result) => {
      this.#result = result;
      this.#state = "exited";
      return result;
    }, (error) => {
      this.#result = error;
      this.#state = "failed";
      throw error;
    });
    return this.#execution;
  }

  async wait() {
    if (this.#execution) {
      try { await this.#execution; }
      catch { /* terminal state and error are returned below */ }
    }
    return Object.freeze({ pid: this.pid, terminal: this.#state !== "running", state: this.#state,
      exitCode: this.#state === "exited" ? 0 : this.#state === "running" ? null : 1,
      result: this.#state === "exited" ? this.#result : null,
      error: this.#state === "failed" ? this.#result : null });
  }

  async signal(signal) {
    if (this.#state !== "running") return Object.freeze({ pid: this.pid, state: this.#state });
    if (signal === "interrupt") return this.kernel.interrupt({ reason: `process ${this.pid} interrupt` });
    if (signal !== "terminate") throw new PyProcError("PYPROC_INPUT_INVALID", `Unsupported process signal: ${signal}`);
    return this.close();
  }

  async close() {
    try { await this.#session.close(); }
    finally {
      if (!this.#closeNotified) {
        this.#closeNotified = true;
        await this.#onClose?.(this.#session);
      }
    }
    if (this.#state === "running") this.#state = "terminated";
    return Object.freeze({ pid: this.pid, state: this.#state });
  }
}

export class KernelProcessManager {
  #factory;
  #openSession;
  #processes = new Map();
  #counter = 0;
  #onSessionOpen;
  #onSessionClose;

  constructor(factory, { openSession, onSessionOpen = null, onSessionClose = null } = {}) {
    if (!factory || typeof factory.open !== "function" || typeof openSession !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "KernelProcessManager requires KernelFactory.open and an openSession composition port");
    }
    this.#factory = factory;
    this.#openSession = openSession;
    this.#onSessionOpen = onSessionOpen;
    this.#onSessionClose = onSessionClose;
  }

  async spawn(manifest, options = {}) {
    const pid = options.pid || `kp${++this.#counter}`;
    if (this.#processes.has(pid)) throw new PyProcError("PYPROC_INPUT_INVALID", `Process already exists: ${pid}`);
    let session;
    let checkpoint = null;
    if (options.cloneFrom) {
      const parent = options.cloneFrom instanceof KernelProcess ? options.cloneFrom.session : options.cloneFrom;
      if (!parent || typeof parent.fork !== "function") {
        throw new PyProcError("PYPROC_INPUT_INVALID", "cloneFrom must be a kernel session or process");
      }
      const cloned = await parent.fork({ kernelRef: `kernel:process:${pid}` });
      session = cloned.session;
      checkpoint = cloned.checkpoint;
    } else {
      session = await this.#openSession(this.#factory, manifest, { ...options, kernelRef: `kernel:process:${pid}` });
    }
    try { await this.#onSessionOpen?.(session); }
    catch (error) { await session.close(); throw error; }
    const process = new KernelProcess(pid, session, { onClose: this.#onSessionClose });
    this.#processes.set(pid, process);
    if (typeof options.code === "string") process.execute(options.code);
    return Object.freeze({ process, checkpoint });
  }

  get(pid) { return this.#processes.get(pid) || null; }

  async close() {
    await Promise.all([...this.#processes.values()].map((process) => process.close()));
    this.#processes.clear();
  }

  inspect() {
    return Object.freeze([...this.#processes.values()].map((process) => Object.freeze({
      pid: process.pid, state: process.state,
    })));
  }
}
