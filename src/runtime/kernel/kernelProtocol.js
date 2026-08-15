// kernelProtocol.js - Layer 0: canonical kernel command and event records.
import { sha256Address } from "../contentDigest.js";
import { PyProcError } from "../errors.js";

const KERNEL_COMMAND_PROTOCOL = "pyproc.kernel-command";
const KERNEL_COMMAND_VERSION = 1;
const KERNEL_EVENT_PROTOCOL = "pyproc.kernel-event";

function canonicalValue(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel command numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel command input cannot contain cycles");
    seen.add(value);
    const result = value.map((entry) => canonicalValue(entry, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel command input cannot contain cycles");
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel command input cannot contain undefined");
      result[key] = canonicalValue(value[key], seen);
    }
    seen.delete(value);
    return result;
  }
  throw new PyProcError("PYPROC_INPUT_INVALID", `Kernel command input type is unsupported: ${typeof value}`);
}

function canonicalKernelInput(value) {
  return JSON.stringify(canonicalValue(value, new Set()));
}

async function kernelInputDigest(operation, input) {
  return sha256Address(`${operation}\n${canonicalKernelInput(input)}`);
}

export async function createKernelCommand({
  commandId,
  kernelRef,
  generation,
  operation,
  input,
  deadlineAt,
  cancellationRef,
  authorityRef,
  expectedStateDigest,
}) {
  if (typeof commandId !== "string" || !commandId || typeof kernelRef !== "string" || !kernelRef
    || !Number.isSafeInteger(generation) || generation < 0 || typeof operation !== "string" || !operation) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel command identity is invalid");
  }
  if (deadlineAt !== undefined && (!Number.isFinite(deadlineAt) || deadlineAt <= 0)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel command deadlineAt is invalid");
  }
  const command = {
    protocol: KERNEL_COMMAND_PROTOCOL,
    version: KERNEL_COMMAND_VERSION,
    commandId,
    kernelRef,
    generation,
    operation,
    input: canonicalValue(input, new Set()),
    inputDigest: await kernelInputDigest(operation, input),
  };
  for (const [key, value] of Object.entries({ deadlineAt, cancellationRef, authorityRef, expectedStateDigest })) {
    if (value !== undefined) command[key] = value;
  }
  return Object.freeze(command);
}

export function createKernelEvent(command, sequence, type, payload) {
  return Object.freeze({
    protocol: KERNEL_EVENT_PROTOCOL,
    version: 1,
    kernelRef: command.kernelRef,
    generation: command.generation,
    commandId: command.commandId,
    sequence,
    type,
    payload,
  });
}
