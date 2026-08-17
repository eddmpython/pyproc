// kernelTerminal.js - Layer 2: async CPython terminal with locked package commands.
import { PyProcError } from "../runtime/errors.js";
import { decodeValueEnvelope } from "../runtime/kernel/valueEnvelope.js";
import { parsePackageCommandLine } from "./packageCommands.js";

const KERNEL_TERMINAL_SETUP = `
import code as _pyprocTermCode
import contextlib as _pyprocTermContext
import io as _pyprocTermIo
_pyprocTermConsole = _pyprocTermCode.InteractiveConsole()
def _pyprocTermPush(line):
    output = _pyprocTermIo.StringIO()
    with _pyprocTermContext.redirect_stdout(output), _pyprocTermContext.redirect_stderr(output):
        more = _pyprocTermConsole.push(line)
    return {"more": bool(more), "out": output.getvalue()}
`;

export class KernelTerminal {
  #kernel;
  #packages;
  #timeTravel;
  #checkpoint;
  #marks = [];

  constructor(kernel, options = {}) {
    if (!kernel || typeof kernel.execute !== "function" || typeof kernel.setValue !== "function"
      || typeof kernel.getValue !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "KernelTerminal requires a v2 kernel");
    }
    this.#kernel = kernel;
    this.#packages = options.packageEnvironment || null;
    this.#timeTravel = options.timeTravel === true;
    this.#checkpoint = typeof options.checkpoint === "function"
      ? options.checkpoint
      : (request) => this.#kernel.checkpoint(request);
  }

  async install() {
    const setup = await this.#kernel.execute({ code: KERNEL_TERMINAL_SETUP });
    if (setup.state !== "completed") throw new PyProcError("PYPROC_KERNEL_EXECUTION_ERROR", setup.error?.message || "Terminal setup failed");
    if (this.#timeTravel) this.#marks.push((await this.#checkpoint()).checkpointRef);
    return Object.freeze({ repl: "code.InteractiveConsole", timeTravel: this.#timeTravel,
      packages: this.#packages ? "pyproc.package-environment" : null });
  }

  async push(line) {
    if (typeof line !== "string") throw new PyProcError("PYPROC_INPUT_INVALID", "KernelTerminal line must be a string");
    const packageRequirement = parsePackageCommandLine(line);
    if (packageRequirement) {
      if (!this.#packages) {
        return Object.freeze({ more: false, out: "pip: package environment is not configured\n" });
      }
      try {
        const receipt = await this.#packages.install({ requirements: [packageRequirement], extend: true });
        if (this.#timeTravel) {
          this.#marks = [(await this.#checkpoint()).checkpointRef];
        }
        return Object.freeze({ more: false, out: `environment: ${receipt.environmentId}\n` });
      } catch (error) {
        return Object.freeze({ more: false, out: `pip: ${error?.code || "PYPROC_INTERNAL"}: ${String(error?.message || error).slice(-160)}\n` });
      }
    }
    if (this.#timeTravel && line.trim() === "%undo") {
      if (this.#marks.length < 2) return Object.freeze({ more: false, out: "%undo: no prior complete input\n" });
      this.#marks.pop();
      await this.#kernel.restore({ checkpointRef: this.#marks[this.#marks.length - 1] });
      return Object.freeze({ more: false, out: "" });
    }
    await this.#kernel.setValue({ name: "_pyprocTermLine", value: line });
    const execution = await this.#kernel.execute({ code: "_pyprocTermResult = _pyprocTermPush(_pyprocTermLine)" });
    if (execution.state !== "completed") {
      return Object.freeze({ more: false, out: `${execution.error?.code || "PYPROC_KERNEL_EXECUTION_ERROR"}: ${execution.error?.message || "execution failed"}\n` });
    }
    const result = await decodeValueEnvelope((await this.#kernel.getValue({ name: "_pyprocTermResult" })).value);
    if (this.#timeTravel && !result.more) this.#marks.push((await this.#checkpoint()).checkpointRef);
    return Object.freeze({ more: result.more === true, out: String(result.out || "") });
  }
}
