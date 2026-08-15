// kernelRuntimeContract.js - Layer 0: Promise-first kernel runtime contract.
import { PyProcError } from "../errors.js";

export const KERNEL_RUNTIME_CONTRACT_VERSION = 2;
export const KERNEL_RUNTIME_KIND = "cpython-wasi";

export const KERNEL_RUNTIME_METHODS = Object.freeze([
  "describe",
  "execute",
  "getValue",
  "setValue",
  "checkpoint",
  "restore",
  "install",
  "installEnvironment",
  "inspect",
  "interrupt",
  "close",
]);

export function assertKernelRuntimeContract(runtime) {
  if (!runtime || runtime.runtimeContractVersion !== KERNEL_RUNTIME_CONTRACT_VERSION
    || runtime.runtimeKind !== KERNEL_RUNTIME_KIND) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "KernelRuntimeContract v2 identity is required");
  }
  for (const method of KERNEL_RUNTIME_METHODS) {
    if (typeof runtime[method] !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", `KernelRuntimeContract.${method}() is required`);
    }
  }
  return runtime;
}

export function kernelError(error, phase, retry = "never") {
  const code = error?.context?.kernelCode || error?.code || "PYPROC_INTERNAL";
  const result = {
    code,
    phase,
    message: String(error?.message || error),
    retry,
  };
  if (error?.context?.pyExcType) result.pythonType = error.context.pyExcType;
  return Object.freeze(result);
}
