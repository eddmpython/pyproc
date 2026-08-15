// kernelCommandQueue.js - Layer 0: serialized kernel command admission and fencing.
import { PyProcError } from "../errors.js";

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return Object.freeze({ promise, resolve: resolvePromise, reject: rejectPromise });
}

export class KernelCommandQueue {
  constructor({ kernelRef, generation = 0, onState = () => {} } = {}) {
    this.kernelRef = kernelRef;
    this.generation = generation;
    this.onState = onState;
    this.entries = new Map();
    this.pending = [];
    this.active = null;
    this.terminalError = null;
  }

  submit(command, handler) {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (command.kernelRef !== this.kernelRef || command.generation !== this.generation) {
      return Promise.reject(new PyProcError("PYPROC_STATE_FENCE_STALE", "Kernel command generation is stale", {
        context: { expectedGeneration: this.generation, actualGeneration: command.generation },
      }));
    }
    const previous = this.entries.get(command.commandId);
    if (previous) {
      if (previous.command.inputDigest !== command.inputDigest || previous.command.operation !== command.operation) {
        return Promise.reject(new PyProcError("PYPROC_INPUT_INVALID", "Kernel commandId was reused with different canonical input", {
          context: { commandId: command.commandId, kernelCode: "KERNEL_COMMAND_CONFLICT" },
        }));
      }
      return previous.deferred.promise;
    }
    const entry = { command, handler, deferred: deferred(), state: "queued" };
    this.entries.set(command.commandId, entry);
    this.pending.push(entry);
    queueMicrotask(() => this.pump());
    return entry.deferred.promise;
  }

  async pump() {
    if (this.active || this.terminalError) return;
    const entry = this.pending.shift();
    if (!entry) { this.onState("ready"); return; }
    this.active = entry;
    entry.state = "executing";
    this.onState("executing");
    try {
      if (entry.command.deadlineAt !== undefined && Date.now() >= entry.command.deadlineAt) {
        throw new PyProcError("PYPROC_TASK_TIMEOUT", "Kernel command deadline elapsed before execution");
      }
      const receipt = await entry.handler(entry.command);
      entry.state = "completed";
      entry.deferred.resolve(Object.freeze(receipt));
    } catch (error) {
      entry.state = "failed";
      entry.deferred.reject(error);
    } finally {
      this.active = null;
      queueMicrotask(() => this.pump());
    }
  }

  cancel(commandId) {
    const entry = this.entries.get(commandId);
    if (!entry) return Object.freeze({ found: false, state: "unknown" });
    if (entry.state === "queued") {
      this.pending = this.pending.filter((candidate) => candidate !== entry);
      entry.state = "cancelled";
      entry.deferred.reject(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Kernel command was cancelled before execution", {
        context: { commandId, kernelCode: "KERNEL_CANCELLED" },
      }));
    }
    return Object.freeze({ found: true, state: entry.state });
  }

  advanceGeneration(generation) {
    if (!Number.isSafeInteger(generation) || generation <= this.generation || this.active) {
      throw new PyProcError("PYPROC_INTERNAL", "Kernel generation can advance only at an idle forward boundary");
    }
    const stale = new PyProcError("PYPROC_STATE_FENCE_STALE", "Queued kernel command belongs to the restored generation", {
      context: { expectedGeneration: generation },
    });
    for (const entry of this.pending) {
      entry.state = "failed";
      entry.deferred.reject(stale);
    }
    this.pending = [];
    this.generation = generation;
  }

  terminate(error, { preserveActive = false } = {}) {
    if (this.terminalError) return;
    this.terminalError = error instanceof PyProcError ? error : new PyProcError(
      "PYPROC_WORKER_CRASHED", `Kernel queue terminated: ${String(error)}`, { cause: error });
    if (this.active && !preserveActive) this.active.deferred.reject(this.terminalError);
    for (const entry of this.pending) {
      entry.state = "terminated";
      entry.deferred.reject(this.terminalError);
    }
    this.pending = [];
    this.onState("terminated");
  }
}
