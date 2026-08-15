// machineToolHostBridge.js - route Python argv requests to the same Machine tool layer.
import { HostCapabilityBroker } from "../../capabilities/hostCapabilityBroker.js";
import { CoreHostcallBroker } from "../../runtime/kernel/coreHostcallBroker.js";
import { HOSTCALL_ERROR, HOSTCALL_OPCODE, HOSTCALL_STATE } from "../../runtime/kernel/hostcallProtocol.js";
import { PyProcError } from "../../runtime/errors.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function terminal(state, errorCode, message) {
  return Object.freeze({ state, errorCode, bytes: encoder.encode(message) });
}

function parseRequest(request) {
  let value;
  try { value = JSON.parse(decoder.decode(request.payload)); }
  catch { throw new PyProcError("PYPROC_INPUT_INVALID", "Python tool bridge payload must be JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Python tool bridge request must be an object");
  }
  return value;
}

export class MachineToolHostBridge {
  #base;
  #ownsBase;
  #tools = new Map();
  #toolBroker;
  #closed = false;

  constructor(base = null) {
    if (base !== null && typeof base?.dispatch !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Machine tool bridge base broker is invalid");
    }
    this.#base = base || new CoreHostcallBroker();
    this.#ownsBase = base === null;
    this.#toolBroker = new HostCapabilityBroker({ maxResponseBytes: 1 << 20 });
    this.#toolBroker.register({ opcode: HOSTCALL_OPCODE.toolRun, name: "machine.tool.run",
      handler: (request) => this.#run(request) });
    this.#toolBroker.register({ opcode: HOSTCALL_OPCODE.toolInspect, name: "machine.tool.inspect",
      handler: (request) => this.#inspect(request) });
  }

  attach(kernelRef, toolLayer) {
    if (this.#closed || typeof kernelRef !== "string" || !kernelRef || typeof toolLayer?.run !== "function"
      || typeof toolLayer?.inspect !== "function" || this.#tools.has(kernelRef)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Machine tool bridge attachment is invalid");
    }
    this.#tools.set(kernelRef, toolLayer);
  }

  detach(kernelRef) { return this.#tools.delete(kernelRef); }

  #layer(request) {
    const layer = this.#tools.get(request.kernelRef);
    if (!layer) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE",
      `Python tool bridge is not attached to ${request.kernelRef || "this kernel"}`);
    return layer;
  }

  async #run(request) {
    const value = parseRequest(request);
    const options = value.options === undefined ? {} : value.options;
    if (typeof value.command !== "string" || !Array.isArray(value.args)
      || !options || typeof options !== "object" || Array.isArray(options)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Python tool run requires command, args, and options");
    }
    return this.#layer(request).run(value.command, value.args, { ...options, signal: request.signal });
  }

  #inspect(request) {
    return Object.freeze({ protocol: "pyproc.python-tool-bridge", version: 1, argvOnly: true,
      shellParsing: false, receiptProtocol: "pyproc.wasm-tool-receipt", tools: this.#layer(request).inspect() });
  }

  dispatch(request, options) {
    if (this.#closed) return Promise.resolve(terminal(HOSTCALL_STATE.brokerLost, HOSTCALL_ERROR.brokerLost,
      "Machine tool bridge is closed"));
    if (request?.opcode === HOSTCALL_OPCODE.toolRun || request?.opcode === HOSTCALL_OPCODE.toolInspect)
      return this.#toolBroker.dispatch(request, options);
    return this.#base.dispatch(request, options);
  }

  inspectCheckpointBoundary() {
    const base = this.#base.inspectCheckpointBoundary?.() || {};
    const tools = this.#toolBroker.inspectCheckpointBoundary();
    return Object.freeze({ acceptedHostcalls: (base.acceptedHostcalls || 0) + tools.acceptedHostcalls,
      activeTransactions: (base.activeTransactions || 0) + tools.activeTransactions,
      outputDrained: base.outputDrained !== false && tools.outputDrained !== false,
      openResources: Object.freeze([...(base.openResources || []), ...(tools.openResources || [])]),
      vfsRootDigest: base.vfsRootDigest || tools.vfsRootDigest || null });
  }

  close(reason = "Machine tool bridge closed") {
    if (this.#closed) return;
    this.#closed = true;
    this.#tools.clear();
    this.#toolBroker.close(reason);
    if (this.#ownsBase) this.#base.close?.(reason);
  }
}
