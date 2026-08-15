// applicationReference.js - Layer 0: generation-bound application reference contract.
import { PyProcError } from "../errors.js";

export const APPLICATION_REFERENCE_PROTOCOL = "pyproc.application-ref";
export const APPLICATION_REFERENCE_VERSION = 1;

function referenceError(message, kernelCode, context = {}) {
  return new PyProcError("PYPROC_STATE_FENCE_STALE", message, { context: { ...context, kernelCode } });
}

function identityPart(value, label) {
  if (typeof value !== "string" || !value || value.length > 256) {
    throw new PyProcError("PYPROC_INPUT_INVALID", `Application reference ${label} is invalid`);
  }
  return value;
}

export function createApplicationReference({ kernelRef, generation, ref, type, name, operations = [] }) {
  identityPart(kernelRef, "kernelRef");
  identityPart(ref, "ref");
  identityPart(type, "type");
  identityPart(name, "name");
  if (!Number.isSafeInteger(generation) || generation < 0 || !Array.isArray(operations)
    || operations.some((operation) => typeof operation !== "string" || !operation)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference generation or operations are invalid");
  }
  return Object.freeze({
    protocol: APPLICATION_REFERENCE_PROTOCOL,
    version: APPLICATION_REFERENCE_VERSION,
    kernelRef,
    generation,
    ref,
    type,
    name,
    operations: Object.freeze([...new Set(operations)].sort()),
  });
}

export function assertApplicationReference(reference, expected = {}) {
  if (!reference || typeof reference !== "object" || reference.protocol !== APPLICATION_REFERENCE_PROTOCOL
    || reference.version !== APPLICATION_REFERENCE_VERSION) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference protocol identity is invalid");
  }
  identityPart(reference.kernelRef, "kernelRef");
  identityPart(reference.ref, "ref");
  identityPart(reference.type, "type");
  identityPart(reference.name, "name");
  if (!Number.isSafeInteger(reference.generation) || reference.generation < 0 || !Array.isArray(reference.operations)
    || reference.operations.some((operation) => typeof operation !== "string" || !operation)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference fields are invalid");
  }
  if (expected.kernelRef !== undefined && reference.kernelRef !== expected.kernelRef) {
    throw referenceError("Application reference belongs to another kernel", "KERNEL_APPLICATION_REF_FOREIGN", {
      expectedKernelRef: expected.kernelRef,
      actualKernelRef: reference.kernelRef,
    });
  }
  if (expected.generation !== undefined && reference.generation !== expected.generation) {
    throw referenceError("Application reference belongs to a stale kernel generation", "KERNEL_APPLICATION_REF_STALE", {
      expectedGeneration: expected.generation,
      actualGeneration: reference.generation,
    });
  }
  if (expected.type !== undefined && reference.type !== expected.type) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference type does not match the operation");
  }
  if (expected.operation !== undefined && !reference.operations.includes(expected.operation)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference does not allow the requested operation");
  }
  return reference;
}

export class ApplicationReferenceTable {
  #kernelRef;
  #generation;
  #counter = 0;
  #references = new Map();

  constructor({ kernelRef, generation = 0 }) {
    this.#kernelRef = identityPart(kernelRef, "kernelRef");
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference generation is invalid");
    }
    this.#generation = generation;
  }

  register({ type, name, operations = [] }) {
    const reference = createApplicationReference({
      kernelRef: this.#kernelRef,
      generation: this.#generation,
      ref: `${this.#kernelRef}:application:${++this.#counter}`,
      type,
      name,
      operations,
    });
    this.#references.set(reference.ref, reference);
    return reference;
  }

  resolve(reference, expected = {}) {
    assertApplicationReference(reference, { ...expected, kernelRef: this.#kernelRef, generation: this.#generation });
    const registered = this.#references.get(reference.ref);
    if (!registered || registered.kernelRef !== reference.kernelRef || registered.generation !== reference.generation
      || registered.type !== reference.type || registered.name !== reference.name
      || registered.operations.join("\n") !== reference.operations.join("\n")) {
      throw referenceError("Application reference is not registered in this generation", "KERNEL_APPLICATION_REF_STALE", {
        ref: reference.ref,
      });
    }
    return registered;
  }

  advanceGeneration(generation) {
    if (!Number.isSafeInteger(generation) || generation <= this.#generation) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Application reference generation must advance");
    }
    this.#generation = generation;
    this.#references.clear();
  }

  close() { this.#references.clear(); }
}
